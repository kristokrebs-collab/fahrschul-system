// @vitest-environment node
/// <reference types="node" />
/**
 * Migration 0016 (Kaufstrecke: Zustimmungsnachweis + Kündigungs-/Widerrufserklärungen) on a real Postgres (PGlite) with the
 * Supabase shim of the other migration tests: RLS (a user reads only their own rows, anon nothing, a 2FA user only at aal2),
 * a client can write nothing, the service role writes, (user, order, kind) is unique (a double click writes nothing twice),
 * the checks (kind, hash, lengths, plan), the cascade on account deletion.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { consentHash } from "../../src/legal/consentRecord";
import { CONSENT_TEXT, CONSENT_TEXT_VERSION } from "../../src/legal/consentRecord";

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
const ORDER_1 = id(101);
const ORDER_2 = id(102);

let db: PGlite;
let HASH = "";

async function as<T = Record<string, unknown>>(
  claims: Record<string, unknown> | null,
  sql: string,
  params: unknown[] = [],
  role: "authenticated" | "anon" | "service_role" = "authenticated",
): Promise<T[]> {
  await db.exec(`reset role; select set_config('request.jwt.claims', '${JSON.stringify(claims ?? {})}', false); set role ${role};`);
  try {
    return (await db.query<T>(sql, params)).rows;
  } finally {
    await db.exec("reset role;");
  }
}
const jwt = (sub: string, aal: "aal1" | "aal2" = "aal1") => ({ sub, role: "authenticated", aal });

const consent = (user: string, order: string, kind: "terms" | "immediate_start", over: Record<string, unknown> = {}) =>
  db.query(
    `insert into public.consents (user_id, order_id, kind, text_hash, text_version, consent_text, plan, interval, seats) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [user, order, kind, over.hash ?? HASH, over.version ?? CONSENT_TEXT_VERSION, over.text ?? CONSENT_TEXT[kind], over.plan ?? "pro", over.interval ?? "month", over.seats ?? 1],
  );

beforeAll(async () => {
  HASH = await consentHash("immediate_start");
  db = new PGlite();
  await db.exec(SHIM);
  for (const f of readdirSync(MIG_DIR).filter((x) => /^\d{4}_.+\.sql$/.test(x)).sort()) await db.exec(readFileSync(join(MIG_DIR, f), "utf8"));
  await db.exec(`insert into auth.users (id, email) values ('${A}', 'a@x.test'), ('${B}', 'b@x.test')`);
  await consent(A, ORDER_1, "terms");
  await consent(A, ORDER_1, "immediate_start");
  await consent(B, ORDER_2, "immediate_start", { plan: "team", interval: "year", seats: 3 });
}, 60_000);

afterAll(async () => {
  await db?.close();
});

describe("0016: consents", () => {
  it("a user reads only their own evidence – with the exact wording that was shown; anon nothing", async () => {
    const mine = await as<{ kind: string; consent_text: string; text_version: string }>(jwt(A), `select kind, consent_text, text_version from public.consents order by kind`);
    expect(mine.map((r) => r.kind)).toEqual(["immediate_start", "terms"]);
    expect(mine[0]!.consent_text).toBe(CONSENT_TEXT.immediate_start);
    expect(mine[0]!.text_version).toBe(CONSENT_TEXT_VERSION);
    expect((await as<{ kind: string }>(jwt(B), `select kind from public.consents`)).map((r) => r.kind)).toEqual(["immediate_start"]);
    await expect(as(null, `select id from public.consents`, [], "anon")).rejects.toThrow(/permission denied/);
  });

  it("a client can write nothing – it cannot forge or erase its own evidence", async () => {
    await expect(as(jwt(A), `insert into public.consents (user_id, order_id, kind, text_hash, text_version, consent_text) values ('${A}', '${id(103)}', 'terms', '${HASH}', 'x', 'y')`)).rejects.toThrow(/permission denied/);
    await expect(as(jwt(A), `update public.consents set consent_text = 'x'`)).rejects.toThrow(/permission denied/);
    await expect(as(jwt(A), `delete from public.consents`)).rejects.toThrow(/permission denied/);
  });

  it("the service role writes; the same (user, order, kind) twice is refused (a double click never writes twice)", async () => {
    await as(null, `insert into public.consents (user_id, order_id, kind, text_hash, text_version, consent_text) values ('${A}', '${id(104)}', 'terms', '${HASH}', 'v', 'text')`, [], "service_role");
    await expect(consent(A, ORDER_1, "terms")).rejects.toThrow(/unique|duplicate/);
    // the function writes with ON CONFLICT DO NOTHING – that must be accepted
    await db.query(`insert into public.consents (user_id, order_id, kind, text_hash, text_version, consent_text) values ($1, $2, 'terms', $3, 'v', 't') on conflict (user_id, order_id, kind) do nothing`, [A, ORDER_1, HASH]);
    expect((await as<{ n: number }>(jwt(A), `select count(*)::int as n from public.consents where order_id = '${ORDER_1}'`))[0]!.n).toBe(2);
  });

  it("refuses what is not evidence: unknown kind, a hash that is not SHA-256, no wording, an unknown plan", async () => {
    await expect(db.query(`insert into public.consents (user_id, order_id, kind, text_hash, text_version, consent_text) values ($1, $2, 'other', $3, 'v', 't')`, [A, id(110), HASH])).rejects.toThrow(/check constraint/);
    await expect(consent(A, id(111), "terms", { hash: "abc" })).rejects.toThrow(/check constraint/);
    await expect(consent(A, id(112), "terms", { text: "" })).rejects.toThrow(/check constraint/);
    await expect(consent(A, id(113), "terms", { plan: "free" })).rejects.toThrow(/check constraint/);
    await expect(consent(A, id(114), "terms", { interval: "week" })).rejects.toThrow(/check constraint/);
  });

  it("a 2FA user's password-only session sees no evidence; aal2 does", async () => {
    await db.exec(`insert into auth.mfa_factors (user_id, status) values ('${B}', 'verified')`);
    expect(await as(jwt(B, "aal1"), `select id from public.consents`)).toEqual([]);
    expect(await as(jwt(B, "aal2"), `select id from public.consents`)).toHaveLength(1);
  });
});

describe("0016: contract_requests", () => {
  const sha = "a".repeat(64);
  const req = (over: Record<string, unknown> = {}) =>
    db.query(`insert into public.contract_requests (kind, user_id, email_hash, token_hash, status) values ($1, $2, $3, $4, $5)`, [over.kind ?? "cancel", over.user ?? A, over.hash ?? sha, over.token ?? null, over.status ?? "received"]);

  it("a user reads only their own declarations; a client writes nothing; the service role does", async () => {
    await as(null, `insert into public.contract_requests (kind, user_id, email_hash, token_hash) values ('withdraw', '${A}', '${sha}', '${"b".repeat(64)}')`, [], "service_role");
    expect((await as<{ kind: string }>(jwt(A), `select kind from public.contract_requests`)).map((r) => r.kind)).toEqual(["withdraw"]);
    expect(await as(jwt(B, "aal2"), `select kind from public.contract_requests`)).toEqual([]);
    await expect(as(jwt(A), `insert into public.contract_requests (kind, email_hash) values ('cancel', '${sha}')`)).rejects.toThrow(/permission denied/);
    await expect(as(jwt(A), `update public.contract_requests set status = 'executed'`)).rejects.toThrow(/permission denied/);
    await expect(as(null, `select id from public.contract_requests`, [], "anon")).rejects.toThrow(/permission denied/);
  });

  it("the link token is unique and only its hash is stored; an unknown kind or status is refused", async () => {
    await req({ token: "c".repeat(64) });
    await expect(req({ token: "c".repeat(64) })).rejects.toThrow(/unique|duplicate/);
    await expect(req({ kind: "pause" })).rejects.toThrow(/check constraint/);
    await expect(req({ status: "maybe" })).rejects.toThrow(/check constraint/);
    await expect(req({ hash: "plain@mail.test" })).rejects.toThrow(/check constraint/);
  });

  it("a declaration of an address with no account has no user (user_id null) and survives; deleting the account keeps the record without the link", async () => {
    await req({ user: null, status: "unknown" });
    await db.exec(`delete from auth.users where id = '${A}'`);
    expect((await db.query(`select 1 from public.contract_requests where user_id is null`)).rows.length).toBeGreaterThanOrEqual(2);
    // the consents of a deleted account go with it (cascade) – a point for the lawyer (retention vs. erasure, anwaltsfragen.md)
    expect((await db.query(`select 1 from public.consents where user_id = $1`, [A])).rows).toHaveLength(0);
  });
});
