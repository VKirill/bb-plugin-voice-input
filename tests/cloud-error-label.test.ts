import assert from "node:assert/strict";
import { test } from "node:test";
import {
  transcribeOpenAi,
  type CloudCredentials,
  type CloudRequest,
} from "../src/cloud.ts";

const request: CloudRequest = {
  audio: Buffer.from([1]),
  filename: "a.webm",
  mimeType: "audio/webm",
  language: "ru",
  prompt: null,
  timeoutMs: 5_000,
};

test("cloud errors name the real provider", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({ error: { message: "bad prompt" } }, { status: 400 }),
  );
  for (const [label, prefix] of [
    ["Groq", "Groq ответил HTTP 400: bad prompt"],
    ["OpenAI", "OpenAI ответил HTTP 400: bad prompt"],
  ] as const) {
    const credentials: CloudCredentials = {
      baseUrl: "https://api.example.com/v1",
      apiKey: "k",
      model: "m",
      label,
    };
    await assert.rejects(transcribeOpenAi(credentials, request), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, new RegExp(`^${prefix}`, "u"));
      return true;
    });
  }
});
