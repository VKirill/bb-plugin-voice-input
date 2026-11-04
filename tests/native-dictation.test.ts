import assert from "node:assert/strict";
import { test } from "node:test";
import { NativeDictationTracker } from "../src/frontend/native-dictation.ts";
import { nativeTranscriptReceipt, normalizeNativeTranscript } from "../src/native-transcript.ts";
import type { EditingComposer } from "../src/frontend/manual-improvement.ts";

function composer(key: string, text = "") {
  let draft = { text, mentions: [], attachments: [] };
  return { key, get draft() { return draft; }, edit(text: string) { draft = { ...draft, text }; } } as unknown as EditingComposer & { edit(text: string): void };
}

async function flush() { await new Promise<void>((resolve) => setImmediate(resolve)); }

test("native receipt contains only a digest, length and id, never the transcript", async () => {
  const receipt = await nativeTranscriptReceipt("test", "мой секретный текст");
  assert.deepEqual(Object.keys(receipt), ["id", "hash", "length"]);
  assert.equal(receipt.hash.length, 64);
  assert.ok(!JSON.stringify(receipt).includes("секретный"));
  assert.equal(normalizeNativeTranscript("  one\n two  "), "one two");
});

test("native insertion is tracked when the receipt arrives before the draft update", async () => {
  let done!: () => void;
  const matched = new Promise<void>((resolve) => { done = resolve; });
  const c = composer("draft-native", "My draft. ");
  const tracker = new NativeDictationTracker((target, from, to) => {
    assert.equal(target.key, c.key);
    assert.equal(c.draft.text.slice(from, to), "фаст апи");
    done();
  });
  tracker.observe(c);
  tracker.receive(await nativeTranscriptReceipt("one", "фаст апи"), [c]);
  c.edit("My draft. фаст апи");
  tracker.observe(c);
  await matched;
});

test("native insertion is tracked when delivery happens before the receipt", async () => {
  let done!: () => void;
  const matched = new Promise<void>((resolve) => { done = resolve; });
  const c = composer("draft-native");
  const tracker = new NativeDictationTracker((_target, from, to) => {
    assert.equal(c.draft.text.slice(from, to), "Next.js"); done();
  });
  tracker.observe(c);
  c.edit("Next.js");
  tracker.observe(c);
  tracker.receive(await nativeTranscriptReceipt("two", "Next.js"), [c]);
  await matched;
});

test("only the new repeated phrase is tracked, not old text elsewhere in the draft", async () => {
  let done!: () => void;
  const matched = new Promise<void>((resolve) => { done = resolve; });
  const c = composer("repeated", "фаст апи");
  const tracker = new NativeDictationTracker((_target, from, to) => {
    assert.equal(from, 9); assert.equal(to, 17); done();
  });
  tracker.observe(c);
  c.edit("фаст апи фаст апи");
  tracker.observe(c);
  tracker.receive(await nativeTranscriptReceipt("three", "фаст апи"), [c]);
  await matched;
});

test("native insertion at the middle of a draft does not include surrounding text", async () => {
  let done!: () => void;
  const matched = new Promise<void>((resolve) => { done = resolve; });
  const c = composer("middle", "Before after");
  const tracker = new NativeDictationTracker((_target, from, to) => {
    assert.equal(c.draft.text.slice(from, to), "фаст апи"); done();
  });
  tracker.observe(c);
  c.edit("Before фаст апи after");
  tracker.observe(c);
  tracker.receive(await nativeTranscriptReceipt("middle", "фаст апи"), [c]);
  await matched;
});

test("a receipt from another window does not enable Improve for an unrelated draft", async () => {
  let matches = 0;
  const c = composer("unrelated", "text");
  const tracker = new NativeDictationTracker(() => { matches += 1; });
  tracker.observe(c);
  c.edit("text typed by hand");
  tracker.observe(c);
  tracker.receive(await nativeTranscriptReceipt("other-window", "фаст апи"), [c]);
  await flush();
  assert.equal(matches, 0);
});

test("submitted or cleared drafts cannot be resurrected by delayed native receipts", async () => {
  let matches = 0;
  const c = composer("cleared");
  const tracker = new NativeDictationTracker(() => { matches += 1; });
  tracker.observe(c);
  c.edit("фаст апи"); tracker.observe(c);
  tracker.clear(c.key);
  c.edit(""); tracker.observe(c);
  tracker.receive(await nativeTranscriptReceipt("sent", "фаст апи"), [c]);
  await flush();
  assert.equal(matches, 0);
});

test("deleting unrelated text does not make an existing identical phrase a new dictation", async () => {
  let matches = 0;
  const c = composer("old-phrase", "фаст апи удалить");
  const tracker = new NativeDictationTracker(() => { matches += 1; });
  tracker.observe(c);
  c.edit("фаст апи"); tracker.observe(c);
  tracker.receive(await nativeTranscriptReceipt("elsewhere", "фаст апи"), [c]);
  await flush();
  assert.equal(matches, 0);
});

test("normalizing paragraphs matches the native single-line insertion", async () => {
  let done!: () => void;
  const matched = new Promise<void>((resolve) => { done = resolve; });
  const c = composer("normalized");
  const tracker = new NativeDictationTracker((_target, from, to) => {
    assert.equal(c.draft.text.slice(from, to), "Hello world"); done();
  });
  tracker.observe(c);
  tracker.receive(await nativeTranscriptReceipt("normalized", "Hello\n\nworld"), [c]);
  c.edit("Hello world"); tracker.observe(c);
  await matched;
});
