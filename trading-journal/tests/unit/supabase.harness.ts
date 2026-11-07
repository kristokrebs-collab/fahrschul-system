/// <reference types="node" />
/**
 * Shared PGlite boot for the RLS audit and the two-user isolation test (B1): a real Postgres with a minimal Supabase shim
 * (roles anon / authenticated / service_role, Supabase's default grants on new public tables, `auth.users`,
 * `auth.mfa_factors`, `auth.sessions`, `auth.jwt()` / `auth.uid()` from `request.jwt.claims`, a `storage` schema with
 * `storage.foldername()`), then EVERY file in `supabase/migrations` in order – read from the directory, so a later migration
 * (connections, signals, alerts …) is loaded and audited without touching this file. A query runs as a role with the claims
 * of a JWT, exactly like PostgREST / Storage do.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";

export const MIG_DIR = join(__dirname, "../../supabase/migrations");

/** Migration file names (`0001_core.sql` …), sorted. */
export function migrationFiles(): string[] {
  return readdirSync(MIG_DIR)
    .filter((f) => /^\d{4}_.+\.sql$/.test(f))
    .sort();
}

export const SHIM = `
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
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, metadata jsonb);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
grant execute on function storage.foldername(text) to authenticated;
grant select, insert, update, delete on storage.objects to authenticated;
`;

export interface Db {
  db: PGlite;
  /** Runs `sql` as `authenticated` with the claims of a JWT, or as `service_role` when `claims` is null. */
  as<T = Record<string, unknown>>(claims: Record<string, unknown> | null, sql: string): Promise<T[]>;
  /** Runs `sql` as `anon`. */
  anon<T = Record<string, unknown>>(sql: string): Promise<T[]>;
  /** Several statements as the service role (what the functions write). */
  service(sql: string): Promise<void>;
  /** The plain catalog (no role switching). */
  catalog<T = Record<string, unknown>>(sql: string): Promise<T[]>;
}

export async function bootDb(): Promise<Db> {
  const db = new PGlite();
  await db.exec(SHIM);
  for (const f of migrationFiles()) await db.exec(readFileSync(join(MIG_DIR, f), "utf8"));
  const run = async <T>(role: string, claims: Record<string, unknown>, sql: string): Promise<T[]> => {
    await db.exec(`reset role; select set_config('request.jwt.claims', '${JSON.stringify(claims)}', false); set role ${role};`);
    try {
      return (await db.query<T>(sql)).rows;
    } finally {
      await db.exec("reset role;");
    }
  };
  return {
    db,
    as: (claims, sql) => run(claims ? "authenticated" : "service_role", claims ?? {}, sql),
    anon: (sql) => run("anon", {}, sql),
    service: async (sql) => {
      await db.exec(`reset role; set role service_role; ${sql}; reset role;`);
    },
    catalog: async (sql) => (await db.query(sql)).rows as never,
  };
}

export const jwt = (sub: string, aal: "aal1" | "aal2" = "aal1"): Record<string, unknown> => ({ sub, role: "authenticated", aal });
