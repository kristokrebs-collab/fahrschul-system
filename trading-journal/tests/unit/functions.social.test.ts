// @vitest-environment node
/// <reference types="node" />
/**
 * P12 community functions (`netlify/functions/social-*.mts`, `feedback.mts`, `_lib/social/*`) against an in-memory
 * Supabase admin fake that speaks enough PostgREST for them (filters incl. JSON paths, projections with aliases,
 * counts, returning selects, unique keys, the 0004 cascades and RPCs `rate_hit`, `shared_payload`,
 * `social_candidates`). Relative imports only (the functions know no `@/` alias). The SQL itself (RLS, checks,
 * cascades) is checked on PGlite – see supabase/README.md.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { setSupabaseAdminForTests } from "../../netlify/functions/_lib/supabase";
import { EXPORT_TABLES } from "../../netlify/functions/_lib/account";
import { runSocialAggregate } from "../../netlify/functions/_lib/social/aggregate";
import { mentionsIn } from "../../netlify/functions/_lib/social/groups";
import { setPseudonymBytesForTests } from "../../netlify/functions/_lib/social/store";
import shareFn from "../../netlify/functions/social-share.mts";
import sharedFn from "../../netlify/functions/social-shared.mts";
import groupsFn from "../../netlify/functions/social-groups.mts";
import boardFn from "../../netlify/functions/social-leaderboard.mts";
import feedbackFn from "../../netlify/functions/feedback.mts";
import aggregateFn, { config as aggregateConfig } from "../../netlify/functions/social-aggregate.mts";
import type { FeedResponse, GroupsResponse, LeaderboardResponse, SharedProof, SharedTrade } from "../../src/social/contract";

const ctx = { ip: "203.0.113.9" } as Parameters<typeof shareFn>[1];
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const D = "44444444-4444-4444-8444-444444444444";

/* ------------------------------------------------------------------ Supabase fake */

type Row = Record<string, unknown>;
interface Db {
  tables: Record<string, Row[]>;
  seq: number;
  rate: Map<string, number>;
  rateMax: number | null;
}

const UNIQUE: Record<string, { keys: string[]; when?: (r: Row) => boolean }[]> = {
  profiles: [{ keys: ["id"] }],
  social_profiles: [{ keys: ["user_id"] }, { keys: ["pseudonym"] }],
  groups: [{ keys: ["id"] }],
  group_members: [{ keys: ["group_id", "user_id"] }],
  group_invites: [{ keys: ["code"] }],
  shares: [{ keys: ["token"] }],
  team_seats: [{ keys: ["member_id"] }],
  member_stats: [{ keys: ["user_id"] }],
  leaderboard_snapshots: [{ keys: ["day", "metric", "user_id"] }],
  community_stats: [{ keys: ["day", "metric"] }],
  feedback: [{ keys: ["user_id", "target_type", "target_id"], when: (r) => r.kind === "report" }],
};

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const iso = () => new Date().toISOString();

function defaults(db: Db, table: string, row: Row): Row {
  const r = { ...row };
  const id = () => (r.id ??= uuid(++db.seq));
  switch (table) {
    case "groups":
      id();
      r.description ??= "";
      r.kind ??= "group";
      r.created_at ??= new Date(Date.now() + ++db.seq).toISOString();
      break;
    case "group_members":
      r.role ??= "member";
      r.share_level ??= "none";
      r.joined_at ??= new Date(Date.now() + ++db.seq).toISOString();
      break;
    case "group_invites":
      r.uses ??= 0;
      r.max_uses ??= 25;
      r.expires_at ??= new Date(Date.now() + 14 * 86_400_000).toISOString();
      r.created_at ??= iso();
      break;
    case "group_reviews":
      id();
      r.status ??= "open";
      r.question ??= "";
      r.reviewed_by ??= null;
      r.created_at ??= new Date(Date.now() + ++db.seq).toISOString();
      break;
    case "comments":
      id();
      r.mentions ??= [];
      r.hidden ??= false;
      r.created_at ??= new Date(Date.now() + ++db.seq).toISOString();
      break;
    case "group_goals":
      id();
      r.status ??= "open";
      r.created_at ??= iso();
      break;
    case "shares":
      id();
      r.views ??= 0;
      r.revoked_at ??= null;
      r.expires_at ??= null;
      r.created_at ??= new Date(Date.now() + ++db.seq).toISOString();
      break;
    case "feedback":
      r.id ??= ++db.seq;
      r.status ??= "new";
      r.created_at ??= iso();
      break;
    case "audit_log":
      r.id ??= ++db.seq;
      break;
  }
  return r;
}

/** `data->r` (json) / `data->>date` (text) / a plain column. */
function read(row: Row, expr: string): unknown {
  const m = /^(\w+)(->>?)(\w+)$/.exec(expr);
  if (!m) return row[expr];
  const v = (row[m[1]!] as Row | undefined)?.[m[3]!];
  return m[2] === "->>" ? (v == null ? null : typeof v === "string" ? v : JSON.stringify(v)) : (v ?? null);
}

function project(row: Row, cols: string): Row {
  if (cols.trim() === "*" || !cols.trim()) return { ...row };
  const out: Row = {};
  for (const part of cols.split(",").map((s) => s.trim()).filter(Boolean)) {
    const [alias, expr] = part.includes(":") ? (part.split(":") as [string, string]) : [part, part];
    out[alias] = read(row, expr);
  }
  return out;
}

function cascade(db: Db, table: string, gone: Row[]): void {
  if (table === "groups") {
    const ids = new Set(gone.map((g) => g.id));
    for (const t of ["group_members", "group_invites", "group_goals"]) db.tables[t] = (db.tables[t] ?? []).filter((r) => !ids.has(r.group_id));
    const reviews = (db.tables.group_reviews ?? []).filter((r) => ids.has(r.group_id));
    db.tables.group_reviews = (db.tables.group_reviews ?? []).filter((r) => !ids.has(r.group_id));
    cascade(db, "group_reviews", reviews);
  }
  if (table === "group_reviews") {
    const ids = new Set(gone.map((r) => r.id));
    db.tables.comments = (db.tables.comments ?? []).filter((c) => !ids.has(c.review_id));
  }
}

