/**
 * Fakes for the e-mail alarm tests (no network, no real Supabase, no real mail): an in-memory `journal_docs` settings
 * table behind the two RPCs of migration 0008 (`alert_watch_candidates`, `set_server_alerts` with the rev guard), a few
 * more tables (`profiles`, `app_config`), Supabase Auth's `getUserById`, a Binance fetch that serves klines and prices, and
 * a Resend fetch that records every mail and honours the idempotency key. The e-mail addresses are made-up examples.
 */
import { blankKeyLevel, withKeyLevels, type KeyLevel } from "../../src/domain/keylevels";

export const H = 3_600_000;
export const MIN = 60_000;

export interface FakeSettingsRow {
  userId: string;
  rev: number;
  data: Record<string, unknown>;
  deleted?: boolean;
}

export interface FakeUser {
  email: string | null;
  confirmed: boolean;
}

export const db = {
  rows: new Map<string, FakeSettingsRow>(),
  profiles: new Map<string, { plan: string; plan_status: string; trial_end: string | null; tz: string }>(),
  users: new Map<string, FakeUser>(),
  config: new Map<string, unknown>(),
  /** every RPC call: name + user */
  rpcCalls: [] as { name: string; user: string | null }[],
  /** runs right before a `set_server_alerts` is applied (tests use it to lose a race) */
  beforeWrite: null as null | ((userId: string, n: number) => void),
  writes: 0,
  migration: true,
};

export function resetDb(): void {
  db.rows.clear();
  db.profiles.clear();
  db.users.clear();
  db.config.clear();
  db.rpcCalls.length = 0;
  db.beforeWrite = null;
  db.writes = 0;
  db.migration = true;
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
type Rec = Record<string, unknown>;
const obj = (v: unknown): Rec => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Rec) : {});

/** The settings of a user as the cloud sync stores them. */
export function putUser(userId: string, o: { data?: Rec; email?: string | null; confirmed?: boolean; plan?: string; tz?: string; status?: string }): FakeSettingsRow {
  const row: FakeSettingsRow = { userId, rev: 1, data: clone(o.data ?? {}) };
  db.rows.set(userId, row);
  db.profiles.set(userId, { plan: o.plan ?? "pro", plan_status: o.status ?? "active", trial_end: null, tz: o.tz ?? "Europe/Berlin" });
  db.users.set(userId, { email: o.email === undefined ? `${userId}@example.test` : o.email, confirmed: o.confirmed ?? true });
  return row;
}

function candidates(args: Rec): Rec[] {
  const out: Rec[] = [];
  for (const r of db.rows.values()) {
    if (r.deleted) continue;
    if (obj(r.data.serverAlerts).email !== true) continue;
    if (args.p_user && args.p_user !== r.userId) continue;
    out.push({ user_id: r.userId, rev: r.rev, key_levels: clone(r.data.keyLevels ?? null), server_alerts: clone(r.data.serverAlerts ?? null), tz: db.profiles.get(r.userId)?.tz ?? "Europe/Berlin" });
  }
  return out.sort((a, b) => String(a.user_id).localeCompare(String(b.user_id))).slice(0, Number(args.p_limit ?? 200));
}

function setServerAlerts(args: Rec): number | null {
  const r = db.rows.get(String(args.p_user));
  db.writes += 1;
  db.beforeWrite?.(String(args.p_user), db.writes);
  if (!r || r.deleted || r.rev !== args.p_expected_rev) return null;
  r.data.serverAlerts = clone(args.p_value);
  r.rev += 1;
  return r.rev;
}

