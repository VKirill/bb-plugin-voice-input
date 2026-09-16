// bb-plugin-voice-input — голосовой ввод BB, который распознаёт речь на машине
// сервера, а не в облаке.
//
// BB выбирает движок транскрипции настройкой BB_TRANSCRIPTION вида
// <serviceId>/<model>. Плагин регистрирует сервис «local-voice» и реализует
// его в host.ts; здесь живут настройки, CLI и доставка настроек на машины.
import { type BbPluginApi } from "@get-bb/plugin-sdk";
import { readFile } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  AI_SERVICE_ID,
  ENGINE_IDS,
  hostSignals,
  managementContract,
  type VoiceConfig,
} from "./src/contract.js";
import { dictionary } from "./src/i18n/index.js";
import {
  DEFAULT_SETTINGS,
  DEFAULT_WHISPER_MODEL,
  WHISPER_MODELS,
  mergeSettings,
  sanitizePatch,
  type StoredSettings,
} from "./src/settings-store.js";

const CONFIG_PUSH_DELAY_MS = 2_000;
/** Установка тянет пакеты и модель: полчаса — потолок, а не ожидание. */
const SETUP_TIMEOUT_MS = 30 * 60 * 1000;
/** Длинная запись плюс возможная первая загрузка модели. */
const TRANSCRIBE_TIMEOUT_MS = 10 * 60 * 1000;
/** Модель может весить гигабайты, а канал — быть узким. */
const DOWNLOAD_TIMEOUT_MS = 60 * 60 * 1000;
/** Env Catalog — необязательный плагин: если он стоит, ключ можно взять из него. */
const ENV_CATALOG_PLUGIN_ID = "env-catalog";
/** Секрет на машине распознавания и настройка, связывающая его с каталогом. */
const KEY_SLOTS = [
  { secret: "aiPassApiKey", catalog: "aiPassKeyCatalog" },
  { secret: "openaiApiKey", catalog: "openaiKeyCatalog" },
  { secret: "googleApiKey", catalog: "googleKeyCatalog" },
  { secret: "groqApiKey", catalog: "groqKeyCatalog" },
] as const;

/** Контракт страницы плагина: она читает состояние и запускает установку. */
export const rpcContract = defineRpcContract({
  state: {
    input: z.null(),
    output: z.object({
      machine: z.string().nullable(),
      error: z.string().nullable(),
      pythonPath: z.string().nullable(),
      ffmpegPath: z.string().nullable(),
      recordings: z.number(),
      engines: z.array(
        z.object({
          engine: z.string(),
          ready: z.boolean(),
          detail: z.string(),
          modelBytes: z.number(),
        }),
      ),
      activeEngine: z.string(),
      /** Несекретные значения настроек: страница сама их и редактирует. */
      settings: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
      whisperModelOptions: z.array(z.string()),
      aiPassConfigured: z.boolean(),
      aiPassKeySource: z.enum(["own", "groq", "openai", "aiPass"]).nullable(),
      openaiConfigured: z.boolean(),
      googleConfigured: z.boolean(),
      groqConfigured: z.boolean(),
      progress: z
        .object({
          engine: z.string(),
          percent: z.number().nullable(),
          downloadedBytes: z.number().nullable(),
          totalBytes: z.number().nullable(),
          state: z.string(),
          message: z.string().nullable(),
        })
        .nullable(),
    }),
  },
  envKeys: {
    input: z.null(),
    output: z.object({ declared: z.array(z.string()), visible: z.array(z.string()) }),
  },
  catalogKeys: {
    input: z.null(),
    output: z.object({ available: z.boolean(), names: z.array(z.string()) }),
  },
  setupEngine: {
    input: z.object({ engine: z.enum(ENGINE_IDS) }),
    output: z.object({ ready: z.boolean(), detail: z.string() }),
  },
  downloadEngineModel: {
    input: z.object({ engine: z.enum(ENGINE_IDS) }),
    output: z.object({ ready: z.boolean(), detail: z.string() }),
  },
  diskModels: {
    input: z.null(),
    output: z.object({
      models: z.array(
        z.object({
          engine: z.string(),
          model: z.string(),
          path: z.string(),
          bytes: z.number(),
          active: z.boolean(),
        }),
      ),
    }),
  },
  deleteEngineModel: {
    input: z.object({ engine: z.enum(ENGINE_IDS), model: z.string() }),
    output: z.object({ freedBytes: z.number() }),
  },
  updateSettings: {
    input: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
    output: z.object({ saved: z.boolean() }),
  },
});

