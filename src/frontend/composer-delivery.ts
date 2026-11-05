import type { PluginComposerApi, ComposerDraftSnapshot } from "@get-bb/plugin-sdk/app";
import { insertIntoDraftText } from "./composer-insert.ts";
import { manualImprovement, improvementScope } from "./manual-improvement.ts";

export type ComposerDestination = {
  composer: PluginComposerApi;
  key: string;
  selection: string;
  draft: string;
  route: string;
};

export const currentComposerRoute = () => window.location.pathname + (window.location.search ?? "") + (window.location.hash ?? "");
const draftSignature = (draft: ComposerDraftSnapshot) => JSON.stringify([draft.text, draft.mentions, draft.attachments]);

export function captureComposerDestination(target: { kind: string; threadId?: string }): ComposerDestination | null {
  const candidates = manualImprovement.getComposers().filter((composer) => target.kind === "thread"
    ? composer.scope.kind === "thread" && composer.scope.threadId === target.threadId
    : composer.scope.kind === "new-thread");
  if (candidates.length !== 1) return null;
  const composer = candidates[0]!;
  return { composer, key: composer.key, selection: JSON.stringify(composer.selection), draft: draftSignature(composer.draft), route: currentComposerRoute() };
}

/** Insert through the captured handle; submit only its unchanged, visible draft. */
export async function deliverToComposer(
  destination: ComposerDestination,
  text: string,
  rawText: string,
  options: { offset?: number | null; track: boolean; autoSend: boolean; isCurrent: () => boolean; canAutoSend?: () => boolean; timeoutMs?: number },
): Promise<boolean> {
  const { composer, key, selection, route } = destination;
  const current = () => options.isCurrent() && composer.key === key && JSON.stringify(composer.selection) === selection;
  if (!current()) return false;
  const before = composer.draft;
  const planned = insertIntoDraftText(before.text, text, options.offset ?? before.text.length);
  if (!planned.piece || before.mentions.some((item) => item.from < planned.offset && item.to > planned.offset)) return false;
  const expected = {
    text: planned.text,
    mentions: before.mentions.map((item) => item.from >= planned.offset
      ? { ...item, from: item.from + planned.piece.length, to: item.to + planned.piece.length } : item),
    attachments: before.attachments,
  };
  const initialSignature = draftSignature(before);
  const expectedSignature = draftSignature(expected);
  manualImprovement.clear(key);
  composer.replace((draft) => current() && draftSignature(draft) === initialSignature ? expected : draft);
  const deadline = Date.now() + (options.timeoutMs ?? 1500);
  while (current() && draftSignature(composer.draft) === initialSignature && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  if (!current() || draftSignature(composer.draft) !== expectedSignature) return false;
  if (options.track) {
    const from = planned.offset + (planned.piece.startsWith(" ") ? 1 : 0);
    manualImprovement.remember(improvementScope(composer.scope), planned.text, from, from + text.trim().length, rawText);
    manualImprovement.adopt(composer);
  }
  if (!options.autoSend || initialSignature !== destination.draft) return true;
  while (current() && options.canAutoSend?.() !== false && currentComposerRoute() === route && draftSignature(composer.draft) === expectedSignature) {
    if (!manualImprovement.getComposers().includes(composer)) return true;
    if (!composer.isSubmitting && !composer.isSubmittingBlocked) {
      await composer.submit();
      return true;
    }
    if (Date.now() >= deadline) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return true;
}
