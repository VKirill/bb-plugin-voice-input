// Языки интерфейса. Английский — язык по умолчанию: плагином пользуются не
// только там, где говорят по-русски.
import type { Dictionary } from "./types.ts";
import { en } from "./en.ts";
import { ru } from "./ru.ts";
import { es } from "./es.ts";
import { de } from "./de.ts";
import { fr } from "./fr.ts";
import { pt } from "./pt.ts";
import { zh } from "./zh.ts";
import { ja } from "./ja.ts";

export const UI_LANGUAGES = ["en", "ru", "es", "de", "fr", "pt", "zh", "ja"] as const;
export type UiLanguage = (typeof UI_LANGUAGES)[number];

export const LANGUAGE_NAMES: Record<UiLanguage, string> = {
  en: "English",
  ru: "Русский",
  es: "Español",
  de: "Deutsch",
  fr: "Français",
  pt: "Português",
  zh: "中文",
  ja: "日本語",
};

const DICTIONARIES: Record<UiLanguage, Dictionary> = { en, ru, es, de, fr, pt, zh, ja };

export function dictionary(language: string): Dictionary {
  return DICTIONARIES[language as UiLanguage] ?? en;
}

export type { Dictionary };
