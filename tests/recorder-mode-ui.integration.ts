import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { JSDOM } from "jsdom";
import { mountRecorderLifecycle } from "../src/frontend/recorder-lifecycle.ts";
import {
  getDictationSettings, publishDictationSettings, resetDictationSettings,
} from "../src/frontend/dictation-settings.ts";
import { globalVoiceSession } from "../src/frontend/global-voice-session.ts";

function setup(t: TestContext) {
  const dom = new JSDOM(`<!doctype html><html lang="en"><body><form data-promptbox>
    <textarea></textarea><button type="button" data-promptbox-voice-trigger aria-label="Start voice input">Mic</button>
    </form></body></html>`, { url: "https://bb.test/threads/thr_mode" });
  const restore: Array<() => void> = [];
  for (const name of ["window", "document", "navigator", "Node", "Element", "HTMLElement", "HTMLInputElement", "HTMLTextAreaElement", "MutationObserver", "Event", "CustomEvent", "AbortController", "AbortSignal"]) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { value: name === "window" ? dom.window : (dom.window as any)[name], configurable: true });
    restore.push(() => previous ? Object.defineProperty(globalThis, name, previous) : Reflect.deleteProperty(globalThis, name));
  }
  for (const [name, value] of Object.entries({ requestAnimationFrame: () => 1, cancelAnimationFrame: () => {} })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { value, configurable: true });
    restore.push(() => previous ? Object.defineProperty(globalThis, name, previous) : Reflect.deleteProperty(globalThis, name));
  }
  resetDictationSettings();
  let nativeClicks = 0;
  let pluginStarts = 0;
  const button = dom.window.document.querySelector("button")!;
  button.addEventListener("click", () => { nativeClicks += 1; });
  t.mock.method(globalVoiceSession, "startRecording", async () => { pluginStarts += 1; return true; });
  t.mock.method(Date, "now", () => 10_000);
  let dispose: (() => void) | undefined;
  t.after(() => {
    dispose?.();
    resetDictationSettings();
    dom.window.close();
    for (const reset of restore.reverse()) reset();
  });
  return {
    button, nativeClicks: () => nativeClicks, pluginStarts: () => pluginStarts,
    mount: (signal?: AbortSignal) => { dispose = mountRecorderLifecycle({ signal }); return dispose; },
  };
}

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

test("legacy server settings mount the plugin recorder rather than changing its default", async (t) => {
  const h = setup(t);
  t.mock.method(globalThis, "fetch", async () => Response.json({ uiLanguage: "en", settings: {} }));
  h.mount();
  await settle();
  h.button.click();
  assert.equal(h.pluginStarts(), 1);
  assert.equal(h.nativeClicks(), 0);
});

test("confirmed recorder changes switch interception off and back on exactly once", async (t) => {
  const h = setup(t);
  t.mock.method(globalThis, "fetch", async () => Response.json({ uiLanguage: "en", settings: { recorderMode: "native" } }));
  h.mount();
  await settle();
  h.button.click();
  assert.equal(h.nativeClicks(), 1);
  publishDictationSettings({ recorderMode: "plugin" });
  h.button.click();
  assert.equal(h.pluginStarts(), 1);
  publishDictationSettings({ recorderMode: "native" });
  h.button.click();
  assert.equal(h.nativeClicks(), 2);
  assert.equal(h.pluginStarts(), 1);
});

test("a late initial response cannot override confirmed mode settings", async (t) => {
  const h = setup(t);
  let respond!: (value: Response) => void;
  t.mock.method(globalThis, "fetch", async (url) => String(url).endsWith("/state")
    ? await new Promise<Response>((resolve) => { respond = resolve; }) : Response.json({ uiLanguage: "en" }));
  h.mount();
  publishDictationSettings({ recorderMode: "native" });
  respond(Response.json({ settings: { recorderMode: "plugin" } }));
  await settle();
  h.button.click();
  assert.equal(h.nativeClicks(), 1);
  assert.equal(h.pluginStarts(), 0);
});

