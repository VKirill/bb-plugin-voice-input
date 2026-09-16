import type { Dictionary } from "./types.ts";

export const ru: Dictionary = {
  tabs: { general: "Основные", dictation: "Диктовка", vocabulary: "Словарь", cloud: "Облако", data: "Данные" },
  language: { label: "Язык интерфейса" },

  engines: {
    whisper: { title: "Whisper (MLX)", hint: "Многоязычный, держит названия инструментов. Выбор по умолчанию." },
    gigaam: { title: "GigaAM v3", hint: "Русский с пунктуацией, самый быстрый. Латиницу коверкает — лечит словарь." },
    groq: { title: "Groq (облако)", hint: "whisper-large-v3-turbo. Ставить нечего, очень быстро; аудио уходит наружу." },
    openai: { title: "OpenAI (облако)", hint: "gpt-4o-transcribe. Ставить нечего; аудио уходит наружу." },
    google: { title: "Google (облако)", hint: "gemini-3.5-transcribe. Ставить нечего; аудио уходит наружу." },
  },
  status: { ready: "готов", notInstalled: "не установлен", needsKey: "нужен ключ", broken: "пакет не импортируется", loading: "Загружаю…" },

  general: {
    installEngine: "Установить движок",
    installing: "Устанавливаю — это занимает минуты.",
    whisperModel: "Модель Whisper",
    whisperModelHint: "На Apple Silicon 4-битная large-v3 быстрее turbo примерно вдвое и не теряет фрагменты речи.",
    speechLanguage: "Язык речи",
    speechLanguageHint: "Автоопределение подходит для смешанной речи, для коротких фраз надёжнее указать язык.",
    languageAuto: "автоопределение",
    speechLanguages: { ru: "русский", en: "английский", de: "немецкий", fr: "французский", es: "испанский", pt: "португальский", it: "итальянский" },
    machineLine: (machine, python, ffmpeg) =>
      `Распознаёт машина сервера BB (${machine}) — к ней не нужно быть в одной сети, вызовы идут через BB. Python: ${python} · ffmpeg: ${ffmpeg}`,
    notFound: "не найден",
    downloading: (engine) => `Загружается модель ${engine}`,
  },

  dictation: {
    fillers: "Убирать слова-паразиты",
    fillersHint: "Растянутое настоящее слово не удаляется, а распрямляется: «ну-у-у» → «ну».",
    quotes: "Чинить кавычки и пробелы",
    quotesHint: "Прямые кавычки становятся типографскими, лишние пробелы убираются.",
  },

  vocabulary: {
    placeholder: "DeepSeek, SelfyStudio, Claude Code, Gemini, OpenAI, env, BB",
    counter: (used, limit) => `${used} / ${limit} символов подсказки.`,
    hint: "Названия, жаргон и англицизмы, которые распознавание коверкает. Перечислять искажения не нужно — их находит сравнение по согласному костяку.",
    repair: "Чинить искажённые термины",
    repairHint: "Сверяет слова со словарём по согласному костяку: «Mail X» → MLX. Непохожее не трогает.",
    prompt: "Подсказывать словарь модели",
    promptHint: "Список уходит в подсказку распознавания. Whisper её учитывает, у GigaAM такого входа нет.",
    aiPass: "Исправлять термины через ИИ",
    aiPassHint: "Второй проход после распознавания: языковая модель чинит падежи и названия, которые правила не узнали. Добавляет секунду-другую и требует ключа.",
    provider: "Провайдер",
    providerCustom: "свой адрес",
    model: "Модель",
    apiUrl: "Адрес API",
    apiUrlHint: "OpenAI-совместимый, например https://api.openai.com/v1.",
    keyAt: "Ключ заводится здесь:",
  },

  cloud: {
    notice: "Облачные движки ничего не устанавливают и не занимают места, но аудио уходит на сторону провайдера. Локальные движки этого не делают.",
    freeTier: "есть бесплатный уровень",
    select: "выбрать",
    selected: "выбран",
    model: "Модель",
    apiUrl: "Адрес API",
    key: "Ключ",
    keySaved: "Ключ сохранён.",
    keyMissing: "Ключ не задан.",
    keyBorrowed: (provider) => `Используется ключ ${provider}: адрес тот же, вводить второй раз не нужно.`,
    keyPlaceholder: "ключ API",
    keyManual: "Ввести ключ вручную",
    keyFromCatalog: (name) => `Ключ берётся из Env Catalog: ${name}.`,
    replace: "Заменить",
    save: "Сохранить",
  },

  data: {
    saveRecordings: "Сохранять записи",
    saveRecordingsHint: "Пока запись на диске, сбой распознавания не уничтожает сказанное.",
    keepDays: "Удалять записи старше, дней",
    keepDaysHint: "0 — хранить всегда.",
    recordingsCount: (count) => `Сохранено записей: ${count}`,
    modelsTitle: "Модели на диске машины",
    modelsEmpty: "Скачанных моделей нет. Они появятся после первого распознавания или кнопки «Скачать».",
    inUse: "используется",
    delete: "Удалить",
    freed: (size) => `Освобождено ${size}`,
    nothingToDelete: "Удалять нечего",
    noModelSize: "нет на диске",
  },

  providerNotes: {
    transcribe: {
      groq: "Бесплатный уровень: 2000 запросов и 8 часов аудио в сутки, файл до 25 МБ. Распознаёт в сотни раз быстрее реального времени.",
      openai: "Платно по минутам: gpt-4o-transcribe точнее, mini дешевле.",
      google: "Ключ из Google AI Studio, у него есть бесплатные лимиты. gemini-3.5-transcribe — отдельная модель распознавания.",
    },
    aiPass: {
      groq: "Бесплатный уровень и низкая задержка — правка занимает около секунды.",
      opencode: "Бесплатные текстовые модели OpenCode. Распознавать речь они не умеют, но править расшифровку — вполне.",
      openai: "Платно, но правка текста дешёвая: хватает mini.",
    },
  },

  credits: {
    borrowed:
      "Этот плагин — адаптация Voica для BB. Voica — приложение для диктовки на macOS, которое создал Иван Ушаков.",
    authorship: "Благодарим автора за открытый код и продуманные решения. © Ivan Ushakov, MIT.",
    website: "Сайт",
    source: "Исходники",
    author: "Автор",
  },

  errors: { machineUnreachable: (reason) => `Машина распознавания недоступна: ${reason}` },
};
