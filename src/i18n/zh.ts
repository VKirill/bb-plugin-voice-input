import type { Dictionary } from "./types.ts";

export const zh: Dictionary = {
  tabs: { general: "常规", dictation: "听写", vocabulary: "词表", cloud: "云端", data: "数据" },
  language: { label: "界面语言" },

  engines: {
    whisper: { title: "Whisper (MLX)", hint: "多语种，能保住工具名称。默认选项。" },
    gigaam: { title: "GigaAM v3", hint: "俄语识别带标点，速度最快。拉丁字母名称会写错，靠词表纠正。" },
    groq: { title: "Groq（云端）", hint: "whisper-large-v3-turbo。无需安装且很快；音频会离开本机。" },
    openai: { title: "OpenAI（云端）", hint: "gpt-4o-transcribe。无需安装；音频会离开本机。" },
    google: { title: "Google（云端）", hint: "gemini-3.5-transcribe。无需安装；音频会离开本机。" },
  },
  status: { ready: "就绪", notInstalled: "未安装", needsKey: "需要密钥", broken: "无法导入依赖包", loading: "加载中…" },

  general: {
    installEngine: "安装引擎",
    installing: "正在安装，需要几分钟。",
    whisperModel: "Whisper 模型",
    whisperModelHint: "在 Apple 芯片上，4 位的 large-v3 比 turbo 快约一倍，且不会漏掉语句。",
    speechLanguage: "语音语言",
    speechLanguageHint: "自动识别适合混合语种；短句建议直接指定语言。",
    languageAuto: "自动识别",
    speechLanguages: { ru: "俄语", en: "英语", de: "德语", fr: "法语", es: "西班牙语", pt: "葡萄牙语", it: "意大利语" },
    machineLine: (machine, python, ffmpeg) =>
      `识别在 BB 服务器所在的机器上运行（${machine}）——无需与其同一网络，调用经由 BB。Python：${python} · ffmpeg：${ffmpeg}`,
    notFound: "未找到",
    downloading: (engine) => `正在下载 ${engine} 模型`,
  },

  dictation: {
    fillers: "去掉口头语",
    fillersHint: "被拖长的真实词语会被还原，而不是删除。",
    quotes: "整理引号与空格",
    quotesHint: "直引号改为印刷体引号，多余空格去掉。",
  },

  vocabulary: {
    placeholder: "DeepSeek, SelfyStudio, Claude Code, Gemini, OpenAI, env, BB",
    counter: (used, limit) => `提示词已用 ${used} / ${limit} 个字符。`,
    hint: "识别容易写错的名称、行话和外来词。不必列出错误写法——系统按辅音骨架自行匹配。",
    repair: "修复写错的术语",
    repairHint: "按辅音骨架与词表比对：「Mail X」→ MLX。不相像的词不动。",
    prompt: "把词表提示给模型",
    promptHint: "词表作为识别提示送出。Whisper 会参考，GigaAM 没有这个输入。",
    aiPass: "用 AI 纠正术语",
    aiPassHint: "识别后的第二道工序：语言模型修复规则没认出的名称。多花一两秒，需要密钥。",
    provider: "服务商",
    providerCustom: "自定义地址",
    model: "模型",
    apiUrl: "API 地址",
    apiUrlHint: "兼容 OpenAI，例如 https://api.openai.com/v1。",
    keyAt: "在这里申请密钥：",
  },

  cloud: {
    notice: "云端引擎无需安装、不占磁盘，但音频会发送给服务商。本地引擎从不外发。",
    freeTier: "有免费额度",
    select: "选用",
    selected: "已选用",
    model: "模型",
    apiUrl: "API 地址",
    key: "密钥",
    keySaved: "密钥已保存。",
    keyMissing: "尚未设置密钥。",
    keyBorrowed: (provider) => `正在使用 ${provider} 的密钥：地址相同，无需重复填写。`,
    keyPlaceholder: "API 密钥",
    keyManual: "手动输入密钥",
    keyFromCatalog: (name) => `密钥来自 Env Catalog：${name}。`,
    replace: "替换",
    save: "保存",
  },

  data: {
    saveRecordings: "保留录音",
    saveRecordingsHint: "只要录音还在磁盘上，识别失败也不会让说过的话消失。",
    keepDays: "超过多少天删除录音",
    keepDaysHint: "0 表示永久保留。",
    recordingsCount: (count) => `已保存录音：${count}`,
    modelsTitle: "机器上的模型",
    modelsEmpty: "还没有下载模型。首次识别后或点「下载」即可出现。",
    inUse: "使用中",
    delete: "删除",
    freed: (size) => `已释放 ${size}`,
    nothingToDelete: "没有可删除的内容",
    noModelSize: "磁盘上没有",
  },

  providerNotes: {
    transcribe: {
      groq: "免费额度：每天 2000 次请求、8 小时音频，单个文件不超过 25 MB。识别速度是实时的数百倍。",
      openai: "按分钟计费：gpt-4o-transcribe 更准确，mini 更便宜。",
      google: "使用 Google AI Studio 的密钥，有免费额度。gemini-3.5-transcribe 是专门的语音识别模型。",
    },
    aiPass: {
      groq: "有免费额度且延迟低，一次纠正约需一秒。",
      opencode: "OpenCode 的免费文本模型。它们不能识别语音，但可以纠正转写文本。",
      openai: "需付费，但纠正文本很便宜：mini 就够了。",
    },
  },

  credits: {
    borrowed:
      "本插件是 Voica 面向 BB 的改编版本。Voica 是 Ivan Ushakov 开发的 macOS 听写应用。",
    authorship: "感谢作者开放源代码并提供精心设计的方案。© Ivan Ushakov，MIT 许可。",
    website: "官网",
    source: "源代码",
    author: "作者",
  },

  errors: { machineUnreachable: (reason) => `无法连接识别机器：${reason}` },
};
