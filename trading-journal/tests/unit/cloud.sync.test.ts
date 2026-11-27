/**
 * P09 sync: pure reconcile table + the engine / Supabase adapter against an in-memory fake of `journal_docs`
 * (merge on first login, tombstones, three-way edits, settings rev conflicts, offline queue, account switch).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Settings, Trade } from "@/domain/types";
import { normalizeSettings, normalizeTrade } from "@/domain/normalize";
import { createLocalAdapter } from "@/store/adapters/localAdapter";
import { writeSnapshot } from "@/store/backup";
import { KEYS, listKeys } from "@/store/storage";
import { memoryBaseStore, type SyncBase } from "@/cloud/sync/base";
import { docKey, hashDoc, rowsToBackup, stableStringify, type DocRow } from "@/cloud/sync/docs";
import { createOutbox } from "@/cloud/sync/outbox";
import { applyPlanLocal, decide, planReconcile, toRemoteDoc, type RemoteDoc } from "@/cloud/sync/reconcile";
import { RemoteError, type RemoteJournal, type UpsertDoc } from "@/cloud/sync/remote";
import { createSupabaseAdapter } from "@/cloud/sync/supabaseAdapter";
import type { SyncStatus } from "@/cloud/sync/status";
import type { AdapterEvent } from "@/store/adapters/StoreApi";
import { mkTrade } from "./domain.fixtures";

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** In-memory `journal_docs` of one user with server-stamped rev / updated_at and an optional realtime echo. */
function fakeRemote() {
  const rows = new Map<string, DocRow>();
  const subs = new Set<(r: DocRow) => void>();
  let tick = 0;
  let online = true;
  const calls = { pullAll: 0, upsert: [] as UpsertDoc[][], settings: 0 };
  const stamp = () => new Date(Date.UTC(2026, 9, 12, 0, 0, 0, ++tick)).toISOString();
  const guard = () => {
    if (!online) throw new RemoteError("network", true);
  };
  const put = (kind: string, id: string, data: unknown, deleted = false): DocRow => {
    const key = `${kind}:${id}`;
    const prev = rows.get(key);
    const row: DocRow = { kind, id, data: clone(data), deleted, rev: (prev?.rev ?? 0) + 1, updated_at: stamp() };
    rows.set(key, row);
    return clone(row);
  };
  const remote: RemoteJournal = {
    async pullAll() {
      guard();
      calls.pullAll++;
      return [...rows.values()].map(clone);
    },
    async pullSince(since) {
      guard();
      return [...rows.values()].filter((r) => (r.updated_at ?? "") > since).map(clone);
    },
    async upsert(docs) {
      guard();
      calls.upsert.push(clone([...docs]));
      return docs.map((d) => put(d.kind, d.id, d.data, d.deleted));
    },
    async writeSettings(data, expectedRev) {
      guard();
      calls.settings++;
      const cur = rows.get("settings:settings");
      if (expectedRev === null ? !!cur : cur?.rev !== expectedRev) return { ok: false, current: cur ? clone(cur) : null };
      return { ok: true, row: put("settings", "settings", data) };
    },
    subscribe(onRow, onStatus) {
      subs.add(onRow);
      queueMicrotask(() => onStatus("live"));
      return () => subs.delete(onRow);
    },
  };
  return {
    rows,
    remote,
    calls,
    setOnline: (v: boolean) => (online = v),
    /** Another device writes a row (and Realtime delivers it). */
    other(kind: string, id: string, data: unknown, deleted = false) {
      const row = put(kind, id, data, deleted);
      for (const s of subs) s(clone(row));
      return row;
    },
    live: (key: string) => {
      const r = rows.get(key);
      return r && !r.deleted ? r.data : undefined;
    },
  };
}

const T1 = mkTrade({ id: "t_1", date: "2026-10-01T10:00", entry: 100, exit: 110, size: 1000, updatedAt: "2026-10-01T10:00:00.000Z" });
const T2 = mkTrade({ id: "t_2", date: "2026-10-02T10:00", entry: 200, exit: 190, size: 1000, updatedAt: "2026-10-02T10:00:00.000Z" });

function seedLocal(trades: Trade[], settings: Partial<Settings> = {}, days: Record<string, unknown> = {}) {
  localStorage.setItem(KEYS.trades, JSON.stringify(trades));
  localStorage.setItem(KEYS.settings, JSON.stringify({ ...normalizeSettings(null), ...settings }));
  localStorage.setItem(KEYS.days, JSON.stringify(days));
  localStorage.setItem(KEYS.hyblock, JSON.stringify([]));
}

