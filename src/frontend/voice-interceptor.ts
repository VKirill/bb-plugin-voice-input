// Контент-скрипт перехвата кнопки микрофона и управления живой панелью записи в BB.
// 1. Перехватывает клик на микрофон, запуская глобальную сессию плагина.
// 2. Отображает аккуратную панель записи с живой анимацией звуковой волны в поле ввода.
// 3. Следует за пользователем при переходах между чатами без бесконечных циклов DOM и просадок FPS.

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
    const pathname = window.location.pathname;
    const projectThreadMatch = /\/projects\/([^/]+)\/threads\/([^/]+)/.exec(pathname);
    if (projectThreadMatch) {
      projectId = projectThreadMatch[1];
      threadId = projectThreadMatch[2];
    } else {
      const threadMatch = /\/threads\/([^/]+)/.exec(pathname);
      if (threadMatch) {
        threadId = threadMatch[1];
      }
    }

    if (!threadId && window.location.hash) {
      const hashMatch = /#(thr_[a-z0-9]+)/.exec(window.location.hash);
      if (hashMatch) {
        threadId = hashMatch[1];
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
  let badgeLabel: HTMLElement | null = null;
  let lastBadgeVisible: boolean | null = null;
  let lastBadgeTitle = "";
  let animationFrameId: number | null = null;
  let syncIntervalId: number | null = null;
  let floatingTimeoutId: number | null = null;
  let resizeObserver: ResizeObserver | null = null;

  let cssWidth = 0;
  let cssHeight = 0;
  let dpr = 1;
  let cachedCtx: CanvasRenderingContext2D | null = null;
  let frameCount = 0;
  const bars: number[] = [];

  const updateCanvasDimensions = () => {
    if (!canvasElement) return;
    dpr = window.devicePixelRatio || 1;
    const rect = canvasElement.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    if (w > 0 && h > 0 && (w !== cssWidth || h !== cssHeight)) {
      cssWidth = w;
      cssHeight = h;
      canvasElement.width = Math.round(w * dpr);
      canvasElement.height = Math.round(h * dpr);
      if (!cachedCtx) {
        cachedCtx = canvasElement.getContext("2d");
      }
      if (cachedCtx) {
        cachedCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
    }
  };

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
    canvasElement.style.cssText = `flex:1;height:100%;display:block;min-width:40px;-webkit-mask-image:linear-gradient(to right, transparent 0%, black 48px);mask-image:linear-gradient(to right, transparent 0%, black 48px);`;
    center.appendChild(canvasElement);

    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => {
        updateCanvasDimensions();
      });
      resizeObserver.observe(canvasElement);
    }

    timerElement = document.createElement("span");
    timerElement.style.cssText = `flex-shrink:0;font-family:monospace;font-size:12px;font-weight:600;color:var(--foreground,#27272a);`;
    center.appendChild(timerElement);

    const badge = document.createElement("button");
    badge.type = "button";
    badge.id = "bb-voice-badge";
    badge.style.cssText = `display:none;align-items:center;gap:5px;flex-shrink:0;max-width:220px;padding:3px 10px;border-radius:9999px;background:rgba(239,68,68,0.12);color:#ef4444;font-size:11px;font-weight:500;border:1px solid rgba(239,68,68,0.25);cursor:pointer;`;
    badge.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0;"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;
    
    badgeLabel = document.createElement("span");
    badgeLabel.style.cssText = `overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`;
    badge.appendChild(badgeLabel);

    badge.onclick = (e) => {
      e.stopPropagation();
      const snapshot = globalVoiceSession.getSnapshot();
      if (snapshot.target?.originPath) {
        window.history.pushState(null, "", snapshot.target.originPath);
        window.dispatchEvent(new PopStateEvent("popstate"));
      }
    };
    badgeElement = badge;
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

  const updateBadge = (visible: boolean, targetTitle: string) => {
    if (!badgeElement || !badgeLabel) return;
    if (visible !== lastBadgeVisible) {
      badgeElement.style.display = visible ? "flex" : "none";
      lastBadgeVisible = visible;
    }
    if (visible && targetTitle !== lastBadgeTitle) {
      badgeLabel.textContent = `В чат: «${targetTitle}»`;
      badgeElement.title = `Запись идёт для чата «${targetTitle}». Нажмите, чтобы вернуться в него.`;
      lastBadgeTitle = targetTitle;
    }
  };

  // Проверка и синхронизация позиции бара без вызова бесконечных циклов и reflow
  const syncBarPosition = () => {
    const snapshot = globalVoiceSession.getSnapshot();
    if (snapshot.state === "idle") {
      if (barElement) {
        barElement.remove();
        barElement = null;
        canvasElement = null;
        cachedCtx = null;
        timerElement = null;
        badgeElement = null;
        badgeLabel = null;
        lastBadgeVisible = null;
        lastBadgeTitle = "";
      }
      if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
      }
      if (syncIntervalId !== null) {
        clearInterval(syncIntervalId);
        syncIntervalId = null;
      }
      if (floatingTimeoutId !== null) {
        clearTimeout(floatingTimeoutId);
        floatingTimeoutId = null;
      }
      if (resizeObserver) {
        resizeObserver.disconnect();
        resizeObserver = null;
      }
      return;
    }

    if (!barElement) {
      barElement = createBarElement();
      startCanvasWaveform();
    }

    const actionRow = document.querySelector<HTMLElement>("[data-promptbox-action-row]");
    const currentPath = window.location.pathname + window.location.hash;
    const isCurrentThread =
      snapshot.target?.kind === "thread" && snapshot.target.threadId
        ? currentPath.includes(snapshot.target.threadId)
        : !currentPath.includes("/threads/") && !currentPath.includes("#thr_");
    const targetTitle = snapshot.target?.threadTitle || "Чат";
    const isTranscribing = snapshot.state === "transcribing";

    // Обновляем таймер при необходимости
    if (timerElement) {
      const nextText = isTranscribing ? "Распознавание..." : formatDuration(globalVoiceSession.getDurationMs());
      if (timerElement.textContent !== nextText) {
        timerElement.textContent = nextText;
      }
    }

    // Обновляем бейдж возврата без layout thrashing
    updateBadge(!isCurrentThread, targetTitle);

    // Размещение
    if (actionRow) {
      if (floatingTimeoutId !== null) {
        clearTimeout(floatingTimeoutId);
        floatingTimeoutId = null;
      }
      if (barElement.parentElement !== actionRow) {
        barElement.style.cssText = `position:absolute;top:0;left:0;right:0;bottom:0;z-index:1000;background:var(--card,#ffffff);color:var(--card-foreground,#09090b);border-radius:inherit;display:flex;align-items:center;justify-content:space-between;padding:0 12px;gap:10px;box-shadow:inset 0 0 0 1px rgba(239,68,68,0.45);`;
        actionRow.appendChild(barElement);
        updateCanvasDimensions();
      }
    } else {
      // При смене треда React может кратковременно перемонтировать actionRow.
      // Не прыгаем сразу в document.body, чтобы избежать мерцания и ресайза канваса.
      if (barElement.parentElement !== document.body && floatingTimeoutId === null) {
        floatingTimeoutId = window.setTimeout(() => {
          floatingTimeoutId = null;
          if (globalVoiceSession.getSnapshot().state === "idle") return;
          const freshActionRow = document.querySelector<HTMLElement>("[data-promptbox-action-row]");
          if (freshActionRow && barElement) {
            if (barElement.parentElement !== freshActionRow) {
              barElement.style.cssText = `position:absolute;top:0;left:0;right:0;bottom:0;z-index:1000;background:var(--card,#ffffff);color:var(--card-foreground,#09090b);border-radius:inherit;display:flex;align-items:center;justify-content:space-between;padding:0 12px;gap:10px;box-shadow:inset 0 0 0 1px rgba(239,68,68,0.45);`;
              freshActionRow.appendChild(barElement);
              updateCanvasDimensions();
            }
          } else if (barElement && barElement.parentElement !== document.body) {
            barElement.style.cssText = `position:fixed;bottom:24px;right:24px;z-index:99999;background:var(--card,#ffffff);color:var(--card-foreground,#09090b);border-radius:9999px;display:flex;align-items:center;justify-content:space-between;padding:4px 14px;gap:10px;box-shadow:0 10px 25px -5px rgba(0,0,0,0.3);border:1px solid rgba(239,68,68,0.4);min-width:260px;`;
            document.body.appendChild(barElement);
            updateCanvasDimensions();
          }
        }, 180);
      }
    }
  };

  // Анимация волны на Canvas с нулевым forced reflow
  const startCanvasWaveform = () => {
    if (animationFrameId !== null) return;

    const tick = () => {
      const snapshot = globalVoiceSession.getSnapshot();
      if (snapshot.state === "idle") {
        animationFrameId = null;
        return;
      }

      if (canvasElement && cssWidth > 0 && cssHeight > 0) {
        if (!cachedCtx) {
          cachedCtx = canvasElement.getContext("2d");
        }
        if (cachedCtx) {
          frameCount++;
          // Сэмплируем амплитуду каждые 2 кадра (30 FPS) для равномерного спокойного движения
          if (frameCount % 2 === 0) {
            const amp = snapshot.state === "recording" ? globalVoiceSession.getAudioAmplitude() : 0.05;
            bars.push(amp);
            if (bars.length > 500) {
              bars.shift();
            }
          }

          cachedCtx.clearRect(0, 0, cssWidth, cssHeight);

          const barCount = Math.max(1, Math.floor(cssWidth / BAR_PITCH));
          const midY = cssHeight / 2;
          const maxHalf = Math.max(0, (cssHeight * 0.85 - BAR_WIDTH) / 2);

          cachedCtx.lineCap = "round";
          cachedCtx.lineWidth = BAR_WIDTH;
          cachedCtx.strokeStyle = "#ef4444";
          cachedCtx.beginPath();

          const visibleCount = Math.min(bars.length, barCount);
          for (let i = 0; i < visibleCount; i++) {
            const barAmp = bars[bars.length - 1 - i] ?? 0;
            const cx = cssWidth - BAR_WIDTH / 2 - i * BAR_PITCH;
            if (cx + BAR_WIDTH < 0) break;
            const half = barAmp * maxHalf;
            cachedCtx.moveTo(cx, midY - half);
            cachedCtx.lineTo(cx, midY + half);
          }
          cachedCtx.stroke();
        }
      }

      // Обновление таймера раз в кадр (меняет DOM только раз в секунду)
      if (timerElement && snapshot.state === "recording") {
        const t = formatDuration(globalVoiceSession.getDurationMs());
        if (timerElement.textContent !== t) {
          timerElement.textContent = t;
        }
      }

      animationFrameId = requestAnimationFrame(tick);
    };

    animationFrameId = requestAnimationFrame(tick);
  };

  let lastSessionState: string = "idle";
  let lastTargetId: string = "";

  const onSessionChange = () => {
    const snapshot = globalVoiceSession.getSnapshot();
    const targetId = `${snapshot.target?.kind}:${snapshot.target?.threadId ?? ""}:${snapshot.target?.threadTitle ?? ""}`;

    // Запускаем пересчёт DOM только при смене статуса сессии или целевого чата
    if (snapshot.state !== lastSessionState || targetId !== lastTargetId) {
      lastSessionState = snapshot.state;
      lastTargetId = targetId;

      if (snapshot.state !== "idle") {
        if (syncIntervalId === null) {
          syncIntervalId = window.setInterval(syncBarPosition, 600);
        }
      } else {
        if (syncIntervalId !== null) {
          clearInterval(syncIntervalId);
          syncIntervalId = null;
        }
      }
      syncBarPosition();
    }
  };

  const onNavigation = () => {
    syncBarPosition();
  };

  const onVisibilityChange = () => {
    if (document.visibilityState === "visible") {
      globalVoiceSession.resumeAudioContext();
      syncBarPosition();
      updateCanvasDimensions();
    }
  };

  window.addEventListener("popstate", onNavigation, { signal });
  window.addEventListener("hashchange", onNavigation, { signal });
  document.addEventListener("visibilitychange", onVisibilityChange, { signal });

  const origPushState = typeof window !== "undefined" ? window.history.pushState : null;
  const origReplaceState = typeof window !== "undefined" ? window.history.replaceState : null;

  if (origPushState && origReplaceState) {
    window.history.pushState = function (...args) {
      const res = origPushState.apply(this, args);
      onNavigation();
      return res;
    };
    window.history.replaceState = function (...args) {
      const res = origReplaceState.apply(this, args);
      onNavigation();
      return res;
    };
  }

  const unsubscribeSession = globalVoiceSession.subscribe(onSessionChange);

  return () => {
    window.removeEventListener("pointerdown", handleMicTrigger, { capture: true });
    window.removeEventListener("click", handleMicTrigger, { capture: true });
    window.removeEventListener("keydown", onKeyDown, { capture: true });

    document.removeEventListener("pointerdown", handleMicTrigger, { capture: true });
    document.removeEventListener("click", handleMicTrigger, { capture: true });

    window.removeEventListener("popstate", onNavigation);
    window.removeEventListener("hashchange", onNavigation);
    document.removeEventListener("visibilitychange", onVisibilityChange);

    if (origPushState && typeof window !== "undefined") {
      window.history.pushState = origPushState;
    }
    if (origReplaceState && typeof window !== "undefined") {
      window.history.replaceState = origReplaceState;
    }

    unsubscribeSession();
    if (barElement) {
      barElement.remove();
      barElement = null;
      cachedCtx = null;
    }
    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
    }
    if (animationFrameId !== null) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
    if (syncIntervalId !== null) {
      clearInterval(syncIntervalId);
      syncIntervalId = null;
    }
    if (floatingTimeoutId !== null) {
      clearTimeout(floatingTimeoutId);
      floatingTimeoutId = null;
    }
  };
}
