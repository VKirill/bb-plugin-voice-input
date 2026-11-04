import { findVoiceButton, mountVoiceInputInterceptor } from "./voice-interceptor.ts";
import { toast } from "sonner";
import { globalVoiceSession } from "./global-voice-session.ts";
import { manualImprovement } from "./manual-improvement.ts";
import { nativeDictation } from "./native-dictation.ts";
import {
  getDictationSettings, loadDictationSettings,
  resetDictationSettings, subscribeDictationSettings,
} from "./dictation-settings.ts";
import { loadFrontendLanguage, observeFrontendLanguage, words } from "./words.ts";

/** Exactly one recording owner; native mode installs no pointer/recording hotkeys. */
export function mountRecorderLifecycle({ signal }: { signal?: AbortSignal } = {}) {
  const controller = new AbortController();
  const stopLanguage = observeFrontendLanguage();
  void loadFrontendLanguage(controller.signal);
  const blockUnknownOwner = (event: Event) => {
    if (getDictationSettings().ready || !findVoiceButton(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    if (event.type === "click") {
      toast.error(words().status.loading);
      void loadDictationSettings(controller.signal);
    }
  };
  window.addEventListener("pointerdown", blockUnknownOwner, { capture: true });
  window.addEventListener("click", blockUnknownOwner, { capture: true });
  window.addEventListener("keydown", blockUnknownOwner, { capture: true });
  let disposeInterceptor: (() => void) | undefined;
  let interceptorController: AbortController | undefined;
  let previous = getDictationSettings();
  const sync = () => {
    const settings = getDictationSettings();
    if (settings.recorderMode !== previous.recorderMode
      || settings.aiPassEnabled !== previous.aiPassEnabled || settings.aiPassTrigger !== previous.aiPassTrigger
      || settings.aiPassMode !== previous.aiPassMode) {
      globalVoiceSession.cancelRecording();
      manualImprovement.clearTracking();
      nativeDictation.dispose();
    }
    previous = settings;
    if (settings.ready && settings.recorderMode === "plugin") {
      if (!disposeInterceptor) {
        interceptorController = new AbortController();
        disposeInterceptor = mountVoiceInputInterceptor({ signal: interceptorController.signal });
      }
    } else if (disposeInterceptor) {
      interceptorController?.abort();
      disposeInterceptor();
      disposeInterceptor = undefined;
      globalVoiceSession.cancelRecording();
    }
  };
  const unsubscribe = subscribeDictationSettings(sync);
  sync();
  void loadDictationSettings(controller.signal);

  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    controller.abort();
    signal?.removeEventListener("abort", dispose);
    unsubscribe();
    window.removeEventListener("pointerdown", blockUnknownOwner, { capture: true });
    window.removeEventListener("click", blockUnknownOwner, { capture: true });
    window.removeEventListener("keydown", blockUnknownOwner, { capture: true });
    interceptorController?.abort();
    disposeInterceptor?.();
    globalVoiceSession.cancelRecording();
    stopLanguage();
    manualImprovement.clearTracking();
    nativeDictation.dispose();
    resetDictationSettings();
  };
  if (signal?.aborted) dispose();
  else signal?.addEventListener("abort", dispose, { once: true });
  return dispose;
}
