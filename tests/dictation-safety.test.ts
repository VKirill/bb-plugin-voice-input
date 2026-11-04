import assert from "node:assert/strict";
import { test } from "node:test";
import { submitComposerWhenReady } from "../src/frontend/composer-insert.ts";
import { GlobalVoiceSession } from "../src/frontend/global-voice-session.ts";

type Globals = Record<string, unknown>;

function withGlobals(values: Globals): () => void {
  const saved = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries(values)) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }
  return () => {
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as Globals)[key];
    }
  };
}

// A composer whose draft text and location the test can change between submit attempts.
function fakeComposer(initial: { pathname: string; draft: string }) {
  const state = { ...initial, clicks: 0, buttonDisabled: false };
  const editor = { tagName: "DIV", text: () => state.draft };
  const button = {
    get disabled() {
      return state.buttonDisabled;
    },
    click: () => {
      state.clicks += 1;
    },
  };
  const restore = withGlobals({
    HTMLTextAreaElement: class {},
    HTMLInputElement: class {},
    window: {
      location: {
        get pathname() {
          return state.pathname;
        },
      },
      setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
    },
    document: {
      querySelector: (selector: string) => (selector.includes("submit") ? button : editor),
      createRange: () => {
        let node: typeof editor | null = null;
        return {
          selectNodeContents: (target: typeof editor) => {
            node = target;
          },
          toString: () => node?.text() ?? "",
        };
      },
    },
  });
  return { state, restore };
}

test("auto-send does not submit a different thread's draft after switching threads", async () => {
  const { state, restore } = fakeComposer({ pathname: "/threads/a", draft: "yes please" });
  try {
    state.buttonDisabled = true;
    const sent = submitComposerWhenReady("yes please", { pathname: "/threads/a", timeoutMs: 500 });
    // Thread B also has "yes" in its unsent draft.
    state.pathname = "/threads/b";
    state.draft = "yes please, but first rewrite everything";
    state.buttonDisabled = false;
    assert.equal(await sent, false);
    assert.equal(state.clicks, 0);
  } finally {
    restore();
  }
});

test("auto-send only submits the exact draft the transcript went into", async () => {
  const { state, restore } = fakeComposer({ pathname: "/threads/a", draft: "yes, and something else" });
  try {
    assert.equal(await submitComposerWhenReady("yes", { pathname: "/threads/a", timeoutMs: 300 }), false);
    assert.equal(state.clicks, 0);
    state.draft = "fix  the\nbug ";
    assert.equal(await submitComposerWhenReady("fix the bug", { pathname: "/threads/a", timeoutMs: 300 }), true);
    assert.equal(state.clicks, 1);
  } finally {
    restore();
  }
});

test("a final transcription that resolves after cancel is not delivered", async () => {
  const restore = withGlobals({
    window: { clearInterval, setTimeout, location: { pathname: "/" } },
    FileReader: class {
      result: string | null = null;
      onloadend: (() => void) | null = null;
      onerror: (() => void) | null = null;
      readAsDataURL() {
        this.result = "data:audio/webm;base64,AAAA";
        queueMicrotask(() => this.onloadend?.());
      }
    },
  });
  try {
    const session = new GlobalVoiceSession();
    const internals = session as unknown as Record<string, any>;
    const delivered: string[] = [];
    internals.deliverTranscript = (text: string) => delivered.push(text);
    internals.updateSnapshot({ state: "recording", target: { kind: "new-thread", originPath: "/" } });
    internals.recordedChunks = [new Blob(["audio"])];
    internals.startedAtMs = Date.now() - 2000;

    let resolveTranscription: (value: unknown) => void = () => {};
    const pending = session.stopAndTranscribe(
      () => new Promise((resolve) => (resolveTranscription = resolve)),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    session.cancelRecording();
    resolveTranscription({ ok: true, text: "send this anyway", error: null });
    await pending;

    assert.deepEqual(delivered, []);
    assert.equal(session.getSnapshot().state, "idle");
  } finally {
    restore();
  }
});
