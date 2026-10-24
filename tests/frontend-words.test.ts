import assert from "node:assert/strict";
import { test } from "node:test";
import { UI_LANGUAGES, dictionary } from "../src/i18n/index.ts";

const CYRILLIC = /[А-Яа-яЁё]/;

function texts(language: string): string[] {
  const { voice, machine } = dictionary(language);
  return [
    ...Object.values(voice).map((value) => (typeof value === "function" ? value("X") : value)),
    ...Object.values(machine).map((value) => (typeof value === "function" ? value("X") : value)),
  ];
}

test("тосты и подписи записи заполнены на каждом языке интерфейса", () => {
  for (const language of UI_LANGUAGES) {
    for (const text of texts(language)) {
      assert.ok(text.trim().length > 0, language);
    }
  }
});

test("кириллица остаётся только в русском словаре", () => {
  for (const language of UI_LANGUAGES.filter((code) => code !== "ru")) {
    for (const text of texts(language)) {
      assert.doesNotMatch(text, CYRILLIC, `${language}: ${text}`);
    }
  }
});

test("подписи с названием чата показывают это название", () => {
  for (const language of UI_LANGUAGES) {
    const { voice, machine } = dictionary(language);
    assert.ok(voice.movedToChat("Мой чат").includes("Мой чат"), language);
    assert.ok(voice.badgeLabel("Мой чат").includes("Мой чат"), language);
    assert.ok(voice.badgeTitle("Мой чат").includes("Мой чат"), language);
    assert.ok(machine.cloudOnly("BD-1").includes("BD-1"), language);
  }
});

test("русский текст остался прежним, португальский не русский", () => {
  assert.equal(dictionary("ru").voice.pasted, "Речь распознана и вставлена в чат");
  assert.equal(dictionary("pt").voice.pasted, "Fala reconhecida e inserida no chat");
});
