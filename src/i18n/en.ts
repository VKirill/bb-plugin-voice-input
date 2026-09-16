import type { Dictionary } from "./types.ts";

export const en: Dictionary = {
  tabs: { general: "General", dictation: "Dictation", vocabulary: "Vocabulary", cloud: "Cloud", data: "Data" },
  language: { label: "Interface language" },

  engines: {
    whisper: { title: "Whisper (MLX)", hint: "Multilingual, keeps tool names intact. Default choice." },
    gigaam: { title: "GigaAM v3", hint: "Russian with punctuation, the fastest one. Garbles Latin names — the vocabulary fixes that." },
    groq: { title: "Groq (cloud)", hint: "whisper-large-v3-turbo. Nothing to install, very fast; audio leaves your machine." },
    openai: { title: "OpenAI (cloud)", hint: "gpt-4o-transcribe. Nothing to install; audio leaves your machine." },
    google: { title: "Google (cloud)", hint: "gemini-3.5-transcribe. Nothing to install; audio leaves your machine." },
  },
  status: { ready: "ready", notInstalled: "not installed", needsKey: "needs a key", broken: "package does not import", loading: "Loading…" },

  general: {
    installEngine: "Install the engine",
    installing: "Installing — this takes minutes.",
    whisperModel: "Whisper model",
    whisperModelHint: "On Apple silicon the 4-bit large-v3 is about twice as fast as turbo and drops no speech.",
    speechLanguage: "Speech language",
    speechLanguageHint: "Auto-detect suits mixed speech; pick a language for short phrases.",
    languageAuto: "auto-detect",
    speechLanguages: { ru: "Russian", en: "English", de: "German", fr: "French", es: "Spanish", pt: "Portuguese", it: "Italian" },
    machineLine: (machine, python, ffmpeg) =>
      `Recognition runs on the BB server machine (${machine}) — you do not need to share its network, calls go through BB. Python: ${python} · ffmpeg: ${ffmpeg}`,
    notFound: "not found",
    downloading: (engine) => `Downloading the ${engine} model`,
  },

  dictation: {
    fillers: "Remove “uh”, “um”, “hmm”",
    fillersHint: "A stretched real word is straightened instead of dropped.",
    quotes: "Fix quotes and spacing",
    quotesHint: "Straight quotes become typographic ones, extra spaces go away.",
  },

  vocabulary: {
    placeholder: "DeepSeek, SelfyStudio, Claude Code, Gemini, OpenAI, env, BB",
    counter: (used, limit) => `${used} / ${limit} characters of the recognition hint.`,
    hint: "Names, jargon and foreign words that recognition garbles. Listing the garbled spellings is not needed — they are found by consonant skeleton.",
    repair: "Repair garbled terms",
    repairHint: "Matches words against the vocabulary by consonant skeleton: “Mail X” → MLX. Leaves anything unlike it alone.",
    prompt: "Hint the vocabulary to the model",
    promptHint: "The list goes into the recognition hint. Whisper uses it, GigaAM has no such input.",
    aiPass: "Fix terms with AI",
    aiPassHint: "A second pass after recognition: a language model repairs cases and names the rules missed. Adds a second or two and needs a key.",
    provider: "Provider",
    providerCustom: "custom endpoint",
    model: "Model",
    apiUrl: "API address",
    apiUrlHint: "OpenAI-compatible, for example https://api.openai.com/v1.",
    keyAt: "Get the key here:",
  },

  cloud: {
    notice: "Cloud engines install nothing and take no disk space, but your audio goes to the provider. Local engines never send it anywhere.",
    freeTier: "has a free tier",
    select: "select",
    selected: "selected",
    model: "Model",
    apiUrl: "API address",
    key: "Key",
    keySaved: "Key saved.",
    keyMissing: "No key yet.",
    keyBorrowed: (provider) => `Using the ${provider} key: same address, no need to enter it twice.`,
    keyPlaceholder: "API key",
    keyManual: "Enter the key manually",
    keyFromCatalog: (name) => `Key comes from Env Catalog: ${name}.`,
    replace: "Replace",
    save: "Save",
  },

  data: {
    saveRecordings: "Keep recordings",
    saveRecordingsHint: "While the recording is on disk, a failed transcription does not destroy what you said.",
    keepDays: "Delete recordings older than, days",
    keepDaysHint: "0 — keep forever.",
    recordingsCount: (count) => `Recordings kept: ${count}`,
    modelsTitle: "Models on the machine",
    modelsEmpty: "No models downloaded yet. They appear after the first transcription or the Download button.",
    inUse: "in use",
    delete: "Delete",
    freed: (size) => `Freed ${size}`,
    nothingToDelete: "Nothing to delete",
    noModelSize: "not on disk",
  },

  providerNotes: {
    transcribe: {
      groq: "Free tier: 2,000 requests and 8 hours of audio a day, files up to 25 MB. Transcribes hundreds of times faster than real time.",
      openai: "Paid per minute: gpt-4o-transcribe is more accurate, mini is cheaper.",
      google: "Key from Google AI Studio, which has free limits. gemini-3.5-transcribe is a dedicated speech model.",
    },
    aiPass: {
      groq: "Free tier and low latency — a correction takes about a second.",
      opencode: "Free OpenCode text models. They cannot transcribe speech, but they can correct a transcript.",
      openai: "Paid, but correcting text is cheap: mini is enough.",
    },
  },

  credits: {
    borrowed:
      "This plugin is an adaptation of Voica for BB. Voica is a macOS dictation app created by Ivan Ushakov.",
    authorship: "Our thanks to the author for the open source code and the well-crafted solutions. © Ivan Ushakov, MIT.",
    website: "Website",
    source: "Source",
    author: "Author",
  },

  errors: { machineUnreachable: (reason) => `The recognition machine is unreachable: ${reason}` },
};
