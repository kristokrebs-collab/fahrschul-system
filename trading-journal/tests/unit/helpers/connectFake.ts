// @vitest-environment node
/**
 * In-memory Supabase admin fake for the Verbindungen tests: a trimmed copy of the one in `exchange.functions.test.ts`
 * (tables, JSON-path filters, the SQL semantics of `upsert_synced_trades`) plus `webhook_receipts` (migration 0012).
 */
import { vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

export type Row = Record<string, unknown>;

/* ------------------------------------------------------------------ admin fake */

export interface State {
  tables: Record<string, Row[]>;
  claims: Row | null;
  rpcCalls: string[];
}

const getPath = (row: Row, col: string): unknown => {
  const m = /^(\w+)((?:->>?\w+)+)$/.exec(col);
  if (!m) return row[col];
  let v: unknown = row[m[1]!];
  const parts = m[2]!.match(/->>?\w+/g)!;
  for (const p of parts) {
    const key = p.replace(/^->>?/, "");
    v = v && typeof v === "object" ? (v as Row)[key] : undefined;
    if (p.startsWith("->>") && v !== undefined && v !== null && typeof v !== "string") v = typeof v === "object" ? JSON.stringify(v) : String(v);
  }
  return v;
};
const cmp = (a: unknown, b: unknown) => (String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0);

function query(state: State, name: string) {
  const filters: ((r: Row) => boolean)[] = [];
  const orders: { col: string; asc: boolean; nullsFirst: boolean }[] = [];
  let limit: number | null = null;
  let offset = 0;
  let op: "select" | "update" | "delete" | "insert" | "upsert" = "select";
  let patch: Row | Row[] | null = null;
  let onConflict: string[] = [];
  let returning = false;
  const all = () => (state.tables[name] ??= []);
  const matches = () => all().filter((r) => filters.every((f) => f(r)));
  const exec = (): { data: unknown; error: unknown } => {
    if (op === "insert") {
      const rows = (Array.isArray(patch) ? patch : [patch!]).map((r): Row => ({ id: r.id ?? crypto.randomUUID(), created_at: new Date().toISOString(), ...r }));
      for (const r of rows) {
        if (name === "exchange_connections" && all().some((x) => x.user_id === r.user_id && x.exchange === r.exchange && x.label === r.label)) return { data: null, error: { code: "23505" } };
        if (name === "sync_runs") Object.assign(r, { started_at: r.started_at ?? new Date().toISOString(), fetched: 0, inserted: 0, updated: 0, unchanged: 0, skipped: 0, meta: {} });
        if (name === "api_tokens") Object.assign(r, { revoked_at: null, last_used_at: null });
        if (name === "webhook_receipts") Object.assign(r, { received_at: new Date().toISOString() });
        // migration 0013: the partial unique index of the dedup key, and the table default
        if (name === "signals") {
          if (r.status === "processed" && r.kind === "signal" && all().some((x) => x.user_id === r.user_id && x.source === r.source && x.signal_id === r.signal_id && x.status === "processed" && x.kind === "signal")) return { data: null, error: { code: "23505" } };
          Object.assign(r, { received_at: new Date().toISOString() });
        }
        if (name === "exchange_connections") Object.assign(r, { last_sync_at: null, last_error: null, meta: r.meta ?? {} });
        all().push(r);
      }
      return { data: rows, error: null };
    }
    if (op === "upsert") {
      const r = patch as Row;
      const hit = all().find((x) => onConflict.every((k) => x[k] === r[k]));
      if (hit) Object.assign(hit, r);
      else all().push({ created_at: new Date().toISOString(), ...r });
      return { data: null, error: null };
    }
    if (op === "update") {
      const rows = matches();
      for (const r of rows) Object.assign(r, patch);
      return { data: rows, error: null };
    }
    if (op === "delete") {
      const rows = matches();
      state.tables[name] = all().filter((r) => !rows.includes(r));
      if (name === "exchange_connections") state.tables.sync_cursor = (state.tables.sync_cursor ?? []).filter((c) => !rows.some((r) => r.id === c.connection_id));
      return { data: rows.map((r) => ({ id: r.id })), error: null };
    }
    let rows = matches();
    for (const o of [...orders].reverse()) {
      rows = [...rows].sort((a, b) => {
        const va = getPath(a, o.col);
        const vb = getPath(b, o.col);
        if (va == null || vb == null) return va == null && vb == null ? 0 : (va == null ? -1 : 1) * (o.nullsFirst ? 1 : -1);
        return cmp(va, vb) * (o.asc ? 1 : -1);
      });
    }
    if (limit !== null || offset) rows = rows.slice(offset, limit === null ? undefined : offset + limit);
    return { data: rows.map((r) => ({ ...r })), error: null };
  };
  const q = {
    select: () => ((returning = true), q),
    eq: (c: string, v: unknown) => (filters.push((r) => getPath(r, c) === v), q),
    neq: (c: string, v: unknown) => (filters.push((r) => getPath(r, c) !== v), q),
    in: (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(getPath(r, c))), q),
    gt: (c: string, v: unknown) => (filters.push((r) => cmp(getPath(r, c), v) > 0), q),
    gte: (c: string, v: unknown) => (filters.push((r) => cmp(getPath(r, c), v) >= 0), q),
    lt: (c: string, v: unknown) => (filters.push((r) => cmp(getPath(r, c), v) < 0), q),
    is: (c: string, v: unknown) => (filters.push((r) => (getPath(r, c) ?? null) === v), q),
    like: (c: string, p: string) => (filters.push((r) => new RegExp(`^${p.replace(/%/g, ".*")}$`).test(String(getPath(r, c) ?? ""))), q),
    order: (col: string, o?: { ascending?: boolean; nullsFirst?: boolean }) => (orders.push({ col, asc: o?.ascending !== false, nullsFirst: !!o?.nullsFirst }), q),
    limit: (n: number) => ((limit = n), q),
    range: (a: number, b: number) => ((offset = a), (limit = b - a + 1), q),
    insert: (r: Row | Row[]) => ((op = "insert"), (patch = r), q),
    update: (r: Row) => ((op = "update"), (patch = r), q),
    delete: () => ((op = "delete"), q),
    upsert: (r: Row, o?: { onConflict?: string }) => ((op = "upsert"), (patch = r), (onConflict = (o?.onConflict ?? "id").split(",")), q),
    maybeSingle: async () => {
      const r = exec();
      return { data: (r.data as Row[] | null)?.[0] ?? null, error: r.error };
    },
    single: async () => {
      const r = exec();
      const row = (r.data as Row[] | null)?.[0] ?? null;
      return { data: row, error: r.error ?? (row ? null : { code: "PGRST116" }) };
    },
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
      void returning;
      return Promise.resolve(exec()).then(res, rej);
    },
  };
  return q;
}

