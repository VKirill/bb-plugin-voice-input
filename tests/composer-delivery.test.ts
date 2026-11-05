import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import type { PluginComposerApi } from "@get-bb/plugin-sdk/app";
import { captureComposerDestination, deliverToComposer } from "../src/frontend/composer-delivery.ts";
import { manualImprovement } from "../src/frontend/manual-improvement.ts";

function setup(t: TestContext, kind: "thread" | "new-thread" = "thread") {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  const location = { pathname: "/projects/A/new", search: "", hash: "" };
  Object.defineProperty(globalThis, "window", { value: { location }, configurable: true });
  let draft = { text: "Keep.", mentions: [], attachments: [] as any[] };
  const state = { key: "composer-A", selection: { projectId: "A" }, blocked: false, sent: [] as string[] };
  const composer = {
    get key() { return state.key; }, scope: kind === "thread" ? { kind, threadId: "A" } : { kind, projectId: "A" },
    get selection() { return state.selection; }, get draft() { return draft; },
    get isSubmittingBlocked() { return state.blocked; }, isSubmitting: false,
    replace(next: any) { draft = typeof next === "function" ? next(draft) : next; },
    async submit() { state.sent.push(draft.text); },
  } as unknown as PluginComposerApi;
  manualImprovement.register(composer);
  t.after(() => {
    manualImprovement.dispose();
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  });
  const destination = captureComposerDestination({ kind, threadId: "A" })!;
  return { composer, destination, location, state, edit: (text: string) => { draft = { ...draft, text }; } };
}

const options = { track: false, autoSend: true, isCurrent: () => true, timeoutMs: 150 };

test("auto-send submits the captured unchanged draft", async (t) => {
  const h = setup(t);
  assert.equal(await deliverToComposer(h.destination, "hello", "hello", options), true);
  assert.deepEqual(h.state.sent, ["Keep. hello"]);
});

test("switching new-thread projects cannot send the destination project's draft", async (t) => {
  const h = setup(t, "new-thread");
  h.location.pathname = "/projects/B/new";
  const otherDraft = "Project B private draft";
  await deliverToComposer(h.destination, "hello from A", "hello from A", options);
  assert.equal(h.composer.draft.text, "Keep. hello from A");
  assert.equal(otherDraft, "Project B private draft");
  assert.deepEqual(h.state.sent, []);
});

test("changing the project picker on the same route invalidates delivery", async (t) => {
  const h = setup(t, "new-thread");
  h.state.selection = { projectId: "B" };
  assert.equal(await deliverToComposer(h.destination, "hello", "hello", options), false);
  assert.equal(h.composer.draft.text, "Keep.");
  assert.deepEqual(h.state.sent, []);
});

test("reusing a handle for another composer invalidates delivery", async (t) => {
  const h = setup(t);
  h.state.key = "composer-B";
  assert.equal(await deliverToComposer(h.destination, "hello", "hello", options), false);
  assert.deepEqual(h.state.sent, []);
});

test("editing text while Send is blocked cancels auto-send", async (t) => {
  const h = setup(t);
  h.state.blocked = true;
  const pending = deliverToComposer(h.destination, "hello", "hello", options);
  h.edit("my newer text");
  h.state.blocked = false;
  await pending;
  assert.equal(h.composer.draft.text, "my newer text");
  assert.deepEqual(h.state.sent, []);
});

test("adding an attachment while Send is blocked cancels auto-send", async (t) => {
  const h = setup(t);
  h.state.blocked = true;
  const pending = deliverToComposer(h.destination, "hello", "hello", options);
  h.composer.replace({ ...h.composer.draft, attachments: [{ type: "localFile", path: "/new.txt", name: "new.txt" }] });
  h.state.blocked = false;
  await pending;
  assert.equal(h.composer.draft.attachments.length, 1);
  assert.deepEqual(h.state.sent, []);
});

test("cancelling a session while waiting for Send prevents submission", async (t) => {
  const h = setup(t);
  h.state.blocked = true;
  let current = true;
  const pending = deliverToComposer(h.destination, "hello", "hello", { ...options, isCurrent: () => current });
  current = false;
  h.state.blocked = false;
  await pending;
  assert.deepEqual(h.state.sent, []);
});

test("manual editing tracks only the inserted fragment and preserves attachments", async (t) => {
  const h = setup(t);
  h.composer.replace({ ...h.composer.draft, attachments: [{ type: "localFile", path: "/keep.txt", name: "keep.txt" }] });
  await deliverToComposer(h.destination, "FastAPI", "фаст апи", { ...options, track: true, autoSend: false });
  assert.equal(manualImprovement.get(h.composer.key)?.rawText, "фаст апи");
  assert.equal(h.composer.draft.attachments.length, 1);
  assert.deepEqual(h.state.sent, []);
});

test("turning off auto-send while Send is blocked leaves the text in the draft", async (t) => {
  const h = setup(t);
  h.state.blocked = true;
  let enabled = true;
  const pending = deliverToComposer(h.destination, "hello", "hello", { ...options, canAutoSend: () => enabled });
  enabled = false;
  h.state.blocked = false;
  await pending;
  assert.equal(h.composer.draft.text, "Keep. hello");
  assert.deepEqual(h.state.sent, []);
});

test("editing the draft while recognition is pending leaves the combined text unsent", async (t) => {
  const h = setup(t);
  h.edit("My new draft");
  await deliverToComposer(h.destination, "hello", "hello", options);
  assert.equal(h.composer.draft.text, "My new draft hello");
  assert.deepEqual(h.state.sent, []);
});

test("adding an attachment while recognition is pending prevents auto-send", async (t) => {
  const h = setup(t);
  h.composer.replace({ ...h.composer.draft, attachments: [{ type: "localFile", path: "/new.txt", name: "new.txt" }] });
  await deliverToComposer(h.destination, "hello", "hello", options);
  assert.equal(h.composer.draft.text, "Keep. hello");
  assert.equal(h.composer.draft.attachments.length, 1);
  assert.deepEqual(h.state.sent, []);
});
