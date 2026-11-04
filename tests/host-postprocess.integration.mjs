import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { experimental_createHostEntryHarness } from "@get-bb/plugin-sdk/testing/host";
import entry from "../dist/host.js";
import { cleanupText } from "../src/cleanup.ts";

async function withHost(run) {
  const root = await mkdtemp(join(tmpdir(), "voice-postprocess-"));
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
      enabled: true, trigger: "automatic", mode: "intent", prompt: "", baseUrl: "https://editor.example.test/v1",
      model: "test-editor", apiKey: "test-editor-key", keyEnv: "",
    },
  };
  try { await run(harness, config, dataDir); }
  finally { await harness.experimental_dispose(); await rm(root, { recursive: true, force: true }); }
}

function transcribe(harness) {
  return harness.experimental_call("transcribeDirect", {
    audioBase64: "dGVzdC1hdWRpbw==", mimeType: "audio/webm", filename: "test.webm",
  });
}

function editorResponse(content, finish_reason = "stop") {
  return Response.json({ choices: [{ finish_reason, message: { content } }] });
}

test("intent pipeline edits without vocabulary and sends the raw transcript before cleanup", async (t) => {
  await withHost(async (h, config) => {
    const raw = "ну можно фаст апи подключить к постгресу";
    const corrected = "Можно подключить FastAPI к PostgreSQL?";
    let edits = 0;
    t.mock.method(globalThis, "fetch", async (url, init) => {
      if (url === "https://stt.example.test/v1/audio/transcriptions") return Response.json({ text: raw });
      assert.equal(url, "https://editor.example.test/v1/chat/completions");
      const messages = JSON.parse(init.body).messages;
      assert.equal(JSON.parse(messages[1].content).transcript, raw);
      assert.deepEqual(JSON.parse(messages[1].content).vocabulary, []);
      edits += 1;
      return editorResponse(corrected);
    });
    await h.experimental_call("applyConfig", { config });
    const result = await transcribe(h);
    assert.equal(result.ok, true);
    assert.equal(result.text, corrected);
    assert.equal(result.rawText, raw);
    assert.equal(edits, 1);
  });
});

test("intent editing sees original words before heuristic vocabulary replacement", async (t) => {
  await withHost(async (h, config) => {
    const raw = "ну проверь Mail X";
    config.vocabulary = "MLX";
    t.mock.method(globalThis, "fetch", async (url, init) => {
      if (url === "https://stt.example.test/v1/audio/transcriptions") return Response.json({ text: raw });
      assert.equal(url, "https://editor.example.test/v1/chat/completions");
      assert.deepEqual(JSON.parse(JSON.parse(init.body).messages[1].content), { vocabulary: ["MLX"], transcript: raw });
      return editorResponse("Проверь MLX.");
    });
    await h.experimental_call("applyConfig", { config });
    assert.equal((await transcribe(h)).text, "Проверь MLX.");
  });
});

test("terms-only mode still applies the word guard and skips editing with an empty vocabulary", async (t) => {
  await withHost(async (h, config) => {
    config.aiPass.mode = "terms";
    config.vocabulary = "DeepSeek";
    let edits = 0;
    t.mock.method(globalThis, "fetch", async (url) => {
      if (url === "https://stt.example.test/v1/audio/transcriptions") return Response.json({ text: "открывает винишко" });
      assert.equal(url, "https://editor.example.test/v1/chat/completions");
      edits += 1;
      return editorResponse("открывает винилшко");
    });
    await h.experimental_call("applyConfig", { config });
    assert.equal((await transcribe(h)).text, "открывает винишко");
    config.vocabulary = "";
    await h.experimental_call("applyConfig", { config });
    assert.equal((await transcribe(h)).text, "открывает винишко");
    assert.equal(edits, 1);
  });
});

test("failed or truncated automatic editing keeps the full ordinary-cleanup transcript", async (t) => {
  await withHost(async (h, config) => {
    let truncated = false;
    t.mock.method(globalThis, "fetch", async (url) => {
      if (url === "https://stt.example.test/v1/audio/transcriptions") return Response.json({ text: "ну привет как дела" });
      assert.equal(url, "https://editor.example.test/v1/chat/completions");
      return truncated ? editorResponse("обрыв", "length") : new Response("unavailable", { status: 503 });
    });
    await h.experimental_call("applyConfig", { config });
    const failed = await transcribe(h);
    assert.equal(failed.ok, true);
    assert.equal(failed.text, cleanupText("ну привет как дела", { fillers: true, quotes: true, language: "auto" }));
    truncated = true;
    assert.equal((await transcribe(h)).text, failed.text);
  });
});

test("disabled AI editing makes no text-model request", async (t) => {
  await withHost(async (h, config) => {
    config.aiPass.enabled = false;
    t.mock.method(globalThis, "fetch", async (url) => {
      assert.equal(url, "https://stt.example.test/v1/audio/transcriptions");
      return Response.json({ text: "привет" });
    });
    await h.experimental_call("applyConfig", { config });
    assert.equal((await transcribe(h)).text, "привет");
  });
});

