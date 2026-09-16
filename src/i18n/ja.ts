import type { Dictionary } from "./types.ts";

export const ja: Dictionary = {
  tabs: { general: "基本", dictation: "音声入力", vocabulary: "用語集", cloud: "クラウド", data: "データ" },
  language: { label: "表示言語" },

  engines: {
    whisper: { title: "Whisper (MLX)", hint: "多言語対応で、ツール名も崩しません。既定の選択肢です。" },
    gigaam: { title: "GigaAM v3", hint: "句読点つきのロシア語認識で最速。ラテン文字の名前は崩れますが、用語集が直します。" },
    groq: { title: "Groq（クラウド）", hint: "whisper-large-v3-turbo。導入不要で非常に高速ですが、音声は端末の外へ出ます。" },
    openai: { title: "OpenAI（クラウド）", hint: "gpt-4o-transcribe。導入不要ですが、音声は端末の外へ出ます。" },
    google: { title: "Google（クラウド）", hint: "gemini-3.5-transcribe。導入不要ですが、音声は端末の外へ出ます。" },
  },
  status: { ready: "利用可能", notInstalled: "未導入", needsKey: "キーが必要", broken: "パッケージを読み込めません", loading: "読み込み中…" },

  general: {
    installEngine: "エンジンを導入する",
    installing: "導入中です。数分かかります。",
    whisperModel: "Whisper のモデル",
    whisperModelHint: "Apple シリコンでは 4 ビットの large-v3 が turbo の約 2 倍速く、聞き落としもありません。",
    speechLanguage: "話す言語",
    speechLanguageHint: "自動判定は言語が混ざる話し方に向きます。短い文では言語を指定するほうが確実です。",
    languageAuto: "自動判定",
    speechLanguages: { ru: "ロシア語", en: "英語", de: "ドイツ語", fr: "フランス語", es: "スペイン語", pt: "ポルトガル語", it: "イタリア語" },
    machineLine: (machine, python, ffmpeg) =>
      `認識は BB サーバーの端末（${machine}）で動きます。同じネットワークにいる必要はなく、呼び出しは BB を経由します。Python: ${python} · ffmpeg: ${ffmpeg}`,
    notFound: "見つかりません",
    downloading: (engine) => `${engine} のモデルを取得中`,
  },

  dictation: {
    fillers: "「えー」「あのー」を取り除く",
    fillersHint: "引き伸ばされた本来の語は削らず、元の形に戻します。",
    quotes: "引用符と空白を整える",
    quotesHint: "直線的な引用符を組版用に直し、余分な空白を取り除きます。",
  },

  vocabulary: {
    placeholder: "DeepSeek, SelfyStudio, Claude Code, Gemini, OpenAI, env, BB",
    counter: (used, limit) => `ヒントの文字数 ${used} / ${limit}。`,
    hint: "認識が崩しがちな名称・専門用語・外来語。崩れた綴りを書き出す必要はありません。子音の骨格で照合します。",
    repair: "崩れた用語を直す",
    repairHint: "子音の骨格で用語集と突き合わせます（「Mail X」→ MLX）。似ていない語には触れません。",
    prompt: "用語集をモデルに伝える",
    promptHint: "一覧は認識ヒントとして送られます。Whisper は参照しますが、GigaAM にはこの入力がありません。",
    aiPass: "AI で用語を直す",
    aiPassHint: "認識後の二段目の処理です。規則で拾えなかった名称を言語モデルが直します。1〜2 秒かかり、キーが要ります。",
    provider: "提供元",
    providerCustom: "独自のアドレス",
    model: "モデル",
    apiUrl: "API アドレス",
    apiUrlHint: "OpenAI 互換。例: https://api.openai.com/v1",
    keyAt: "キーの取得先:",
  },

  cloud: {
    notice: "クラウドのエンジンは導入も保存領域も不要ですが、音声は提供元に送られます。ローカルのエンジンは一切送りません。",
    freeTier: "無料枠あり",
    select: "選ぶ",
    selected: "選択中",
    model: "モデル",
    apiUrl: "API アドレス",
    key: "キー",
    keySaved: "キーを保存しました。",
    keyMissing: "キーは未設定です。",
    keyBorrowed: (provider) => `${provider} のキーを使います。アドレスが同じなので二度入力する必要はありません。`,
    keyPlaceholder: "API キー",
    keyManual: "キーを手動で入力",
    keyFromCatalog: (name) => `キーは Env Catalog から取得: ${name}。`,
    replace: "置き換え",
    save: "保存",
  },

  data: {
    saveRecordings: "録音を残す",
    saveRecordingsHint: "録音がディスクにある限り、認識に失敗しても話した内容は失われません。",
    keepDays: "録音を削除するまでの日数",
    keepDaysHint: "0 なら削除しません。",
    recordingsCount: (count) => `保存された録音: ${count}`,
    modelsTitle: "端末にあるモデル",
    modelsEmpty: "まだモデルがありません。最初の認識か「取得」で現れます。",
    inUse: "使用中",
    delete: "削除",
    freed: (size) => `${size} を解放しました`,
    nothingToDelete: "削除するものはありません",
    noModelSize: "ディスクにありません",
  },

  providerNotes: {
    transcribe: {
      groq: "無料枠: 1 日 2,000 リクエスト・音声 8 時間、ファイルは 25 MB まで。実時間の数百倍の速さで認識します。",
      openai: "分単位の従量課金: gpt-4o-transcribe は高精度、mini は低価格。",
      google: "Google AI Studio のキー。無料枠があります。gemini-3.5-transcribe は音声認識専用モデルです。",
    },
    aiPass: {
      groq: "無料枠があり遅延も小さく、補正は約 1 秒で終わります。",
      opencode: "OpenCode の無料テキストモデル。音声認識はできませんが、文字起こしの補正には十分です。",
      openai: "有料ですがテキスト補正は安価で、mini で足ります。",
    },
  },

  credits: {
    borrowed:
      "このプラグインは Voica を BB 向けに移植したものです。Voica は Ivan Ushakov 氏が開発した macOS 用の音声入力アプリです。",
    authorship: "オープンソースとして公開された丁寧な設計に、作者へ感謝いたします。© Ivan Ushakov、MIT。",
    website: "サイト",
    source: "ソースコード",
    author: "作者",
  },

  errors: { machineUnreachable: (reason) => `認識用の端末に接続できません: ${reason}` },
};
