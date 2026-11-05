import assert from "node:assert/strict";
import { test } from "node:test";
import { ManualImprovement, type EditingComposer } from "../src/frontend/manual-improvement.ts";
import type { PluginComposerApi } from "@get-bb/plugin-sdk/app";

function composer(key = "draft-1", text = "Before фаст апи after") {
  let draft = { text, mentions: [] as Array<{ from: number; to: number; label: string }>, attachments: ["keep"] };
  return {
    key, scope: { kind: "thread", threadId: "thr_test" },
    get draft() { return draft; },
    replace(next: any) { draft = { ...draft, ...(typeof next === "function" ? next(draft) : next) }; },
    edit(text: string) { draft = { ...draft, text }; },
    mention(from: number, to: number) { draft.mentions.push({ from, to, label: draft.text.slice(from, to) }); },
  } as EditingComposer & { edit(text: string): void; mention(from: number, to: number): void };
}

function setup() {
  const controller = new ManualImprovement();
  const draft = composer();
  controller.remember("thread:thr_test", draft.draft.text, 7, 15, "фаст апи");
  controller.adopt(draft);
  return { controller, draft };
}

test("manual improvement sends and replaces only the last dictated fragment", async () => {
  const { controller, draft } = setup();
  await controller.improve(draft, async (text) => {
    assert.equal(text, "фаст апи");
    return "FastAPI";
  });
  assert.equal(draft.draft.text, "Before FastAPI after");
  assert.deepEqual(draft.draft.attachments, ["keep"]);
  assert.equal(controller.get(draft.key)?.status, "done");
  controller.undo(draft);
  assert.equal(draft.draft.text, "Before фаст апи after");
});

test("typing in the fragment while a request runs offers a preview and requires explicit apply", async () => {
  const { controller, draft } = setup();
  let resolve!: (value: string) => void;
  const job = controller.improve(draft, () => new Promise((yes) => { resolve = yes; }));
  draft.edit("Before мой фаст апи after");
  controller.sync(draft);
  resolve("FastAPI");
  await job;
  assert.equal(draft.draft.text, "Before мой фаст апи after");
  assert.equal(controller.get(draft.key)?.status, "preview");
  controller.apply(draft);
  assert.equal(draft.draft.text, "Before FastAPI after");
  controller.undo(draft);
  assert.equal(draft.draft.text, "Before мой фаст апи after");
});

test("edits outside the fragment survive improvement and undo, and mentions are rebased", async () => {
  const { controller, draft } = setup();
  draft.mention(16, 21);
  draft.edit("New Before фаст апи after");
  controller.sync(draft);
  // Mimic the host's rebasing of an existing mention after an ordinary edit.
  draft.draft.mentions[0]!.from += 4;
  draft.draft.mentions[0]!.to += 4;
  await controller.improve(draft, async () => "FastAPI");
  assert.equal(draft.draft.text, "New Before FastAPI after");
  assert.equal(draft.draft.mentions[0]!.from, 19);
  draft.edit("New Before FastAPI after!");
  controller.sync(draft);
  controller.undo(draft);
  assert.equal(draft.draft.text, "New Before фаст апи after!");
  assert.equal(draft.draft.mentions[0]!.from, 20);
});

test("failed requests and overlapping mentions leave the original draft intact", async () => {
  const { controller, draft } = setup();
  await controller.improve(draft, async () => { throw new Error("provider failed"); });
  assert.equal(draft.draft.text, "Before фаст апи after");
  assert.equal(controller.get(draft.key)?.error, "provider failed");
  draft.mention(7, 15);
  await controller.improve(draft, async () => { throw new Error("must not call model"); });
  assert.equal(draft.draft.text, "Before фаст апи after");
});

test("submitting or replacing the last dictation invalidates pending results", async () => {
  const { controller, draft } = setup();
  let resolve!: (value: string) => void;
  const job = controller.improve(draft, () => new Promise((yes) => { resolve = yes; }));
  controller.clear(draft.key);
  draft.edit("");
  resolve("FastAPI");
  await job;
  assert.equal(draft.draft.text, "");
  assert.equal(controller.get(draft.key), undefined);
});

test("switching composers cannot apply one thread's result to another", async () => {
  const { controller, draft } = setup();
  const other = composer("draft-2", "Other text");
  other.scope = { kind: "thread", threadId: "thr_other" };
  controller.adopt(other);
  assert.equal(controller.get(other.key), undefined);
  await controller.improve(draft, async () => "FastAPI");
  assert.equal(other.draft.text, "Other text");
  assert.equal(draft.draft.text, "Before FastAPI after");
});

test("manual edits to an improved fragment disable undo rather than overwriting them", async () => {
  const { controller, draft } = setup();
  await controller.improve(draft, async () => "FastAPI");
  draft.edit("Before FastXPI after");
  controller.sync(draft);
  controller.undo(draft);
  assert.equal(draft.draft.text, "Before FastXPI after");
});

test("a new dictation replaces the tracked fragment and ignores an older in-flight request", async () => {
  const { controller, draft } = setup();
  let resolve!: (value: string) => void;
  const job = controller.improve(draft, () => new Promise((yes) => { resolve = yes; }));
  draft.edit("Before фаст апи after некст");
  controller.remember("thread:thr_test", draft.draft.text, 22, 27, "некст");
  controller.adopt(draft);
  resolve("FastAPI");
  await job;
  assert.equal(draft.draft.text, "Before фаст апи after некст");
  await controller.improve(draft, async (text) => { assert.equal(text, "некст"); return "Next.js"; });
  assert.equal(draft.draft.text, "Before фаст апи after Next.js");
});

