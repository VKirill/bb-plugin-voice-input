// Хранилище настроек плагина.
//
// Декларативные дескрипторы BB рендерит списком над страницей плагина, и для
// двух десятков настроек это полотно с прокруткой. Поэтому всё, кроме
// секретного ключа, живёт в собственном хранилище, а страница раскладывает их
// по вкладкам. Секрет остаётся дескриптором: BB держит его в файле 0600 и
// не отдаёт во фронтенд.
import { z } from "zod";
import { ENGINE_IDS, LANGUAGES } from "./contract.ts";
import { UI_LANGUAGES } from "./i18n/index.ts";

export const WHISPER_MODELS: Record<string, string> = {
  "large-v3 4-bit (быстрее, рекомендуется)": "mlx-community/whisper-large-v3-mlx-4bit",
  "large-v3 (полная точность)": "mlx-community/whisper-large-v3-mlx",
  turbo: "mlx-community/whisper-large-v3-turbo",
};

export const DEFAULT_WHISPER_MODEL = "large-v3 4-bit (быстрее, рекомендуется)";

export const storedSettingsSchema = z
  .object({
    uiLanguage: z.enum(UI_LANGUAGES),
    engine: z.enum(ENGINE_IDS),
    whisperModel: z.string(),
    language: z.enum(LANGUAGES),
    vocabulary: z.string(),
    vocabularyRepair: z.boolean(),
    vocabularyPrompt: z.boolean(),
    cleanupFillers: z.boolean(),
    cleanupQuotes: z.boolean(),
    openaiBaseUrl: z.string(),
    openaiModel: z.string(),
    openaiKeyEnv: z.string(),
    openaiKeyCatalog: z.string(),
    googleBaseUrl: z.string(),
    googleModel: z.string(),
    googleKeyEnv: z.string(),
    googleKeyCatalog: z.string(),
    groqBaseUrl: z.string(),
    groqModel: z.string(),
    groqKeyEnv: z.string(),
    groqKeyCatalog: z.string(),
    aiPassEnabled: z.boolean(),
    aiPassBaseUrl: z.string(),
    aiPassModel: z.string(),
    aiPassKeyEnv: z.string(),
    aiPassKeyCatalog: z.string(),
    saveRecordings: z.boolean(),
    keepDays: z.number().int().min(0).max(3650),
  })
  .strict();

export type StoredSettings = z.infer<typeof storedSettingsSchema>;

export const DEFAULT_SETTINGS: StoredSettings = {
  uiLanguage: "en",
  engine: "whisper",
  whisperModel: DEFAULT_WHISPER_MODEL,
  language: "auto",
  vocabulary: "",
  vocabularyRepair: true,
  vocabularyPrompt: true,
  cleanupFillers: true,
  cleanupQuotes: true,
  openaiBaseUrl: "https://api.openai.com/v1",
  openaiModel: "gpt-4o-transcribe",
  openaiKeyEnv: "",
  openaiKeyCatalog: "",
  googleBaseUrl: "https://generativelanguage.googleapis.com",
  googleModel: "gemini-3.5-transcribe",
  googleKeyEnv: "",
  googleKeyCatalog: "",
  groqBaseUrl: "https://api.groq.com/openai/v1",
  groqModel: "whisper-large-v3-turbo",
  groqKeyEnv: "",
  groqKeyCatalog: "",
  aiPassEnabled: false,
  aiPassBaseUrl: "https://api.openai.com/v1",
  aiPassModel: "",
  aiPassKeyEnv: "",
  aiPassKeyCatalog: "",
  saveRecordings: true,
  keepDays: 14,
};

/**
 * Прочитать сохранённое, добрав недостающее умолчаниями.
 *
 * Поля разбираются по одному, а не схемой целиком. Схема строгая, и при разборе
 * целиком один лишний ключ — например, оставшийся от настройки, которую убрали
 * в новой версии, — отправлял в умолчания всё сразу, вместе со словарём
 * пользователя. Потеря была молчаливой: настройки просто становились пустыми.
 */
export function mergeSettings(stored: unknown): StoredSettings {
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
    return DEFAULT_SETTINGS;
  }
  const source = stored as Record<string, unknown>;
  const result: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (!(key in source)) {
      continue;
    }
    const field = storedSettingsSchema.pick({ [key]: true } as never).safeParse({
      [key]: source[key],
    });
    if (field.success) {
      result[key] = source[key];
    }
  }
  return result as StoredSettings;
}

/** Отбросить чужие ключи и значения не того типа: правка приходит из браузера. */
export function sanitizePatch(patch: Record<string, unknown>): Partial<StoredSettings> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (key in DEFAULT_SETTINGS) {
      result[key] = value;
    }
  }
  const parsed = storedSettingsSchema.partial().safeParse(result);
  return parsed.success ? parsed.data : {};
}
