import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_SETTINGS, mergeSettings, sanitizePatch } from "../src/settings-store.ts";

test("лишний ключ от прежней версии не обнуляет остальные настройки", () => {
  const stored = {
    ...DEFAULT_SETTINGS,
    vocabulary: "DeepSeek, Claude Code",
    // Настройка, которую убрали в новой версии, остаётся в хранилище.
    groqFreeTier: true,
    fallbackEngine: "whisper",
  };
  const merged = mergeSettings(stored);
  assert.equal(merged.vocabulary, "DeepSeek, Claude Code");
  assert.equal(merged.engine, DEFAULT_SETTINGS.engine);
});

test("значение неверного типа заменяется умолчанием, остальное цело", () => {
  const merged = mergeSettings({ vocabulary: "BB, MLX", keepDays: "много", engine: "gigaam" });
  assert.equal(merged.vocabulary, "BB, MLX");
  assert.equal(merged.keepDays, DEFAULT_SETTINGS.keepDays);
  assert.equal(merged.engine, "gigaam");
});

test("пустое и битое хранилище дают умолчания", () => {
  assert.deepEqual(mergeSettings(null), DEFAULT_SETTINGS);
  assert.deepEqual(mergeSettings("строка"), DEFAULT_SETTINGS);
});

test("правка из браузера отбрасывает чужие ключи", () => {
  const patch = sanitizePatch({ vocabulary: "BB", whatever: 1, keepDays: 7 });
  assert.deepEqual(patch, { vocabulary: "BB", keepDays: 7 });
});
