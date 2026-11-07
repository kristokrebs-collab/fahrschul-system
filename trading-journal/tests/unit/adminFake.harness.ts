/// <reference types="node" />
/**
 * A small in-memory twin of the Supabase admin client for the B1 / C4 function tests: tables (select with count / head,
 * eq / in / gte / not / order / limit / range, insert / upsert / update / delete, maybeSingle), storage buckets (list,
 * remove, download, signed urls), auth admin (user, factors, delete factor, delete user) and the `rate_hit` RPC.
 * Deliberately generic – the older `functions.account.test.ts` keeps its own, narrower fake.
 */
import { vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { setSupabaseAdminForTests } from "../../netlify/functions/_lib/supabase";

export type Row = Record<string, unknown>;
export interface Obj {
  name: string;
  body: string;
}
export interface Factor {
  id: string;
  status: string;
  factor_type?: string;
}

export interface AdminState {
  tables: Record<string, Row[] | undefined>;
  storage: Record<string, Obj[] | undefined>;
  claims: Record<string, unknown> | null;
  factors: Factor[];
  /** What `rate_hit` answers (the count in the window); raise it to hit the limit. */
  rate: number;
  rateKeys: string[];
  deleted: string[];
  failDelete?: boolean;
  failFactorDelete?: boolean;
  /** Files that survive `remove` (a stuck object). */
  stuck?: string[];
}

export function newState(over: Partial<AdminState> = {}): AdminState {
  return { tables: {}, storage: {}, claims: null, factors: [], rate: 1, rateKeys: [], deleted: [], ...over };
}

function table(state: AdminState, name: string) {
  const filters: ((r: Row) => boolean)[] = [];
  let order: { col: string; asc: boolean }[] = [];
  let limit: number | null = null;
  let range: [number, number] | null = null;
  let op: "select" | "delete" | "update" | "upsert" = "select";
  let patch: Row = {};
  let upserts: Row[] = [];
  let countMode = false;
  let head = false;
  let columns: string[] | null = null;
  const missing = () => state.tables[name] === undefined;
  const project = (r: Row): Row => (columns ? Object.fromEntries(columns.filter((c) => c in r).map((c) => [c, r[c]])) : { ...r });
  const run = (): { data: unknown; error: { code?: string; message?: string } | null; count?: number | null } => {
    if (missing()) return { data: null, error: { code: "PGRST205", message: "missing" } };
    const all = state.tables[name]!;
    if (op === "delete") {
      state.tables[name] = all.filter((r) => !filters.every((f) => f(r)));
      return { data: null, error: null };
    }
    if (op === "update") {
      const hit = all.filter((r) => filters.every((f) => f(r)));
      for (const r of hit) Object.assign(r, patch);
      return { data: hit.map(project), error: null };
    }
    if (op === "upsert") {
      for (const u of upserts) {
        const key = name === "app_config" ? "key" : "id";
        const i = all.findIndex((r) => r[key] === u[key]);
        if (i >= 0) all[i] = { ...all[i], ...u };
        else all.push({ ...u });
      }
      return { data: upserts.map(project), error: null };
    }
    let rows = all.filter((r) => filters.every((f) => f(r)));
    const total = rows.length;
    for (const o of [...order].reverse()) rows = [...rows].sort((a, b) => (String(a[o.col]) < String(b[o.col]) ? -1 : String(a[o.col]) > String(b[o.col]) ? 1 : 0) * (o.asc ? 1 : -1));
    if (range) rows = rows.slice(range[0], range[1] + 1);
    if (limit !== null) rows = rows.slice(0, limit);
    return { data: head ? null : rows.map(project), error: null, count: countMode ? total : null };
  };
  const q: Record<string, unknown> = {
    select: (cols?: string, o?: { count?: string; head?: boolean }) => {
      if (op === "select") columns = cols && cols !== "*" && !cols.includes("(") ? cols.split(",").map((c) => c.trim()) : null;
      countMode = !!o?.count;
      head = !!o?.head;
      return q;
    },
    eq: (col: string, v: unknown) => (filters.push((r) => r[col] === v), q),
    gte: (col: string, v: unknown) => (filters.push((r) => String(r[col]) >= String(v)), q),
    lt: (col: string, v: unknown) => (filters.push((r) => String(r[col]) < String(v)), q),
    in: (col: string, v: unknown[]) => (filters.push((r) => v.includes(r[col])), q),
    not: (col: string, opr: string, v: unknown) => (filters.push((r) => (opr === "is" && v === null ? r[col] !== null && r[col] !== undefined : r[col] !== v)), q),
    order: (col: string, o?: { ascending?: boolean }) => (order.push({ col, asc: o?.ascending !== false }), q),
    limit: (n: number) => ((limit = n), q),
    range: (a: number, b: number) => ((range = [a, b]), q),
    delete: () => ((op = "delete"), q),
    update: (p: Row) => ((op = "update"), (patch = p), q),
    upsert: (rows: Row | Row[]) => ((op = "upsert"), (upserts = Array.isArray(rows) ? rows : [rows]), q),
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

export function fakeAdmin(state: AdminState) {
  const bucket = (b: string) => ({
    list: async (prefix: string, o: { limit?: number; offset?: number } = {}) => {
      const objs = state.storage[b];
      if (!objs) return { data: null, error: { message: "Bucket not found", statusCode: "404" } };
      const names = new Map<string, boolean>();
      for (const obj of objs) {
        if (!obj.name.startsWith(`${prefix}/`)) continue;
        const [head, ...tail] = obj.name.slice(prefix.length + 1).split("/");
        names.set(head!, tail.length === 0);
      }
      const entries = [...names].sort().map(([name, file]) => ({ name, id: file ? `id-${name}` : null, metadata: file ? { size: 10 } : null }));
      return { data: entries.slice(o.offset ?? 0, (o.offset ?? 0) + (o.limit ?? 100)), error: null };
    },
    remove: async (paths: string[]) => {
      state.storage[b] = (state.storage[b] ?? []).filter((o) => !paths.includes(o.name) || state.stuck?.includes(o.name));
      return { data: paths, error: null };
    },
    download: async (path: string) => {
      const o = state.storage[b]?.find((x) => x.name === path);
      return o ? { data: new Blob([o.body]), error: null } : { data: null, error: { message: "not found" } };
    },
    createSignedUrls: async (paths: string[], ttl: number) => ({
      data: paths.map((p) => (state.storage[b]?.some((o) => o.name === p) ? { path: p, signedUrl: `https://store.test/${b}/${p}?ttl=${ttl}`, error: null } : { path: p, signedUrl: "", error: "not found" })),
      error: null,
    }),
  });
  const client = {
    auth: {
      getClaims: vi.fn(async () => (state.claims ? { data: { claims: state.claims }, error: null } : { data: null, error: { message: "bad" } })),
      admin: {
        mfa: {
          listFactors: vi.fn(async () => ({ data: { factors: state.factors }, error: null })),
          deleteFactor: vi.fn(async ({ id }: { id: string }) => {
            if (state.failFactorDelete) return { data: null, error: { status: 500 } };
            state.factors = state.factors.filter((f) => f.id !== id);
            return { data: { id }, error: null };
          }),
        },
        getUserById: vi.fn(async (id: string) => ({ data: { user: { id, email: "a@b.de", created_at: "2026-01-01T00:00:00Z", last_sign_in_at: null, factors: [] } }, error: null })),
        deleteUser: vi.fn(async (id: string) => {
          if (state.failDelete) return { data: null, error: { status: 500 } };
          state.deleted.push(id);
          for (const k of Object.keys(state.tables)) state.tables[k] = state.tables[k]?.filter((r) => r.user_id !== id && r.id !== id && r.owner_id !== id);
          return { data: {}, error: null };
        }),
      },
    },
    rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
      if (fn === "rate_hit") {
        state.rateKeys.push(String(args.p_key));
        return { data: state.rate, error: null };
      }
      return { data: null, error: { code: "42883" } };
    }),
    from: (name: string) => table(state, name),
    storage: { from: bucket },
  };
  setSupabaseAdminForTests(client as unknown as SupabaseClient);
  return client;
}
