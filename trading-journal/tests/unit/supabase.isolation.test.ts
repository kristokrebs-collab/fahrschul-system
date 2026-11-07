// @vitest-environment node
/// <reference types="node" />
/**
 * B1 two-user isolation, REAL half (tests 1–8 of the launch plan, as far as a database without Supabase can show it):
 * all migrations on a real Postgres (PGlite + shim, `supabase.harness.ts`), two ordinary users A and B (plus C, a
 * co-member of A) and the exact roles / JWT claims PostgREST and Storage use. For every table the browser can reach:
 * B reads only B's rows, cannot change or delete A's, cannot write a row for A; A (positive control) does see its own.
 * Groups, co-member visibility, session list, storage folders and the service-only functions are probed separately.
 *
 * NOT shown here (said plainly in the report and docs/BETRIEB.md): Supabase's own Auth service, PostgREST's JWT
 * verification, Realtime's row filtering and the production project's real settings. This is the policy layer only.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootDb, jwt, type Db } from "./supabase.harness";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const G = "99999999-9999-4999-8999-999999999999";
const HEX64 = "a".repeat(64);

let t: Db;

interface Probe {
  table: string;
  /** Column holding the owner. */
  owner: string;
  /** Columns the browser may select (some tables grant only some). */
  cols: string;
  /** Expected number of rows B sees / A sees. */
  b: number;
  a: number;
  /** A harmless column to update on A's row (only for tables the browser may update). */
  update?: string;
  /** Tables the browser may delete from. */
  del?: boolean;
  /** SQL that inserts a row owned by `$U` (for the "write a row for someone else" probe). */
  insert?: (u: string) => string;
}

const sim = (u: string, id: string) =>
  `insert into public.simulations (user_id, id, symbol, interval, seed, model_version, data_hash, data_bars, runs, horizon, plan, costs, metrics, result_hash) values ('${u}', '${id}', 'BTCUSDT', '1h', 1, 'm1', '${HEX64}', 10, 100, 10, '{}', '{}', '{}', '${HEX64}')`;

const PROBES: Probe[] = [
  { table: "journal_docs", owner: "user_id", cols: "id", b: 1, a: 1, update: "deleted = deleted", insert: (u) => `insert into public.journal_docs (user_id, kind, id, data) values ('${u}', 'trade', 't_x', '{}')` },
  { table: "simulations", owner: "user_id", cols: "id", b: 1, a: 1, update: "runs = runs", del: true, insert: (u) => sim(u, `sim_${"c".repeat(20)}`) },
  { table: "profiles", owner: "id", cols: "id", b: 1, a: 1, update: "tz = tz" },
  { table: "exchange_connections", owner: "user_id", cols: "id", b: 1, a: 1 },
  { table: "audit_log", owner: "user_id", cols: "id", b: 1, a: 1 },
  { table: "subscriptions", owner: "user_id", cols: "id", b: 1, a: 1 },
  { table: "referral_codes", owner: "user_id", cols: "user_id", b: 1, a: 1 },
  { table: "referrals", owner: "referrer_id", cols: "id", b: 0, a: 1 },
  { table: "affiliate_ledger", owner: "referrer_id", cols: "id", b: 0, a: 1 },
  { table: "api_tokens", owner: "user_id", cols: "id", b: 1, a: 1 },
  { table: "social_profiles", owner: "user_id", cols: "user_id", b: 1, a: 2 /* own + co-member C */ },
  { table: "shares", owner: "user_id", cols: "token", b: 1, a: 1 },
  { table: "feedback", owner: "user_id", cols: "id", b: 1, a: 1 },
  { table: "member_stats", owner: "user_id", cols: "user_id", b: 1, a: 1 },
  { table: "sync_runs", owner: "user_id", cols: "id", b: 1, a: 1 },
  { table: "team_seats", owner: "owner_id", cols: "owner_id", b: 0, a: 1 },
];

