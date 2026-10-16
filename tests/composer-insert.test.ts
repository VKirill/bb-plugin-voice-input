import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getRememberedComposerCaret,
  insertIntoDraftText,
  rememberComposerCaret,
  resetRememberedComposerCaret,
  resolveComposerInsertOffset,
} from "../src/frontend/composer-insert.ts";

test("пустой черновик: расшифровка встаёт в начало", () => {
  const result = insertIntoDraftText("", "Привет", 0);
  assert.equal(result.text, "Привет");
  assert.equal(result.piece, "Привет");
  assert.equal(result.offset, 0);
});

test("каретка в середине: расшифровка встаёт на место курсора и добавляет пробелы", () => {
  const existing = "начало конец";
  const caret = existing.indexOf(" ");
  const result = insertIntoDraftText(existing, "середина", caret);
  assert.equal(result.text, "начало середина конец");
});

test("каретка в конце предложения: расшифровка дописывается после текста", () => {
  const result = insertIntoDraftText("Уже написано.", "продолжение", 13);
  assert.equal(result.text, "Уже написано. продолжение");
});

test("каретка в начале непустого текста: расшифровка перед текстом", () => {
  const result = insertIntoDraftText("уже было", "Сначала", 0);
  assert.equal(result.text, "Сначала уже было");
});

test("смещение за пределы строки сжимается", () => {
  const result = insertIntoDraftText("abc", "x", 99);
  assert.equal(result.text, "abc x");
  assert.equal(result.offset, 3);
});

test("без запомненной каретки вставка идёт в конец уже набранного текста", () => {
  resetRememberedComposerCaret();
  assert.equal(getRememberedComposerCaret(), null);
  assert.equal(resolveComposerInsertOffset(11), 11);
});

test("запомненная каретка ограничивает вставку внутри текста", () => {
  resetRememberedComposerCaret();
  rememberComposerCaret(4);
  assert.equal(getRememberedComposerCaret(), 4);
  assert.equal(resolveComposerInsertOffset(11), 4);
  assert.equal(resolveComposerInsertOffset(2), 2);
});