export default async function plugin(bb: BbPluginApi) {
  bb.experimental_aiServices.register({
    id: AI_SERVICE_ID,
    displayName: "Voice input on the BB machine",
    kinds: ["voice"],
  });

  // Настроек-дескрипторов у плагина нет намеренно: BB рисует их отдельной
  // формой над страницей, скрыть её нечем, и пользователь видит настройки в
  // двух местах сразу. Обычные настройки живут в хранилище плагина, ключи — на
  // машине распознавания в файле 0600, как их хранит и сам BB.

  const SETTINGS_KEY = "settings";

  async function readSettings(): Promise<StoredSettings> {
    return mergeSettings(await bb.storage.kv.get<unknown>(SETTINGS_KEY));
  }

  async function writeSettings(patch: Partial<StoredSettings>): Promise<StoredSettings> {
    const next = { ...(await readSettings()), ...patch };
    await bb.storage.kv.set(SETTINGS_KEY, next);
    return next;
  }

  const host = bb.hosts.experimental_client({
    contract: managementContract,
    experimental_signals: hostSignals,
  });

  // Последнее состояние загрузки модели: интерфейс читает его при открытии,
  // а дальше слушает realtime — сигналы эфемерны и приходят только «в момент».
  let modelProgress: {
    engine: string;
    percent: number | null;
    downloadedBytes: number | null;
    totalBytes: number | null;
    state: string;
    message: string | null;
    updatedAt: number;
  } | null = null;

  host.experimental_onSignal("modelProgress", ({ payload }) => {
    modelProgress = { ...payload, updatedAt: Date.now() };
    bb.realtime.publish("model-progress", modelProgress);
  });

  async function currentConfig(): Promise<VoiceConfig> {
    const values = await readSettings();
    // Ключи в конфиг с сервера не попадают: их хранит и подставляет хост.
    return {
      engine: values.engine,
      whisperModel: WHISPER_MODELS[values.whisperModel] ?? WHISPER_MODELS[DEFAULT_WHISPER_MODEL]!,
      language: values.language,
      vocabulary: values.vocabulary,
      vocabularyRepair: values.vocabularyRepair,
      vocabularyPrompt: values.vocabularyPrompt,
      cleanupFillers: values.cleanupFillers,
      cleanupQuotes: values.cleanupQuotes,
      cloud: {
        openaiBaseUrl: values.openaiBaseUrl,
        openaiModel: values.openaiModel,
        openaiApiKey: "",
        openaiKeyEnv: values.openaiKeyEnv,
        googleBaseUrl: values.googleBaseUrl,
        googleModel: values.googleModel,
        googleApiKey: "",
        googleKeyEnv: values.googleKeyEnv,
        groqBaseUrl: values.groqBaseUrl,
        groqModel: values.groqModel,
        groqApiKey: "",
        groqKeyEnv: values.groqKeyEnv,
      },
      aiPass: {
        enabled: values.aiPassEnabled,
        baseUrl: values.aiPassBaseUrl,
        model: values.aiPassModel,
        apiKey: "",
        keyEnv: values.aiPassKeyEnv,
      },
      saveRecordings: values.saveRecordings,
      keepDays: values.keepDays,
    };
  }

  /**
   * Настройки живут на сервере, а распознаёт хост, поэтому конфиг доставляется
   * на подключённые машины. Какая из них обслужит голос, решает BB, так что
   * конфиг получают все — иначе смена настройки не доедет до нужной.
   */
  async function pushConfig(): Promise<{ delivered: string[]; failed: string[] }> {
    const config = await currentConfig();
    const hosts = await bb.sdk.hosts.list();
    const delivered: string[] = [];
    const failed: string[] = [];
    for (const item of hosts) {
      if (item.status !== "connected") {
        continue;
      }
      try {
        await host.call("applyConfig", { config }, { hostId: item.id });
        delivered.push(item.name);
      } catch (error) {
        failed.push(`${item.name}: ${describe(error)}`);
      }
    }
    return { delivered, failed };
  }

  /**
   * Перенести ключи из секретных настроек BB, которыми плагин пользовался
   * раньше. BB держит их файлами в своём каталоге; после переноса плагин
   * читает ключи с машины распознавания, а старые файлы остаются нетронутыми
   * на случай отката.
   */
  async function migrateLegacySecrets(): Promise<void> {
    const legacyDir = join(bb.server.experimental_dataDir, "plugins", bb.pluginId, "secrets");
    const names = ["openaiApiKey", "googleApiKey", "groqApiKey", "aiPassApiKey"] as const;
    let hostId: string;
    try {
      hostId = await resolveHostId(bb, host, undefined);
    } catch {
      return;
    }
    const existing = await host.call("secretsStatus", {}, { hostId }).catch(() => null);
    if (!existing) {
      return;
    }
    for (const name of names) {
      if (existing[name]) {
        continue;
      }
      try {
        const value = (await readFile(join(legacyDir, name), "utf8")).trim();
        if (value.length > 0) {
          await host.call("setSecret", { name, value }, { hostId });
          bb.log.info(`Key ${name} migrated from the previous BB storage`);
        }
      } catch {
        // Файла нет — переносить нечего.
      }
    }
  }

  /** Значение ключа из Env Catalog. Каталог хранит ключи на сервере BB. */
  async function catalogValue(name: string): Promise<string> {
    const record = await bb.sdk.plugins.callRpc({
      pluginId: ENV_CATALOG_PLUGIN_ID,
      method: "env_get_value",
      input: { name },
      outputSchema: z.object({ value: z.string() }),
    });
    return record.value;
  }

  /**
   * Доставить на машину распознавания ключи, привязанные к каталогу. Так
   * замена ключа в каталоге доходит до плагина при старте и при сохранении
   * настроек, а не только в момент выбора.
   */
  async function syncCatalogKeys(): Promise<void> {
    const values = await readSettings();
    const linked = KEY_SLOTS.filter((slot) => values[slot.catalog].length > 0);
    if (linked.length === 0) {
      return;
    }
    const hostId = await resolveHostId(bb, host, undefined);
    for (const slot of linked) {
      try {
        const value = await catalogValue(values[slot.catalog]);
        await host.call("setSecret", { name: slot.secret, value }, { hostId });
      } catch (error) {
        bb.log.warn(`Key ${slot.secret} not taken from Env Catalog — ${describe(error)}`);
      }
    }
  }

  // Вызовы хоста запрещены во время регистрации, поэтому первая доставка
  // происходит таймером сразу после неё.
  const initialPush = setTimeout(() => {
    void migrateLegacySecrets()
      .then(() => syncCatalogKeys())
      .catch(() => undefined)
      .then(() => pushConfig())
      .then(({ failed }) => {
      for (const failure of failed) {
        bb.log.warn(`Settings not delivered — ${failure}`);
      }
    });
  }, CONFIG_PUSH_DELAY_MS);
  bb.onDispose(() => clearTimeout(initialPush));



  bb.rpc.register(rpcContract, {
    state: async () => {
      let hostId: string;
      try {
        hostId = await resolveHostId(bb, host, undefined);
      } catch (error) {
        return {
          machine: null,
          error: describe(error),
          pythonPath: null,
          ffmpegPath: null,
          recordings: 0,
          engines: [],
          activeEngine: (await currentConfig()).engine,
          settings: { ...(await readSettings()) },
          whisperModelOptions: Object.keys(WHISPER_MODELS),
          aiPassConfigured: false,
          aiPassKeySource: null,
          openaiConfigured: false,
          googleConfigured: false,
          groqConfigured: false,
          progress: modelProgress,
        };
      }
      const [status, identity, config, secretsState] = await Promise.all([
        host.call("status", {}, { hostId }),
        host.call("identify", {}, { hostId }),
        currentConfig(),
        host.call("secretsStatus", {}, { hostId }),
      ]);
      const values = await readSettings();
      return {
        machine: identity.hostname,
        error: null,
        pythonPath: status.pythonPath,
        ffmpegPath: status.ffmpegPath,
        recordings: status.recordings,
        engines: status.engines,
        activeEngine: config.engine,
        settings: { ...values },
        whisperModelOptions: Object.keys(WHISPER_MODELS),
        aiPassConfigured: secretsState.aiPassApiKey,
        aiPassKeySource: secretsState.aiPassKeySource,
        openaiConfigured: secretsState.openaiApiKey,
        googleConfigured: secretsState.googleApiKey,
        groqConfigured: secretsState.groqApiKey,
        progress: modelProgress,
      };
    },
    catalogKeys: async () => {
      // Плагина может не быть или он выключен — тогда выбор из каталога скрыт.
      try {
        const { variables } = await bb.sdk.plugins.callRpc({
          pluginId: ENV_CATALOG_PLUGIN_ID,
          method: "env_list",
          input: {},
          outputSchema: z.object({ variables: z.array(z.object({ name: z.string() })) }),
        });
        return { available: true, names: variables.map((variable) => variable.name).sort() };
      } catch {
        return { available: false, names: [] };
      }
    },
    envKeys: async () => {
      // Имена берём из двух источников: машинное окружение BB знает, что там
      // объявлено, а хост — что реально видно процессу распознавания.
      const declared = await bb.sdk.system
        .machineEnvironment()
        .then((list) => list.variables.map((variable) => variable.name))
        .catch(() => [] as string[]);
      let visible: string[] = [];
      try {
        const hostId = await resolveHostId(bb, host, undefined);
        visible = (await host.call("envKeys", {}, { hostId })).names;
      } catch {
        // Машина может быть недоступна — покажем хотя бы объявленные имена.
      }
      return { declared, visible };
    },
    setupEngine: async ({ engine }) => {
      const hostId = await resolveHostId(bb, host, undefined);
      const result = await host.call(
        "setup",
        { engine, reinstall: false },
        { hostId, timeoutMs: SETUP_TIMEOUT_MS },
      );
      bb.realtime.publish("state-changed", { engine });
      return { ready: result.ready, detail: result.detail };
    },
    diskModels: async () => {
      const hostId = await resolveHostId(bb, host, undefined);
      return await host.call("listModels", {}, { hostId, timeoutMs: 120_000 });
    },
    deleteEngineModel: async ({ engine, model }) => {
      const hostId = await resolveHostId(bb, host, undefined);
      const result = await host.call(
        "deleteModel",
        { engine, model },
        { hostId, timeoutMs: 120_000 },
      );
      bb.realtime.publish("state-changed", { engine });
      return result;
    },
    updateSettings: async (patch) => {
      // Ключ ИИ-прохода секретный: страница его не читает, но записать может.
      const hostId = await resolveHostId(bb, host, undefined);
      const settingsPatch: Record<string, unknown> = { ...patch };
      for (const slot of KEY_SLOTS) {
        const typed = patch[slot.secret];
        const linked = patch[slot.catalog];
        if (typeof typed === "string") {
          // Ключ, введённый руками, отвязывает поле от каталога.
          await host.call("setSecret", { name: slot.secret, value: typed }, { hostId });
          settingsPatch[slot.catalog] = "";
        } else if (typeof linked === "string" && linked.length > 0) {
          const value = await catalogValue(linked);
          await host.call("setSecret", { name: slot.secret, value }, { hostId });
        }
      }
      await writeSettings(sanitizePatch(settingsPatch));
      await pushConfig();
      bb.realtime.publish("state-changed", { settings: true });
      return { saved: true };
    },
    downloadEngineModel: async ({ engine }) => {
      const hostId = await resolveHostId(bb, host, undefined);
      const result = await host.call(
        "downloadModel",
        { engine },
        { hostId, timeoutMs: DOWNLOAD_TIMEOUT_MS },
      );
      bb.realtime.publish("state-changed", { engine });
      return result;
    },
  });

  bb.cli.register({
    name: "voice-input",
    summary: "Voice input: engine setup, status and transcript history",
    commands: [
      { name: "status", summary: "Engine status on the machine", usage: "bb voice-input status [--machine <name>]" },
      {
        name: "setup",
        summary: "Install a recognition engine on the machine",
        usage: "bb voice-input setup [whisper|gigaam] [--reinstall] [--machine <name>]",
      },
      { name: "history", summary: "Recent transcripts", usage: "bb voice-input history [N] [--machine <name>]" },
      {
        name: "config",
        summary: "Show or change settings",
        usage: "bb voice-input config [key value]",
      },
      {
        name: "download",
        summary: "Download the engine model in advance, with progress",
        usage: "bb voice-input download [whisper|gigaam] [--machine <name>]",
      },
      {
        name: "transcribe",
        summary: "Transcribe a file that is already on the machine",
        usage: "bb voice-input transcribe <path> [--machine <name>]",
      },
      {
        name: "apply-settings",
        summary: "Deliver current settings to connected machines",
        usage: "bb voice-input apply-settings",
      },
    ],
    async run(argv) {
      const flags = readFlags(argv);
      const [command = "status"] = flags.positional;
      try {
        if (command === "apply-settings") {
          const { delivered, failed } = await pushConfig();
          return ok(
            [
              delivered.length > 0
                ? `Delivered to: ${delivered.join(", ")}`
                : "Nowhere to deliver: no connected machines.",
              ...failed.map((failure) => `Not delivered — ${failure}`),
            ].join("\n"),
          );
        }

        const hostId = await resolveHostId(bb, host, flags.machine);

        if (command === "status") {
          const status = await host.call("status", {}, { hostId });
          const words = dictionary((await readSettings()).uiLanguage);
          const label = (detail: string) =>
            detail === "ready"
              ? words.status.ready
              : detail === "needs-key"
                ? words.status.needsKey
                : detail.startsWith("broken:")
                  ? `${words.status.broken} (${detail.slice(8).trim()})`
                  : words.status.notInstalled;
          return ok(
            [
              `data: ${status.dataDir}`,
              `python: ${status.pythonPath ?? words.general.notFound}`,
              `ffmpeg: ${status.ffmpegPath ?? words.general.notFound}`,
              `${words.data.recordingsCount(status.recordings)}`,
              ...status.engines.map((engine) => `${engine.engine}: ${label(engine.detail)}`),
            ].join("\n"),
          );
        }

        if (command === "setup") {
          const requested = flags.positional[1];
          const config = await currentConfig();
          const engine = ENGINE_IDS.includes(requested as never)
            ? (requested as (typeof ENGINE_IDS)[number])
            : config.engine;
          const result = await host.call(
            "setup",
            { engine, reinstall: flags.reinstall },
            { hostId, timeoutMs: SETUP_TIMEOUT_MS },
          );
          await pushConfig();
          return { exitCode: result.ready ? 0 : 1, stdout: [result.log, "", result.detail].join("\n").trim() };
        }

        if (command === "config") {
          const [, key, ...rest] = flags.positional;
          const current = await readSettings();
          if (!key) {
            return ok(
              Object.entries(current)
                .map(([name, value]) => `${name} = ${JSON.stringify(value)}`)
                .join("\n"),
            );
          }
          if (!(key in DEFAULT_SETTINGS)) {
            return { exitCode: 1, stderr: `No setting named "${key}".` };
          }
          const raw = rest.join(" ");
          const typed =
            typeof DEFAULT_SETTINGS[key as keyof typeof DEFAULT_SETTINGS] === "boolean"
              ? raw === "true"
              : typeof DEFAULT_SETTINGS[key as keyof typeof DEFAULT_SETTINGS] === "number"
                ? Number.parseInt(raw, 10)
                : raw;
          const patch = sanitizePatch({ [key]: typed });
          if (Object.keys(patch).length === 0) {
            return { exitCode: 1, stderr: `Value "${raw}" does not fit "${key}".` };
          }
          const next = await writeSettings(patch);
          await pushConfig();
          return ok(`${key} = ${JSON.stringify(next[key as keyof StoredSettings])}`);
        }

        if (command === "download") {
          const requested = flags.positional[1];
          const config = await currentConfig();
          const engine = ENGINE_IDS.includes(requested as never)
            ? (requested as (typeof ENGINE_IDS)[number])
            : config.engine;
          const result = await host.call(
            "downloadModel",
            { engine },
            { hostId, timeoutMs: DOWNLOAD_TIMEOUT_MS },
          );
          const progress = modelProgress?.totalBytes
            ? ` Загружено ${formatBytes(modelProgress.downloadedBytes ?? 0)} из ${formatBytes(modelProgress.totalBytes)}.`
            : "";
          return { exitCode: result.ready ? 0 : 1, stdout: result.detail + progress };
        }

        if (command === "transcribe") {
          const path = flags.positional[1];
          if (!path) {
            return { exitCode: 1, stderr: "Give a path to a file on the recognition machine." };
          }
          const outcome = await host.call(
            "transcribeFile",
            { path, timeoutMs: TRANSCRIBE_TIMEOUT_MS },
            { hostId, timeoutMs: TRANSCRIBE_TIMEOUT_MS + 5_000 },
          );
          return ok(
            [
              `engine ${outcome.engine}, ${(outcome.durationMs / 1000).toFixed(1)}s`,
              outcome.text,
              ...(outcome.rawText !== outcome.text ? ["", `before processing: ${outcome.rawText}`] : []),
            ].join("\n"),
          );
        }

        if (command === "history") {
          const limit = Number.parseInt(flags.positional[1] ?? "10", 10);
          const { entries } = await host.call(
            "historyList",
            { limit: Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 200) : 10 },
            { hostId },
          );
          if (entries.length === 0) {
            return ok("No transcripts yet.");
          }
          return ok(
            entries
              .map((entry) => {
                const when = entry.createdAt.replace("T", " ").slice(0, 19);
                const audio = entry.audioPath ? `\n  recording: ${entry.audioPath}` : "";
                return `${when} · ${entry.engine} · ${(entry.durationMs / 1000).toFixed(1)} с${audio}\n  ${entry.text}`;
              })
              .join("\n\n"),
          );
        }

        return { exitCode: 1, stderr: `Unknown command "${command}".` };
      } catch (error) {
        return { exitCode: 1, stderr: describe(error) };
      }
    },
  });
}