/** A tiny PostgREST-style query builder over an array of rows. */
function table(rows: () => Rec[], write?: (row: Rec) => void) {
  const filters: ((r: Rec) => boolean)[] = [];
  let single = false;
  let upsert: Rec | null = null;
  const q: Record<string, unknown> = {};
  q.select = () => q;
  q.eq = (c: string, v: unknown) => (filters.push((r) => r[c] === v), q);
  q.in = (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[c])), q);
  q.maybeSingle = () => ((single = true), q);
  q.upsert = (row: Rec) => ((upsert = row), q);
  q.then = (res: (v: unknown) => unknown) => {
    if (upsert) {
      write?.(upsert);
      return Promise.resolve(res({ data: null, error: null }));
    }
    const hits = rows().filter((r) => filters.every((f) => f(r)));
    return Promise.resolve(res({ data: single ? (hits[0] ?? null) : hits, error: null }));
  };
  return q;
}

export const fakeSupabase = {
  async rpc(name: string, args: Rec) {
    db.rpcCalls.push({ name, user: typeof args.p_user === "string" ? args.p_user : null });
    if (!db.migration) return { data: null, error: { code: "PGRST202", message: "not found" } };
    if (name === "alert_watch_candidates") return { data: candidates(args), error: null };
    if (name === "set_server_alerts") return { data: setServerAlerts(args), error: null };
    return { data: null, error: { code: "PGRST202", message: "unknown" } };
  },
  from(name: string) {
    if (name === "profiles") return table(() => [...db.profiles.entries()].map(([id, p]) => ({ id, ...p })));
    if (name === "app_config") return table(() => [...db.config.entries()].map(([key, value]) => ({ key, value })), (row) => db.config.set(String(row.key), row.value));
    return table(() => []);
  },
  auth: {
    admin: {
      async getUserById(id: string) {
        const u = db.users.get(id);
        if (!u) return { data: { user: null }, error: { message: "not found" } };
        return { data: { user: { id, email: u.email ?? undefined, email_confirmed_at: u.confirmed ? "2026-01-01T00:00:00Z" : null } }, error: null };
      },
    },
  },
};

// ------------------------------------------------------------------------------------------ settings

export const level = (over: Partial<KeyLevel> & Pick<KeyLevel, "id">, since: number): KeyLevel =>
  blankKeyLevel({ symbol: "BTCUSDT", price: 100, name: over.id, tf: "4h", kind: "close", direction: "above", ...over }, since);

export const ALERT_ON = { on: true, prepare: false, confirm: true, retest: false, invalid: false, recurring: false } as const;

/** Settings data of a user with the e-mail alarm on and the given levels. */
export function settingsData(levels: KeyLevel[], o: { armedAt?: number; maxPerDay?: number; alerts?: Rec; serverAlerts?: Rec; extra?: Rec } = {}): Rec {
  return {
    capital: { makro: 1000, scalp: 1000 },
    studio: { v: 1, strategies: [{ id: "s1", name: "keep me" }] },
    keyLevels: withKeyLevels(undefined, { levels, ...(o.alerts ? { alerts: o.alerts as never } : {}) }),
    serverAlerts: { v: 1, email: true, maxPerDay: o.maxPerDay ?? 6, armedAt: o.armedAt ?? 0, ...(o.serverAlerts ?? {}) },
    ...(o.extra ?? {}),
  };
}

// ------------------------------------------------------------------------------------------ Binance

export type Row = [number, string, string, string, string, string, number, string, number, string, string, string];

/** A raw Binance kline row. */
export function kline(open: number, ms: number, o: number, h: number, l: number, c: number): Row {
  return [open, String(o), String(h), String(l), String(c), "1", open + ms - 1, "1", 1, "1", "1", "0"];
}

/**
 * Candles of one interval ending at the candle that contains `now`: `closes[i]` is the close of the i-th candle
 * counted from the OLDEST; the last one is forming (it closes at its end).
 */
export function klineSeries(ms: number, now: number, closes: number[]): Row[] {
  const lastOpen = Math.floor(now / ms) * ms;
  return closes.map((c, i) => {
    const open = lastOpen - (closes.length - 1 - i) * ms;
    const prev = i === 0 ? c : closes[i - 1]!;
    return kline(open, ms, prev, Math.max(prev, c) + 0.5, Math.min(prev, c) - 0.5, c);
  });
}

