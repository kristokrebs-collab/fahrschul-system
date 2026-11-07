/**
 * B1 – the data takeover at the first login: the preview numbers, the four choices on both sides (device and account),
 * no duplicates, the safety snapshot, "Lokal behalten", and the undo window (device + the account rows the takeover
 * wrote). The cloud is an in-memory `journal_docs` (same shape as `cloud.sync.test.ts`); nothing here talks to Supabase.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Settings, Trade } from "@/domain/types";
import { normalizeSettings, normalizeTrade } from "@/domain/normalize";
import { memoryBaseStore } from "@/cloud/sync/base";
import { hashDoc, type DocRow } from "@/cloud/sync/docs";
import { createOutbox } from "@/cloud/sync/outbox";
import { RemoteError, type RemoteJournal, type UpsertDoc } from "@/cloud/sync/remote";
import { snapshotDocs, toRemoteDoc, type RemoteDoc } from "@/cloud/sync/reconcile";
import { createSupabaseAdapter } from "@/cloud/sync/supabaseAdapter";
import type { SyncStatus } from "@/cloud/sync/status";
import { computeTakeover, needsDecision, previewTakeover, totalOf, type TakeoverChoice, type TakeoverPreview, type TakeoverResult } from "@/cloud/sync/takeover";
import { memoryUndoStorage, UNDO_WINDOW_MS } from "@/cloud/sync/undo";
import { answerTakeover, closeTakeover, requestTakeover, resetTakeover, takeoverHooks, useTakeover } from "@/cloud/takeover";
import { createLocalAdapter } from "@/store/adapters/localAdapter";
import { writeSnapshot } from "@/store/backup";
import { KEYS, listKeys } from "@/store/storage";
import { mkTrade } from "./domain.fixtures";

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function fakeRemote() {
  const rows = new Map<string, DocRow>();
  let tick = 0;
  const calls = { pullAll: 0, upsert: [] as UpsertDoc[][], settings: 0 };
  let failUpsert = false;
  const put = (kind: string, id: string, data: unknown, deleted = false): DocRow => {
    const key = `${kind}:${id}`;
    const prev = rows.get(key);
    const row: DocRow = { kind, id, data: clone(data), deleted, rev: (prev?.rev ?? 0) + 1, updated_at: new Date(Date.UTC(2026, 9, 12, 0, 0, 0, ++tick)).toISOString() };
    rows.set(key, row);
    return clone(row);
  };
  const remote: RemoteJournal = {
    async pullAll() {
      calls.pullAll++;
      return [...rows.values()].map(clone);
    },
    async pullSince(since) {
      return [...rows.values()].filter((r) => (r.updated_at ?? "") > since).map(clone);
    },
    async upsert(docs) {
      if (failUpsert) throw new RemoteError("network", true);
      calls.upsert.push(clone([...docs]));
      return docs.map((d) => put(d.kind, d.id, d.data, d.deleted));
    },
    async writeSettings(data, expectedRev) {
      calls.settings++;
      const cur = rows.get("settings:settings");
      if (expectedRev === null ? !!cur : cur?.rev !== expectedRev) return { ok: false, current: cur ? clone(cur) : null };
      return { ok: true, row: put("settings", "settings", data) };
    },
    subscribe(_onRow, onStatus) {
      queueMicrotask(() => onStatus("live"));
      return () => undefined;
    },
  };
  return {
    rows,
    remote,
    calls,
    failUpsert: (v: boolean) => (failUpsert = v),
    seed: (kind: string, id: string, data: unknown, deleted = false) => put(kind, id, data, deleted),
    live: (key: string) => {
      const r = rows.get(key);
      return r && !r.deleted ? r.data : undefined;
    },
    liveKeys: () => [...rows.values()].filter((r) => !r.deleted && r.kind !== "settings").map((r) => `${r.kind}:${r.id}`).sort(),
  };
}

const T1 = mkTrade({ id: "t_1", date: "2026-10-01T10:00", entry: 100, exit: 110, size: 1000, updatedAt: "2026-10-01T10:00:00.000Z" });
const T2 = mkTrade({ id: "t_2", date: "2026-10-02T10:00", entry: 200, exit: 190, size: 1000, updatedAt: "2026-10-02T10:00:00.000Z" });
const T3 = mkTrade({ id: "t_3", date: "2026-10-03T10:00", entry: 300, exit: 310, size: 1000, updatedAt: "2026-10-03T10:00:00.000Z" });

function seedLocal(trades: Trade[], settings: Partial<Settings> = {}, days: Record<string, unknown> = {}) {
  localStorage.setItem(KEYS.trades, JSON.stringify(trades));
  localStorage.setItem(KEYS.settings, JSON.stringify({ ...normalizeSettings(null), ...settings }));
  localStorage.setItem(KEYS.days, JSON.stringify(days));
  localStorage.setItem(KEYS.hyblock, JSON.stringify([]));
}

const localTradeIds = () => (JSON.parse(localStorage.getItem(KEYS.trades) ?? "[]") as Trade[]).map((t) => t.id).sort();

interface Harness {
  adapter: ReturnType<typeof createSupabaseAdapter>;
  remote: ReturnType<typeof fakeRemote>;
  base: ReturnType<typeof memoryBaseStore>;
  undo: ReturnType<typeof memoryUndoStorage>;
  asked: TakeoverPreview[];
  results: TakeoverResult[];
  steps: string[];
  failures: string[];
  kept: { n: number };
  toasts: { kind: string; title: string }[];
  status: Partial<SyncStatus>[];
  lastPhase: () => string | undefined;
}

function setup(opts: { answer?: TakeoverChoice | (() => Promise<TakeoverChoice>) | null; remote?: ReturnType<typeof fakeRemote>; userId?: string; base?: ReturnType<typeof memoryBaseStore>; undo?: ReturnType<typeof memoryUndoStorage>; now?: () => Date } = {}): Harness {
  const remote = opts.remote ?? fakeRemote();
  const base = opts.base ?? memoryBaseStore();
  const undo = opts.undo ?? memoryUndoStorage();
  const h = { asked: [] as TakeoverPreview[], results: [] as TakeoverResult[], steps: [] as string[], failures: [] as string[], kept: { n: 0 }, toasts: [] as { kind: string; title: string }[], status: [] as Partial<SyncStatus>[] };
  const adapter = createSupabaseAdapter({
    userId: opts.userId ?? U1,
    remote: remote.remote,
    outbox: createOutbox(null),
    base,
    snapshot: (tag, snap) => writeSnapshot(tag, snap),
    notify: (t) => h.toasts.push(t),
    status: (p) => h.status.push(p),
    ping: () => undefined,
    flushDelayMs: 0,
    batchMs: 0,
    now: opts.now,
    isOnline: () => true,
    events: { win: { addEventListener: () => undefined, removeEventListener: () => undefined }, doc: { addEventListener: () => undefined, removeEventListener: () => undefined, visibilityState: "visible" } },
    decideTakeover:
      opts.answer === null
        ? undefined
        : async (p) => {
            h.asked.push(p);
            const a = opts.answer ?? p.recommended;
            return typeof a === "function" ? a() : a;
          },
    takeover: { step: (s) => h.steps.push(s), done: (r) => h.results.push(r), failed: (m) => h.failures.push(m) },
    undo,
    onKeepLocal: () => {
      h.kept.n++;
    },
  });
  adapter.subscribe(() => undefined);
  return { adapter, remote, base, undo, ...h, lastPhase: () => [...h.status].reverse().find((s) => s.phase)?.phase };
}

const settled = (fn: () => void) => vi.waitFor(fn, { timeout: 2000, interval: 5 });

beforeEach(() => {
  localStorage.clear();
  resetTakeover();
});
afterEach(() => vi.restoreAllMocks());

/* ------------------------------------------------------------------ pure preview + compute */

