import assert from "node:assert/strict";
import { test } from "node:test";
import { hasMixedScript, repairTerms, similarity, skeleton } from "../src/term-repair.ts";

const TERMS = [
  "Claude Code", "Claude", "MLX", "MetaMCP", "MCP", "Whisper", "GigaAM",
  "DeepSeek", "Voica", "API", "Mac mini",
];

test("костяк держится на живых искажениях DeepSeek", () => {
  assert.equal(skeleton("DeepSeek"), "dpsk");
  assert.equal(skeleton("Dпсик"), "dpsk");
  assert.equal(skeleton("Deepsc"), "dpsk");
});

test("смешанный алфавит опознаётся", () => {
  assert.equal(hasMixedScript("Dпсик"), true);
  assert.equal(hasMixedScript("клодкод"), false);
  assert.equal(hasMixedScript("DeepSeek"), false);
});

test("похожесть считается по Левенштейну", () => {
  assert.equal(similarity("abc", "abc"), 1);
  assert.equal(similarity("", "abc"), 0);
  assert.ok(similarity("dpsk", "dpsc") > 0.7);
});

test("живые ошибки GigaAM из нашей проверки чинятся", () => {
  assert.equal(repairTerms("проверь Mail X", TERMS), "проверь MLX");
  assert.equal(repairTerms("посмотри меты MCP", TERMS), "посмотри MetaMCP");
  assert.equal(repairTerms("Открой кладко код", TERMS), "Открой Claude Code");
});

test("смешанный алфавит чинится даже с расхождением в согласной", () => {
  assert.equal(repairTerms("открой Dпсик сейчас", TERMS), "открой DeepSeek сейчас");
});

test("обычные слова не трогаются", () => {
  for (const phrase of ["депеша пришла", "колодка на месте", "вика звонила", "папа дома", "надо купить усы"]) {
    assert.equal(repairTerms(phrase, TERMS), phrase);
  }
});

test("союз не проглатывается окном", () => {
  assert.equal(repairTerms("дипсик и клод", TERMS), repairTerms("дипсик и клод", TERMS));
  assert.ok(repairTerms("дипсик и клод", TERMS).includes(" и "));
});

test("пунктуация и пробелы сохраняются", () => {
  assert.equal(repairTerms("Открой: кладко код, потом — меты MCP.", TERMS), "Открой: Claude Code, потом — MetaMCP.");
});

test("пустой словарь ничего не меняет", () => {
  assert.equal(repairTerms("любой текст", []), "любой текст");
});

test("предлог перед термином не съедается", () => {
  assert.equal(repairTerms("играет в Оларант", TERMS), "играет в Оларант");
  assert.equal(repairTerms("играет в Valorant", TERMS), "играет в Valorant");
});

test("однобуквенное слово в конце окна остаётся частью термина", () => {
  assert.equal(repairTerms("проверь Mail X", TERMS), "проверь MLX");
});
