// Загрузка модели движка с прогрессом. Питоновский скрипт печатает построчный
// JSON, здесь он превращается в сигналы для интерфейса.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import type { EngineId } from "./contract.js";
import type { HostPaths } from "./paths.js";

export type DownloadEvent =
  | { event: "progress"; percent: number | null; downloadedBytes: number | null; totalBytes: number | null }
  | { event: "done" }
  | { event: "error"; message: string };

const DOWNLOAD_TIMEOUT_MS = 60 * 60 * 1000;

export async function downloadModel(
  paths: HostPaths,
  engine: EngineId,
  model: string,
  onEvent: (event: DownloadEvent) => void,
): Promise<void> {
  const python = paths.venvPython(engine);
  if (!existsSync(python)) {
    throw new Error(`Окружение движка «${engine}» не установлено: сначала «bb voice-input setup».`);
  }

  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      python,
      [`${paths.pythonDir}/download.py`, engine, ...(model ? [model] : [])],
      { env: { ...process.env, HF_HUB_DISABLE_TELEMETRY: "1" } },
    );

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Загрузка модели не уложилась в час"));
    }, DOWNLOAD_TIMEOUT_MS);

    let stdout = "";
    let failure: string | null = null;
    let stderrTail = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      let newline = stdout.indexOf("\n");
      while (newline >= 0) {
        const line = stdout.slice(0, newline).trim();
        stdout = stdout.slice(newline + 1);
        newline = stdout.indexOf("\n");
        if (line.length === 0) {
          continue;
        }
        try {
          const parsed = JSON.parse(line) as DownloadEvent;
          if (parsed.event === "error") {
            failure = parsed.message;
          }
          onEvent(parsed);
        } catch {
          // Строка не от нас — библиотеки иногда печатают своё.
        }
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderrTail = `${stderrTail}${chunk.toString("utf8")}`.slice(-2000);
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (failure) {
        reject(new Error(failure));
      } else if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Загрузка модели завершилась с кодом ${code}. ${stderrTail.trim()}`));
      }
    });
  });
}
