import assert from "node:assert/strict";
import { test } from "node:test";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { createFakePluginHost, makeHostResponse } from "@get-bb/plugin-sdk/testing";
import plugin from "../dist/server.js";

async function withServer(run, settings = {}) {
  const host = makeHostResponse({ id: "host_native_test", name: "native-test", status: "connected" });
  const calls = [];
  let failImprove = false;
  let transcribe = async () => ({ ok: true, text: "фаст апи\nможно", rawText: "фаст апи можно", error: null });
  const { bb, harness } = createFakePluginHost({
    pluginId: "voice-input", dataDir: join(tmpdir(), "voice-native-test"),
    sdk: { hosts: { list: async () => [host] } },
    experimental_callHostRpc: async (call) => {
      calls.push(call);
      if (call.method === "identify") return { hostname: hostname(), platform: "linux" };
      if (call.method === "applyConfig") return { applied: true };
      if (call.method === "transcribeDirect") return await transcribe();
      if (call.method === "improveText") {
        if (failImprove) throw new Error("Synthetic editor failure");
        return { ok: true, text: "Можно FastAPI?", error: null };
      }
      throw new Error(`Unexpected host call: ${call.method}`);
    },
  });
  try {
    await bb.storage.kv.set("settings", settings);
    await plugin(bb);
    const service = harness.inspection.registrations.aiServiceRegistrations.find((item) => item.id === "local-voice");
    assert.ok(service?.transcribe);
    await run({ bb, harness, service, calls, failImprove: () => { failImprove = true; }, transcribeWith: (handler) => { transcribe = handler; } });
  } finally { await harness.lifecycle.dispose(); }
}

function nativeAudio() {
  return new File(["native audio bytes"], "recording.webm", { type: "audio/webm" });
}

const serviceOptions = () => ({ hint: "technical terms", signal: new AbortController().signal });

test("registered voice service forwards audio through the configured host", async () => {
  await withServer(async ({ service, calls, harness }) => {
    assert.equal(await service.transcribe(nativeAudio(), serviceOptions()), "фаст апи\nможно");
    const call = calls.find((item) => item.method === "transcribeDirect");
    assert.equal(Buffer.from(call.input.audioBase64, "base64").toString(), "native audio bytes");
    assert.equal(call.input.prompt, "technical terms");
    assert.equal(call.input.mimeType, "audio/webm");
    assert.equal(harness.inspection.realtimeSignals.length, 0);
  });
});

test("transcribeAudio returns raw text without broadcasting it", async () => {
  await withServer(async ({ harness }) => {
    const result = await harness.behavior.callRpc("transcribeAudio", { audioBase64: "YQ==", mimeType: "audio/webm" });
    assert.equal(result.rawText, "фаст апи можно");
    assert.equal(result.ok, true);
    assert.equal(harness.inspection.realtimeSignals.length, 0);
  });
});

test("Improve RPC forwards fragment and UI language and preserves host failures", async () => {
  await withServer(async ({ harness, calls, failImprove }) => {
    const result = await harness.behavior.callRpc("improveText", { text: "фаст апи", uiLanguage: "ru" });
    assert.deepEqual(result, { ok: true, text: "Можно FastAPI?", error: null });
    const call = calls.find((item) => item.method === "improveText");
    assert.equal(call.hostId, "host_native_test");
    assert.deepEqual(call.input, { text: "фаст апи", uiLanguage: "ru" });
    failImprove();
    assert.equal((await harness.behavior.callRpc("improveText", { text: "фаст апи" })).ok, false);
  });
});

test("Improve rejects invalid input before host dispatch", async () => {
  await withServer(async ({ harness, calls }) => {
    for (const input of [{ text: "" }, { text: "x".repeat(50001) }, { text: "hello", uiLanguage: "unsupported" }]) {
      await assert.rejects(harness.behavior.callRpc("improveText", input));
    }
    assert.equal(calls.filter((item) => item.method === "improveText").length, 0);
  });
});

test("cloud engine with a catalog key transcribes on the server while the chosen machine is offline", async () => {
  const hostCalls = [];
  const requests = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), auth: init.headers.authorization, file: init.body.get("file") });
    return new Response(JSON.stringify({ text: "привет из облака" }), { status: 200 });
  };
  const { bb, harness } = createFakePluginHost({
    pluginId: "voice-input", dataDir: join(tmpdir(), "voice-cloud-test"),
    sdk: {
      hosts: { list: async () => [makeHostResponse({ id: "host_mini", name: "MAC Mini", status: "disconnected" })] },
      plugins: {
        callRpc: async ({ pluginId, method, input }) => {
          assert.equal(pluginId, "env-catalog");
          assert.equal(method, "env_get_value");
          assert.equal(input.name, "GROQ_API_KEY");
          return { value: "gsk_test" };
        },
      },
    },
    experimental_callHostRpc: async (call) => {
      hostCalls.push(call.method);
      throw new Error("Host is not connected");
    },
  });
  try {
    await bb.storage.kv.set("settings", { engine: "groq", machine: "host_mini", groqKeyCatalog: "GROQ_API_KEY" });
    await plugin(bb);
    const result = await harness.behavior.callRpc("transcribeAudio", {
      audioBase64: Buffer.from("cloud audio").toString("base64"),
      mimeType: "audio/webm;codecs=opus",
    });
    assert.deepEqual(result, { ok: true, text: "привет из облака", rawText: "привет из облака", error: null });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, "https://api.groq.com/openai/v1/audio/transcriptions");
    assert.equal(requests[0].auth, "Bearer gsk_test");
    assert.equal(requests[0].file.name, "recording.webm");
    assert.equal(requests[0].file.type, "audio/webm");
    assert.equal(hostCalls.filter((method) => method === "transcribeDirect").length, 0);
  } finally {
    globalThis.fetch = realFetch;
    await harness.lifecycle.dispose();
  }
});

test("CLI config reads and writes settings with no connected machine", async () => {
  const { bb, harness } = createFakePluginHost({
    pluginId: "voice-input", dataDir: join(tmpdir(), "voice-config-test"),
    sdk: { hosts: { list: async () => [] } },
    experimental_callHostRpc: async () => { throw new Error("Host is not connected"); },
  });
  try {
    await bb.storage.kv.set("settings", { machine: "host_mini" });
    await plugin(bb);
    const cli = harness.inspection.registrations.cli;
    assert.ok(cli?.run, "CLI registered");
    const set = await cli.run(["config", "groqKeyCatalog", "GROQ_API_KEY"], {});
    assert.equal(set.exitCode ?? 0, 0, set.stderr);
    assert.equal((await bb.storage.kv.get("settings")).groqKeyCatalog, "GROQ_API_KEY");
  } finally {
    await harness.lifecycle.dispose();
  }
});
