import assert from "node:assert/strict";
import { test } from "node:test";
import { dictionary } from "../src/i18n/index.ts";
import { setFrontendLanguage, words, loadFrontendLanguage } from "../src/frontend/words.ts";

test("regional locale codes resolve without exposing prototype properties", () => {
  assert.equal(dictionary("pt-BR"), dictionary("pt"));
  assert.equal(dictionary("RU-ru"), dictionary("ru"));
  assert.equal(dictionary("__proto__"), dictionary("en"));
});

test("recording uses BB language before settings load and follows changes in auto mode", () => {
  const original = globalThis.document;
  try {
    Object.assign(globalThis, { document: { documentElement: { lang: "ru-RU" } } });
    setFrontendLanguage("auto");
    assert.equal(words(), dictionary("ru"));
    document.documentElement.lang = "pt-BR";
    assert.equal(words(), dictionary("pt"));
    setFrontendLanguage("en");
    assert.equal(words(), dictionary("en"));
  } finally {
    Object.assign(globalThis, { document: original });
    setFrontendLanguage("auto");
  }
});

test("late initial response cannot undo a language selected in settings", async () => {
  const original = globalThis.fetch;
  let finish!: (value: Response) => void;
  try {
    globalThis.fetch = () => new Promise<Response>((resolve) => { finish = resolve; });
    const loading = loadFrontendLanguage();
    setFrontendLanguage("pt");
    finish(new Response(JSON.stringify({ result: { uiLanguage: "ru" } })));
    await loading;
    assert.equal(words(), dictionary("pt"));
  } finally {
    globalThis.fetch = original;
    setFrontendLanguage("auto");
  }
});

test("failed settings request leaves the selected language intact", async () => {
  const original = globalThis.fetch;
  try {
    setFrontendLanguage("ru");
    globalThis.fetch = async () => new Response(JSON.stringify({ uiLanguage: "pt" }), { status: 500 });
    await loadFrontendLanguage();
    assert.equal(words().voice.cancelRecording, dictionary("ru").voice.cancelRecording);
  } finally {
    globalThis.fetch = original;
    setFrontendLanguage("auto");
  }
});
