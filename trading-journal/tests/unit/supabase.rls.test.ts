// @vitest-environment node
/// <reference types="node" />
/**
 * The SQL migrations (supabase/migrations/0001 – latest) on a real Postgres (PGlite) with a minimal Supabase shim:
 * roles anon / authenticated / service_role, Supabase's default grants on new public tables, `auth.users`,
 * `auth.mfa_factors`, `auth.jwt()` / `auth.uid()` from `request.jwt.claims`, and a `storage` schema with
 * `storage.foldername()`. Each query runs as a role with the claims of a JWT, exactly like PostgREST / Storage do.
 *
 * Review SEC-01: a password-only session (aal1) of a user WITH a verified TOTP factor must not reach any account data –
 * screenshots (read + write), audit trail, share tokens, API tokens, billing rows, community rows.
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
create table storage.buckets (id text primary key, name text, public boolean);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
grant execute on function storage.foldername(text) to authenticated;
grant select, insert, update, delete on storage.objects to authenticated;
`;

/** A: 2FA on (verified factor). B: no 2FA. C: co-member / mentor of A. */
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const G = "99999999-9999-4999-8999-999999999999";

let db: PGlite;

async function as<T = Record<string, unknown>>(claims: Record<string, unknown> | null, sql: string): Promise<T[]> {
  const role = claims ? "authenticated" : "service_role";
  await db.exec(`reset role; select set_config('request.jwt.claims', '${JSON.stringify(claims ?? {})}', false); set role ${role};`);
  try {
    return (await db.query<T>(sql)).rows;
  } finally {
    await db.exec("reset role;");
  }
}
const jwt = (sub: string, aal: "aal1" | "aal2") => ({ sub, role: "authenticated", aal });
/** Several statements as the service role (the functions' writes). */
async function service(sql: string): Promise<void> {
  await db.exec(`reset role; set role service_role; ${sql}; reset role;`);
}

/** Tables an aal1 session of a 2FA user must not read, with a row of A seeded in each. */
const GUARDED = [
  "journal_docs",
  "exchange_connections",
  "audit_log",
  "subscriptions",
  "team_seats",
  "referral_codes",
  "referrals",
  "affiliate_ledger",
  "api_tokens",
  "social_profiles",
  "group_invites",
  "group_goals",
  "shares",
  "feedback",
  "member_stats",
  "groups",
  "group_members",
] as const;

/** Column list a client may select (some tables only grant some columns). */
const COLS: Partial<Record<(typeof GUARDED)[number], string>> = {
  exchange_connections: "id",
  referrals: "id",
  affiliate_ledger: "id",
  api_tokens: "id",
  feedback: "id",
};

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SHIM);
  const files = readdirSync(MIG_DIR)
    .filter((f) => /^\d{4}_.+\.sql$/.test(f))
    .sort();
  for (const f of files) await db.exec(readFileSync(join(MIG_DIR, f), "utf8"));

  await db.exec(`insert into auth.users (id, email) values ('${A}', 'a@x.test'), ('${B}', 'b@x.test'), ('${C}', 'c@x.test');
    insert into auth.mfa_factors (user_id, status) values ('${A}', 'verified'), ('${B}', 'unverified');`);
  // A's data in every guarded table (service role, like the functions write it)
  await service(
    `insert into public.journal_docs (user_id, kind, id, data) values ('${A}', 'trade', 't_1', '{"pnl":1234}'), ('${B}', 'trade', 't_2', '{}');
     insert into public.exchange_connections (user_id, exchange, api_key_enc, secret_enc) values ('${A}', 'bitunix', 'v1:x', 'v1:y');
     insert into public.audit_log (user_id, action) values ('${A}', 'exchange.connect'), ('${B}', 'auth.signin');
     insert into public.subscriptions (id, user_id, stripe_customer_id, status, plan, seats) values ('sub_A', '${A}', 'cus_A', 'active', 'team', 5);
     insert into public.team_seats (owner_id, member_id) values ('${A}', '${C}');
     insert into public.referral_codes (user_id, code, commission_pct) values ('${A}', 'AAAAAA11', 25);
     insert into public.referrals (referrer_id, referred_id, code) values ('${A}', '${C}', 'AAAAAA11');
     insert into public.affiliate_ledger (referrer_id, kind, amount, stripe_invoice_id) values ('${A}', 'commission', 600, 'in_1');
     insert into public.api_tokens (user_id, token_hash, prefix) values ('${A}', '${"a".repeat(64)}', 'tj_abcd');
     insert into public.social_profiles (user_id, pseudonym) values ('${A}', 'Stiller Falke 27'), ('${C}', 'Kluger Wolf 12');
     insert into public.groups (id, kind, name, owner_id) values ('${G}', 'mentor', 'Mentoring', '${A}');
     insert into public.group_members (group_id, user_id, role) values ('${G}', '${A}', 'owner'), ('${G}', '${C}', 'student');
     insert into public.group_invites (code, group_id, created_by) values ('ABCDEFGH12', '${G}', '${A}');
     insert into public.group_goals (group_id, mentor_id, student_id, draft) values ('${G}', '${A}', '${C}', '{}');
     insert into public.shares (token, user_id, kind, payload) values ('${"a".repeat(22)}', '${A}', 'trade', '{"v":1}'), ('${"b".repeat(22)}', '${B}', 'trade', '{"v":1}');
     insert into public.feedback (user_id, kind, message) values ('${A}', 'idea', 'Mehr Boxen bitte');
     insert into public.member_stats (user_id) values ('${A}')`,
  );
  await db.exec(`insert into storage.objects (bucket_id, name) values ('screenshots', '${A}/t_1/shot.png'), ('screenshots', '${B}/t_2/shot.png')`);
}, 60_000);

