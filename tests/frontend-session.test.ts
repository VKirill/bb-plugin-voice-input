import assert from "node:assert/strict";
import { test } from "node:test";
import { GlobalVoiceSession } from "../src/frontend/global-voice-session.ts";
import { findVoiceButton } from "../src/frontend/voice-interceptor.ts";

test("начальное состояние глобальной сессии — idle", () => {
  const session = new GlobalVoiceSession();
  const snapshot = session.getSnapshot();
  assert.equal(snapshot.state, "idle");
  assert.equal(snapshot.durationMs, 0);
  assert.equal(snapshot.target, null);
  assert.equal(snapshot.error, null);
  assert.deepEqual(snapshot.levels, [0, 0, 0, 0, 0]);
});

test("подписка на изменения вызывается при обновлении заголовка", () => {
  const session = new GlobalVoiceSession();
  let calls = 0;
  const unsubscribe = session.subscribe(() => {
    calls++;
  });

  // В idle без цели updateTargetTitle не уведомляет
  session.updateTargetTitle("Новый заголовок");
  assert.equal(calls, 0);

  unsubscribe();
});

test("отмена сбрасывает сессию в idle", () => {
  const session = new GlobalVoiceSession();
  session.cancelRecording();
  const snapshot = session.getSnapshot();
  assert.equal(snapshot.state, "idle");
  assert.equal(snapshot.target, null);
});

test("findVoiceButton распознаёт кнопки микрофона внутри promptbox и отсекает посторонние", () => {
  class MockElement {
    nodeType = 1;
    attributes: Record<string, string> = {};
    parentElement: MockElement | null = null;
    children: MockElement[] = [];
    tagName: string;

    constructor(tagName: string) {
      this.tagName = tagName.toUpperCase();
    }

    getAttribute(name: string) {
      return this.attributes[name] ?? null;
    }

    setAttribute(name: string, val: string) {
      this.attributes[name] = val;
    }

    hasAttribute(name: string) {
      return name in this.attributes;
    }

    closest(selector: string): MockElement | null {
      const match = (el: MockElement) => {
        if (selector.startsWith("[") && selector.endsWith("]")) {
          const attr = selector.slice(1, -1);
          return el.hasAttribute(attr);
        }
        return el.tagName === selector.toUpperCase();
      };
      let cur: MockElement | null = this;
      while (cur) {
        if (match(cur)) return cur;
        cur = cur.parentElement;
      }
      return null;
    }

    querySelector(selector: string): MockElement | null {
      if (selector === "svg") {
        return this.children.find((c) => c.tagName === "SVG") ?? null;
      }
      return null;
    }

    querySelectorAll(selector: string): MockElement[] {
      if (selector === "path") {
        return this.children.filter((c) => c.tagName === "PATH");
      }
      return [];
    }
  }

  const promptBox = new MockElement("form");
  promptBox.setAttribute("data-promptbox", "");

  // Английская кнопка микрофона внутри promptbox
  const enButton = new MockElement("button");
  enButton.setAttribute("aria-label", "Start voice input");
  enButton.parentElement = promptBox;
  assert.equal(findVoiceButton(enButton as unknown as EventTarget), enButton as unknown as HTMLElement);

  // Русская кнопка микрофона внутри promptbox
  const ruButton = new MockElement("button");
  ruButton.setAttribute("aria-label", "Начать голосовой ввод");
  ruButton.parentElement = promptBox;
  assert.equal(findVoiceButton(ruButton as unknown as EventTarget), ruButton as unknown as HTMLElement);

  // Кнопка с SVG иконкой микрофона (Hugeicons) без aria-label
  const iconButton = new MockElement("button");
  iconButton.parentElement = promptBox;
  const svg = new MockElement("svg");
  const path = new MockElement("path");
  path.setAttribute("d", "M12 18V22M12 18H11.5208C8.11765 18 5.28262 15.3914 5 12");
  svg.children.push(path);
  iconButton.children.push(svg);
  assert.equal(findVoiceButton(iconButton as unknown as EventTarget), iconButton as unknown as HTMLElement);

  // Обычная кнопка отправки внутри promptbox (не должна совпадать)
  const submitButton = new MockElement("button");
  submitButton.setAttribute("aria-label", "Отправить сообщение");
  submitButton.parentElement = promptBox;
  assert.equal(findVoiceButton(submitButton as unknown as EventTarget), null);

  // ВАЖНО: Тред в сайдбаре со словом «Аудио прерывается...» ВНЕ promptbox (НЕ ДОЛЖЕН совпадать!)
  const sidebarThreadButton = new MockElement("button");
  sidebarThreadButton.setAttribute("aria-label", "Open thread: Аудио прерывается при смене вкладки");
  assert.equal(findVoiceButton(sidebarThreadButton as unknown as EventTarget), null);
});
