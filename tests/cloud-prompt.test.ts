import assert from "node:assert/strict";
import { test } from "node:test";
import {
  OPENAI_PROMPT_LIMIT,
  transcribeOpenAi,
  type CloudCredentials,
  type CloudRequest,
} from "../src/cloud.ts";

const credentials: CloudCredentials = {
  baseUrl: "https://api.example.com/v1",
  apiKey: "test-key",
  model: "gpt-4o-transcribe",
};

function cloudRequest(prompt: string): CloudRequest {
  return {
    audio: Buffer.from("audio"),
    filename: "clip.webm",
    mimeType: "audio/webm",
    language: "auto",
    prompt,
    timeoutMs: 5_000,
  };
}

/** Прогнать transcribeOpenAi со stub-fetch и вернуть поле prompt из формы. */
async function sentPrompt(prompt: string): Promise<FormDataEntryValue | null> {
  const original = globalThis.fetch;
  let form: FormData | null = null;
  try {
    globalThis.fetch = async (_input, init) => {
      form = init?.body as FormData;
      return new Response(JSON.stringify({ text: "ok" }), { status: 200 });
    };
    await transcribeOpenAi(credentials, cloudRequest(prompt));
  } finally {
    globalThis.fetch = original;
  }
  return form?.get("prompt") ?? null;
}

test("OpenAI prompt limit is 896 characters", () => {
  assert.equal(OPENAI_PROMPT_LIMIT, 896);
});

test("a prompt over the limit is clamped to its last characters", async () => {
  const prompt = "x".repeat(OPENAI_PROMPT_LIMIT + 7);
  assert.equal(prompt.length, 903);
  const sent = await sentPrompt(prompt);
  assert.equal(sent, prompt.slice(-OPENAI_PROMPT_LIMIT));
  assert.equal((sent as string).length, OPENAI_PROMPT_LIMIT);
});

test("a 100-character prompt is sent unchanged", async () => {
  const prompt = "термины для распознавания: ".padEnd(100, "я");
  assert.equal(prompt.length, 100);
  const sent = await sentPrompt(prompt);
  assert.equal(sent, prompt);
});
