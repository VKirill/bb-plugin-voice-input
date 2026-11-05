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
