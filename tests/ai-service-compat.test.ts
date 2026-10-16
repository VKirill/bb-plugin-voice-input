import assert from "node:assert/strict";
import { test } from "node:test";
import { registerCompatibleAiService } from "../src/ai-service-compat.ts";

const transcribe = async () => "ok";
const args = { id: "local-voice", displayName: "Voice", transcribe };

test("BB 0.44: first shape has transcribe and is accepted", () => {
  const seen: Record<string, unknown>[] = [];
  registerCompatibleAiService((declaration) => {
    seen.push(declaration);
    if (typeof declaration.transcribe !== "function") {
      throw new Error('must declare complete, transcribe, or both');
    }
  }, args);
  assert.equal(seen.length, 1);
  assert.equal(typeof seen[0]?.transcribe, "function");
  assert.deepEqual(seen[0]?.kinds, ["voice"]);
});

test("BB 0.44 strict: unknown kinds rejected, transcribe-only accepted", () => {
  const seen: Record<string, unknown>[] = [];
  registerCompatibleAiService((declaration) => {
    seen.push(declaration);
    if ("kinds" in declaration) {
      throw new Error("unrecognized key kinds");
    }
    if (typeof declaration.transcribe !== "function") {
      throw new Error('must declare complete, transcribe, or both');
    }
  }, args);
  assert.equal(seen.length, 2);
  assert.equal("kinds" in (seen[1] ?? {}), false);
  assert.equal(typeof seen[1]?.transcribe, "function");
});

test("BB 0.43: only kinds is accepted", () => {
  const seen: Record<string, unknown>[] = [];
  registerCompatibleAiService((declaration) => {
    seen.push(declaration);
    if (typeof declaration.transcribe === "function") {
      throw new Error("unrecognized key transcribe");
    }
    if (!Array.isArray(declaration.kinds)) {
      throw new Error("kinds required");
    }
  }, args);
  assert.equal(seen.length, 3);
  assert.deepEqual(seen[2]?.kinds, ["voice"]);
  assert.equal(seen[2]?.transcribe, undefined);
});
