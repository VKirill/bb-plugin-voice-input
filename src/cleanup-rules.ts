// Слова-паразиты и кавычки у каждого языка свои: «э-э-э» и «ну-у-у» ничего не
// значат для английского текста, а “curly quotes” неуместны в русском.
// Здесь собрано то, что можно чинить, не рискуя испортить обычные слова.

export type CleanupLanguage = "ru" | "en" | "de" | "fr" | "es" | "pt" | "it";

export type QuoteStyle = {
  open: string;
  close: string;
  /** Французский ставит внутри кавычек узкий неразрывный пробел. */
  innerSpace: boolean;
};

export const QUOTE_STYLES: Record<CleanupLanguage, QuoteStyle> = {
  ru: { open: "«", close: "»", innerSpace: false },
  de: { open: "„", close: "“", innerSpace: false },
  fr: { open: "«", close: "»", innerSpace: true },
  es: { open: "«", close: "»", innerSpace: false },
  pt: { open: "“", close: "”", innerSpace: false },
  it: { open: "«", close: "»", innerSpace: false },
  en: { open: "“", close: "”", innerSpace: false },
};

/**
 * Междометия, которые в тексте не значат ничего. Сюда попадают только те, что
 * не совпадают с обычными словами языка: испанское «este» или английское «like»
 * встречаются как полноценные слова, и трогать их нельзя.
 */
const FILLER_WORDS: Record<CleanupLanguage, string[]> = {
  ru: ["э", "ээ", "эээ", "мм", "ммм", "хм", "хмм", "эм", "эмм"],
  en: ["uh", "uhh", "um", "umm", "uhm", "erm", "hmm", "hmmm", "mmm"],
  de: ["äh", "ähm", "ähh", "hmm", "mhm", "öh"],
  fr: ["euh", "heu", "hum", "hmm", "bah"],
  es: ["eh", "ehh", "mmm", "hmm"],
  pt: ["hã", "hmm", "mmm", "ãhn"],
  it: ["ehm", "mmm", "hmm", "boh"],
};

/** Буквы, растягивание которых говорит о заминке, а не о слове. */
const STRETCHED_LETTERS: Record<CleanupLanguage, string> = {
  ru: "эамнх",
  en: "uameh",
  de: "äamh",
  fr: "eauh",
  es: "eamh",
  pt: "eamh",
  it: "eamh",
};

export function fillerPatterns(language: CleanupLanguage): RegExp[] {
  const words = FILLER_WORDS[language].sort((left, right) => right.length - left.length);
  const letters = STRETCHED_LETTERS[language];
  return [
    // Растянутая буква: «э-э-э», «uh-uh-uh».
    new RegExp(`(?<![\\p{L}\\p{N}])([${letters}])(?:[-\\s]*\\1)+(?![\\p{L}\\p{N}])`, "giu"),
    // Слово-междометие целиком.
    new RegExp(`(?<![\\p{L}\\p{N}])(?:${words.join("|")})(?![\\p{L}\\p{N}])`, "giu"),
  ];
}

/**
 * Какому языку принадлежит текст. Кириллица определяется надёжно; для латиницы
 * язык берётся из настройки, потому что по одним буквам его не различить.
 */
export function detectLanguage(text: string, configured: string): CleanupLanguage {
  if (configured !== "auto" && configured in QUOTE_STYLES) {
    return configured as CleanupLanguage;
  }
  return /\p{Script=Cyrillic}/u.test(text) ? "ru" : "en";
}
