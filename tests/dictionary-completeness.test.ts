import assert from "node:assert/strict";
import { test } from "node:test";
import { dictionary, UI_LANGUAGES } from "../src/i18n/index.ts";

function leaves(value: unknown, path = ""): Map<string, unknown> {
  const result = new Map<string, unknown>();
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const next = path ? `${path}.${key}` : key;
    if (child && typeof child === "object") for (const [k, v] of leaves(child, next)) result.set(k, v);
    else result.set(next, child);
  }
  return result;
}

test("every supported language has exactly the English keys and filled messages", () => {
  const en = leaves(dictionary("en"));
  for (const language of UI_LANGUAGES) {
    const translated = leaves(dictionary(language));
    assert.deepEqual([...translated.keys()].sort(), [...en.keys()].sort(), language);
    for (const [key, value] of translated) {
      assert.equal(typeof value, typeof en.get(key), `${language}:${key}`);
      const text = typeof value === "function" ? value("X", "X", "X") : value;
      assert.equal(typeof text, "string", `${language}:${key}`);
      assert.ok(text.trim(), `${language}:${key}`);
      if (language !== "ru") assert.doesNotMatch(text, /[А-Яа-яЁё]/, `${language}:${key}`);
    }
  }
});
