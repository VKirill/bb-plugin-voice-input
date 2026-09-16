import type { Dictionary } from "./types.ts";

export const fr: Dictionary = {
  tabs: { general: "Général", dictation: "Dictée", vocabulary: "Lexique", cloud: "Cloud", data: "Données" },
  language: { label: "Langue de l’interface" },

  engines: {
    whisper: { title: "Whisper (MLX)", hint: "Multilingue et fidèle aux noms d’outils. Choix par défaut." },
    gigaam: { title: "GigaAM v3", hint: "Russe avec ponctuation, le plus rapide. Il écorche les noms en alphabet latin : le lexique corrige cela." },
    groq: { title: "Groq (cloud)", hint: "whisper-large-v3-turbo. Rien à installer, très rapide ; l’audio quitte votre machine." },
    openai: { title: "OpenAI (cloud)", hint: "gpt-4o-transcribe. Rien à installer ; l’audio quitte votre machine." },
    google: { title: "Google (cloud)", hint: "gemini-3.5-transcribe. Rien à installer ; l’audio quitte votre machine." },
  },
  status: { ready: "prêt", notInstalled: "non installé", needsKey: "clé requise", broken: "le paquet ne s’importe pas", loading: "Chargement…" },

  general: {
    installEngine: "Installer le moteur",
    installing: "Installation en cours — cela prend quelques minutes.",
    whisperModel: "Modèle Whisper",
    whisperModelHint: "Sur Apple silicon, large-v3 en 4 bits va environ deux fois plus vite que turbo sans perdre de passages.",
    speechLanguage: "Langue parlée",
    speechLanguageHint: "La détection automatique convient à la parole mêlée ; pour les phrases courtes, fixez la langue.",
    languageAuto: "détection automatique",
    speechLanguages: { ru: "russe", en: "anglais", de: "allemand", fr: "français", es: "espagnol", pt: "portugais", it: "italien" },
    machineLine: (machine, python, ffmpeg) =>
      `La reconnaissance tourne sur la machine du serveur BB (${machine}) — inutile de partager son réseau, les appels passent par BB. Python : ${python} · ffmpeg : ${ffmpeg}`,
    notFound: "introuvable",
    downloading: (engine) => `Téléchargement du modèle ${engine}`,
  },

  dictation: {
    fillers: "Supprimer les hésitations",
    fillersHint: "Un vrai mot étiré est remis droit au lieu d’être supprimé.",
    quotes: "Corriger guillemets et espaces",
    quotesHint: "Les guillemets droits deviennent typographiques et les espaces en trop disparaissent.",
  },

  vocabulary: {
    placeholder: "DeepSeek, SelfyStudio, Claude Code, Gemini, OpenAI, env, BB",
    counter: (used, limit) => `${used} / ${limit} caractères d’indication.`,
    hint: "Noms, jargon et mots étrangers que la reconnaissance écorche. Inutile d’énumérer les déformations : elles sont repérées par la charpente consonantique.",
    repair: "Réparer les termes écorchés",
    repairHint: "Compare les mots au lexique par leur charpente consonantique : « Mail X » → MLX. Ce qui ne ressemble à rien reste intact.",
    prompt: "Souffler le lexique au modèle",
    promptHint: "La liste part comme indication de reconnaissance. Whisper en tient compte, GigaAM n’a pas cette entrée.",
    aiPass: "Corriger les termes par IA",
    aiPassHint: "Une seconde passe après la reconnaissance : un modèle de langue répare les noms que les règles n’ont pas reconnus. Coûte une seconde ou deux et demande une clé.",
    provider: "Fournisseur",
    providerCustom: "adresse personnalisée",
    model: "Modèle",
    apiUrl: "Adresse de l’API",
    apiUrlHint: "Compatible OpenAI, par exemple https://api.openai.com/v1.",
    keyAt: "La clé se crée ici :",
  },

  cloud: {
    notice: "Les moteurs cloud n’installent rien et n’occupent pas d’espace, mais votre audio part chez le fournisseur. Les moteurs locaux ne l’envoient jamais.",
    freeTier: "offre gratuite disponible",
    select: "choisir",
    selected: "choisi",
    model: "Modèle",
    apiUrl: "Adresse de l’API",
    key: "Clé",
    keySaved: "Clé enregistrée.",
    keyMissing: "Aucune clé.",
    keyBorrowed: (provider) => `La clé ${provider} est utilisée : même adresse, inutile de la saisir deux fois.`,
    keyPlaceholder: "clé d’API",
    keyManual: "Saisir la clé manuellement",
    keyFromCatalog: (name) => `Clé issue d’Env Catalog : ${name}.`,
    replace: "Remplacer",
    save: "Enregistrer",
  },

  data: {
    saveRecordings: "Conserver les enregistrements",
    saveRecordingsHint: "Tant que l’enregistrement est sur le disque, un échec de transcription ne détruit pas ce qui a été dit.",
    keepDays: "Supprimer les enregistrements après, jours",
    keepDaysHint: "0 — conserver indéfiniment.",
    recordingsCount: (count) => `Enregistrements conservés : ${count}`,
    modelsTitle: "Modèles sur la machine",
    modelsEmpty: "Aucun modèle téléchargé pour l’instant. Ils apparaissent après la première transcription ou via « Télécharger ».",
    inUse: "utilisé",
    delete: "Supprimer",
    freed: (size) => `${size} libéré`,
    nothingToDelete: "Rien à supprimer",
    noModelSize: "absent du disque",
  },

  providerNotes: {
    transcribe: {
      groq: "Niveau gratuit : 2 000 requêtes et 8 heures d’audio par jour, fichiers jusqu’à 25 Mo. Transcrit des centaines de fois plus vite que le temps réel.",
      openai: "Payant à la minute : gpt-4o-transcribe est plus précis, mini moins cher.",
      google: "Clé de Google AI Studio, qui offre des limites gratuites. gemini-3.5-transcribe est un modèle dédié à la parole.",
    },
    aiPass: {
      groq: "Niveau gratuit et faible latence — une correction prend environ une seconde.",
      opencode: "Modèles de texte gratuits d’OpenCode. Ils ne transcrivent pas la parole, mais corrigent bien une transcription.",
      openai: "Payant, mais corriger du texte coûte peu : mini suffit.",
    },
  },

  credits: {
    borrowed:
      "Ce plugin est une adaptation de Voica pour BB. Voica est une application de dictée pour macOS créée par Ivan Ushakov.",
    authorship: "Merci à l’auteur pour son code ouvert et ses solutions soigneusement pensées. © Ivan Ushakov, MIT.",
    website: "Site",
    source: "Code source",
    author: "Auteur",
  },

  errors: { machineUnreachable: (reason) => `La machine de reconnaissance est injoignable : ${reason}` },
};
