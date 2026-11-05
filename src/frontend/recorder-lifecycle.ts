import { mountVoiceInputInterceptor } from "./voice-interceptor.ts";
import { globalVoiceSession } from "./global-voice-session.ts";
import { manualImprovement } from "./manual-improvement.ts";
import {
  getDictationGeneration, getDictationSettings, loadDictationSettings,
  resetDictationSettings, subscribeDictationSettings,
} from "./dictation-settings.ts";

export function mountRecorderLifecycle({ signal }: { signal?: AbortSignal } = {}) {
  const controller = new AbortController();
  const disposeInterceptor = mountVoiceInputInterceptor({ signal: controller.signal });
  let generation = getDictationGeneration();
  let ready = getDictationSettings().ready;
  const unsubscribe = subscribeDictationSettings(() => {
    const next = getDictationGeneration();
    if (ready && next !== generation) {
      globalVoiceSession.cancelRecording();
      manualImprovement.clearTracking();
    }
    generation = next;
    ready = getDictationSettings().ready;
  });
  void loadDictationSettings(controller.signal);
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    controller.abort();
    signal?.removeEventListener("abort", dispose);
    unsubscribe();
    disposeInterceptor();
    globalVoiceSession.cancelRecording();
    manualImprovement.clearTracking();
    resetDictationSettings();
  };
  if (signal?.aborted) dispose();
  else signal?.addEventListener("abort", dispose, { once: true });
  return dispose;
}