const INTERVAL_MS: Record<string, number> = { "15m": 15 * MIN, "1h": H, "4h": 4 * H, "1d": 24 * H, "1w": 7 * 24 * H };

export interface BinanceFake {
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  /** `host path?query` of every request */
  calls: string[];
  /** symbol → interval → closes (oldest first); the last candle is the forming one */
  series: Map<string, Map<string, number[]>>;
  prices: Map<string, number>;
  /** exact rows of `SYMBOL|interval` (instead of rows built from closes) */
  raw: Map<string, Row[]>;
  now: number;
  /** answer every request of these hosts with a status */
  block: Map<string, number>;
}

export function binanceFake(now: number): BinanceFake {
  const f: BinanceFake = {
    calls: [],
    series: new Map(),
    prices: new Map(),
    raw: new Map(),
    now,
    block: new Map(),
    fetch: async (url) => {
      const u = new URL(url);
      f.calls.push(`${u.host}${u.pathname}${u.search}`);
      const status = f.block.get(u.host);
      if (status) return new Response(JSON.stringify({ code: -1, msg: "blocked" }), { status, headers: { "content-type": "application/json" } });
      const json = (body: unknown, s = 200) => new Response(JSON.stringify(body), { status: s, headers: { "content-type": "application/json" } });
      if (u.pathname.endsWith("/fapi/v1/ticker/price")) return json([...f.prices].map(([symbol, price]) => ({ symbol, price: String(price), time: f.now })));
      if (u.pathname.endsWith("/fapi/v1/klines")) {
        const symbol = u.searchParams.get("symbol") ?? "";
        const interval = u.searchParams.get("interval") ?? "";
        const exact = f.raw.get(`${symbol}|${interval}`);
        if (exact) return json(exact.slice(-Number(u.searchParams.get("limit") ?? 499)));
        const closes = f.series.get(symbol)?.get(interval);
        if (!closes) return json({ code: -1121, msg: "Invalid symbol." }, 400);
        const limit = Number(u.searchParams.get("limit") ?? 499);
        return json(klineSeries(INTERVAL_MS[interval]!, f.now, closes).slice(-limit));
      }
      return json({}, 404);
    },
  };
  return f;
}

/** Sets the candles of a symbol/interval and its price (the last close). */
export function setSeries(b: BinanceFake, symbol: string, interval: string, closes: number[]): void {
  let m = b.series.get(symbol);
  if (!m) b.series.set(symbol, (m = new Map()));
  m.set(interval, closes);
  b.prices.set(symbol, closes[closes.length - 1]!);
}

// ------------------------------------------------------------------------------------------ Resend

export interface SentMail {
  to: string[];
  from: string;
  subject: string;
  text: string;
  key: string | null;
}

export interface ResendFake {
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  sent: SentMail[];
  /** answer the next requests with these statuses (then succeed again) */
  failWith: number[];
  /** idempotency keys seen → mail id */
  keys: Map<string, string>;
  requests: number;
}

export function resendFake(): ResendFake {
  const r: ResendFake = {
    sent: [],
    failWith: [],
    keys: new Map(),
    requests: 0,
    fetch: async (_url, init) => {
      r.requests += 1;
      const status = r.failWith.shift();
      if (status) return new Response(JSON.stringify({ name: "error", message: "nope" }), { status });
      const headers = new Headers(init?.headers);
      const body = JSON.parse(String(init?.body)) as { from: string; to: string[]; subject: string; text: string };
      const key = headers.get("idempotency-key");
      if (key && r.keys.has(key)) return new Response(JSON.stringify({ id: r.keys.get(key) }), { status: 200 });
      const id = `mail_${r.sent.length + 1}`;
      if (key) r.keys.set(key, id);
      r.sent.push({ ...body, key });
      return new Response(JSON.stringify({ id }), { status: 200 });
    },
  };
  return r;
}
