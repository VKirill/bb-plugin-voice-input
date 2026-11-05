import assert from "node:assert/strict";
import { test, afterEach } from "node:test";
import {
  getDictationSettings, getDictationSettingsRevision, manualEditingEnabled,
  publishDictationSettings, resetDictationSettings, subscribeDictationSettings,
} from "../src/frontend/dictation-settings.ts";

afterEach(resetDictationSettings);

test("unknown settings do not enable manual editing", () => {
  resetDictationSettings();
  assert.equal(getDictationSettings().ready, false);
  assert.equal(manualEditingEnabled(), false);
});

test("legacy confirmed settings keep automatic editing", () => {
  publishDictationSettings({ aiPassEnabled: true });
  assert.deepEqual(getDictationSettings(), {
    aiPassEnabled: true, aiPassTrigger: "automatic", aiPassMode: "terms", ready: true,
  });
  assert.equal(manualEditingEnabled(), false);
});

test("manual editing requires explicit enablement", () => {
  {
    publishDictationSettings({ aiPassEnabled: true, aiPassTrigger: "manual" });
    assert.equal(manualEditingEnabled(), true);
    publishDictationSettings({ aiPassEnabled: false, aiPassTrigger: "manual" });
    assert.equal(manualEditingEnabled(), false);
  }
});

test("confirmed publications advance revisions and notify listeners", () => {
  const before = getDictationSettingsRevision();
  let calls = 0;
  const stop = subscribeDictationSettings(() => { calls += 1; });
  publishDictationSettings({});
  stop();
  assert.equal(getDictationSettingsRevision(), before + 1);
  assert.equal(calls, 1);
});