function query(db: Db, table: string) {
  const filters: ((r: Row) => boolean)[] = [];
  let op: "select" | "insert" | "upsert" | "update" | "delete" = "select";
  let payload: Row | Row[] = {};
  let onConflict: string | undefined;
  let cols = "*";
  let returning: string | null = null;
  let orders: { col: string; asc: boolean }[] = [];
  let limitN: number | null = null;
  let rangeFrom = 0;
  let rangeTo: number | null = null;
  let single: "maybe" | "one" | null = null;
  let head = false;
  let count = false;
  const cmp = (a: unknown, b: unknown) => (String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0);
  const clash = (rows: Row[], row: Row, ignore?: Row) =>
    (UNIQUE[table] ?? []).some((u) => (!u.when || u.when(row)) && u.keys.every((k) => row[k] != null) && rows.some((r) => r !== ignore && (!u.when || u.when(r)) && u.keys.every((k) => r[k] === row[k])));

  const exec = async (): Promise<{ data: unknown; error: { code: string } | null; count?: number }> => {
    const rows = db.tables[table];
    if (!rows) return { data: null, error: { code: "PGRST205" } };
    let affected: Row[] = [];
    if (op === "insert" || op === "upsert") {
      for (const raw of Array.isArray(payload) ? payload : [payload]) {
        const row = defaults(db, table, raw);
        if (table === "community_stats" && Number(row.n) < 10) return { data: null, error: { code: "23514" } };
        if (op === "upsert" && onConflict) {
          const keys = onConflict.split(",");
          const hit = rows.find((r) => keys.every((k) => r[k] === row[k]));
          if (hit) {
            Object.assign(hit, raw);
            affected.push(hit);
            continue;
          }
        }
        if (clash(rows, row)) return { data: null, error: { code: "23505" } };
        rows.push(row);
        affected.push(row);
      }
    } else {
      const hits = rows.filter((r) => filters.every((f) => f(r)));
      if (op === "update") {
        for (const r of hits) {
          const next = { ...r, ...(payload as Row) };
          if (clash(rows, next, r)) return { data: null, error: { code: "23505" } };
        }
        for (const r of hits) Object.assign(r, payload);
        affected = hits;
      } else if (op === "delete") {
        db.tables[table] = rows.filter((r) => !hits.includes(r));
        cascade(db, table, hits);
        affected = hits;
      } else {
        let out = [...hits];
        for (const o of [...orders].reverse()) out.sort((a, b) => cmp(read(a, o.col), read(b, o.col)) * (o.asc ? 1 : -1));
        const total = out.length;
        out = out.slice(rangeFrom, rangeTo == null ? undefined : rangeTo + 1);
        if (limitN != null) out = out.slice(0, limitN);
        if (head) return { data: null, error: null, count: total };
        const data = out.map((r) => project(r, cols));
        if (single) {
          if (single === "one" && data.length !== 1) return { data: null, error: { code: "PGRST116" } };
          return { data: data[0] ?? null, error: null, ...(count ? { count: total } : {}) };
        }
        return { data, error: null, ...(count ? { count: total } : {}) };
      }
    }
    if (returning == null) return { data: null, error: null };
    const data = affected.map((r) => project(r, returning!));
    if (single) return single === "one" && data.length !== 1 ? { data: null, error: { code: "PGRST116" } } : { data: data[0] ?? null, error: null };
    return { data, error: null };
  };
  const q = {
    select: (c?: string, o?: { head?: boolean; count?: string }) => {
      if (op === "select") {
        cols = c ?? "*";
        head = !!o?.head;
        count = !!o?.count;
      } else returning = c ?? "*";
      return q;
    },
    eq: (c: string, v: unknown) => (filters.push((r) => read(r, c) === v), q),
    neq: (c: string, v: unknown) => (filters.push((r) => read(r, c) !== v), q),
    in: (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(read(r, c))), q),
    is: (c: string, v: unknown) => (filters.push((r) => (read(r, c) ?? null) === v), q),
    gte: (c: string, v: unknown) => (filters.push((r) => read(r, c) != null && cmp(read(r, c), v) >= 0), q),
    gt: (c: string, v: unknown) => (filters.push((r) => read(r, c) != null && cmp(read(r, c), v) > 0), q),
    lt: (c: string, v: unknown) => (filters.push((r) => read(r, c) != null && cmp(read(r, c), v) < 0), q),
    lte: (c: string, v: unknown) => (filters.push((r) => read(r, c) != null && cmp(read(r, c), v) <= 0), q),
    order: (col: string, o?: { ascending?: boolean }) => ((orders = [...orders, { col, asc: o?.ascending !== false }]), q),
    limit: (n: number) => ((limitN = n), q),
    range: (a: number, b: number) => ((rangeFrom = a), (rangeTo = b), q),
    maybeSingle: () => ((single = "maybe"), exec()),
    single: () => ((single = "one"), exec()),
    insert: (row: Row | Row[]) => ((op = "insert"), (payload = row), q),
    upsert: (row: Row | Row[], o: { onConflict?: string } = {}) => ((op = "upsert"), (payload = row), (onConflict = o.onConflict), q),
    update: (patch: Row) => ((op = "update"), (payload = patch), q),
    delete: () => ((op = "delete"), q),
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => exec().then(res, rej),
  };
  return q;
}

const b64url = (s: string) => Buffer.from(s).toString("base64url");
const tokenFor = (sub: string) => `eyJhbGciOiJFUzI1NiJ9.${b64url(JSON.stringify({ sub }))}.c2ln`;

