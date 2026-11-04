// Глобальная сессия голосовой записи в браузере.
// Живёт на уровне окна приложения (App-level singleton) и не зависит
// от смены вкладок, роутинга или размонтирования компонентов PromptBox.

import { toast } from "sonner";
import {
  findComposerEditor,
  getComposerPlainText,
  getRememberedComposerCaret,
  insertIntoDraftText,
  insertTranscriptAtCaret,
  resolveComposerInsertOffset,
  submitComposerWhenReady,
} from "./composer-insert.ts";
import {
  createSilenceState,
  readDictationBehavior,
  silenceStep,
  type DictationBehavior,
  type SilenceState,
} from "./dictation-behavior.ts";
import { frontendLanguage, words } from "./words.ts";

export type VoiceRecordingState = "idle" | "recording" | "transcribing" | "error";

export interface VoiceTarget {
  kind: "thread" | "new-thread";
  threadId?: string;
  projectId?: string;
  originPath?: string;
  threadTitle?: string;
  promptContext?: string;
}

export interface VoiceSessionSnapshot {
  state: VoiceRecordingState;
  durationMs: number;
  levels: number[];
  target: VoiceTarget | null;
  error: string | null;
  /** Черновая расшифровка уже сказанного; пусто, пока предпросмотр выключен. */
  previewText: string;
}

export type TranscribeFunction = (args: {
  audioBase64: string;
  mimeType: string;
  filename: string;
  prompt?: string | null;
  uiLanguage?: string;
  preview?: boolean;
}) => Promise<{ ok: boolean; text: string; error: string | null }>;

const PREVIEW_INTERVAL_MS = 1000;
const PREVIEW_MIN_AUDIO_MS = 1000;

async function callTranscribeRpc(
  data: Parameters<TranscribeFunction>[0],
  signal: AbortSignal,
): Promise<{ ok: boolean; text: string; error: string | null }> {
  const res = await fetch("/api/v1/plugins/voice-input/rpc/transcribeAudio", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
    signal,
  });
  const rawJson: unknown = await res.json();
  if (rawJson && typeof rawJson === "object" && "result" in rawJson) {
    return (rawJson as { result: { ok: boolean; text: string; error: string | null } }).result;
  }
  return rawJson as { ok: boolean; text: string; error: string | null };
}

function extensionForMime(mimeType: string): string {
  return mimeType.includes("mp4") ? "m4a" : mimeType.includes("ogg") ? "ogg" : "webm";
}

function resolveAudioMimeType(): string {
  if (typeof MediaRecorder === "undefined") {
    return "audio/webm";
  }
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
    "audio/wav",
  ];
  for (const candidate of candidates) {
    if (MediaRecorder.isTypeSupported(candidate)) {
      return candidate;
    }
  }
  return "audio/webm";
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = reader.result as string;
      const commaIndex = dataUrl.indexOf(",");
      if (commaIndex !== -1) {
        resolve(dataUrl.slice(commaIndex + 1));
      } else {
        resolve(dataUrl);
      }
    };
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read audio blob"));
    reader.readAsDataURL(blob);
  });
}

function getDraftStorageKeys(target: VoiceTarget): string[] {
  const keys: string[] = [];
  if (target.kind === "new-thread") {
    keys.push("bb.promptbox.contents-draft-3");
  } else if (target.threadId) {
    if (target.projectId) {
      keys.push(
        `bb.promptbox.contents-${encodeURIComponent(target.projectId)}-${encodeURIComponent(target.threadId)}-3`,
      );
    }
    if (typeof window !== "undefined") {
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i);
        if (
          k &&
          k.startsWith("bb.promptbox.contents-") &&
          k.includes(target.threadId) &&
          !keys.includes(k)
        ) {
          keys.push(k);
        }
      }
    }
    keys.push(`bb.promptbox.contents--${encodeURIComponent(target.threadId)}-3`);
  }
  return keys;
}