function ok(stdout: string) {
  return { exitCode: 0, stdout };
}

/** Разбор argv: позиционные аргументы, --machine <имя> и --reinstall. */
function readFlags(argv: string[]): { positional: string[]; machine?: string; reinstall: boolean } {
  const positional: string[] = [];
  let machine: string | undefined;
  let reinstall = false;
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]!;
    if (value === "--machine" || value === "--host") {
      machine = argv[index + 1];
      index += 1;
    } else if (value === "--reinstall") {
      reinstall = true;
    } else {
      positional.push(value);
    }
  }
  return { positional, machine, reinstall };
}

/**
 * Машина по умолчанию — та, где работает сервер BB: именно её BB просит
 * распознать голос. Первая подключённая машина в списке к делу не относится,
 * поэтому хосты опрашиваются и сверяются с именем машины сервера.
 */
async function resolveHostId(
  bb: BbPluginApi,
  host: { call: HostCall },
  requested: string | undefined,
): Promise<string> {
  const hosts = await bb.sdk.hosts.list();
  const connected = hosts.filter((item) => item.status === "connected");
  if (requested) {
    const match = connected.find((item) => item.id === requested || item.name === requested);
    if (!match) {
      throw new Error(`Machine "${requested}" is not among the connected ones.`);
    }
    return match.id;
  }
  if (connected.length === 0) {
    throw new Error("No connected machines.");
  }
  const serverHostname = hostname();
  for (const item of connected) {
    try {
      const identity = await host.call("identify", {}, { hostId: item.id });
      if (identity.hostname === serverHostname) {
        return item.id;
      }
    } catch {
      // Машина может быть занята или несовместима — проверяем следующую.
    }
  }
  throw new Error(
    "Could not tell which machine runs the BB server. Name it explicitly: --machine <name>.",
  );
}

type HostCall = <Method extends "identify">(
  method: Method,
  input: Record<string, never>,
  options: { hostId: string },
) => Promise<{ hostname: string; platform: string }>;

function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
