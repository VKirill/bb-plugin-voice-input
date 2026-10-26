import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DOUBLE_TAP_MS,
  HOLD_MS,
  HOTKEY_PRESETS,
  configFromKeyboardEvent,
  createPttState,
  eventMatchesHotkey,
  formatHotkey,
  hotkeyFromSettings,
  hotkeySelectValue,
  parseHotkeyConfig,
  pttKeyDown,
  pttKeyUp,
  pttTimerFired,
  pttInterrupted,
  shouldIgnoreTypingTarget,
} from "../src/frontend/hotkey.ts";

test("правый Option совпадает сам с собой даже когда altKey включён", () => {
  const config = parseHotkeyConfig({ enabled: true, code: "AltRight" });
  assert.equal(
    eventMatchesHotkey({ code: "AltRight", altKey: true, ctrlKey: false, shiftKey: false, metaKey: false }, config),
    true,
  );
  assert.equal(
    eventMatchesHotkey({ code: "AltLeft", altKey: true, ctrlKey: false, shiftKey: false, metaKey: false }, config),
    false,
  );
});

test("Control слева и справа — одна клавиша", () => {
  const left = parseHotkeyConfig({ enabled: true, code: "ControlLeft" });
  assert.equal(
    eventMatchesHotkey({ code: "ControlRight", altKey: false, ctrlKey: true, shiftKey: false, metaKey: false }, left),
    true,
  );
  const right = parseHotkeyConfig({ enabled: true, code: "ControlRight" });
  assert.equal(
    eventMatchesHotkey({ code: "ControlLeft", altKey: false, ctrlKey: true, shiftKey: false, metaKey: false }, right),
    true,
  );
});

test("Option+V требует и букву, и Option", () => {
  const config = parseHotkeyConfig({ enabled: true, code: "KeyV", alt: true });
  assert.equal(
    eventMatchesHotkey({ code: "KeyV", altKey: true, ctrlKey: false, shiftKey: false, metaKey: false }, config),
    true,
  );
  assert.equal(
    eventMatchesHotkey({ code: "KeyV", altKey: false, ctrlKey: false, shiftKey: false, metaKey: false }, config),
    false,
  );
});

test("удержание сразу стартует и по отпусканию длинного нажатия останавливает", () => {
  let state = createPttState();
  const down = pttKeyDown(state, 1000);
  assert.equal(down.action, "start");
  const up = pttKeyUp(down.state, 1000 + HOLD_MS + 20);
  assert.equal(up.action, "stop");
  assert.equal(up.state.mode, "idle");
});

test("двойное короткое нажатие ставит защёлку, третье останавливает", () => {
  let state = createPttState();
  const firstDown = pttKeyDown(state, 1000);
  assert.equal(firstDown.action, "start");
  const firstUp = pttKeyUp(firstDown.state, 1080);
  assert.equal(firstUp.action, "none");
  assert.equal(firstUp.state.mode, "pending");
  const secondDown = pttKeyDown(firstUp.state, 1080 + 80);
  assert.equal(secondDown.action, "none");
  assert.equal(secondDown.state.mode, "latched");
  const third = pttKeyDown(secondDown.state, 5000);
  assert.equal(third.action, "stop");
  assert.equal(third.state.mode, "idle");
});

test("одно короткое нажатие без второго отменяет запись без распознавания", () => {
  const firstDown = pttKeyDown(createPttState(), 1000);
  const firstUp = pttKeyUp(firstDown.state, 1100);
  const later = pttTimerFired(firstUp.state, 1100 + DOUBLE_TAP_MS);
  assert.equal(later.action, "cancel");
  assert.equal(later.state.mode, "idle");
});

test("другая клавиша при зажатой клавише диктовки (Alt+Tab, Alt+Shift) отменяет запись", () => {
  const down = pttKeyDown(createPttState(), 1000);
  const chord = pttInterrupted(down.state);
  assert.equal(chord.action, "cancel");
  assert.equal(chord.state.mode, "idle");
  const pending = pttKeyUp(pttKeyDown(createPttState(), 1000).state, 1100);
  assert.equal(pttInterrupted(pending.state).action, "cancel");
});

test("закреплённую двойным нажатием запись другие клавиши не прерывают", () => {
  const firstUp = pttKeyUp(pttKeyDown(createPttState(), 1000).state, 1080);
  const latched = pttKeyDown(firstUp.state, 1160);
  assert.equal(latched.state.mode, "latched");
  assert.equal(pttInterrupted(latched.state).action, "none");
  assert.equal(pttInterrupted(createPttState()).action, "none");
});

test("буква без модификатора в поле ввода игнорируется", () => {
  const config = parseHotkeyConfig({ enabled: true, code: "KeyA" });
  assert.equal(shouldIgnoreTypingTarget(config, { closest: (sel) => sel.includes("input") }), true);
  const option = parseHotkeyConfig({ enabled: true, code: "AltRight" });
  assert.equal(shouldIgnoreTypingTarget(option, { closest: () => true }), false);
});

test("подпись, выбор списка и разбор настроек", () => {
  assert.equal(formatHotkey({ enabled: true, code: "AltRight", alt: false, ctrl: false, shift: false, meta: false }), "Right Option");
  assert.equal(formatHotkey({ enabled: true, code: "KeyV", alt: true, ctrl: false, shift: false, meta: false }), "Option + V");
  assert.deepEqual(
    HOTKEY_PRESETS.map((preset) => preset.id),
    ["altRight", "altLeft", "metaRight", "metaLeft", "ctrl"],
  );
  assert.equal(
    hotkeySelectValue({ enabled: true, code: "AltRight", alt: false, ctrl: false, shift: false, meta: false }),
    "altRight",
  );
  assert.equal(
    hotkeySelectValue({ enabled: true, code: "ControlRight", alt: false, ctrl: false, shift: false, meta: false }),
    "ctrl",
  );
  assert.equal(
    hotkeySelectValue({ enabled: true, code: "KeyV", alt: true, ctrl: false, shift: false, meta: false }),
    "custom",
  );
  assert.equal(hotkeySelectValue({ enabled: false, code: "", alt: false, ctrl: false, shift: false, meta: false }), "off");
  const fromSettings = hotkeyFromSettings({ hotkeyEnabled: true, hotkeyCode: "MetaRight" });
  assert.equal(fromSettings.code, "MetaRight");
  const captured = configFromKeyboardEvent({
    code: "ControlRight",
    altKey: false,
    ctrlKey: true,
    shiftKey: false,
    metaKey: false,
  });
  assert.equal(captured.code, "ControlRight");
  assert.equal(captured.ctrl, false);
});
