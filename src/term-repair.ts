// Починка искажённых терминов по «костяку» слова.
//
// Подход и пороги перенесены из Voica (https://github.com/Inhum/voica,
// Sources/Normalizer.swift, MIT): распознавание теряет и путает гласные, а
// согласные держатся, поэтому слова сравниваются по согласному костяку.
// Пороги там вымерены на живой истории диктовок, и мы не придумываем свои.
//
// Точные правила словаря («Claude Code = клодкод») остаются первым слоем: они
// предсказуемы и чинят то, что пользователь описал сам. Этот слой добирает
// искажения, которых в словаре нет.

/** Кириллица → латиница. Ключи только строчные: вход приводится к нижнему регистру. */
const TRANSLIT: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z",
  и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
  с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch",
  ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

const VOWELS = "aeiouy";

/**
 * Слово написано в двух алфавитах сразу. В нормальном русском тексте так не
 * бывает — это след движка, который пишет иностранные слова вперемешку
 * («Dпсик»). Признак надёжнее фонетической близости и не даёт ложных
 * срабатываний на обычном тексте.
 */
export function hasMixedScript(word: string): boolean {
  let latin = false;
  let cyrillic = false;
  for (const character of word.toLowerCase()) {
    if (TRANSLIT[character] !== undefined) {
      cyrillic = true;
    } else if (/[a-z]/u.test(character)) {
      latin = true;
    }
    if (latin && cyrillic) {
      return true;
    }
  }
  return false;
}

/**
 * Согласный костяк: транслитерируем, выкидываем гласные, сводим `c` к `k`,
 * схлопываем повторы. «Dпсик», «Dpсиcк» и «Deepsc» дают тот же костяк `dpsk`,
 * что и сам DeepSeek.
 */
export function skeleton(value: string): string {
  let out = "";
  for (const character of value.toLowerCase()) {
    let piece: string;
    const translit = TRANSLIT[character];
    if (translit !== undefined) {
      piece = translit;
    } else if (/[a-z]/u.test(character)) {
      piece = character;
    } else {
      continue; // цифры, дефисы, пунктуация — мимо
    }
    for (const letter of piece) {
      if (VOWELS.includes(letter)) {
        continue;
      }
      const folded = letter === "c" ? "k" : letter;
      if (out.at(-1) !== folded) {
        out += folded;
      }
    }
  }
  return out;
}

/** Слово в латинице: для побуквенного сравнения искажения с термином. */
function latinized(value: string): string {
  let out = "";
  for (const character of value.toLowerCase()) {
    const translit = TRANSLIT[character];
    if (translit !== undefined) {
      out += translit;
    } else if (/[a-z]/u.test(character)) {
      out += character;
    }
  }
  return out;
}

/** Расстояние Левенштейна, приведённое к доле совпадения (1 — одинаковые). */
export function similarity(a: string, b: string): number {
  if (a === b) {
    return 1;
  }
  if (a.length === 0 || b.length === 0) {
    return 0;
  }
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  let current = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        previous[j]! + 1,
        current[j - 1]! + 1,
        previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    [previous, current] = [current, previous];
  }
  return 1 - previous[b.length]! / Math.max(a.length, b.length);
}

/** Термин записан латиницей — значит в русском тексте не склоняется. */
function isLatinTerm(term: string): boolean {
  return ![...term.toLowerCase()].some((character) => TRANSLIT[character] !== undefined);
}

/** Слова идут подряд, а не через конец предложения. */
function joinable(separator: string): boolean {
  return (
    separator.length > 0 && [...separator].every((c) => c === " " || c === "-" || c === "‑")
  );
}

/**
 * Канонический термин для искажённого слова, либо null — не трогать.
 *
 * Требования к кандидатам разные, и мягкость позволительна ровно настолько,
 * насколько доказана порча: смешанный алфавит доказывает сам себя, чистая
 * латиница не доказывает ничего, чистая кириллица — тем более. Иначе «депеша»
 * становится DeepSeek, а «Колодка» — Claude Code.
 */