function fakeDb(): Db {
  const db: Db = {
    tables: {
      profiles: [A, B, C, D].map((id) => ({ id, plan: "free", plan_status: "none", trial_end: null, privacy: {} })),
      journal_docs: [],
      subscriptions: [],
      team_seats: [],
      audit_log: [],
      social_profiles: [],
      groups: [],
      group_members: [],
      group_invites: [],
      group_reviews: [],
      comments: [],
      group_goals: [],
      shares: [],
      feedback: [],
      member_stats: [],
      leaderboard_snapshots: [],
      community_stats: [],
    },
    seq: 0,
    rate: new Map(),
    rateMax: null,
  };
  const client = {
    from: (t: string) => query(db, t),
    rpc: async (fn: string, args: Record<string, unknown>) => {
      if (fn === "rate_hit") {
        const k = String(args.p_key);
        const n = (db.rate.get(k) ?? 0) + 1;
        db.rate.set(k, n);
        return { data: db.rateMax == null ? 1 : n, error: null };
      }
      if (fn === "shared_payload") {
        const s = db.tables.shares!.find((r) => r.token === args.p_token && r.revoked_at == null && (r.expires_at == null || Date.parse(String(r.expires_at)) > Date.now()));
        if (!s) return { data: [], error: null };
        s.views = Number(s.views) + 1;
        return { data: [{ kind: s.kind, payload: s.payload, created_at: s.created_at, expires_at: s.expires_at, views: s.views }], error: null };
      }
      if (fn === "social_candidates") {
        const map = new Map<string, boolean>();
        for (const p of db.tables.profiles!) if ((p.privacy as Row | undefined)?.leaderboard === true) map.set(String(p.id), true);
        for (const m of db.tables.group_members!) if (m.share_level === "stats" && !map.has(String(m.user_id))) map.set(String(m.user_id), false);
        const after = args.p_after as string | null;
        const rows = [...map.entries()]
          .filter(([id]) => !after || id > after)
          .sort(([a], [b]) => (a < b ? -1 : 1))
          .slice(0, Number(args.p_limit ?? 500))
          .map(([user_id, leaderboard]) => ({ user_id, leaderboard }));
        return { data: rows, error: null };
      }
      return { data: null, error: { code: "PGRST202" } };
    },
    auth: {
      getClaims: async (jwt: string) => {
        try {
          const claims = JSON.parse(Buffer.from(jwt.split(".")[1]!, "base64url").toString()) as { sub: string };
          return { data: { claims: { ...claims, role: "authenticated", aal: "aal1" } }, error: null };
        } catch {
          return { data: null, error: { message: "bad" } };
        }
      },
      admin: { mfa: { listFactors: async () => ({ data: { factors: [] }, error: null }) } },
    },
  };
  setSupabaseAdminForTests(client as unknown as SupabaseClient);
  return db;
}

/* ------------------------------------------------------------------ request helpers */

type Fn = (req: Request, c: typeof ctx) => Promise<Response>;

async function call<T = Record<string, unknown>>(fn: Fn, method: string, path: string, o: { user?: string; body?: unknown } = {}): Promise<{ status: number; body: T }> {
  const headers = new Headers();
  if (o.user) headers.set("authorization", `Bearer ${tokenFor(o.user)}`);
  if (o.body !== undefined) headers.set("content-type", "application/json");
  const res = await fn(new Request(`https://journal.test${path}`, { method, headers, body: o.body === undefined ? undefined : JSON.stringify(o.body) }), ctx);
  return { status: res.status, body: (await res.json()) as T };
}

const TRADE: SharedTrade = {
  v: 1,
  kind: "trade",
  pair: "BTCUSDT",
  side: "long",
  timeframe: "4h",
  day: "2026-10-01",
  result: "win",
  r: 2.1,
  movePct: 3.4,
  rr: 2.5,
  rating: 4,
  followedPlan: true,
  checklist: { done: 4, total: 5 },
};

let pseudoSeq = 0;
let db: Db;
beforeEach(() => {
  db = fakeDb();
  pseudoSeq = 0;
  // deterministic, distinct pseudonyms
  setPseudonymBytesForTests(() => {
    const n = pseudoSeq++;
    return [n % 20, (n * 7) % 20, 0, n];
  });
});
afterEach(() => {
  setSupabaseAdminForTests(null);
  setPseudonymBytesForTests(null);
});

/** A closed trade in the synced journal (`journal_docs`) n days ago. */
function trade(user: string, id: string, r: number | null, daysAgo: number, extra: Row = {}): void {
  const d = new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 16);
  db.tables.journal_docs!.push({ user_id: user, kind: "trade", id, deleted: false, data: { id, status: "closed", r, date: d, followedPlan: true, mistakes: [], pnl: 999, notes: "geheim", ...extra } });
}

/* ------------------------------------------------------------------ shares */