function docsOf(rows: Record<string, unknown>[], kind = "trade"): Map<string, RemoteDoc> {
  const m = new Map<string, RemoteDoc>();
  for (const r of rows) {
    const d = toRemoteDoc({ kind, id: String((r as { id: string }).id), data: r, deleted: false, rev: 1, updated_at: "u" });
    if (d) m.set(`${d.kind}:${d.id}`, d);
  }
  return m;
}

describe("previewTakeover", () => {
  const settings = normalizeSettings(null);
  // the engine reads the journal normalised – so do these fixtures
  const local = { trades: [normalizeTrade(T1), normalizeTrade(T2)], hyblock: [], days: {}, settings };

  it("counts same, only here, only in the account and different – and lists the sensible choices", () => {
    const remote = docsOf([T1 as never, { ...T2, notes: "anders", updatedAt: "2026-10-09T00:00:00.000Z" } as never, T3 as never]);
    const p = previewTakeover({ local, remote, settingsRow: null, otherOwner: false });
    expect(p.local.trades).toBe(2);
    expect(p.cloud.trades).toBe(3);
    expect(p.same.trades).toBe(1);
    expect(p.differ.trades).toBe(1);
    expect(p.localOnly.trades).toBe(0);
    expect(p.cloudOnly.trades).toBe(1);
    expect(p.allowed).toEqual(["merge", "local", "cloud", "keep"]);
    expect(p.recommended).toBe("merge");
    expect(needsDecision(p)).toBe(true);
  });

  it("an empty account offers upload or keep – never a choice that would wipe this device", () => {
    const p = previewTakeover({ local, remote: new Map(), settingsRow: null, otherOwner: false });
    expect(p.cloudEmpty).toBe(true);
    expect(p.allowed).toEqual(["local", "keep"]);
    expect(p.localOnly.trades).toBe(2);
    expect(needsDecision(p)).toBe(true);
  });

  it("a journal of another account is never offered for upload", () => {
    const p = previewTakeover({ local, remote: docsOf([T3 as never]), settingsRow: null, otherOwner: true });
    expect(p.allowed).toEqual(["cloud", "keep"]);
    expect(p.recommended).toBe("cloud");
    expect(needsDecision(p)).toBe(true);
  });

  it("nothing to decide when this device is empty or everything here is already in the account", () => {
    expect(needsDecision(previewTakeover({ local: { ...local, trades: [] }, remote: docsOf([T3 as never]), settingsRow: null, otherOwner: false }))).toBe(false);
    expect(needsDecision(previewTakeover({ local, remote: docsOf([T1 as never, T2 as never, T3 as never]), settingsRow: null, otherOwner: false }))).toBe(false);
  });

  it("a copy under another id (same date, entry, side, nothing new) counts as a duplicate", () => {
    const copy = { ...T1, id: "t_copy" };
    const p = previewTakeover({ local: { ...local, trades: [copy as Trade] }, remote: docsOf([T1 as never]), settingsRow: null, otherOwner: false });
    expect(p.localOnly.trades).toBe(1);
    expect(p.duplicates).toBe(1);
  });
});

