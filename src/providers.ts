// Каталог облачных провайдеров: адрес, модели и где взять ключ.
//
// Пустое поле «модель» и голый адрес API — плохая настройка: пользователь не
// обязан помнить имена моделей и держать в голове, у кого какой endpoint.
// Здесь всё это собрано в одном месте и показывается в интерфейсе.

export type ProviderInfo = {
  /** Ключ пояснения в словаре интерфейса: `providerNotes`. */
  id: string;
  title: string;
  baseUrl: string;
  models: string[];
  /** Где завести ключ. */
  keyUrl: string;
  /** Есть заметный бесплатный уровень. */
  free: boolean;
};

/** Провайдеры распознавания речи. */
export const TRANSCRIBE_PROVIDERS: ProviderInfo[] = [
  {
    id: "groq",
    title: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    models: ["whisper-large-v3-turbo", "whisper-large-v3"],
    keyUrl: "https://console.groq.com/keys",
    free: true,
  },
  {
    id: "openai",
    title: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    models: ["gpt-4o-transcribe", "gpt-4o-mini-transcribe", "whisper-1"],
    keyUrl: "https://platform.openai.com/api-keys",
    free: false,
  },
  {
    id: "google",
    title: "Google",
    baseUrl: "https://generativelanguage.googleapis.com",
    models: ["gemini-3.5-transcribe", "gemini-3-flash"],
    keyUrl: "https://aistudio.google.com/apikey",
    free: true,
  },
];

/** Провайдеры для ИИ-прохода: правят уже распознанный текст. */
export const AI_PASS_PROVIDERS: ProviderInfo[] = [
  {
    id: "groq",
    title: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    models: ["openai/gpt-oss-120b", "llama-3.3-70b-versatile"],
    keyUrl: "https://console.groq.com/keys",
    free: true,
  },
  {
    id: "opencode",
    title: "OpenCode Zen",
    baseUrl: "https://opencode.ai/zen/v1",
    models: ["big-pickle", "deepseek-v4-flash", "mimo-v2.5"],
    keyUrl: "https://opencode.ai/auth",
    free: true,
  },
  {
    id: "openai",
    title: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    models: ["gpt-4o-mini", "gpt-4o"],
    keyUrl: "https://platform.openai.com/api-keys",
    free: false,
  },
];

export function findProvider(providers: ProviderInfo[], baseUrl: string): ProviderInfo | null {
  const normalized = baseUrl.replace(/\/+$/u, "");
  return providers.find((provider) => provider.baseUrl === normalized) ?? null;
}
