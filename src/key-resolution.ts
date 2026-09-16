// Один провайдер — один ключ. Если адрес совпадает, ключ, введённый в любом из
// мест, годится и для второго: вводить один и тот же ключ дважды незачем.
import type { VoiceConfig } from "./contract.ts";

export type KeySource = "own" | "groq" | "openai" | "aiPass" | null;

function sameEndpoint(left: string, right: string): boolean {
  const normalize = (value: string) => value.replace(/\/+$/u, "").toLowerCase();
  return left.length > 0 && normalize(left) === normalize(right);
}

/** Ключ для ИИ-прохода: свой либо от провайдера с тем же адресом. */
export function resolveAiPassKey(config: VoiceConfig): { key: string; source: KeySource } {
  if (config.aiPass.apiKey) {
    return { key: config.aiPass.apiKey, source: "own" };
  }
  const candidates: { source: KeySource; baseUrl: string; key: string }[] = [
    { source: "groq", baseUrl: config.cloud.groqBaseUrl, key: config.cloud.groqApiKey },
    { source: "openai", baseUrl: config.cloud.openaiBaseUrl, key: config.cloud.openaiApiKey },
  ];
  for (const candidate of candidates) {
    if (candidate.key && sameEndpoint(config.aiPass.baseUrl, candidate.baseUrl)) {
      return { key: candidate.key, source: candidate.source };
    }
  }
  return { key: "", source: null };
}

/** Ключ облачного движка: свой либо от ИИ-прохода с тем же адресом. */
export function resolveProviderKey(
  config: VoiceConfig,
  provider: "groq" | "openai" | "google",
): { key: string; source: KeySource } {
  const own =
    provider === "groq"
      ? config.cloud.groqApiKey
      : provider === "openai"
        ? config.cloud.openaiApiKey
        : config.cloud.googleApiKey;
  if (own) {
    return { key: own, source: "own" };
  }
  const baseUrl =
    provider === "groq"
      ? config.cloud.groqBaseUrl
      : provider === "openai"
        ? config.cloud.openaiBaseUrl
        : config.cloud.googleBaseUrl;
  if (config.aiPass.apiKey && sameEndpoint(config.aiPass.baseUrl, baseUrl)) {
    return { key: config.aiPass.apiKey, source: "aiPass" };
  }
  return { key: "", source: null };
}
