// Разворачивание движка на машине, где работает сервер BB: окружение Python,
// пакеты движка и первая загрузка модели. Установщик системных пакетов BB не
// даёт, поэтому Python и ffmpeg должны быть на машине — их отсутствие это
// внятная ошибка, а не молчаливый сбой распознавания.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { promisify } from "node:util";
import { arch, platform } from "node:os";
import { join } from "node:path";
import type { EngineId } from "./contract.js";
import { ENGINE_REQUIREMENTS, type HostPaths } from "./paths.js";

const run = promisify(execFile);
const INSTALL_TIMEOUT_MS = 30 * 60 * 1000;
const PYTHON_CANDIDATES = ["python3.12", "python3.11", "python3"];
const SEARCH_PATHS = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"];

export type SetupResult = { ready: boolean; log: string; detail: string };

/**
 * Найти исполняемый файл. PATH воркера плагина узкий и не содержит Homebrew,
 * поэтому каталоги перебираются явно, а `which` остаётся запасным вариантом.
 */
export async function findExecutable(names: string[]): Promise<string | null> {
  for (const name of names) {
    if (name.includes("/")) {
      if (existsSync(name)) {
        return name;
      }
      continue;
    }
    for (const directory of SEARCH_PATHS) {
      const candidate = join(directory, name);
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }
  for (const name of names) {
    try {
      const { stdout } = await run("/usr/bin/which", [name]);
      const found = stdout.trim().split("\n")[0];
      if (found && existsSync(found)) {
        return found;
      }
    } catch {
      // Пробуем следующего кандидата.
    }
  }
  return null;
}

export async function findPython(): Promise<string | null> {
  return await findExecutable(PYTHON_CANDIDATES);
}

export async function findFfmpeg(): Promise<string | null> {
  return await findExecutable(["ffmpeg"]);
}

export async function setupEngine(
  paths: HostPaths,
  engine: EngineId,
  reinstall: boolean,
): Promise<SetupResult> {
  const log: string[] = [];
  const note = (line: string) => log.push(line);

  if (engine === "openai" || engine === "google" || engine === "groq") {
    return {
      ready: true,
      log: "",
      detail:
        "Облачный движок ничего не устанавливает: нужен только ключ в настройках. Аудио при этом уходит наружу.",
    };
  }

  const python = await findPython();
  if (!python) {
    return {
      ready: false,
      log: log.join("\n"),
      detail: "На машине нет Python 3. Установите его и повторите установку.",
    };
  }
  note(`Python: ${python}`);

  const ffmpeg = await findFfmpeg();
  if (!ffmpeg) {
    return {
      ready: false,
      log: log.join("\n"),
      detail: "На машине нет ffmpeg — без него браузерная запись не декодируется.",
    };
  }
  note(`ffmpeg: ${ffmpeg}`);

  await mkdir(paths.dataDir, { recursive: true });
  const venvDir = paths.venvDir(engine);
  const venvPython = paths.venvPython(engine);

  if (reinstall || !existsSync(venvPython)) {
    note(`Создаю окружение ${venvDir}`);
    await run(python, ["-m", "venv", ...(reinstall ? ["--clear"] : []), venvDir], {
      timeout: INSTALL_TIMEOUT_MS,
    });
  }

  note(`Ставлю пакеты: ${ENGINE_REQUIREMENTS[engine].join(", ")}`);
  const install = await run(
    venvPython,
    ["-m", "pip", "install", "--upgrade", "pip", ...ENGINE_REQUIREMENTS[engine]],
    { timeout: INSTALL_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 },
  );
  note(tail(install.stdout, 2000));

  return {
    ready: true,
    log: log.join("\n"),
    detail: `Движок «${engine}» установлен. Первое распознавание дополнительно скачает модель.`,
  };
}

/**
 * Состояние движка кодом, а не фразой: подписи переводятся в интерфейсе, и
 * серверу незачем знать, на каком языке их покажут.
 */
export async function engineReady(
  paths: HostPaths,
  engine: EngineId,
  cloudKeys: { openai: boolean; google: boolean; groq: boolean } = {
    openai: false,
    google: false,
    groq: false,
  },
): Promise<string> {
  if (engine === "openai" || engine === "google" || engine === "groq") {
    return cloudKeys[engine] ? "ready" : "needs-key";
  }

  const venvPython = paths.venvPython(engine);
  if (!existsSync(venvPython)) {
    return "not-installed";
  }
  const probe = engine === "whisper" ? "import mlx_whisper" : "import gigaam";
  try {
    await run(venvPython, ["-c", probe], { timeout: 120_000 });
    return "ready";
  } catch (error) {
    return `broken: ${describe(error)}`;
  }
}

function tail(value: string, limit: number): string {
  return value.length > limit ? `…${value.slice(value.length - limit)}` : value;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message.split("\n")[0] : String(error);
}
