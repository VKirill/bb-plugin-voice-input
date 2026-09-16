// Словарь терминов: список названий, которые распознавание коверкает.
// Список уходит в подсказку Whisper, где смещает гипотезы, и служит образцом
// для починки по костяку слова.

/**
 * Разобрать словарь из настройки: просто список терминов в правильном
 * написании, через запятую или по строкам.
 *
 *   DeepSeek, SelfyStudio, Claude Code, Gemini, OpenAI, env, BB
 *
 * Перечислять искажения не нужно — их находит починка по костяку слова.
 * Строка с решёткой — комментарий.
 */
export function parseVocabulary(raw: string): string[] {
  const terms: string[] = [];
  const seen = new Set<string>();
  for (const line of raw.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      continue;
    }
    for (const term of trimmed.split(",").map((value) => value.trim())) {
      const key = term.toLowerCase();
      if (term.length > 0 && !seen.has(key)) {
        seen.add(key);
        terms.push(term);
      }
    }
  }
  return terms;
}

/**
 * Подсказка для Whisper. Модель читает только последние ~224 токена, поэтому
 * список обрезается с начала: важные термины пользователь держит в конце.
 */
export function buildRecognitionPrompt(entries: string[], maxChars: number): string | null {
  if (entries.length === 0 || maxChars <= 0) {
    return null;
  }
  const terms = [...entries];
  let prompt = terms.join(", ");
  while (prompt.length > maxChars && terms.length > 1) {
    terms.shift();
    prompt = terms.join(", ");
  }
  return prompt.length > maxChars ? prompt.slice(prompt.length - maxChars) : prompt;
}
