// @vitest-environment node
/// <reference types="node" />
/**
 * P09 account functions (`netlify/functions/account-*.mts`, `log.mts`, `audit.mts`, `backup-nightly.mts`) against an
 * in-memory fake of the Supabase admin client (tables, RPCs, storage, auth admin) and a fake Stripe.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { setSupabaseAdminForTests } from "../../netlify/functions/_lib/supabase";
import { setStripeForTests, type StripeLike } from "../../netlify/functions/_lib/billingCleanup";
import { expiredBackups, runNightlyBackup, type BackupFile } from "../../netlify/functions/_lib/account";
import accountExport from "../../netlify/functions/account-export.mts";
import accountDelete from "../../netlify/functions/account-delete.mts";
import accountBackups from "../../netlify/functions/account-backups.mts";
import logFn from "../../netlify/functions/log.mts";
import auditFn from "../../netlify/functions/audit.mts";
import backupNightly from "../../netlify/functions/backup-nightly.mts";

const ctx = { ip: "203.0.113.9" } as Parameters<typeof accountExport>[1];
const JWT = "eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJ1MSJ9.c2ln";
const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";

type Row = Record<string, unknown>;
interface Obj {
  name: string;
  body: string;
}

interface FakeState {
  tables: Record<string, Row[] | undefined>;
  storage: Record<string, Obj[] | undefined>;
  claims: Record<string, unknown> | null;
  factors: { status: string }[];
  rate: number;
  deleted: string[];
  failDelete?: boolean;
}

/** Minimal chainable PostgREST fake: eq / lt / order / range / limit / select / insert / delete / maybeSingle. */
function table(state: FakeState, name: string) {
  const filters: ((r: Row) => boolean)[] = [];
  let order: { col: string; asc: boolean }[] = [];
  let range: [number, number] | null = null;
  let limit: number | null = null;
  let op: "select" | "delete" = "select";
  const missing = () => state.tables[name] === undefined;
  const run = () => {
    if (missing()) return { data: null, error: { code: "PGRST205", message: "missing" } };
    const all = state.tables[name]!;
    if (op === "delete") {
      const keep = all.filter((r) => !filters.every((f) => f(r)));
      state.tables[name] = keep;
      return { data: null, error: null };
    }
    let rows = all.filter((r) => filters.every((f) => f(r)));
    for (const o of [...order].reverse()) rows = [...rows].sort((a, b) => (String(a[o.col]) < String(b[o.col]) ? -1 : String(a[o.col]) > String(b[o.col]) ? 1 : 0) * (o.asc ? 1 : -1));
    if (range) rows = rows.slice(range[0], range[1] + 1);
    if (limit !== null) rows = rows.slice(0, limit);
    return { data: rows, error: null };
  };
  const q = {
    select: () => q,
    eq: (col: string, v: unknown) => (filters.push((r) => r[col] === v), q),
    lt: (col: string, v: unknown) => (filters.push((r) => (r[col] as never) < (v as never)), q),
    order: (col: string, o?: { ascending?: boolean }) => (order.push({ col, asc: o?.ascending !== false }), q),
    range: (a: number, b: number) => ((range = [a, b]), q),
    limit: (n: number) => ((limit = n), q),
    delete: () => ((op = "delete"), q),
    insert: async (row: Row) => {
      if (missing()) return { error: { code: "PGRST205" } };
      state.tables[name]!.push(row);
      return { error: null };
    },
    maybeSingle: async () => {
      const r = run();
      return { data: (r.data as Row[] | null)?.[0] ?? null, error: r.error };
    },
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
  };
  order = [];
  return q;
}

