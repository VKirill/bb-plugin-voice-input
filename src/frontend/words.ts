import { dictionary, resolveUiLanguage } from "../i18n/index.ts";

let language = "auto";
let revision = 0;
const listeners = new Set<() => void>();

export function frontendLanguage() {
  return resolveUiLanguage(language === "auto" && typeof document !== "undefined"
    ? document.documentElement.lang
    : language);
}

export function setFrontendLanguage(next: string) {
  language = next;
  revision += 1;
  for (const listener of listeners) listener();
}

export function subscribeFrontendLanguage(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function observeFrontendLanguage() {
  const observer = new MutationObserver(() => {
    for (const listener of listeners) listener();
  });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
  return () => observer.disconnect();
}

export function words() {
  return dictionary(frontendLanguage());
}

export async function loadFrontendLanguage(signal?: AbortSignal): Promise<void> {
  const started = revision;
  try {
    const res = await fetch("/api/v1/plugins/voice-input/rpc/uiLanguage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "null",
      signal,
    });
    if (!res.ok) return;
    const raw: unknown = await res.json();
    const out = raw && typeof raw === "object" && "result" in raw ? (raw as { result: unknown }).result : raw;
    if (revision === started && !signal?.aborted && out && typeof out === "object" &&
        "uiLanguage" in out && typeof out.uiLanguage === "string") {
      setFrontendLanguage(out.uiLanguage);
    }
  } catch {
    // Keep the current interface language when settings cannot be loaded.
  }
}