test("edits across the fragment boundary invalidate tracking rather than rewriting unrelated text", async () => {
  const { controller, draft } = setup();
  draft.edit("Entirely new draft");
  controller.sync(draft);
  await controller.improve(draft, async () => { throw new Error("Must not request a rewrite"); });
  assert.equal(draft.draft.text, "Entirely new draft");
  assert.equal(controller.get(draft.key), undefined);
});

for (const afterEdit of ["", "свой текст", "фаст", "фаст апи и добавление"]) {
  test(`delayed host draft publication preserves tracking on repeated dictation after ${JSON.stringify(afterEdit)}`, async () => {
    const controller = new ManualImprovement();
    const base = composer("draft-delayed", "фаст апи");
    let publication: (() => void) | undefined;
    const handle = {
      ...base,
      get draft() { return base.draft; },
      insert(text: string) {
        const next = base.draft.text + text;
        publication = () => base.edit(next);
      },
    } as unknown as PluginComposerApi;
    controller.register(handle);
    controller.remember("thread:thr_test", "фаст апи", 0, 8, "фаст апи");
    controller.adopt(handle);
    base.edit(afterEdit);
    controller.sync(handle);
    assert.equal(controller.insertDictation("thread:thr_test", "некст джей эс", "некст джей эс"), true);
    // A render/effect may still see the pre-insertion draft before the host publishes it.
    controller.sync(handle);
    publication!();
    controller.sync(handle);
    assert.ok(controller.get(handle.key), "the new dictation must enable Improve after publication");
    await controller.improve(handle, async (text) => {
      assert.equal(text, "некст джей эс");
      return "Next.js";
    });
    assert.equal(base.draft.text, afterEdit ? `${afterEdit} Next.js` : "Next.js");
  });
}

test("a deferred insertion binds only the new occurrence when old and new dictated text are identical", async () => {
  const controller = new ManualImprovement();
  const base = composer("draft-identical", "фаст апи");
  let publish!: () => void;
  const handle = {
    ...base,
    get draft() { return base.draft; },
    insert(text: string) { publish = () => base.edit(base.draft.text + text); },
  } as unknown as PluginComposerApi;
  controller.register(handle);
  controller.insertDictation("thread:thr_test", "фаст апи", "фаст апи");
  controller.sync(handle);
  publish();
  controller.sync(handle);
  await controller.improve(handle, async () => "FastAPI");
  assert.equal(base.draft.text, "фаст апи FastAPI");
});

test("submitting before insertion publication discards the deferred fragment", () => {
  const controller = new ManualImprovement();
  const base = composer("draft-cleared", "");
  const handle = { ...base, get draft() { return base.draft; }, insert() {} } as unknown as PluginComposerApi;
  controller.register(handle);
  controller.insertDictation("thread:thr_test", "фаст апи", "фаст апи");
  controller.clear(handle.key);
  base.edit("фаст апи");
  controller.sync(handle);
  assert.equal(controller.get(handle.key), undefined);
});

test("dictation at the end explicitly avoids replacing a retained editor selection", () => {
  const controller = new ManualImprovement();
  const base = composer("selected-draft", "Keep selected text");
  let options: unknown;
  const handle = {
    ...base, get draft() { return base.draft; },
    insert(piece: string, nextOptions: unknown) {
      options = nextOptions;
      base.edit(base.draft.text + piece);
    },
  } as unknown as PluginComposerApi;
  controller.register(handle);
  assert.equal(controller.insertDictation("thread:thr_test", "dictated", "dictated"), true);
  assert.deepEqual(options, { at: "end" });
  assert.equal(base.draft.text, "Keep selected text dictated");
});

test("dictation at a saved offset inserts without deleting a selection and rebases mentions", () => {
  const controller = new ManualImprovement();
  const base = composer("middle-draft", "Keep selected text");
  base.mention(14, 18);
  const handle = { ...base, get draft() { return base.draft; }, insert() { throw new Error("Must not replace the cursor selection"); } } as unknown as PluginComposerApi;
  controller.register(handle);
  assert.equal(controller.insertDictation("thread:thr_test", "dictated", "dictated", 5), true);
  assert.equal(base.draft.text, "Keep dictated selected text");
  assert.equal(base.draft.mentions[0]!.from, 23);
  assert.equal(base.draft.attachments[0], "keep");
});

test("a mention added while improving does not leave Apply permanently pending", async () => {
  const { controller, draft } = setup();
  let resolve!: (value: string) => void;
  const job = controller.improve(draft, () => new Promise((yes) => { resolve = yes; }));
  draft.mention(7, 15);
  resolve("FastAPI");
  await job;
  assert.equal(draft.draft.text, "Before фаст апи after");
  draft.draft.mentions.splice(0);
  controller.apply(draft);
  assert.equal(draft.draft.text, "Before FastAPI after");
});

test("dictation inside a mention reports a blocked insertion without changing the draft", () => {
  const controller = new ManualImprovement();
  const base = composer("mention-draft", "Alice hello");
  base.mention(0, 5);
  controller.register({ ...base, get draft() { return base.draft; } } as unknown as PluginComposerApi);
  assert.equal(controller.insertDictation("thread:thr_test", "dictated", "dictated", 2), "blocked");
  assert.equal(base.draft.text, "Alice hello");
  assert.equal(controller.get(base.key), undefined);
});
