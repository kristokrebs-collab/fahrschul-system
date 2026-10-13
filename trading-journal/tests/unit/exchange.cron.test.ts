// @vitest-environment node
/// <reference types="node" />
/**
 * Fairness of the scheduled exchange sync (`netlify/functions/exchange-sync-cron.mts`, review SYNC-01): connections
 * that are skipped (plan without auto-sync) or keep failing must not hold the batch of 40 while a paying trader waits.
 * The Supabase table is an in-memory fake that orders and updates like PostgREST; plan, store helpers and the sync
 * itself are mocked (the sync proper is covered by exchange.functions.test.ts).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
const H = 3_600_000;
const NOW = Date.parse("2026-10-13T08:00:00Z");

const db: { rows: Row[]; hasSchedule: boolean } = { rows: [], hasSchedule: true };
const synced: string[] = [];
const failing = new Set<string>();

vi.mock("../../netlify/functions/_lib/supabase", () => ({
  supabaseAdmin: () => ({
    from: () => {
      const filters: ((r: Row) => boolean)[] = [];
      const orders: { col: string; asc: boolean; nullsFirst: boolean }[] = [];
      let lim = 1000;
      let cols = "";
      let patch: Row | null = null;
      const q: Record<string, unknown> = {};
      q.select = (c: string) => ((cols = c), q);
      q.eq = (c: string, v: unknown) => (filters.push((r) => r[c] === v), q);
      q.order = (col: string, o: { ascending?: boolean; nullsFirst?: boolean } = {}) => (orders.push({ col, asc: o.ascending !== false, nullsFirst: !!o.nullsFirst }), q);
      q.limit = (n: number) => ((lim = n), q);
      q.update = (p: Row) => ((patch = p), q);
      q.then = (res: (v: unknown) => unknown) => {
        const usesSchedule = /next_sync_at|sync_failures/.test(cols) || orders.some((o) => o.col === "next_sync_at") || (patch && "next_sync_at" in patch);
        if (usesSchedule && !db.hasSchedule) return Promise.resolve(res({ data: null, error: { code: "42703" } }));
        const hits = db.rows.filter((r) => filters.every((f) => f(r)));
        if (patch) {
          for (const r of hits) Object.assign(r, patch);
          return Promise.resolve(res({ data: null, error: null }));
        }
        const sorted = [...hits].sort((a, b) => {
          for (const o of orders) {
            const va = a[o.col] as string | null | undefined;
            const vb = b[o.col] as string | null | undefined;
            if (va == null && vb == null) continue;
            if (va == null || vb == null) return (va == null ? -1 : 1) * (o.nullsFirst ? 1 : -1);
            if (va !== vb) return (va < vb ? -1 : 1) * (o.asc ? 1 : -1);
          }
          return 0;
        });
        return Promise.resolve(res({ data: sorted.slice(0, lim).map((r) => ({ ...r })), error: null }));
      };
      return q;
    },
  }),
}));
vi.mock("../../netlify/functions/_lib/plan", () => ({
  paymentsConfigured: () => true,
  planOf: async (uid: string) => ({ plan: uid.startsWith("payer") ? "pro" : "free", status: uid.startsWith("payer") ? "active" : "canceled", trialEnd: null }),
}));
vi.mock("../../netlify/functions/_lib/exchanges/api", () => ({ cronEnabled: () => true }));
vi.mock("../../netlify/functions/_lib/exchanges/sync", () => ({
  runSync: async (r: { connection: { id: string } }) => {
    if (failing.has(r.connection.id)) throw new Error("Bitunix antwortet nicht");
    synced.push(r.connection.id);
    const row = db.rows.find((x) => x.id === r.connection.id)!;
    row.last_sync_at = new Date(clock).toISOString();
  },
}));
vi.mock("../../netlify/functions/_lib/exchanges/store", () => ({
  CONNECTION_COLUMNS: "id,user_id,status,sync_enabled,last_sync_at",
  runningRun: async () => null,
  loadConnection: async (_u: string, id: string) => ({ id }),
  profileTz: async () => null,
}));

const { runExchangeCron, backoffMs, CRON_MIN_GAP_MS, CRON_PLAN_RECHECK_MS, CRON_MAX_BACKOFF_MS } = await import("../../netlify/functions/exchange-sync-cron.mts");

let clock = NOW;
const conn = (id: string, user: string, lastSyncAgoMs: number | null): Row => ({
  id,
  user_id: user,
  status: "active",
  sync_enabled: true,
  last_sync_at: lastSyncAgoMs === null ? null : new Date(NOW - lastSyncAgoMs).toISOString(),
  next_sync_at: null,
  sync_failures: 0,
});
const run = (minutes: number) => {
  clock = NOW + minutes * 60_000;
  return runExchangeCron(clock);
};

beforeEach(() => {
  db.rows = [];
  db.hasSchedule = true;
  synced.length = 0;
  failing.clear();
  clock = NOW;
});

describe("exchange-sync-cron: fair queue (review SYNC-01)", () => {
  it("40 connections whose trial ended no longer starve the paying trader", async () => {
    // the review's case: 40 lapsed trials synced 2 days ago + one Pro trader synced 1 h ago
    db.rows = [...Array.from({ length: 40 }, (_, i) => conn(`c${i}`, `lapsed${i}`, 48 * H + i * 1000)), conn("paid", "payer", H)];
    const first = await run(0);
    expect(first).toMatchObject({ considered: 40, synced: 0, skipped: 40 });
    // every skipped connection got its next turn in 6 h
    expect(db.rows.filter((r) => r.id !== "paid").every((r) => Date.parse(r.next_sync_at as string) === NOW + CRON_PLAN_RECHECK_MS)).toBe(true);
    const second = await run(30);
    expect(second.synced).toBe(1);
    expect(synced).toEqual(["paid"]);
    // and the paying trader keeps their turn every run
    await run(60);
    await run(90);
    expect(synced).toEqual(["paid", "paid", "paid"]);
  });

  it("failing connections back off (20 min · 2^(n−1), ≤ 12 h) and give their place to healthy ones", async () => {
    db.rows = [conn("broken", "payer1", 48 * H), conn("ok", "payer2", 47 * H)];
    failing.add("broken");
    expect(await run(0)).toMatchObject({ synced: 1, failed: 1 });
    const broken = db.rows.find((r) => r.id === "broken")!;
    expect(broken).toMatchObject({ sync_failures: 1, next_sync_at: new Date(NOW + CRON_MIN_GAP_MS).toISOString() });
    await run(30);
    expect(broken).toMatchObject({ sync_failures: 2, next_sync_at: new Date(NOW + 30 * 60_000 + 40 * 60_000).toISOString() });
    // not due at the next run (40 min back-off), the healthy one is synced again
    expect(await run(60)).toMatchObject({ synced: 1, failed: 0 });
    expect(broken.sync_failures).toBe(2);
    // recovers: the failure count resets
    failing.clear();
    await run(120);
    expect(broken).toMatchObject({ sync_failures: 0 });
    expect(synced.filter((x) => x === "broken")).toHaveLength(1);
  });

  it("back-off curve", () => {
    expect([1, 2, 3, 4].map(backoffMs)).toEqual([20, 40, 80, 160].map((m) => m * 60_000));
    expect(backoffMs(50)).toBe(CRON_MAX_BACKOFF_MS);
  });

  it("a connection synced by hand in between waits for its 20-minute gap, then comes back", async () => {
    db.rows = [conn("a", "payer", 5 * 60_000)];
    expect(await run(0)).toMatchObject({ synced: 0, skipped: 1 });
    expect(db.rows[0]!.next_sync_at).toBe(new Date(NOW + 15 * 60_000).toISOString());
    expect(await run(30)).toMatchObject({ synced: 1 });
  });

  it("without migration 0006 the cron still runs (old order by last_sync_at)", async () => {
    db.hasSchedule = false;
    db.rows = [conn("a", "payer", 2 * H)];
    expect(await run(0)).toMatchObject({ considered: 1, synced: 1 });
  });
});