test("failed settings load and late responses after disposal cannot mount an interceptor", async (t) => {
  const h = setup(t);
  let respond!: (value: Response) => void;
  t.mock.method(globalThis, "fetch", async (url) => String(url).endsWith("/state")
    ? await new Promise<Response>((resolve) => { respond = resolve; }) : Response.json({ uiLanguage: "en" }));
  const dispose = h.mount();
  dispose();
  respond(Response.json({ settings: { recorderMode: "plugin" } }));
  await settle();
  h.button.click();
  assert.equal(h.nativeClicks(), 1);
  assert.equal(h.pluginStarts(), 0);
  assert.equal(getDictationSettings().ready, false);
});

test("switching to native releases a microphone stream obtained by an old plugin request", async (t) => {
  const h = setup(t);
  t.mock.method(globalThis, "fetch", async () => Response.json({ uiLanguage: "en", settings: { recorderMode: "plugin" } }));
  // Exercise a separate real session; lifecycle invalidation is shared by generation.
  const { GlobalVoiceSession } = await import("../src/frontend/global-voice-session.ts");
  const session = new GlobalVoiceSession();
  let resolve!: (stream: MediaStream) => void;
  Object.assign(navigator, { mediaDevices: { getUserMedia: () => new Promise<MediaStream>((yes) => { resolve = yes; }) } });
  h.mount();
  await settle();
  const starting = session.startRecording({ kind: "new-thread" });
  publishDictationSettings({ recorderMode: "native" });
  let stopped = 0;
  resolve({ getTracks: () => [{ stop() { stopped += 1; } }] } as unknown as MediaStream);
  assert.equal(await starting, false);
  assert.equal(stopped, 1);
});

test("switching to native discards a late plugin transcription", async (t) => {
  const h = setup(t);
  t.mock.method(globalThis, "fetch", async () => Response.json({ uiLanguage: "en", settings: { recorderMode: "plugin" } }));
  h.mount();
  await settle();
  const { GlobalVoiceSession } = await import("../src/frontend/global-voice-session.ts");
  const session = new GlobalVoiceSession();
  Object.assign(session, {
    snapshot: { ...session.getSnapshot(), state: "recording", target: { kind: "new-thread" } },
    recordedChunks: [new Blob(["synthetic-audio"])], startedAtMs: Date.now() - 1000,
  });
  const previous = Object.getOwnPropertyDescriptor(globalThis, "FileReader");
  Object.defineProperty(globalThis, "FileReader", { configurable: true, value: class {
    result = "data:audio/webm;base64,YQ==";
    onloadend: (() => void) | null = null;
    readAsDataURL() { this.onloadend?.(); }
  } });
  t.after(() => previous ? Object.defineProperty(globalThis, "FileReader", previous) : Reflect.deleteProperty(globalThis, "FileReader"));
  let deliver = 0;
  (session as any).deliverTranscript = () => { deliver += 1; };
  let resolve!: (value: { ok: boolean; text: string; error: null }) => void;
  let requested!: () => void;
  const entered = new Promise<void>((yes) => { requested = yes; });
  const pending = session.stopAndTranscribe(async () => {
    requested();
    return await new Promise((yes) => { resolve = yes; });
  });
  await entered;
  publishDictationSettings({ recorderMode: "native" });
  resolve({ ok: true, text: "old text", error: null });
  await pending;
  assert.equal(deliver, 0);
});

test("changing recorder or AI mode invalidates an in-flight manual improvement", async (t) => {
  const h = setup(t);
  t.mock.method(globalThis, "fetch", async () => Response.json({ uiLanguage: "en", settings: {
    recorderMode: "plugin", aiPassEnabled: true, aiPassTrigger: "manual", aiPassMode: "terms",
  } }));
  h.mount();
  await settle();
  const { manualImprovement } = await import("../src/frontend/manual-improvement.ts");
  const composer = {
    key: "mode-change", scope: { kind: "thread", threadId: "thr_mode" },
    draft: { text: "original", mentions: [], attachments: [] },
    replace: () => { throw new Error("Old improvement must not replace a draft"); },
  } as any;
  manualImprovement.rememberNative(composer, 0, 8);
  let resolve!: (value: string) => void;
  const pending = manualImprovement.improve(composer, () => new Promise((yes) => { resolve = yes; }));
  publishDictationSettings({ recorderMode: "plugin", aiPassEnabled: true, aiPassTrigger: "manual", aiPassMode: "intent" });
  resolve("edited");
  await pending;
  assert.equal(manualImprovement.get(composer.key), undefined);
  assert.equal(composer.draft.text, "original");
});
