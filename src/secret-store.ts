// Ключи провайдеров хранятся на машине распознавания — там, где и нужны.
//
// BB держит секреты плагина файлами 0600 и показывает их отдельной формой над
// страницей плагина. Форма не скрывается и сбивает с толку: настройки плагина
// разложены по вкладкам, а четыре поля ключей висят наверху отдельно. Поэтому
// хранение своё, а режим доступа тот же, что у BB, — файл 0600.
import { chmod, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import type { HostPaths } from "./paths.js";

export type SecretName = "openaiApiKey" | "googleApiKey" | "groqApiKey" | "aiPassApiKey";

export type Secrets = Partial<Record<SecretName, string>>;

export async function readSecrets(paths: HostPaths): Promise<Secrets> {
  if (!existsSync(paths.secretsFile)) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(await readFile(paths.secretsFile, "utf8"));
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    const result: Secrets = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "string" && value.length > 0) {
        result[key as SecretName] = value;
      }
    }
    return result;
  } catch {
    return {};
  }
}

export async function writeSecret(
  paths: HostPaths,
  name: SecretName,
  value: string,
): Promise<void> {
  const current = await readSecrets(paths);
  if (value.length > 0) {
    current[name] = value;
  } else {
    delete current[name];
  }
  await writeFile(paths.secretsFile, JSON.stringify(current, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
  // Файл мог существовать с прежними правами — режим задаётся явно.
  await chmod(paths.secretsFile, 0o600);
}