afterAll(async () => {
  await db?.close();
});

describe("aal2 rule (SEC-01): a 2FA user's password-only session reaches nothing", () => {
  it.each(GUARDED)("%s: hidden from aal1, visible with aal2", async (table) => {
    const cols = COLS[table] ?? "*";
    expect(await as(jwt(A, "aal1"), `select ${cols} from public.${table}`)).toHaveLength(0);
    expect((await as(jwt(A, "aal2"), `select ${cols} from public.${table}`)).length).toBeGreaterThan(0);
  });

  it("screenshots: no read, no upload, no overwrite, no delete with aal1 – all of it with aal2", async () => {
    const list = `select name from storage.objects where bucket_id = 'screenshots'`;
    expect(await as(jwt(A, "aal1"), list)).toEqual([]);
    await expect(as(jwt(A, "aal1"), `insert into storage.objects (bucket_id, name) values ('screenshots', '${A}/x/evil.png')`)).rejects.toThrow(/row-level security/);
    expect(await as(jwt(A, "aal1"), `update storage.objects set name = '${A}/t_1/moved.png' where bucket_id = 'screenshots' returning name`)).toEqual([]);
    expect(await as(jwt(A, "aal1"), `delete from storage.objects where bucket_id = 'screenshots' returning name`)).toEqual([]);

    expect(await as(jwt(A, "aal2"), list)).toEqual([{ name: `${A}/t_1/shot.png` }]);
    expect(await as(jwt(A, "aal2"), `insert into storage.objects (bucket_id, name) values ('screenshots', '${A}/t_9/new.png') returning name`)).toHaveLength(1);
    expect(await as(jwt(A, "aal2"), `delete from storage.objects where bucket_id = 'screenshots' and name = '${A}/t_9/new.png' returning name`)).toHaveLength(1);
  });

  it("screenshots: aal2 still never reaches another user's folder", async () => {
    expect(await as(jwt(A, "aal2"), `select name from storage.objects where name like '${B}/%'`)).toEqual([]);
    await expect(as(jwt(A, "aal2"), `insert into storage.objects (bucket_id, name) values ('screenshots', '${B}/x/evil.png')`)).rejects.toThrow(/row-level security/);
  });

  it("a user without a verified factor keeps working with aal1 (2FA is opt-in)", async () => {
    expect(await as(jwt(B, "aal1"), `select id from public.journal_docs`)).toEqual([{ id: "t_2" }]);
    expect(await as(jwt(B, "aal1"), `select name from storage.objects`)).toEqual([{ name: `${B}/t_2/shot.png` }]);
    expect(await as(jwt(B, "aal1"), `select action from public.audit_log`)).toEqual([{ action: "auth.signin" }]);
    expect(await as(jwt(B, "aal1"), `select token from public.shares`)).toEqual([{ token: "b".repeat(22) }]);
    expect(await as(jwt(B, "aal1"), `insert into storage.objects (bucket_id, name) values ('screenshots', '${B}/t_3/ok.png') returning name`)).toHaveLength(1);
  });

  it("profiles stay readable with aal1 (privacy opt-ins are read before the code step)", async () => {
    expect(await as(jwt(A, "aal1"), `select plan, privacy from public.profiles`)).toEqual([{ plan: "free", privacy: {} }]);
  });

  it("anon reaches none of the guarded tables", async () => {
    await db.exec(`reset role; select set_config('request.jwt.claims', '{}', false); set role anon;`);
    try {
      for (const t of GUARDED) await expect(db.query(`select ${COLS[t] ?? "*"} from public.${t}`)).rejects.toThrow(/permission denied/);
    } finally {
      await db.exec("reset role;");
    }
  });
});