function fakeAdmin(state: FakeState) {
  const bucket = (b: string) => ({
    list: async (prefix: string, o: { limit?: number; offset?: number } = {}) => {
      const objs = state.storage[b];
      if (!objs) return { data: null, error: { message: "Bucket not found", statusCode: "404" } };
      const names = new Map<string, boolean>();
      for (const obj of objs) {
        if (!obj.name.startsWith(`${prefix}/`)) continue;
        const rest = obj.name.slice(prefix.length + 1);
        const [head, ...tail] = rest.split("/");
        names.set(head!, tail.length === 0);
      }
      const entries = [...names].sort().map(([name, file]) => ({ name, id: file ? `id-${name}` : null, metadata: file ? { size: 10 } : null }));
      return { data: entries.slice(o.offset ?? 0, (o.offset ?? 0) + (o.limit ?? 100)), error: null };
    },
    remove: async (paths: string[]) => {
      state.storage[b] = (state.storage[b] ?? []).filter((o) => !paths.includes(o.name));
      return { data: paths, error: null };
    },
    upload: async (path: string, body: Blob) => {
      const list = (state.storage[b] ??= []);
      const text = await body.text();
      const i = list.findIndex((o) => o.name === path);
      if (i >= 0) list[i] = { name: path, body: text };
      else list.push({ name: path, body: text });
      return { data: { path }, error: null };
    },
    download: async (path: string) => {
      const o = state.storage[b]?.find((x) => x.name === path);
      return o ? { data: new Blob([o.body]), error: null } : { data: null, error: { message: "not found" } };
    },
  });
  const client = {
    auth: {
      getClaims: vi.fn(async () => (state.claims ? { data: { claims: state.claims }, error: null } : { data: null, error: { message: "bad" } })),
      admin: {
        mfa: { listFactors: vi.fn(async () => ({ data: { factors: state.factors }, error: null })) },
        getUserById: vi.fn(async (id: string) => ({ data: { user: { id, email: "a@b.de", created_at: "2026-01-01T00:00:00Z", last_sign_in_at: null, factors: [] } }, error: null })),
        deleteUser: vi.fn(async (id: string) => {
          if (state.failDelete) return { data: null, error: { status: 500 } };
          state.deleted.push(id);
          for (const k of ["journal_docs", "profiles"]) state.tables[k] = state.tables[k]?.filter((r) => r.user_id !== id && r.id !== id);
          return { data: {}, error: null };
        }),
      },
    },
    rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
      if (fn === "rate_hit") return { data: state.rate, error: null };
      if (fn === "backup_candidates") {
        const ids = [...new Set((state.tables.journal_docs ?? []).filter((r) => String(r.updated_at) >= String(args.p_since)).map((r) => r.user_id as string))].sort();
        return { data: ids.filter((id) => !args.p_after || id > String(args.p_after)).map((user_id) => ({ user_id })), error: null };
      }
      return { data: null, error: { code: "42883" } };
    }),
    from: (name: string) => table(state, name),
    storage: {
      from: bucket,
      getBucket: async (b: string) => (state.storage[b] ? { data: { id: b }, error: null } : { data: null, error: { message: "not found" } }),
      createBucket: async (b: string) => ((state.storage[b] = []), { data: { name: b }, error: null }),
    },
  };
  setSupabaseAdminForTests(client as unknown as SupabaseClient);
  return client;
}

function baseState(): FakeState {
  return {
    tables: {
      journal_docs: [
        { user_id: U1, kind: "trade", id: "t_1", data: { id: "t_1", pair: "BTCUSDT", pnl: 120 }, deleted: false, rev: 1, updated_at: "2026-10-11T10:00:00Z" },
        { user_id: U1, kind: "trade", id: "t_2", data: { deletedAt: "x" }, deleted: true, rev: 2, updated_at: "2026-10-11T10:00:00Z" },
        { user_id: U1, kind: "settings", id: "settings", data: { currency: "USDT" }, deleted: false, rev: 3, updated_at: "2026-10-11T10:00:00Z" },
        { user_id: U1, kind: "day", id: "2026-10-10", data: { note: "ruhig" }, deleted: false, rev: 1, updated_at: "2026-10-11T10:00:00Z" },
        { user_id: U2, kind: "trade", id: "t_9", data: { id: "t_9" }, deleted: false, rev: 1, updated_at: "2026-10-01T10:00:00Z" },
      ],
      profiles: [{ id: U1, plan: "free", plan_status: "none", trial_end: null, privacy: {} }],
      audit_log: [],
      app_errors: [{ id: 1, at: "2026-08-01T00:00:00Z", user_id: null, message: "old" }],
      exchange_connections: [{ id: "c1", user_id: U1, exchange: "bitunix", api_key_enc: "v1:secret" }],
    },
    storage: { screenshots: [{ name: `${U1}/t_1/a.png`, body: "png" }, { name: `${U2}/b.png`, body: "png" }], backups: [{ name: `${U1}/2026-10-01.json`, body: '{"trades":[]}' }] },
    claims: { sub: U1, role: "authenticated", email: "a@b.de", aal: "aal1", session_id: "s1" },
    factors: [],
    rate: 1,
    deleted: [],
  };
}

