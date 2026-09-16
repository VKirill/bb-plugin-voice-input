import type { Dictionary } from "./types.ts";

export const es: Dictionary = {
  tabs: { general: "General", dictation: "Dictado", vocabulary: "Vocabulario", cloud: "Nube", data: "Datos" },
  language: { label: "Idioma de la interfaz" },

  engines: {
    whisper: { title: "Whisper (MLX)", hint: "Multilingüe y respeta los nombres de herramientas. Opción por defecto." },
    gigaam: { title: "GigaAM v3", hint: "Ruso con puntuación, el más rápido. Deforma los nombres en alfabeto latino: lo corrige el vocabulario." },
    groq: { title: "Groq (nube)", hint: "whisper-large-v3-turbo. No hay nada que instalar y es muy rápido; el audio sale de tu equipo." },
    openai: { title: "OpenAI (nube)", hint: "gpt-4o-transcribe. No hay nada que instalar; el audio sale de tu equipo." },
    google: { title: "Google (nube)", hint: "gemini-3.5-transcribe. No hay nada que instalar; el audio sale de tu equipo." },
  },
  status: { ready: "listo", notInstalled: "no instalado", needsKey: "falta la clave", broken: "el paquete no se importa", loading: "Cargando…" },

  general: {
    installEngine: "Instalar el motor",
    installing: "Instalando: tarda unos minutos.",
    whisperModel: "Modelo de Whisper",
    whisperModelHint: "En Apple silicon, large-v3 de 4 bits es unas dos veces más rápido que turbo y no pierde fragmentos.",
    speechLanguage: "Idioma del habla",
    speechLanguageHint: "La detección automática sirve para el habla mezclada; para frases cortas conviene fijar el idioma.",
    languageAuto: "detección automática",
    speechLanguages: { ru: "ruso", en: "inglés", de: "alemán", fr: "francés", es: "español", pt: "portugués", it: "italiano" },
    machineLine: (machine, python, ffmpeg) =>
      `El reconocimiento se ejecuta en la máquina del servidor BB (${machine}); no hace falta compartir su red, las llamadas van por BB. Python: ${python} · ffmpeg: ${ffmpeg}`,
    notFound: "no encontrado",
    downloading: (engine) => `Descargando el modelo de ${engine}`,
  },

  dictation: {
    fillers: "Quitar muletillas",
    fillersHint: "Una palabra real alargada no se borra, se endereza.",
    quotes: "Arreglar comillas y espacios",
    quotesHint: "Las comillas rectas pasan a tipográficas y se quitan los espacios sobrantes.",
  },

  vocabulary: {
    placeholder: "DeepSeek, SelfyStudio, Claude Code, Gemini, OpenAI, env, BB",
    counter: (used, limit) => `${used} / ${limit} caracteres de la pista.`,
    hint: "Nombres, jerga y extranjerismos que el reconocimiento deforma. No hace falta enumerar las deformaciones: se localizan por el esqueleto consonántico.",
    repair: "Reparar términos deformados",
    repairHint: "Compara las palabras con el vocabulario por su esqueleto consonántico: «Mail X» → MLX. No toca lo que no se parece.",
    prompt: "Sugerir el vocabulario al modelo",
    promptHint: "La lista se envía como pista de reconocimiento. Whisper la tiene en cuenta; GigaAM no admite esa entrada.",
    aiPass: "Corregir términos con IA",
    aiPassHint: "Una segunda pasada tras el reconocimiento: un modelo de lenguaje arregla los nombres que las reglas no reconocieron. Añade un par de segundos y requiere clave.",
    provider: "Proveedor",
    providerCustom: "dirección propia",
    model: "Modelo",
    apiUrl: "Dirección de la API",
    apiUrlHint: "Compatible con OpenAI, por ejemplo https://api.openai.com/v1.",
    keyAt: "La clave se obtiene aquí:",
  },

  cloud: {
    notice: "Los motores en la nube no instalan nada ni ocupan disco, pero tu audio va al proveedor. Los motores locales nunca lo envían.",
    freeTier: "tiene nivel gratuito",
    select: "elegir",
    selected: "elegido",
    model: "Modelo",
    apiUrl: "Dirección de la API",
    key: "Clave",
    keySaved: "Clave guardada.",
    keyMissing: "Sin clave.",
    keyBorrowed: (provider) => `Se usa la clave de ${provider}: misma dirección, no hace falta escribirla dos veces.`,
    keyPlaceholder: "clave de API",
    keyManual: "Introducir la clave a mano",
    keyFromCatalog: (name) => `La clave se toma de Env Catalog: ${name}.`,
    replace: "Reemplazar",
    save: "Guardar",
  },

  data: {
    saveRecordings: "Conservar las grabaciones",
    saveRecordingsHint: "Mientras la grabación esté en disco, un fallo de transcripción no destruye lo dicho.",
    keepDays: "Borrar grabaciones con más de, días",
    keepDaysHint: "0: conservar siempre.",
    recordingsCount: (count) => `Grabaciones guardadas: ${count}`,
    modelsTitle: "Modelos en la máquina",
    modelsEmpty: "Todavía no hay modelos descargados. Aparecen tras la primera transcripción o con el botón Descargar.",
    inUse: "en uso",
    delete: "Borrar",
    freed: (size) => `Liberado ${size}`,
    nothingToDelete: "Nada que borrar",
    noModelSize: "no está en disco",
  },

  providerNotes: {
    transcribe: {
      groq: "Nivel gratuito: 2000 solicitudes y 8 horas de audio al día, archivos de hasta 25 MB. Transcribe cientos de veces más rápido que el tiempo real.",
      openai: "De pago por minuto: gpt-4o-transcribe es más preciso, mini es más barato.",
      google: "Clave de Google AI Studio, que tiene límites gratuitos. gemini-3.5-transcribe es un modelo dedicado al habla.",
    },
    aiPass: {
      groq: "Nivel gratuito y baja latencia: una corrección tarda cerca de un segundo.",
      opencode: "Modelos de texto gratuitos de OpenCode. No transcriben voz, pero sí corrigen una transcripción.",
      openai: "De pago, pero corregir texto es barato: basta con mini.",
    },
  },

  credits: {
    borrowed:
      "Este plugin es una adaptación de Voica para BB. Voica es una app de dictado para macOS creada por Ivan Ushakov.",
    authorship: "Gracias al autor por su código abierto y sus soluciones bien pensadas. © Ivan Ushakov, MIT.",
    website: "Sitio web",
    source: "Código fuente",
    author: "Autor",
  },

  errors: { machineUnreachable: (reason) => `La máquina de reconocimiento no responde: ${reason}` },
};
