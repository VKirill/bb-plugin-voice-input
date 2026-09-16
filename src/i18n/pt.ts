import type { Dictionary } from "./types.ts";

export const pt: Dictionary = {
  tabs: { general: "Geral", dictation: "Ditado", vocabulary: "Vocabulário", cloud: "Nuvem", data: "Dados" },
  language: { label: "Idioma da interface" },

  engines: {
    whisper: { title: "Whisper (MLX)", hint: "Multilíngue e preserva nomes de ferramentas. Opção padrão." },
    gigaam: { title: "GigaAM v3", hint: "Russo com pontuação, o mais rápido. Deforma nomes em alfabeto latino — o vocabulário corrige isso." },
    groq: { title: "Groq (nuvem)", hint: "whisper-large-v3-turbo. Nada a instalar e muito rápido; o áudio sai da sua máquina." },
    openai: { title: "OpenAI (nuvem)", hint: "gpt-4o-transcribe. Nada a instalar; o áudio sai da sua máquina." },
    google: { title: "Google (nuvem)", hint: "gemini-3.5-transcribe. Nada a instalar; o áudio sai da sua máquina." },
  },
  status: { ready: "pronto", notInstalled: "não instalado", needsKey: "falta a chave", broken: "o pacote não importa", loading: "Carregando…" },

  general: {
    installEngine: "Instalar o motor",
    installing: "Instalando — leva alguns minutos.",
    whisperModel: "Modelo do Whisper",
    whisperModelHint: "Em Apple silicon, o large-v3 de 4 bits é cerca de duas vezes mais rápido que o turbo e não perde trechos.",
    speechLanguage: "Idioma da fala",
    speechLanguageHint: "A detecção automática serve para fala misturada; em frases curtas é melhor fixar o idioma.",
    languageAuto: "detecção automática",
    speechLanguages: { ru: "russo", en: "inglês", de: "alemão", fr: "francês", es: "espanhol", pt: "português", it: "italiano" },
    machineLine: (machine, python, ffmpeg) =>
      `O reconhecimento roda na máquina do servidor BB (${machine}) — não é preciso estar na mesma rede, as chamadas passam pelo BB. Python: ${python} · ffmpeg: ${ffmpeg}`,
    notFound: "não encontrado",
    downloading: (engine) => `Baixando o modelo ${engine}`,
  },

  dictation: {
    fillers: "Remover hesitações",
    fillersHint: "Uma palavra real alongada é endireitada em vez de apagada.",
    quotes: "Ajustar aspas e espaços",
    quotesHint: "Aspas retas viram tipográficas e os espaços sobrando somem.",
  },

  vocabulary: {
    placeholder: "DeepSeek, SelfyStudio, Claude Code, Gemini, OpenAI, env, BB",
    counter: (used, limit) => `${used} / ${limit} caracteres da dica.`,
    hint: "Nomes, jargão e estrangeirismos que o reconhecimento deforma. Não é preciso listar as deformações: elas são achadas pelo esqueleto consonantal.",
    repair: "Reparar termos deformados",
    repairHint: "Compara as palavras com o vocabulário pelo esqueleto consonantal: «Mail X» → MLX. O que não se parece fica intacto.",
    prompt: "Sugerir o vocabulário ao modelo",
    promptHint: "A lista vai como dica de reconhecimento. O Whisper a considera; o GigaAM não tem essa entrada.",
    aiPass: "Corrigir termos com IA",
    aiPassHint: "Uma segunda passagem após o reconhecimento: um modelo de linguagem conserta os nomes que as regras não reconheceram. Custa um ou dois segundos e exige chave.",
    provider: "Provedor",
    providerCustom: "endereço próprio",
    model: "Modelo",
    apiUrl: "Endereço da API",
    apiUrlHint: "Compatível com OpenAI, por exemplo https://api.openai.com/v1.",
    keyAt: "A chave é criada aqui:",
  },

  cloud: {
    notice: "Motores na nuvem não instalam nada nem ocupam disco, mas seu áudio vai para o provedor. Motores locais nunca o enviam.",
    freeTier: "tem nível gratuito",
    select: "escolher",
    selected: "escolhido",
    model: "Modelo",
    apiUrl: "Endereço da API",
    key: "Chave",
    keySaved: "Chave salva.",
    keyMissing: "Sem chave.",
    keyBorrowed: (provider) => `Usando a chave do ${provider}: mesmo endereço, não precisa digitar duas vezes.`,
    keyPlaceholder: "chave de API",
    keyManual: "Inserir a chave manualmente",
    keyFromCatalog: (name) => `A chave vem do Env Catalog: ${name}.`,
    replace: "Substituir",
    save: "Salvar",
  },

  data: {
    saveRecordings: "Guardar as gravações",
    saveRecordingsHint: "Enquanto a gravação estiver no disco, uma falha na transcrição não destrói o que foi dito.",
    keepDays: "Apagar gravações com mais de, dias",
    keepDaysHint: "0 — guardar para sempre.",
    recordingsCount: (count) => `Gravações guardadas: ${count}`,
    modelsTitle: "Modelos na máquina",
    modelsEmpty: "Ainda não há modelos baixados. Eles aparecem após a primeira transcrição ou pelo botão Baixar.",
    inUse: "em uso",
    delete: "Apagar",
    freed: (size) => `${size} liberados`,
    nothingToDelete: "Nada a apagar",
    noModelSize: "não está no disco",
  },

  providerNotes: {
    transcribe: {
      groq: "Nível gratuito: 2.000 requisições e 8 horas de áudio por dia, arquivos de até 25 MB. Transcreve centenas de vezes mais rápido que o tempo real.",
      openai: "Pago por minuto: gpt-4o-transcribe é mais preciso, mini é mais barato.",
      google: "Chave do Google AI Studio, que tem limites gratuitos. gemini-3.5-transcribe é um modelo dedicado à fala.",
    },
    aiPass: {
      groq: "Nível gratuito e baixa latência — uma correção leva cerca de um segundo.",
      opencode: "Modelos de texto gratuitos do OpenCode. Não transcrevem fala, mas corrigem uma transcrição.",
      openai: "Pago, mas corrigir texto é barato: o mini basta.",
    },
  },

  credits: {
    borrowed:
      "Este plugin é uma adaptação do Voica para o BB. O Voica é um app de ditado para macOS criado por Ivan Ushakov.",
    authorship: "Agradecemos ao autor pelo código aberto e pelas soluções bem pensadas. © Ivan Ushakov, MIT.",
    website: "Site",
    source: "Código-fonte",
    author: "Autor",
  },

  errors: { machineUnreachable: (reason) => `A máquina de reconhecimento está inacessível: ${reason}` },
};