describe("computeTakeover", () => {
  const settings = normalizeSettings(null);
  const mine = { ...T1, notes: "hier", updatedAt: "2026-10-01T10:00:00.000Z" } as Trade;
  const theirs = { ...T1, notes: "cloud", updatedAt: "2026-10-05T00:00:00.000Z" };
  const local = { trades: [mine, T2], hyblock: [], days: {}, settings };
  const remote = docsOf([theirs as never, T3 as never]);
  const notes = (s: { trades: Trade[] }) => s.trades.find((t) => t.id === "t_1")?.notes;

  it("merge: the newer version wins, everything of both sides is kept", () => {
    const { merged, conflicts } = computeTakeover("merge", { local, remote, settingsRow: null });
    expect(merged.trades.map((t) => t.id).sort()).toEqual(["t_1", "t_2", "t_3"]);
    expect(notes(merged)).toBe("cloud");
    expect(conflicts).toBe(1);
  });

  it("local: this device wins where the content differs; account-only records stay", () => {
    const { merged } = computeTakeover("local", { local, remote, settingsRow: null });
    expect(merged.trades.map((t) => t.id).sort()).toEqual(["t_1", "t_2", "t_3"]);
    expect(notes(merged)).toBe("hier");
  });

  it("cloud: this device takes the account, nothing local survives", () => {
    const { merged } = computeTakeover("cloud", { local, remote, settingsRow: null });
    expect(merged.trades.map((t) => t.id).sort()).toEqual(["t_1", "t_3"]);
    expect(notes(merged)).toBe("cloud");
  });
});

/* ------------------------------------------------------------------ engine */

