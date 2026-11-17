// @vitest-environment node
/// <reference types="node" />
/**
 * Migration 0009 (Ergebnisbeleg F57, Rangliste: Datenherkunft + Drawdown F50/F71) on a real Postgres (PGlite) with the
 * same minimal Supabase shim as `supabase.rls.test.ts`: the new share kind and its larger (but bounded) payload, the new
 * columns and their checks, the metric 'drawdown' in the snapshots and the k-anonymous distributions – and that the RLS
 * of the tables did not move: the owner reads their proofs, nobody else does, the public reads one by token through the
 * service-role function only, and a client can write nothing.
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

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

let db: PGlite;

async function as<T = Record<string, unknown>>(role: "service_role" | "authenticated" | "anon", sql: string, params: unknown[] = [], claims: Record<string, unknown> = {}): Promise<T[]> {
  await db.exec(`reset role; select set_config('request.jwt.claims', '${JSON.stringify(claims)}', false); set role ${role};`);
  try {
    return (await db.query<T>(sql, params)).rows;
  } finally {
    await db.exec("reset role;");
  }
}
const asA = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => as<T>("authenticated", sql, params, { sub: A, role: "authenticated", aal: "aal1" });
const asB = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => as<T>("authenticated", sql, params, { sub: B, role: "authenticated", aal: "aal1" });

/** A proof payload with `n` trades, built like the client does. */
const proof = (n: number) => ({
  v: 1,
  kind: "proof",
  strategy: "Breakout 4h",
  basis: "live",
  from: "2026-01-01",
  to: "2026-12-31",
  scope: { only: null, inPeriod: n, open: 0 },
  trades: Array.from({ length: n }, (_, i) => ["2026-09-15", i % 3 ? 1.25 : -1, 0.045, "manual"]),
});

const insertShare = (user: string, token: string, kind: string, payload: unknown) =>
  db.query(`insert into public.shares (token, user_id, kind, payload) values ($1, $2, $3, $4::jsonb)`, [token, user, kind, JSON.stringify(payload)]);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SHIM);
  for (const f of readdirSync(MIG_DIR).filter((x) => /^\d{4}_.+\.sql$/.test(x)).sort()) await db.exec(readFileSync(join(MIG_DIR, f), "utf8"));
  await db.exec(`insert into auth.users (id, email) values ('${A}', 'a@x.test'), ('${B}', 'b@x.test')`);
}, 60_000);

afterAll(async () => {
  await db?.close();
});

describe("0009: shares of kind 'proof'", () => {
  it("accepts the new kind and still refuses an unknown one", async () => {
    await insertShare(A, "A".repeat(22), "proof", proof(3));
    await expect(insertShare(A, "B".repeat(22), "course", proof(3))).rejects.toThrow(/shares_kind_check|check constraint/);
  });

  it("a full proof of 500 trades fits; the size limit still bounds it (64 KB) and the other kinds keep 16 KB", async () => {
    await insertShare(A, "C".repeat(22), "proof", proof(500));
    // the check sees the plain value (the stored one is compressed – these rows repeat a lot)
    const size = (await db.query<{ n: number }>(`select pg_column_size($1::jsonb)::int as n`, [JSON.stringify(proof(500))])).rows[0]!.n;
    expect(size).toBeLessThan(65_536);
    expect(size).toBeGreaterThan(16_384); // would not have fitted before this migration
    await expect(insertShare(A, "D".repeat(22), "proof", proof(2500))).rejects.toThrow(/shares_payload_check|check constraint/);
    // a trade-sized payload above the old limit is still refused
    await expect(insertShare(A, "E".repeat(22), "trade", { v: 1, kind: "trade", pad: "x".repeat(20_000) })).rejects.toThrow(/shares_payload_check|check constraint/);
    await insertShare(A, "F".repeat(22), "trade", { v: 1, kind: "trade", pad: "x".repeat(200) });
    // the worst case the client can build (longest name and selection, four-digit R and costs, 500 trades) still fits
    const worst = { ...proof(500), strategy: "S".repeat(60), scope: { only: "G".repeat(40), inPeriod: 100_000, open: 99_999 }, trades: Array.from({ length: 500 }, (_, i) => ["2026-09-15", -12.34 - i / 1000, -0.123 - i / 100_000, "manual"]) };
    await insertShare(A, "W".repeat(22), "proof", worst);
    expect((await db.query<{ n: number }>(`select pg_column_size($1::jsonb)::int as n`, [JSON.stringify(worst)])).rows[0]!.n).toBeLessThan(65_536 / 1.5);
  });

  it("RLS did not move: the owner reads their proof, another user sees nothing, anon is refused, nobody writes", async () => {
    expect((await asA(`select token from public.shares where kind = 'proof'`)).length).toBeGreaterThanOrEqual(2);
    expect(await asB(`select token from public.shares`)).toEqual([]);
    await expect(as("anon", `select token from public.shares`)).rejects.toThrow(/permission denied/);
    await expect(asA(`insert into public.shares (token, user_id, kind, payload) values ('${"G".repeat(22)}', '${A}', 'proof', '{}'::jsonb)`)).rejects.toThrow(/permission denied/);
    await expect(asA(`update public.shares set revoked_at = now()`)).rejects.toThrow(/permission denied/);
    await expect(asA(`delete from public.shares`)).rejects.toThrow(/permission denied/);
  });

  it("the public read is shared_payload(): service role only, serves the complete list, counts the view, ends with the revoke", async () => {
    await expect(as("anon", `select * from public.shared_payload($1)`, ["A".repeat(22)])).rejects.toThrow(/permission denied/);
    await expect(asB(`select * from public.shared_payload($1)`, ["A".repeat(22)])).rejects.toThrow(/permission denied/);
    const rows = await as<{ kind: string; payload: { trades: unknown[] }; views: number }>("service_role", `select * from public.shared_payload($1)`, ["C".repeat(22)]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "proof", views: 1 });
    expect(rows[0]!.payload.trades).toHaveLength(500);
    await db.query(`update public.shares set revoked_at = now() where token = $1`, ["C".repeat(22)]);
    expect(await as("service_role", `select * from public.shared_payload($1)`, ["C".repeat(22)])).toEqual([]);
  });
});