describe("share links", () => {
  it("creates a redacted link; strangers read it publicly, views count; revoke ends it", async () => {
    const res = await call<{ share: { id: string; token: string; title: string; kind: string } }>(shareFn, "POST", "/api/v1/social/share", { user: A, body: { payload: TRADE, expiresInDays: 7 } });
    expect(res.status).toBe(201);
    expect(res.body.share.token).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(res.body.share.title).toBe("BTCUSDT Long · +2,10R");
    expect(db.tables.audit_log!.some((a) => a.action === "social.share")).toBe(true);

    const pub = await call<{ payload: SharedTrade; views: number }>(sharedFn, "GET", `/api/v1/social/shared/${res.body.share.token}`);
    expect(pub.status).toBe(200);
    expect(pub.body.payload).toEqual(TRADE);
    expect(pub.body.views).toBe(1);
    expect((await call(sharedFn, "GET", `/api/v1/social/shared/${res.body.share.token}`)).body.views).toBe(2);

    const list = await call<{ shares: { id: string; views: number }[] }>(shareFn, "GET", "/api/v1/social/share", { user: A });
    expect(list.body.shares).toHaveLength(1);
    expect((await call<{ shares: unknown[] }>(shareFn, "GET", "/api/v1/social/share", { user: B })).body.shares).toHaveLength(0);

    expect((await call(shareFn, "DELETE", `/api/v1/social/share/${res.body.share.id}`, { user: B })).status).toBe(404);
    expect((await call(shareFn, "DELETE", `/api/v1/social/share/${res.body.share.id}`, { user: A })).status).toBe(200);
    const gone = await call<{ error: { code: string; message: string } }>(sharedFn, "GET", `/api/v1/social/shared/${res.body.share.token}`);
    expect(gone.status).toBe(404);
    expect(gone.body.error.message).toMatch(/abgelaufen oder wurde zurückgezogen/);
  });

  it("refuses anything outside the redacted schema (money, notes) and needs a login", async () => {
    expect((await call(shareFn, "POST", "/api/v1/social/share", { body: { payload: TRADE } })).status).toBe(401);
    const leak = await call(shareFn, "POST", "/api/v1/social/share", { user: A, body: { payload: { ...TRADE, pnl: 420 } } });
    expect(leak.status).toBe(422);
    const notes = await call(shareFn, "POST", "/api/v1/social/share", { user: A, body: { payload: { ...TRADE, notes: "Konto 20k" } } });
    expect(notes.status).toBe(422);
    expect(db.tables.shares).toHaveLength(0);
  });

  it("expired and malformed tokens are 404; a stored row that no longer parses is never served raw", async () => {
    db.tables.shares!.push({ id: uuid(901), token: "E".repeat(22), user_id: A, kind: "trade", payload: TRADE, views: 0, revoked_at: null, expires_at: new Date(Date.now() - 1000).toISOString(), created_at: iso() });
    db.tables.shares!.push({ id: uuid(902), token: "T".repeat(22), user_id: A, kind: "trade", payload: { ...TRADE, pnl: 5 }, views: 0, revoked_at: null, expires_at: null, created_at: iso() });
    expect((await call(sharedFn, "GET", `/api/v1/social/shared/${"E".repeat(22)}`)).status).toBe(404);
    expect((await call(sharedFn, "GET", `/api/v1/social/shared/${"T".repeat(22)}`)).status).toBe(404);
    expect((await call(sharedFn, "GET", "/api/v1/social/shared/kurz")).status).toBe(404);
  });

  describe("Ergebnisbeleg (F57)", () => {
    const PROOF: SharedProof = {
      v: 1,
      kind: "proof",
      strategy: "Breakout 4h",
      basis: "live",
      from: "2026-09-01",
      to: "2026-10-01",
      scope: { only: null, inPeriod: 4, open: 1 },
      trades: [
        ["2026-09-03", 1.5, 0.04, "api"],
        ["2026-09-10", -1, 0.05, "api"],
        ["2026-09-20", -1.2, null, "manual"],
        ["2026-09-28", null, null, "csv"],
      ],
    };
    const post = (payload: unknown) => call<{ share: { id: string; token: string; title: string; kind: string }; error?: { code: string } }>(shareFn, "POST", "/api/v1/social/share", { user: A, body: { payload, expiresInDays: 0 } });

    it("stores the complete list, serves it publicly, and every loss stays in it", async () => {
      const res = await post(PROOF);
      expect(res.status).toBe(201);
      expect(res.body.share).toMatchObject({ kind: "proof", title: "Beleg · Breakout 4h · 4 Trades" });
      const pub = await call<{ kind: string; payload: SharedProof }>(sharedFn, "GET", `/api/v1/social/shared/${res.body.share.token}`);
      expect(pub.status).toBe(200);
      expect(pub.body.payload).toEqual(PROOF);
      expect(pub.body.payload.trades.filter((t) => (t[1] ?? 0) < 0)).toHaveLength(2);
      // the owner revokes: the page is gone at once
      expect((await call(shareFn, "DELETE", `/api/v1/social/share/${res.body.share.id}`, { user: A })).status).toBe(200);
      expect((await call(sharedFn, "GET", `/api/v1/social/shared/${res.body.share.token}`)).status).toBe(404);
    });

    it("refuses anything outside the schema: money, pairs, notes, times", async () => {
      expect((await post({ ...PROOF, pnl: 420 })).status).toBe(422);
      expect((await post({ ...PROOF, scope: { ...PROOF.scope, balance: 20000 } })).status).toBe(422);
      expect((await post({ ...PROOF, trades: [["2026-09-03 10:00", 1, 0, "api"]] })).status).toBe(422); // a time of day
      expect((await post({ ...PROOF, trades: [["2026-09-03", 1, 0, "api", "BTCUSDT"]] })).status).toBe(422); // a fifth field
      expect((await post({ ...PROOF, trades: [["2026-09-03", 1, 0, "binance"]] })).status).toBe(422); // an exchange name
      expect(db.tables.shares).toHaveLength(0);
    });

    it("refuses a list that cannot be a complete period: outside the period, out of order, fewer than the period says, no selection but gaps", async () => {
      expect((await post({ ...PROOF, trades: [...PROOF.trades, ["2026-10-05", 1, 0, "api"]], scope: { only: null, inPeriod: 5, open: 0 } })).status).toBe(422);
      expect((await post({ ...PROOF, trades: [PROOF.trades[1], PROOF.trades[0], PROOF.trades[2], PROOF.trades[3]] })).status).toBe(422);
      expect((await post({ ...PROOF, scope: { only: null, inPeriod: 9, open: 0 } })).status).toBe(422); // "all trades" with 5 missing ones
      expect((await post({ ...PROOF, scope: { only: "Breakout", inPeriod: 3, open: 0 } })).status).toBe(422); // fewer in the period than listed
      expect((await post({ ...PROOF, to: "2025-01-01" })).status).toBe(422);
      expect((await post({ ...PROOF, from: "2024-01-01" })).status).toBe(422); // longer than 400 days
      // a named selection of a bigger period is fine
      expect((await post({ ...PROOF, scope: { only: "Breakout", inPeriod: 9, open: 0 } })).status).toBe(201);
    });

    it("holds up to 500 trades and not one more", async () => {
      const many = (n: number): SharedProof => ({ ...PROOF, scope: { only: null, inPeriod: n, open: 0 }, trades: Array.from({ length: n }, (_, i) => ["2026-09-15", i % 3 ? 1.25 : -1, 0.045, "manual"] as SharedProof["trades"][number]) });
      expect((await post(many(500))).status).toBe(201);
      expect((await post(many(501))).status).toBe(422);
    });
  });

  it("the public read is rate-limited per IP", async () => {
    db.rateMax = 60;
    for (let i = 0; i < 60; i++) await call(sharedFn, "GET", `/api/v1/social/shared/${"x".repeat(22)}`);
    const res = await fetchLimited();
    expect(res).toBe(429);
    async function fetchLimited() {
      return (await call(sharedFn, "GET", `/api/v1/social/shared/${"x".repeat(22)}`)).status;
    }
  });
});

/* ------------------------------------------------------------------ groups, mentoring */

async function createGroup(user: string, kind: "group" | "mentor" | "team", name = "Morgenrunde") {
  const res = await call<{ group: { id: string; role: string } }>(groupsFn, "POST", "/api/v1/social/groups", { user, body: { kind, name } });
  return res;
}
async function invite(user: string, groupId: string, role: string) {
  return call<{ invite: { code: string } }>(groupsFn, "POST", `/api/v1/social/groups/${groupId}/invites`, { user, body: { role } });
}
async function join(user: string, code: string, shareLevel: "none" | "stats" = "none") {
  return call<{ group: { id: string; role: string } }>(groupsFn, "POST", `/api/v1/social/invite/${code}`, { user, body: { shareLevel } });
}
const feedOf = (user: string, id: string) => call<FeedResponse>(groupsFn, "GET", `/api/v1/social/groups/${id}`, { user });