beforeAll(async () => {
  t = await bootDb();
  await t.db.exec(`insert into auth.users (id, email) values ('${A}', 'a@x.test'), ('${B}', 'b@x.test'), ('${C}', 'c@x.test');`);
  await t.service(
    `insert into public.journal_docs (user_id, kind, id, data) values ('${A}', 'trade', 't_1', '{"pnl":1234}'), ('${B}', 'trade', 't_2', '{"pnl":-1}');
     ${sim(A, `sim_${"a".repeat(20)}`)}; ${sim(B, `sim_${"b".repeat(20)}`)};
     insert into public.exchange_connections (user_id, exchange, api_key_enc, secret_enc) values ('${A}', 'bitunix', 'v1:a', 'v1:a'), ('${B}', 'bitunix', 'v1:b', 'v1:b');
     insert into public.audit_log (user_id, action) values ('${A}', 'auth.signin'), ('${B}', 'auth.signin');
     insert into public.subscriptions (id, user_id, stripe_customer_id, status, plan, seats) values ('sub_A', '${A}', 'cus_A', 'active', 'pro', 1), ('sub_B', '${B}', 'cus_B', 'active', 'pro', 1);
     insert into public.billing_customers (user_id, stripe_customer_id) values ('${A}', 'cus_A'), ('${B}', 'cus_B');
     insert into public.referral_codes (user_id, code, commission_pct) values ('${A}', 'AAAAAA11', 25), ('${B}', 'BBBBBB22', 25);
     insert into public.referrals (referrer_id, referred_id, code) values ('${A}', '${C}', 'AAAAAA11');
     insert into public.affiliate_ledger (referrer_id, kind, amount, stripe_invoice_id) values ('${A}', 'commission', 600, 'in_1');
     insert into public.api_tokens (user_id, token_hash, prefix) values ('${A}', '${"a".repeat(64)}', 'tj_aaaa'), ('${B}', '${"b".repeat(64)}', 'tj_bbbb');
     insert into public.social_profiles (user_id, pseudonym) values ('${A}', 'Stiller Falke 27'), ('${B}', 'Mutiger Luchs 55'), ('${C}', 'Kluger Wolf 12');
     insert into public.groups (id, kind, name, owner_id) values ('${G}', 'mentor', 'Mentoring', '${A}');
     insert into public.group_members (group_id, user_id, role) values ('${G}', '${A}', 'owner'), ('${G}', '${C}', 'student');
     insert into public.group_invites (code, group_id, created_by) values ('ABCDEFGH12', '${G}', '${A}');
     insert into public.group_goals (group_id, mentor_id, student_id, draft) values ('${G}', '${A}', '${C}', '{}');
     insert into public.shares (token, user_id, kind, payload) values ('${"a".repeat(22)}', '${A}', 'trade', '{"v":1}'), ('${"b".repeat(22)}', '${B}', 'trade', '{"v":1}');
     insert into public.feedback (user_id, kind, message) values ('${A}', 'idea', 'Mehr Boxen bitte'), ('${B}', 'idea', 'Mehr Boxen bitte B');
     insert into public.member_stats (user_id) values ('${A}'), ('${B}');
     insert into public.sync_runs (user_id, exchange, kind) values ('${A}', 'bitunix', 'manual'), ('${B}', 'bitunix', 'manual');
     insert into public.team_seats (owner_id, member_id) values ('${A}', '${C}')`,
  );
  await t.db.exec(`insert into auth.sessions (id, user_id, aal) values ('aaaaaaaa-0000-4000-8000-000000000001', '${A}', 'aal1'), ('bbbbbbbb-0000-4000-8000-000000000001', '${B}', 'aal1'), ('bbbbbbbb-0000-4000-8000-000000000002', '${B}', 'aal1')`);
  await t.db.exec(`insert into storage.objects (bucket_id, name) values ('screenshots', '${A}/t_1/a.png'), ('screenshots', '${B}/t_2/b.png')`);
}, 120_000);
afterAll(async () => {
  await t?.db.close();
});

const noRight = /permission denied|row-level security|violates/;

describe("two users, every table the browser can reach", () => {
  it.each(PROBES)("$table: B reads only B's rows, A (control) sees its own", async (p) => {
    const rowsB = await t.as(jwt(B), `select ${p.cols} from public.${p.table}`);
    expect(rowsB, `${p.table}: B sees ${rowsB.length}`).toHaveLength(p.b);
    const rowsA = await t.as(jwt(A), `select ${p.cols} from public.${p.table}`);
    expect(rowsA, `${p.table}: A (control) sees ${rowsA.length}`).toHaveLength(p.a);
  });

  it.each(PROBES)("$table: B cannot change, delete or hand over A's rows", async (p) => {
    // update: either filtered to nothing by the policy or not granted at all
    const upd = p.update ?? `${p.owner} = ${p.owner}`;
    const where = `${p.owner} = '${A}'`;
    const update = t.as(jwt(B), `update public.${p.table} set ${upd} where ${where} returning 1 as n`);
    if (p.update) expect(await update).toEqual([]);
    else await expect(update).rejects.toThrow(noRight);
    const del = t.as(jwt(B), `delete from public.${p.table} where ${where} returning 1 as n`);
    if (p.del) expect(await del).toEqual([]);
    else await expect(del).rejects.toThrow(noRight);
    if (p.insert) await expect(t.as(jwt(B), p.insert(A))).rejects.toThrow(noRight);
    else await expect(t.as(jwt(B), `insert into public.${p.table} default values`)).rejects.toThrow(noRight);
  });

  it("B can write its OWN rows where the browser may write (journal, simulations) and they stay B's", async () => {
    expect(await t.as(jwt(B), `insert into public.journal_docs (user_id, kind, id, data) values ('${B}', 'trade', 't_new', '{}') returning id`)).toEqual([{ id: "t_new" }]);
    expect(await t.as(jwt(A), `select id from public.journal_docs where id = 't_new'`)).toEqual([]);
    expect(await t.as(jwt(B), sim(B, `sim_${"d".repeat(20)}`).concat(" returning id"))).toHaveLength(1);
    expect(await t.as(jwt(A), `select id from public.simulations where id = 'sim_${"d".repeat(20)}'`)).toEqual([]);
  });

  it("an update that tries to hand B's own row to A is refused by WITH CHECK", async () => {
    await expect(t.as(jwt(B), `update public.journal_docs set user_id = '${A}' where user_id = '${B}' returning 1`)).rejects.toThrow(noRight);
    await expect(t.as(jwt(B), `update public.simulations set user_id = '${A}' where user_id = '${B}' returning 1`)).rejects.toThrow(noRight);
  });

  it("service-only tables are closed to both users, with or without 2FA", async () => {
    for (const table of ["billing_customers", "rate_hits", "app_errors", "app_config", "stripe_events", "sync_cursor", "leaderboard_snapshots"]) {
      for (const who of [jwt(A), jwt(B, "aal2")]) await expect(t.as(who, `select * from public.${table} limit 1`), table).rejects.toThrow(/permission denied/);
    }
  });

  it("the plan column is not B's to set (privilege-escalation by the browser)", async () => {
    await expect(t.as(jwt(B), `update public.profiles set plan = 'team' where id = '${B}' returning 1`)).rejects.toThrow(/permission denied/);
    await expect(t.as(jwt(B), `update public.profiles set plan_status = 'active' where id = '${B}' returning 1`)).rejects.toThrow(/permission denied/);
  });
});

