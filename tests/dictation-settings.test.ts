import assert from "node:assert/strict";
import { test, afterEach } from "node:test";
import {
  getDictationSettings, getDictationSettingsRevision, manualEditingEnabled,
  publishDictationSettings, resetDictationSettings, subscribeDictationSettings,
} from "../src/frontend/dictation-settings.ts";

afterEach(resetDictationSettings);

test("unknown settings do not enable interception or manual editing", () => {
  resetDictationSettings();
  assert.equal(getDictationSettings().ready, false);
  assert.equal(manualEditingEnabled(), false);
});

test("legacy confirmed settings keep plugin recording and automatic editing", () => {
  publishDictationSettings({ aiPassEnabled: true });
  assert.deepEqual(getDictationSettings(), {
    recorderMode: "plugin", aiPassEnabled: true, aiPassTrigger: "automatic", aiPassMode: "terms", ready: true,
  });
  assert.equal(manualEditingEnabled(), false);
});

test("manual editing requires explicit enablement independently of recorder choice", () => {
  for (const recorderMode of ["plugin", "native"]) {
    publishDictationSettings({ recorderMode, aiPassEnabled: true, aiPassTrigger: "manual" });
    assert.equal(manualEditingEnabled(), true);
    publishDictationSettings({ recorderMode, aiPassEnabled: false, aiPassTrigger: "manual" });
    assert.equal(manualEditingEnabled(), false);
  }
});

test("confirmed publications advance revisions and notify listeners", () => {
  const before = getDictationSettingsRevision();
  let calls = 0;
  const stop = subscribeDictationSettings(() => { calls += 1; });
  publishDictationSettings({ recorderMode: "native" });
  stop();
  assert.equal(getDictationSettingsRevision(), before + 1);
  assert.equal(calls, 1);
});