const get = (path: string, token = JWT) => new Request(`https://x.test${path}`, { headers: { authorization: `Bearer ${token}` } });
const post = (path: string, body: unknown, headers: Record<string, string> = { authorization: `Bearer ${JWT}` }) =>
  new Request(`https://x.test${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

let state: FakeState;
beforeEach(() => {
  state = baseState();
  fakeAdmin(state);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  setSupabaseAdminForTests(null);
  setStripeForTests(null);
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("account-export", () => {
  it("returns the whole account as a download – journal in backup format, secrets redacted, other users excluded", async () => {
    const r = await accountExport(get("/api/v1/account/export"), ctx);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-disposition")).toMatch(/attachment; filename="trade-journal-konto-\d{4}-\d{2}-\d{2}\.json"/);
    const body = await r.json();
    expect(body.format).toBe("trade-journal-account-export");
    expect(body.journal.trades).toEqual([{ id: "t_1", pair: "BTCUSDT", pnl: 120 }]);
    expect(body.journal.settings).toEqual({ currency: "USDT" });
    expect(body.journal.days).toEqual({ "2026-10-10": { note: "ruhig" } });
    expect(body.journal.counts).toMatchObject({ trades: 1, tombstones: 1 });
    expect(JSON.stringify(body)).not.toContain("t_9");
    expect(JSON.stringify(body)).not.toContain("v1:secret");
    expect(body.files.screenshots).toEqual([`${U1}/t_1/a.png`]);
    // tables of later migrations are simply skipped
    expect(body.tables.subscriptions).toBeUndefined();
    expect(state.tables.audit_log!.at(-1)).toMatchObject({ user_id: U1, action: "account.export" });
  });

  it("needs a session, aal2 once 2FA is on, and rate-limits", async () => {
    expect((await accountExport(new Request("https://x.test/api/v1/account/export"), ctx)).status).toBe(401);
    state.factors = [{ status: "verified" }];
    const r = await accountExport(get("/api/v1/account/export"), ctx);
    expect(r.status).toBe(403);
    expect((await r.json()).error.code).toBe("mfa_required");
    state.factors = [];
    state.rate = 6;
    expect((await accountExport(get("/api/v1/account/export"), ctx)).status).toBe(429);
  });
});

describe("account-delete", () => {
  it("asks for the confirm word, then deletes files and the auth user (cascade)", async () => {
    const bad = await accountDelete(post("/api/v1/account/delete", { confirm: "ja" }), ctx);
    expect(bad.status).toBe(422);
    expect(state.deleted).toEqual([]);
    const r = await accountDelete(post("/api/v1/account/delete", { confirm: "löschen" }), ctx);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ deleted: true, files: { screenshots: 1, backups: 1 } });
    expect(state.deleted).toEqual([U1]);
    expect(state.storage.screenshots!.map((o) => o.name)).toEqual([`${U2}/b.png`]);
    expect(state.tables.journal_docs!.every((r) => r.user_id === U2)).toBe(true);
    expect(state.tables.audit_log!.map((a) => (a.meta as { step: string }).step)).toEqual(["start", "done"]);
  });

  it("never deletes while a subscription runs and Stripe is not configured", async () => {
    state.tables.profiles![0]!.plan = "pro";
    state.tables.profiles![0]!.plan_status = "active";
    const r = await accountDelete(post("/api/v1/account/delete", { confirm: "LÖSCHEN" }), ctx);
    expect(r.status).toBe(409);
    expect((await r.json()).error.code).toBe("subscription_active");
    expect(state.deleted).toEqual([]);
    expect(state.storage.screenshots).toHaveLength(2);
  });

  it("cancels open subscriptions through Stripe first; a Stripe failure aborts everything", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_x");
    state.tables.profiles![0]!.plan_status = "trialing";
    const cancel = vi.fn(async (id: string) => ({ id, status: "canceled" }));
    const stripe: StripeLike = {
      customers: { search: vi.fn(async () => ({ data: [{ id: "cus_1" }] })) },
      subscriptions: { list: vi.fn(async () => ({ data: [{ id: "sub_1", status: "trialing" }, { id: "sub_0", status: "canceled" }] })), cancel },
    };
    setStripeForTests(async () => stripe);
    const r = await accountDelete(post("/api/v1/account/delete", { confirm: "LÖSCHEN" }), ctx);
    expect(r.status).toBe(200);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(cancel.mock.calls[0]![0]).toBe("sub_1");
    expect(stripe.customers.search).toHaveBeenCalledWith({ query: `metadata['supabase_user_id']:'${U1}'`, limit: 10 });

    state = baseState();
    fakeAdmin(state);
    setStripeForTests(async () => ({ ...stripe, subscriptions: { ...stripe.subscriptions, list: async () => Promise.reject(new Error("stripe down")) } }));
    const r2 = await accountDelete(post("/api/v1/account/delete", { confirm: "LÖSCHEN" }), ctx);
    expect(r2.status).toBe(502);
    expect(state.deleted).toEqual([]);
  });

  it("fails closed on the rate limiter and reports a failed deleteUser", async () => {
    state.rate = 4;
    expect((await accountDelete(post("/api/v1/account/delete", { confirm: "LÖSCHEN" }), ctx)).status).toBe(429);
    state.rate = 1;
    state.failDelete = true;
    const r = await accountDelete(post("/api/v1/account/delete", { confirm: "LÖSCHEN" }), ctx);
    expect(r.status).toBe(502);
    expect((await r.json()).error.code).toBe("delete_failed");
  });
});

describe("log", () => {
  it("stores a scrubbed report (no e-mail, token, numbers, query) without login", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.1);
    const r = await logFn(
      post(
        "/api/v1/log",
        {
          message: "Trade 85912.5 for max@example.com failed, token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.abcdefghijk",
          stack: "Error: x\n    at save (https://journal.test/assets/index-Bx9.js:12:3456)",
          url: "https://journal.test/#trades?q=secret+note",
          edition: "personal",
          source: "window",
          extra: { page: "trades", note: "private", count: 3 },
        },
        { "user-agent": "Mozilla/5.0" },
      ),
      ctx,
    );
    expect(r.status).toBe(202);
    expect(await r.json()).toEqual({ stored: true });
    const row = state.tables.app_errors!.at(-1)!;
    expect(row.message).toBe("Trade [n] for [email] failed, token [token]");
    expect(row.stack).toContain(":12:3456");
    expect(row.url).toBe("https://journal.test/");
    expect(row.user_id).toBeNull();
    expect(row.meta).toEqual({ source: "window", extra: { page: "trades" } });
  });

  it("samples by LOG_SAMPLE_RATE and keeps the user of a valid session", async () => {
    vi.stubEnv("LOG_SAMPLE_RATE", "0.2");
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const skipped = await logFn(post("/api/v1/log", { message: "x" }, {}), ctx);
    expect(await skipped.json()).toEqual({ stored: false, sampled: true });
    vi.spyOn(Math, "random").mockReturnValue(0.1);
    await logFn(post("/api/v1/log", { message: "y" }), ctx);
    expect(state.tables.app_errors!.at(-1)).toMatchObject({ message: "y", user_id: U1 });
  });

  it("an expired session still logs anonymously; bad bodies are refused", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    state.claims = null;
    expect((await logFn(post("/api/v1/log", { message: "z" }), ctx)).status).toBe(202);
    expect(state.tables.app_errors!.at(-1)).toMatchObject({ message: "z", user_id: null });
    expect((await logFn(post("/api/v1/log", { nope: 1 }), ctx)).status).toBe(422);
  });
});

describe("audit", () => {
  it("records allowed client events and lists the own trail newest first", async () => {
    expect((await auditFn(post("/api/v1/audit", { action: "auth.mfa.enroll" }), ctx)).status).toBe(201);
    expect((await auditFn(post("/api/v1/audit", { action: "account.delete" }), ctx)).status).toBe(422);
    state.tables.audit_log = [
      { id: 1, user_id: U1, action: "auth.signin", meta: {}, at: "a" },
      { id: 2, user_id: U2, action: "auth.signin", meta: {}, at: "b" },
      { id: 3, user_id: U1, action: "auth.mfa.enroll", meta: {}, at: "c" },
    ];
    const r = await auditFn(get("/api/v1/audit?limit=1"), ctx);
    const body = await r.json();
    expect(body.items.map((i: Row) => i.id)).toEqual([3]);
    expect(body.next).toBe(3);
    const r2 = await auditFn(get(`/api/v1/audit?limit=5&before=3`), ctx);
    expect((await r2.json()).items.map((i: Row) => i.id)).toEqual([1]);
  });
});

describe("backups", () => {
  it("nightly: backs up changed journals, keeps 14 days (never the newest), purges old error logs", async () => {
    state.storage.backups = [
      { name: `${U1}/2026-09-01.json`, body: "{}" },
      { name: `${U1}/2026-10-05.json`, body: "{}" },
      { name: `${U2}/2026-08-01.json`, body: "{}" },
    ];
    const res = await runNightlyBackup({ now: new Date("2026-10-12T02:00:00Z"), sinceMs: 2 * 86_400_000 });
    expect(res).toMatchObject({ users: 1, uploaded: 1, removed: 1, failed: 0, deferred: false, purgedErrors: true });
    const names = state.storage.backups.map((o) => o.name).sort();
    expect(names).toEqual([`${U1}/2026-10-05.json`, `${U1}/2026-10-12.json`, `${U2}/2026-08-01.json`]);
    const saved = JSON.parse(state.storage.backups.find((o) => o.name.endsWith("2026-10-12.json"))!.body);
    expect(saved.trades).toEqual([{ id: "t_1", pair: "BTCUSDT", pnl: 120 }]);
    expect(saved.counts).toBeUndefined();
    expect(state.tables.app_errors).toEqual([]);
  });

  it("nightly: creates the bucket and defers when the time budget is used up", async () => {
    state.storage.backups = undefined;
    let t = 0;
    const res = await runNightlyBackup({ now: new Date("2026-10-12T02:00:00Z"), sinceMs: 30 * 86_400_000, budgetMs: 5, clock: () => (t += 10) });
    expect(state.storage.backups).toEqual([]);
    expect(res.deferred).toBe(true);
    expect(res.uploaded).toBe(0);
  });

  it("the scheduled handler answers with the run summary", async () => {
    const r = await backupNightly();
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ failed: 0 });
  });

  it("expiredBackups keeps the newest even when it is old", () => {
    const f = (day: string): BackupFile => ({ day, path: `u/${day}.json`, size: 1 });
    expect(expiredBackups([f("2026-01-01"), f("2026-01-02")], new Date("2026-10-12T00:00:00Z")).map((x) => x.day)).toEqual(["2026-01-01"]);
  });

  it("lists and downloads the own cloud backups", async () => {
    const list = await accountBackups(get("/api/v1/account/backups"), ctx);
    expect(await list.json()).toEqual({ items: [{ day: "2026-10-01", size: 10 }] });
    const one = await accountBackups(get("/api/v1/account/backups?day=2026-10-01"), ctx);
    expect(await one.json()).toEqual({ trades: [] });
    expect((await accountBackups(get("/api/v1/account/backups?day=2026-01-01"), ctx)).status).toBe(404);
    expect((await accountBackups(get("/api/v1/account/backups?day=../x"), ctx)).status).toBe(400);
  });
});
