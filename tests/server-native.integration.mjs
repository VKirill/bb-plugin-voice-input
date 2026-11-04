import assert from "node:assert/strict";
import { test } from "node:test";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { createFakePluginHost, makeHostResponse } from "@get-bb/plugin-sdk/testing";
import plugin from "../dist/server.js";
import { nativeTranscriptReceipt } from "../src/native-transcript.ts";

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

test("native BB service dispatches the same audio contract and publishes only a digest receipt when opted in", async () => {
  await withServer(async ({ harness, service, calls }) => {
    const result = await service.transcribe(nativeAudio(), serviceOptions());
    assert.equal(result, "фаст апи\nможно");
    const call = calls.find((item) => item.method === "transcribeDirect");
    assert.equal(Buffer.from(call.input.audioBase64, "base64").toString(), "native audio bytes");
    assert.equal(call.input.prompt, "technical terms");
    assert.equal(call.input.mimeType, "audio/webm");
    assert.equal(call.input.filename, "recording.webm");
    const receipt = harness.inspection.realtimeSignals.find((item) => item.channel === "native-transcript").payload;
    assert.deepEqual(receipt, await nativeTranscriptReceipt(receipt.id, result));
    assert.deepEqual(Object.keys(receipt).sort(), ["hash", "id", "length"]);
    assert.equal(receipt.hash.length, 64);
    assert.equal(receipt.length, "фаст апи можно".length);
  }, { recorderMode: "native", aiPassEnabled: true, aiPassTrigger: "manual" });
});

test("registered voice service keeps working in default plugin mode without native receipts", async () => {
  await withServer(async ({ harness, service, calls }) => {
    assert.equal(await service.transcribe(nativeAudio(), serviceOptions()), "фаст апи\nможно");
    assert.equal(calls.filter((item) => item.method === "transcribeDirect").length, 1);
    assert.equal(harness.inspection.realtimeSignals.filter((item) => item.channel === "native-transcript").length, 0);
  });
});

test("native receipt tracking requires enabled manual AI processing", async () => {
  for (const settings of [
    { recorderMode: "native", aiPassEnabled: false, aiPassTrigger: "manual" },
    { recorderMode: "native", aiPassEnabled: true, aiPassTrigger: "automatic" },
    { recorderMode: "native", aiPassEnabled: true },
    { recorderMode: "plugin", aiPassEnabled: true, aiPassTrigger: "manual" },
  ]) {
    await withServer(async ({ harness, service }) => {
      assert.equal(await service.transcribe(nativeAudio(), serviceOptions()), "фаст апи\nможно");
      assert.equal(harness.inspection.realtimeSignals.filter((item) => item.channel === "native-transcript").length, 0);
    }, settings);
  }
});

test("native receipts check fresh settings after transcription completes", async () => {
  await withServer(async ({ bb, harness, service, transcribeWith }) => {
    let release;
    let dispatched;
    const completion = new Promise((resolve) => { release = resolve; });
    const started = new Promise((resolve) => { dispatched = resolve; });
    transcribeWith(async () => {
      dispatched();
      await completion;
      return { ok: true, text: "фаст апи", error: null };
    });
    const result = service.transcribe(nativeAudio(), serviceOptions());
    await started;
    await bb.storage.kv.set("settings", { recorderMode: "native", aiPassEnabled: false, aiPassTrigger: "manual" });
    release();
    assert.equal(await result, "фаст апи");
    assert.equal(harness.inspection.realtimeSignals.filter((item) => item.channel === "native-transcript").length, 0);
  }, { recorderMode: "native", aiPassEnabled: true, aiPassTrigger: "manual" });
});

test("plugin transcribeAudio returns raw text for manual fragments without publishing it", async () => {
  await withServer(async ({ harness, calls }) => {
    const result = await harness.behavior.callRpc("transcribeAudio", { audioBase64: "YQ==", mimeType: "audio/webm" });
    assert.deepEqual(result, { ok: true, text: "фаст апи\nможно", rawText: "фаст апи можно", error: null });
    assert.equal(calls.filter((item) => item.method === "transcribeDirect").length, 1);
    assert.equal(harness.inspection.realtimeSignals.length, 0);
  }, { recorderMode: "native", aiPassEnabled: true, aiPassTrigger: "manual" });
});

test("Improve RPC dispatches to the selected host and reports host failures", async () => {
  await withServer(async ({ harness, calls, failImprove }) => {
    const result = await harness.behavior.callRpc("improveText", { text: "можно фаст апи" });
    assert.deepEqual(result, { ok: true, text: "Можно FastAPI?", error: null });
    const call = calls.find((item) => item.method === "improveText");
    assert.equal(call.hostId, "host_native_test");
    assert.deepEqual(call.input, { text: "можно фаст апи" });
    failImprove();
    const failed = await harness.behavior.callRpc("improveText", { text: "можно фаст апи" });
    assert.equal(failed.ok, false);
    assert.equal(failed.text, "");
    assert.match(failed.error, /Synthetic editor failure/u);
    assert.equal(harness.inspection.realtimeSignals.length, 0);
  }, { machine: "native-test" });
});

test("recorder mode is stored server-side and never forwarded in host voice configuration", async () => {
  await withServer(async ({ bb, harness, service, calls }) => {
    await harness.behavior.callRpc("updateSettings", { recorderMode: "native" });
    const stored = await bb.storage.kv.get("settings");
    assert.equal(stored.recorderMode, "native");
    const config = calls.find((item) => item.method === "applyConfig").input.config;
    assert.equal(config.aiPass.trigger, "automatic");
    assert.equal(config.aiPass.mode, "terms");
    assert.equal(config.aiPass.prompt, "");
    assert.ok(!("recorderMode" in config));
    await harness.behavior.callRpc("updateSettings", { aiPassEnabled: true, aiPassTrigger: "manual" });
    await service.transcribe(nativeAudio(), serviceOptions());
    assert.equal(harness.inspection.realtimeSignals.filter((item) => item.channel === "native-transcript").length, 1);
    await harness.behavior.callRpc("updateSettings", { recorderMode: "plugin" });
    await service.transcribe(nativeAudio(), serviceOptions());
    assert.equal(harness.inspection.realtimeSignals.filter((item) => item.channel === "native-transcript").length, 1);
  });
});

test("native receipt normalization matches the native recorder's whitespace handling", async () => {
  const spaced = await nativeTranscriptReceipt("same", "  фаст\tапи\n можно  ");
  assert.deepEqual(spaced, await nativeTranscriptReceipt("same", "фаст апи можно"));
});
