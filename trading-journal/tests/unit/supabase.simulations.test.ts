// @vitest-environment node
/// <reference types="node" />
/**
 * Migration 0011 (gespeicherte Simulationen der Zeitmaschine, A3) on a real Postgres (PGlite) with the same minimal Supabase shim
 * as `supabase.rls.test.ts`: only the own rows are readable and writable, anon has nothing, a 2FA account needs aal2, the checks
 * refuse what is not a simulation, `created_at` never moves, the upsert key is (user, id) and the cascade removes the rows.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const MIG_DIR = join(__dirname, "../../supabase/migrations");

const SHIM = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
create schema auth; grant usage on schema auth to anon, authenticated, service_role;
create type auth.aal_level as enum ('aal1','aal2','aal3');
create table auth.users (id uuid primary key, email text);
create table auth.mfa_factors (id uuid primary key default gen_random_uuid(), user_id uuid references auth.users(id) on delete cascade, status text);
create table auth.sessions (id uuid primary key, user_id uuid references auth.users(id) on delete cascade, created_at timestamptz default now(), updated_at timestamptz default now(), factor_id uuid, aal auth.aal_level, not_after timestamptz, refreshed_at timestamp, user_agent text, ip inet, tag text);
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create function auth.uid() returns uuid language sql stable as $$ select nullif(auth.jwt() ->> 'sub', '')::uuid $$;
grant execute on function auth.jwt() to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
create publication supabase_realtime;
create schema storage; grant usage on schema storage to anon, authenticated, service_role;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
grant execute on function storage.foldername(text) to authenticated;
grant select, insert, update, delete on storage.objects to authenticated;
`;

const uid = (n: number) => `${String(n).padStart(8, "0")}-0000-4000-8000-${String(n).padStart(12, "0")}`;
const A = uid(1); // no 2FA
const B = uid(2); // no 2FA
const T = uid(3); // verified 2FA factor

const HEX = (c: string, n = 64) => c.repeat(n);
const SIM = (c: string) => `sim_${HEX(c, 20)}`;

let db: PGlite;

async function as<R = Record<string, unknown>>(claims: Record<string, unknown> | null, sql: string, params: unknown[] = [], role: "authenticated" | "anon" | "service_role" = "authenticated"): Promise<R[]> {
  await db.exec(`reset role; select set_config('request.jwt.claims', '${JSON.stringify(claims ?? {})}', false); set role ${role};`);
  try {
    return (await db.query<R>(sql, params)).rows;
  } finally {
    await db.exec("reset role;");
  }
}
const jwt = (sub: string, aal: "aal1" | "aal2" = "aal1") => ({ sub, role: "authenticated", aal });

interface Row {
  user: string;
  id: string;
  tradeId: string | null;
  over: Record<string, unknown>;
}
const insertSql = (o: Record<string, unknown> = {}): { sql: string; params: unknown[] } => {
  const v: Record<string, unknown> & { trade_id: unknown } = {
    trade_id: "t_abc",
    symbol: "BTCUSDT",
    interval: "4h",
    seed: 19,
    model_version: "zeitmaschine/1",
    data_hash: HEX("a"),
    data_bars: 500,
    runs: 10000,
    horizon: 42,
    plan: { side: "long", entry: 100, stop: 98, target: 104 },
    costs: { fees: { takerBps: 4 } },
    metrics: { targetP: 0.31 },
    result_hash: HEX("b"),
    ...o,
  };
  return {
    sql: `insert into public.simulations (user_id, id, trade_id, symbol, interval, seed, model_version, data_hash, data_bars, runs, horizon, plan, costs, metrics, result_hash)
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13::jsonb, $14::jsonb, $15)`,
    params: [v.user_id ?? null, v.id ?? null, v.trade_id, v.symbol, v.interval, v.seed, v.model_version, v.data_hash, v.data_bars, v.runs, v.horizon, JSON.stringify(v.plan), JSON.stringify(v.costs), JSON.stringify(v.metrics), v.result_hash],
  };
};
const add = (r: Row) => {
  const { sql, params } = insertSql({ trade_id: r.tradeId, ...r.over });
  params[0] = r.user;
  params[1] = r.id;
  return db.query(sql, params);
};
const mine = async (user: string, aal: "aal1" | "aal2" = "aal1") => (await as<{ id: string }>(jwt(user, aal), `select id from public.simulations order by id`)).map((r) => r.id);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SHIM);
  for (const f of readdirSync(MIG_DIR).filter((x) => /^\d{4}_.+\.sql$/.test(x)).sort()) await db.exec(readFileSync(join(MIG_DIR, f), "utf8"));
  await db.exec(`insert into auth.users (id, email) values ('${A}', 'a@x.test'), ('${B}', 'b@x.test'), ('${T}', 't@x.test')`);
  await db.exec(`insert into auth.mfa_factors (user_id, status) values ('${T}', 'verified')`);
  await add({ user: A, id: SIM("1"), tradeId: "t_a1", over: {} });
  await add({ user: B, id: SIM("2"), tradeId: null, over: {} });
  await add({ user: T, id: SIM("3"), tradeId: "t_t1", over: {} });
}, 60_000);

afterAll(async () => {
  await db?.close();
});

describe("0011: Tabelle und Prüfungen", () => {
  const bad = (over: Record<string, unknown>) => add({ user: A, id: SIM("9"), tradeId: null, over });

  it("lehnt ab, was keine Simulation ist", async () => {
    await expect(add({ user: A, id: "sim_zz", tradeId: null, over: {} })).rejects.toThrow(/check constraint/);
    await expect(add({ user: A, id: "x".repeat(25), tradeId: null, over: {} })).rejects.toThrow(/check constraint/);
    await expect(bad({ interval: "3h" })).rejects.toThrow(/check constraint/);
    await expect(bad({ seed: -1 })).rejects.toThrow(/check constraint/);
    await expect(bad({ seed: 4294967296 })).rejects.toThrow(/check constraint/);
    await expect(bad({ data_hash: "abc" })).rejects.toThrow(/check constraint/);
    await expect(bad({ result_hash: HEX("g") })).rejects.toThrow(/check constraint/);
    await expect(bad({ runs: 0 })).rejects.toThrow(/check constraint/);
    await expect(bad({ runs: 100001 })).rejects.toThrow(/check constraint/);
    await expect(bad({ horizon: 401 })).rejects.toThrow(/check constraint/);
    await expect(bad({ symbol: "" })).rejects.toThrow(/check constraint/);
    await expect(bad({ model_version: "x".repeat(41) })).rejects.toThrow(/check constraint/);
  });

  it("begrenzt die Größe der Dokumente (kein Ablageplatz für Beliebiges)", async () => {
    await expect(bad({ metrics: { text: "x".repeat(20000) } })).rejects.toThrow(/check constraint/);
    await expect(bad({ plan: { text: "x".repeat(3000) } })).rejects.toThrow(/check constraint/);
    await expect(bad({ costs: [1, 2, 3] })).rejects.toThrow(/check constraint/);
  });

  it("(Nutzer, ID) ist der Schlüssel: dieselbe ID gibt es einmal je Nutzer, bei zwei Nutzern je einmal", async () => {
    await expect(add({ user: A, id: SIM("1"), tradeId: "t_a1", over: {} })).rejects.toThrow(/duplicate key|unique/);
    await add({ user: B, id: SIM("1"), tradeId: null, over: {} });
    await db.query(`delete from public.simulations where user_id = $1 and id = $2`, [B, SIM("1")]);
  });
});

describe("0011: nur die eigenen Zeilen", () => {
  it("jeder liest nur seine; anon gar nichts", async () => {
    expect(await mine(A)).toEqual([SIM("1")]);
    expect(await mine(B)).toEqual([SIM("2")]);
    await expect(as(null, `select id from public.simulations`, [], "anon")).rejects.toThrow(/permission denied/);
  });

  it("schreiben für einen anderen Nutzer scheitert (insert und update)", async () => {
    const { sql, params } = insertSql({ id: SIM("4") });
    params[0] = B;
    params[1] = SIM("4");
    await expect(as(jwt(A), sql, params)).rejects.toThrow(/row-level security/);
    // an update of someone else's row touches nothing
    await as(jwt(A), `update public.simulations set symbol = 'ETHUSDT' where id = $1`, [SIM("2")]);
    expect((await db.query<{ symbol: string }>(`select symbol from public.simulations where id = $1`, [SIM("2")])).rows[0]!.symbol).toBe("BTCUSDT");
  });

  it("der Nutzer schreibt, ändert und löscht seine eigenen (Upsert per PostgREST-Schlüssel)", async () => {
    const { sql, params } = insertSql({ id: SIM("5"), trade_id: null });
    params[0] = A;
    params[1] = SIM("5");
    await as(jwt(A), sql, params);
    expect(await mine(A)).toEqual([SIM("1"), SIM("5")]);
    await as(jwt(A), `update public.simulations set trade_id = 't_neu' where id = $1`, [SIM("5")]);
    expect((await db.query<{ trade_id: string }>(`select trade_id from public.simulations where id = $1 and user_id = $2`, [SIM("5"), A])).rows[0]!.trade_id).toBe("t_neu");
    await as(jwt(A), `delete from public.simulations where id = $1`, [SIM("5")]);
    expect(await mine(A)).toEqual([SIM("1")]);
    // delete of someone else's row touches nothing
    await as(jwt(A), `delete from public.simulations where id = $1`, [SIM("2")]);
    expect(await mine(B)).toEqual([SIM("2")]);
  });

  it("created_at bleibt, updated_at ist die Uhr der Datenbank", async () => {
    const before = (await db.query<{ c: string }>(`select created_at::text as c from public.simulations where id = $1 and user_id = $2`, [SIM("1"), A])).rows[0]!.c;
    await db.query(`update public.simulations set created_at = '2000-01-01', updated_at = '2000-01-01', symbol = 'BTCUSDT' where id = $1 and user_id = $2`, [SIM("1"), A]);
    const r = (await db.query<{ c: string; ago: number }>(`select created_at::text as c, extract(epoch from (now() - updated_at))::float as ago from public.simulations where id = $1 and user_id = $2`, [SIM("1"), A])).rows[0]!;
    expect(r.c).toBe(before);
    expect(r.ago).toBeLessThan(60);
  });
});

describe("0011: Konto mit 2FA", () => {
  it("aal1 sieht und schreibt nichts, aal2 sieht die eigenen", async () => {
    expect(await mine(T, "aal1")).toEqual([]);
    const { sql, params } = insertSql({ id: SIM("6") });
    params[0] = T;
    params[1] = SIM("6");
    await expect(as(jwt(T, "aal1"), sql, params)).rejects.toThrow(/row-level security/);
    expect(await mine(T, "aal2")).toEqual([SIM("3")]);
    await as(jwt(T, "aal2"), sql, params);
    expect(await mine(T, "aal2")).toEqual([SIM("3"), SIM("6")]);
  });
});

describe("0011: Konto löschen", () => {
  it("löscht die Simulationen des Nutzers mit (cascade), die der anderen nicht", async () => {
    await db.query(`delete from auth.users where id = $1`, [A]);
    expect((await db.query<{ n: number }>(`select count(*)::int as n from public.simulations where user_id = $1`, [A])).rows[0]!.n).toBe(0);
    expect((await db.query<{ n: number }>(`select count(*)::int as n from public.simulations where user_id = $1`, [B])).rows[0]!.n).toBe(1);
  });
});
