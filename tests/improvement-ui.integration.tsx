import { registerHooks } from "node:module";
registerHooks({ load(url, context, nextLoad) {
  if (url.endsWith(".css")) return { format: "module", source: "", shortCircuit: true };
  return nextLoad(url, context);
} });
import assert from "node:assert/strict";
import { test, beforeEach } from "node:test";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html lang='en'><body></body></html>", { url: "https://bb.test" });
for (const name of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLTextAreaElement", "MutationObserver", "Node", "NodeFilter", "Event", "CustomEvent", "StorageEvent", "PopStateEvent"]) {
  Object.defineProperty(globalThis, name, { value: (dom.window as any)[name], configurable: true });
}
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { value: true, writable: true });
const React = await import("react");
const { act, fireEvent, cleanup, waitFor } = await import("@testing-library/react");
const { renderSlot, loadPluginApp, mountPluginContentScripts } = await import("@get-bb/plugin-sdk/testing/app");
const { useComposer } = await import("@get-bb/plugin-sdk/app");
const { ImprovementAction, ImprovementBanner } = await import("../src/frontend/improvement-actions.tsx");
const { manualImprovement } = await import("../src/frontend/manual-improvement.ts");
const { GlobalVoiceSession } = await import("../src/frontend/global-voice-session.ts");
const { publishDictationSettings, resetDictationSettings } = await import("../src/frontend/dictation-settings.ts");
beforeEach(() => publishDictationSettings({ aiPassEnabled: true, aiPassTrigger: "manual" }));

let current: ReturnType<typeof useComposer>;
function Surface() {
  current = useComposer();
  return <><ImprovementAction /><ImprovementBanner /></>;
}

test("registered composer UI inserts dictation, improves only the fragment, and undoes without losing attachments", async (t) => {
  t.after(() => { cleanup(); manualImprovement.dispose(); });
  const slot = renderSlot({ component: Surface }, {}, {
    pluginId: "voice-input", composer: {
      text: "Keep this. ", scope: { kind: "thread", threadId: "thr_ui" },
      attachments: [{ type: "localFile", path: "/data/note.txt", name: "note.txt" }],
    },
  });
  await act(async () => {
    assert.equal(manualImprovement.insertDictation("thread:thr_ui", "фаст апи", "фаст апи"), true);
  });
  let requests = 0;
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(String(url), "/api/v1/plugins/voice-input/rpc/improveText");
    assert.deepEqual(JSON.parse(String(init?.body)), { text: "фаст апи", uiLanguage: "en" });
    requests += 1;
    return Response.json({ result: { ok: true, text: "FastAPI", error: null } });
  });
  await act(async () => fireEvent.click(slot.getByRole("button", { name: "Improve", exact: true })));
  await waitFor(() => assert.equal(current.draft.text, "Keep this. фаст апи".replace("фаст апи", "FastAPI")));
  assert.equal(current.draft.attachments.length, 1);
  assert.equal(requests, 1);
  await act(async () => fireEvent.click(slot.getByRole("button", { name: "Undo improvement" })));
  assert.equal(current.draft.text, "Keep this. фаст апи");
});

test("plugin transcription delivers through the registered composer and tracks its raw fragment", async (t) => {
  t.after(() => { cleanup(); manualImprovement.dispose(); document.body.replaceChildren(); });
  window.history.replaceState(null, "", "/threads/thr_plugin_delivery");
  renderSlot({ component: Surface }, {}, {
    pluginId: "voice-input", composer: { text: "Keep.", scope: { kind: "thread", threadId: "thr_plugin_delivery" } },
  });
  const session = new GlobalVoiceSession();
  await act(async () => {
    (session as any).deliverTranscript("FastAPI", { kind: "thread", threadId: "thr_plugin_delivery" }, "фаст апи");
  });
  assert.equal(current.draft.text, "Keep. FastAPI");
  await act(async () => {
    await manualImprovement.improve(current, async (text) => {
      assert.equal(text, "фаст апи");
      return "FastAPI!";
    });
  });
  assert.equal(current.draft.text, "Keep. FastAPI!");
});