describe("groups", () => {
  it("create → invite → preview → join; members see each other under pseudonyms, strangers get 404", async () => {
    const g = await createGroup(A, "group");
    expect(g.status).toBe(201);
    expect(g.body.group.role).toBe("owner");
    const inv = await invite(A, g.body.group.id, "member");
    expect(inv.status).toBe(201);
    expect(inv.body.invite.code).toMatch(/^[A-Z0-9]{10}$/);
    expect((await invite(A, g.body.group.id, "student")).status).toBe(422);

    const preview = await call<{ groupName: string; members: number; member: boolean }>(groupsFn, "GET", `/api/v1/social/invite/${inv.body.invite.code}`, { user: B });
    expect(preview.body).toMatchObject({ groupName: "Morgenrunde", members: 1, member: false });
    expect((await join(B, inv.body.invite.code)).status).toBe(201);

    const list = await call<GroupsResponse>(groupsFn, "GET", "/api/v1/social/groups", { user: B });
    expect(list.body.groups).toHaveLength(1);
    expect(list.body.groups[0]).toMatchObject({ name: "Morgenrunde", role: "member", members: 2 });
    expect(list.body.me.pseudonym).toMatch(/^\p{L}+ \p{L}+ \d{2,3}$/u);

    const f = await feedOf(B, g.body.group.id);
    expect(f.body.group.memberList.map((m) => m.role).sort()).toEqual(["member", "owner"]);
    expect(JSON.stringify(f.body)).not.toMatch(/@|example/);
    expect(f.body.group.invites).toEqual([]); // members do not see invite codes
    expect((await feedOf(C, g.body.group.id)).status).toBe(404);
    expect((await call(groupsFn, "GET", "/api/v1/social/groups/not-a-uuid", { user: C })).status).toBe(404);
    expect((await call(groupsFn, "GET", "/api/v1/social/invite/WRONGCODE1", { user: C })).status).toBe(404);
  });

  it("mentor group: students see only their own reviews; comments with @mentions; done; goals; leaving removes the posts", async () => {
    const g = await createGroup(A, "mentor", "Mentoring");
    const id = g.body.group.id;
    const code = (await invite(A, id, "student")).body.invite.code;
    await join(B, code);
    await join(C, code);

    const post = await call<{ id: string }>(groupsFn, "POST", `/api/v1/social/groups/${id}/reviews`, { user: B, body: { payload: TRADE, question: "Stop zu eng?" } });
    expect(post.status).toBe(201);
    expect((await call(groupsFn, "POST", `/api/v1/social/groups/${id}/reviews`, { user: B, body: { payload: { ...TRADE, size: 5000 } } })).status).toBe(422);

    const mentorFeed = await feedOf(A, id);
    expect(mentorFeed.body.reviews).toHaveLength(1);
    expect(mentorFeed.body.reviews[0]).toMatchObject({ question: "Stop zu eng?", status: "open", me: false });
    expect(mentorFeed.body.group.openReviews).toBe(1);
    const cFeed = await feedOf(C, id);
    expect(cFeed.body.reviews).toHaveLength(0);
    expect(cFeed.body.group.memberList.map((m) => m.id).sort()).toEqual([A, C].sort()); // other students hidden

    const bName = mentorFeed.body.group.memberList.find((m) => m.id === B)!.pseudonym;
    const com = await call<{ comment: { body: string } }>(groupsFn, "POST", `/api/v1/social/groups/${id}/reviews/${post.body.id}/comments`, { user: A, body: { body: `@${bName} Stop unter das Tief.` } });
    expect(com.status).toBe(201);
    expect(db.tables.comments![0]!.mentions).toEqual([B]);
    // C cannot comment on B's review (not visible) – 404, not 403
    expect((await call(groupsFn, "POST", `/api/v1/social/groups/${id}/reviews/${post.body.id}/comments`, { user: C, body: { body: "hi" } })).status).toBe(404);

    const bFeed = await feedOf(B, id);
    expect(bFeed.body.reviews[0]!.comments[0]).toMatchObject({ mentionsMe: true, me: false });
    expect((await call(groupsFn, "PATCH", `/api/v1/social/groups/${id}/reviews/${post.body.id}`, { user: A, body: { status: "done" } })).status).toBe(200);
    expect((await feedOf(B, id)).body.reviews[0]!.status).toBe("done");

    const goal = await call<{ id: string }>(groupsFn, "POST", `/api/v1/social/groups/${id}/goals`, {
      user: A,
      body: { studentId: B, draft: { title: "Jeden Trade mit Plan", kind: "process", metric: "planAdherence", target: 0.9, comparator: "atLeast", period: "week" } },
    });
    expect(goal.status).toBe(201);
    expect((await call(groupsFn, "POST", `/api/v1/social/groups/${id}/goals`, { user: B, body: { studentId: C, draft: { title: "x y z", kind: "process", metric: "custom", target: 1, comparator: "atLeast", period: "week" } } })).status).toBe(403);
    const bGoals = (await call<GroupsResponse>(groupsFn, "GET", "/api/v1/social/groups", { user: B })).body.goals;
    expect(bGoals).toHaveLength(1);
    expect(bGoals[0]).toMatchObject({ mine: true, status: "open", draft: { title: "Jeden Trade mit Plan" } });
    expect((await call(groupsFn, "PATCH", `/api/v1/social/groups/${id}/goals/${goal.body.id}`, { user: C, body: { status: "accepted" } })).status).toBe(404);
    expect((await call(groupsFn, "PATCH", `/api/v1/social/groups/${id}/goals/${goal.body.id}`, { user: B, body: { status: "accepted" } })).status).toBe(200);

    // B leaves: reviews, comments on them and goals go with the membership
    const left = await call<{ left: boolean }>(groupsFn, "DELETE", `/api/v1/social/groups/${id}/members/${B}`, { user: B });
    expect(left.body.left).toBe(true);
    expect(db.tables.group_reviews!.filter((r) => r.author_id === B)).toHaveLength(0);
    expect(db.tables.group_goals!.filter((r) => r.student_id === B)).toHaveLength(0);
    expect((await feedOf(B, id)).status).toBe(404);
  });

  it("roles: only the owner assigns roles; share level only for yourself; the owner cannot leave", async () => {
    const id = (await createGroup(A, "mentor", "Desk")).body.group.id;
    const code = (await invite(A, id, "student")).body.invite.code;
    await join(B, code);
    expect((await call(groupsFn, "PATCH", `/api/v1/social/groups/${id}/members/${B}`, { user: A, body: { shareLevel: "stats" } })).status).toBe(403);
    expect((await call(groupsFn, "PATCH", `/api/v1/social/groups/${id}/members/${B}`, { user: B, body: { shareLevel: "stats" } })).status).toBe(200);
    expect((await call(groupsFn, "PATCH", `/api/v1/social/groups/${id}/members/${B}`, { user: B, body: { role: "mentor" } })).status).toBe(403);
    expect((await call(groupsFn, "PATCH", `/api/v1/social/groups/${id}/members/${B}`, { user: A, body: { role: "member" } })).status).toBe(422);
    expect((await call(groupsFn, "PATCH", `/api/v1/social/groups/${id}/members/${B}`, { user: A, body: { role: "mentor" } })).status).toBe(200);
    expect(db.tables.group_members!.find((m) => m.user_id === B)).toMatchObject({ role: "mentor", share_level: "stats" });
    expect((await call(groupsFn, "DELETE", `/api/v1/social/groups/${id}/members/${A}`, { user: A })).status).toBe(409);
    expect((await call(groupsFn, "DELETE", `/api/v1/social/groups/${id}`, { user: B })).status).toBe(403);
    expect((await call(groupsFn, "DELETE", `/api/v1/social/groups/${id}`, { user: A })).status).toBe(200);
    expect(db.tables.group_members).toHaveLength(0);
  });

  it("invites expire and run out", async () => {
    const id = (await createGroup(A, "group")).body.group.id;
    const r = await call<{ invite: { code: string } }>(groupsFn, "POST", `/api/v1/social/groups/${id}/invites`, { user: A, body: { role: "member", maxUses: 1 } });
    expect((await join(B, r.body.invite.code)).status).toBe(201);
    expect((await join(C, r.body.invite.code)).status).toBe(404);
    db.tables.group_invites!.push({ code: "OLDCODE123", group_id: id, role: "member", created_by: A, uses: 0, max_uses: 5, expires_at: new Date(Date.now() - 1).toISOString() });
    expect((await join(C, "OLDCODE123")).status).toBe(404);
  });

  it("an invite's last use goes to exactly one of two concurrent joins", async () => {
    const id = (await createGroup(A, "group")).body.group.id;
    const r = await call<{ invite: { code: string } }>(groupsFn, "POST", `/api/v1/social/groups/${id}/invites`, { user: A, body: { role: "member", maxUses: 1 } });
    const both = await Promise.all([join(B, r.body.invite.code), join(C, r.body.invite.code)]);
    expect(both.map((x) => x.status).sort()).toEqual([201, 409]);
    expect(db.tables.group_members!.filter((m) => m.group_id === id).length).toBe(2); // owner + one
    expect(db.tables.group_invites!.find((i) => i.code === r.body.invite.code)).toMatchObject({ uses: 1 });
  });

  it("team: needs the Team plan; members take a seat each, no free seat → no join; removing frees the seat", async () => {
    expect((await createGroup(A, "team", "Desk")).status).toBe(402);
    db.tables.subscriptions!.push({ id: "sub_t", user_id: A, stripe_customer_id: "cus_t", status: "active", plan: "team", seats: 3, updated_at: iso() });
    const g = await createGroup(A, "team", "Desk");
    expect(g.status).toBe(201);
    expect((await createGroup(A, "team", "Zweites Team")).status).toBe(409);
    const code = (await invite(A, g.body.group.id, "member")).body.invite.code;
    expect((await join(B, code)).status).toBe(201);
    expect((await join(C, code)).status).toBe(201);
    expect(db.tables.team_seats!.map((s) => s.member_id).sort()).toEqual([B, C].sort());
    expect(db.tables.profiles!.find((p) => p.id === B)).toMatchObject({ plan: "team" });
    const full = await join(D, code);
    expect(full.status).toBe(409);
    expect(db.tables.group_members!.some((m) => m.user_id === D)).toBe(false);
    expect(db.tables.group_invites!.find((i) => i.code === code)).toMatchObject({ uses: 2 }); // the failed join gave its use back

    const detail = await feedOf(A, g.body.group.id);
    expect(detail.body.group.seats).toEqual({ seats: 3, used: 3 });
    expect(detail.body.group.memberList.every((m) => m.seat === true)).toBe(true);
    expect((await feedOf(B, g.body.group.id)).body.group.seats).toBeNull(); // only the owner sees the seat count

    expect((await call(groupsFn, "DELETE", `/api/v1/social/groups/${g.body.group.id}/members/${C}`, { user: A })).status).toBe(200);
    expect(db.tables.team_seats!.map((s) => s.member_id)).toEqual([B]);
    expect(db.tables.profiles!.find((p) => p.id === C)).toMatchObject({ plan: "free" });
    expect((await join(D, code)).status).toBe(201);
  });

  it("mentions match whole pseudonyms, longest first, case-insensitive", () => {
    expect(mentionsIn("Danke @stiller falke 27 und @Ruhige Eule 81!", [
      { id: "a", pseudonym: "Stiller Falke 27" },
      { id: "b", pseudonym: "Ruhige Eule 81" },
      { id: "c", pseudonym: "Wacher Fuchs 55" },
    ])).toEqual(["a", "b"]);
  });
});

