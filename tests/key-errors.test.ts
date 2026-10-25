import assert from "node:assert/strict";
import { test } from "node:test";
import { UI_LANGUAGES, dictionary } from "../src/i18n/index.ts";

test("ошибка про ключ называет движок на каждом языке интерфейса", () => {
  for (const language of UI_LANGUAGES) {
    const { keyRequired, keyEnvMissing } = dictionary(language).errors;
    assert.ok(keyRequired("Groq").includes("Groq"), language);
    assert.ok(keyEnvMissing("GROQ_API_KEY").includes("GROQ_API_KEY"), language);
  }
});

test("ошибка про ключ на португальском не на русском", () => {
  const message = dictionary("pt").errors.keyRequired("Groq");
  assert.match(message, /precisa de uma chave/);
  assert.doesNotMatch(message, /[А-Яа-я]/);
});

test("неизвестный язык даёт английский", () => {
  assert.equal(dictionary("xx").errors.keyRequired("Groq"), dictionary("en").errors.keyRequired("Groq"));
});
