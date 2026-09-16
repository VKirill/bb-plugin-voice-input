// Раскладка на машине распознавания. Всё живёт в dataDir плагина на хосте:
// окружения движков, сокет демона, записи и последний применённый конфиг.
import { join } from "node:path";
import type { EngineId } from "./contract.js";

export type HostPaths = ReturnType<typeof hostPaths>;

export function hostPaths(dataDir: string) {
  return {
    dataDir,
    configFile: join(dataDir, "config.json"),
    secretsFile: join(dataDir, "secrets.json"),
    pythonDir: join(dataDir, "python"),
    recordingsDir: join(dataDir, "recordings"),
    // Движки живут в разных окружениях, поэтому демон у каждого свой.
    socketPath: (engine: EngineId) => join(dataDir, `voiced-${engine}.sock`),
    daemonLog: (engine: EngineId) => join(dataDir, `voiced-${engine}.log`),
    historyFile: join(dataDir, "history.jsonl"),
    venvDir: (engine: EngineId) => join(dataDir, `venv-${engine}`),
    venvPython: (engine: EngineId) => join(dataDir, `venv-${engine}`, "bin", "python"),
  };
}

/** Пакеты движка. Ставятся только когда пользователь выбрал этот движок. */
export const ENGINE_REQUIREMENTS: Record<EngineId, string[]> = {
  // mlx работает только на Apple Silicon; проверка платформы — в setup.
  whisper: ["mlx-whisper"],
  // Облачные движки не ставят ничего: им нужен только ключ.
  openai: [],
  google: [],
  groq: [],
  // GigaAM ставится из репозитория: на PyPI лежит устаревшая версия без v3.
  gigaam: [
    "gigaam[torch] @ git+https://github.com/salute-developers/GigaAM.git",
    "soundfile",
    "silero-vad",
  ],
};
