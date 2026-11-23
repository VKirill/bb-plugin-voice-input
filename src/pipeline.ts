// Общая часть распознавания: облачные движки и обработка текста. Её вызывают и
// машина распознавания (host.ts), и сервер BB (server.ts). Облаку машина не
// нужна, поэтому при ключе на сервере облачная диктовка работает, даже когда
// выбранная машина выключена.
import type { EngineId, VoiceConfig } from "./contract.ts";
import { resolveAiPassKey, resolveProviderKey } from "./key-resolution.ts";
import { buildRecognitionPrompt, parseVocabulary } from "./vocabulary.ts";
import { cleanupText } from "./cleanup.ts";
import { repairTerms } from "./term-repair.ts";
import { runAiPass } from "./ai-pass.ts";
import { guardAiPass } from "./ai-pass-guard.ts";
import { transcribeGemini, transcribeOpenAi } from "./cloud.ts";
import { dictionary } from "./i18n/index.ts";

/** Подсказка Whisper читается моделью лишь частично — держим бюджет Voica. */
const PROMPT_BUDGET_CHARS = 800;
const AI_PASS_TIMEOUT_MS = 30_000;

export type CloudEngine = "openai" | "google" | "groq";

export function isCloudEngine(engine: EngineId | string): engine is CloudEngine {
  return engine === "openai" || engine === "google" || engine === "groq";
}

/** Переменная окружения машины, из которой берётся ключ движка, или "". */
export function cloudKeyEnv(config: VoiceConfig, engine: CloudEngine): string {
  return engine === "groq"
    ? config.cloud.groqKeyEnv
    : engine === "openai"
      ? config.cloud.openaiKeyEnv
      : config.cloud.googleKeyEnv;
}

/** Ключ движка из конфига (свой или от ИИ-прохода с тем же адресом). */
export function cloudKey(config: VoiceConfig, engine: CloudEngine): string {
  return resolveProviderKey(config, engine).key;
}

/** Подсказка распознаванию из словаря, если она включена. */
export function recognitionHint(config: VoiceConfig): string | null {
  return config.vocabularyPrompt
    ? buildRecognitionPrompt(parseVocabulary(config.vocabulary), PROMPT_BUDGET_CHARS)
    : null;
}

/**
 * Распознать запись облачным движком. `key` уже выбран вызывающим: машина
 * учитывает переменную окружения, сервер — только ключи, которые знает сам.
 */
export async function transcribeCloud(
  config: VoiceConfig & { engine: CloudEngine },
  key: string,
  request: { audio: Buffer; filename: string; mimeType: string; prompt: string | null; timeoutMs: number },
): Promise<string> {
  const words = dictionary(config.uiLanguage).errors;
  const engine = config.engine;
  if (!key) {
    const keyEnv = cloudKeyEnv(config, engine);
    throw new Error(
      keyEnv
        ? words.keyEnvMissing(keyEnv)
        : words.keyRequired(engine === "groq" ? "Groq" : engine === "openai" ? "OpenAI" : "Google"),
    );
  }
  const payload = { ...request, language: config.language };
  if (engine === "google") {
    return await transcribeGemini(
      { baseUrl: config.cloud.googleBaseUrl, apiKey: key, model: config.cloud.googleModel },
      payload,
    );
  }
  const groq = engine === "groq";
  return await transcribeOpenAi(
    {
      baseUrl: groq ? config.cloud.groqBaseUrl : config.cloud.openaiBaseUrl,
      apiKey: key,
      model: groq ? config.cloud.groqModel : config.cloud.openaiModel,
      label: groq ? "Groq" : "OpenAI",
    },
    payload,
  );
}

/** Правила словаря, очистка и — если включён — проход модели. */
export async function postprocess(
  rawText: string,
  config: VoiceConfig,
  log: (message: string) => void,
  requireAiPass = false,
): Promise<string> {
  const aiPassKey = resolveAiPassKey(config).key;
  if (requireAiPass && (!config.aiPass.enabled || !config.aiPass.model.trim() || !aiPassKey.trim())) {
    throw new Error(dictionary(config.uiLanguage).improvement.configure);
  }
  const entries = parseVocabulary(config.vocabulary);
  let text = rawText;

  // Искажения ищутся сравнением по согласному костяку: непохожее не трогается.
  if (config.vocabularyRepair && entries.length > 0) {
    text = repairTerms(text, entries);
  }
  text = cleanupText(text, {
    fillers: config.cleanupFillers,
    quotes: config.cleanupQuotes,
    language: config.language,
  });

  if (config.aiPass.enabled && (config.aiPass.trigger === "automatic" || requireAiPass) && config.aiPass.model && aiPassKey) {
    try {
      const intent = config.aiPass.mode === "intent";
      // Для контекстной редактуры сохраняем исходные слова, до эвристических замен.
      const corrected = await runAiPass(intent ? rawText : text, {
        baseUrl: config.aiPass.baseUrl,
        model: config.aiPass.model,
        apiKey: aiPassKey,
        vocabulary: entries,
        timeoutMs: AI_PASS_TIMEOUT_MS,
        mode: config.aiPass.mode,
        prompt: config.aiPass.prompt,
        uiLanguage: config.uiLanguage,
      });
      // Пословная защита нужна только строгому режиму: иначе она отменяет редактуру.
      text = intent ? corrected : guardAiPass(text, corrected, entries);
    } catch (error) {
      if (requireAiPass) throw error;
      // Текст после правил уже пригоден — сбой прохода не должен его отменять.
      log(`ИИ-проход пропущен: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return text;
}

/**
 * Сырой текст → готовый: защита от повтора подсказки на тишине, правила,
 * ИИ-проход. Пустой результат — это «речи нет», а не пустая вставка.
 */
export async function finishTranscript(rawText: string, hint: string | null, config: VoiceConfig): Promise<string> {
  let raw = rawText;
  // Защита от галлюцинаций Whisper при тишине на записи:
  // если модель просто повторила подсказку словаря
  if (hint && raw.trim().length > 0) {
    const normRaw = raw.replace(/[,.\s]/g, "").toLowerCase();
    const normHint = hint.replace(/[,.\s]/g, "").toLowerCase();
    if (normRaw === normHint) {
      raw = "";
    }
  }
  const text = await postprocess(raw, config, () => {});
  if (!text.trim()) {
    throw new Error(dictionary(config.uiLanguage).system.noSpeech);
  }
  return text;
}
