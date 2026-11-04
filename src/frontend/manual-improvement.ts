import type { PluginComposerApi, PluginComposerScope } from "@get-bb/plugin-sdk/app";
import { insertIntoDraftText } from "./composer-insert.ts";

export type EditingComposer = Pick<PluginComposerApi, "key" | "scope" | "draft" | "replace">;
export type Improvement = {
  draftText: string;
  from: number;
  to: number;
  rawText: string;
  edited: boolean;
  revision: number;
  status: "idle" | "busy" | "preview" | "done";
  result: string | null;
  error: string | null;
  undo: { before: string; after: string } | null;
};

type PendingInsertion = {
  before: string;
  piece: string;
  text: string;
  rawText: string;
  offset: number;
};

type PendingReplacement = {
  entry: Improvement;
  before: string;
  after: string;
  to: number;
  complete: () => void;
};

export function improvementScope(scope: PluginComposerScope): string {
  if (scope.kind === "thread") return `thread:${scope.threadId}`;
  if (scope.kind === "new-thread") return `new-thread:${scope.projectId ?? ""}`;
  return "unsupported";
}

/** In-memory, per-composer tracking. No draft is sent until improve() is called. */
export class ManualImprovement {
  private entries = new Map<string, Improvement>();
  private pending = new Map<string, Improvement>();
  private composers = new Map<string, PluginComposerApi>();
  private mounts = new Map<string, number>();
  private insertions = new Map<string, PendingInsertion>();
  private replacements = new Map<string, PendingReplacement>();
  private listeners = new Set<() => void>();
  private version = 0;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  getVersion = () => this.version;
  get = (key: string) => this.entries.get(key);
  getComposers = () => [...this.composers.values()];
  private changed() {
    this.version += 1;
    for (const listener of this.listeners) listener();
  }

  register(composer: PluginComposerApi) {
    const key = composer.key;
    this.composers.set(key, composer);
    this.mounts.set(key, (this.mounts.get(key) ?? 0) + 1);
    return () => {
      const count = (this.mounts.get(key) ?? 1) - 1;
      if (count > 0) this.mounts.set(key, count);
      else { this.composers.delete(key); this.mounts.delete(key); }
    };
  }

  insertDictation(scope: string, text: string, rawText: string, offsetHint?: number | null): boolean {
    let candidates = [...this.composers.values()].filter((item) => improvementScope(item.scope) === scope);
    if (!candidates.length && scope === "new-thread:") {
      candidates = [...this.composers.values()].filter((item) => item.scope.kind === "new-thread");
    }
    if (candidates.length !== 1) return false;
    const composer = candidates[0]!;
    const before = composer.draft.text;
    const planned = insertIntoDraftText(before, text, offsetHint ?? before.length);
    if (!planned.piece) return true;
    // insert() may publish its new draft on the next render. Do not inspect an
    // old snapshot and accidentally keep (or lose) the previous dictation.
    this.clear(composer.key);
    this.insertions.set(composer.key, { before, piece: planned.piece, text: text.trim(), rawText, offset: planned.offset });
    try {
      composer.insert(planned.piece);
    } catch (error) {
      this.insertions.delete(composer.key);
      throw error;
    }
    this.sync(composer);
    this.changed();
    return true;
  }

  private adoptInsertion(composer: EditingComposer): boolean {
    const insertion = this.insertions.get(composer.key);
    if (!insertion) return false;
    const after = composer.draft.text;
    if (after === insertion.before) return true;
    this.insertions.delete(composer.key);
    const matches: number[] = [];
    let at = -1;
    while ((at = after.indexOf(insertion.piece, at + 1)) !== -1) {
      const prefix = after.slice(0, at);
      const suffix = after.slice(at + insertion.piece.length);
      if (insertion.before.startsWith(prefix) && insertion.before.endsWith(suffix)
        && prefix.length + suffix.length <= insertion.before.length) matches.push(at);
    }
    const offset = matches.includes(insertion.offset) ? insertion.offset : matches.length === 1 ? matches[0] : undefined;
    if (offset !== undefined) {
      const from = offset + (insertion.piece.startsWith(" ") ? 1 : 0);
      this.remember(improvementScope(composer.scope), after, from, from + insertion.text.length, insertion.rawText);
      this.adopt(composer);
    } else this.changed();
    return false;
  }

  remember(scope: string, draftText: string, from: number, to: number, rawText: string) {
    if (from < 0 || to > draftText.length || to <= from) return;
    this.pending.set(scope, {
      draftText, from, to, rawText, edited: false, revision: 0,
      status: "idle", result: null, error: null, undo: null,
    });
    this.changed();
  }

  rememberNative(composer: EditingComposer, from: number, to: number) {
    this.clear(composer.key);
    const draftText = composer.draft.text;
    if (from < 0 || to <= from || to > draftText.length) return;
    this.entries.set(composer.key, {
      draftText, from, to, rawText: draftText.slice(from, to), edited: false, revision: 0,
      status: "idle", result: null, error: null, undo: null,
    });
    this.changed();
  }

  adopt(composer: EditingComposer) {
    const scope = improvementScope(composer.scope);
    const pending = this.pending.get(scope);
    if (!pending) return;
    this.pending.delete(scope);
    // A cleared or unrelated draft must never acquire an old dictation.
    if (composer.draft.text !== pending.draftText) return;
    this.entries.set(composer.key, pending);
    this.changed();
  }