test("plugin manual delivery inserts at the saved offset without invoking cursor-selection replacement", async (t) => {
  t.after(() => { cleanup(); manualImprovement.dispose(); document.body.replaceChildren(); });
  window.history.replaceState(null, "", "/threads/thr_selection");
  const slot = renderSlot({ component: Surface }, {}, {
    pluginId: "voice-input", composer: {
      text: "Keep selected text", scope: { kind: "thread", threadId: "thr_selection" },
      attachments: [{ type: "localFile", path: "/data/note.txt", name: "note.txt" }],
    },
  });
  t.mock.method(current, "insert", () => { throw new Error("Cursor insertion could replace selected text"); });
  await act(async () => {
    manualImprovement.insertDictation("thread:thr_selection", "dictated", "dictated", 5);
  });
  assert.equal(current.draft.text, "Keep dictated selected text");
  assert.equal(current.draft.attachments.length, 1);
  await act(async () => { await manualImprovement.improve(current, async () => "improved"); });
  await act(async () => fireEvent.click(slot.getByRole("button", { name: "Undo improvement" })));
  assert.equal(current.draft.text, "Keep dictated selected text");
});

test("manual plugin delivery to an unmounted destination never inserts into a different chat", async (t) => {
  t.after(() => { cleanup(); manualImprovement.dispose(); document.body.replaceChildren(); window.localStorage.clear(); });
  window.history.replaceState(null, "", "/threads/thr_elsewhere");
  document.body.innerHTML = '<div data-promptbox><textarea>Unrelated draft</textarea></div>';
  const session = new GlobalVoiceSession();
  (session as any).deliverTranscript("фаст апи", {
    kind: "thread", threadId: "thr_destination", originPath: "/threads/thr_destination",
  }, "фаст апи");
  assert.equal(document.querySelector("textarea")!.value, "Unrelated draft");
  const saved = JSON.parse(window.localStorage.getItem("bb.promptbox.contents--thr_destination-3")!);
  assert.equal(saved.text, "фаст апи");
  window.history.replaceState(null, "", "/threads/thr_destination");
  renderSlot({ component: Surface }, {}, {
    pluginId: "voice-input", composer: { text: saved.text, scope: { kind: "thread", threadId: "thr_destination" } },
  });
  assert.equal(manualImprovement.get(current.key)?.rawText, "фаст апи");
});

test("composer UI offers changed-text preview and only applies after confirmation", async (t) => {
  t.after(() => { cleanup(); manualImprovement.dispose(); });
  const slot = renderSlot({ component: Surface }, {}, {
    pluginId: "voice-input", composer: { text: "", scope: { kind: "thread", threadId: "thr_preview" } },
  });
  await act(async () => { manualImprovement.insertDictation("thread:thr_preview", "фаст апи", "фаст апи"); });
  let resolve!: (response: Response) => void;
  t.mock.method(globalThis, "fetch", async () => await new Promise<Response>((yes) => { resolve = yes; }));
  await act(async () => fireEvent.click(slot.getByRole("button", { name: "Improve", exact: true })));
  await slot.behavior.setComposerText("мой фаст апи");
  await act(async () => { resolve(Response.json({ ok: true, text: "FastAPI", error: null })); });
  await slot.findByRole("button", { name: "Apply", exact: true });
  assert.equal(current.draft.text, "мой фаст апи");
  await act(async () => fireEvent.click(slot.getByRole("button", { name: "Apply", exact: true })));
  assert.equal(current.draft.text, "FastAPI");
});

test("compact composer exposes improve through a banner", async (t) => {
  t.after(() => { cleanup(); manualImprovement.dispose(); });
  const slot = renderSlot({ component: ImprovementBanner }, {}, {
    pluginId: "voice-input", composer: { text: "", layout: "compact", scope: { kind: "thread", threadId: "thr_compact" } },
  });
  await act(async () => { manualImprovement.insertDictation("thread:thr_compact", "текст", "текст"); });
  assert.ok(slot.getByRole("button", { name: "Improve", exact: true }));
});

