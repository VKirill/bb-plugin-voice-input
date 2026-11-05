import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_SETTINGS, mergeSettings, sanitizePatch } from "../src/settings-store.ts";
import { voiceConfigSchema } from "../src/contract.ts";

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

test("клавиша диктовки сохраняется отдельно от остальных полей", () => {
  const merged = mergeSettings({
    ...DEFAULT_SETTINGS,
    hotkeyCode: "MetaRight",
    hotkeyEnabled: true,
  });
  assert.equal(merged.hotkeyCode, "MetaRight");
  assert.equal(merged.vocabulary, DEFAULT_SETTINGS.vocabulary);
});

test("старые настройки без hotkeyWin* оставляют остальные поля и берут Windows-умолчание", () => {
  const merged = mergeSettings({
    vocabulary: "BB, MLX",
    hotkeyCode: "AltLeft",
    hotkeyEnabled: true,
  });
  assert.equal(merged.vocabulary, "BB, MLX");
  assert.equal(merged.hotkeyCode, "AltLeft");
  assert.equal(merged.hotkeyWinCode, "ControlRight");
  assert.equal(merged.hotkeyWinEnabled, true);
});

test("old AI settings remain in terms-only mode; intent and custom instructions can be saved", () => {
  const migrated = mergeSettings({ aiPassEnabled: true, aiPassModel: "existing-model", vocabulary: "BB" });
  assert.equal(migrated.aiPassMode, "terms");
  assert.equal(migrated.aiPassPrompt, "");
  assert.equal(migrated.aiPassModel, "existing-model");
  assert.deepEqual(sanitizePatch({ aiPassMode: "intent", aiPassPrompt: "Сохраняй мой стиль." }), {
    aiPassMode: "intent", aiPassPrompt: "Сохраняй мой стиль.",
  });
  assert.deepEqual(sanitizePatch({ aiPassMode: "unknown" }), {});
  assert.deepEqual(sanitizePatch({ aiPassPrompt: "x".repeat(8001) }), {});
});

test("old host AI configuration gains defaults without resetting its endpoint or model", () => {
  const legacy = {
    enabled: true, baseUrl: "https://example.test/v1", model: "existing-model", apiKey: "", keyEnv: "",
  };
  const parsed = voiceConfigSchema.shape.aiPass.parse(legacy);
  assert.deepEqual(parsed, { ...legacy, trigger: "automatic", mode: "terms", prompt: "" });
});

test("automatic post-processing remains the default for fresh and legacy settings", () => {
  assert.equal(DEFAULT_SETTINGS.aiPassTrigger, "automatic");
  assert.equal(mergeSettings({ aiPassEnabled: true }).aiPassTrigger, "automatic");
  assert.deepEqual(sanitizePatch({ aiPassTrigger: "manual" }), { aiPassTrigger: "manual" });
  assert.deepEqual(sanitizePatch({ aiPassTrigger: "always" }), {});
});