  sync(composer: EditingComposer) {
    if (this.adoptInsertion(composer)) return;
    this.adopt(composer);
    const replacement = this.replacements.get(composer.key);
    if (replacement) {
      const actual = composer.draft.text;
      if (this.entries.get(composer.key) !== replacement.entry) {
        this.replacements.delete(composer.key);
      } else if (actual === replacement.after) {
        this.replacements.delete(composer.key);
        replacement.entry.draftText = actual;
        replacement.entry.to = replacement.to;
        replacement.entry.revision += 1;
        replacement.complete();
        this.changed();
      } else if (actual === replacement.before) return;
      else this.replacements.delete(composer.key);
    }
    const entry = this.entries.get(composer.key);
    if (!entry || entry.draftText === composer.draft.text) return;
    const before = entry.draftText;
    const after = composer.draft.text;
    if (!after.trim()) { this.clear(composer.key); return; }
    let start = 0;
    while (start < before.length && start < after.length && before[start] === after[start]) start += 1;
    let end = before.length;
    let nextEnd = after.length;
    while (end > start && nextEnd > start && before[end - 1] === after[nextEnd - 1]) { end -= 1; nextEnd -= 1; }
    const delta = nextEnd - end;
    if (end <= entry.from && start < entry.from) {
      entry.from += delta;
      entry.to += delta;
    } else if (start >= entry.to && !(start === end && start === entry.to)) {
      // Only text following the dictated fragment changed.
    } else if (start >= entry.from && end <= entry.to) {
      entry.to += delta;
      entry.edited = true;
      entry.revision += 1;
      entry.undo = null;
      if (entry.status === "done") entry.status = "idle";
    } else {
      // An edit crossed the fragment boundary: its identity is no longer safe.
      this.clear(composer.key);
      return;
    }
    entry.draftText = after;
    if (entry.to <= entry.from) { this.clear(composer.key); return; }
    this.changed();
  }

  clear(key: string) {
    this.insertions.delete(key);
    this.replacements.delete(key);
    const composer = this.composers.get(key);
    if (composer) this.pending.delete(improvementScope(composer.scope));
    if (this.entries.delete(key)) this.changed();
  }

  async improve(composer: EditingComposer, request: (text: string) => Promise<string>) {
    this.sync(composer);
    const entry = this.entries.get(composer.key);
    if (!entry || entry.status === "busy" || this.replacements.has(composer.key)) return;
    if (composer.draft.mentions.some((item) => item.from < entry.to && item.to > entry.from)) {
      entry.error = "mentions";
      this.changed();
      return;
    }
    const revision = entry.revision;
    const text = entry.edited ? entry.draftText.slice(entry.from, entry.to) : entry.rawText;
    entry.status = "busy";
    entry.error = null;
    entry.result = null;
    this.changed();
    try {
      const result = (await request(text)).trim();
      if (this.entries.get(composer.key) !== entry) return;
      this.sync(composer);
      if (this.entries.get(composer.key) !== entry) return;
      if (!result) throw new Error("Empty editor response");
      entry.result = result;
      entry.status = "preview";
      if (revision === entry.revision) this.apply(composer);
      else this.changed();
    } catch (error) {
      if (this.entries.get(composer.key) !== entry) return;
      entry.status = "idle";
      entry.error = error instanceof Error ? error.message : String(error);
      this.changed();
    }
  }

  apply(composer: EditingComposer) {
    this.sync(composer);
    const entry = this.entries.get(composer.key);
    if (!entry || entry.status !== "preview" || !entry.result || this.replacements.has(composer.key)) return;
    const before = entry.draftText.slice(entry.from, entry.to);
    const result = entry.result;
    this.replaceFragment(composer, entry, result, () => {
      entry.undo = { before, after: result };
      entry.status = "done";
      entry.result = null;
      entry.edited = true;
    });
  }

  undo(composer: EditingComposer) {
    this.sync(composer);
    const entry = this.entries.get(composer.key);
    if (!entry?.undo || entry.draftText.slice(entry.from, entry.to) !== entry.undo.after || this.replacements.has(composer.key)) return;
    this.replaceFragment(composer, entry, entry.undo.before, () => {
      entry.undo = null;
      entry.status = "idle";
      entry.edited = true;
    });
  }

  private replaceFragment(composer: EditingComposer, entry: Improvement, replacement: string, complete: () => void): void {
    const expected = entry.draftText;
    const from = entry.from;
    const to = entry.to;
    const delta = replacement.length - (to - from);
    const nextText = expected.slice(0, from) + replacement + expected.slice(to);
    this.replacements.set(composer.key, { entry, before: expected, after: nextText, to: from + replacement.length, complete });
    try {
      composer.replace((current) => {
        if (current.text !== expected || current.mentions.some((item) => item.from < to && item.to > from)) return current;
        return {
          text: current.text.slice(0, from) + replacement + current.text.slice(to),
          mentions: current.mentions.map((item) => item.from >= to
            ? { ...item, from: item.from + delta, to: item.to + delta } : item),
        };
      });
    } catch (error) {
      this.replacements.delete(composer.key);
      throw error;
    }
    this.sync(composer);
  }

  dispose() {
    this.clearTracking();
    this.composers.clear();
    this.mounts.clear();
  }

  clearTracking() {
    this.entries.clear();
    this.pending.clear();
    this.insertions.clear();
    this.replacements.clear();
    this.changed();
  }
}

export const manualImprovement = new ManualImprovement();
