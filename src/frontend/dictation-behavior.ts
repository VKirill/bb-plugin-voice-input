// Поведение диктовки: автоотправка, остановка по тишине, живой предпросмотр.
// Настройки живут на сервере, а сюда приходят так же, как горячая клавиша:
// через localStorage и событие окна, чтобы сессия читала их без запроса.

export interface DictationBehavior {
  autoSend: boolean;
  silenceStopSeconds: number;
  livePreview: boolean;
}

export const DEFAULT_DICTATION_BEHAVIOR: DictationBehavior = {
  autoSend: false,
  silenceStopSeconds: 0,
  livePreview: false,
};

export const DICTATION_BEHAVIOR_STORAGE_KEY = "bb.voice-input.dictation-behavior";
export const DICTATION_BEHAVIOR_EVENT = "bb-voice-input:dictation-behavior";

export function dictationBehaviorFromSettings(settings: Record<string, unknown>): DictationBehavior {
  const seconds = Number(settings.silenceStopSeconds);
  return {
    autoSend: settings.autoSend === true,
    silenceStopSeconds: Number.isFinite(seconds) && seconds > 0 ? Math.min(10, seconds) : 0,
    livePreview: settings.livePreview === true,
  };
}

export function publishDictationBehavior(behavior: DictationBehavior): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DICTATION_BEHAVIOR_STORAGE_KEY, JSON.stringify(behavior));
  } catch {}
  window.dispatchEvent(new CustomEvent(DICTATION_BEHAVIOR_EVENT, { detail: behavior }));
}

export function readDictationBehavior(): DictationBehavior {
  if (typeof window === "undefined") return DEFAULT_DICTATION_BEHAVIOR;
  try {
    const raw = window.localStorage.getItem(DICTATION_BEHAVIOR_STORAGE_KEY);
    if (raw) return dictationBehaviorFromSettings(JSON.parse(raw) as Record<string, unknown>);
  } catch {}
  return DEFAULT_DICTATION_BEHAVIOR;
}

// Порог речи по RMS сигнала. Браузер уже давит шум и выравнивает громкость,
// поэтому тишина держится около 0.001–0.01, а голос заметно выше. Порог ещё
// и плавает над измеренным фоном, чтобы шумная комната не держала запись.
const MIN_SPEECH_RMS = 0.02;
const NOISE_FLOOR_FACTOR = 2.5;
// Щелчок или вдох не должен взводить остановку: нужна хотя бы доля секунды речи.
const MIN_SPEECH_MS = 300;

export interface SilenceState {
  speechMs: number;
  lastSpeechAt: number;
  lastSampleAt: number;
  noiseFloor: number;
}

export function createSilenceState(now: number): SilenceState {
  return { speechMs: 0, lastSpeechAt: now, lastSampleAt: now, noiseFloor: 0.005 };
}

export function isSpeech(rms: number, noiseFloor: number): boolean {
  return rms > Math.max(MIN_SPEECH_RMS, noiseFloor * NOISE_FLOOR_FACTOR);
}

/** Один замер уровня. stop = пора заканчивать запись: речь была, а потом стихла. */
export function silenceStep(
  state: SilenceState,
  rms: number,
  now: number,
  silenceStopSeconds: number,
): { state: SilenceState; stop: boolean } {
  const elapsed = Math.max(0, now - state.lastSampleAt);
  if (isSpeech(rms, state.noiseFloor)) {
    const next = { ...state, speechMs: state.speechMs + elapsed, lastSpeechAt: now, lastSampleAt: now };
    return { state: next, stop: false };
  }
  const next = {
    ...state,
    lastSampleAt: now,
    noiseFloor: state.noiseFloor * 0.9 + rms * 0.1,
  };
  const armed = silenceStopSeconds > 0 && state.speechMs >= MIN_SPEECH_MS;
  return { state: next, stop: armed && now - state.lastSpeechAt >= silenceStopSeconds * 1000 };
}