/** JS twin of public.upsert_synced_trade (0003_exchange.sql; the SQL itself is checked on PGlite). */
function upsertSynced(state: State, user: string, items: { id: string; set?: Row; fill?: Row; new?: Row }[]): Record<string, string> {
  const docs = (state.tables.journal_docs ??= []);
  const out: Record<string, string> = {};
  const nowIso = new Date().toISOString();
  const empty = (v: unknown) => v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
  for (const it of items) {
    const cur = docs.find((d) => d.user_id === user && d.kind === "trade" && d.id === it.id);
    if (!cur) {
      docs.push({ user_id: user, kind: "trade", id: it.id, deleted: false, updated_at: nowIso, data: { ...it.new, ...it.fill, ...it.set, id: it.id, createdAt: (it.new?.createdAt as string) ?? nowIso, updatedAt: nowIso } });
      out[it.id] = "inserted";
      continue;
    }
    if (cur.deleted) {
      out[it.id] = "deleted";
      continue;
    }
    const merged: Row = { ...(cur.data as Row), ...it.set };
    for (const [k, v] of Object.entries(it.fill ?? {})) if (empty(merged[k])) merged[k] = v;
    const strip = (r: Row) => JSON.stringify(Object.fromEntries(Object.entries(r).filter(([k]) => k !== "syncedAt" && k !== "updatedAt").sort(([a], [b]) => cmp(a, b))));
    if (strip(merged) === strip(cur.data as Row)) {
      out[it.id] = "unchanged";
      continue;
    }
    cur.data = { ...merged, updatedAt: nowIso };
    cur.updated_at = nowIso;
    out[it.id] = "updated";
  }
  return out;
}

export function fakeAdmin(state: State): SupabaseClient {
  return {
    auth: {
      getClaims: vi.fn(async () => (state.claims ? { data: { claims: state.claims }, error: null } : { data: null, error: { message: "bad" } })),
      getUser: vi.fn(async () => (state.claims ? { data: { user: { id: String(state.claims.sub) } }, error: null } : { data: null, error: { message: "bad" } })),
      admin: { mfa: { listFactors: vi.fn(async () => ({ data: { factors: [] }, error: null })) } },
    },
    rpc: vi.fn(async (fn: string, args: Row) => {
      state.rpcCalls.push(fn);
      if (fn === "rate_hit") return { data: 1, error: null };
      if (fn === "upsert_synced_trades") return { data: upsertSynced(state, args.p_user as string, args.p_items as never), error: null };
      return { data: null, error: { code: "42883" } };
    }),
    from: (name: string) => query(state, name),
  } as unknown as SupabaseClient;
}

