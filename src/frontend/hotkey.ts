// Горячая клавиша диктовки: удержание пишет, отпустил — стоп;
// два быстрых нажатия оставляют запись, пока не нажмут ещё раз.

export const HOTKEY_STORAGE_KEY = "bb-plugin-voice-input.hotkey";
export const HOTKEY_EVENT = "bb-voice-input-hotkey";
export const HOLD_MS = 280;
export const DOUBLE_TAP_MS = 420;

export type VoiceHotkeyConfig = {
  enabled: boolean;
  code: string;
  alt: boolean;
  ctrl: boolean;
  shift: boolean;
  meta: boolean;
};

export const DEFAULT_HOTKEY: VoiceHotkeyConfig = {
  enabled: true,
  code: "AltRight",
  alt: false,
  ctrl: false,
  shift: false,
  meta: false,
};

const PRESET = (code: string): VoiceHotkeyConfig => ({
  enabled: true,
  code,
  alt: false,
  ctrl: false,
  shift: false,
  meta: false,
});

/** Как в Voica: правый Option по умолчанию, затем левый Option, оба Command и Control. Fn в webview нет. */
export const HOTKEY_PRESETS: { id: string; config: VoiceHotkeyConfig }[] = [
  { id: "altRight", config: { ...DEFAULT_HOTKEY } },
  { id: "altLeft", config: PRESET("AltLeft") },
  { id: "metaRight", config: PRESET("MetaRight") },
  { id: "metaLeft", config: PRESET("MetaLeft") },
  { id: "ctrl", config: PRESET("ControlLeft") },
];

const MODIFIER_CODES = new Set([
  "AltLeft",
  "AltRight",
  "ControlLeft",
  "ControlRight",
  "ShiftLeft",
  "ShiftRight",
  "MetaLeft",
  "MetaRight",
  "Fn",
]);

export type HotkeyKeyEvent = {
  code: string;
  altKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
  repeat?: boolean;
};

export function isModifierCode(code: string): boolean {
  return MODIFIER_CODES.has(code);
}

export function parseHotkeyConfig(raw: unknown): VoiceHotkeyConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...DEFAULT_HOTKEY };
  }
  const source = raw as Record<string, unknown>;
  const code = typeof source.code === "string" ? source.code : DEFAULT_HOTKEY.code;
  return {
    enabled: source.enabled !== false,
    code,
    alt: source.alt === true,
    ctrl: source.ctrl === true,
    shift: source.shift === true,
    meta: source.meta === true,
  };
}

export function hotkeyFromSettings(values: Record<string, unknown> | null | undefined): VoiceHotkeyConfig {
  if (!values) return { ...DEFAULT_HOTKEY };
  return parseHotkeyConfig({
    enabled: values.hotkeyEnabled !== false,
    code: typeof values.hotkeyCode === "string" ? values.hotkeyCode : DEFAULT_HOTKEY.code,
    alt: values.hotkeyAlt === true,
    ctrl: values.hotkeyCtrl === true,
    shift: values.hotkeyShift === true,
    meta: values.hotkeyMeta === true,
  });
}

export function hotkeyToSettings(config: VoiceHotkeyConfig): Record<string, boolean | string> {
  return {
    hotkeyEnabled: config.enabled,
    hotkeyCode: config.code,
    hotkeyAlt: config.alt,
    hotkeyCtrl: config.ctrl,
    hotkeyShift: config.shift,
    hotkeyMeta: config.meta,
  };
}

function codeFamily(code: string): string {
  if (code === "ControlLeft" || code === "ControlRight") return "Control";
  return code;
}

export function configsMatch(a: VoiceHotkeyConfig, b: VoiceHotkeyConfig): boolean {
  return (
    a.enabled === b.enabled &&
    codeFamily(a.code) === codeFamily(b.code) &&
    a.alt === b.alt &&
    a.ctrl === b.ctrl &&
    a.shift === b.shift &&
    a.meta === b.meta
  );
}

export function hotkeySelectValue(config: VoiceHotkeyConfig): string {
  if (!config.enabled || !config.code) return "off";
  const preset = HOTKEY_PRESETS.find((item) => configsMatch(config, item.config));
  return preset?.id ?? "custom";
}

export function eventMatchesHotkey(event: HotkeyKeyEvent, config: VoiceHotkeyConfig): boolean {
  if (!config.enabled || !config.code) return false;
  if (codeFamily(event.code) !== codeFamily(config.code)) return false;

  const selfAlt = config.code === "AltLeft" || config.code === "AltRight";
  const selfCtrl = config.code === "ControlLeft" || config.code === "ControlRight";
  const selfShift = config.code === "ShiftLeft" || config.code === "ShiftRight";
  const selfMeta = config.code === "MetaLeft" || config.code === "MetaRight";

  if (config.alt && !event.altKey && !selfAlt) return false;
  if (config.ctrl && !event.ctrlKey && !selfCtrl) return false;
  if (config.shift && !event.shiftKey && !selfShift) return false;
  if (config.meta && !event.metaKey && !selfMeta) return false;

  if (!isModifierCode(config.code)) {
    if (!config.alt && event.altKey) return false;
    if (!config.ctrl && event.ctrlKey) return false;
    if (!config.shift && event.shiftKey) return false;
    if (!config.meta && event.metaKey) return false;
  }

  return true;
}