function replacement(word: string, terms: string[], exactOnly: boolean): string | null {
  const mixed = hasMixedScript(word);
  const hasCyrillic = [...word.toLowerCase()].some((c) => TRANSLIT[c] !== undefined);
  const onlyLatin = !hasCyrillic;
  const onlyCyrillic = hasCyrillic && !mixed;

  const minSkeleton = mixed ? 2 : onlyCyrillic ? 4 : 3;
  const wordSkeleton = skeleton(word);
  if (wordSkeleton.length < minSkeleton) {
    return null;
  }

  let hits = terms.filter((term) => {
    if (!isLatinTerm(term)) {
      return false;
    }
    const termSkeleton = skeleton(term);
    if (termSkeleton === wordSkeleton) {
      return true;
    }
    if (exactOnly || !mixed || wordSkeleton.length < 3 || termSkeleton.length < 3) {
      return false;
    }
    return similarity(wordSkeleton, termSkeleton) >= 0.75;
  });

  if (onlyLatin) {
    const latinWord = latinized(word);
    hits = hits.filter((term) => similarity(latinWord, latinized(term)) >= 0.5);
  }
  if (hits.length === 0) {
    return null;
  }
  // Несколько терминов с одним костяком — берём ближайший по длине к сказанному.
  return hits.reduce((best, term) =>
    Math.abs(term.length - word.length) < Math.abs(best.length - word.length) ? term : best,
  );
}

/**
 * Заменить искорёженные термины на канонические написания. Пунктуация и
 * пробелы сохраняются. Русские термины не трогаются: подстановка словарной
 * формы дала бы «отправь оферта» — склонение требует понимания смысла, это
 * работа ИИ-прохода.
 */
export function repairTerms(text: string, terms: string[]): string {
  const canonical = terms.map((term) => term.trim()).filter((term) => term.length > 0);
  if (canonical.length === 0) {
    return text;
  }

  // Речь режется на слова, а термин может быть составным («Tail scale» вместо
  // Tailscale), поэтому сопоставляем окнами — от длинных к коротким.
  const pieces: { separator: string; word: string }[] = [];
  let separator = "";
  let word = "";
  for (const character of text) {
    if (/[\p{L}\p{N}]/u.test(character)) {
      word += character;
    } else {
      if (word.length > 0) {
        pieces.push({ separator, word });
        separator = "";
        word = "";
      }
      separator += character;
    }
  }
  if (word.length > 0) {
    pieces.push({ separator, word });
    separator = "";
  }
  const trailing = separator;

  // Движок перекашивает в обе стороны: «Claude Code» приезжает одним словом
  // «клодкод», а «Tailscale» — двумя. Двух слов хватает, шире — лишний риск.
  const MAX_WINDOW = 2;
  let out = "";
  let index = 0;
  while (index < pieces.length) {
    let matched = false;
    for (let size = Math.min(MAX_WINDOW, pieces.length - index); size >= 1; size -= 1) {
      const window = pieces.slice(index, index + size);
      const gapsOK = size === 1 || window.slice(1).every((piece) => joinable(piece.separator));
      // В склейке каждое слово должно давать хоть одну согласную, иначе окно
      // проглатывает союз: «дипсик и» даёт тот же костяк, что и «дипсик».
      const allSubstantial = size === 1 || window.every((piece) => skeleton(piece.word).length > 0);
      // Однобуквенное слово в начале окна — предлог, а не часть термина:
      // «в Оларант» иначе целиком становится Valorant и съедает «в».
      // В конце окна одна буква законна: «Mail X» — это MLX.
      const leadingPreposition = size > 1 && [...window[0]!.word].length === 1;
      if (!gapsOK || !allSubstantial || leadingPreposition) {
        continue;
      }
      const joined = window.map((piece) => piece.word).join("");
      const term = replacement(joined, canonical, size > 1);
      if (term) {
        out += pieces[index]!.separator + term;
        index += size;
        matched = true;
        break;
      }
    }
    if (!matched) {
      out += pieces[index]!.separator + pieces[index]!.word;
      index += 1;
    }
  }
  return out + trailing;
}