describe("groups and co-members", () => {
  it("a stranger sees no group, no members, no invite, no goal; members see what their role allows", async () => {
    for (const q of ["groups", "group_members", "group_invites", "group_goals", "group_reviews", "group_cases"]) expect(await t.as(jwt(B), `select 1 as n from public.${q}`), `B sees ${q}`).toEqual([]);
    expect(await t.as(jwt(C), `select id from public.groups`)).toEqual([{ id: G }]);
    expect(await t.as(jwt(C), `select user_id from public.group_members order by user_id`)).toHaveLength(2);
    // a student does not see the invite codes (owner / mentor only), the mentor does
    expect(await t.as(jwt(C), `select code from public.group_invites`)).toEqual([]);
    expect(await t.as(jwt(A), `select code from public.group_invites`)).toEqual([{ code: "ABCDEFGH12" }]);
    // the goal is visible to its two people only
    expect(await t.as(jwt(C), `select 1 as n from public.group_goals`)).toHaveLength(1);
  });

  it("co-members see each other's pseudonym, a stranger sees only their own", async () => {
    expect((await t.as<{ pseudonym: string }>(jwt(C), `select pseudonym from public.social_profiles order by pseudonym`)).map((r) => r.pseudonym)).toEqual(["Kluger Wolf 12", "Stiller Falke 27"]);
    expect((await t.as<{ pseudonym: string }>(jwt(B), `select pseudonym from public.social_profiles`)).map((r) => r.pseudonym)).toEqual(["Mutiger Luchs 55"]);
  });
});

describe("sessions, storage, functions", () => {
  it("my_sessions() lists only the caller's sessions", async () => {
    expect(await t.as(jwt(A), `select id from public.my_sessions()`)).toHaveLength(1);
    expect(await t.as(jwt(B), `select id from public.my_sessions()`)).toHaveLength(2);
    expect(await t.as(jwt(C), `select id from public.my_sessions()`)).toHaveLength(0);
  });

  it("screenshots: B reads, writes, overwrites and deletes only below its own folder", async () => {
    expect(await t.as(jwt(B), `select name from storage.objects where bucket_id = 'screenshots'`)).toEqual([{ name: `${B}/t_2/b.png` }]);
    await expect(t.as(jwt(B), `insert into storage.objects (bucket_id, name) values ('screenshots', '${A}/x/evil.png')`)).rejects.toThrow(/row-level security/);
    expect(await t.as(jwt(B), `update storage.objects set name = '${B}/moved.png' where name like '${A}/%' returning name`)).toEqual([]);
    expect(await t.as(jwt(B), `delete from storage.objects where name like '${A}/%' returning name`)).toEqual([]);
    // the backups bucket has no browser policy at all: nothing readable, nothing writable
    await t.db.exec(`insert into storage.objects (bucket_id, name) values ('backups', '${A}/2026-10-01.json')`);
    expect(await t.as(jwt(A), `select name from storage.objects where bucket_id = 'backups'`)).toEqual([]);
    await expect(t.as(jwt(A), `insert into storage.objects (bucket_id, name) values ('backups', '${A}/mine.json')`)).rejects.toThrow(/row-level security/);
  });

  it("server-only functions are not callable by a signed-in user", async () => {
    const calls = [
      `select public.rate_hit('k', 60)`,
      `select * from public.shared_payload('${"a".repeat(22)}')`,
      `select public.assign_team_seat('${A}', '${B}', 5)`,
      `select * from public.backup_candidates(now())`,
    ];
    for (const sql of calls) await expect(t.as(jwt(B), sql), sql).rejects.toThrow(/permission denied/);
  });

  it("anon reaches no table and no function", async () => {
    await expect(t.anon(`select 1 from public.journal_docs`)).rejects.toThrow(/permission denied/);
    await expect(t.anon(`select * from public.my_sessions()`)).rejects.toThrow(/permission denied/);
  });
});
