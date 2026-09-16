// Необязательный проход модели по распознанному тексту: то, что правилам не
// под силу — падежи, сильно искажённые термины, расстановка абзацев.
// Промпт запрещает пересказ: пользователь хочет свою речь, а не её изложение.

export type AiPassOptions = {
  baseUrl: string;
  model: string;
  apiKey: string;
  /** Словарь терминов: модели показывают, к чему подтягивать искажения. */
  vocabulary: string[];
  timeoutMs: number;
};

/**
 * Промпт перенесён из Voica (`Sources/GroqClient.swift`, MIT) и намеренно узкий:
 * модель правит только термины из словаря и ничего больше. Широкая формулировка
 * вроде «исправь ошибки распознавания» приводит к тому, что модель переписывает
 * верные слова и теряет предлоги — проверено на живой записи.
 */
function buildPrompt(text: string, vocabulary: string[]): string | null {
  if (vocabulary.length === 0) {
    return null;
  }
  return [
    "Ты — корректор диктовки. Ниже словарь терминов пользователя и распознанный текст.",
    "В тексте могут встречаться искажённые варианты этих терминов (речь распознавалась на слух).",
    "Верни ТОЛЬКО исправленный текст: замени искажённые варианты на правильные написания из словаря,",
    "согласуя с падежом и контекстом. Если под искажение подходят несколько терминов словаря —",
    "выбирай наиболее близкий по ЗВУЧАНИЮ к тому, что записано. Если слово в тексте уже совпадает",
    "со словарным термином (пусть и в другом регистре) — оно правильное: не трогай его и не меняй",
    "регистр. Больше ничего не меняй — ни слова, ни пунктуацию. Если исправлять нечего — верни",
    "текст как есть.",
    "",
    `СЛОВАРЬ: ${vocabulary.join(", ")}`,
    "",
    `ТЕКСТ: ${text}`,
  ].join(" ");
}

/**
 * Убрать рассуждения reasoning-моделей. Они пишут ход мысли прямо в ответе
 * тегом `<think>…</think>`, и без вычистки он уезжает в текст пользователя.
 * Незакрытый тег означает обрыв по лимиту токенов — полезного текста дальше нет.
 */
export function stripReasoning(value: string): string {
  let out = value.replace(/<think[^>]*>[\s\S]*?<\/think>/giu, "");
  out = out.replace(/<think[^>]*>[\s\S]*/giu, "");
  return out.trim();
}

export async function runAiPass(
  text: string,
  options: AiPassOptions,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const prompt = buildPrompt(text, options.vocabulary);
  if (!prompt) {
    // Без словаря проходу нечего исправлять, а лишний запрос только тормозит.
    return text;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const response = await fetchImpl(`${trimTrailingSlash(options.baseUrl)}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${options.apiKey}`,
      },
      body: JSON.stringify({
        model: options.model,
        temperature: 0,
        max_completion_tokens: 4096,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`ИИ-проход вернул HTTP ${response.status}`);
    }
    const payload: unknown = await response.json();
    const content = readContent(payload);
    if (!content) {
      throw new Error("ИИ-проход вернул пустой ответ");
    }
    const cleaned = stripReasoning(content);
    // Пустой результат после вычистки означает, что модель прислала одни
    // рассуждения: текст после правил лучше, чем ничего.
    return cleaned.length > 0 ? cleaned : text;
  } finally {
    clearTimeout(timer);
  }
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/u, "");
}

function readContent(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return null;
  }
  const message = (choices[0] as { message?: { content?: unknown } }).message;
  return typeof message?.content === "string" ? message.content : null;
}
