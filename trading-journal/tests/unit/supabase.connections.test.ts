// @vitest-environment node
/// <reference types="node" />
/**
 * Migration 0012 (Verbindungen: Empfangsprotokoll des TradingView-Webhooks) on a real Postgres (PGlite) with the same
 * minimal Supabase shim as `supabase.cases.test.ts`: RLS (a user reads only their own receipts, anon nothing), a client
 * can write nothing, the service role writes, the checks (kind, via, lengths), the aal2 rule, the cascade on account
 * deletion – and that Binance connections fit the existing `exchange_connections` table without a schema change.
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

const id = (n: number) => `${String(n).padStart(8, "0")}-0000-4000-8000-${String(n).padStart(12, "0")}`;
const A = id(1);
const B = id(2);

let db: PGlite;

async function as<T = Record<string, unknown>>(claims: Record<string, unknown> | null, sql: string, params: unknown[] = [], role: "authenticated" | "anon" | "service_role" = "authenticated"): Promise<T[]> {
  await db.exec(`reset role; select set_config('request.jwt.claims', '${JSON.stringify(claims ?? {})}', false); set role ${role};`);
  try {
    return (await db.query<T>(sql, params)).rows;
  } finally {
    await db.exec("reset role;");
  }
}
const jwt = (sub: string, aal: "aal1" | "aal2" = "aal1") => ({ sub, role: "authenticated", aal });
const receipt = (user: string, over: Record<string, unknown> = {}) =>
  db.query(`insert into public.webhook_receipts (user_id, kind, via, symbol, detail) values ($1, $2, $3, $4, $5)`, [user, over.kind ?? "test", over.via ?? "app", over.symbol ?? "BTCUSDT", over.detail ?? null]);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SHIM);
  for (const f of readdirSync(MIG_DIR).filter((x) => /^\d{4}_.+\.sql$/.test(x)).sort()) await db.exec(readFileSync(join(MIG_DIR, f), "utf8"));
  await db.exec(`insert into auth.users (id, email) values ('${A}', 'a@x.test'), ('${B}', 'b@x.test')`);
  await receipt(A, { kind: "test", via: "app", symbol: "TEST" });
  await receipt(A, { kind: "rejected", via: "extern", symbol: null, detail: "402 Tarif" });
  await receipt(B, { kind: "open", via: "extern", symbol: "ETHUSDT" });
}, 60_000);

afterAll(async () => {
  await db?.close();
});

describe("0012: webhook_receipts", () => {
  it("a user reads only their own receipts; anon reads nothing", async () => {
    expect((await as<{ kind: string }>(jwt(A), `select kind from public.webhook_receipts order by kind`)).map((r) => r.kind)).toEqual(["rejected", "test"]);
    expect((await as<{ kind: string }>(jwt(B), `select kind from public.webhook_receipts`)).map((r) => r.kind)).toEqual(["open"]);
    await expect(as(null, `select id from public.webhook_receipts`, [], "anon")).rejects.toThrow(/permission denied/);
  });

  it("a client can write nothing – not even its own rows", async () => {
    await expect(as(jwt(A), `insert into public.webhook_receipts (user_id, kind) values ('${A}', 'test')`)).rejects.toThrow(/permission denied/);
    await expect(as(jwt(A), `update public.webhook_receipts set kind = 'open'`)).rejects.toThrow(/permission denied/);
    await expect(as(jwt(A), `delete from public.webhook_receipts`)).rejects.toThrow(/permission denied/);
  });

  it("the service role writes (that is the function)", async () => {
    await as(null, `insert into public.webhook_receipts (user_id, kind, via, symbol) values ('${A}', 'close', 'extern', 'BTCUSDT')`, [], "service_role");
    expect((await as<{ n: number }>(jwt(A), `select count(*)::int as n from public.webhook_receipts`))[0]!.n).toBe(3);
  });

  it("refuses what is not a receipt: unknown kind or source, over-long symbol or detail", async () => {
    await expect(receipt(A, { kind: "hack" })).rejects.toThrow(/check constraint/);
    await expect(receipt(A, { via: "elsewhere" })).rejects.toThrow(/check constraint/);
    await expect(receipt(A, { symbol: "X".repeat(41) })).rejects.toThrow(/check constraint/);
    await expect(receipt(A, { detail: "y".repeat(201) })).rejects.toThrow(/check constraint/);
    await expect(db.query(`insert into public.webhook_receipts (user_id, kind, source) values ($1, 'test', 'other')`, [A])).rejects.toThrow(/check constraint/);
  });

  it("a 2FA user's password-only session sees no receipts; aal2 does", async () => {
    await db.exec(`insert into auth.mfa_factors (user_id, status) values ('${B}', 'verified')`);
    expect(await as(jwt(B, "aal1"), `select id from public.webhook_receipts`)).toEqual([]);
    expect(await as(jwt(B, "aal2"), `select id from public.webhook_receipts`)).toHaveLength(1);
  });

  it("deleting the account removes the receipts", async () => {
    await db.exec(`delete from auth.users where id = '${B}'`);
    expect((await db.query(`select 1 from public.webhook_receipts where user_id = $1`, [B])).rows).toHaveLength(0);
  });
});

describe("Binance needs no schema change", () => {
  it("exchange_connections accepts exchange 'binance' with the market in the server-only meta; spot and futures live side by side", async () => {
    const mk = (label: string, market: string) =>
      db.query(`insert into public.exchange_connections (user_id, exchange, label, api_key_enc, secret_enc, key_last4, permissions, meta) values ($1, 'binance', $2, 'v1:a:b:c', 'v1:a:b:c', 'abcd', '{read}', $3::jsonb)`, [A, label, JSON.stringify({ market })]);
    await mk("Spot", "spot");
    await mk("Futures", "futures");
    await expect(mk("Futures", "futures")).rejects.toThrow(/unique|duplicate/);
    // a client can read the metadata of its own connections, but neither the key blobs nor the meta column
    await expect(as(jwt(A), `select api_key_enc from public.exchange_connections`)).rejects.toThrow(/permission denied/);
    await expect(as(jwt(A), `select meta from public.exchange_connections`)).rejects.toThrow(/permission denied/);
    expect((await as<{ label: string }>(jwt(A), `select label from public.exchange_connections order by label`)).map((r) => r.label)).toEqual(["Futures", "Spot"]);
  });
});
