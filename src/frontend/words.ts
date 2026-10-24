// Язык интерфейса для тостов и подписей записи. Скрипт страницы не знает настроек
// плагина, поэтому спрашивает язык у сервера один раз при монтировании; страница
// настроек обновляет его при смене (общий бандл, общее состояние модуля).
import { dictionary } from "../i18n/index.ts";

let language = "en";

export function setFrontendLanguage(next: string) {
  language = next;
}

export function words() {
  return dictionary(language);
}

export async function loadFrontendLanguage(): Promise<void> {
  try {
    const res = await fetch("/api/v1/plugins/voice-input/rpc/uiLanguage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "null",
    });
    const raw: unknown = await res.json();
    const out = raw && typeof raw === "object" && "result" in raw ? (raw as { result: unknown }).result : raw;
    if (out && typeof out === "object" && "uiLanguage" in out && typeof out.uiLanguage === "string") {
      language = out.uiLanguage;
    }
  } catch {
    // Без ответа остаётся английский.
  }
}
