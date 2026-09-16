import assert from "node:assert/strict";
import { test } from "node:test";
import { buildRecognitionPrompt, parseVocabulary } from "../src/vocabulary.ts";
import { cleanupText } from "../src/cleanup.ts";

test("простой список через запятую разбирается как термины", () => {
  assert.deepEqual(parseVocabulary("DeepSeek, SelfyStudio, Claude Code, env, BB"), [
    "DeepSeek",
    "SelfyStudio",
    "Claude Code",
    "env",
    "BB",
  ]);
});

test("повторы и комментарии отбрасываются", () => {
  assert.deepEqual(parseVocabulary("BB, bb\n# комментарий\nMLX"), ["BB", "MLX"]);
});

test("подсказка обрезается с начала, важное остаётся в конце", () => {
  const entries = parseVocabulary(["Первый", "Второй", "Третий"].join("\n"));
  assert.equal(buildRecognitionPrompt(entries, 200), "Первый, Второй, Третий");
  assert.equal(buildRecognitionPrompt(entries, 14), "Второй, Третий");
  assert.equal(buildRecognitionPrompt([], 100), null);
});

test("слова-паразиты убираются, растянутое слово распрямляется", () => {
  assert.equal(
    cleanupText("Э-э-э, ну-у-у это, мм, работает", { fillers: true, quotes: false, language: "ru" }),
    "ну это, работает",
  );
});

test("союзы и предлоги из одной буквы не трогаются", () => {
  assert.equal(
    cleanupText("я и он, а она у окна", { fillers: true, quotes: false, language: "ru" }),
    "я и он, а она у окна",
  );
});

test("кавычки принимают вид, принятый в языке", () => {
  assert.equal(
    cleanupText('открой "проект" сейчас', { fillers: false, quotes: true, language: "ru" }),
    "открой «проект» сейчас",
  );
  assert.equal(
    cleanupText('open "the project" now', { fillers: false, quotes: true, language: "en" }),
    "open “the project” now",
  );
  assert.equal(
    cleanupText('öffne "das Projekt"', { fillers: false, quotes: true, language: "de" }),
    "öffne „das Projekt“",
  );
});

test("слова-паразиты убираются на своём языке", () => {
  const options = { fillers: true, quotes: false } as const;
  assert.equal(
    cleanupText("Uh, so um I think we should, hmm, ship it", { ...options, language: "en" }),
    "so I think we should, ship it",
  );
  assert.equal(
    cleanupText("Äh, also ähm ich denke", { ...options, language: "de" }),
    "also ich denke",
  );
  assert.equal(cleanupText("Euh, donc euh je pense", { ...options, language: "fr" }), "donc je pense");
});

test("язык определяется по тексту, когда он не задан", () => {
  const options = { fillers: true, quotes: false, language: "auto" } as const;
  assert.equal(cleanupText("Э-э-э, привет", options), "привет");
  assert.equal(cleanupText("Um, hello there", options), "hello there");
});

test("обычные слова другого языка не страдают", () => {
  // «este» по-испански — обычное слово, «like» по-английски тоже.
  assert.equal(
    cleanupText("este proyecto es bueno", { fillers: true, quotes: false, language: "es" }),
    "este proyecto es bueno",
  );
  assert.equal(
    cleanupText("I like this", { fillers: true, quotes: false, language: "en" }),
    "I like this",
  );
});

test("выключенные правила ничего не меняют, кроме лишних пробелов", () => {
  assert.equal(
    cleanupText("Э-э-э,  текст  как  есть", { fillers: false, quotes: false, language: "ru" }),
    "Э-э-э, текст как есть",
  );
});

test("пробел после точки не теряется при чистке междометий", () => {
  assert.equal(
    cleanupText("Проверка связи. Это тестовая запись.", { fillers: true, quotes: true, language: "ru" }),
    "Проверка связи. Это тестовая запись.",
  );
});

test("слипшиеся предложения из длинной записи разделяются", () => {
  assert.equal(
    cleanupText("Проверка связи.Это тестовая запись.Она длинная", { fillers: false, quotes: false, language: "ru" }),
    "Проверка связи. Это тестовая запись. Она длинная",
  );
});

test("осиротевшая запятая после точки убирается вместе с междометием", () => {
  assert.equal(
    cleanupText("Готово. Э-э-э, дальше едем", { fillers: true, quotes: false, language: "ru" }),
    "Готово. дальше едем",
  );
});
