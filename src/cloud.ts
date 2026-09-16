// Облачные движки распознавания: OpenAI и Google.
//
// Они не требуют ни Python, ни моделей на диске, но аудио уходит наружу —
// в отличие от локальных движков. Выбор между скоростью установки и
// приватностью остаётся за пользователем и виден прямо в настройках.
import { Blob } from "node:buffer";

export type CloudCredentials = {
  baseUrl: string;
  apiKey: string;
  model: string;
};

export type CloudRequest = {
  audio: Buffer;
  filename: string;
  mimeType: string;
  /** `auto` — пусть решает сама модель. */
  language: string;
  /** Словарь терминов: обе службы принимают его как подсказку. */
  prompt: string | null;
  timeoutMs: number;
};

function trimSlash(value: string): string {
  return value.replace(/\/+$/u, "");
}

function languageCode(language: string): string | null {
  if (language === "ru") {
    return "ru-RU";
  }
  if (language === "en") {
    return "en-US";
  }
  return null;
}

async function withTimeout<T>(
  timeoutMs: number,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await run(controller.signal);
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error("timeout");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/** OpenAI-совместимый multipart: whisper-1, gpt-4o-transcribe и их аналоги. */
export async function transcribeOpenAi(
  credentials: CloudCredentials,
  request: CloudRequest,
): Promise<string> {
  const form = new FormData();
  form.set("model", credentials.model);
  form.set("file", new Blob([request.audio], { type: request.mimeType }), request.filename);
  if (request.language !== "auto") {
    form.set("language", request.language);
  }
  if (request.prompt) {
    form.set("prompt", request.prompt);
  }

  const response = await withTimeout(request.timeoutMs, (signal) =>
    fetch(`${trimSlash(credentials.baseUrl)}/audio/transcriptions`, {
      method: "POST",
      headers: { authorization: `Bearer ${credentials.apiKey}` },
      body: form,
      signal,
    }),
  );

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`OpenAI ответил HTTP ${response.status}: ${errorMessage(payload)}`);
  }
  const text = readString(payload, "text");
  if (text === null) {
    throw new Error("OpenAI вернул ответ без текста");
  }
  return text.trim();
}

/**
 * Google Gemini. У моделей `*-transcribe` свой путь: файл сначала уходит в
 * Files API, затем распознаётся через Interactions. Обычные мультимодальные
 * модели принимают аудио прямо в запросе, поэтому для них используется
 * generateContent — так настройка работает и с gemini-3.5-transcribe, и с
 * обычным gemini-флэш.
 */
export async function transcribeGemini(
  credentials: CloudCredentials,
  request: CloudRequest,
): Promise<string> {
  const base = trimSlash(credentials.baseUrl);
  const headers = { "x-goog-api-key": credentials.apiKey };

  if (!credentials.model.includes("transcribe")) {
    return await transcribeGeminiInline(base, headers, credentials, request);
  }

  const uploaded = await withTimeout(request.timeoutMs, (signal) =>
    fetch(`${base}/upload/v1beta/files?uploadType=media`, {
      method: "POST",
      headers: { ...headers, "content-type": request.mimeType },
      body: new Uint8Array(request.audio),
      signal,
    }),
  );
  const uploadPayload: unknown = await uploaded.json().catch(() => null);
  if (!uploaded.ok) {
    throw new Error(`Google не принял файл, HTTP ${uploaded.status}: ${errorMessage(uploadPayload)}`);
  }
  const fileUri = readNestedString(uploadPayload, ["file", "uri"]);
  if (!fileUri) {
    throw new Error("Google не вернул ссылку на загруженный файл");
  }

  const code = languageCode(request.language);
  const body: Record<string, unknown> = {
    model: credentials.model,
    input: [{ type: "audio", uri: fileUri, mime_type: request.mimeType }],
  };
  if (code) {
    body.generation_config = { transcription_config: { language_codes: [code] } };
  }

  const response = await withTimeout(request.timeoutMs, (signal) =>
    fetch(`${base}/v1beta/interactions`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    }),
  );
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`Google ответил HTTP ${response.status}: ${errorMessage(payload)}`);
  }
  const text =
    readNestedString(payload, ["interaction", "output_text"]) ?? readString(payload, "output_text");
  if (text === null) {
    throw new Error("Google вернул ответ без текста");
  }
  return text.trim();
}

async function transcribeGeminiInline(
  base: string,
  headers: Record<string, string>,
  credentials: CloudCredentials,
  request: CloudRequest,
): Promise<string> {
  const instruction = [
    "Запиши дословную расшифровку речи из аудио.",
    "Верни только текст расшифровки, без пояснений и комментариев.",
    request.prompt ? `Термины, которые должны выглядеть именно так: ${request.prompt}.` : "",
  ]
    .filter(Boolean)
    .join(" ");

  const response = await withTimeout(request.timeoutMs, (signal) =>
    fetch(`${base}/v1beta/models/${credentials.model}:generateContent`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: instruction },
              {
                inline_data: {
                  mime_type: request.mimeType,
                  data: request.audio.toString("base64"),
                },
              },
            ],
          },
        ],
        generationConfig: { temperature: 0 },
      }),
      signal,
    }),
  );

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`Google ответил HTTP ${response.status}: ${errorMessage(payload)}`);
  }
  const parts = readParts(payload);
  if (parts === null) {
    throw new Error("Google вернул ответ без текста");
  }
  return parts.trim();
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(payload: unknown, key: string): string | null {
  const object = asObject(payload);
  const value = object?.[key];
  return typeof value === "string" ? value : null;
}

function readNestedString(payload: unknown, path: string[]): string | null {
  let current: unknown = payload;
  for (const key of path) {
    current = asObject(current)?.[key];
  }
  return typeof current === "string" ? current : null;
}

function readParts(payload: unknown): string | null {
  const candidates = asObject(payload)?.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return null;
  }
  const parts = asObject(asObject(candidates[0])?.content)?.parts;
  if (!Array.isArray(parts)) {
    return null;
  }
  const text = parts
    .map((part) => (typeof asObject(part)?.text === "string" ? (asObject(part)!.text as string) : ""))
    .join("");
  return text.length > 0 ? text : null;
}

function errorMessage(payload: unknown): string {
  const error = asObject(payload)?.error;
  const message = asObject(error)?.message ?? readString(payload, "message");
  return typeof message === "string" ? message : "ответ без описания ошибки";
}
