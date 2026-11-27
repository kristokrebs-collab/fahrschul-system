// @vitest-environment node
/// <reference types="node" />
/**
 * Migration 0008 (E-Mail-Alarm, F21) on a real Postgres (PGlite) with the same minimal Supabase shim as
 * `supabase.rls.test.ts`: the candidate list only shows accounts whose switch is on, the write replaces ONLY
 * `data.serverAlerts` and only at the `rev` that was read, a client's sync write after the server's loses (and the other
 * way round), and a client can call neither function.
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

const A = "11111111-1111-4111-8111-111111111111"; // switch on, New York
const B = "22222222-2222-4222-8222-222222222222"; // switch off
const C = "33333333-3333-4333-8333-333333333333"; // no serverAlerts
const D = "44444444-4444-4444-8444-444444444444"; // switch on but the settings row is deleted
const E = "55555555-5555-4555-8555-555555555555"; // switch on, default zone

let db: PGlite;

async function as<T = Record<string, unknown>>(role: "service_role" | "authenticated" | "anon", sql: string, params: unknown[] = [], claims: Record<string, unknown> = {}): Promise<T[]> {
  await db.exec(`reset role; select set_config('request.jwt.claims', '${JSON.stringify(claims)}', false); set role ${role};`);
  try {
    return (await db.query<T>(sql, params)).rows;
  } finally {
    await db.exec("reset role;");
  }
}

const settings = (user: string, data: unknown, deleted = false) =>
  db.query(`insert into public.journal_docs (user_id, kind, id, data, deleted) values ($1, 'settings', 'settings', $2::jsonb, $3)`, [user, JSON.stringify(data), deleted]);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SHIM);
  for (const f of readdirSync(MIG_DIR).filter((x) => /^\d{4}_.+\.sql$/.test(x)).sort()) await db.exec(readFileSync(join(MIG_DIR, f), "utf8"));
  await db.exec(`insert into auth.users (id, email) values ('${A}', 'a@x.test'), ('${B}', 'b@x.test'), ('${C}', 'c@x.test'), ('${D}', 'd@x.test'), ('${E}', 'e@x.test')`);
  await db.exec(`update public.profiles set tz = 'America/New_York' where id = '${A}'`);
  await settings(A, { capital: { makro: 5 }, keyLevels: { v: 1, levels: [{ id: "k1" }] }, serverAlerts: { v: 1, email: true, maxPerDay: 6 }, studio: { keep: "me" } });
  await settings(B, { keyLevels: { v: 1, levels: [] }, serverAlerts: { v: 1, email: false } });
  await settings(C, { capital: { makro: 7 } });
  await settings(D, { serverAlerts: { v: 1, email: true } }, true);
  await settings(E, { serverAlerts: { v: 1, email: true }, keyLevels: null });
  await db.query(`insert into public.journal_docs (user_id, kind, id, data) values ($1, 'trade', 't_1', '{"serverAlerts":{"email":true}}'::jsonb)`, [B]);
}, 60_000);

afterAll(async () => {
  await db?.close();
});

describe("0008: alert_watch_candidates", () => {
  it("lists only the accounts whose switch is on and whose settings row is alive – with the parts the cron reads and the profile's zone", async () => {
    const rows = await as<{ user_id: string; rev: number; key_levels: unknown; server_alerts: unknown; tz: string }>("service_role", `select * from public.alert_watch_candidates(100, 'salt')`);
    expect(rows.map((r) => r.user_id).sort()).toEqual([A, E]);
    const a = rows.find((r) => r.user_id === A)!;
    expect(a).toMatchObject({ rev: 1, key_levels: { v: 1, levels: [{ id: "k1" }] }, server_alerts: { v: 1, email: true, maxPerDay: 6 }, tz: "America/New_York" });
    // only those parts: nothing else of the settings document is returned
    expect(Object.keys(a).sort()).toEqual(["key_levels", "rev", "server_alerts", "tz", "user_id"]);
    expect(rows.find((r) => r.user_id === E)).toMatchObject({ key_levels: null, tz: "Europe/Berlin" });
  });

  it("one account on request, a limit, and an order that rotates with the salt", async () => {
    expect(await as("service_role", `select user_id from public.alert_watch_candidates(100, '', $1)`, [A])).toEqual([{ user_id: A }]);
    expect(await as("service_role", `select user_id from public.alert_watch_candidates(1, 'x')`)).toHaveLength(1);
    const orders = new Set<string>();
    for (const salt of ["1", "2", "3", "4", "5", "6", "7", "8"]) orders.add((await as<{ user_id: string }>("service_role", `select user_id from public.alert_watch_candidates(100, $1)`, [salt])).map((r) => r.user_id).join());
    expect(orders.size).toBeGreaterThan(1);
    const same = async () => (await as<{ user_id: string }>("service_role", `select user_id from public.alert_watch_candidates(100, 'fixed')`)).map((r) => r.user_id).join();
    expect(await same()).toBe(await same());
  });

  it("uses the partial index on the switch", async () => {
    const idx = await as<{ indexdef: string }>("service_role", `select indexdef from pg_indexes where indexname = 'journal_docs_alert_email'`);
    expect(idx).toHaveLength(1);
    expect(idx[0]!.indexdef).toContain("serverAlerts");
    expect(idx[0]!.indexdef).toContain("WHERE");
  });

  it("is closed to every client role", async () => {
    await expect(as("authenticated", `select * from public.alert_watch_candidates()`, [], { sub: A, role: "authenticated" })).rejects.toThrow(/permission denied/);
    await expect(as("anon", `select * from public.alert_watch_candidates()`)).rejects.toThrow(/permission denied/);
  });
});

describe("0008: set_server_alerts", () => {
  const write = async (user: string, rev: number, value: unknown) => (await as<{ r: number | null }>("service_role", `select public.set_server_alerts($1, $2, $3::jsonb) as r`, [user, rev, JSON.stringify(value)]))[0]!.r;
  const doc = async (user: string) => (await as<{ data: Record<string, unknown>; rev: number; updated_at: string }>("service_role", `select data, rev, updated_at from public.journal_docs where user_id = $1 and kind = 'settings'`, [user]))[0]!;

  it("replaces ONLY data.serverAlerts, bumps the rev and the stamp, and leaves the rest of the document untouched", async () => {
    const before = await doc(A);
    const rev = await write(A, before.rev, { v: 1, email: true, maxPerDay: 6, mem: { k1: { fp: "x" } }, outbox: [] });
    expect(rev).toBe(before.rev + 1);
    const after = await doc(A);
    expect(after.rev).toBe(before.rev + 1);
    expect(after.data.serverAlerts).toEqual({ v: 1, email: true, maxPerDay: 6, mem: { k1: { fp: "x" } }, outbox: [] });
    expect({ ...after.data, serverAlerts: null }).toEqual({ ...before.data, serverAlerts: null });
    expect(after.updated_at >= before.updated_at).toBe(true);
  });

  it("a stale rev writes nothing and answers NULL – the cron then reads again", async () => {
    const cur = await doc(A);
    expect(await write(A, cur.rev - 1, { v: 1, email: true, lost: true })).toBeNull();
    expect((await doc(A)).data.serverAlerts).not.toMatchObject({ lost: true });
  });

  it("the sync's optimistic settings write and the server's write exclude each other in both directions", async () => {
    const seen = (await doc(E)).rev;
    // the server wins: the client's `update … where rev = $seen` finds nothing and goes into its merge3 retry
    expect(await write(E, seen, { v: 1, email: true, mem: {} })).toBe(seen + 1);
    const clientTry = await as("service_role", `update public.journal_docs set data = '{"serverAlerts":{"email":false}}'::jsonb where user_id = $1 and kind = 'settings' and id = 'settings' and rev = $2 returning rev`, [E, seen]);
    expect(clientTry).toEqual([]);
    // the client wins: the server's write with the old rev is refused
    const clientWon = await as<{ rev: number }>("service_role", `update public.journal_docs set data = data || '{"capital":{"makro":9}}'::jsonb where user_id = $1 and kind = 'settings' and id = 'settings' and rev = $2 returning rev`, [E, seen + 1]);
    expect(clientWon[0]!.rev).toBe(seen + 2);
    expect(await write(E, seen + 1, { v: 1, email: true, late: true })).toBeNull();
    expect((await doc(E)).data).toMatchObject({ capital: { makro: 9 }, serverAlerts: { v: 1, email: true, mem: {} } });
  });

  it("does nothing for a deleted row, a missing row, a non-object value or a settings document that is not an object", async () => {
    expect(await write(D, 1, { v: 1 })).toBeNull();
    expect(await write("99999999-9999-4999-8999-999999999999", 1, { v: 1 })).toBeNull();
    const cur = await doc(C);
    expect(await write(C, cur.rev, [1, 2])).toBeNull();
    await db.query(`update public.journal_docs set data = '[]'::jsonb where user_id = $1 and kind = 'settings'`, [C]);
    expect(await write(C, (await doc(C)).rev, { v: 1 })).toBeNull();
  });

  it("is closed to every client role", async () => {
    await expect(as("authenticated", `select public.set_server_alerts($1, 1, '{}'::jsonb)`, [A], { sub: A, role: "authenticated" })).rejects.toThrow(/permission denied/);
    await expect(as("anon", `select public.set_server_alerts($1, 1, '{}'::jsonb)`, [A])).rejects.toThrow(/permission denied/);
  });
});