/* ------------------------------------------------------------------ figures, rankings, k-anonymity */

function seedTrader(user: string, n: number, r: (i: number) => number): void {
  for (let i = 0; i < n; i++) trade(user, `t_${user.slice(0, 4)}_${i}`, r(i), 1 + (i % 80));
}

describe("leaderboard", () => {
  it("opt-in computes the figures from the synced trades only (90 days, R only); opt-out removes the row at once", async () => {
    seedTrader(A, 24, (i) => (i % 3 === 0 ? -1 : 1.5));
    trade(A, "t_old", 50, 200); // outside the window
    db.tables.journal_docs!.push({ user_id: A, kind: "trade", id: "t_del", deleted: true, data: { status: "closed", r: 99, date: iso().slice(0, 16) } });
    const res = await call<{ me: { optIn: boolean; figures: { expectancyR: number; eligible: boolean; trades: number } } }>(boardFn, "POST", "/api/v1/social/leaderboard", { user: A, body: { action: "optIn", on: true } });
    expect(res.status).toBe(200);
    expect(res.body.me.optIn).toBe(true);
    expect(res.body.me.figures).toMatchObject({ trades: 24, eligible: true, expectancyR: 0.67 });
    expect(db.tables.profiles!.find((p) => p.id === A)!.privacy).toEqual({ leaderboard: true });

    await runSocialAggregate();
    const board = await call<LeaderboardResponse>(boardFn, "GET", "/api/v1/social/leaderboard?metric=expectancy", { user: B });
    expect(board.body.rows).toHaveLength(1);
    expect(board.body.rows[0]).toMatchObject({ rank: 1, value: 0.67, me: false });
    expect(JSON.stringify(board.body)).not.toContain(A);

    await call(boardFn, "POST", "/api/v1/social/leaderboard", { user: A, body: { action: "optIn", on: false } });
    expect(db.tables.leaderboard_snapshots!.some((r) => r.user_id === A)).toBe(false);
    expect((await call<LeaderboardResponse>(boardFn, "GET", "/api/v1/social/leaderboard?metric=expectancy", { user: B })).body.rows).toHaveLength(0);
  });

  it("aggregate: only candidates are read, eligible opt-ins ranked, distributions only from 10 traders (k-anonymity)", async () => {
    const users = Array.from({ length: 12 }, (_, i) => `aaaaaaaa-0000-4000-8000-${String(i).padStart(12, "0")}`);
    for (const [i, u] of users.entries()) {
      db.tables.profiles!.push({ id: u, plan: "free", plan_status: "none", privacy: i < 9 ? { leaderboard: true } : {} });
      seedTrader(u, 25, (k) => (k % 2 ? 1 + i / 10 : -1));
    }
    let res = await runSocialAggregate();
    expect(res.candidates).toBe(9);
    expect(db.tables.member_stats!.map((r) => r.user_id).sort()).toEqual(users.slice(0, 9).sort()); // non-opted-in never read
    expect(res.ranked.expectancy).toBe(9);
    expect(res.stats).toEqual([]);
    expect(db.tables.community_stats).toHaveLength(0);

    db.tables.profiles!.find((p) => p.id === users[9])!.privacy = { leaderboard: true };
    res = await runSocialAggregate();
    expect(res.stats).toEqual(["expectancy", "discipline", "consistency", "winrate", "drawdown"]);
    const exp = db.tables.community_stats!.find((r) => r.metric === "expectancy")!;
    expect(exp.n).toBe(10);
    expect(Number(exp.p10)).toBeLessThanOrEqual(Number(exp.p90));
    // re-run is idempotent: one snapshot per user / metric / day
    await runSocialAggregate();
    expect(db.tables.leaderboard_snapshots!.filter((r) => r.metric === "expectancy")).toHaveLength(10);

    const board = await call<LeaderboardResponse>(boardFn, "GET", "/api/v1/social/leaderboard?metric=expectancy", { user: users[0] });
    expect(board.body.total).toBe(10);
    expect(board.body.rows[0]!.rank).toBe(1);
    expect(board.body.rows.find((r) => r.me)).toBeTruthy();
    expect(board.body.community.find((c) => c.metric === "expectancy")!.n).toBe(10);
  });

  it("drawdown (F71): ranks ascending, sits beside every row, and the data class limits a board", async () => {
    const users = Array.from({ length: 4 }, (_, i) => `bbbbbbbb-0000-4000-8000-${String(i).padStart(12, "0")}`);
    for (const u of users) db.tables.profiles!.push({ id: u, plan: "free", plan_status: "none", privacy: { leaderboard: true } });
    // same trades for everybody except the order of the losses: the deepest drop differs, the origin differs
    const loss = (i: number, u: number) => (u === 0 ? (i < 3 ? -1 : 1) : u === 1 ? (i % 4 === 0 ? -1 : 1) : u === 2 ? (i === 9 ? -4 : 1) : i % 2 ? -1 : 1);
    for (const [u, user] of users.entries()) for (let i = 0; i < 24; i++) trade(user, `t_${u}_${i}`, loss(i, u), 30 - i, u === 0 || u === 1 ? { origin: { kind: "api" } } : u === 2 ? { origin: { kind: "csv" } } : {});
    await runSocialAggregate();
    const stats = (u: number) => db.tables.member_stats!.find((r) => r.user_id === users[u])!;
    expect(stats(0)).toMatchObject({ max_dd_r: 3, origin: "api" });
    expect(stats(2)).toMatchObject({ max_dd_r: 4, origin: "csv" });
    expect(stats(3)).toMatchObject({ max_dd_r: 1, origin: "manual" });

    const board = await call<LeaderboardResponse>(boardFn, "GET", "/api/v1/social/leaderboard?metric=drawdown", { user: users[0] });
    expect(board.body.rows.map((r) => r.value)).toEqual([1, 1, 3, 4]); // smaller is better, the best first
    expect(board.body.rows.map((r) => r.rank)).toEqual([1, 1, 3, 4]);
    expect(board.body.rows.find((r) => r.me)).toMatchObject({ value: 3, drawdownR: 3, origin: "api" });
    // the drawdown stands beside the other metrics too
    const exp = await call<LeaderboardResponse>(boardFn, "GET", "/api/v1/social/leaderboard?metric=expectancy", { user: users[0] });
    expect(exp.body.rows.every((r) => typeof r.drawdownR === "number" && r.origin != null)).toBe(true);
    // the data class: only traders whose records mostly came that way, re-ranked among them
    const api = await call<LeaderboardResponse>(boardFn, "GET", "/api/v1/social/leaderboard?metric=drawdown&origin=api", { user: users[0] });
    expect(api.body.origin).toBe("api");
    expect(api.body.rows.map((r) => r.origin)).toEqual(["api", "api"]);
    expect(api.body.rows.map((r) => r.rank)).toEqual([1, 2]);
    expect((await call<LeaderboardResponse>(boardFn, "GET", "/api/v1/social/leaderboard?metric=drawdown&origin=auto", { user: users[0] })).body.rows).toHaveLength(0);
    expect((await call(boardFn, "GET", "/api/v1/social/leaderboard?metric=drawdown&origin=demo", { user: users[0] })).status).toBe(400);
    // withdrawal still works at once for every class
    db.tables.profiles!.find((p) => p.id === users[0])!.privacy = {};
    expect((await call<LeaderboardResponse>(boardFn, "GET", "/api/v1/social/leaderboard?metric=drawdown&origin=api", { user: users[1] })).body.rows.map((r) => r.me)).toEqual([true]);
  });

  it("under 20 R trades: figures yes, ranking no", async () => {
    seedTrader(A, 10, () => 1);
    db.tables.profiles!.find((p) => p.id === A)!.privacy = { leaderboard: true };
    await runSocialAggregate();
    expect(db.tables.member_stats!.find((r) => r.user_id === A)).toMatchObject({ eligible: false, r_trades: 10 });
    expect(db.tables.leaderboard_snapshots).toHaveLength(0);
  });

  it("group leaderboard: only members sharing stats, live", async () => {
    const id = (await createGroup(A, "group")).body.group.id;
    const code = (await invite(A, id, "member")).body.invite.code;
    await join(B, code, "stats");
    await join(C, code, "none");
    seedTrader(B, 22, () => 0.8);
    seedTrader(C, 22, () => 3);
    await runSocialAggregate(); // B is a candidate through share_level, C is not
    const board = await call<LeaderboardResponse>(boardFn, "GET", `/api/v1/social/leaderboard?metric=expectancy&group=${id}`, { user: A });
    expect(board.body.group).toMatchObject({ id, name: "Morgenrunde" });
    expect(board.body.rows).toHaveLength(1);
    expect(board.body.rows[0]!.value).toBe(0.8);
    expect((await call(boardFn, "GET", `/api/v1/social/leaderboard?metric=expectancy&group=${id}`, { user: D })).status).toBe(404);
    const detail = await feedOf(A, id);
    expect(detail.body.group.memberList.find((m) => m.id === B)!.figures).toMatchObject({ expectancyR: 0.8 });
    expect(detail.body.group.memberList.find((m) => m.id === C)!.figures).toBeNull();
    expect(detail.body.group.averages).toBeNull(); // < 10 sharing members
  });

  it("reroll gives a new pseudonym; unknown metric 400", async () => {
    const first = (await call<{ me: { pseudonym: string } }>(boardFn, "POST", "/api/v1/social/leaderboard", { user: A, body: { action: "refresh" } })).body.me.pseudonym;
    const next = (await call<{ me: { pseudonym: string } }>(boardFn, "POST", "/api/v1/social/leaderboard", { user: A, body: { action: "reroll" } })).body.me.pseudonym;
    expect(next).not.toBe(first);
    expect((await call(boardFn, "GET", "/api/v1/social/leaderboard?metric=pnl", { user: A })).status).toBe(400);
  });

  it("the scheduled function runs daily and answers JSON", async () => {
    expect(aggregateConfig.schedule).toBe("@daily");
    const res = await aggregateFn();
    expect(res.status).toBe(200);
  });
});

