import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveAiPassKey, resolveProviderKey } from "../src/key-resolution.ts";
import type { VoiceConfig } from "../src/contract.ts";

function config(overrides: Partial<VoiceConfig["cloud"]>, aiPass: Partial<VoiceConfig["aiPass"]>) {
  return {
    cloud: {
      openaiBaseUrl: "https://api.openai.com/v1",
      openaiModel: "gpt-4o-transcribe",
      openaiApiKey: "",
      openaiKeyEnv: "",
      googleBaseUrl: "https://generativelanguage.googleapis.com",
      googleModel: "gemini-3.5-transcribe",
      googleApiKey: "",
      googleKeyEnv: "",
      groqBaseUrl: "https://api.groq.com/openai/v1",
      groqModel: "whisper-large-v3-turbo",
      groqApiKey: "",
      groqKeyEnv: "",
      ...overrides,
    },
    aiPass: {
      enabled: true,
      baseUrl: "https://api.groq.com/openai/v1",
      model: "openai/gpt-oss-120b",
      apiKey: "",
      keyEnv: "",
      ...aiPass,
    },
  } as VoiceConfig;
}

test("ИИ-проход берёт ключ провайдера с тем же адресом", () => {
  const resolved = resolveAiPassKey(config({ groqApiKey: "gsk-1" }, {}));
  assert.deepEqual(resolved, { key: "gsk-1", source: "groq" });
});

test("свой ключ ИИ-прохода важнее ключа провайдера", () => {
  const resolved = resolveAiPassKey(config({ groqApiKey: "gsk-1" }, { apiKey: "own" }));
  assert.deepEqual(resolved, { key: "own", source: "own" });
});

test("чужой адрес не отдаёт ключ", () => {
  const resolved = resolveAiPassKey(
    config({ groqApiKey: "gsk-1" }, { baseUrl: "https://example.com/v1" }),
  );
  assert.deepEqual(resolved, { key: "", source: null });
});

test("провайдер берёт ключ ИИ-прохода с тем же адресом", () => {
  const resolved = resolveProviderKey(config({}, { apiKey: "gsk-2" }), "groq");
  assert.deepEqual(resolved, { key: "gsk-2", source: "aiPass" });
});

test("завершающий слеш в адресе не мешает", () => {
  const resolved = resolveAiPassKey(
    config({ groqApiKey: "gsk-1", groqBaseUrl: "https://api.groq.com/openai/v1/" }, {}),
  );
  assert.equal(resolved.key, "gsk-1");
});

test("без ключей источника нет", () => {
  assert.deepEqual(resolveProviderKey(config({}, {}), "openai"), { key: "", source: null });
});