describe("0009: drawdown and data class in the ranking tables", () => {
  it("member_stats takes a drawdown and a data class and checks both", async () => {
    await db.query(`insert into public.member_stats (user_id, trades, r_trades, eligible, max_dd_r, origin) values ($1, 30, 30, true, 4.25, 'api')`, [A]);
    await expect(db.query(`insert into public.member_stats (user_id, max_dd_r) values ($1, -1)`, [B])).rejects.toThrow(/check constraint/);
    await expect(db.query(`insert into public.member_stats (user_id, origin) values ($1, 'demo')`, [B])).rejects.toThrow(/check constraint/); // the app cannot know "demo"
    await db.query(`insert into public.member_stats (user_id, origin) values ($1, 'mixed')`, [B]);
    // a user reads only their own row, the new columns included
    expect(await asA<{ max_dd_r: string; origin: string }>(`select max_dd_r, origin from public.member_stats`)).toEqual([{ max_dd_r: "4.25", origin: "api" }]);
  });

  it("snapshots accept the metric 'drawdown' and the new columns, refuse an unknown metric, and stay closed to clients", async () => {
    await db.query(`insert into public.leaderboard_snapshots (day, metric, user_id, rank, value, trades, dd, origin) values ('2026-10-12', 'drawdown', $1, 1, 4.25, 30, 4.25, 'api')`, [A]);
    await db.query(`insert into public.leaderboard_snapshots (day, metric, user_id, rank, value, trades, dd, origin) values ('2026-10-12', 'expectancy', $1, 1, 0.5, 30, 4.25, 'api')`, [A]);
    await expect(db.query(`insert into public.leaderboard_snapshots (day, metric, user_id, rank, value, trades) values ('2026-10-12', 'pnl', $1, 1, 1, 30)`, [B])).rejects.toThrow(/check constraint/);
    await expect(db.query(`insert into public.leaderboard_snapshots (day, metric, user_id, rank, value, trades, dd) values ('2026-10-12', 'discipline', $1, 1, 1, 30, -2)`, [B])).rejects.toThrow(/check constraint/);
    await expect(asA(`select * from public.leaderboard_snapshots`)).rejects.toThrow(/permission denied/);
  });

  it("community_stats takes 'drawdown' but still refuses a distribution under 10 traders (k-anonymity)", async () => {
    await db.query(`insert into public.community_stats (day, metric, n, p10, p25, p50, p75, p90, mean) values ('2026-10-12', 'drawdown', 24, 1.5, 2.5, 4, 6, 9, 4.8)`);
    await expect(db.query(`insert into public.community_stats (day, metric, n, p10, p25, p50, p75, p90, mean) values ('2026-10-12', 'winrate', 9, 1, 2, 3, 4, 5, 3)`)).rejects.toThrow(/check constraint/);
    await expect(db.query(`insert into public.community_stats (day, metric, n, p10, p25, p50, p75, p90, mean) values ('2026-10-12', 'pnl', 24, 1, 2, 3, 4, 5, 3)`)).rejects.toThrow(/check constraint/);
    expect((await asB<{ metric: string }>(`select metric from public.community_stats`)).map((r) => r.metric)).toEqual(["drawdown"]);
  });

  it("a deleted account takes its proofs, figures and snapshot rows with it", async () => {
    await db.exec(`delete from auth.users where id = '${A}'`);
    expect((await db.query(`select 1 from public.shares where user_id = '${A}'`)).rows).toHaveLength(0);
    expect((await db.query(`select 1 from public.member_stats where user_id = '${A}'`)).rows).toHaveLength(0);
    expect((await db.query(`select 1 from public.leaderboard_snapshots where user_id = '${A}'`)).rows).toHaveLength(0);
  });
});
