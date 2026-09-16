// Защита от самодеятельности модели в ИИ-проходе.
//
// Промпт запрещает менять что-либо кроме терминов словаря, но модель всё равно
// иногда переписывает обычные слова: на живой записи «винишко» стало
// «винилшко». Поэтому результат сверяется с исходным текстом пословно, и
// слово, которого не было ни в речи, ни в словаре, возвращается обратно.
import { similarity } from "./term-repair.ts";

/** Ниже этого сходства слово считается чужим, а не исправленной формой. */
const RESTORE_THRESHOLD = 0.6;

function normalize(word: string): string {
  return word.toLowerCase().replace(/ё/gu, "е");
}

function words(text: string): string[] {
  return text.match(/[\p{L}\p{N}][\p{L}\p{N}.-]*/gu) ?? [];
}

/**
 * Вернуть на место слова, которые модель выдумала. Слово принимается, если оно
 * звучало в исходном тексте или входит в словарь; иначе подставляется самое
 * похожее слово оригинала.
 */
export function guardAiPass(original: string, corrected: string, terms: string[]): string {
  const allowed = new Set<string>();
  for (const word of words(original)) {
    allowed.add(normalize(word));
  }
  for (const term of terms) {
    for (const part of words(term)) {
      allowed.add(normalize(part));
    }
    allowed.add(normalize(term.replace(/\s+/gu, "")));
  }

  const originalWords = words(original);

  return corrected.replace(/[\p{L}\p{N}][\p{L}\p{N}.-]*/gu, (word) => {
    const key = normalize(word);
    if (allowed.has(key)) {
      return word;
    }
    // Слово незнакомое: ищем, из чего оно могло получиться.
    let best: { word: string; score: number } | null = null;
    for (const candidate of originalWords) {
      const score = similarity(key, normalize(candidate));
      if (!best || score > best.score) {
        best = { word: candidate, score };
      }
    }
    return best && best.score >= RESTORE_THRESHOLD ? best.word : word;
  });
}
