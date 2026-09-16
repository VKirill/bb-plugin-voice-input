"""Демон распознавания: держит модель в памяти между запросами.

Холодная загрузка модели стоит десятки секунд, а голосовой ввод должен
отвечать за секунды, поэтому распознаёт не разовый процесс, а демон на
unix-сокете. Он переживает перезагрузку воркера плагина и сам выходит после
простоя.

Протокол — JSON-строки: {"op": "transcribe" | "ping" | "shutdown", ...}.
"""

from __future__ import annotations

import json
import os
import signal
import socket
import sys
import threading
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from engines import ENGINES, EngineError, TranscriptionRequest  # noqa: E402

IDLE_TIMEOUT_SECONDS = float(os.environ.get("VOICE_INPUT_IDLE_TIMEOUT", "0"))  # 0 = не выходить
SOCKET_BACKLOG = 8

_engines: dict[str, object] = {}
_lock = threading.Lock()
_last_activity = time.monotonic()


def _engine(engine_id: str):
    engine = _engines.get(engine_id)
    if engine is None:
        factory = ENGINES.get(engine_id)
        if factory is None:
            raise EngineError(f"Неизвестный движок: {engine_id}")
        engine = factory()
        _engines[engine_id] = engine
    return engine


def _handle(request: dict) -> dict:
    global _last_activity
    _last_activity = time.monotonic()
    op = request.get("op")

    if op == "ping":
        return {"ok": True, "loaded": sorted(_engines)}

    if op == "warmup":
        engine = _engine(str(request["engine"]))
        with _lock:
            engine.warmup(str(request.get("model") or ""))
        return {"ok": True}

    if op == "transcribe":
        engine_id = str(request["engine"])
        engine = _engine(engine_id)
        language = request.get("language") or None
        started = time.monotonic()
        with _lock:  # модели не рассчитаны на параллельные прогоны
            text = engine.transcribe(
                TranscriptionRequest(
                    audio_path=Path(str(request["audioPath"])),
                    model=str(request.get("model") or ""),
                    language=None if language in (None, "auto") else str(language),
                    prompt=request.get("prompt") or None,
                )
            )
        return {
            "ok": True,
            "text": text,
            "engine": engine_id,
            "durationMs": int((time.monotonic() - started) * 1000),
        }

    if op == "shutdown":
        return {"ok": True, "shutdown": True}

    raise EngineError(f"Неизвестная операция: {op}")


def _serve_client(connection: socket.socket) -> bool:
    """Обслужить одно соединение. Возвращает True, если демон просили выйти."""
    with connection:
        connection.settimeout(3600)
        buffer = b""
        while not buffer.endswith(b"\n"):
            chunk = connection.recv(65536)
            if not chunk:
                return False
            buffer += chunk
        try:
            request = json.loads(buffer.decode("utf-8"))
            response = _handle(request)
        except EngineError as error:
            response = {"ok": False, "code": "request_failed", "message": str(error)}
        except Exception as error:  # noqa: BLE001 — любой сбой возвращаем клиенту
            response = {"ok": False, "code": "request_failed", "message": f"{type(error).__name__}: {error}"}
        connection.sendall((json.dumps(response, ensure_ascii=False) + "\n").encode("utf-8"))
        return bool(response.get("shutdown"))


def _idle_watchdog(server: socket.socket, socket_path: Path) -> None:
    while True:
        time.sleep(30)
        if IDLE_TIMEOUT_SECONDS <= 0:
            continue
        if time.monotonic() - _last_activity > IDLE_TIMEOUT_SECONDS:
            server.close()
            socket_path.unlink(missing_ok=True)
            os.kill(os.getpid(), signal.SIGTERM)
            return


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: voiced.py <socket-path>", file=sys.stderr)
        return 2
    socket_path = Path(sys.argv[1])
    socket_path.parent.mkdir(parents=True, exist_ok=True)
    socket_path.unlink(missing_ok=True)

    server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    server.bind(str(socket_path))
    server.listen(SOCKET_BACKLOG)
    os.chmod(socket_path, 0o600)
    print(json.dumps({"event": "listening", "socket": str(socket_path)}), flush=True)

    threading.Thread(target=_idle_watchdog, args=(server, socket_path), daemon=True).start()

    try:
        while True:
            try:
                connection, _ = server.accept()
            except OSError:
                break
            try:
                if _serve_client(connection):
                    break
            except Exception as error:  # noqa: BLE001 — один клиент не роняет демон
                print(json.dumps({"event": "error", "message": str(error)}), flush=True)
    finally:
        server.close()
        socket_path.unlink(missing_ok=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