test("automatic and disabled AI settings do not expose or invoke manual editing", async (t) => {
  t.after(() => { cleanup(); manualImprovement.dispose(); });
  publishDictationSettings({ aiPassEnabled: true, aiPassTrigger: "automatic" });
  const slot = renderSlot({ component: Surface }, {}, {
    pluginId: "voice-input", composer: { text: "", scope: { kind: "thread", threadId: "thr_hidden" } },
  });
  await act(async () => { manualImprovement.insertDictation("thread:thr_hidden", "текст", "текст"); });
  assert.equal(slot.queryByRole("button", { name: "Improve", exact: true }), null);
  const { improveDictation } = await import("../src/frontend/improvement-actions.tsx");
  t.mock.method(globalThis, "fetch", async () => { throw new Error("Must not call editor"); });
  await improveDictation(current);
  await act(async () => publishDictationSettings({ aiPassEnabled: false, aiPassTrigger: "manual" }));
  assert.equal(slot.queryByRole("button", { name: "Improve", exact: true }), null);
  await improveDictation(current);
});

test("repeated dictated words track the new occurrence rather than changing the existing one", async (t) => {
  t.after(() => { cleanup(); manualImprovement.dispose(); });
  renderSlot({ component: Surface }, {}, {
    pluginId: "voice-input", composer: { text: "фаст апи ", scope: { kind: "thread", threadId: "thr_repeat" } },
  });
  await act(async () => { manualImprovement.insertDictation("thread:thr_repeat", "фаст апи", "фаст апи"); });
  await act(async () => { await manualImprovement.improve(current, async () => "FastAPI"); });
  assert.equal(current.draft.text, "фаст апи FastAPI");
});

test("a failed request keeps the fragment and exposes a retryable error", async (t) => {
  t.after(() => { cleanup(); manualImprovement.dispose(); });
  const slot = renderSlot({ component: Surface }, {}, {
    pluginId: "voice-input", composer: { text: "", scope: { kind: "thread", threadId: "thr_error" } },
  });
  await act(async () => { manualImprovement.insertDictation("thread:thr_error", "фаст апи", "фаст апи"); });
  t.mock.method(globalThis, "fetch", async () => Response.json({ ok: false, text: "", error: "test provider failure" }));
  await act(async () => fireEvent.click(slot.getByRole("button", { name: "Improve", exact: true })));
  await slot.findByText(/test provider failure/);
  assert.equal(current.draft.text, "фаст апи");
  assert.equal(slot.getByRole("button", { name: "Improve", exact: true }).hasAttribute("disabled"), false);
});

test("plugin dictation insertion keeps a space between consecutive phrases", async (t) => {
  t.after(() => { cleanup(); manualImprovement.dispose(); });
  renderSlot({ component: Surface }, {}, {
    pluginId: "voice-input", composer: { text: "Already here.", scope: { kind: "thread", threadId: "thr_spacing" } },
  });
  await act(async () => { manualImprovement.insertDictation("thread:thr_spacing", "фаст апи", "фаст апи"); });
  assert.equal(current.draft.text, "Already here. фаст апи");
  await act(async () => { await manualImprovement.improve(current, async () => "FastAPI"); });
  assert.equal(current.draft.text, "Already here. FastAPI");
});

test("submission clears tracked dictation so an in-flight edit cannot resurrect the sent draft", async (t) => {
  t.after(() => { cleanup(); manualImprovement.dispose(); });
  renderSlot({ component: Surface }, {}, {
    pluginId: "voice-input", composer: { text: "", scope: { kind: "thread", threadId: "thr_sent" } },
  });
  await act(async () => { manualImprovement.insertDictation("thread:thr_sent", "фаст апи", "фаст апи"); });
  let resolve!: (text: string) => void;
  let job!: Promise<void>;
  await act(async () => { job = manualImprovement.improve(current, () => new Promise((yes) => { resolve = yes; })); });
  await act(async () => { await current.submit(); });
  await act(async () => { resolve("FastAPI"); await job; });
  assert.equal(current.draft.text, "");
  assert.equal(manualImprovement.get(current.key), undefined);
});

