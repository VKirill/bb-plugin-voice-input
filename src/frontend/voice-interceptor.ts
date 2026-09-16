// Контент-скрипт перехвата кнопки микрофона и управления живой панелью записи в BB.
// 1. Перехватывает клик на микрофон, запуская глобальную сессию плагина.
// 2. Отображает аккуратную панель записи с живой анимацией звуковой волны в поле ввода.
// 3. Следует за пользователем при переходах между чатами без бесконечных циклов DOM.

import { globalVoiceSession, type VoiceTarget } from "./global-voice-session.ts";

export function findVoiceButton(target: EventTarget | null): HTMLElement | null {
  if (!target) return null;
  const isNode = typeof Node !== "undefined" ? target instanceof Node : true;
  if (!isNode) return null;
  const element =
    typeof Element !== "undefined" && !(target instanceof Element)
      ? (target as { parentElement?: HTMLElement | null }).parentElement
      : (target as HTMLElement);
  if (!element || typeof element.closest !== "function") return null;

  const button = element.closest("button");
  if (!button) return null;

  // Кнопка микрофона ОБЯЗАНА находиться внутри поля ввода (PromptBox)!
  // Это исключает ложные срабатывания на треды в сайдбаре, ссылки, сообщения агента и т.д.
  const inPromptBox =
    button.closest("[data-promptbox]") !== null ||
    button.closest("[data-promptbox-action-row]") !== null ||
    button.closest("form[data-promptbox]") !== null ||
    button.hasAttribute("data-promptbox-voice-trigger") ||
    button.hasAttribute("data-voice-recording");
  if (!inPromptBox) return null;

  // 1. Проверка aria-label и title на голосовые ключевые слова
  const aria = (button.getAttribute("aria-label") || "").trim().toLowerCase();
  const title = (button.getAttribute("title") || "").trim().toLowerCase();
  const hasVoiceLabel =
    aria.includes("голос") ||
    aria.includes("voice") ||
    aria.includes("микрофон") ||
    aria.includes("mic") ||
    title.includes("голос") ||
    title.includes("voice") ||
    title.includes("микрофон") ||
    title.includes("mic");

  // 2. Проверка data-атрибутов
  const hasVoiceAttr =
    button.hasAttribute("data-promptbox-voice-trigger") ||
    button.hasAttribute("data-promptbox-voice-action") ||
    button.hasAttribute("data-voice-recording");

  // 3. Проверка SVG иконки микрофона (Hugeicons Mic02Icon в BB)
  let hasMicSvg = false;
  const svg = button.querySelector("svg");
  if (svg) {
    const paths = svg.querySelectorAll("path");
    for (let i = 0; i < paths.length; i++) {
      const d = paths[i]?.getAttribute("d") || "";
      if (
        d.includes("12 18V22") ||
        d.includes("8 6C8 3.79086") ||
        d.includes("12 18H11.5208") ||
        d.includes("16 11V6Z")
      ) {
        hasMicSvg = true;
        break;
      }
    }
  }

  if (hasVoiceLabel || hasVoiceAttr || hasMicSvg) {
    return button;
  }

  return null;
}

export function resolveCurrentVoiceTarget(): VoiceTarget {
  let promptContext: string | undefined;
  try {
    const editor = document.querySelector('.tiptap.ProseMirror, textarea, [contenteditable="true"]');
    if (editor?.textContent) {
      promptContext = editor.textContent.slice(0, 500);
    }
  } catch {}

  const originPath = typeof window !== "undefined" ? window.location.pathname + window.location.search : "/";

  let projectId: string | undefined;
  let threadId: string | undefined;

  if (typeof window !== "undefined") {
    const projectThreadMatch = /\/projects\/([^/]+)\/threads\/([^/]+)/.exec(window.location.pathname);
    if (projectThreadMatch) {
      projectId = projectThreadMatch[1];
      threadId = projectThreadMatch[2];
    } else {
      const threadMatch = /\/threads\/([^/]+)/.exec(window.location.pathname);
      if (threadMatch) {
        threadId = threadMatch[1];
      }
    }
  }

  let threadTitle = "Чат";
  try {
    const headerTitle = document.querySelector("header h1, [data-thread-title]")?.textContent?.trim();
    if (headerTitle) {
      threadTitle = headerTitle;
    } else if (document.title && !document.title.startsWith("bb")) {
      threadTitle = document.title.split("·")[0]?.trim() || "Чат";
    }
  } catch {}

  return threadId
    ? { kind: "thread", threadId, projectId, originPath, threadTitle, promptContext }
    : { kind: "new-thread", originPath, threadTitle: "Новый чат", promptContext };
}

