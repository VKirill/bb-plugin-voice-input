// Очистка распознанного текста. Правила независимы и отключаются по отдельности:
// расшифровке интервью нужны слова-паразиты, а заметке — нет. Набор междометий
// и вид кавычек зависят от языка речи: см. cleanup-rules.ts.
import {
  detectLanguage,
  fillerPatterns,
  QUOTE_STYLES,
  type CleanupLanguage,
} from "./cleanup-rules.ts";

export type CleanupOptions = {
  /** Убирать тянущиеся «э-э-э», «uh», «ähm». */
  fillers: boolean;
  /** Прямые кавычки → принятые в языке, пробел после двоеточия, непарная прочь. */
  quotes: boolean;
  /** Язык речи из настроек: «auto» — определить по тексту. */
  language: string;
};

/** Растянутое настоящее слово не удаляется, а распрямляется: «ну-у-у» → «ну». */
const STRETCHED_WORD = /(?<![\p{L}\p{N}])(\p{L}{1,10}?)([\p{L}])(?:-\2)+(?![\p{L}\p{N}])/giu;

export function cleanupText(text: string, options: CleanupOptions): string {
  const language = detectLanguage(text, options.language);
  let result = text;
  if (options.fillers) {
    result = removeFillers(result, language);
  }
  if (options.quotes) {
    result = fixQuotes(result, language);
  }
  return collapseSpacing(result);
}

function removeFillers(text: string, language: CleanupLanguage): string {
  // Порядок важен: сначала распрямить «ну-у-у», потом убирать междометия,
  // иначе распрямление превратит их обратно в слова.
  let result = text.replace(STRETCHED_WORD, (_match, head: string, letter: string) => `${head}${letter}`);
  for (const pattern of fillerPatterns(language)) {
    result = result.replace(pattern, "");
  }
  // Запятая или тире, осиротевшие после удалённого междометия. Пробел после
  // точки при этом обязан уцелеть, иначе предложения слипаются.
  result = result.replace(/([.!?])\s*[,—-]+\s*/gu, "$1 ");
  result = result.replace(/^\s*[,—-]+\s*/u, "");
  result = result.replace(/\s+,/gu, ",");
  result = result.replace(/,\s*,/gu, ",");
  return result;
}

function fixQuotes(text: string, language: CleanupLanguage): string {
  const style = QUOTE_STYLES[language];
  const inner = style.innerSpace ? " " : "";
  let result = text.replace(
    /"([^"]*)"/gu,
    (_match, content: string) => `${style.open}${inner}${content}${inner}${style.close}`,
  );
  // Непарная кавычка, оставшаяся после обрезанной фразы.
  if ((result.match(/"/gu) ?? []).length === 1) {
    result = result.replace(/"/u, "");
  }
  result = result.replace(/:(?=[^\s\d])/gu, ": ");
  return result;
}

function collapseSpacing(text: string): string {
  return (
    text
      .replace(/[^\S\r\n]{2,}/gu, " ")
      .replace(/\s+([,.!?;:])/gu, "$1")
      // Движки, склеивающие куски длинной записи, теряют пробел между
      // предложениями: «связи.Это» читается как опечатка.
      .replace(/([.!?])(?=\p{Lu})/gu, "$1 ")
      .replace(/^\s+|\s+$/gu, "")
  );
}
