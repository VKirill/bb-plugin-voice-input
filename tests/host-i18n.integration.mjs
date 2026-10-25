import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { experimental_createHostEntryHarness } from "@get-bb/plugin-sdk/testing/host";
import entry from "../dist/host.js";
import { dictionary, UI_LANGUAGES } from "../src/i18n/index.ts";
import { DEFAULT_SETTINGS } from "../src/settings-store.ts";

async function withHost(run) {
  const root = await mkdtemp(join(tmpdir(), "voice-i18n-"));
  const dataDir = join(root, "data");
  await mkdir(dataDir);
  const h = experimental_createHostEntryHarness(entry, {
    experimental_paths: { dataDir, tempDir: join(root, "temp") },
  });
  const config = {
    ...DEFAULT_SETTINGS,
    engine: "groq", machine: "", whisperModel: "mlx-community/whisper-large-v3-turbo",
    cloud: { openaiBaseUrl: "https://api.openai.com/v1", openaiModel: "test", openaiApiKey: "", openaiKeyEnv: "", googleBaseUrl: "https://generativelanguage.googleapis.com", googleModel: "test", googleApiKey: "", googleKeyEnv: "", groqBaseUrl: "https://api.groq.com/openai/v1", groqModel: "test", groqApiKey: "", groqKeyEnv: "" },
    aiPass: { enabled: false, baseUrl: "", model: "", apiKey: "", keyEnv: "" },
    saveRecordings: false,
  };
  // Host configuration contains a different subset than the settings store.
  for (const key of Object.keys(config)) {
    if (!(key in entry.contract.applyConfig.input.shape.config.shape)) delete config[key];
  }
  try { await run(h, config, dataDir); }
  finally { await h.experimental_dispose(); await rm(root, { recursive: true, force: true }); }
}

test("all cloud engines return localized errors through the built host contract", async () => {
  await withHost(async (h, config, dataDir) => {
    for (const engine of ["groq", "openai", "google"]) {
      config.engine = engine;
      config.uiLanguage = "en";
      await h.experimental_call("applyConfig", { config });
      for (const uiLanguage of UI_LANGUAGES) {
        const result = await h.experimental_call("transcribeDirect", { audioBase64: "YQ==", mimeType: "audio/webm", uiLanguage });
        assert.equal(result.ok, false);
        assert.equal(result.error, dictionary(uiLanguage).errors.keyRequired({ groq: "Groq", openai: "OpenAI", google: "Google" }[engine]));
      }
      assert.equal(JSON.parse(await readFile(join(dataDir, "config.json"), "utf8")).uiLanguage, "en");
    }
  });
});

test("older stored configuration preserves engine and vocabulary and defaults errors to English", async () => {
  await withHost(async (h, config, dataDir) => {
    delete config.uiLanguage;
    config.vocabulary = "Claude Code, BB";
    await writeFile(join(dataDir, "config.json"), JSON.stringify(config));
    const result = await h.experimental_call("transcribeDirect", { audioBase64: "YQ==", mimeType: "audio/webm" });
    assert.equal(result.error, dictionary("en").errors.keyRequired("Groq"));
    const saved = JSON.parse(await readFile(join(dataDir, "config.json"), "utf8"));
    assert.equal(saved.vocabulary, "Claude Code, BB");
    assert.equal(saved.engine, "groq");
  });
});

test("cloud setup and model messages honor request language", async () => {
  await withHost(async (h) => {
    for (const uiLanguage of UI_LANGUAGES) {
      assert.equal((await h.experimental_call("setup", { engine: "groq", reinstall: false, uiLanguage })).detail, dictionary(uiLanguage).system.cloudSetup);
      assert.equal((await h.experimental_call("downloadModel", { engine: "groq", uiLanguage })).detail, dictionary(uiLanguage).system.cloudNoModel);
    }
  });
});

test("missing environment key is localized for direct, file and BB voice-service calls", async () => {
  await withHost(async (h, config, dataDir) => {
    config.uiLanguage = "pt";
    config.cloud.groqKeyEnv = "VOICE_I18N_TEST_MISSING_KEY_92B8";
    await h.experimental_call("applyConfig", { config });
    const expected = dictionary("pt").errors.keyEnvMissing(config.cloud.groqKeyEnv);
    const audio = { audioBase64: "YQ==", mimeType: "audio/webm", filename: "recording.webm" };
    assert.equal((await h.experimental_call("transcribeDirect", audio)).error, expected);
    const service = await h.experimental_call("ai.voice.transcribe", {
      ...audio, model: "groq", prompt: null, serviceId: "local-voice", timeoutMs: 1000,
    });
    assert.equal(service.message, expected);
    const path = join(dataDir, "recording.webm");
    await writeFile(path, "fake audio: key validation happens before any provider call");
    await assert.rejects(h.experimental_call("transcribeFile", { path, timeoutMs: 1000 }), (error) => {
      assert.ok(error.message.includes(expected));
      return true;
    });
  });
});