export function toggleVoiceRecording() {
  const snapshot = globalVoiceSession.getSnapshot();
  if (snapshot.state === "recording") {
    void globalVoiceSession.stopAndTranscribe();
  } else if (snapshot.state === "idle") {
    const target = resolveCurrentVoiceTarget();
    void globalVoiceSession.startRecording(target);
  }
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

const BAR_WIDTH = 3;
const BAR_GAP = 2;
const BAR_PITCH = BAR_WIDTH + BAR_GAP;

export function mountVoiceInputInterceptor({ signal }: { signal?: AbortSignal } = {}) {
  let lastTriggerTime = 0;
  let barElement: HTMLElement | null = null;
  let canvasElement: HTMLCanvasElement | null = null;
  let timerElement: HTMLElement | null = null;
  let badgeElement: HTMLButtonElement | null = null;
  let animationFrameId: number | null = null;
  let syncIntervalId: number | null = null;
  const bars: number[] = [];

  // Единый перехватчик событий клика/нажатия на микрофон
  const handleMicTrigger = (event: Event) => {
    const micButton = findVoiceButton(event.target);
    if (!micButton) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    const now = Date.now();
    if (now - lastTriggerTime < 350) return;
    lastTriggerTime = now;

    toggleVoiceRecording();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.target && findVoiceButton(event.target)) {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        toggleVoiceRecording();
        return;
      }
    }

    if ((event.altKey && event.code === "KeyV") || (event.ctrlKey && event.shiftKey && event.code === "KeyV")) {
      event.preventDefault();
      toggleVoiceRecording();
    }
  };

  window.addEventListener("pointerdown", handleMicTrigger, { capture: true, signal });
  window.addEventListener("click", handleMicTrigger, { capture: true, signal });
  window.addEventListener("keydown", onKeyDown, { capture: true, signal });

  document.addEventListener("pointerdown", handleMicTrigger, { capture: true, signal });
  document.addEventListener("click", handleMicTrigger, { capture: true, signal });

  // Создание DOM-элементов панели один раз
  const createBarElement = () => {
    const bar = document.createElement("div");
    bar.id = "bb-voice-active-bar";

    // Кнопка отмены [ X ]
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.title = "Отменить запись";
    cancelBtn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>`;
    cancelBtn.style.cssText = `display:flex;width:28px;height:28px;align-items:center;justify-content:center;border-radius:9999px;border:none;background:transparent;cursor:pointer;color:var(--muted-foreground,#71717a);flex-shrink:0;`;
    cancelBtn.onclick = (e) => {
      e.stopPropagation();
      globalVoiceSession.cancelRecording();
    };
    bar.appendChild(cancelBtn);

    // Центр: волна + таймер + бейдж
    const center = document.createElement("div");
    center.id = "bb-voice-center-wrap";
    center.style.cssText = `position:relative;display:flex;min-width:0;flex:1;align-items:center;height:28px;gap:8px;`;

    canvasElement = document.createElement("canvas");
    canvasElement.style.cssText = `flex:1;height:100%;display:block;min-width:40px;`;
    center.appendChild(canvasElement);

    timerElement = document.createElement("span");
    timerElement.style.cssText = `flex-shrink:0;font-family:monospace;font-size:12px;font-weight:600;color:var(--foreground,#27272a);`;
    center.appendChild(timerElement);

    badgeElement = document.createElement("button");
    badgeElement.type = "button";
    badgeElement.style.cssText = `display:none;align-items:center;gap:5px;flex-shrink:0;max-width:200px;padding:3px 10px;border-radius:9999px;background:rgba(239,68,68,0.12);color:#ef4444;font-size:11px;font-weight:500;border:1px solid rgba(239,68,68,0.25);cursor:pointer;`;
    badgeElement.onclick = (e) => {
      e.stopPropagation();
      const snapshot = globalVoiceSession.getSnapshot();
      if (snapshot.target?.originPath) {
        window.history.pushState(null, "", snapshot.target.originPath);
        window.dispatchEvent(new PopStateEvent("popstate"));
      }
    };
    center.appendChild(badgeElement);

    bar.appendChild(center);

    // Кнопка подтверждения [ ✓ ]
    const confirmBtn = document.createElement("button");
    confirmBtn.id = "bb-voice-confirm-btn";
    confirmBtn.type = "button";
    confirmBtn.title = "Завершить запись и распознать";
    confirmBtn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M20 6L9 17l-5-5"/></svg>`;
    confirmBtn.style.cssText = `display:flex;width:28px;height:28px;align-items:center;justify-content:center;border-radius:9999px;border:none;background:#ef4444;color:#ffffff;cursor:pointer;flex-shrink:0;box-shadow:0 1px 3px rgba(0,0,0,0.3);`;
    confirmBtn.onclick = (e) => {
      e.stopPropagation();
      void globalVoiceSession.stopAndTranscribe();
    };
    bar.appendChild(confirmBtn);

    return bar;
  };

  // Проверка и синхронизация позиции бара без вызова бесконечных циклов
  const syncBarPosition = () => {
    const snapshot = globalVoiceSession.getSnapshot();
    if (snapshot.state === "idle") {
      if (barElement) {
        barElement.remove();
        barElement = null;
        canvasElement = null;
        timerElement = null;
        badgeElement = null;
      }
      if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
      }
      if (syncIntervalId !== null) {
        clearInterval(syncIntervalId);
        syncIntervalId = null;
      }
      return;
    }

    if (!barElement) {
      barElement = createBarElement();
      startCanvasWaveform();
    }

    const actionRow = document.querySelector<HTMLElement>("[data-promptbox-action-row]");
    const currentPath = window.location.pathname;
    const isCurrentThread =
      snapshot.target?.kind === "thread" && snapshot.target.threadId
        ? currentPath.includes(snapshot.target.threadId)
        : !currentPath.includes("/threads/");
    const targetTitle = snapshot.target?.threadTitle || "Чат";
    const isTranscribing = snapshot.state === "transcribing";

    // Обновляем таймер
    if (timerElement) {
      const nextText = isTranscribing ? "Распознавание..." : formatDuration(snapshot.durationMs);
      if (timerElement.textContent !== nextText) {
        timerElement.textContent = nextText;
      }
    }

    // Обновляем бейдж возврата
    if (badgeElement) {
      if (!isCurrentThread) {
        if (badgeElement.style.display !== "flex") {
          badgeElement.style.display = "flex";
        }
        badgeElement.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0;"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">В чат: «${targetTitle}»</span>`;
        badgeElement.title = `Запись идёт для чата «${targetTitle}». Нажмите, чтобы вернуться в него.`;
      } else {
        if (badgeElement.style.display !== "none") {
          badgeElement.style.display = "none";
        }
      }
    }

    // Размещение
    if (actionRow) {
      if (barElement.parentElement !== actionRow) {
        barElement.style.cssText = `position:absolute;top:0;left:0;right:0;bottom:0;z-index:1000;background:var(--card,#ffffff);color:var(--card-foreground,#09090b);border-radius:inherit;display:flex;align-items:center;justify-content:space-between;padding:0 12px;gap:10px;box-shadow:inset 0 0 0 1px rgba(239,68,68,0.45);`;
        actionRow.appendChild(barElement);
      }
    } else {
      if (barElement.parentElement !== document.body) {
        barElement.style.cssText = `position:fixed;bottom:24px;right:24px;z-index:99999;background:var(--card,#ffffff);color:var(--card-foreground,#09090b);border-radius:9999px;display:flex;align-items:center;justify-content:space-between;padding:4px 14px;gap:10px;box-shadow:0 10px 25px -5px rgba(0,0,0,0.3);border:1px solid rgba(239,68,68,0.4);min-width:260px;`;
        document.body.appendChild(barElement);
      }
    }
  };

  // Анимация волны на Canvas
  const startCanvasWaveform = () => {
    if (animationFrameId !== null) return;

    const tick = () => {
      const snapshot = globalVoiceSession.getSnapshot();
      if (snapshot.state === "idle") {
        animationFrameId = null;
        return;
      }

      if (canvasElement) {
        const ctx = canvasElement.getContext("2d");
        const rect = canvasElement.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const w = rect.width;
        const h = rect.height;

        if (w > 0 && h > 0 && ctx) {
          if (canvasElement.width !== Math.round(w * dpr) || canvasElement.height !== Math.round(h * dpr)) {
            canvasElement.width = Math.round(w * dpr);
            canvasElement.height = Math.round(h * dpr);
          }
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.clearRect(0, 0, w, h);

          const barCount = Math.max(1, Math.floor(w / BAR_PITCH));
          const amp = snapshot.state === "recording" ? globalVoiceSession.getAudioAmplitude() : 0.05;
          bars.push(amp);
          if (bars.length > barCount) bars.shift();

          const midY = h / 2;
          const maxHalf = Math.max(0, (h * 0.85 - BAR_WIDTH) / 2);
          const edgeFade = w * 0.15;

          ctx.lineCap = "round";
          ctx.lineWidth = BAR_WIDTH;
          ctx.strokeStyle = "#ef4444";

          for (let i = 0; i < bars.length; i++) {
            const barAmp = bars[bars.length - 1 - i] ?? 0;
            const cx = w - BAR_WIDTH / 2 - i * BAR_PITCH;
            if (cx + BAR_WIDTH < 0) break;
            const half = barAmp * maxHalf;
            ctx.globalAlpha = cx < edgeFade ? Math.max(0.2, cx / edgeFade) : 1;
            ctx.beginPath();
            ctx.moveTo(cx, midY - half);
            ctx.lineTo(cx, midY + half);
            ctx.stroke();
          }
          ctx.globalAlpha = 1;
        }
      }

      // Обновление таймера раз в кадр
      if (timerElement && snapshot.state === "recording") {
        const t = formatDuration(snapshot.durationMs);
        if (timerElement.textContent !== t) {
          timerElement.textContent = t;
        }
      }

      animationFrameId = requestAnimationFrame(tick);
    };

    animationFrameId = requestAnimationFrame(tick);
  };

  const onSessionChange = () => {
    const snapshot = globalVoiceSession.getSnapshot();
    if (snapshot.state !== "idle" && syncIntervalId === null) {
      syncIntervalId = window.setInterval(syncBarPosition, 200);
    }
    syncBarPosition();
  };

  const unsubscribeSession = globalVoiceSession.subscribe(onSessionChange);

  return () => {
    window.removeEventListener("pointerdown", handleMicTrigger, { capture: true });
    window.removeEventListener("click", handleMicTrigger, { capture: true });
    window.removeEventListener("keydown", onKeyDown, { capture: true });

    document.removeEventListener("pointerdown", handleMicTrigger, { capture: true });
    document.removeEventListener("click", handleMicTrigger, { capture: true });

    unsubscribeSession();
    if (barElement) {
      barElement.remove();
      barElement = null;
    }
    if (animationFrameId !== null) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
    if (syncIntervalId !== null) {
      clearInterval(syncIntervalId);
      syncIntervalId = null;
    }
  };
}