describe("takeover in the engine", () => {
  it("the dialog is asked only when there is something to decide (no local data → no question, silent merge)", async () => {
    const remote = fakeRemote();
    remote.seed("trade", "t_9", { ...T1, id: "t_9", date: "2026-09-09T09:00" });
    seedLocal([]);
    const s = setup({ remote });
    await settled(() => expect(s.lastPhase()).toBe("live"));
    expect(s.asked).toHaveLength(0);
    expect(localTradeIds()).toEqual(["t_9"]);
    expect(s.toasts.at(-1)).toMatchObject({ title: "Sync aktiv" });
    s.adapter.dispose();
  });

  it("merge: snapshot first, steps in order, both sides complete, summary with an undo window", async () => {
    const remote = fakeRemote();
    remote.seed("trade", "t_3", T3);
    seedLocal([T1, T2]);
    const s = setup({ remote, answer: "merge" });
    await settled(() => expect(s.results).toHaveLength(1));
    expect(listKeys(KEYS.backupPrefix).some((k) => k.includes("import-"))).toBe(true);
    expect(s.steps).toEqual(["snapshot", "merge", "upload", "finish"]);
    expect(remote.liveKeys()).toEqual(["trade:t_1", "trade:t_2", "trade:t_3"]);
    expect(localTradeIds()).toEqual(["t_1", "t_2", "t_3"]);
    expect(s.results[0]).toMatchObject({ choice: "merge", pushed: 2, pulled: 1, conflicts: 0 });
    expect(s.results[0]!.undoUntil).not.toBeNull();
    expect(s.base.value?.owner).toBe(U1);
    s.adapter.dispose();
  });

  it("local: this device wins on a different record, the account's other records stay", async () => {
    const remote = fakeRemote();
    remote.seed("trade", "t_1", { ...T1, notes: "cloud", updatedAt: "2026-10-05T00:00:00.000Z" });
    remote.seed("trade", "t_3", T3);
    seedLocal([{ ...T1, notes: "hier" } as Trade]);
    const s = setup({ remote, answer: "local" });
    await settled(() => expect(s.results).toHaveLength(1));
    expect((remote.live("trade:t_1") as Trade).notes).toBe("hier");
    expect(remote.liveKeys()).toEqual(["trade:t_1", "trade:t_3"]);
    expect(s.results[0]).toMatchObject({ choice: "local", pushed: 1 });
    s.adapter.dispose();
  });

  it("cloud: nothing is uploaded, this device takes the account, the local journal stays in the snapshot", async () => {
    const remote = fakeRemote();
    remote.seed("trade", "t_3", T3);
    seedLocal([T1, T2]);
    const s = setup({ remote, answer: "cloud" });
    await settled(() => expect(s.results).toHaveLength(1));
    expect(remote.calls.upsert.flat().filter((u) => u.kind === "trade")).toHaveLength(0);
    expect(localTradeIds()).toEqual(["t_3"]);
    const snapKey = listKeys(KEYS.backupPrefix).find((k) => k.includes("import-"))!;
    expect((JSON.parse(localStorage.getItem(snapKey)!) as { trades: Trade[] }).trades.map((t) => t.id).sort()).toEqual(["t_1", "t_2"]);
    s.adapter.dispose();
  });

  it("keep: nothing is read or written in the account, no base, the controller is told to switch the sync off", async () => {
    const remote = fakeRemote();
    remote.seed("trade", "t_3", T3);
    seedLocal([T1]);
    const s = setup({ remote, answer: "keep" });
    await settled(() => expect(s.kept.n).toBe(1));
    expect(remote.calls.upsert).toHaveLength(0);
    expect(remote.calls.settings).toBe(0);
    expect(s.base.value).toBeNull();
    expect(localTradeIds()).toEqual(["t_1"]);
    expect(s.lastPhase()).toBe("paused");
    expect(s.toasts.at(-1)).toMatchObject({ title: "Journal bleibt lokal" });
    s.adapter.dispose();
  });

  it("a journal of another account only offers cloud / keep – an upload choice is refused", async () => {
    const remote = fakeRemote();
    remote.seed("trade", "t_3", T3);
    seedLocal([T1]);
    const base = memoryBaseStore({ v: 1, owner: U2, at: "x", docs: {}, settings: null, settingsRev: null, serverAt: null });
    const s = setup({ remote, base, answer: "merge" });
    await settled(() => expect(s.failures.length).toBeGreaterThan(0));
    expect(s.asked[0]!.allowed).toEqual(["cloud", "keep"]);
    expect(remote.calls.upsert).toHaveLength(0);
    expect(remote.liveKeys()).toEqual(["trade:t_3"]);
    s.adapter.dispose();
  });

  it("no duplicates: a second first-login with the same data uploads nothing and asks nothing", async () => {
    seedLocal([T1, T2]);
    const first = setup({ answer: "local" });
    await settled(() => expect(first.results).toHaveLength(1));
    const remote = first.remote;
    first.adapter.dispose();
    remote.calls.upsert.length = 0;
    // another browser with the same records
    const second = setup({ remote, answer: "merge" });
    await settled(() => expect(second.lastPhase()).toBe("live"));
    expect(second.asked).toHaveLength(0);
    expect(remote.calls.upsert.flat().filter((u) => u.kind === "trade")).toHaveLength(0);
    expect(remote.liveKeys()).toEqual(["trade:t_1", "trade:t_2"]);
    second.adapter.dispose();
  });

  it("no duplicates: a copy under another id is not added twice, and the summary says so", async () => {
    const remote = fakeRemote();
    remote.seed("trade", "t_1", T1);
    remote.seed("trade", "t_3", T3);
    seedLocal([{ ...T1, id: "t_copy" } as Trade, T2]);
    const s = setup({ remote, answer: "merge" });
    await settled(() => expect(s.results).toHaveLength(1));
    expect(remote.liveKeys()).toEqual(["trade:t_1", "trade:t_2", "trade:t_3"]);
    expect(s.results[0]!.duplicates).toBe(1);
    s.adapter.dispose();
  });

  it("the choice is applied on fresh data: what changed during the question is not overwritten", async () => {
    const remote = fakeRemote();
    remote.seed("trade", "t_3", T3);
    seedLocal([T1]);
    const s = setup({
      remote,
      answer: async () => {
        remote.seed("trade", "t_4", { ...T3, id: "t_4", date: "2026-10-04T10:00" }); // another device while the dialog is open
        return "merge";
      },
    });
    await settled(() => expect(s.results).toHaveLength(1));
    expect(localTradeIds()).toEqual(["t_1", "t_3", "t_4"]);
    s.adapter.dispose();
  });

  it("a failed upload is reported to the dialog and the retry asks again (the journal here is untouched until then)", async () => {
    const remote = fakeRemote();
    remote.seed("trade", "t_3", T3);
    seedLocal([T1]);
    remote.failUpsert(true);
    const s = setup({ remote, answer: "merge" });
    await settled(() => expect(s.failures.length).toBeGreaterThan(0));
    expect(s.base.value).toBeNull();
    s.adapter.dispose();
  });
});