test("app registers the native composer action and banner", async () => {
  const app = await loadPluginApp(() => import("../app.tsx"));
  const customization = app.composerCustomizations.find((item) => item.id === "dictation-improvement");
  assert.deepEqual(customization?.scopes, ["thread", "new-thread"]);
  assert.equal(customization?.actions?.[0]?.id, "improve-dictation");
  assert.equal(customization?.banners?.[0]?.id, "improvement-result");
  assert.deepEqual(app.contentScripts.map((item) => item.id), ["voice-input-lifecycle"]);
});

for (const edit of ["", "мой текст", "фаст", "фаст апи и ещё текст"]) {
  test(`a second dictation restores the Improve button after editing to ${JSON.stringify(edit)}`, async (t) => {
    t.after(() => { cleanup(); manualImprovement.dispose(); });
    const slot = renderSlot({ component: Surface }, {}, {
      pluginId: "voice-input", composer: { text: "", layout: "compact", scope: { kind: "thread", threadId: "thr_again" } },
    });
    await act(async () => { manualImprovement.insertDictation("thread:thr_again", "фаст апи", "фаст апи"); });
    await slot.behavior.setComposerText(edit);
    await act(async () => { manualImprovement.insertDictation("thread:thr_again", "некст джей эс", "некст джей эс"); });
    const buttons = slot.getAllByRole("button", { name: "Improve", exact: true });
    assert.ok(buttons.every((button) => !button.hasAttribute("disabled")));
    await act(async () => {
      await manualImprovement.improve(current, async (text) => {
        assert.equal(text, "некст джей эс");
        return "Next.js";
      });
    });
    assert.equal(current.draft.text, edit ? `${edit} Next.js` : "Next.js");
  });
}

for (const edit of ["", "мой текст", "фаст", "фаст апи и ещё текст"]) {
  test(`the button returns after a second dictation with delayed native insertion and draft ${JSON.stringify(edit)}`, async (t) => {
    t.after(() => { cleanup(); manualImprovement.dispose(); });
    const slot = renderSlot({ component: Surface }, {}, {
      pluginId: "voice-input", composer: { text: "", layout: "compact", scope: { kind: "thread", threadId: "thr_delayed_ui" } },
    });
    await act(async () => { manualImprovement.insertDictation("thread:thr_delayed_ui", "фаст апи", "фаст апи"); });
    await slot.behavior.setComposerText(edit);
    const nativeInsert = current.insert.bind(current);
    let publish!: () => void;
    t.mock.method(current, "insert", (parts, options) => { publish = () => nativeInsert(parts, options); });
    await act(async () => {
      manualImprovement.insertDictation("thread:thr_delayed_ui", "некст джей эс", "некст джей эс");
    });
    await act(async () => { publish(); });
    assert.ok(slot.getAllByRole("button", { name: "Improve", exact: true }).every((button) => !button.hasAttribute("disabled")));
    await act(async () => {
      await manualImprovement.improve(current, async (text) => {
        assert.equal(text, "некст джей эс");
        return "Next.js";
      });
    });
    assert.equal(current.draft.text, edit ? `${edit} Next.js` : "Next.js");
  });
}

test("delayed native replacement confirms improvement and Undo only after the draft is published", async (t) => {
  t.after(() => { cleanup(); manualImprovement.dispose(); });
  const slot = renderSlot({ component: Surface }, {}, {
    pluginId: "voice-input", composer: { text: "", scope: { kind: "thread", threadId: "thr_delayed_replace" } },
  });
  await act(async () => { manualImprovement.insertDictation("thread:thr_delayed_replace", "фаст апи", "фаст апи"); });
  const nativeReplace = current.replace.bind(current);
  let publish!: () => void;
  t.mock.method(current, "replace", (next) => { publish = () => nativeReplace(next); });
  await act(async () => { await manualImprovement.improve(current, async () => "FastAPI"); });
  await act(async () => { publish(); });
  assert.equal(current.draft.text, "FastAPI");
  const undo = slot.getByRole("button", { name: "Undo improvement" });
  await act(async () => { fireEvent.click(undo); });
  await act(async () => { publish(); });
  assert.equal(current.draft.text, "фаст апи");
});
