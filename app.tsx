// Страница плагина: настройки разложены по вкладкам, чтобы каждая помещалась
// на экран целиком. Здесь же видно состояние движков на машине распознавания
// и ход загрузки модели — молчаливое ожидание в минуту это худшее, что может
// показать голосовой ввод.
import { useCallback, useEffect, useState } from "react";
import { definePluginApp, UrlLink, useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import type { rpcContract } from "./server";
import { AI_PASS_PROVIDERS, TRANSCRIBE_PROVIDERS, type ProviderInfo } from "./src/providers";
import { dictionary, LANGUAGE_NAMES, UI_LANGUAGES, type Dictionary } from "./src/i18n/index";
import { mountVoiceInputInterceptor } from "./src/frontend/voice-interceptor";

type EngineId = "whisper" | "gigaam" | "openai" | "google" | "groq";
type DiskModel = { engine: string; model: string; path: string; bytes: number; active: boolean };
type SettingsValues = Record<string, string | number | boolean>;
type PageState = {
  machine: string | null;
  error: string | null;
  pythonPath: string | null;
  ffmpegPath: string | null;
  recordings: number;
  engines: {
    engine: string;
    ready: boolean;
    detail: string;
    modelBytes: number;
    supported: boolean;
    unsupportedReason: string | null;
  }[];
  machineId: string | null;
  machines: {
    id: string;
    name: string;
    platform: string | null;
    localEnginesPossible: boolean;
  }[];
  activeEngine: string;
  settings: SettingsValues;
  whisperModelOptions: string[];
  aiPassConfigured: boolean;
  aiPassKeySource: "own" | "groq" | "openai" | "aiPass" | null;
  openaiConfigured: boolean;
  googleConfigured: boolean;
  groqConfigured: boolean;
  progress: {
    engine: string;
    percent: number | null;
    downloadedBytes: number | null;
    totalBytes: number | null;
    state: string;
    message: string | null;
  } | null;
};

const TABS = [
  { id: "general", icon: "Mic" },
  { id: "dictation", icon: "Clean" },
  { id: "vocabulary", icon: "FileText" },
  { id: "cloud", icon: "Cloud" },
  { id: "data", icon: "Layers" },
] as const;

const ENGINE_ORDER: EngineId[] = ["whisper", "gigaam", "groq", "openai", "google"];

const VOCABULARY_LIMIT = 800;

/** Размер файла. Единицы не переводятся: КБ/МБ/ГБ узнаваемы везде. */
/** Состояние движка приходит кодом: подпись выбирается по языку интерфейса. */
function engineStatusLabel(detail: string | undefined, t: Dictionary): string {
  if (detail === "ready") {
    return t.status.ready;
  }
  if (detail === "needs-key") {
    return t.status.needsKey;
  }
  if (detail?.startsWith("broken:")) {
    return t.status.broken;
  }
  return t.status.notInstalled;
}

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

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-4">
        <span className="text-sm">{label}</span>
        <div className="shrink-0">{children}</div>
      </div>
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </div>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2">
      <Checkbox checked={checked} onCheckedChange={(next) => onChange(next === true)} />
      <span className="flex flex-col gap-0.5">
        <span className="text-sm leading-tight">{label}</span>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </span>
    </label>
  );
}

