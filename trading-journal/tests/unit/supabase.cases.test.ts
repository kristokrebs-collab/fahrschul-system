// @vitest-environment node
/// <reference types="node" />
/**
 * Migration 0010 (Chartfälle mit Hypothese vorab, F47) on a real Postgres (PGlite) with the same minimal Supabase shim as
 * `supabase.rls.test.ts`: who reads a case, who reads a hypothesis and when, the mentor-group rule, "written once" (also
 * against the service role), the database clock on every hypothesis, the aal2 rule, the cascades, the report target –
 * and that a client can write nothing.
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
const A = id(1); // owner of the peer group
const B = id(2); // member
const C = id(3); // member
const D = id(4); // outsider
const M = id(5); // owner of the mentor group (the mentor)
const S1 = id(6); // student
const S2 = id(7); // student
const G = id(8); // peer group
const GM = id(9); // mentor group

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

const addCase = async (caseId: string, group: string, author: string, over: Record<string, unknown> = {}) => {
  const o = { pair: "BTCUSDT", interval: "4h", anchor_ms: 1_760_000_000_000, horizon: 12, question: "Hält die Box?", closes_in: "24 hours", ...over };
  await db.query(`insert into public.group_cases (id, group_id, author_id, pair, interval, anchor_ms, horizon, question, closes_at) values ($1, $2, $3, $4, $5, $6, $7, $8, now() + $9::interval)`, [caseId, group, author, o.pair, o.interval, o.anchor_ms, o.horizon, o.question, o.closes_in]);
};
const addHyp = (caseId: string, user: string, over: Record<string, unknown> = {}) =>
  db.query(`insert into public.case_hypotheses (case_id, user_id, direction, confidence, reason) values ($1, $2, $3, $4, $5)`, [caseId, user, over.direction ?? "up", over.confidence ?? 70, over.reason ?? "Ausbruch mit Volumen über der Box"]);
const close = (caseId: string) => db.query(`update public.group_cases set closed_at = now() where id = $1`, [caseId]);
const hyps = async (user: string, caseId: string, aal: "aal1" | "aal2" = "aal1") => (await as<{ user_id: string }>(jwt(user, aal), `select user_id from public.case_hypotheses where case_id = $1 order by user_id`, [caseId])).map((r) => r.user_id);

const C1 = id(11); // peer case, author A, open
const C2 = id(12); // mentor case, author M, open

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SHIM);
  for (const f of readdirSync(MIG_DIR).filter((x) => /^\d{4}_.+\.sql$/.test(x)).sort()) await db.exec(readFileSync(join(MIG_DIR, f), "utf8"));
  await db.exec(`insert into auth.users (id, email) values ${[A, B, C, D, M, S1, S2].map((u, i) => `('${u}', 'u${i}@x.test')`).join(", ")}`);
  await db.exec(`
    insert into public.groups (id, kind, name, owner_id) values ('${G}', 'group', 'Morgenrunde', '${A}'), ('${GM}', 'mentor', 'Mentoring', '${M}');
    insert into public.group_members (group_id, user_id, role) values
      ('${G}', '${A}', 'owner'), ('${G}', '${B}', 'member'), ('${G}', '${C}', 'member'),
      ('${GM}', '${M}', 'owner'), ('${GM}', '${S1}', 'student'), ('${GM}', '${S2}', 'student');`);
  await addCase(C1, G, A);
  await addCase(C2, GM, M);
}, 60_000);

afterAll(async () => {
  await db?.close();
});

describe("0010: tables and checks", () => {
  it("refuses what is not a case", async () => {
    const bad = (over: Record<string, unknown>) => addCase(id(90), G, A, over);
    await expect(bad({ pair: "btc usdt" })).rejects.toThrow(/check constraint/);
    await expect(bad({ pair: "BTC" })).rejects.toThrow(/check constraint/);
    await expect(bad({ interval: "5m" })).rejects.toThrow(/check constraint/);
    await expect(bad({ horizon: 7 })).rejects.toThrow(/check constraint/);
    await expect(bad({ anchor_ms: 1000 })).rejects.toThrow(/check constraint/);
    await expect(bad({ question: "x".repeat(281) })).rejects.toThrow(/check constraint/);
    await expect(bad({ closes_in: "9 days" })).rejects.toThrow(/check constraint/); // open for more than 8 days
  });

  it("refuses what is not a hypothesis", async () => {
    await expect(addHyp(C1, B, { direction: "sideways" })).rejects.toThrow(/check constraint/);
    await expect(addHyp(C1, B, { confidence: 55 })).rejects.toThrow(/check constraint/);
    await expect(addHyp(C1, B, { reason: "kurz" })).rejects.toThrow(/check constraint/);
    await expect(addHyp(C1, B, { reason: "x".repeat(281) })).rejects.toThrow(/check constraint/);
    await expect(addHyp(id(99), B)).rejects.toThrow(/foreign key/);
  });
});

describe("0010: who reads a case", () => {
  it("members read the cases of their group – nobody else, anon not at all", async () => {
    expect((await as<{ id: string }>(jwt(B), `select id from public.group_cases`)).map((r) => r.id)).toEqual([C1]);
    expect((await as<{ id: string }>(jwt(S1), `select id from public.group_cases`)).map((r) => r.id)).toEqual([C2]);
    expect(await as(jwt(D), `select id from public.group_cases`)).toEqual([]);
    await expect(as(null, `select id from public.group_cases`, [], "anon")).rejects.toThrow(/permission denied/);
  });

  it("a client writes nothing: no insert, no update, no delete – on either table", async () => {
    await expect(as(jwt(B), `insert into public.group_cases (group_id, author_id, pair, interval, anchor_ms, horizon, closes_at) values ('${G}', '${B}', 'BTCUSDT', '4h', 1760000000000, 12, now())`)).rejects.toThrow(/permission denied/);
    await expect(as(jwt(A), `update public.group_cases set closed_at = now()`)).rejects.toThrow(/permission denied/);
    await expect(as(jwt(A), `delete from public.group_cases`)).rejects.toThrow(/permission denied/);
    await expect(as(jwt(B), `insert into public.case_hypotheses (case_id, user_id, direction, confidence, reason) values ('${C1}', '${B}', 'up', 70, 'ein langer Grund hier')`)).rejects.toThrow(/permission denied/);
    await expect(as(jwt(B), `update public.case_hypotheses set direction = 'down'`)).rejects.toThrow(/permission denied/);
    await expect(as(jwt(B), `delete from public.case_hypotheses`)).rejects.toThrow(/permission denied/);
  });
});

describe("0010: when a hypothesis is readable", () => {
  it("open: its author sees it, the others do not – not even that it exists", async () => {
    await addHyp(C1, B, { reason: "B erwartet den Ausbruch nach oben" });
    expect(await hyps(B, C1)).toEqual([B]);
    expect(await hyps(A, C1)).toEqual([]);
    expect(await hyps(C, C1)).toEqual([]);
    expect(await hyps(D, C1)).toEqual([]);
  });

  it("closed by the author: every member of the group reads all hypotheses; outsiders still nothing", async () => {
    await addHyp(C1, C, { direction: "down", reason: "C erwartet einen Rücksetzer" });
    await close(C1);
    expect(await hyps(A, C1)).toEqual([B, C].sort());
    expect(await hyps(B, C1)).toEqual([B, C].sort());
    expect(await hyps(D, C1)).toEqual([]);
  });

  it("a case whose time ran out reads like a closed one", async () => {
    const lapsed = id(13);
    await addCase(lapsed, G, A);
    await addHyp(lapsed, B);
    expect(await hyps(C, lapsed)).toEqual([]);
    await db.query(`update public.group_cases set closes_at = now() - interval '1 minute' where id = $1`, [lapsed]);
    expect(await hyps(C, lapsed)).toEqual([B]);
  });

  it("mentor group: a student reads the mentor's hypothesis and their own – never another student's; the mentor reads all", async () => {
    await addHyp(C2, M, { reason: "Die Mentorin sieht den Ausbruch" });
    await addHyp(C2, S1, { direction: "down", reason: "Schüler 1 erwartet einen Rücksetzer" });
    await addHyp(C2, S2, { direction: "flat", reason: "Schüler 2 erwartet Seitwärts" });
    // open: everybody sees only their own
    expect(await hyps(M, C2)).toEqual([M]);
    expect(await hyps(S1, C2)).toEqual([S1]);
    await close(C2);
    expect(await hyps(M, C2)).toEqual([M, S1, S2].sort());
    expect(await hyps(S1, C2)).toEqual([M, S1].sort());
    expect(await hyps(S2, C2)).toEqual([M, S2].sort());
  });
});

describe("0010: written once, stamped by the database", () => {
  it("no update of a hypothesis – not even from the service role", async () => {
    await expect(db.query(`update public.case_hypotheses set direction = 'up' where case_id = $1 and user_id = $2`, [C1, C])).rejects.toThrow(/written once/);
    await expect(as(null, `update public.case_hypotheses set reason = 'nachträglich anders formuliert' where user_id = $1`, [C], "service_role")).rejects.toThrow(/written once/);
    expect((await db.query<{ direction: string }>(`select direction from public.case_hypotheses where case_id = $1 and user_id = $2`, [C1, C])).rows[0]!.direction).toBe("down");
  });

  it("one hypothesis per person and case", async () => {
    const open = id(16);
    await addCase(open, G, A);
    await addHyp(open, B);
    await expect(addHyp(open, B, { direction: "down" })).rejects.toThrow(/duplicate key|unique/);
  });

  it("no insert once the case is closed (closed early or run out) – the race the function cannot see", async () => {
    await expect(addHyp(C1, A)).rejects.toThrow(/the case is closed/);
    const lapsed = id(14);
    await addCase(lapsed, G, A);
    await db.query(`update public.group_cases set closes_at = now() - interval '1 second' where id = $1`, [lapsed]);
    await expect(addHyp(lapsed, B)).rejects.toThrow(/the case is closed/);
  });

  it("the time on a hypothesis is the database's, whatever the writer says", async () => {
    const open = id(15);
    await addCase(open, G, A);
    await db.query(`insert into public.case_hypotheses (case_id, user_id, direction, confidence, reason, created_at) values ($1, $2, 'up', 60, 'ein Grund mit mehr als zehn Zeichen', '2000-01-01T00:00:00Z')`, [open, B]);
    const { rows } = await db.query<{ ago: number }>(`select extract(epoch from (now() - created_at))::float as ago from public.case_hypotheses where case_id = $1`, [open]);
    expect(rows[0]!.ago).toBeLessThan(60);
  });
});

describe("0010: the aal2 rule", () => {
  it("a 2FA user's password-only session reaches no case and no hypothesis; aal2 does", async () => {
    await db.exec(`insert into auth.mfa_factors (user_id, status) values ('${B}', 'verified')`);
    expect(await as(jwt(B, "aal1"), `select id from public.group_cases`)).toEqual([]);
    expect(await hyps(B, C1, "aal1")).toEqual([]);
    expect((await as(jwt(B, "aal2"), `select id from public.group_cases`)).length).toBeGreaterThan(0);
    expect((await hyps(B, C1, "aal2")).length).toBeGreaterThan(0);
    await db.exec(`delete from auth.mfa_factors where user_id = '${B}'`);
  });
});

describe("0010: reports, cascades", () => {
  it("a report may name a case; an unknown target kind is still refused", async () => {
    await db.query(`insert into public.feedback (user_id, kind, message, target_type, target_id) values ($1, 'report', 'Werbung im Fall', 'case', $2)`, [B, C1]);
    await expect(db.query(`insert into public.feedback (user_id, kind, message, target_type, target_id) values ($1, 'report', 'Werbung im Fall', 'course', $2)`, [B, C1])).rejects.toThrow(/check constraint/);
  });

  it("deleting a user removes their cases and hypotheses; deleting a group removes its cases with all hypotheses", async () => {
    await db.exec(`delete from auth.users where id = '${S2}'`);
    expect((await db.query(`select 1 from public.case_hypotheses where user_id = '${S2}'`)).rows).toHaveLength(0);
    expect((await db.query(`select 1 from public.case_hypotheses where case_id = '${C2}'`)).rows).toHaveLength(2); // M and S1 stay
    await db.exec(`delete from public.groups where id = '${GM}'`);
    expect((await db.query(`select 1 from public.group_cases where id = '${C2}'`)).rows).toHaveLength(0);
    expect((await db.query(`select 1 from public.case_hypotheses where case_id = '${C2}'`)).rows).toHaveLength(0);
    await db.exec(`delete from auth.users where id = '${A}'`); // the author of C1 and owner of the group
    expect((await db.query(`select 1 from public.group_cases where id = '${C1}'`)).rows).toHaveLength(0);
    expect((await db.query(`select 1 from public.case_hypotheses where case_id = '${C1}'`)).rows).toHaveLength(0);
  });
});
