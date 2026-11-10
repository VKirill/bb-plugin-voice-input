import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { experimental_createHostEntryHarness } from "@get-bb/plugin-sdk/testing/host";
import entry from "../dist/host.js";

async function withHost(run) {
  const root = await mkdtemp("/tmp/vi-hint-test-");
  const dataDir = join(root, "data");
  await mkdir(dataDir);
  const harness = experimental_createHostEntryHarness(entry, {
    experimental_paths: { dataDir, tempDir: join(root, "temp") },
  });
  const config = {
    engine: "groq", machine: "", whisperModel: "unused", language: "auto", uiLanguage: "en",
    vocabulary: "", vocabularyRepair: true, vocabularyPrompt: true,
    cleanupFillers: true, cleanupQuotes: true, saveRecordings: false, keepDays: 14,
    cloud: {
      groqBaseUrl: "https://stt.example.test/v1", groqModel: "test-stt", groqApiKey: "test-stt-key", groqKeyEnv: "",
      openaiBaseUrl: "https://openai.example.test/v1", openaiModel: "unused", openaiApiKey: "", openaiKeyEnv: "",
      googleBaseUrl: "https://google.example.test", googleModel: "unused", googleApiKey: "", googleKeyEnv: "",
    },
    aiPass: {
      enabled: false, trigger: "automatic", mode: "terms", prompt: "", baseUrl: "https://editor.example.test/v1",
      model: "test-editor", apiKey: "test-editor-key", keyEnv: "",
    },
  };
  try { await run(harness, config, dataDir); }
  finally { await harness.experimental_dispose(); await rm(root, { recursive: true, force: true }); }
}

test("composer text and BB hint never reach the API; only the vocabulary does", async (t) => {
  await withHost(async (h, config) => {
    let sentHasPrompt;
    let sentPrompt;
    t.mock.method(globalThis, "fetch", async (url, init) => {
      assert.equal(url, "https://stt.example.test/v1/audio/transcriptions");
      sentHasPrompt = init.body.has("prompt");
      sentPrompt = init.body.get("prompt");
      return Response.json({ text: "привет мир" });
    });
    const call = () => h.experimental_call("transcribeDirect", {
      audioBase64: "dGVzdC1hdWRpbw==", mimeType: "audio/webm", filename: "t.webm",
      prompt: "текст из поля ввода ".repeat(10),
    });
    for (const [vocabulary, vocabularyPrompt, expected] of [
      ["", true, null],
      ["", false, null],
      ["DeepSeek, MLX", false, null],
      ["DeepSeek, MLX", true, "DeepSeek, MLX"],
    ]) {
      sentHasPrompt = undefined;
      sentPrompt = undefined;
      await h.experimental_call("applyConfig", { config: { ...config, vocabulary, vocabularyPrompt } });
      const result = await call();
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.equal(sentHasPrompt, expected !== null, `vocabulary=${JSON.stringify(vocabulary)} toggle=${vocabularyPrompt}`);
      assert.equal(sentPrompt, expected, `vocabulary=${JSON.stringify(vocabulary)} toggle=${vocabularyPrompt}`);
    }
  });
});
