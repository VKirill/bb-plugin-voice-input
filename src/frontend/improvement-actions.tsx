import React, { useEffect, useSyncExternalStore } from "react";
import { useComposer, useRealtime, type PluginComposerApi } from "@get-bb/plugin-sdk/app";
import { Button } from "../../components/ui/button";
import { manualImprovement } from "./manual-improvement.ts";
import { nativeDictation } from "./native-dictation.ts";
import { frontendLanguage, subscribeFrontendLanguage, words } from "./words.ts";
import { getDictationSettings, loadDictationSettings, manualEditingEnabled, subscribeDictationSettings } from "./dictation-settings.ts";

export async function improveDictation(composer: PluginComposerApi) {
  if (!manualEditingEnabled() || composer.isSubmitting || composer.isSubmittingBlocked) return;
  await manualImprovement.improve(composer, async (text) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 40_000);
    try {
      const response = await fetch("/api/v1/plugins/voice-input/rpc/improveText", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }), signal: controller.signal,
      });
      const raw = await response.json();
      const result = raw?.result ?? raw;
      if (!response.ok || result?.ok !== true || typeof result.text !== "string") {
        throw new Error(typeof result?.error === "string" ? result.error : words().improvement.failed);
      }
      return result.text;
    } finally { clearTimeout(timer); }
  });
}

function useImprovement() {
  const composer = useComposer();
  const version = useSyncExternalStore(manualImprovement.subscribe, manualImprovement.getVersion);
  const settings = useSyncExternalStore(subscribeDictationSettings, getDictationSettings);
  const enabled = manualEditingEnabled();
  useSyncExternalStore(subscribeFrontendLanguage, frontendLanguage);
  useEffect(() => manualImprovement.register(composer), [composer, composer.key]);
  useEffect(() => {
    manualImprovement.sync(composer);
    if (enabled && settings.recorderMode === "native") nativeDictation.observe(composer);
  }, [composer, composer.key, composer.draft, version, enabled, settings.recorderMode]);
  useRealtime("native-transcript", (payload) => {
    if (enabled && settings.recorderMode === "native") nativeDictation.receive(payload, manualImprovement.getComposers());
  });
  useRealtime("state-changed", () => { void loadDictationSettings(); });
  useEffect(() => composer.onSubmitted(() => {
    manualImprovement.clear(composer.key);
    nativeDictation.clear(composer.key);
  }), [composer, composer.key]);
  return { composer, entry: manualImprovement.get(composer.key), t: words().improvement, enabled };
}

export function ImprovementAction() {
  const { composer, entry, t, enabled } = useImprovement();
  if (!enabled) return null;
  return (
    <span title={t.hint}>
      <Button type="button" variant="ghost" size="sm" aria-label={t.improve}
        disabled={!entry || entry.status === "busy" || composer.isSubmittingBlocked}
        onClick={() => void improveDictation(composer)}>
        {entry?.status === "busy" ? t.busy : t.improve}
      </Button>
    </span>
  );
}

export function ImprovementBanner() {
  const { composer, entry, t, enabled } = useImprovement();
  if (!enabled || !entry) return null;
  const compact = composer.layout === "compact";
  const visible = entry.status !== "idle" || entry.error || compact;
  if (!visible) return null;
  return (
    <div className="flex flex-col gap-2 rounded-md border bg-background p-2 text-sm" role="status" aria-live="polite">
      {entry.status === "busy" && <span>{t.busy}</span>}
      {entry.error && <span className="text-destructive">{entry.error === "mentions" ? t.mentions : `${t.failed} ${entry.error}`}</span>}
      {entry.status === "preview" && <>
        <span>{t.changed}</span>
        <p className="max-h-48 overflow-auto whitespace-pre-wrap">{entry.result}</p>
        <div className="flex gap-2">
          <Button type="button" size="sm" disabled={composer.isSubmittingBlocked} onClick={() => manualImprovement.apply(composer)}>{t.apply}</Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => manualImprovement.clear(composer.key)}>{t.dismiss}</Button>
        </div>
      </>}
      {entry.status === "done" && entry.undo && <div className="flex items-center gap-2">
        <span>{t.done}</span>
        <Button type="button" size="sm" variant="ghost" onClick={() => manualImprovement.undo(composer)}>{t.undo}</Button>
      </div>}
      {compact && entry.status === "idle" && <Button type="button" size="sm" variant="outline"
        disabled={composer.isSubmittingBlocked} onClick={() => void improveDictation(composer)}>{t.improve}</Button>}
    </div>
  );
}