function setup(remote = fakeRemote(), base = memoryBaseStore(), userId = U1) {
  const toasts: { kind: string; title: string }[] = [];
  const status: Partial<SyncStatus>[] = [];
  const events: AdapterEvent[] = [];
  const adapter = createSupabaseAdapter({
    userId,
    remote: remote.remote,
    outbox: createOutbox(null),
    base,
    snapshot: (tag, snap) => writeSnapshot(tag, snap),
    notify: (t) => toasts.push(t),
    status: (p) => status.push(p),
    ping: () => undefined,
    flushDelayMs: 0,
    batchMs: 0,
    isOnline: () => true,
    events: { win: { addEventListener: () => undefined, removeEventListener: () => undefined }, doc: { addEventListener: () => undefined, removeEventListener: () => undefined, visibilityState: "visible" } },
  });
  const off = adapter.subscribe((e) => events.push(e));
  const lastPhase = () => [...status].reverse().find((s) => s.phase)?.phase;
  return { adapter, remote, base, toasts, status, events, off, lastPhase };
}

const settled = (fn: () => void) => vi.waitFor(fn, { timeout: 2000, interval: 5 });

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("reconcile table", () => {
  const rec = (v: object) => normalizeTrade({ id: "t", ...v }) as unknown as Record<string, unknown>;
  const remoteOf = (v: object | null, deleted = false): RemoteDoc => toRemoteDoc({ kind: "trade", id: "t", data: v ?? { deletedAt: "x" }, deleted, rev: 1, updated_at: "u" })!;
  const a = rec({ notes: "a", updatedAt: "2026-01-01" });
  const b = rec({ notes: "b", updatedAt: "2026-01-02" });

  it("same / take / push / conflicts by updatedAt", () => {
    expect(decide(undefined, a, remoteOf(a)).action).toBe("same");
    expect(decide(hashDoc(a), a, remoteOf(b))).toEqual({ action: "take", conflict: false });
    expect(decide(hashDoc(b), a, remoteOf(b))).toEqual({ action: "push", conflict: false });
    const c = rec({ notes: "c", updatedAt: "2026-01-03" });
    expect(decide(hashDoc(a), c, remoteOf(b))).toEqual({ action: "push", conflict: true });
    expect(decide(hashDoc(a), b, remoteOf(c))).toEqual({ action: "take", conflict: true });
  });

  it("tombstones and missing rows are lossless", () => {
    expect(decide(hashDoc(a), a, remoteOf(null, true)).action).toBe("drop");
    expect(decide(hashDoc(b), a, remoteOf(null, true))).toEqual({ action: "push", conflict: true });
    expect(decide(hashDoc(a), a, undefined).action).toBe("push");
    expect(decide(remoteOf(a).hash, undefined, remoteOf(a)).action).toBe("pushDelete");
    expect(decide(hashDoc(b), undefined, remoteOf(a))).toEqual({ action: "take", conflict: true });
    expect(decide(undefined, undefined, remoteOf(a)).action).toBe("take");
    expect(decide(undefined, undefined, remoteOf(null, true)).action).toBe("none");
  });

  it("hashes are key-order independent and normalisation never looks like a change", () => {
    expect(stableStringify({ b: 1, a: [1, { d: 2, c: undefined }] })).toBe('{"a":[1,{"d":2}],"b":1}');
    expect(hashDoc({ x: 1, y: 2 })).toBe(hashDoc({ y: 2, x: 1 }));
    const raw = { id: "t", entry: "100", checks: { a: true, b: false } };
    const r = toRemoteDoc({ kind: "trade", id: "t", data: raw, deleted: false })!;
    expect(r.hash).toBe(hashDoc(normalizeTrade(raw)));
  });

  it("applies a plan in place, keeps order, adds new records", () => {
    const local = new Map([[docKey("trade", "t_1"), T1 as unknown as Record<string, unknown>], [docKey("trade", "t_2"), T2 as unknown as Record<string, unknown>]]);
    const t1b = { ...T1, notes: "remote" };
    const remote = new Map([[docKey("trade", "t_1"), toRemoteDoc({ kind: "trade", id: "t_1", data: t1b, deleted: false })!], [docKey("trade", "t_2"), toRemoteDoc({ kind: "trade", id: "t_2", data: {}, deleted: true })!], [docKey("trade", "t_3"), toRemoteDoc({ kind: "trade", id: "t_3", data: { ...T1, id: "t_3" }, deleted: false })!]]);
    const base = { [docKey("trade", "t_1")]: hashDoc(T1), [docKey("trade", "t_2")]: hashDoc(T2) };
    const plan = planReconcile(base, local, remote);
    const parts = applyPlanLocal({ trades: [T1, T2], hyblock: [], days: {} }, plan);
    expect(parts.trades!.map((t) => [t.id, t.notes])).toEqual([["t_1", "remote"], ["t_3", ""]]);
    expect(parts.hyblock).toBeUndefined();
  });

  it("rowsToBackup skips tombstones and forces ids", () => {
    const b = rowsToBackup([{ kind: "trade", id: "t_9", data: { id: "x" }, deleted: false }, { kind: "trade", id: "t_8", data: {}, deleted: true }, { kind: "day", id: "2026-10-01", data: { note: "n" }, deleted: false }], "now");
    expect(b.trades).toEqual([{ id: "t_9" }]);
    expect(b.days).toEqual({ "2026-10-01": { note: "n" } });
  });
});

