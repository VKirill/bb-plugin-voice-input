import type { Dictionary } from "./types.ts";

export const de: Dictionary = {
  tabs: { general: "Allgemein", dictation: "Diktat", vocabulary: "Wörterbuch", cloud: "Cloud", data: "Daten" },
  language: { label: "Sprache der Oberfläche" },

  engines: {
    whisper: { title: "Whisper (MLX)", hint: "Mehrsprachig und lässt Werkzeugnamen unangetastet. Voreinstellung." },
    gigaam: { title: "GigaAM v3", hint: "Russisch mit Zeichensetzung, am schnellsten. Lateinische Namen verstümmelt es — das behebt das Wörterbuch." },
    groq: { title: "Groq (Cloud)", hint: "whisper-large-v3-turbo. Nichts zu installieren, sehr schnell; die Aufnahme verlässt den Rechner." },
    openai: { title: "OpenAI (Cloud)", hint: "gpt-4o-transcribe. Nichts zu installieren; die Aufnahme verlässt den Rechner." },
    google: { title: "Google (Cloud)", hint: "gemini-3.5-transcribe. Nichts zu installieren; die Aufnahme verlässt den Rechner." },
  },
  status: { ready: "bereit", notInstalled: "nicht installiert", needsKey: "Schlüssel fehlt", broken: "Paket lässt sich nicht importieren", loading: "Lade…" },

  general: {
    installEngine: "Engine installieren",
    installing: "Installation läuft — das dauert Minuten.",
    whisperModel: "Whisper-Modell",
    whisperModelHint: "Auf Apple Silicon ist large-v3 in 4 Bit etwa doppelt so schnell wie turbo und verliert keine Passagen.",
    speechLanguage: "Gesprochene Sprache",
    speechLanguageHint: "Automatik passt zu gemischter Rede; bei kurzen Sätzen ist eine feste Sprache verlässlicher.",
    languageAuto: "automatisch",
    speechLanguages: { ru: "Russisch", en: "Englisch", de: "Deutsch", fr: "Französisch", es: "Spanisch", pt: "Portugiesisch", it: "Italienisch" },
    machineLine: (machine, python, ffmpeg) =>
      `Die Erkennung läuft auf dem BB-Server (${machine}) — dasselbe Netz ist nicht nötig, die Aufrufe gehen über BB. Python: ${python} · ffmpeg: ${ffmpeg}`,
    notFound: "nicht gefunden",
    downloading: (engine) => `Modell ${engine} wird geladen`,
  },

  dictation: {
    fillers: "Füllwörter entfernen",
    fillersHint: "Ein gedehntes echtes Wort wird geglättet statt gelöscht.",
    quotes: "Anführungszeichen und Abstände korrigieren",
    quotesHint: "Gerade Anführungszeichen werden typografisch, überflüssige Leerzeichen verschwinden.",
  },

  vocabulary: {
    placeholder: "DeepSeek, SelfyStudio, Claude Code, Gemini, OpenAI, env, BB",
    counter: (used, limit) => `${used} / ${limit} Zeichen des Erkennungshinweises.`,
    hint: "Namen, Fachjargon und Fremdwörter, die die Erkennung verstümmelt. Die verstümmelten Schreibweisen müssen Sie nicht aufzählen — sie werden über das Konsonantengerüst gefunden.",
    repair: "Verstümmelte Begriffe reparieren",
    repairHint: "Vergleicht Wörter über ihr Konsonantengerüst mit dem Wörterbuch: „Mail X“ → MLX. Unähnliches bleibt unberührt.",
    prompt: "Wörterbuch dem Modell mitgeben",
    promptHint: "Die Liste geht als Erkennungshinweis mit. Whisper berücksichtigt ihn, GigaAM kennt diese Eingabe nicht.",
    aiPass: "Begriffe per KI korrigieren",
    aiPassHint: "Ein zweiter Durchgang nach der Erkennung: ein Sprachmodell repariert Namen, die die Regeln nicht erkannt haben. Kostet ein bis zwei Sekunden und braucht einen Schlüssel.",
    provider: "Anbieter",
    providerCustom: "eigene Adresse",
    model: "Modell",
    apiUrl: "API-Adresse",
    apiUrlHint: "OpenAI-kompatibel, etwa https://api.openai.com/v1.",
    keyAt: "Schlüssel gibt es hier:",
  },

  cloud: {
    notice: "Cloud-Engines installieren nichts und belegen keinen Platz, aber die Aufnahme geht zum Anbieter. Lokale Engines senden nichts.",
    freeTier: "hat ein kostenloses Kontingent",
    select: "wählen",
    selected: "gewählt",
    model: "Modell",
    apiUrl: "API-Adresse",
    key: "Schlüssel",
    keySaved: "Schlüssel gespeichert.",
    keyMissing: "Kein Schlüssel.",
    keyBorrowed: (provider) => `Es wird der ${provider}-Schlüssel verwendet: gleiche Adresse, kein zweites Eintragen nötig.`,
    keyPlaceholder: "API-Schlüssel",
    keyManual: "Schlüssel manuell eingeben",
    keyFromCatalog: (name) => `Schlüssel kommt aus Env Catalog: ${name}.`,
    replace: "Ersetzen",
    save: "Speichern",
  },

  data: {
    saveRecordings: "Aufnahmen behalten",
    saveRecordingsHint: "Solange die Aufnahme auf der Platte liegt, vernichtet ein Fehlschlag das Gesagte nicht.",
    keepDays: "Aufnahmen löschen nach, Tagen",
    keepDaysHint: "0 — dauerhaft behalten.",
    recordingsCount: (count) => `Gespeicherte Aufnahmen: ${count}`,
    modelsTitle: "Modelle auf dem Rechner",
    modelsEmpty: "Noch keine Modelle geladen. Sie erscheinen nach der ersten Erkennung oder über „Herunterladen“.",
    inUse: "in Gebrauch",
    delete: "Löschen",
    freed: (size) => `${size} freigegeben`,
    nothingToDelete: "Nichts zu löschen",
    noModelSize: "nicht auf der Platte",
  },

  providerNotes: {
    transcribe: {
      groq: "Kostenlose Stufe: 2.000 Anfragen und 8 Stunden Audio pro Tag, Dateien bis 25 MB. Erkennt hundertfach schneller als Echtzeit.",
      openai: "Abrechnung pro Minute: gpt-4o-transcribe ist genauer, mini günstiger.",
      google: "Schlüssel aus Google AI Studio, dort gibt es kostenlose Limits. gemini-3.5-transcribe ist ein eigenes Sprachmodell.",
    },
    aiPass: {
      groq: "Kostenlose Stufe und geringe Latenz — eine Korrektur dauert etwa eine Sekunde.",
      opencode: "Kostenlose Textmodelle von OpenCode. Sprache erkennen sie nicht, ein Transkript korrigieren schon.",
      openai: "Kostenpflichtig, aber Textkorrektur ist günstig: mini genügt.",
    },
  },

  credits: {
    borrowed:
      "Dieses Plugin ist eine Adaption von Voica für BB. Voica ist eine Diktier-App für macOS, entwickelt von Ivan Ushakov.",
    authorship: "Herzlichen Dank an den Autor für den offenen Quellcode und die durchdachten Lösungen. © Ivan Ushakov, MIT.",
    website: "Website",
    source: "Quelltext",
    author: "Autor",
  },

  errors: { machineUnreachable: (reason) => `Der Erkennungsrechner ist nicht erreichbar: ${reason}` },
};