describe("undo window", () => {
  it("restores this device AND the account rows the takeover wrote; the next sync asks again", async () => {
    const remote = fakeRemote();
    remote.seed("trade", "t_1", { ...T1, notes: "cloud", updatedAt: "2026-10-05T00:00:00.000Z" });
    remote.seed("trade", "t_3", T3);
    const before = clone(remote.live("trade:t_1"));
    seedLocal([{ ...T1, notes: "hier", updatedAt: "2026-10-09T00:00:00.000Z" } as Trade, T2]);
    let answers = 0;
    const s = setup({ remote, answer: async () => (answers++ === 0 ? "local" : "keep") });
    await settled(() => expect(s.results).toHaveLength(1));
    expect((remote.live("trade:t_1") as Trade).notes).toBe("hier");
    expect(remote.liveKeys()).toContain("trade:t_2");
    expect(await s.adapter.engine.pendingUndo()).not.toBeNull();

    // from here on the dialog asks again – this time keep, so nothing else happens
    expect(await s.adapter.engine.undoTakeover()).toBe(true);
    // account: the overwritten record has its old content, the added one is a tombstone
    expect(hashDoc(normalizeTrade(remote.live("trade:t_1")))).toBe(hashDoc(normalizeTrade(before)));
    expect((remote.live("trade:t_1") as Trade).notes).toBe("cloud");
    expect(remote.live("trade:t_2")).toBeUndefined();
    expect(remote.liveKeys()).toEqual(["trade:t_1", "trade:t_3"]);
    expect(await s.adapter.engine.pendingUndo()).toBeNull();
    // the question came back (undo clears the base → first login again), asked a second time
    await settled(() => expect(s.asked.length).toBe(2));
    s.adapter.dispose();
  });

  it("this device is back exactly as it was before the takeover", async () => {
    const remote = fakeRemote();
    remote.seed("trade", "t_3", T3);
    seedLocal([T1, T2], { currency: "EUR" });
    let answers = 0;
    const s = setup({ remote, answer: async () => (answers++ === 0 ? "cloud" : "keep") });
    await settled(() => expect(s.results).toHaveLength(1));
    expect(localTradeIds()).toEqual(["t_3"]);
    expect(await s.adapter.engine.undoTakeover()).toBe(true);
    await settled(() => expect(s.kept.n).toBe(1));
    expect(localTradeIds()).toEqual(["t_1", "t_2"]);
    expect((JSON.parse(localStorage.getItem(KEYS.settings)!) as Settings).currency).toBe("EUR");
    expect(remote.liveKeys()).toEqual(["trade:t_3"]);
    expect(s.base.value).toBeNull();
    s.adapter.dispose();
  });

  it("is refused after the window; the entry is dropped", async () => {
    let t = Date.parse("2026-10-12T12:00:00Z");
    const remote = fakeRemote();
    remote.seed("trade", "t_3", T3);
    seedLocal([T1]);
    const s = setup({ remote, answer: "merge", now: () => new Date(t) });
    await settled(() => expect(s.results).toHaveLength(1));
    t += UNDO_WINDOW_MS + 1000;
    expect(await s.adapter.engine.undoTakeover()).toBe(false);
    expect(s.undo.value).toBeUndefined();
    expect(remote.liveKeys()).toEqual(["trade:t_1", "trade:t_3"]);
    s.adapter.dispose();
  });

  it("an interrupted first attempt keeps its older, truer 'before' for the undo", async () => {
    const remote = fakeRemote();
    remote.seed("trade", "t_3", T3);
    seedLocal([T1, T2]);
    remote.failUpsert(true);
    const s = setup({ remote, answer: "merge" });
    await settled(() => expect(s.failures.length).toBeGreaterThan(0));
    const first = clone(s.undo.value!);
    expect((first.local.trades as Trade[]).map((t) => t.id).sort()).toEqual(["t_1", "t_2"]);
    remote.failUpsert(false);
    await s.adapter.engine.syncNow();
    await settled(() => expect(s.results.length).toBe(1));
    expect((s.undo.value!.local.trades as Trade[]).map((t) => t.id).sort()).toEqual(["t_1", "t_2"]);
    expect(s.undo.value!.at).toBe(first.at);
    s.adapter.dispose();
  });
});

