// Вставка расшифровки в поле композера BB в позицию каретки.
// Черновик и живой редактор должны получать один и тот же кусок текста.

export const COMPOSER_EDITOR_SELECTOR =
  '[data-promptbox] .tiptap.ProseMirror, [data-promptbox] textarea, [data-promptbox] [contenteditable="true"]';

let rememberedCaret: number | null = null;

export function rememberComposerCaret(offset: number | null): void {
  if (offset === null || offset < 0) return;
  rememberedCaret = offset;
}

export function resetRememberedComposerCaret(): void {
  rememberedCaret = null;
}

export function getRememberedComposerCaret(): number | null {
  return rememberedCaret;
}

export function insertIntoDraftText(
  existing: string,
  transcript: string,
  offset: number,
): { text: string; piece: string; offset: number } {
  const insert = transcript.trim();
  const clamped = Math.max(0, Math.min(offset, existing.length));
  if (!insert) {
    return { text: existing, piece: "", offset: clamped };
  }

  const before = existing.slice(0, clamped);
  const after = existing.slice(clamped);
  let piece = insert;
  if (before && !/\s$/.test(before) && !/^\s/.test(piece)) {
    piece = ` ${piece}`;
  }
  if (after && !/^\s/.test(after) && !/\s$/.test(piece)) {
    piece = `${piece} `;
  }

  return { text: before + piece + after, piece, offset: clamped };
}

function isTextField(editor: HTMLElement): editor is HTMLTextAreaElement | HTMLInputElement {
  return editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement;
}

export function findComposerEditor(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  return document.querySelector<HTMLElement>(COMPOSER_EDITOR_SELECTOR);
}

export function getComposerPlainText(editor: HTMLElement): string {
  if (isTextField(editor)) {
    return editor.value;
  }
  const range = document.createRange();
  range.selectNodeContents(editor);
  return range.toString();
}

export function getComposerCaretOffset(editor: HTMLElement): number | null {
  if (isTextField(editor)) {
    if (typeof editor.selectionStart === "number") {
      return editor.selectionStart;
    }
    return null;
  }
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!editor.contains(range.startContainer)) return null;
  const pre = range.cloneRange();
  pre.selectNodeContents(editor);
  pre.setEnd(range.startContainer, range.startOffset);
  return pre.toString().length;
}

export function rememberComposerCaretFromDocument(): void {
  const editor = findComposerEditor();
  if (!editor) return;
  const offset = getComposerCaretOffset(editor);
  rememberComposerCaret(offset);
}

export function resolveComposerInsertOffset(existingLength: number): number {
  const editor = findComposerEditor();
  const live = editor ? getComposerCaretOffset(editor) : null;
  if (live !== null) return Math.max(0, Math.min(live, existingLength));
  if (rememberedCaret !== null) return Math.max(0, Math.min(rememberedCaret, existingLength));
  return existingLength;
}

export function setComposerCaretOffset(editor: HTMLElement, offset: number): void {
  const clamped = Math.max(0, offset);
  if (isTextField(editor)) {
    editor.focus();
    const pos = Math.min(clamped, editor.value.length);
    editor.setSelectionRange(pos, pos);
    return;
  }

  editor.focus();
  const sel = window.getSelection();
  if (!sel) return;

  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
  let remaining = clamped;
  let lastText: Text | null = null;
  let node: Node | null = walker.nextNode();
  while (node) {
    lastText = node as Text;
    const len = lastText.length;
    if (remaining <= len) {
      const range = document.createRange();
      range.setStart(lastText, remaining);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
      return;
    }
    remaining -= len;
    node = walker.nextNode();
  }

  const range = document.createRange();
  if (lastText) {
    range.setStart(lastText, lastText.length);
    range.collapse(true);
  } else {
    range.selectNodeContents(editor);
    range.collapse(true);
  }
  sel.removeAllRanges();
  sel.addRange(range);
}

export function insertTranscriptAtCaret(editor: HTMLElement, transcript: string, offset: number): {
  text: string;
  piece: string;
} {
  const existing = getComposerPlainText(editor);
  const planned = insertIntoDraftText(existing, transcript, offset);
  if (!planned.piece) {
    return { text: existing, piece: "" };
  }

  setComposerCaretOffset(editor, planned.offset);
  try {
    document.execCommand("insertText", false, planned.piece);
  } catch {}

  rememberComposerCaret(planned.offset + planned.piece.length);
  return { text: planned.text, piece: planned.piece };
}
