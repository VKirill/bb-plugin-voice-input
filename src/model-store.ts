// Где лежат скачанные модели и сколько занимают. Пользователь должен видеть
// цену вопроса и уметь освободить место, не разбираясь в кешах библиотек.
import { existsSync } from "node:fs";
import { readdir, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { EngineId } from "./contract.js";

/** Каталог кеша модели. Для нативного движка моделями владеет система. */
export function modelDirectory(engine: EngineId, model: string): string | null {
  if (engine === "whisper") {
    const slug = `models--${model.replace(/\//gu, "--")}`;
    return join(homedir(), ".cache", "huggingface", "hub", slug);
  }
  if (engine === "gigaam") {
    return join(homedir(), ".cache", "gigaam");
  }
  return null;
}

export async function directorySize(path: string): Promise<number> {
  if (!existsSync(path)) {
    return 0;
  }
  let total = 0;
  const walk = async (current: string): Promise<void> => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const child = join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(child);
      } else if (entry.isFile()) {
        total += (await stat(child)).size;
      }
      // Симлинки кеша HF указывают на blobs внутри того же каталога —
      // считать их отдельно значило бы удвоить размер.
    }
  };
  await walk(path);
  return total;
}

/** Что реально лежит в кешах моделей на этой машине. */
export async function listModels(): Promise<
  { engine: EngineId; model: string; path: string; bytes: number }[]
> {
  const result: { engine: EngineId; model: string; path: string; bytes: number }[] = [];

  const hub = join(homedir(), ".cache", "huggingface", "hub");
  if (existsSync(hub)) {
    for (const entry of await readdir(hub, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith("models--")) {
        continue;
      }
      const model = entry.name.replace(/^models--/u, "").replace(/--/gu, "/");
      // В кеше лежат модели и от других инструментов: показываем только речевые.
      if (!/whisper|speech|voice|asr/iu.test(model)) {
        continue;
      }
      const path = join(hub, entry.name);
      result.push({ engine: "whisper", model, path, bytes: await directorySize(path) });
    }
  }

  const gigaam = join(homedir(), ".cache", "gigaam");
  if (existsSync(gigaam)) {
    result.push({
      engine: "gigaam",
      model: "GigaAM v3",
      path: gigaam,
      bytes: await directorySize(gigaam),
    });
  }

  return result.sort((left, right) => right.bytes - left.bytes);
}

export async function modelSize(engine: EngineId, model: string): Promise<number> {
  const directory = modelDirectory(engine, model);
  return directory ? await directorySize(directory) : 0;
}

export async function deleteModel(engine: EngineId, model: string): Promise<number> {
  const directory = engine === "whisper" && model.includes("/")
    ? modelDirectory(engine, model)
    : modelDirectory(engine, model);
  if (!directory || !existsSync(directory)) {
    return 0;
  }
  const freed = await directorySize(directory);
  await rm(directory, { recursive: true, force: true });
  return freed;
}
