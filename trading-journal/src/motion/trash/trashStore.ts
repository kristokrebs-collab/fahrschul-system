/**
 * Papierkorb (R11, A5 "Interaktionen"): what the trader removes can be taken back for six seconds – really, not just in
 * the picture. The store holds the removed things as *entries*; each entry brings its own two functions:
 * - `restore()` puts the thing back exactly as it was (a screenshot with its original bytes, a queue of drafts),
 * - `commit()` lets go of it for good (the pinned bytes are released, the blob may be collected).
 * Nothing is deleted before `commit()`: while an entry waits, whoever stores the bytes keeps them (screenshots: `pinShotKeys`).
 *
 * Rules (they are what the unit tests check):
 * - an entry lives `TRASH_UNDO_MS` (6 s); hover / focus on its pill holds the clock (`holdTrash`), so nobody loses the undo
 *   while reaching for it (WCAG 2.2.1 timing adjustable),
 * - `undoTrash(id)` runs `restore()` once; only after it resolved is the entry gone and "wiederhergestellt" announced; a
 *   `restore()` that throws leaves the entry (and its bytes) in place and says so,
 * - `commitTrash(id)` / the timer run `commit()` once, whatever happens,
 * - an OWNER that goes away (the editor closes, the field unmounts) settles its entries at once (`settleTrashOwner`): the thing
 *   can no longer be put back where it came from, so no undo is offered that would do nothing,
 * - the screen reader gets one sentence per event (`announce`), the host reads it from a live region.
 */
import { create } from "zustand";
import { dwell } from "@/motion/tokens";

/** How long a removed thing can be taken back (ms) – `dwell.undo` (6 s). */
export const TRASH_UNDO_MS = dwell.undo * 1000;

export interface TrashInput {
  /** What it is, for the sentence: "Screenshot 2", "3 Entwürfe". */
  subject: string;
  /** Short kind for the icon / test hooks. */
  kind: "shot" | "draft" | "item";
  /** Puts it back. Resolve = it is back; throw = it is NOT (the entry stays). */
  restore: () => void | Promise<void>;
  /** Lets go of it for good (called once, by the timer, `commitTrash` or `settleTrashOwner`). */
  commit: () => void | Promise<void>;
  /** Whoever put it in; `settleTrashOwner(owner)` commits all of its entries. */
  owner?: string;
}

export interface TrashEntry {
  id: number;
  subject: string;
  kind: TrashInput["kind"];
  owner?: string;
  /** `waiting` the clock runs · `held` the clock is paused (hover / focus) · `restoring` the undo is running · `failed` the undo did not work. */
  state: "waiting" | "held" | "restoring" | "failed";
  /** Started at (ms epoch) – the countdown bar of the host starts from it. */
  at: number;
}

interface TrashState {
  entries: TrashEntry[];
  /** Counts every entry ever put in – the host mounts (lazily) once it is > 0. */
  seq: number;
  /** The last sentence for the live region, with a counter so the same sentence twice is announced twice. */
  announce: { n: number; text: string };
}

export const useTrash = create<TrashState>(() => ({ entries: [], seq: 0, announce: { n: 0, text: "" } }));

interface Live {
  input: TrashInput;
  timer: ReturnType<typeof setTimeout> | undefined;
  /** ms left on the clock (set while held). */
  left: number;
  startedAt: number;
  settled: boolean;
}

const live = new Map<number, Live>();
let nextId = 1;

const say = (text: string): void => useTrash.setState((s) => ({ announce: { n: s.announce.n + 1, text } }));
const patch = (id: number, p: Partial<TrashEntry>): void => useTrash.setState((s) => ({ entries: s.entries.map((e) => (e.id === id ? { ...e, ...p } : e)) }));
const drop = (id: number): void => useTrash.setState((s) => ({ entries: s.entries.filter((e) => e.id !== id) }));

function arm(id: number, ms: number): void {
  const l = live.get(id);
  if (!l) return;
  clearTimeout(l.timer);
  l.left = ms;
  l.startedAt = Date.now();
  l.timer = setTimeout(() => void commitTrash(id), ms);
}

/** Puts something into the trash; returns the entry id. Announces it ("… entfernt. Rückgängig …"). */
export function putTrash(input: TrashInput): number {
  const id = nextId++;
  live.set(id, { input, timer: undefined, left: TRASH_UNDO_MS, startedAt: Date.now(), settled: false });
  useTrash.setState((s) => ({
    entries: [...s.entries, { id, subject: input.subject, kind: input.kind, owner: input.owner, state: "waiting", at: Date.now() }],
    seq: s.seq + 1,
  }));
  arm(id, TRASH_UNDO_MS);
  say(`${input.subject} entfernt. Rückgängig machen mit der Schaltfläche am unteren Rand.`);
  return id;
}

/** Holds (`true`) or resumes (`false`) the clock of an entry – hover and focus on its pill. */
export function holdTrash(id: number, hold: boolean): void {
  const l = live.get(id);
  const e = useTrash.getState().entries.find((x) => x.id === id);
  if (!l || !e || l.settled || e.state === "restoring") return;
  if (hold && e.state === "waiting") {
    clearTimeout(l.timer);
    l.timer = undefined;
    l.left = Math.max(400, l.left - (Date.now() - l.startedAt));
    patch(id, { state: "held" });
  } else if (!hold && e.state === "held") {
    patch(id, { state: "waiting", at: Date.now() - (TRASH_UNDO_MS - l.left) });
    arm(id, l.left);
  }
}

/** Takes it back. Resolves `true` when `restore()` worked (the entry is then gone), `false` when it did not (the entry stays). */
export async function undoTrash(id: number): Promise<boolean> {
  const l = live.get(id);
  const e = useTrash.getState().entries.find((x) => x.id === id);
  if (!l || !e || l.settled || e.state === "restoring") return false;
  clearTimeout(l.timer);
  patch(id, { state: "restoring" });
  try {
    await l.input.restore();
  } catch {
    // nothing was lost: the bytes are still held, the clock starts again so the trader can try once more
    patch(id, { state: "failed" });
    say(`${e.subject} konnte nicht wiederhergestellt werden.`);
    arm(id, TRASH_UNDO_MS);
    return false;
  }
  l.settled = true;
  live.delete(id);
  // the restore put it back: whoever pinned its bytes lets go of the PIN only (nothing is deleted by an undo)
  drop(id);
  say(`${e.subject} wiederhergestellt.`);
  return true;
}

/** Lets go for good: runs `commit()` once and removes the entry. */
export async function commitTrash(id: number): Promise<void> {
  const l = live.get(id);
  if (!l || l.settled) return;
  l.settled = true;
  clearTimeout(l.timer);
  live.delete(id);
  drop(id);
  try {
    await l.input.commit();
  } catch {
    /* releasing is best effort: a blob that stays is collected with the next sweep */
  }
}

/** The owner went away: commit all of its entries now (no undo that could not put anything back). */
export function settleTrashOwner(owner: string): void {
  for (const e of useTrash.getState().entries) if (e.owner === owner) void commitTrash(e.id);
}

/** Commit everything (page hide / tests). */
export function settleAllTrash(): void {
  for (const e of useTrash.getState().entries) void commitTrash(e.id);
}

/** Tests: forget every entry and clock. */
export function resetTrashForTests(): void {
  for (const l of live.values()) clearTimeout(l.timer);
  live.clear();
  useTrash.setState({ entries: [], seq: 0, announce: { n: 0, text: "" } });
  nextId = 1;
}
