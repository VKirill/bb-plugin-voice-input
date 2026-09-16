"""Движки распознавания: Whisper (MLX) и GigaAM v3.

Whisper — многоязычный и быстрый на Apple Silicon. GigaAM — русский от Сбера,
в варианте v3_e2e_rnnt даёт пунктуацию и нормализацию из коробки, но
`transcribe` принимает не больше 25 секунд, поэтому длинное аудио режется
здесь по паузам.
"""

from __future__ import annotations

import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path

GIGAAM_MODEL = "v3_e2e_rnnt"
GIGAAM_CHUNK_SECONDS = 22.0
GIGAAM_SAMPLE_RATE = 16000


@dataclass
class TranscriptionRequest:
    audio_path: Path
    model: str
    language: str | None
    prompt: str | None


class EngineError(RuntimeError):
    """Движок не смог распознать запись; сообщение уходит пользователю."""


class WhisperEngine:
    """mlx-whisper: модель кешируется библиотекой, повторные вызовы быстрые."""

    id = "whisper"

    def __init__(self) -> None:
        self._loaded_model: str | None = None

    def warmup(self, model: str) -> None:
        import mlx_whisper
        import numpy as np

        mlx_whisper.transcribe(np.zeros(GIGAAM_SAMPLE_RATE, dtype=np.float32), path_or_hf_repo=model)
        self._loaded_model = model

    def transcribe(self, request: TranscriptionRequest) -> str:
        import mlx_whisper

        options: dict[str, object] = {
            "path_or_hf_repo": request.model,
            # Whisper дописывает на тишине заученные хвосты вроде «Редактор
            # субтитров…». Без опоры на предыдущий отрезок это почти исчезает,
            # а связность короткой диктовки не страдает.
            "condition_on_previous_text": False,
        }
        if request.language:
            options["language"] = request.language
        if request.prompt:
            options["initial_prompt"] = request.prompt
        result = mlx_whisper.transcribe(str(request.audio_path), **options)
        self._loaded_model = request.model
        return str(result.get("text") or "").strip()


class GigaamEngine:
    """GigaAM v3 end-to-end: русский с пунктуацией, длинное аудио режем сами.

    На Apple Silicon модель считается на GPU через MPS. Не все операции RNNT
    там реализованы, поэтому при сбое движок один раз откатывается на CPU и
    дальше работает на нём — молча падать посреди диктовки он не должен.
    """

    id = "gigaam"

    def __init__(self) -> None:
        self._model = None
        self._vad = None
        self._device = None

    def warmup(self, model: str) -> None:
        self._ensure_model()

    def _preferred_device(self) -> str:
        import torch

        if torch.backends.mps.is_available():
            return "mps"
        return "cpu"

    def _ensure_model(self):
        if self._model is None:
            import gigaam

            device = self._device or self._preferred_device()
            try:
                # fp16 на MPS даёт заметный выигрыш, на CPU он не поддержан.
                self._model = gigaam.load_model(
                    GIGAAM_MODEL, device=device, fp16_encoder=device == "mps"
                )
                self._device = device
            except Exception:
                if device == "cpu":
                    raise
                self._model = gigaam.load_model(GIGAAM_MODEL, device="cpu", fp16_encoder=False)
                self._device = "cpu"
        return self._model

    def _transcribe_chunk(self, model, chunk: Path) -> str:
        """Один кусок. Сбой на MPS переводит движок на CPU и повторяет попытку."""
        try:
            return str(model.transcribe(str(chunk))).strip()
        except (NotImplementedError, RuntimeError):
            if self._device != "mps":
                raise
            import gigaam

            self._model = gigaam.load_model(GIGAAM_MODEL, device="cpu", fp16_encoder=False)
            self._device = "cpu"
            return str(self._model.transcribe(str(chunk))).strip()

    def transcribe(self, request: TranscriptionRequest) -> str:
        model = self._ensure_model()
        wav_path = _to_wav(request.audio_path)
        try:
            chunks = self._split(wav_path)
            texts: list[str] = []
            for chunk in chunks:
                text = self._transcribe_chunk(model, chunk)
                if text:
                    texts.append(text)
            return " ".join(texts).strip()
        finally:
            _cleanup(wav_path, keep=request.audio_path)

    def _split(self, wav_path: Path) -> list[Path]:
        """Нарезать по речевым сегментам: GigaAM.transcribe берёт до 25 секунд."""
        import soundfile as sf

        audio, sample_rate = sf.read(str(wav_path), dtype="float32")
        if audio.ndim > 1:
            audio = audio.mean(axis=1)
        limit = int(GIGAAM_CHUNK_SECONDS * sample_rate)
        if len(audio) <= limit:
            return [wav_path]

        boundaries = self._speech_boundaries(audio, sample_rate, limit)
        parts: list[Path] = []
        for index, (start, end) in enumerate(boundaries):
            part = wav_path.with_name(f"{wav_path.stem}-{index:03d}.wav")
            sf.write(str(part), audio[start:end], sample_rate)
            parts.append(part)
        return parts

    def _speech_boundaries(self, audio, sample_rate: int, limit: int) -> list[tuple[int, int]]:
        """Границы кусков: по паузам, найденным Silero VAD, иначе равными долями."""
        try:
            if self._vad is None:
                from silero_vad import load_silero_vad

                self._vad = load_silero_vad()
            from silero_vad import get_speech_timestamps

            import torch

            timestamps = get_speech_timestamps(
                torch.from_numpy(audio), self._vad, sampling_rate=sample_rate
            )
        except Exception:
            timestamps = []

        if not timestamps:
            return [(start, min(start + limit, len(audio))) for start in range(0, len(audio), limit)]

        boundaries: list[tuple[int, int]] = []
        current_start = timestamps[0]["start"]
        current_end = timestamps[0]["end"]
        for segment in timestamps[1:]:
            if segment["end"] - current_start > limit:
                boundaries.append((current_start, current_end))
                current_start = segment["start"]
            current_end = segment["end"]
        boundaries.append((current_start, current_end))
        # Слишком длинный отдельный сегмент речи без пауз всё равно режем жёстко.
        result: list[tuple[int, int]] = []
        for start, end in boundaries:
            while end - start > limit:
                result.append((start, start + limit))
                start += limit
            result.append((start, end))
        return result


def _to_wav(source: Path) -> Path:
    """GigaAM ждёт 16 кГц моно; браузер присылает webm/opus."""
    if source.suffix.lower() == ".wav":
        return source
    target = Path(tempfile.mkdtemp(prefix="voice-input-")) / "audio.wav"
    process = subprocess.run(
        [
            "ffmpeg", "-nostdin", "-y", "-i", str(source),
            "-ar", str(GIGAAM_SAMPLE_RATE), "-ac", "1", str(target),
        ],
        capture_output=True,
        check=False,
    )
    if process.returncode != 0 or not target.exists():
        raise EngineError(f"ffmpeg не смог подготовить аудио: {process.stderr.decode('utf-8', 'replace')[-400:]}")
    return target


def _cleanup(wav_path: Path, keep: Path) -> None:
    if wav_path == keep:
        return
    directory = wav_path.parent
    for item in directory.glob("*.wav"):
        item.unlink(missing_ok=True)
    try:
        directory.rmdir()
    except OSError:
        pass


ENGINES = {"whisper": WhisperEngine, "gigaam": GigaamEngine}
