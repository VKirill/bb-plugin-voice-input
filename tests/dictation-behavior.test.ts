import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_DICTATION_BEHAVIOR,
  createSilenceState,
  dictationBehaviorFromSettings,
  silenceStep,
  type SilenceState,
} from "../src/frontend/dictation-behavior.ts";
import { DEFAULT_SETTINGS, mergeSettings, sanitizePatch } from "../src/settings-store.ts";

const SPEECH = 0.12;
const QUIET = 0.003;

function feed(state: SilenceState, samples: [number, number][], seconds: number) {
  let current = state;
  const stops: number[] = [];
  for (const [at, rms] of samples) {
    const step = silenceStep(current, rms, at, seconds);
    current = step.state;
    if (step.stop) stops.push(at);
  }
  return { state: current, stops };
}

function series(from: number, to: number, rms: number): [number, number][] {
  const out: [number, number][] = [];
  for (let at = from; at <= to; at += 200) out.push([at, rms]);
  return out;
}

test("silence before any speech never stops the recording", () => {
  const { stops } = feed(createSilenceState(0), series(200, 10_000, QUIET), 1.5);
  assert.deepEqual(stops, []);
});

test("stops once speech is followed by enough silence", () => {
  const samples = [...series(200, 2000, SPEECH), ...series(2200, 5000, QUIET)];
  const { stops } = feed(createSilenceState(0), samples, 1.5);
  assert.equal(stops[0], 3600);
});

test("a short pause between words does not stop", () => {
  const samples = [
    ...series(200, 1000, SPEECH),
    ...series(1200, 2000, QUIET),
    ...series(2200, 3000, SPEECH),
  ];
  const { stops } = feed(createSilenceState(0), samples, 1.5);
  assert.deepEqual(stops, []);
});

test("a single click is not enough to arm the stop", () => {
  const samples: [number, number][] = [[200, SPEECH], ...series(400, 6000, QUIET)];
  const { stops } = feed(createSilenceState(0), samples, 1);
  assert.deepEqual(stops, []);
});

test("zero seconds disables the stop", () => {
  const samples = [...series(200, 2000, SPEECH), ...series(2200, 9000, QUIET)];
  const { stops } = feed(createSilenceState(0), samples, 0);
  assert.deepEqual(stops, []);
});

test("steady background noise raises the speech threshold", () => {
  const noisy = 0.03;
  // Сначала комната шумит без речи: порог должен подняться над фоном.
  let { state } = feed(createSilenceState(0), series(200, 4000, 0.015), 1.5);
  state = feed(state, series(4200, 6000, SPEECH), 1.5).state;
  const { stops } = feed(state, series(6200, 9000, noisy), 1.5);
  assert.ok(stops.length > 0, "noise above the floor still counts as silence after speech");
});

test("behavior is read from plugin settings", () => {
  assert.deepEqual(dictationBehaviorFromSettings({}), DEFAULT_DICTATION_BEHAVIOR);
  assert.deepEqual(
    dictationBehaviorFromSettings({ autoSend: true, silenceStopSeconds: 1.5, livePreview: true }),
    { autoSend: true, silenceStopSeconds: 1.5, livePreview: true },
  );
  assert.equal(dictationBehaviorFromSettings({ silenceStopSeconds: 99 }).silenceStopSeconds, 10);
  assert.equal(dictationBehaviorFromSettings({ silenceStopSeconds: "x" }).silenceStopSeconds, 0);
});

test("new settings default to off and accept valid patches", () => {
  assert.equal(DEFAULT_SETTINGS.autoSend, false);
  assert.equal(DEFAULT_SETTINGS.silenceStopSeconds, 0);
  assert.equal(DEFAULT_SETTINGS.livePreview, false);
  assert.deepEqual(sanitizePatch({ autoSend: true, silenceStopSeconds: 1.5, livePreview: true }), {
    autoSend: true,
    silenceStopSeconds: 1.5,
    livePreview: true,
  });
  assert.deepEqual(sanitizePatch({ silenceStopSeconds: 60 }), {});
  assert.equal(mergeSettings({ silenceStopSeconds: 2 }).silenceStopSeconds, 2);
});
