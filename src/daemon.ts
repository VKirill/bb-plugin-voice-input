// Запуск и вызов демона распознавания. Демон живёт дольше воркера плагина:
// модель загружается десятки секунд, и платить это на каждую фразу нельзя.
import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import { mkdir, open, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import type { EngineId } from "./contract.js";
import type { HostPaths } from "./paths.js";
import { EMBEDDED_ASSETS } from "./embedded-assets.generated.js";

const DAEMON_START_TIMEOUT_MS = 20_000;
const PING_TIMEOUT_MS = 2_000;

export type DaemonRequest =
  | { op: "ping" }
  | { op: "warmup"; engine: EngineId; model: string }
  | {
      op: "transcribe";
      engine: EngineId;
      model: string;
      language: string;
      audioPath: string;
      prompt: string | null;
    }
  | { op: "shutdown" };

export type DaemonResponse =
  | { ok: true; text?: string; engine?: string; durationMs?: number; loaded?: string[] }
  | { ok: false; code: string; message: string };

/** Разложить питоновские исходники рядом с окружением: хост едет одним бандлом. */
export async function materializePython(paths: HostPaths): Promise<void> {
  await mkdir(paths.pythonDir, { recursive: true });
  for (const [name, source] of Object.entries(EMBEDDED_ASSETS)) {
    if (name.endsWith(".py")) {
      await writeFile(`${paths.pythonDir}/${name}`, source, "utf8");
    }
  }
}

export async function callDaemon(
  paths: HostPaths,
  engine: EngineId,
  request: DaemonRequest,
  timeoutMs: number,
): Promise<DaemonResponse> {
  return await new Promise<DaemonResponse>((resolve, reject) => {
    const connection = createConnection(paths.socketPath(engine));
    let buffer = "";
    const timer = setTimeout(() => {
      connection.destroy();
      reject(new Error("timeout"));
    }, timeoutMs);

    const finish = (result: DaemonResponse) => {
      clearTimeout(timer);
      connection.end();
      resolve(result);
    };

    connection.on("connect", () => {
      connection.write(`${JSON.stringify(request)}\n`);
    });
    connection.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const newline = buffer.indexOf("\n");
      if (newline >= 0) {
        try {
          finish(JSON.parse(buffer.slice(0, newline)) as DaemonResponse);
        } catch (error) {
          clearTimeout(timer);
          connection.destroy();
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      }
    });
    connection.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function isAlive(paths: HostPaths, engine: EngineId): Promise<boolean> {
  if (!existsSync(paths.socketPath(engine))) {
    return false;
  }
  try {
    const response = await callDaemon(paths, engine, { op: "ping" }, PING_TIMEOUT_MS);
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Поднять демон, если он не отвечает. Процесс отвязывается от воркера плагина:
 * BB усыпляет воркер через пять минут простоя, а модель должна оставаться тёплой.
 */
export async function ensureDaemon(
  paths: HostPaths,
  engine: EngineId,
  idleTimeoutSeconds: number,
): Promise<void> {
  if (await isAlive(paths, engine)) {
    return;
  }
  await rm(paths.socketPath(engine), { force: true });
  await materializePython(paths);

  const python = paths.venvPython(engine);
  if (!existsSync(python)) {
    throw new Error(
      `Окружение движка «${engine}» не установлено. Запустите «bb voice-input setup».`,
    );
  }

  const logFile = await open(paths.daemonLog(engine), "a");
  const child = spawn(python, [`${paths.pythonDir}/voiced.py`, paths.socketPath(engine)], {
    detached: true,
    stdio: ["ignore", logFile.fd, logFile.fd],
    env: {
      ...process.env,
      VOICE_INPUT_IDLE_TIMEOUT: String(idleTimeoutSeconds),
      // Без этого каждая загрузка модели ходит в сеть за ревизией.
      HF_HUB_DISABLE_TELEMETRY: "1",
    },
  });
  child.unref();
  await logFile.close();

  const deadline = Date.now() + DAEMON_START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await isAlive(paths, engine)) {
      return;
    }
    await delay(250);
  }
  throw new Error(
    `Демон распознавания не поднялся за ${DAEMON_START_TIMEOUT_MS / 1000} с; см. ${paths.daemonLog(engine)}`,
  );
}

export async function stopDaemon(paths: HostPaths, engine: EngineId): Promise<void> {
  if (!existsSync(paths.socketPath(engine))) {
    return;
  }
  try {
    await callDaemon(paths, engine, { op: "shutdown" }, PING_TIMEOUT_MS);
  } catch {
    // Демон мог уже выйти сам по простою.
  }
  await rm(paths.socketPath(engine), { force: true });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