/* ------------------------------------------------------------------ store + local adapter contract */

describe("takeover store", () => {
  const preview = (): TakeoverPreview => previewTakeover({ local: { trades: [T1], hyblock: [], days: {}, settings: normalizeSettings(null) }, remote: new Map(), settingsRow: null, otherOwner: false });

  it("requestTakeover resolves with the answer and walks choose → working → done", async () => {
    const p = requestTakeover(preview());
    expect(useTakeover.getState().phase).toBe("choose");
    answerTakeover("local");
    expect(await p).toBe("local");
    expect(useTakeover.getState().phase).toBe("working");
    takeoverHooks.step("upload");
    expect(useTakeover.getState().step).toBe("upload");
    takeoverHooks.done({ choice: "local", pushed: 1, pulled: 0, conflicts: 0, duplicates: 0, undoUntil: "2099-01-01T00:00:00.000Z" });
    expect(useTakeover.getState()).toMatchObject({ phase: "done", undoUntil: "2099-01-01T00:00:00.000Z" });
    closeTakeover();
    expect(useTakeover.getState().phase).toBe("idle");
    expect(useTakeover.getState().undoUntil).not.toBeNull();
  });

  it("closing while choosing is 'Später': the journal stays local", async () => {
    const p = requestTakeover(preview());
    closeTakeover();
    expect(await p).toBe("keep");
    expect(useTakeover.getState().phase).toBe("idle");
  });

  it("an error while working reaches the dialog", async () => {
    const p = requestTakeover(preview());
    answerTakeover("merge");
    await p;
    takeoverHooks.failed("kaputt");
    expect(useTakeover.getState()).toMatchObject({ phase: "error", error: "kaputt" });
  });
});

describe("helpers", () => {
  it("totalOf / snapshotDocs agree with the preview counts", () => {
    const l = createLocalAdapter();
    seedLocal([T1, T2], {}, { "2026-10-01": { note: "x", updatedAt: "2026-10-01T00:00:00Z" } });
    const snap = l.fresh();
    expect(snapshotDocs(snap).size).toBe(3);
    expect(totalOf({ trades: 2, hyblock: 0, days: 1 })).toBe(3);
    expect(hashDoc(snap.trades[0])).toBe(hashDoc(snap.trades[0]));
    l.dispose();
  });
});