export class GlobalVoiceSession {
  // Кэшированный неизменяемый снапшот — критически важен для стабильности useSyncExternalStore в React!
  private snapshot: VoiceSessionSnapshot = {
    state: "idle",
    durationMs: 0,
    levels: [0, 0, 0, 0, 0],
    target: null,
    error: null,
    previewText: "",
  };

  private startedAtMs: number | null = null;
  private mediaStream: MediaStream | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private recordedChunks: Blob[] = [];
  private mimeType: string = "audio/webm";

  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private timeData: Uint8Array<ArrayBuffer> | null = null;
  private frequencyData: Uint8Array<ArrayBuffer> | null = null;

  private timerInterval: number | null = null;
  private animationFrame: number | null = null;
  private wakeLockSentinel: { release: () => Promise<void> } | null = null;

  private behavior: DictationBehavior = readDictationBehavior();
  private silence: SilenceState | null = null;
  private autoStopSuppressed: () => boolean = () => false;
  // Каждая запись получает свой номер: запоздавший ответ предпросмотра от
  // прошлой записи не должен попасть в текущую.
  private recordingId = 0;
  private finalAbort: AbortController | null = null;
  private previewTimer: number | null = null;
  private previewAbort: AbortController | null = null;

  private transcribeFn: TranscribeFunction | null = null;
  private navigateFn: ((threadId?: string) => void) | null = null;

  private listeners = new Set<() => void>();

  public subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  public getSnapshot = (): VoiceSessionSnapshot => {
    return this.snapshot;
  };

