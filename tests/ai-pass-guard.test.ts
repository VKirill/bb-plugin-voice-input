import assert from "node:assert/strict";
import { test } from "node:test";
import { guardAiPass } from "../src/ai-pass-guard.ts";

const TERMS = ["DeepSeek", "Claude Code", "Valorant", "ChatGPT", "PlayStation"];

test("выдуманное слово возвращается к сказанному", () => {
  const original = "открывает винишко и хочет взбодриться";
  const corrected = "открывает винилшко и хочет взбодриться";
  assert.equal(guardAiPass(original, corrected, TERMS), original);
});

test("починенный термин из словаря остаётся", () => {
  const original = "играл в DeepC и Оларант";
  const corrected = "играл в DeepSeek и Valorant";
  assert.equal(guardAiPass(original, corrected, TERMS), corrected);
});

test("склейка «Chat GPT» в термин принимается", () => {
  assert.equal(guardAiPass("включил Chat GPT", "включил ChatGPT", TERMS), "включил ChatGPT");
});

test("пунктуация и регистр модели не трогаются", () => {
  const original = "привет как дела";
  const corrected = "Привет, как дела?";
  assert.equal(guardAiPass(original, corrected, TERMS), corrected);
});

test("совсем непохожее слово остаётся как есть", () => {
  // Нечего восстанавливать: пусть решает пользователь, а не эвристика.
  assert.equal(guardAiPass("раз два", "раз два картофелина", TERMS), "раз два картофелина");
});