/* ------------------------------------------------------------------ feedback + reports */

describe("feedback", () => {
  it("works without an account; reports need one and a visible target; 3 reports hide a comment", async () => {
    expect((await call(feedbackFn, "POST", "/api/v1/feedback", { body: { kind: "idea", message: "Dunkles Theme ist top", page: "community" } })).status).toBe(201);
    expect(db.tables.feedback![0]).toMatchObject({ user_id: null, kind: "idea", page: "community" });
    expect((await call(feedbackFn, "POST", "/api/v1/feedback", { body: { kind: "report", message: "Spam", target: { type: "comment", id: uuid(1) } } })).status).toBe(401);

    const id = (await createGroup(A, "group")).body.group.id;
    const code = (await invite(A, id, "member")).body.invite.code;
    await join(B, code);
    await join(C, code);
    const rid = (await call<{ id: string }>(groupsFn, "POST", `/api/v1/social/groups/${id}/reviews`, { user: B, body: { payload: TRADE } })).body.id;
    const cid = (await call<{ comment: { id: string } }>(groupsFn, "POST", `/api/v1/social/groups/${id}/reviews/${rid}/comments`, { user: C, body: { body: "Kauf meinen Kurs!" } })).body.comment.id;
    expect((await call(feedbackFn, "POST", "/api/v1/feedback", { user: D, body: { kind: "report", message: "Spam", target: { type: "comment", id: cid } } })).status).toBe(404);
    for (const u of [A, B]) expect((await call(feedbackFn, "POST", "/api/v1/feedback", { user: u, body: { kind: "report", message: "Spam", target: { type: "comment", id: cid } } })).status).toBe(201);
    const dup = await call<{ duplicate?: boolean }>(feedbackFn, "POST", "/api/v1/feedback", { user: B, body: { kind: "report", message: "Spam!!", target: { type: "comment", id: cid } } });
    expect(dup.body.duplicate).toBe(true);
    expect(db.tables.comments![0]!.hidden).toBe(false);
    // the third distinct reporter hides it
    await call(groupsFn, "POST", `/api/v1/social/invite/${code}`, { user: D, body: {} });
    const third = await call<{ hidden?: boolean }>(feedbackFn, "POST", "/api/v1/feedback", { user: D, body: { kind: "report", message: "Werbung", target: { type: "comment", id: cid } } });
    expect(third.body.hidden).toBe(true);
    const bFeed = await feedOf(B, id);
    expect(bFeed.body.reviews[0]!.comments).toHaveLength(0);
    expect((await feedOf(C, id)).body.reviews[0]!.comments[0]!.hidden).toBe(true); // the author still sees it, marked
    expect((await feedOf(A, id)).body.reviews[0]!.comments).toHaveLength(1); // the owner sees it to decide
  });

  it("validates the body", async () => {
    expect((await call(feedbackFn, "POST", "/api/v1/feedback", { body: { kind: "idea", message: "x" } })).status).toBe(422);
    expect((await call(feedbackFn, "POST", "/api/v1/feedback", { body: { kind: "spam", message: "Hallo Welt" } })).status).toBe(422);
  });
});

describe("DSGVO export", () => {
  it("includes the social tables without other people's ids or tokens of others", () => {
    const names = EXPORT_TABLES.map((t) => t.table);
    expect(names).toEqual(expect.arrayContaining(["social_profiles", "groups", "group_members", "group_reviews", "comments", "shares", "member_stats", "feedback"]));
    expect(EXPORT_TABLES.find((t) => t.table === "comments")!.columns).not.toMatch(/mentions/);
  });
});