describe("sync engine", () => {
  it("first login: snapshot first, merge local into an empty cloud, upload everything, toast", async () => {
    seedLocal([T1, T2], { currency: "EUR" }, { "2026-10-01": { note: "ruhig", updatedAt: "2026-10-01T20:00:00Z" } });
    const s = setup();
    await settled(() => expect(s.lastPhase()).toBe("live"));
    expect(listKeys(KEYS.backupPrefix).some((k) => k.includes("import-"))).toBe(true);
    expect(s.remote.live("trade:t_1")).toMatchObject({ id: "t_1", entry: 100 });
    expect(s.remote.live("day:2026-10-01")).toMatchObject({ note: "ruhig" });
    expect((s.remote.live("settings:settings") as Settings).currency).toBe("EUR");
    expect(s.base.value).toMatchObject({ owner: U1, settingsRev: 1 });
    expect(Object.keys(s.base.value!.docs).sort()).toEqual(["day:2026-10-01", "trade:t_1", "trade:t_2"]);
    expect(s.toasts.at(-1)).toMatchObject({ kind: "success", title: "Sync aktiv" });
    expect(s.events.some((e) => e.type === "status" && e.mode === "cloud")).toBe(true);
    s.adapter.dispose();
  });

  it("first login with cloud data: merged both ways, newer version wins, conflict toast", async () => {
    const remote = fakeRemote();
    remote.other("trade", "t_1", { ...T1, notes: "cloud newer", updatedAt: "2026-10-05T00:00:00.000Z" });
    remote.other("trade", "t_9", { ...T1, id: "t_9", date: "2026-09-09T09:00" });
    remote.other("settings", "settings", { ...normalizeSettings(null), currency: "USD" });
    seedLocal([T1, T2], { currency: "EUR" });
    const s = setup(remote);
    await settled(() => expect(s.lastPhase()).toBe("live"));
    const local = JSON.parse(localStorage.getItem(KEYS.trades)!) as Trade[];
    expect(local.map((t) => t.id).sort()).toEqual(["t_1", "t_2", "t_9"]);
    expect(local.find((t) => t.id === "t_1")!.notes).toBe("cloud newer");
    expect(s.remote.live("trade:t_2")).toMatchObject({ id: "t_2" });
    // cloud scalars stay on a merge (the import rule); local-only keys would be adopted
    expect(JSON.parse(localStorage.getItem(KEYS.settings)!).currency).toBe("USD");
    expect(s.toasts.at(-1)).toMatchObject({ kind: "info", title: "1 Konflikt zusammengeführt" });
    s.adapter.dispose();
  });

  it("local writes upload only the changed record; deletes become tombstones", async () => {
    seedLocal([T1, T2]);
    const s = setup();
    await settled(() => expect(s.lastPhase()).toBe("live"));
    const before = s.remote.calls.upsert.length;
    await s.adapter.api.saveTrade({ ...T1, notes: "edited", updatedAt: "2026-10-12T00:00:00.000Z" });
    await settled(() => expect((s.remote.live("trade:t_1") as Trade).notes).toBe("edited"));
    expect(s.remote.calls.upsert.slice(before).flat().map((d) => d.id)).toEqual(["t_1"]);
    await s.adapter.api.deleteTrade("t_2");
    await settled(() => expect(s.remote.rows.get("trade:t_2")?.deleted).toBe(true));
    expect(s.base.value!.docs["trade:t_2"]).toBeUndefined();
    // a new trade gets a client id at once
    await s.adapter.api.saveTrade({ ...T1, id: undefined as unknown as string, notes: "neu" });
    const ids = (JSON.parse(localStorage.getItem(KEYS.trades)!) as Trade[]).map((t) => t.id);
    expect(ids).toHaveLength(2);
    const fresh = ids.find((id) => id !== "t_1")!;
    expect(fresh).toMatch(/^t_/);
    await settled(() => expect(s.remote.live(`trade:${fresh}`)).toBeTruthy());
    s.adapter.dispose();
  });

  it("realtime: remote edits, inserts and tombstones reach the local journal; own echoes change nothing", async () => {
    seedLocal([T1, T2]);
    const s = setup();
    await settled(() => expect(s.lastPhase()).toBe("live"));
    const patches = () => s.events.filter((e) => e.type === "patch").length;
    const p0 = patches();
    s.remote.other("trade", "t_1", { ...T1, notes: "from phone", updatedAt: "2026-10-12T08:00:00.000Z" });
    s.remote.other("trade", "t_3", { ...T2, id: "t_3", date: "2026-10-03T10:00" });
    s.remote.other("trade", "t_2", { deletedAt: "2026-10-12T08:01:00.000Z" }, true);
    await settled(() => {
      const local = JSON.parse(localStorage.getItem(KEYS.trades)!) as Trade[];
      expect(local.map((t) => [t.id, t.notes])).toEqual([["t_1", "from phone"], ["t_3", ""]]);
    });
    expect(patches()).toBeGreaterThan(p0);
    // an echo of what we already have is a no-op
    const p1 = patches();
    const cur = s.remote.rows.get("trade:t_1")!;
    s.remote.other("trade", "t_1", cur.data);
    await new Promise((r) => setTimeout(r, 30));
    expect(patches()).toBe(p1);
    s.adapter.dispose();
  });

  it("a remote edit beats a local delete; a local edit beats a remote delete", async () => {
    seedLocal([T1, T2]);
    const base = memoryBaseStore();
    const remote = fakeRemote();
    let s = setup(remote, base);
    await settled(() => expect(s.lastPhase()).toBe("live"));
    s.adapter.dispose();
    // offline period: this device deletes t_1 and edits t_2, another device edits t_1 and deletes t_2
    const local = JSON.parse(localStorage.getItem(KEYS.trades)!) as Trade[];
    localStorage.setItem(KEYS.trades, JSON.stringify(local.filter((t) => t.id !== "t_1").map((t) => ({ ...t, notes: "mine", updatedAt: "2026-10-12T09:00:00.000Z" }))));
    remote.other("trade", "t_1", { ...T1, notes: "theirs", updatedAt: "2026-10-12T09:00:00.000Z" });
    remote.other("trade", "t_2", { deletedAt: "2026-10-12T09:00:00.000Z" }, true);
    s = setup(remote, base);
    await settled(() => expect(s.lastPhase()).toBe("live"));
    const after = JSON.parse(localStorage.getItem(KEYS.trades)!) as Trade[];
    expect(after.map((t) => [t.id, t.notes]).sort()).toEqual([["t_1", "theirs"], ["t_2", "mine"]]);
    expect(remote.rows.get("trade:t_2")!.deleted).toBe(false);
    expect(s.toasts.at(-1)!.title).toBe("2 Konflikte zusammengeführt");
    s.adapter.dispose();
  });

  it("settings: a lost rev race is merged (both changes survive) and retried", async () => {
    seedLocal([T1], { currency: "EUR" });
    const s = setup();
    await settled(() => expect(s.lastPhase()).toBe("live"));
    // another device changes the pair (rev 2) – realtime is not delivered here
    const theirs = { ...(s.remote.live("settings:settings") as Settings), pair: "ETH/USDT" };
    s.remote.rows.set("settings:settings", { ...s.remote.rows.get("settings:settings")!, data: theirs, rev: 2, updated_at: "2026-10-12T10:00:00.000Z" });
    await s.adapter.api.saveSettings({ ...(JSON.parse(localStorage.getItem(KEYS.settings)!) as Settings), currency: "USD" });
    await settled(() => expect((s.remote.live("settings:settings") as Settings).currency).toBe("USD"));
    const stored = s.remote.live("settings:settings") as Settings;
    expect(stored.pair).toBe("ETH/USDT");
    expect((JSON.parse(localStorage.getItem(KEYS.settings)!) as Settings).pair).toBe("ETH/USDT");
    expect(s.base.value!.settingsRev).toBe(3);
    s.adapter.dispose();
  });

  it("offline: writes stay local and queue up; the next cycle uploads them", async () => {
    seedLocal([T1]);
    const s = setup();
    await settled(() => expect(s.lastPhase()).toBe("live"));
    s.remote.setOnline(false);
    await s.adapter.api.saveTrade({ ...T1, notes: "offline edit", updatedAt: "2026-10-12T11:00:00.000Z" });
    expect((JSON.parse(localStorage.getItem(KEYS.trades)!) as Trade[])[0]!.notes).toBe("offline edit");
    await settled(() => expect(s.lastPhase()).toBe("offline"));
    expect(s.events.some((e) => e.type === "status" && e.mode === "error")).toBe(true);
    s.remote.setOnline(true);
    await s.adapter.engine.syncNow();
    expect((s.remote.live("trade:t_1") as Trade).notes).toBe("offline edit");
    expect(s.lastPhase()).toBe("live");
    s.adapter.dispose();
  });

  it("another account signing in: local journal kept in a snapshot, never uploaded, cloud journal shown", async () => {
    seedLocal([T1, T2]);
    const remote = fakeRemote();
    remote.other("trade", "t_b", { ...T1, id: "t_b", notes: "account B" });
    const prev: SyncBase = { v: 1, owner: U2, at: "", docs: {}, settings: null, settingsRev: null, serverAt: null };
    const s = setup(remote, memoryBaseStore(prev), U1);
    await settled(() => expect(s.lastPhase()).toBe("live"));
    expect((JSON.parse(localStorage.getItem(KEYS.trades)!) as Trade[]).map((t) => t.id)).toEqual(["t_b"]);
    expect(remote.live("trade:t_1")).toBeUndefined();
    const snap = listKeys(KEYS.backupPrefix).find((k) => k.includes("import-"))!;
    expect((JSON.parse(localStorage.getItem(snap)!) as { trades: Trade[] }).trades.map((t) => t.id)).toEqual(["t_1", "t_2"]);
    expect(s.toasts.at(-1)!.title).toBe("Neues Konto – lokales Journal gesichert");
    s.adapter.dispose();
  });

  it("an invalid cloud record is quarantined, never written locally", async () => {
    seedLocal([T1]);
    const remote = fakeRemote();
    remote.other("trade", "t_bad", { id: "", side: 42 });
    const s = setup(remote);
    await settled(() => expect(s.lastPhase()).toBe("live"));
    // first login merges by `parseBackup` rules; the reconcile after that validates every take
    s.adapter.dispose();
    const s2 = setup(remote, s.base);
    remote.other("trade", "t_bad2", "not an object" as unknown as object);
    await settled(() => expect(s2.lastPhase()).toBe("live"));
    expect((JSON.parse(localStorage.getItem(KEYS.trades)!) as Trade[]).some((t) => t.id === "t_bad2")).toBe(false);
    s2.adapter.dispose();
  });

  it("snapshot failure aborts the first sync and leaves everything untouched", async () => {
    seedLocal([T1]);
    const remote = fakeRemote();
    const toasts: { title: string }[] = [];
    const status: Partial<SyncStatus>[] = [];
    const a = createSupabaseAdapter({
      userId: U1,
      remote: remote.remote,
      outbox: createOutbox(null),
      base: memoryBaseStore(),
      snapshot: () => false,
      notify: (t) => toasts.push(t),
      status: (p) => status.push(p),
      flushDelayMs: 0,
      batchMs: 0,
      events: { win: { addEventListener: () => undefined, removeEventListener: () => undefined } },
    });
    a.subscribe(() => undefined);
    await settled(() => expect(status.some((p) => p.phase === "error")).toBe(true));
    expect(remote.rows.size).toBe(0);
    expect(toasts.at(-1)!.title).toBe("Snapshot konnte nicht angelegt werden");
    a.dispose();
  });

  it("local adapter replaceParts writes only the given keys and emits exactly them", async () => {
    seedLocal([T1]);
    const local = createLocalAdapter();
    local.load();
    const seen: AdapterEvent[] = [];
    local.subscribe((e) => seen.push(e));
    const before = localStorage.getItem(KEYS.settings);
    await local.replaceParts({ trades: [T2] });
    expect(localStorage.getItem(KEYS.settings)).toBe(before);
    expect((JSON.parse(localStorage.getItem(KEYS.trades)!) as Trade[]).map((t) => t.id)).toEqual(["t_2"]);
    expect(seen).toEqual([{ type: "patch", patch: { trades: [T2] } }]);
    local.dispose();
  });
});
