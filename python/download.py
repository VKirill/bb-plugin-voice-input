"""Предзагрузка модели с прогрессом.

Печатает в stdout строки JSON: {"event": "progress", "percent": N, ...} и в
конце {"event": "done"} либо {"event": "error", "message": ...}. Хост читает их
построчно и превращает в сигналы, которые видит интерфейс.

Молчаливая ленивая загрузка при первой фразе — плохой опыт: пользователь ждёт
минуты и не знает, скачивается модель или всё сломалось.
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

REPORT_INTERVAL_SECONDS = 0.5


def emit(payload: dict) -> None:
    print(json.dumps(payload, ensure_ascii=False), flush=True)


class ProgressTqdm:
    """Подменяет tqdm внутри huggingface_hub, чтобы отдавать проценты наружу."""

    _total_bytes = 0
    _done_bytes = 0
    _last_report = 0.0
    # Размер известен заранее — счётчики отдельных файлов его не меняют.
    _report_total_known = False

    def __init__(self, *args, **kwargs):
        self.total = kwargs.get("total") or 0
        self.n = 0
        self.desc = kwargs.get("desc") or ""
        # huggingface_hub заводит счётчики и на файлы, и на байты. В общий
        # прогресс идут только байтовые, иначе «1 из 4 файлов» превращается
        # в 25 % задолго до конца загрузки.
        self.counts_bytes = kwargs.get("unit") == "B"
        if self.counts_bytes and not ProgressTqdm._report_total_known:
            ProgressTqdm._total_bytes += self.total

    def update(self, amount: int = 1) -> None:
        self.n += amount
        if not self.counts_bytes:
            return
        ProgressTqdm._done_bytes += amount
        now = time.monotonic()
        if now - ProgressTqdm._last_report < REPORT_INTERVAL_SECONDS:
            return
        ProgressTqdm._last_report = now
        self.report()

    def report(self) -> None:
        total = ProgressTqdm._total_bytes
        done = ProgressTqdm._done_bytes
        emit({
            "event": "progress",
            "percent": round(done / total * 100, 1) if total else None,
            "downloadedBytes": done,
            "totalBytes": total or None,
        })

    def close(self) -> None:
        if self.counts_bytes:
            self.report()

    def __enter__(self):
        return self

    def __exit__(self, *_args) -> None:
        self.close()

    def __iter__(self):
        return iter(())

    def set_description(self, *_args, **_kwargs) -> None:
        return None

    def set_postfix(self, *_args, **_kwargs) -> None:
        return None

    def refresh(self) -> None:
        return None

    def reset(self, total=None) -> None:
        self.total = total or 0


def repository_size(model: str) -> int:
    """Суммарный размер файлов модели. Библиотека сама общий размер не сообщает."""
    from huggingface_hub import HfApi

    try:
        info = HfApi().model_info(model, files_metadata=True)
    except Exception:
        return 0
    return sum(getattr(sibling, "size", None) or 0 for sibling in (info.siblings or []))


def download_whisper(model: str) -> None:
    from huggingface_hub import snapshot_download

    # Проценты считаются от размера репозитория. Уже скачанные файлы заново не
    # качаются, поэтому на частично заполненном кеше прогресс доходит до конца
    # скачком — итоговое событие всё равно ставит 100 %.
    ProgressTqdm._total_bytes = repository_size(model)
    ProgressTqdm._report_total_known = ProgressTqdm._total_bytes > 0
    snapshot_download(repo_id=model, tqdm_class=ProgressTqdm)


def download_gigaam() -> None:
    """У GigaAM свой загрузчик с CDN; точных процентов он наружу не отдаёт."""
    import gigaam

    from engines import GIGAAM_MODEL

    emit({"event": "progress", "percent": None, "downloadedBytes": None, "totalBytes": None})
    gigaam.load_model(GIGAAM_MODEL, device="cpu", fp16_encoder=False)


def main() -> int:
    if len(sys.argv) < 2:
        emit({"event": "error", "message": "usage: download.py <engine> [model]"})
        return 2
    engine = sys.argv[1]
    try:
        if engine == "whisper":
            if len(sys.argv) < 3:
                emit({"event": "error", "message": "не указана модель"})
                return 2
            download_whisper(sys.argv[2])
        elif engine == "gigaam":
            download_gigaam()
        else:
            emit({"event": "error", "message": f"У движка «{engine}» нет загружаемой модели"})
            return 2
    except Exception as error:  # noqa: BLE001 — сообщение уходит пользователю
        emit({"event": "error", "message": f"{type(error).__name__}: {error}"})
        return 1
    emit({"event": "done"})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
