import type { EditingComposer } from "./manual-improvement.ts";
import { manualImprovement } from "./manual-improvement.ts";
import { nativeTranscriptReceipt, type NativeTranscriptReceipt } from "../native-transcript.ts";

type DraftChange = { before: string; after: string; at: number };
type ObservedDraft = { text: string; changes: DraftChange[]; epoch: number };
const MATCH_WINDOW_MS = 15_000;

/** Read-only bridge: bb alone records, transcribes and inserts. No click interception. */
export class NativeDictationTracker {
  private drafts = new Map<string, ObservedDraft>();
  private receipts = new Map<string, { receipt: NativeTranscriptReceipt; at: number }>();
  private matching = new Set<string>();
  private seen = new Set<string>();
  private generation = 0;
  private remember: (composer: EditingComposer, from: number, to: number) => void;
  constructor(remember: (composer: EditingComposer, from: number, to: number) => void) { this.remember = remember; }

  observe(composer: EditingComposer) {
    const text = composer.draft.text;
    let draft = this.drafts.get(composer.key);
    if (!draft) {
      draft = { text, changes: [], epoch: 0 };
      this.drafts.set(composer.key, draft);
    } else if (draft.text !== text) {
      if (!text.trim()) { draft.changes = []; draft.epoch += 1; }
      else draft.changes.push({ before: draft.text, after: text, at: Date.now() });
      draft.text = text;
      draft.changes = draft.changes.filter((change) => Date.now() - change.at < MATCH_WINDOW_MS).slice(-4);
    }
    for (const { receipt, at } of this.receipts.values()) {
      if (Date.now() - at < MATCH_WINDOW_MS) void this.match(composer, draft, receipt);
      else this.receipts.delete(receipt.id);
    }
  }

  receive(value: unknown, composers: readonly EditingComposer[]) {
    if (!value || typeof value !== "object") return;
    const receipt = value as NativeTranscriptReceipt;
    if (typeof receipt.id !== "string" || !/^[a-f0-9]{64}$/u.test(receipt.hash)
      || !Number.isInteger(receipt.length) || receipt.length <= 0 || receipt.length > 50000) return;
    if (this.seen.has(receipt.id)) return;
    this.seen.add(receipt.id);
    while (this.seen.size > 64) this.seen.delete(this.seen.values().next().value!);
    this.receipts.set(receipt.id, { receipt, at: Date.now() });
    while (this.receipts.size > 16) this.receipts.delete(this.receipts.keys().next().value!);
    for (const composer of composers) this.observe(composer);
  }

  private async match(composer: EditingComposer, draft: ObservedDraft, receipt: NativeTranscriptReceipt) {
    const key = `${composer.key}:${receipt.id}`;
    if (this.matching.has(key)) return;
    this.matching.add(key);
    const generation = this.generation;
    const epoch = draft.epoch;
    try {
      for (const change of [...draft.changes].reverse()) {
        if (change.after !== composer.draft.text || Date.now() - change.at >= MATCH_WINDOW_MS) continue;
        let prefix = 0;
        while (prefix < change.before.length && prefix < change.after.length && change.before[prefix] === change.after[prefix]) prefix += 1;
        let suffix = 0;
        while (suffix < change.before.length - prefix && suffix < change.after.length - prefix
          && change.before[change.before.length - 1 - suffix] === change.after[change.after.length - 1 - suffix]) suffix += 1;
        const candidates = new Set([prefix, prefix + 1, change.after.length - suffix - receipt.length,
          change.after.length - suffix - receipt.length - 1]);
        for (const from of candidates) {
          const to = from + receipt.length;
          if (from < 0 || to > change.after.length) continue;
          const text = change.after.slice(from, to);
          if (text.trim() !== text) continue;
          // The candidate must be the inserted/replaced part, not an old
          // occurrence elsewhere that happens to have the same digest.
          const beforeCandidate = change.after.slice(0, from).trimEnd();
          const afterCandidate = change.after.slice(to).trimStart();
          if (!change.before.startsWith(beforeCandidate) || !change.before.endsWith(afterCandidate)
            || beforeCandidate.length + afterCandidate.length > change.before.length) continue;
          const actual = await nativeTranscriptReceipt(receipt.id, text);
          if (actual.hash !== receipt.hash) continue;
          if (generation !== this.generation || epoch !== draft.epoch || composer.draft.text !== change.after
            || !this.receipts.has(receipt.id)) return;
          this.receipts.delete(receipt.id);
          draft.changes = [];
          this.remember(composer, from, to);
          return;
        }
      }
    } finally { this.matching.delete(key); }
  }

  clear(key: string) { this.drafts.delete(key); this.generation += 1; }
  dispose() { this.drafts.clear(); this.receipts.clear(); this.matching.clear(); this.seen.clear(); this.generation += 1; }
}

export const nativeDictation = new NativeDictationTracker((composer, from, to) => {
  manualImprovement.rememberNative(composer, from, to);
});
