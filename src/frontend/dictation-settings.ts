export type DictationSettings = {
  recorderMode: "plugin" | "native";
  aiPassEnabled: boolean;
  aiPassTrigger: "automatic" | "manual";
  aiPassMode: "terms" | "intent";
};

const DEFAULTS: DictationSettings = {
  recorderMode: "plugin", aiPassEnabled: false, aiPassTrigger: "automatic", aiPassMode: "terms",
};
let snapshot = { ...DEFAULTS, ready: false };
let revision = 0;
let generation = 0;
let loadRequest = 0;
const listeners = new Set<() => void>();

export const getDictationSettings = () => snapshot;
export const getDictationSettingsRevision = () => revision;
export const getDictationGeneration = () => generation;
export function subscribeDictationSettings(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Publish only settings confirmed by the server, not optimistic form edits. */
export function publishDictationSettings(settings: Record<string, unknown>) {
  revision += 1;
  const next = {
    recorderMode: settings.recorderMode === "native" ? "native" : "plugin",
    aiPassEnabled: settings.aiPassEnabled === true,
    aiPassTrigger: settings.aiPassTrigger === "manual" ? "manual" : "automatic",
    aiPassMode: settings.aiPassMode === "intent" ? "intent" : "terms",
    ready: true,
  } as const;
  if (next.recorderMode !== snapshot.recorderMode || next.aiPassEnabled !== snapshot.aiPassEnabled
    || next.aiPassTrigger !== snapshot.aiPassTrigger || next.aiPassMode !== snapshot.aiPassMode) generation += 1;
  snapshot = next;
  for (const listener of listeners) listener();
}

export function manualEditingEnabled() {
  return snapshot.ready && snapshot.aiPassEnabled && snapshot.aiPassTrigger === "manual";
}

export function resetDictationSettings() {
  revision += 1;
  generation += 1;
  snapshot = { ...DEFAULTS, ready: false };
  for (const listener of listeners) listener();
}

export async function loadDictationSettings(signal?: AbortSignal) {
  const started = revision;
  const request = ++loadRequest;
  try {
    const response = await fetch("/api/v1/plugins/voice-input/rpc/state", {
      method: "POST", headers: { "content-type": "application/json" }, body: "null", signal,
    });
    if (!response.ok) return;
    const raw = await response.json();
    const state = raw?.result ?? raw;
    if (!signal?.aborted && revision === started && request === loadRequest && state?.settings) publishDictationSettings(state.settings);
  } catch {}
}
