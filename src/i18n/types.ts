// Словарь интерфейса. Английский — эталон и язык по умолчанию: плагин
// рассчитан не только на русскоязычных, хотя распознавание русского у него
// сильная сторона.

export type Dictionary = {
  tabs: { general: string; dictation: string; vocabulary: string; cloud: string; data: string };
  language: { label: string };

  engines: {
    whisper: { title: string; hint: string };
    gigaam: { title: string; hint: string };
    groq: { title: string; hint: string };
    openai: { title: string; hint: string };
    google: { title: string; hint: string };
  };
  status: { ready: string; notInstalled: string; needsKey: string; broken: string; loading: string };

  general: {
    installEngine: string;
    installing: string;
    whisperModel: string;
    whisperModelHint: string;
    speechLanguage: string;
    speechLanguageHint: string;
    languageAuto: string;
    /** Названия языков речи; ключ — код из LANGUAGES. */
    speechLanguages: Record<string, string>;
    machineLine: (machine: string, python: string, ffmpeg: string) => string;
    notFound: string;
    downloading: (engine: string) => string;
  };

  dictation: {
    fillers: string;
    fillersHint: string;
    quotes: string;
    quotesHint: string;
  };

  vocabulary: {
    placeholder: string;
    counter: (used: number, limit: number) => string;
    hint: string;
    repair: string;
    repairHint: string;
    prompt: string;
    promptHint: string;
    aiPass: string;
    aiPassHint: string;
    provider: string;
    providerCustom: string;
    model: string;
    apiUrl: string;
    apiUrlHint: string;
    keyAt: string;
  };

  cloud: {
    notice: string;
    freeTier: string;
    select: string;
    selected: string;
    model: string;
    apiUrl: string;
    key: string;
    keySaved: string;
    keyMissing: string;
    keyBorrowed: (provider: string) => string;
    keyPlaceholder: string;
    /** Первый пункт списка Env Catalog: ключ вводится в поле ниже. */
    keyManual: string;
    keyFromCatalog: (name: string) => string;
    replace: string;
    save: string;
  };

  data: {
    saveRecordings: string;
    saveRecordingsHint: string;
    keepDays: string;
    keepDaysHint: string;
    recordingsCount: (count: number) => string;
    modelsTitle: string;
    modelsEmpty: string;
    inUse: string;
    delete: string;
    freed: (size: string) => string;
    nothingToDelete: string;
    noModelSize: string;
  };

  /** Пояснения к облачным провайдерам: чем берёт и что с лимитами. */
  providerNotes: {
    transcribe: Record<"groq" | "openai" | "google", string>;
    aiPass: Record<"groq" | "opencode" | "openai", string>;
  };

  credits: {
    /** Плагин — адаптация приложения Voica для BB; авторство за Voica. */
    borrowed: string;
    authorship: string;
    website: string;
    source: string;
    author: string;
  };

  errors: { machineUnreachable: (reason: string) => string };
};