  private updateSnapshot(patch: Partial<VoiceSessionSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) {
      listener();
    }
  }

  public getMediaStream = (): MediaStream | null => {
    return this.mediaStream;
  };

  public getAnalyser = (): AnalyserNode | null => {
    return this.analyser;
  };

  private isResumingAudio = false;

  public resumeAudioContext = (): void => {
    if (this.audioContext && this.audioContext.state === "suspended" && !this.isResumingAudio) {
      this.isResumingAudio = true;
      void this.audioContext.resume().finally(() => {
        this.isResumingAudio = false;
      });
    }
  };

  public getDurationMs = (): number => {
    if (this.startedAtMs !== null) {
      return Date.now() - this.startedAtMs;
    }
    return this.snapshot.durationMs;
  };

  public getAudioAmplitude = (): number => {
    if (this.audioContext && this.audioContext.state === "suspended") {
      this.resumeAudioContext();
    }
    if (!this.analyser || !this.timeData) return 0.08;
    this.analyser.getByteTimeDomainData(this.timeData);
    let sumSquares = 0;
    const len = this.timeData.length;
    for (let i = 0; i < len; i++) {
      const centered = ((this.timeData[i] ?? 128) - 128) / 128;
      sumSquares += centered * centered;
    }
    const rms = Math.sqrt(sumSquares / len);
    const boosted = Math.max(0, rms - 0.005) * 8;
    return Math.min(1, Math.max(0.08, boosted ** 0.65));
  };

  /** Пока возвращает true (например, клавиша диктовки зажата), тишина запись не останавливает. */
  public setAutoStopSuppressor(fn: () => boolean) {
    this.autoStopSuppressed = fn;
  }

  private readRms(): number {
    if (!this.analyser || !this.timeData) return 0;
    this.analyser.getByteTimeDomainData(this.timeData);
    let sumSquares = 0;
    for (let i = 0; i < this.timeData.length; i++) {
      const centered = ((this.timeData[i] ?? 128) - 128) / 128;
      sumSquares += centered * centered;
    }
    return Math.sqrt(sumSquares / this.timeData.length);
  }

  private checkSilence(now: number) {
    if (!this.silence) return;
    const step = silenceStep(this.silence, this.readRms(), now, this.behavior.silenceStopSeconds);
    this.silence = step.state;
    if (step.stop && !this.autoStopSuppressed()) {
      this.silence = null;
      void this.stopAndTranscribe();
    }
  }

  private schedulePreview(recordingId: number) {
    if (!this.behavior.livePreview) return;
    this.previewTimer = window.setTimeout(() => {
      this.previewTimer = null;
      void this.runPreview(recordingId);
    }, PREVIEW_INTERVAL_MS);
  }

  private async runPreview(recordingId: number) {
    if (recordingId !== this.recordingId || this.snapshot.state !== "recording") return;
    // Whisper hallucinates on pure silence ("Thank you."), so wait for speech when we can measure it.
    const heardSpeech = !this.analyser || (this.silence?.speechMs ?? 0) > 0;
    if (!heardSpeech || this.getDurationMs() < PREVIEW_MIN_AUDIO_MS || this.recordedChunks.length === 0) {
      this.schedulePreview(recordingId);
      return;
    }
    // Куски MediaRecorder склеиваются в валидный файл: заголовок в первом.
    const blob = new Blob(this.recordedChunks, { type: this.mimeType });
    const controller = new AbortController();
    this.previewAbort = controller;
    try {
      const result = await callTranscribeRpc(
        {
          audioBase64: await blobToBase64(blob),
          mimeType: this.mimeType,
          filename: `preview.${extensionForMime(this.mimeType)}`,
          prompt: this.snapshot.target?.promptContext ?? null,
          uiLanguage: frontendLanguage(),
          preview: true,
        },
        controller.signal,
      );
      if (recordingId !== this.recordingId || this.snapshot.state !== "recording") return;
      if (result.ok && result.text.trim()) {
        this.updateSnapshot({ previewText: result.text.trim() });
      } else if (result.error && /local engine/i.test(result.error)) {
        // Облачный движок: предпросмотр недоступен, дальше не пробуем.
        return;
      }
    } catch {
      // Предпросмотр необязателен: сбой не мешает основной расшифровке.
    } finally {
      if (this.previewAbort === controller) this.previewAbort = null;
    }
    this.schedulePreview(recordingId);
  }

  private stopPreview() {
    if (this.previewTimer !== null) {
      window.clearTimeout(this.previewTimer);
      this.previewTimer = null;
    }
    this.previewAbort?.abort();
    this.previewAbort = null;
  }

  public setTranscribeFn(fn: TranscribeFunction | null) {
    this.transcribeFn = fn;
  }

  public setNavigateFn(fn: ((threadId?: string) => void) | null) {
    this.navigateFn = fn;
  }

  public updateTargetTitle(title: string) {
    if (this.snapshot.target && !this.snapshot.target.threadTitle) {
      this.updateSnapshot({
        target: { ...this.snapshot.target, threadTitle: title },
      });
    }
  }

  public async startRecording(target: VoiceTarget): Promise<boolean> {
    if (this.snapshot.state === "recording" || this.snapshot.state === "transcribing") {
      return false;
    }

    this.recordedChunks = [];
    this.behavior = readDictationBehavior();
    const recordingId = ++this.recordingId;
    this.updateSnapshot({
      state: "recording",
      target,
      durationMs: 0,
      levels: [0, 0, 0, 0, 0],
      error: null,
      previewText: "",
    });

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      this.mediaStream = stream;
      this.mimeType = resolveAudioMimeType();

      try {
        const AudioContextClass =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (AudioContextClass) {
          const audioCtx = new AudioContextClass();
          this.audioContext = audioCtx;
          if (audioCtx.state === "suspended") {
            void audioCtx.resume();
          }
          const source = audioCtx.createMediaStreamSource(stream);
          const analyser = audioCtx.createAnalyser();
          analyser.fftSize = 256;
          analyser.smoothingTimeConstant = 0.5;
          source.connect(analyser);
          this.analyser = analyser;
          this.timeData = new Uint8Array(new ArrayBuffer(analyser.fftSize));
          this.frequencyData = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
        }
      } catch {}

      const recorder = new MediaRecorder(stream, { mimeType: this.mimeType });
      this.mediaRecorder = recorder;

      recorder.ondataavailable = (event: BlobEvent) => {
        if (event.data && event.data.size > 0) {
          this.recordedChunks.push(event.data);
        }
      };

      recorder.onerror = () => {
        const msg = words().voice.micError;
        toast.error(msg);
        this.cleanupAudio();
        this.updateSnapshot({ state: "idle", error: msg });
      };

      recorder.start(250);

      this.startedAtMs = Date.now();
      this.silence = createSilenceState(this.startedAtMs);
      this.schedulePreview(recordingId);

      this.timerInterval = window.setInterval(() => {
        if (this.startedAtMs !== null) {
          let nextLevels = this.snapshot.levels;
          if (this.analyser && this.frequencyData) {
            this.analyser.getByteFrequencyData(this.frequencyData);
            const binCount = this.analyser.frequencyBinCount;
            const step = Math.floor(binCount / 5);
            const levels: number[] = [];
            for (let i = 0; i < 5; i++) {
              let sum = 0;
              let count = 0;
              for (let j = i * step; j < (i + 1) * step && j < binCount; j++) {
                sum += this.frequencyData[j] ?? 0;
                count++;
              }
              const avg = count > 0 ? sum / count : 0;
              levels.push(Math.min(1, Math.max(0, avg / 220)));
            }
            nextLevels = levels;
          }
          this.updateSnapshot({
            durationMs: Date.now() - this.startedAtMs,
            levels: nextLevels,
          });
          this.checkSilence(Date.now());
        }
      }, 200);

      if ("wakeLock" in navigator && document.visibilityState === "visible") {
        try {
          (navigator as unknown as { wakeLock: { request: (type: string) => Promise<unknown> } }).wakeLock
            .request("screen")
            .then((sentinel) => {
              this.wakeLockSentinel = sentinel as { release: () => Promise<void> };
            })
            .catch(() => {});
        } catch {}
      }

      return true;
    } catch (err) {
      this.cleanupAudio();
      let errorMsg = words().voice.micFailed;
      if (err instanceof DOMException) {
        if (err.name === "NotAllowedError" || err.name === "SecurityError") {
          errorMsg = words().voice.micDenied;
        } else if (err.name === "NotFoundError") {
          errorMsg = words().voice.micNotFound;
        } else {
          errorMsg = err.message || errorMsg;
        }
      } else {
        errorMsg = err instanceof Error ? err.message : String(err);
      }
      this.updateSnapshot({ state: "idle", error: errorMsg });
      toast.error(errorMsg);
      return false;
    }
  }

  public async stopAndTranscribe(customTranscribeFn?: TranscribeFunction): Promise<void> {
    if (this.snapshot.state !== "recording") {
      return;
    }

    const currentTarget = this.snapshot.target;
    const recorder = this.mediaRecorder;
    const duration = this.getDurationMs();
    const autoSend = this.behavior.autoSend;

    // Свой номер у итоговой расшифровки: отмена или новая запись делают её устаревшей.
    const finalId = ++this.recordingId;
    const isCurrent = () => finalId === this.recordingId;
    this.stopPreview();
    this.updateSnapshot({ state: "transcribing" });

    await new Promise<void>((resolve) => {
      if (!recorder || recorder.state === "inactive") {
        resolve();
        return;
      }
      let finished = false;
      const finish = () => {
        if (!finished) {
          finished = true;
          clearTimeout(safetyTimer);
          resolve();
        }
      };
      const safetyTimer = setTimeout(finish, 1500);
      recorder.onstop = finish;
      try {
        recorder.stop();
      } catch {
        finish();
      }
    });

    this.cleanupAudio();
    if (!isCurrent()) return;

    if (duration < 500 || this.recordedChunks.length === 0) {
      this.updateSnapshot({ state: "idle", target: null, previewText: "" });
      toast.error(words().voice.tooShort);
      return;
    }

    const blob = new Blob(this.recordedChunks, { type: this.mimeType });
    this.recordedChunks = [];

    try {
      const audioBase64 = await blobToBase64(blob);
      const ext = extensionForMime(this.mimeType);

      const controller = new AbortController();
      this.finalAbort = controller;
      const fn =
        customTranscribeFn ||
        this.transcribeFn ||
        (async (data) => {
          const timer = setTimeout(() => controller.abort(), 60_000);
          try {
            return await callTranscribeRpc(data, controller.signal);
          } finally {
            clearTimeout(timer);
          }
        });

      const rawResult: unknown = await fn({
        audioBase64,
        mimeType: this.mimeType,
        filename: `recording.${ext}`,
        prompt: currentTarget?.promptContext ?? null,
        uiLanguage: frontendLanguage(),
      });

      const payload: Record<string, unknown> =
        rawResult && typeof rawResult === "object" && "result" in rawResult && (rawResult as any).result && typeof (rawResult as any).result === "object"
          ? ((rawResult as any).result as Record<string, unknown>)
          : rawResult && typeof rawResult === "object"
            ? (rawResult as Record<string, unknown>)
            : {};

      if (!isCurrent()) return;
      this.finalAbort = null;
      const isOk = payload.ok === true;
      const text = String(payload.text ?? "").trim();
      const errorMessage =
        typeof payload.error === "string"
          ? payload.error
          : payload.error && typeof payload.error === "object" && "message" in payload.error
            ? String((payload.error as { message: unknown }).message)
            : null;

      this.updateSnapshot({ state: "idle", target: null, previewText: "" });

      if (!isOk || !text) {
        toast.error(errorMessage || words().voice.notRecognized);
        return;
      }

      this.deliverTranscript(text, currentTarget, autoSend, isCurrent);
    } catch (err) {
      if (!isCurrent()) return;
      this.finalAbort = null;
      this.updateSnapshot({ state: "idle", target: null, previewText: "" });
      const msg =
        err instanceof DOMException && err.name === "AbortError"
          ? words().voice.timeout
          : err instanceof Error
            ? err.message
            : String(err);
      toast.error(msg);
    }
  }

  private persistDraftText(target: VoiceTarget, nextText: string) {
    const storageKeys = getDraftStorageKeys(target);
    for (const storageKey of storageKeys) {
      let draft: { text: string; attachments: unknown[]; mentions?: unknown[] } = {
        text: "",
        attachments: [],
      };
      try {
        const raw = window.localStorage.getItem(storageKey);
        if (raw) draft = JSON.parse(raw);
      } catch {}

      draft.text = nextText;

      try {
        window.localStorage.setItem(storageKey, JSON.stringify(draft));
        window.dispatchEvent(
          new StorageEvent("storage", {
            key: storageKey,
            newValue: JSON.stringify(draft),
          }),
        );
      } catch {}
    }
  }

  private persistDraftInsert(target: VoiceTarget, transcript: string, offsetHint: number | null) {
    const storageKeys = getDraftStorageKeys(target);
    for (const storageKey of storageKeys) {
      let draft: { text: string; attachments: unknown[]; mentions?: unknown[] } = {
        text: "",
        attachments: [],
      };
      try {
        const raw = window.localStorage.getItem(storageKey);
        if (raw) draft = JSON.parse(raw);
      } catch {}

      const existing = typeof draft.text === "string" ? draft.text : "";
      const offset =
        offsetHint === null ? existing.length : Math.max(0, Math.min(offsetHint, existing.length));
      draft.text = insertIntoDraftText(existing, transcript, offset).text;

      try {
        window.localStorage.setItem(storageKey, JSON.stringify(draft));
        window.dispatchEvent(
          new StorageEvent("storage", {
            key: storageKey,
            newValue: JSON.stringify(draft),
          }),
        );
      } catch {}
    }
  }

  private deliverTranscript(
    text: string,
    target: VoiceTarget | null,
    autoSend = false,
    isCurrent: () => boolean = () => true,
  ) {
    if (!target) return;

    const isInTarget = () => {
      const path = window.location.pathname;
      return target.kind === "thread" && target.threadId
        ? path.includes(target.threadId)
        : !path.includes("/threads/");
    };
    const isCurrentlyInTarget = isInTarget();

    const editor = isCurrentlyInTarget ? findComposerEditor() : null;
    const liveText = editor ? getComposerPlainText(editor) : "";
    const offset = isCurrentlyInTarget
      ? resolveComposerInsertOffset(liveText.length)
      : getRememberedComposerCaret();

    if (!isCurrentlyInTarget) {
      this.persistDraftInsert(target, text, offset);

      const targetName = target.threadTitle || words().voice.originChat;
      toast.success(words().voice.movedToChat(targetName));

      if (target.originPath) {
        window.history.pushState(null, "", target.originPath);
        window.dispatchEvent(new PopStateEvent("popstate"));
      } else if (target.kind === "thread" && target.threadId) {
        if (this.navigateFn) {
          this.navigateFn(target.threadId);
        } else {
          window.location.href = `/threads/${target.threadId}`;
        }
      } else if (target.kind === "new-thread") {
        if (this.navigateFn) {
          this.navigateFn();
        } else {
          window.location.href = `/`;
        }
      }

      setTimeout(() => {
        // Пока шла навигация, человек мог уйти в другой чат: его черновик не трогаем.
        if (!isCurrent() || !isInTarget()) return;
        const nextEditor = findComposerEditor();
        if (!nextEditor) return;
        const currentContent = getComposerPlainText(nextEditor);
        const draft = currentContent.includes(text)
          ? currentContent
          : insertTranscriptAtCaret(nextEditor, text, resolveComposerInsertOffset(currentContent.length)).text;
        if (autoSend) void submitComposerWhenReady(draft, { pathname: window.location.pathname, isCurrent });
      }, 350);
    } else {
      let draft: string | null = null;
      if (editor) {
        const inserted = insertTranscriptAtCaret(editor, text, offset ?? liveText.length);
        this.persistDraftText(target, inserted.text);
        draft = inserted.text;
      } else {
        this.persistDraftInsert(target, text, offset);
      }
      if (autoSend && draft !== null) {
        void submitComposerWhenReady(draft, { pathname: window.location.pathname, isCurrent }).then((sent) => {
          if (!sent) toast.success(words().voice.pasted);
        });
      } else {
        toast.success(words().voice.pasted);
      }
    }
  }

  public cancelRecording() {
    this.recordingId += 1;
    this.finalAbort?.abort();
    this.finalAbort = null;
    this.stopPreview();
    this.cleanupAudio();
    this.recordedChunks = [];
    this.updateSnapshot({ state: "idle", target: null, error: null, previewText: "" });
  }

  private cleanupAudio() {
    this.silence = null;
    if (this.timerInterval !== null) {
      window.clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    if (this.animationFrame !== null) {
      window.cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
    if (this.wakeLockSentinel) {
      void this.wakeLockSentinel.release().catch(() => {});
      this.wakeLockSentinel = null;
    }
    if (this.audioContext) {
      try {
        void this.audioContext.close();
      } catch {}
      this.audioContext = null;
    }
    this.analyser = null;
    this.timeData = null;
    this.frequencyData = null;

    if (this.mediaStream) {
      for (const track of this.mediaStream.getTracks()) {
        try {
          track.stop();
        } catch {}
      }
      this.mediaStream = null;
    }
    this.mediaRecorder = null;
    this.startedAtMs = null;
  }

  /** Обновить настройки поведения; действует и на уже идущую запись. */
  public setBehavior(behavior: DictationBehavior) {
    const previewTurnedOn = behavior.livePreview && !this.behavior.livePreview;
    this.behavior = behavior;
    if (previewTurnedOn && this.snapshot.state === "recording" && this.previewTimer === null && !this.previewAbort) {
      this.schedulePreview(this.recordingId);
    }
  }
}

// Единый глобальный инстанс на страницу
export const globalVoiceSession = new GlobalVoiceSession();
