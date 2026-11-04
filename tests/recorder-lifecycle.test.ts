import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { GlobalVoiceSession, type TranscribeFunction } from "../src/frontend/global-voice-session.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function stream() {
  const track = { stops: 0, stop() { this.stops += 1; } };
  return { track, getTracks: () => [track] };
}

function browser(t: TestContext, getUserMedia: () => Promise<ReturnType<typeof stream>> = async () => stream()) {
  let now = 1_000;
  const recorders: Recorder[] = [];
  class Recorder {
    static isTypeSupported() { return true; }
    state = "inactive";
    mimeType = "audio/webm;codecs=opus";
    stops = 0;
    ondataavailable: ((event: { data: Blob }) => void) | null = null;
    onerror: (() => void) | null = null;
    onstop: (() => void) | null = null;
    constructor() { recorders.push(this); }
    start() { this.state = "recording"; }
    emit(value: string) { this.ondataavailable?.({ data: new Blob([value]) }); }
    stop() {
      this.stops += 1;
      this.state = "inactive";
      this.emit("-final");
      this.onstop?.();
    }
  }
  class Reader {
    result = "";
    onloadend: (() => void) | null = null;
    onerror = null;
    readAsDataURL(blob: Blob) {
      void blob.arrayBuffer().then((bytes) => {
        this.result = `data:${blob.type};base64,${Buffer.from(bytes).toString("base64")}`;
        this.onloadend?.();
      });
    }
  }
  const globals: Record<string, unknown> = {
    MediaRecorder: Recorder,
    FileReader: Reader,
    navigator: { mediaDevices: { getUserMedia } },
    window: { setInterval: () => 1, clearInterval() {} },
    document: { visibilityState: "hidden", documentElement: { lang: "en" } },
  };
  const session = new GlobalVoiceSession();
  t.after(() => session.cancelRecording());
  for (const [key, value] of Object.entries(globals)) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value, configurable: true });
    t.after(() => {
      if (previous) Object.defineProperty(globalThis, key, previous);
      else Reflect.deleteProperty(globalThis, key);
    });
  }
  t.mock.method(Date, "now", () => now);
  const payloads: Array<Parameters<TranscribeFunction>[0]> = [];
  session.setTranscribeFn(async (input) => {
    payloads.push(input);
    return { ok: false, text: "", error: null };
  });
  return { session, recorders, payloads, advance: () => { now += 1_000; } };
}

test("cancel stops the recorder and microphone tracks", async (t) => {
  const audio = stream();
  const { session, recorders } = browser(t, async () => audio);
  assert.equal(await session.startRecording({ kind: "new-thread" }), true);
  session.cancelRecording();
  assert.equal(recorders[0]!.stops, 1);
  assert.equal(recorders[0]!.state, "inactive");
  assert.equal(recorders[0]!.ondataavailable, null);
  assert.equal(recorders[0]!.onerror, null);
  assert.equal(recorders[0]!.onstop, null);
  assert.equal(audio.track.stops, 1);
  assert.equal(session.getSnapshot().state, "idle");
});

test("late data from a cancelled recorder cannot contaminate the next recording", async (t) => {
  const { session, recorders, payloads, advance } = browser(t);
  await session.startRecording({ kind: "new-thread" });
  const oldData = recorders[0]!.ondataavailable!;
  session.cancelRecording();
  await session.startRecording({ kind: "new-thread" });
  oldData({ data: new Blob(["OLD-STREAM"]) });
  recorders[1]!.emit("WEBM-HEADER-new");
  advance();
  await session.stopAndTranscribe();
  assert.equal(Buffer.from(payloads[0]!.audioBase64, "base64").toString(), "WEBM-HEADER-new-final");
});

test("late data and error callbacks from a cancelled recorder cannot affect the next recording", async (t) => {
  const { session, recorders, payloads, advance } = browser(t);
  await session.startRecording({ kind: "new-thread" });
  const oldData = recorders[0]!.ondataavailable!;
  const oldError = recorders[0]!.onerror!;
  session.cancelRecording();
  await session.startRecording({ kind: "new-thread" });
  oldData({ data: new Blob(["OLD-STREAM"]) });
  oldError();
  assert.equal(session.getSnapshot().state, "recording");
  recorders[1]!.emit("WEBM-HEADER-new");
  advance();
  await session.stopAndTranscribe();
  assert.equal(payloads.length, 1);
  assert.equal(Buffer.from(payloads[0]!.audioBase64, "base64").toString(), "WEBM-HEADER-new-final");
});

