// @vitest-environment node
/// <reference types="node" />
/**
 * Migration 0013 (Signal-Empfänger, B3) on a real Postgres (PGlite) with the same minimal Supabase shim as `supabase.connections.test.ts`:
 * RLS (an owner reads only their own signals, anon nothing), a client writes nothing, the service role writes, the DEDUP unique index (one
 * processed signal per user + source + signal id; duplicates and refusals may repeat), the checks, the "processed is complete" rule, the aal2
 * rule, the cascade – and that the OAuth tables (`tv_mcp_*`) cannot be read or written by any client at all.
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

const sig = (user: string, over: Record<string, unknown> = {}) => {
  const o = { source: "tradingview", signal_id: "s-1", kind: "signal", status: "processed", direction: "long", signal_time: "2026-11-06T21:00:00Z", symbol: "XLE", data: null as unknown, reason: null, schema_id: "signal/1", ...over };
  return db.query(
    `insert into public.signals (user_id, source, signal_id, kind, status, reason, schema_id, symbol, direction, signal_time, data) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)`,
    [user, o.source, o.signal_id, o.kind, o.status, o.reason, o.schema_id, o.symbol, o.direction, o.signal_time, o.data === null ? null : JSON.stringify(o.data)],
  );
};

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SHIM);
  for (const f of readdirSync(MIG_DIR).filter((x) => /^\d{4}_.+\.sql$/.test(x)).sort()) await db.exec(readFileSync(join(MIG_DIR, f), "utf8"));
  await db.exec(`insert into auth.users (id, email) values ('${A}', 'a@x.test'), ('${B}', 'b@x.test')`);
  await sig(A, { signal_id: "a-1" });
  await sig(A, { signal_id: "a-2", direction: "flat" });
  await sig(B, { signal_id: "b-1" });
}, 60_000);

afterAll(async () => {
  await db?.close();
});

describe("0013: signals", () => {
  it("an owner reads only their own signals; anon reads nothing", async () => {
    expect((await as<{ signal_id: string }>(jwt(A), `select signal_id from public.signals order by signal_id`)).map((r) => r.signal_id)).toEqual(["a-1", "a-2"]);
    expect((await as<{ signal_id: string }>(jwt(B), `select signal_id from public.signals`)).map((r) => r.signal_id)).toEqual(["b-1"]);
    await expect(as(null, `select id from public.signals`, [], "anon")).rejects.toThrow(/permission denied/);
  });

  it("a client can write nothing – not even its own rows", async () => {
    await expect(as(jwt(A), `insert into public.signals (user_id, source, kind, status) values ('${A}', 'tradingview', 'test', 'processed')`)).rejects.toThrow(/permission denied/);
    await expect(as(jwt(A), `update public.signals set direction = 'flat'`)).rejects.toThrow(/permission denied/);
    await expect(as(jwt(A), `delete from public.signals`)).rejects.toThrow(/permission denied/);
  });

  it("the service role writes (that is the function)", async () => {
    await as(null, `insert into public.signals (user_id, source, kind, status) values ('${A}', 'tradingview', 'test', 'processed')`, [], "service_role");
    expect((await as<{ n: number }>(jwt(A), `select count(*)::int as n from public.signals`))[0]!.n).toBe(3);
  });

  it("DEDUP: a second PROCESSED signal with the same (user, source, signal id) is a unique violation – for another user, source or id it is not", async () => {
    await expect(sig(A, { signal_id: "a-1" })).rejects.toThrow(/unique|duplicate/);
    await sig(B, { signal_id: "a-1" });
    await sig(A, { signal_id: "a-1", source: "n8n" });
    await sig(A, { signal_id: "a-3" });
  });

  it("the delivery of a duplicate and refused bodies are rows too and may repeat (only 'processed' signals are unique)", async () => {
    await sig(A, { signal_id: "a-1", status: "duplicate", reason: "Dieses Signal ist schon angekommen." });
    await sig(A, { signal_id: "a-1", status: "duplicate", reason: "Dieses Signal ist schon angekommen." });
    await sig(A, { signal_id: null, status: "rejected", direction: null, signal_time: null, symbol: null, reason: "kein JSON" });
    await sig(A, { signal_id: null, status: "rejected", direction: null, signal_time: null, symbol: null, reason: "kein JSON" });
    await sig(A, { signal_id: null, kind: "test", direction: null, signal_time: null, schema_id: null });
    await sig(A, { signal_id: null, kind: "test", direction: null, signal_time: null, schema_id: null });
  });

  it("a processed real signal is complete (id, direction, time); a test needs none of them", async () => {
    await expect(sig(A, { signal_id: null })).rejects.toThrow(/check constraint/);
    await expect(sig(A, { signal_id: "z-1", direction: null })).rejects.toThrow(/check constraint/);
    await expect(sig(A, { signal_id: "z-2", signal_time: null })).rejects.toThrow(/check constraint/);
  });

  it("refuses what is not a signal: unknown status, kind, schema, direction; over-long fields; a bad source alphabet; a large data document", async () => {
    await expect(sig(A, { signal_id: "q1", status: "maybe" })).rejects.toThrow(/check constraint/);
    await expect(sig(A, { signal_id: "q2", kind: "order" })).rejects.toThrow(/check constraint/);
    await expect(sig(A, { signal_id: "q3", schema_id: "signal/2" })).rejects.toThrow(/check constraint/);
    await expect(sig(A, { signal_id: "q4", direction: "short" })).rejects.toThrow(/check constraint/);
    await expect(sig(A, { signal_id: "q5", symbol: "X".repeat(41) })).rejects.toThrow(/check constraint/);
    await expect(sig(A, { signal_id: "q6", source: "Trading View" })).rejects.toThrow(/check constraint/);
    await expect(sig(A, { signal_id: "x".repeat(81) })).rejects.toThrow(/check constraint/);
    await expect(sig(A, { signal_id: "q7", reason: "r".repeat(201), status: "rejected", direction: null })).rejects.toThrow(/check constraint/);
    await expect(sig(A, { signal_id: "q8", data: { note: "d".repeat(2100) } })).rejects.toThrow(/check constraint/);
    await expect(sig(A, { signal_id: "q9", data: [1] })).rejects.toThrow(/check constraint/);
  });

  it("there is no column for an order size", async () => {
    const cols = (await db.query<{ column_name: string }>(`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'signals'`)).rows.map((r) => r.column_name);
    expect(cols.length).toBeGreaterThan(10);
    expect(cols.filter((c) => /qty|size|amount|quantity|leverage|contracts/.test(c))).toEqual([]);
  });

  it("the dedup key is indexed (partial unique index) and so is the owner's list", async () => {
    const idx = (await db.query<{ indexname: string; indexdef: string }>(`select indexname, indexdef from pg_indexes where tablename = 'signals'`)).rows;
    expect(idx.find((i) => i.indexname === "signals_dedup")!.indexdef).toMatch(/UNIQUE.*\(user_id, source, signal_id\).*processed/);
    expect(idx.some((i) => i.indexname === "signals_user_received")).toBe(true);
  });

  it("a 2FA user's password-only session sees no signals; aal2 does", async () => {
    await db.exec(`insert into auth.mfa_factors (user_id, status) values ('${B}', 'verified')`);
    expect(await as(jwt(B, "aal1"), `select id from public.signals`)).toEqual([]);
    expect((await as(jwt(B, "aal2"), `select id from public.signals`)).length).toBeGreaterThan(0);
  });
});

describe("0013: the OAuth tables are server-only", () => {
  const blob = "v1:aaaaaaaaaaaaaaaa:bbbbbbbbbbbbbbbbbbbbbbbb:cccc";

  it("no client – not even the owner – can read, write or delete tv_mcp_connections / tv_mcp_states", async () => {
    await as(null, `insert into public.tv_mcp_connections (user_id, client_id, resource, access_enc, refresh_enc) values ('${A}', 'c', 'https://mcp.example/mcp', '${blob}', '${blob}')`, [], "service_role");
    await as(null, `insert into public.tv_mcp_states (state_hash, user_id, verifier_enc, expires_at) values ('${"a".repeat(64)}', '${A}', '${blob}', now() + interval '10 minutes')`, [], "service_role");
    for (const t of ["tv_mcp_connections", "tv_mcp_states"]) {
      await expect(as(jwt(A), `select * from public.${t}`)).rejects.toThrow(/permission denied/);
      await expect(as(jwt(A), `delete from public.${t}`)).rejects.toThrow(/permission denied/);
      await expect(as(null, `select * from public.${t}`, [], "anon")).rejects.toThrow(/permission denied/);
    }
    await expect(as(jwt(A), `insert into public.tv_mcp_connections (user_id, client_id, resource, access_enc) values ('${B}', 'c', 'r', 'x')`)).rejects.toThrow(/permission denied/);
    await expect(as(jwt(A), `update public.tv_mcp_connections set access_enc = 'x'`)).rejects.toThrow(/permission denied/);
  });

  it("one connection per user, a known status, a state hash of fixed shape, bounded blobs", async () => {
    await expect(as(null, `insert into public.tv_mcp_connections (user_id, client_id, resource, access_enc) values ('${A}', 'c', 'r', '${blob}')`, [], "service_role")).rejects.toThrow(/unique|duplicate/);
    await expect(as(null, `insert into public.tv_mcp_connections (user_id, client_id, resource, access_enc, status) values ('${B}', 'c', 'r', '${blob}', 'weird')`, [], "service_role")).rejects.toThrow(/check constraint/);
    await expect(as(null, `insert into public.tv_mcp_states (state_hash, user_id, verifier_enc, expires_at) values ('not-a-hash', '${A}', '${blob}', now())`, [], "service_role")).rejects.toThrow(/check constraint/);
    await expect(as(null, `insert into public.tv_mcp_connections (user_id, client_id, resource, access_enc) values ('${B}', 'c', 'r', '${"x".repeat(8001)}')`, [], "service_role")).rejects.toThrow(/check constraint/);
  });

  it("deleting the account removes signals, tokens and pending authorisations", async () => {
    await db.exec(`delete from auth.users where id = '${A}'`);
    for (const t of ["signals", "tv_mcp_connections", "tv_mcp_states"]) expect((await db.query(`select 1 from public.${t} where user_id = $1`, [A])).rows).toHaveLength(0);
  });
});
