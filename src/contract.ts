// Общая часть контракта сервера и хоста. Сервер знает настройки, но распознаёт хост —
// на машине, где работает сервер BB. Поэтому настройки пушатся на хост
// отдельным методом, а не передаются в ai.voice.transcribe: его схема строгая
// и принадлежит SDK.
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const ENGINE_IDS = ["whisper", "gigaam", "openai", "google", "groq"] as const;
export type EngineId = (typeof ENGINE_IDS)[number];

export const LANGUAGES = ["auto", "ru", "en", "de", "fr", "es", "pt", "it"] as const;

/** Что хост должен знать, чтобы распознать запись и привести текст в порядок. */
export const voiceConfigSchema = z
  .object({
    engine: z.enum(ENGINE_IDS),
    /** Репозиторий модели для Whisper; GigaAM берёт свою. */
    whisperModel: z.string().min(1),
    language: z.enum(LANGUAGES),
    vocabulary: z.string(),
    vocabularyRepair: z.boolean(),
    vocabularyPrompt: z.boolean(),
    cleanupFillers: z.boolean(),
    cleanupQuotes: z.boolean(),
    /** Облачные движки: аудио уходит наружу, поэтому ключи хранит сервер. */
    cloud: z
      .object({
        openaiBaseUrl: z.string(),
        openaiModel: z.string(),
        openaiApiKey: z.string(),
        /** Имя переменной окружения на машине; пусто — используется свой ключ. */
        openaiKeyEnv: z.string(),
        googleBaseUrl: z.string(),
        googleModel: z.string(),
        googleApiKey: z.string(),
        googleKeyEnv: z.string(),
        groqBaseUrl: z.string(),
        groqModel: z.string(),
        groqApiKey: z.string(),
        groqKeyEnv: z.string(),
      })
      .strict(),
    aiPass: z
      .object({
        enabled: z.boolean(),
        baseUrl: z.string(),
        model: z.string(),
        apiKey: z.string(),
        keyEnv: z.string(),
      })
      .strict(),
    saveRecordings: z.boolean(),
    keepDays: z.number().int().min(0),
  })
  .strict();

export type VoiceConfig = z.infer<typeof voiceConfigSchema>;

export const engineStatusSchema = z
  .object({
    engine: z.enum(ENGINE_IDS),
    ready: z.boolean(),
    detail: z.string(),
    /** Сколько занимает скачанная модель. 0 — модели ещё нет. */
    modelBytes: z.number(),
  })
  .strict();

export const historyEntrySchema = z
  .object({
    id: z.string(),
    createdAt: z.string(),
    engine: z.string(),
    durationMs: z.number(),
    audioPath: z.string().nullable(),
    rawText: z.string(),
    text: z.string(),
  })
  .strict();

/**
 * Методы, которые сервер вызывает у хоста. Сам голосовой контракт добавляется
 * в host-contract.ts: его вход `@get-bb/plugin-sdk/ai-services` доступен только
 * хосту, а серверная часть на path-установке грузится как обычный TypeScript.
 */
export const managementContract = defineRpcContract({
  /** Кто эта машина. Нужно, чтобы отличить машину сервера BB от остальных. */
  identify: {
    input: z.object({}).strict(),
    output: z.object({ hostname: z.string(), platform: z.string() }).strict(),
  },
  applyConfig: {
    input: z.object({ config: voiceConfigSchema }).strict(),
    output: z.object({ applied: z.literal(true) }).strict(),
  },
  setup: {
    input: z.object({ engine: z.enum(ENGINE_IDS), reinstall: z.boolean() }).strict(),
    output: z
      .object({ ready: z.boolean(), log: z.string(), detail: z.string() })
      .strict(),
  },
  status: {
    input: z.object({}).strict(),
    output: z
      .object({
        pythonPath: z.string().nullable(),
        ffmpegPath: z.string().nullable(),
        dataDir: z.string(),
        engines: z.array(engineStatusSchema),
        recordings: z.number().int(),
      })
      .strict(),
  },
  /** Скачать модель движка заранее, с прогрессом через сигналы. */
  downloadModel: {
    input: z.object({ engine: z.enum(ENGINE_IDS) }).strict(),
    output: z.object({ ready: z.boolean(), detail: z.string() }).strict(),
  },
  /** Имена переменных окружения, значения которых видит машина распознавания. */
  envKeys: {
    input: z.object({}).strict(),
    output: z.object({ names: z.array(z.string()) }).strict(),
  },
  /** Сохранить ключ провайдера на машине распознавания. */
  setSecret: {
    input: z
      .object({
        name: z.enum(["openaiApiKey", "googleApiKey", "groqApiKey", "aiPassApiKey"]),
        value: z.string(),
      })
      .strict(),
    output: z.object({ saved: z.literal(true) }).strict(),
  },
  /** Какие ключи заданы. Значения наружу не отдаются. */
  secretsStatus: {
    input: z.object({}).strict(),
    output: z
      .object({
        openaiApiKey: z.boolean(),
        googleApiKey: z.boolean(),
        groqApiKey: z.boolean(),
        aiPassApiKey: z.boolean(),
        /** Откуда берётся ключ прохода: свой или от провайдера с тем же адресом. */
        aiPassKeySource: z.enum(["own", "groq", "openai", "aiPass"]).nullable(),
      })
      .strict(),
  },
  /** Что из моделей лежит на диске машины распознавания. */
  listModels: {
    input: z.object({}).strict(),
    output: z
      .object({
        models: z.array(
          z
            .object({
              engine: z.string(),
              model: z.string(),
              path: z.string(),
              bytes: z.number(),
              active: z.boolean(),
            })
            .strict(),
        ),
      })
      .strict(),
  },
  /** Удалить конкретную модель и освободить место. */
  deleteModel: {
    input: z.object({ engine: z.enum(ENGINE_IDS), model: z.string() }).strict(),
    output: z.object({ freedBytes: z.number() }).strict(),
  },
  /** Распознать файл, уже лежащий на машине: проверка настройки и разбор старых записей. */
  transcribeFile: {
    input: z.object({ path: z.string().min(1), timeoutMs: z.number().int().positive() }).strict(),
    output: z
      .object({ engine: z.string(), durationMs: z.number(), rawText: z.string(), text: z.string() })
      .strict(),
  },
  historyList: {
    input: z.object({ limit: z.number().int().min(1).max(200) }).strict(),
    output: z.object({ entries: z.array(historyEntrySchema) }).strict(),
  },
});

/** Сигналы хоста: ход загрузки модели видно в интерфейсе, а не в логе. */
export const hostSignals = {
  modelProgress: {
    payload: z
      .object({
        engine: z.enum(ENGINE_IDS),
        percent: z.number().nullable(),
        downloadedBytes: z.number().nullable(),
        totalBytes: z.number().nullable(),
        state: z.enum(["downloading", "done", "error"]),
        message: z.string().nullable(),
      })
      .strict(),
  },
};

export const AI_SERVICE_ID = "local-voice";