const CODE_LABELS: Record<string, string> = {
  AltRight: "Right Option",
  AltLeft: "Left Option",
  ControlRight: "Control",
  ControlLeft: "Control",
  ShiftRight: "Right Shift",
  ShiftLeft: "Left Shift",
  MetaRight: "Right Command",
  MetaLeft: "Left Command",
  Fn: "Fn",
  Space: "Space",
  CapsLock: "Caps Lock",
};

export function formatHotkey(config: VoiceHotkeyConfig): string {
  if (!config.code) return "";
  const parts: string[] = [];
  if (config.ctrl) parts.push("Ctrl");
  if (config.alt) parts.push("Option");
  if (config.shift) parts.push("Shift");
  if (config.meta) parts.push("Command");
  if (CODE_LABELS[config.code]) {
    parts.push(CODE_LABELS[config.code]);
  } else if (config.code.startsWith("Key") && config.code.length === 4) {
    parts.push(config.code.slice(3));
  } else if (config.code.startsWith("Digit") && config.code.length === 6) {
    parts.push(config.code.slice(5));
  } else {
    parts.push(config.code);
  }
  return parts.join(" + ");
}

export function shouldIgnoreTypingTarget(
  config: VoiceHotkeyConfig,
  target: { closest?: (selector: string) => unknown } | null,
): boolean {
  if (isModifierCode(config.code) || config.alt || config.ctrl || config.meta) {
    return false;
  }
  if (/^F\d{1,2}$/.test(config.code)) {
    return false;
  }
  if (!target || typeof target.closest !== "function") {
    return false;
  }
  return Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

export function configFromKeyboardEvent(event: HotkeyKeyEvent): VoiceHotkeyConfig {
  const modifierOnly = isModifierCode(event.code);
  return {
    enabled: true,
    code: event.code,
    alt: modifierOnly ? false : event.altKey,
    ctrl: modifierOnly ? false : event.ctrlKey,
    shift: modifierOnly ? false : event.shiftKey,
    meta: modifierOnly ? false : event.metaKey,
  };
}

export type PttMode = "idle" | "holding" | "pending" | "latched";

export type PttAction = "start" | "stop" | "none";

export type PttState = {
  mode: PttMode;
  downAt: number;
  lastUp: number;
  stopAt: number | null;
};

export function createPttState(): PttState {
  return { mode: "idle", downAt: 0, lastUp: 0, stopAt: null };
}

export function pttKeyDown(state: PttState, now: number): { state: PttState; action: PttAction } {
  if (state.mode === "latched") {
    return { state: { ...createPttState() }, action: "stop" };
  }
  if (state.mode === "pending" && now - state.lastUp <= DOUBLE_TAP_MS) {
    return { state: { ...state, mode: "latched", stopAt: null }, action: "none" };
  }
  if (state.mode === "holding") {
    return { state, action: "none" };
  }
  return {
    state: { mode: "holding", downAt: now, lastUp: state.lastUp, stopAt: null },
    action: "start",
  };
}

export function pttKeyUp(state: PttState, now: number): { state: PttState; action: PttAction; delayMs: number } {
  if (state.mode === "latched") {
    return { state, action: "none", delayMs: 0 };
  }
  if (state.mode !== "holding") {
    return { state, action: "none", delayMs: 0 };
  }
  const held = now - state.downAt;
  if (held >= HOLD_MS) {
    return { state: createPttState(), action: "stop", delayMs: 0 };
  }
  return {
    state: { ...state, mode: "pending", lastUp: now, stopAt: now + DOUBLE_TAP_MS },
    action: "none",
    delayMs: DOUBLE_TAP_MS,
  };
}

export function pttTimerFired(state: PttState, now: number): { state: PttState; action: PttAction } {
  if (state.mode !== "pending" || state.stopAt === null || now < state.stopAt) {
    return { state, action: "none" };
  }
  return { state: createPttState(), action: "stop" };
}

export function publishHotkeyConfig(config: VoiceHotkeyConfig): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(HOTKEY_STORAGE_KEY, JSON.stringify(config));
  } catch {}
  window.dispatchEvent(new CustomEvent(HOTKEY_EVENT, { detail: config }));
}

export function readPublishedHotkeyConfig(): VoiceHotkeyConfig {
  if (typeof window === "undefined") return { ...DEFAULT_HOTKEY };
  try {
    const raw = window.localStorage.getItem(HOTKEY_STORAGE_KEY);
    if (raw) return parseHotkeyConfig(JSON.parse(raw));
  } catch {}
  return { ...DEFAULT_HOTKEY };
}