function Select({
  value,
  options,
  onChange,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (next: string) => void;
}) {
  return (
    <select
      className="h-8 rounded-md border bg-background px-2 text-sm"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

function ProgressBar({ percent }: { percent: number | null }) {
  const known = percent !== null && Number.isFinite(percent);
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <div
        className={known ? "h-full bg-primary transition-[width]" : "h-full w-1/3 animate-pulse bg-primary"}
        style={known ? { width: `${Math.min(Math.max(percent, 0), 100)}%` } : undefined}
      />
    </div>
  );
}

/** Ключи из Env Catalog: `null`, если плагина нет или он выключен. */
type Catalog = { names: string[] } | null;

/**
 * Поле ключа: хранится в файле 0600 и во фронтенд не возвращается. Ключ
 * вводится руками всегда; если стоит Env Catalog, его можно выбрать оттуда.
 */
function KeyField({
  label,
  t,
  configured,
  borrowedFrom,
  catalog,
  catalogName,
  onSave,
  onLink,
}: {
  label: string;
  t: Dictionary;
  configured: boolean;
  /** Ключ взят у провайдера с тем же адресом — вводить его второй раз не нужно. */
  borrowedFrom?: string | null;
  catalog: Catalog;
  /** Имя ключа в каталоге, к которому привязано поле; пустое — ключ введён руками. */
  catalogName: string;
  onSave: (value: string) => void;
  onLink: (name: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const linked = catalog !== null && catalogName.length > 0;
  const status = linked
    ? t.cloud.keyFromCatalog(catalogName)
    : borrowedFrom
      ? t.cloud.keyBorrowed(borrowedFrom)
      : configured
        ? t.cloud.keySaved
        : t.cloud.keyMissing;
  const ready = configured || linked || Boolean(borrowedFrom);
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="pt-1.5 text-sm">{label}</span>
      <div className="flex w-80 shrink-0 flex-col gap-1.5">
        {catalog !== null && (
          <select
            className="h-8 rounded-md border bg-background px-2 text-sm"
            value={catalogName}
            onChange={(event) => onLink(event.target.value)}
          >
            <option value="">{t.cloud.keyManual}</option>
            {catalogName && !catalog.names.includes(catalogName) && (
              <option value={catalogName}>{catalogName}</option>
            )}
            {catalog.names.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        )}
        {!linked && (
          <div className="flex gap-2">
            <Input
              className={`h-8 flex-1 ${configured ? "border-emerald-500/60 placeholder:text-foreground/70" : ""}`}
              type="password"
              value={draft}
              placeholder={configured ? "••••••••••••" : t.cloud.keyPlaceholder}
              onChange={(event) => setDraft(event.target.value)}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={draft.length === 0}
              onClick={() => {
                onSave(draft);
                setDraft("");
              }}
            >
              {configured ? t.cloud.replace : t.cloud.save}
            </Button>
          </div>
        )}
        <span
          className={`flex items-center gap-1 text-xs ${ready ? "text-emerald-600" : "text-muted-foreground"}`}
        >
          <Icon name={ready ? "CircleCheck" : "AlertCircle"} className="size-3.5 shrink-0" aria-hidden />
          {status}
        </span>
      </div>
    </div>
  );
}

/** Карточка облачного провайдера: модель, адрес, ключ и где его взять. */
function ProviderCard({
  provider,
  t,
  model,
  baseUrl,
  configured,
  catalog,
  catalogName,
  selected,
  onSelect,
  onChange,
}: {
  provider: ProviderInfo;
  t: Dictionary;
  model: string;
  baseUrl: string;
  configured: boolean;
  catalog: Catalog;
  catalogName: string;
  selected: boolean;
  onSelect: () => void;
  onChange: (patch: SettingsValues) => void;
}) {
  return (
    <div className={`flex flex-col gap-2 rounded-lg border p-3 ${selected ? "border-primary" : ""}`}>
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-sm font-medium">
          {provider.title}
          {provider.free && (
            <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-xs font-normal text-emerald-600">
              {t.cloud.freeTier}
            </span>
          )}
        </span>
        <Button size="sm" variant={selected ? "default" : "outline"} onClick={onSelect}>
          {selected ? t.cloud.selected : t.cloud.select}
        </Button>
      </div>

      <span className="text-xs text-muted-foreground">
        {t.providerNotes.transcribe[provider.id as keyof Dictionary["providerNotes"]["transcribe"]]}
      </span>
      <span className="text-xs text-muted-foreground">
        {t.vocabulary.keyAt} <UrlLink href={provider.keyUrl}>{provider.keyUrl}</UrlLink>
      </span>

      <Row label={t.cloud.model}>
        <Select
          value={model}
          options={provider.models.map((name) => ({ value: name, label: name }))}
          onChange={(next) => onChange({ [`${provider.id}Model`]: next })}
        />
      </Row>
      <Row label={t.cloud.apiUrl}>
        <Input
          className="h-8 w-64"
          value={baseUrl}
          onChange={(event) => onChange({ [`${provider.id}BaseUrl`]: event.target.value })}
        />
      </Row>
      <KeyField
        label={t.cloud.key}
        t={t}
        configured={configured}
        catalog={catalog}
        catalogName={catalogName}
        onSave={(value) => onChange({ [`${provider.id}ApiKey`]: value })}
        onLink={(name) => onChange({ [`${provider.id}KeyCatalog`]: name })}
      />
    </div>
  );
}

function VoiceInputSettings() {
  const rpc = useRpc<typeof rpcContract>();
  const [state, setState] = useState<PageState | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("general");
  const [busy, setBusy] = useState<string | null>(null);
  const [vocabularyDraft, setVocabularyDraft] = useState<string | null>(null);
  const [diskModels, setDiskModels] = useState<DiskModel[]>([]);
  const [catalog, setCatalog] = useState<Catalog>(null);

  const refreshModels = useCallback(async () => {
    try {
      setDiskModels((await rpc.call("diskModels", null)).models);
    } catch {
      setDiskModels([]);
    }
  }, [rpc]);

  const refresh = useCallback(async () => {
    try {
      setState((await rpc.call("state", null)) as PageState);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }, [rpc]);

  useEffect(() => {
    void refresh();
    void refreshModels();
    void rpc
      .call("catalogKeys", null)
      .then((result) => setCatalog(result.available ? { names: result.names } : null))
      .catch(() => setCatalog(null));
  }, [refresh, refreshModels, rpc]);

  // Прогресс приходит сигналами с машины распознавания: страница не опрашивает.
  useRealtime("model-progress", (payload) => {
    setState((previous) =>
      previous ? { ...previous, progress: payload as PageState["progress"] } : previous,
    );
  });
  useRealtime("state-changed", () => {
    void refresh();
    void refreshModels();
  });

  const save = async (patch: SettingsValues) => {
    setState((previous) =>
      previous ? { ...previous, settings: { ...previous.settings, ...patch } } : previous,
    );
    try {
      await rpc.call("updateSettings", patch);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
      await refresh();
    }
  };

  const runEngineAction = async (engine: EngineId, action: "setup" | "download") => {
    setBusy(`${engine}:${action}`);
    try {
      if (action === "setup") {
        const result = await rpc.call("setupEngine", { engine });
        toast[result.ready ? "success" : "error"](result.detail);
      } else {
        const result = await rpc.call("downloadEngineModel", { engine });
        toast[result.ready ? "success" : "error"](result.detail);
      }
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };

  if (!state) {
    return <p className="text-sm text-muted-foreground">{dictionary("en").status.loading}</p>;
  }

  const values = state.settings;
  const t = dictionary(String(values.uiLanguage ?? "en"));
  const vocabulary = vocabularyDraft ?? String(values.vocabulary ?? "");
  const activeEngine = state.engines.find((engine) => engine.engine === state.activeEngine);
  const progress =
    state.progress && state.progress.state === "downloading" ? state.progress : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-end gap-2">
        <span className="text-xs text-muted-foreground">{t.language.label}</span>
        <Select
          value={String(values.uiLanguage ?? "en")}
          options={UI_LANGUAGES.map((code) => ({ value: code, label: LANGUAGE_NAMES[code] }))}
          onChange={(next) => void save({ uiLanguage: next })}
        />
      </div>

      <div className="flex gap-1 rounded-lg bg-muted/50 p-1">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors ${
              tab === item.id ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon name={item.icon} className="size-4" aria-hidden />
            {t.tabs[item.id]}
          </button>
        ))}
      </div>

      {state.error && (
        <p className="text-sm text-destructive">
          {t.errors.machineUnreachable(state.error)}
        </p>
      )}

      {tab === "general" && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            {ENGINE_ORDER.map((id) => {
              const engine = { id, ...t.engines[id] };
              const status = state.engines.find((item) => item.engine === engine.id);
              const selected = state.activeEngine === engine.id;
              // Движок, которого на выбранной машине не поднять, выбрать нельзя.
              const unavailable = status ? status.supported === false : false;
              return (
                <button
                  key={engine.id}
                  type="button"
                  disabled={unavailable}
                  title={status?.unsupportedReason ?? undefined}
                  onClick={() => void save({ engine: engine.id })}
                  className={`flex flex-col gap-1 rounded-lg border p-3 text-left transition-colors ${
                    unavailable
                      ? "cursor-not-allowed opacity-50"
                      : selected
                        ? "border-primary bg-primary/5"
                        : "hover:bg-muted/50"
                  }`}
                >
                  <span className="flex items-center gap-2 text-sm font-medium">
                    {engine.title}
                    <span
                      className={`text-xs font-normal ${
                        status?.ready ? "text-emerald-600" : "text-muted-foreground"
                      }`}
                    >
                      {engineStatusLabel(status?.detail, t)}
                    </span>
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {status?.unsupportedReason ?? engine.hint}
                  </span>
                </button>
              );
            })}
          </div>

          {activeEngine && !activeEngine.ready && (
            <Button
              size="sm"
              disabled={busy !== null}
              onClick={() => void runEngineAction(state.activeEngine as EngineId, "setup")}
            >
              {busy ? t.general.installing : `${t.general.installEngine} «${state.activeEngine}»`}
            </Button>
          )}

          {progress && (
            <div className="flex flex-col gap-1">
              <ProgressBar percent={progress.percent} />
              <span className="text-xs text-muted-foreground">
                {t.general.downloading(progress.engine)}
                {progress.percent !== null ? ` — ${progress.percent.toFixed(1)} %` : ""}
                {progress.totalBytes
                  ? ` (${formatBytes(progress.downloadedBytes ?? 0)} / ${formatBytes(progress.totalBytes)})`
                  : ""}
              </span>
            </div>
          )}

          {state.activeEngine === "whisper" && (
            <Row
              label={t.general.whisperModel}
              hint={t.general.whisperModelHint}
            >
              <Select
                value={String(values.whisperModel ?? "")}
                options={state.whisperModelOptions.map((option) => ({ value: option, label: option }))}
                onChange={(next) => void save({ whisperModel: next })}
              />
            </Row>
          )}

          <Row
            label="Машина распознавания"
            hint="Где выполняется распознавание. Локальные модели работают только на macOS."
          >
            <Select
              value={String(values.machine ?? "")}
              options={[
                { value: "", label: "Автоматически — машина сервера" },
                ...state.machines.map((item) => ({
                  value: item.id,
                  label: item.localEnginesPossible
                    ? item.name
                    : `${item.name} — только облачные движки`,
                })),
              ]}
              onChange={(next) => void save({ machine: next })}
            />
          </Row>

          <Row label={t.general.speechLanguage} hint={t.general.speechLanguageHint}>
            <Select
              value={String(values.language ?? "auto")}
              options={[
                { value: "auto", label: t.general.languageAuto },
                ...Object.entries(t.general.speechLanguages).map(([code, label]) => ({
                  value: code,
                  label,
                })),
              ]}
              onChange={(next) => void save({ language: next })}
            />
          </Row>

          <p className="text-xs text-muted-foreground">
            {t.general.machineLine(
              state.machine ?? "—",
              state.pythonPath ?? t.general.notFound,
              state.ffmpegPath ?? t.general.notFound,
            )}
          </p>
        </div>
      )}

      {tab === "dictation" && (
        <div className="flex flex-col gap-3">
          <Toggle
            label={t.dictation.fillers}
            hint={t.dictation.fillersHint}
            checked={values.cleanupFillers === true}
            onChange={(next) => void save({ cleanupFillers: next })}
          />
          <Toggle
            label={t.dictation.quotes}
            hint={t.dictation.quotesHint}
            checked={values.cleanupQuotes === true}
            onChange={(next) => void save({ cleanupQuotes: next })}
          />
        </div>
      )}

      {tab === "vocabulary" && (
        <div className="flex flex-col gap-3">
          <textarea
            className="min-h-24 w-full rounded-md border bg-background p-2 text-sm"
            value={vocabulary}
            onChange={(event) => setVocabularyDraft(event.target.value)}
            onBlur={() => {
              if (vocabularyDraft !== null && vocabularyDraft !== values.vocabulary) {
                void save({ vocabulary: vocabularyDraft });
              }
              setVocabularyDraft(null);
            }}
            placeholder={t.vocabulary.placeholder}
          />
          <span className="text-xs text-muted-foreground">
            {t.vocabulary.counter(vocabulary.length, VOCABULARY_LIMIT)} {t.vocabulary.hint}
          </span>
          <Toggle
            label={t.vocabulary.repair}
            hint={t.vocabulary.repairHint}
            checked={values.vocabularyRepair === true}
            onChange={(next) => void save({ vocabularyRepair: next })}
          />
          <Toggle
            label={t.vocabulary.prompt}
            hint={t.vocabulary.promptHint}
            checked={values.vocabularyPrompt === true}
            onChange={(next) => void save({ vocabularyPrompt: next })}
          />
          <Toggle
            label={t.vocabulary.aiPass}
            hint={t.vocabulary.aiPassHint}
            checked={values.aiPassEnabled === true}
            onChange={(next) => void save({ aiPassEnabled: next })}
          />
          {values.aiPassEnabled === true && (
            <div className="flex flex-col gap-2 rounded-lg border p-3">
              {(() => {
                const current =
                  AI_PASS_PROVIDERS.find(
                    (item) => item.baseUrl === String(values.aiPassBaseUrl ?? ""),
                  ) ?? null;
                return (
                  <>
                    <Row label={t.vocabulary.provider} hint={
                        current
                          ? t.providerNotes.aiPass[current.id as keyof Dictionary["providerNotes"]["aiPass"]]
                          : t.vocabulary.apiUrlHint
                      }>
                      <Select
                        value={current?.id ?? "__custom__"}
                        options={[
                          ...AI_PASS_PROVIDERS.map((item) => ({
                            value: item.id,
                            label: item.free ? `${item.title} — ${t.cloud.freeTier}` : item.title,
                          })),
                          { value: "__custom__", label: t.vocabulary.providerCustom },
                        ]}
                        onChange={(next) => {
                          const provider = AI_PASS_PROVIDERS.find((item) => item.id === next);
                          if (provider) {
                            void save({
                              aiPassBaseUrl: provider.baseUrl,
                              aiPassModel: provider.models[0] ?? "",
                            });
                          }
                        }}
                      />
                    </Row>
                    {current && (
                      <span className="text-xs text-muted-foreground">
                        {t.vocabulary.keyAt}{" "}
                        <UrlLink href={current.keyUrl}>{current.keyUrl}</UrlLink>
                      </span>
                    )}
                    <Row label={t.vocabulary.model}>
                      {current ? (
                        <Select
                          value={String(values.aiPassModel ?? "")}
                          options={current.models.map((name) => ({ value: name, label: name }))}
                          onChange={(next) => void save({ aiPassModel: next })}
                        />
                      ) : (
                        <Input
                          className="h-8 w-64"
                          value={String(values.aiPassModel ?? "")}
                          onChange={(event) => void save({ aiPassModel: event.target.value })}
                        />
                      )}
                    </Row>
                    <Row label={t.vocabulary.apiUrl}>
                      <Input
                        className="h-8 w-64"
                        value={String(values.aiPassBaseUrl ?? "")}
                        onChange={(event) => void save({ aiPassBaseUrl: event.target.value })}
                      />
                    </Row>
                  </>
                );
              })()}
              <KeyField
                label={t.cloud.key}
                t={t}
                configured={state.aiPassConfigured}
                borrowedFrom={
                  state.aiPassKeySource === "groq"
                    ? "Groq"
                    : state.aiPassKeySource === "openai"
                      ? "OpenAI"
                      : null
                }
                catalog={catalog}
                catalogName={String(values.aiPassKeyCatalog ?? "")}
                onSave={(value) => void save({ aiPassApiKey: value })}
                onLink={(name) => void save({ aiPassKeyCatalog: name })}
              />
            </div>
          )}
        </div>
      )}

      {tab === "cloud" && (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-muted-foreground">
            {t.cloud.notice}
          </p>

          {TRANSCRIBE_PROVIDERS.map((provider) => (
            <ProviderCard
              key={provider.id}
              provider={provider}
              t={t}
              model={String(values[`${provider.id}Model`] ?? provider.models[0] ?? "")}
              baseUrl={String(values[`${provider.id}BaseUrl`] ?? provider.baseUrl)}
              configured={
                provider.id === "openai"
                  ? state.openaiConfigured
                  : provider.id === "google"
                    ? state.googleConfigured
                    : state.groqConfigured
              }
              catalog={catalog}
              catalogName={String(values[`${provider.id}KeyCatalog`] ?? "")}
              selected={state.activeEngine === provider.id}
              onSelect={() => void save({ engine: provider.id })}
              onChange={(patch) => void save(patch)}
            />
          ))}
        </div>
      )}

      {tab === "data" && (
        <div className="flex flex-col gap-3">
          <Toggle
            label={t.data.saveRecordings}
            hint={t.data.saveRecordingsHint}
            checked={values.saveRecordings === true}
            onChange={(next) => void save({ saveRecordings: next })}
          />
          <Row label={t.data.keepDays} hint={t.data.keepDaysHint}>
            <Input
              className="h-8 w-20"
              type="number"
              min={0}
              value={String(values.keepDays ?? 14)}
              onChange={(event) => {
                const next = Number.parseInt(event.target.value, 10);
                if (Number.isFinite(next) && next >= 0) {
                  void save({ keepDays: next });
                }
              }}
            />
          </Row>
          <span className="text-xs text-muted-foreground">
            {t.data.recordingsCount(state.recordings)}
          </span>

          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">{t.data.modelsTitle}</span>
            {diskModels.length === 0 && (
              <span className="text-xs text-muted-foreground">
                {t.data.modelsEmpty}
              </span>
            )}
            {diskModels.map((item) => (
              <div
                key={item.path}
                className="flex items-center justify-between gap-3 rounded-lg border p-3"
              >
                <div className="flex flex-col">
                  <span className="text-sm">
                    {item.model}
                    {item.active && (
                      <span className="ml-2 text-xs text-emerald-600">{t.data.inUse}</span>
                    )}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {item.engine} · {formatBytes(item.bytes)}
                  </span>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy !== null}
                  onClick={() => {
                    setBusy(item.path);
                    void rpc
                      .call("deleteEngineModel", {
                        engine: item.engine as EngineId,
                        model: item.model,
                      })
                      .then(async (result) => {
                        toast.success(
                          result.freedBytes > 0
                            ? t.data.freed(formatBytes(result.freedBytes))
                            : t.data.nothingToDelete,
                        );
                        await refreshModels();
                        await refresh();
                      })
                      .catch((error: unknown) =>
                        toast.error(error instanceof Error ? error.message : String(error)),
                      )
                      .finally(() => setBusy(null));
                  }}
                >
                  {t.data.delete}
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-2 flex flex-col gap-1 border-t pt-3 text-xs text-muted-foreground">
        <span>{t.credits.borrowed}</span>
        <span>
          {t.credits.authorship}{" "}
          <UrlLink href="https://voica.ru/">{t.credits.website}</UrlLink>
          {" · "}
          <UrlLink href="https://github.com/Inhum/voica">{t.credits.source}</UrlLink>
          {" · "}
          <UrlLink href="https://github.com/Inhum">{t.credits.author}</UrlLink>
        </span>
      </div>
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.settingsSection({
    id: "voice-input",
    component: VoiceInputSettings,
  });

  app.contentScripts.register({
    id: "voice-input-interceptor",
    mount: mountVoiceInputInterceptor,
  });
});