test("manual mode returns STT with ordinary cleanup and only edits on explicit request", async (t) => {
  await withHost(async (h, config) => {
    config.aiPass.trigger = "manual";
    const raw = "ну можно фаст апи";
    let sttCalls = 0;
    let editorCalls = 0;
    t.mock.method(globalThis, "fetch", async (url, init) => {
      if (url === "https://stt.example.test/v1/audio/transcriptions") {
        sttCalls += 1;
        return Response.json({ text: raw });
      }
      assert.equal(url, "https://editor.example.test/v1/chat/completions");
      editorCalls += 1;
      assert.equal(JSON.parse(JSON.parse(init.body).messages[1].content).transcript, raw);
      return editorResponse("Можно FastAPI?");
    });
    await h.experimental_call("applyConfig", { config });
    const result = await transcribe(h);
    assert.equal(result.ok, true);
    assert.equal(result.text, cleanupText(raw, { fillers: true, quotes: true, language: "auto" }));
    assert.equal(result.rawText, raw);
    assert.equal(editorCalls, 0);
    const edited = await h.experimental_call("improveText", { text: result.rawText });
    assert.deepEqual(edited, { ok: true, text: "Можно FastAPI?", error: null });
    assert.equal(editorCalls, 1);
    assert.equal(sttCalls, 1);
  });
});

test("explicit terms editing uses the same cleanup and vocabulary guard as automatic editing", async (t) => {
  await withHost(async (h, config) => {
    config.aiPass.mode = "terms";
    config.aiPass.trigger = "manual";
    config.vocabulary = "DeepSeek";
    const cleaned = cleanupText("ну открывает винишко", { fillers: true, quotes: true, language: "auto" });
    t.mock.method(globalThis, "fetch", async (url, init) => {
      assert.equal(url, "https://editor.example.test/v1/chat/completions");
      assert.equal(JSON.parse(JSON.parse(init.body).messages[1].content).transcript, cleaned);
      return editorResponse(cleaned.replace("винишко", "винилшко"));
    });
    await h.experimental_call("applyConfig", { config });
    assert.deepEqual(await h.experimental_call("improveText", { text: "ну открывает винишко" }), { ok: true, text: cleaned, error: null });
  });
});

test("manual editing reports failures rather than fake successful rewrites", async (t) => {
  await withHost(async (h, config) => {
    let truncated = false;
    t.mock.method(globalThis, "fetch", async (url) => {
      assert.equal(url, "https://editor.example.test/v1/chat/completions");
      return truncated ? editorResponse("обрыв", "length") : new Response("unavailable", { status: 503 });
    });
    await h.experimental_call("applyConfig", { config });
    const failed = await h.experimental_call("improveText", { text: "исходный текст" });
    assert.equal(failed.ok, false);
    assert.equal(failed.text, "");
    assert.match(failed.error, /503/u);
    truncated = true;
    const partial = await h.experimental_call("improveText", { text: "исходный текст" });
    assert.equal(partial.ok, false);
    assert.equal(partial.text, "");
  });
});

test("explicit editing requires AI to be enabled and a model and key to be configured", async (t) => {
  await withHost(async (h, config) => {
    t.mock.method(globalThis, "fetch", async () => { throw new Error("Must not call API"); });
    for (const patch of [{ enabled: false }, { model: "" }, { model: " " }, { apiKey: "" }]) {
      await h.experimental_call("applyConfig", { config: { ...config, aiPass: { ...config.aiPass, ...patch } } });
      const result = await h.experimental_call("improveText", { text: "исходный текст" });
      assert.equal(result.ok, false);
      assert.equal(result.text, "");
      assert.match(result.error, /Configure and enable/u);
    }
  });
});

test("legacy host settings without AI fields retain automatic terms-only processing", async (t) => {
  await withHost(async (h, config, dataDir) => {
    delete config.aiPass.trigger;
    delete config.aiPass.mode;
    delete config.aiPass.prompt;
    config.vocabulary = "FastAPI";
    config.vocabularyRepair = false;
    await writeFile(join(dataDir, "config.json"), JSON.stringify(config));
    let edits = 0;
    t.mock.method(globalThis, "fetch", async (url, init) => {
      if (url === "https://stt.example.test/v1/audio/transcriptions") return Response.json({ text: "можно фаст апи" });
      assert.equal(url, "https://editor.example.test/v1/chat/completions");
      assert.match(JSON.parse(init.body).messages[0].content, /Change nothing else/u);
      edits += 1;
      return editorResponse("можно FastAPI");
    });
    assert.equal((await transcribe(h)).text, "можно FastAPI");
    assert.equal(edits, 1);
  });
});