test("cancelling pending microphone access releases its stream without starting an old recorder", async (t) => {
  const first = deferred<ReturnType<typeof stream>>();
  const second = deferred<ReturnType<typeof stream>>();
  const requests = [first, second];
  const { session, recorders } = browser(t, () => requests.shift()!.promise);
  const startOld = session.startRecording({ kind: "new-thread" });
  session.cancelRecording();
  const startNew = session.startRecording({ kind: "new-thread" });
  const oldStream = stream();
  first.resolve(oldStream);
  assert.equal(await startOld, false);
  assert.equal(oldStream.track.stops, 1);
  assert.equal(recorders.length, 0);
  second.resolve(stream());
  assert.equal(await startNew, true);
  assert.equal(recorders.length, 1);
  assert.equal(session.getSnapshot().state, "recording");
});

test("a rejected old microphone request does not stop a new recording", async (t) => {
  const first = deferred<ReturnType<typeof stream>>();
  let calls = 0;
  const { session, recorders } = browser(t, () => calls++ === 0 ? first.promise : Promise.resolve(stream()));
  const startOld = session.startRecording({ kind: "new-thread" });
  session.cancelRecording();
  assert.equal(await session.startRecording({ kind: "new-thread" }), true);
  first.reject(new Error("Old request failed"));
  assert.equal(await startOld, false);
  assert.equal(session.getSnapshot().state, "recording");
  assert.equal(recorders[0]!.state, "recording");
});

test("normal stop preserves the final audio chunk and isolates consecutive recordings", async (t) => {
  const { session, recorders, payloads, advance } = browser(t);
  for (let i = 0; i < 2; i += 1) {
    await session.startRecording({ kind: "new-thread" });
    recorders[i]!.emit(`WEBM-HEADER-${i}`);
    advance();
    await session.stopAndTranscribe();
    assert.equal(recorders[i]!.stops, 1);
    assert.equal(session.getSnapshot().state, "idle");
  }
  assert.deepEqual(payloads.map((input) => Buffer.from(input.audioBase64, "base64").toString()), [
    "WEBM-HEADER-0-final",
    "WEBM-HEADER-1-final",
  ]);
});

test("cancelled transcription results cannot reset a newer recording", async (t) => {
  const { session, recorders, advance } = browser(t);
  const result = deferred<{ ok: boolean; text: string; error: string | null }>();
  const requested = deferred<void>();
  session.setTranscribeFn(async () => {
    requested.resolve();
    return await result.promise;
  });
  await session.startRecording({ kind: "new-thread" });
  recorders[0]!.emit("WEBM-HEADER-old");
  advance();
  const transcribing = session.stopAndTranscribe();
  await requested.promise;
  session.cancelRecording();
  await session.startRecording({ kind: "new-thread" });
  result.resolve({ ok: false, text: "", error: null });
  await transcribing;
  assert.equal(session.getSnapshot().state, "recording");
  assert.equal(recorders[1]!.state, "recording");
});

test("a late transcription rejection cannot reset a newer recording", async (t) => {
  const { session, recorders, advance } = browser(t);
  const result = deferred<{ ok: boolean; text: string; error: string | null }>();
  const requested = deferred<void>();
  session.setTranscribeFn(async () => {
    requested.resolve();
    return await result.promise;
  });
  await session.startRecording({ kind: "new-thread" });
  recorders[0]!.emit("WEBM-HEADER-old");
  advance();
  const transcribing = session.stopAndTranscribe();
  await requested.promise;
  session.cancelRecording();
  await session.startRecording({ kind: "new-thread" });
  result.reject(new Error("Old transcription failed"));
  await transcribing;
  assert.equal(session.getSnapshot().state, "recording");
  assert.equal(recorders[1]!.state, "recording");
});

test("a late wake lock is released instead of replacing the next recording's lock", async (t) => {
  const { session } = browser(t);
  const first = deferred<{ release: () => Promise<void> }>();
  const second = deferred<{ release: () => Promise<void> }>();
  const locks = [first, second];
  Object.assign(navigator, { wakeLock: { request: () => locks.shift()!.promise } });
  Object.assign(document, { visibilityState: "visible" });
  await session.startRecording({ kind: "new-thread" });
  session.cancelRecording();
  await session.startRecording({ kind: "new-thread" });
  let oldReleases = 0;
  let newReleases = 0;
  second.resolve({ release: async () => { newReleases += 1; } });
  await second.promise;
  first.resolve({ release: async () => { oldReleases += 1; } });
  await first.promise;
  assert.equal(oldReleases, 1);
  assert.equal(newReleases, 0);
  session.cancelRecording();
  assert.equal(newReleases, 1);
});
