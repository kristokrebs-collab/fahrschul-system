// @vitest-environment node
/// <reference types="node" />
/**
 * Security round 11, package B (migration 0018): the quotas and the group rules the DATABASE enforces, on a real Postgres (PGlite + the
 * Supabase shim of `supabase.harness.ts`), with the roles and JWT claims PostgREST / Storage use. Each test would be red on the
 * schema of 0017: a signed-in user could write without limit, read the students of a mentor group and ask about other people's plans.
 *
 * The counters are put near their limit by the service role (the limits themselves – 100 000 rows, 256 MiB, 5 000 simulations – are far
 * too large to fill row by row); what is tested is the decision at the limit, who is counted, who is refused and who is not.
 * NOT shown here: Supabase Storage itself (it writes `metadata.size` after the upload – the policy reads what is stored) and the
 * dashboard settings (CAPTCHA, anonymous sign-ins, JWT lifetime), which only the operator can set (SETUP.md 2.2).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PLAN_LIMITS } from "../../src/billing/plans";
import { PLAN_IDS } from "../../src/billing/types";
import { bootDb, jwt, MIG_DIR, type Db } from "./supabase.harness";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const M = "44444444-4444-4444-8444-444444444444"; // mentor
const S1 = "55555555-5555-4555-8555-555555555551"; // students
const S2 = "55555555-5555-4555-8555-555555555552";
const P1 = "66666666-6666-4666-8666-666666666661"; // peers of a normal group
const P2 = "66666666-6666-4666-8666-666666666662";
const GM = "aaaaaaaa-0000-4000-8000-000000000001"; // mentor group
const GP = "aaaaaaaa-0000-4000-8000-000000000002"; // peer group
const HEX64 = "a".repeat(64);
const MIB = 1024 * 1024;

let t: Db;

const cap = async (key: string): Promise<number> => Number((await t.catalog<{ v: string }>(`select public.quota_cap('${key}')::text as v`))[0]!.v);
const limit = async (plan: string, key: string): Promise<number> => Number((await t.catalog<{ v: string }>(`select public.plan_limit('${plan}', '${key}')::text as v`))[0]!.v);

const sim = (u: string, n: number | string) =>
  `insert into public.simulations (user_id, id, symbol, interval, seed, model_version, data_hash, data_bars, runs, horizon, plan, costs, metrics, result_hash) values ('${u}', 'sim_${String(n).padStart(20, "0")}', 'BTCUSDT', '1h', 1, 'm1', '${HEX64}', 10, 100, 10, '{}', '{}', '{}', '${HEX64}')`;
const simUpsert = (u: string, n: number) => `${sim(u, n)} on conflict (user_id, id) do update set runs = excluded.runs`;
const doc = (u: string, id: string, data = "{}") => `insert into public.journal_docs (user_id, kind, id, data) values ('${u}', 'trade', '${id}', '${data}')`;
const setPlan = (u: string, plan: string, status = "active") => t.service(`update public.profiles set plan = '${plan}', plan_status = '${status}' where id = '${u}'`);
const payments = (on: boolean) =>
  t.service(on ? `insert into public.app_config (key, value) values ('billing', '{"paymentsEnabled": true}') on conflict (key) do update set value = excluded.value` : `delete from public.app_config`);
const usage = async (u: string) => (await t.catalog<{ r: string; b: string }>(`select doc_rows::text as r, doc_bytes::text as b from public.user_usage where user_id = '${u}'`))[0];
/** Empties a user's journal and puts the counters back to what the table holds (the tests move the counters by hand). */
const reset = async (u: string): Promise<void> => {
  await t.service(`delete from public.journal_docs where user_id = '${u}'; select public.recount_usage('${u}')`);
};
const quotaErr =(what: string) => new RegExp(`quota_exceeded:${what}`);

beforeAll(async () => {
  t = await bootDb();
  const users = [A, B, M, S1, S2, P1, P2].map((u, i) => `('${u}', 'u${i}@x.test')`).join(",");
  await t.db.exec(`insert into auth.users (id, email) values ${users};`);
}, 120_000);
afterAll(async () => {
  await t?.db.close();
});

describe("journal_docs: rows and bytes per user (the browser is limited, the functions are counted)", () => {
  it("counts inserts, updates, tombstones and hard deletes – whoever writes – and always equals what the table holds", async () => {
    // the invariant: the counter is the sum of the stored sizes (octet_length of the JSON text), never drifting
    const holds = async (u: string) =>
      (await t.catalog<{ r: string; b: string }>(`select count(*)::text as r, coalesce(sum(octet_length(data::text)), 0)::text as b from public.journal_docs where user_id = '${u}'`))[0]!;
    await t.as(jwt(A), doc(A, "t_1", '{"pnl":1}'));
    await t.service(doc(A, "t_2", '{"pnl":2}')); // a function (service role) is counted too
    expect(await usage(A)).toEqual(await holds(A));
    expect((await usage(A))!.r).toBe("2");
    expect(Number((await usage(A))!.b)).toBeGreaterThan(0);
    await t.as(jwt(A), `update public.journal_docs set data = '{"pnl":1,"note":"${"x".repeat(100)}"}' where id = 't_1'`);
    expect(await usage(A)).toEqual(await holds(A));
    expect(Number((await usage(A))!.b)).toBeGreaterThan(100);
    // an upsert that hits an existing record counts the change, not a new row
    await t.as(jwt(A), `${doc(A, "t_2", '{"pnl":3}')} on conflict (user_id, kind, id) do update set data = excluded.data`);
    expect(await usage(A)).toEqual(await holds(A));
    expect((await usage(A))!.r).toBe("2");
    await t.as(jwt(A), `update public.journal_docs set data = '{"deletedAt":1}', deleted = true where id = 't_1'`);
    expect(await usage(A)).toEqual(await holds(A));
    await t.service(`delete from public.journal_docs where id = 't_2'`);
    expect(await usage(A)).toEqual(await holds(A));
    await t.service(`delete from public.journal_docs where user_id = '${A}'`);
    expect(await usage(A)).toEqual({ r: "0", b: "0" });
  });

  it("refuses a new record at the row limit – with a message the client can tell – but still takes upserts of existing ones, shrinking updates and tombstones", async () => {
    const rows = await cap("journal_rows");
    await reset(A);
    await t.as(jwt(A), doc(A, "t_keep", '{"a":1}'));
    await t.service(`update public.user_usage set doc_rows = ${rows} where user_id = '${A}'`);
    await expect(t.as(jwt(A), doc(A, "t_new"))).rejects.toThrow(quotaErr("journal_rows"));
    // the sync client upserts: an existing record is not a new one
    expect(await t.as(jwt(A), `${doc(A, "t_keep", '{"a":2}')} on conflict (user_id, kind, id) do update set data = excluded.data returning id`)).toHaveLength(1);
    // …and a tombstone / shrink always passes
    expect(await t.as(jwt(A), `update public.journal_docs set data = '{}', deleted = true where id = 't_keep' returning id`)).toHaveLength(1);
    // the functions (server-side import, exchange sync) are never refused
    await t.service(doc(A, "t_server"));
    await reset(A);
  });

  it("refuses a record that would grow the journal past the byte limit, but not one that shrinks it", async () => {
    const bytes = await cap("journal_bytes");
    await t.as(jwt(A), doc(A, "t_b", '{"a":"1234567890"}'));
    await t.service(`update public.user_usage set doc_bytes = ${bytes - 5} where user_id = '${A}'`);
    await expect(t.as(jwt(A), doc(A, "t_c", '{"a":"1234567890"}'))).rejects.toThrow(quotaErr("journal_bytes"));
    await expect(t.as(jwt(A), `update public.journal_docs set data = '{"a":"1234567890123456789012"}' where id = 't_b'`)).rejects.toThrow(quotaErr("journal_bytes"));
    expect(await t.as(jwt(A), `update public.journal_docs set data = '{}' where id = 't_b' returning id`)).toHaveLength(1);
    expect(await t.as(jwt(A), `${doc(A, "t_small")} returning id`)).toHaveLength(1); // 2 bytes fit under the limit again
    await reset(A);
  });

  it("checks the rows of one statement one by one (a batch cannot slip past the limit)", async () => {
    const rows = await cap("journal_rows");
    await reset(B);
    await t.as(jwt(B), doc(B, "t_seed"));
    await t.service(`update public.user_usage set doc_rows = ${rows - 2} where user_id = '${B}'`);
    await expect(
      t.as(jwt(B), `insert into public.journal_docs (user_id, kind, id, data) select '${B}', 'trade', 't_' || g, '{}' from generate_series(1, 5) g`),
    ).rejects.toThrow(quotaErr("journal_rows"));
    expect(await t.as(jwt(B), `select count(*)::int as n from public.journal_docs`)).toEqual([{ n: 1 }]); // only the seed – none of the five
    // two fit
    expect(await t.as(jwt(B), `insert into public.journal_docs (user_id, kind, id, data) select '${B}', 'trade', 't_' || g, '{}' from generate_series(1, 2) g returning id`)).toHaveLength(2);
    await reset(B);
  });

  it("a row written for somebody else is refused by the policy – and neither touches nor reveals that person's counters", async () => {
    const rows = await cap("journal_rows");
    await t.as(jwt(A), doc(A, "t_a"));
    await t.service(`update public.user_usage set doc_rows = ${rows} where user_id = '${A}'`);
    // B writes for A, who is AT the limit: the answer is the policy's, not a quota message about A
    const err = await t.as(jwt(B), doc(A, "t_evil")).then(() => null, (e: Error) => e.message);
    expect(err).toMatch(/row-level security/);
    expect(err).not.toMatch(/quota_exceeded/);
    expect((await usage(A))!.r).toBe(String(rows));
    await reset(A);
  });

  it("account deletion (cascade) still works with the counters in place", async () => {
    const U = "77777777-7777-4777-8777-777777777777";
    await t.db.exec(`insert into auth.users (id, email) values ('${U}', 'del@x.test')`);
    await t.as(jwt(U), doc(U, "t_1"));
    await t.as(jwt(U), sim(U, 1));
    await t.db.exec(`delete from auth.users where id = '${U}'`);
    expect(await t.catalog(`select 1 from public.user_usage where user_id = '${U}'`)).toEqual([]);
    expect(await t.catalog(`select 1 from public.usage_daily where user_id = '${U}'`)).toEqual([]);
  });

  it("recount_usage repairs a counter that was moved by hand, and only the service role may call it", async () => {
    await reset(A);
    await t.as(jwt(A), doc(A, "t_1", '{"a":1}'));
    await t.service(`update public.user_usage set doc_rows = 999, doc_bytes = 999999 where user_id = '${A}'`);
    await t.service(`select public.recount_usage()`);
    expect(await usage(A)).toEqual({ r: "1", b: String(Buffer.byteLength('{"a": 1}')) });
    await expect(t.as(jwt(A), `select public.recount_usage()`)).rejects.toThrow(/permission denied/);
    await reset(A);
  });

  it("the counters are closed to the browser; the quota helpers are not callable by it", async () => {
    for (const table of ["user_usage", "usage_daily"]) await expect(t.as(jwt(A), `select * from public.${table}`), table).rejects.toThrow(/permission denied/);
    for (const fn of ["public.effective_plan('" + A + "')", "public.journal_docs_quota()", "public.simulations_quota()", "public.journal_docs_unquota()"]) {
      await expect(t.as(jwt(A), `select ${fn}`), fn).rejects.toThrow(/permission denied/);
    }
  });
});

describe("simulations: per day by plan, and stored in total", () => {
  it("the SQL plan table equals src/billing/plans.ts (Premium / Team 'unlimited' = the documented cap)", async () => {
    const dayCap = await cap("simulations_per_day_cap");
    for (const plan of PLAN_IDS) {
      const want = PLAN_LIMITS[plan];
      expect({ plan, sims: await limit(plan, "simulations_per_day") }).toEqual({ plan, sims: Number.isFinite(want.simulationsPerDay) ? want.simulationsPerDay : dayCap });
      expect({ plan, mb: await limit(plan, "screenshot_mb") }).toEqual({ plan, mb: want.screenshotStorageMb });
    }
    expect(dayCap).toBeGreaterThan(PLAN_LIMITS.pro.simulationsPerDay);
  });

  it("Free may save 20 new simulations a day, the 21st is refused; a stored one can be saved again at the limit", async () => {
    await payments(true);
    try {
      await setPlan(B, "free", "none");
      await t.service(`delete from public.simulations where user_id = '${B}'; delete from public.usage_daily where user_id = '${B}'`);
      for (let i = 1; i <= 20; i++) await t.as(jwt(B), sim(B, i));
      await expect(t.as(jwt(B), sim(B, 21))).rejects.toThrow(quotaErr("simulations_per_day"));
      // the sync client upserts: re-saving a stored simulation is not a new one
      expect(await t.as(jwt(B), `${simUpsert(B, 3)} returning id`)).toHaveLength(1);
      // deleting and saving again does not bring a fresh budget
      await t.as(jwt(B), `delete from public.simulations where id = 'sim_${"1".padStart(20, "0")}'`);
      await expect(t.as(jwt(B), sim(B, 1))).rejects.toThrow(quotaErr("simulations_per_day"));
      // Pro: 200 a day
      await setPlan(B, "pro");
      for (let i = 21; i <= 30; i++) await t.as(jwt(B), sim(B, i));
      // a canceled Pro is Free again
      await setPlan(B, "pro", "canceled");
      await expect(t.as(jwt(B), sim(B, 31))).rejects.toThrow(quotaErr("simulations_per_day"));
    } finally {
      await payments(false);
      await setPlan(B, "free", "none");
    }
  });

  it("one statement with many new rows is checked row by row", async () => {
    await payments(true);
    try {
      await setPlan(B, "free", "none");
      await t.service(`delete from public.simulations where user_id = '${B}'; delete from public.usage_daily where user_id = '${B}'`);
      await expect(
        t.as(jwt(B), `insert into public.simulations (user_id, id, symbol, interval, seed, model_version, data_hash, data_bars, runs, horizon, plan, costs, metrics, result_hash)
          select '${B}', 'sim_' || lpad(g::text, 20, '0'), 'BTCUSDT', '1h', 1, 'm1', '${HEX64}', 10, 100, 10, '{}', '{}', '{}', '${HEX64}' from generate_series(1, 30) g`),
      ).rejects.toThrow(quotaErr("simulations_per_day"));
      expect(await t.as(jwt(B), `select count(*)::int as n from public.simulations`)).toEqual([{ n: 0 }]);
    } finally {
      await payments(false);
    }
  });

  it("payments off: no paywall, but 'unlimited' still has the cap; yesterday's counter does not count today", async () => {
    await payments(false);
    await setPlan(B, "free", "none");
    const dayCap = await cap("simulations_per_day_cap");
    await t.service(`delete from public.simulations where user_id = '${B}'; delete from public.usage_daily where user_id = '${B}'`);
    await t.service(`insert into public.usage_daily (user_id, kind, day, n) values ('${B}', 'simulations', (now() at time zone 'utc')::date - 1, ${dayCap}), ('${B}', 'simulations', (now() at time zone 'utc')::date, ${dayCap - 1})`);
    await t.as(jwt(B), sim(B, 1));
    await expect(t.as(jwt(B), sim(B, 2))).rejects.toThrow(quotaErr("simulations_per_day"));
    await t.service(`delete from public.usage_daily where user_id = '${B}'; delete from public.simulations where user_id = '${B}'`);
  });

  it("at most 5 000 stored per user; deleting one makes room; the service role is not refused", async () => {
    const stored = await cap("simulations_rows");
    await payments(false);
    await t.service(`delete from public.simulations where user_id = '${A}'; delete from public.usage_daily where user_id = '${A}'`);
    await t.service(`insert into public.simulations (user_id, id, symbol, interval, seed, model_version, data_hash, data_bars, runs, horizon, plan, costs, metrics, result_hash)
      select '${A}', 'sim_' || lpad(g::text, 20, '0'), 'BTCUSDT', '1h', 1, 'm1', '${HEX64}', 10, 100, 10, '{}', '{}', '{}', '${HEX64}' from generate_series(1, ${stored}) g`);
    await t.service(`delete from public.usage_daily where user_id = '${A}'`);
    await expect(t.as(jwt(A), sim(A, stored + 1))).rejects.toThrow(quotaErr("simulations_rows"));
    await t.as(jwt(A), `delete from public.simulations where id = 'sim_${"1".padStart(20, "0")}'`);
    expect(await t.as(jwt(A), `${sim(A, stored + 1)} returning id`)).toHaveLength(1);
    await t.service(sim(A, stored + 2)); // a function is never refused
    await t.service(`delete from public.simulations where user_id = '${A}'; delete from public.usage_daily where user_id = '${A}'`);
  });
});

describe("screenshots bucket: the sum per user by plan", () => {
  const put = (u: string, name: string, size: number | null) =>
    t.db.exec(`insert into storage.objects (bucket_id, name, metadata) values ('screenshots', '${u}/${name}', ${size === null ? "null" : `'{"size": ${size}}'::jsonb`})`);
  const clear = () => t.db.exec(`delete from storage.objects where bucket_id = 'screenshots'`);

  it("Pro: uploads and overwrites while the folder holds less than 2 GB, then none – deleting makes room", async () => {
    await payments(true);
    try {
      await clear();
      await setPlan(B, "pro");
      await put(B, "t_1/small.png", 3 * MIB);
      expect(await t.as(jwt(B), `insert into storage.objects (bucket_id, name) values ('screenshots', '${B}/t_1/a.png') returning name`)).toHaveLength(1);
      await put(B, "t_1/huge.png", PLAN_LIMITS.pro.screenshotStorageMb * MIB);
      await expect(t.as(jwt(B), `insert into storage.objects (bucket_id, name) values ('screenshots', '${B}/t_1/b.png')`)).rejects.toThrow(/row-level security/);
      // an overwrite (update) is a write as well
      await expect(t.as(jwt(B), `update storage.objects set name = '${B}/t_1/renamed.png' where name = '${B}/t_1/small.png' returning name`)).rejects.toThrow(/row-level security/);
      // reading and deleting stay open, and deleting gives the room back
      expect((await t.as(jwt(B), `select name from storage.objects where bucket_id = 'screenshots'`)).length).toBe(3);
      expect(await t.as(jwt(B), `delete from storage.objects where name = '${B}/t_1/huge.png' returning name`)).toHaveLength(1);
      expect(await t.as(jwt(B), `insert into storage.objects (bucket_id, name) values ('screenshots', '${B}/t_1/c.png') returning name`)).toHaveLength(1);
    } finally {
      await clear();
      await payments(false);
      await setPlan(B, "free", "none");
    }
  });

  it("other people's pictures do not count; Premium holds ten times more than Pro", async () => {
    await payments(true);
    try {
      await clear();
      await setPlan(A, "pro");
      await setPlan(B, "premium");
      await put(A, "t_1/huge.png", PLAN_LIMITS.pro.screenshotStorageMb * MIB);
      expect(await t.as(jwt(B), `insert into storage.objects (bucket_id, name) values ('screenshots', '${B}/t_1/a.png') returning name`)).toHaveLength(1);
      await put(B, "t_1/big.png", PLAN_LIMITS.pro.screenshotStorageMb * MIB);
      expect(await t.as(jwt(B), `insert into storage.objects (bucket_id, name) values ('screenshots', '${B}/t_1/b.png') returning name`)).toHaveLength(1);
      await put(B, "t_1/huge.png", PLAN_LIMITS.premium.screenshotStorageMb * MIB);
      await expect(t.as(jwt(B), `insert into storage.objects (bucket_id, name) values ('screenshots', '${B}/t_1/c.png')`)).rejects.toThrow(/row-level security/);
    } finally {
      await clear();
      await payments(false);
      await setPlan(A, "free", "none");
      await setPlan(B, "free", "none");
    }
  });

  it("payments off: the Premium sum applies; the backups bucket has a size limit", async () => {
    await payments(false);
    await clear();
    await put(B, "t_1/big.png", PLAN_LIMITS.pro.screenshotStorageMb * MIB);
    expect(await t.as(jwt(B), `insert into storage.objects (bucket_id, name) values ('screenshots', '${B}/t_1/ok.png') returning name`)).toHaveLength(1);
    await put(B, "t_1/huge.png", PLAN_LIMITS.premium.screenshotStorageMb * MIB);
    await expect(t.as(jwt(B), `insert into storage.objects (bucket_id, name) values ('screenshots', '${B}/t_1/no.png')`)).rejects.toThrow(/row-level security/);
    await clear();
    const [b] = await t.catalog<{ lim: string }>(`select file_size_limit::text as lim from storage.buckets where id = 'backups'`);
    expect(Number(b!.lim)).toBe(await cap("backup_object_bytes"));
    expect(Number(b!.lim)).toBeGreaterThan(await cap("journal_bytes")); // a backup of a full journal still fits
  });
});

describe("cloud_shots_allowed answers about the caller only", () => {
  it("a signed-in user asking about another account gets the answer for their own plan", async () => {
    await payments(true);
    try {
      await setPlan(A, "premium");
      await setPlan(B, "free", "none");
      const ask = async (claims: Record<string, unknown> | null, about: string) => (await t.as<{ ok: boolean }>(claims, `select public.cloud_shots_allowed('${about}') as ok`))[0]!.ok;
      expect(await ask(jwt(B), A)).toBe(false); // B is Free – whatever A has
      expect(await ask(jwt(A), B)).toBe(true); // A is Premium – whatever B has
      expect(await ask(jwt(A), A)).toBe(true);
      expect(await ask(null, A)).toBe(true); // the service role names the user
      expect(await ask(null, B)).toBe(false);
    } finally {
      await payments(false);
      await setPlan(A, "free", "none");
    }
  });
});

describe("mentor groups: students do not see each other", () => {
  beforeAll(async () => {
    await t.service(
      `insert into public.social_profiles (user_id, pseudonym) values ('${M}', 'Weiser Adler 11'), ('${S1}', 'Stiller Falke 21'), ('${S2}', 'Mutiger Luchs 22'), ('${P1}', 'Kluger Wolf 31'), ('${P2}', 'Frecher Fuchs 32');
       insert into public.groups (id, kind, name, owner_id) values ('${GM}', 'mentor', 'Mentoring', '${M}'), ('${GP}', 'group', 'Peers', '${P1}');
       insert into public.group_members (group_id, user_id, role) values ('${GM}', '${M}', 'owner'), ('${GM}', '${S1}', 'student'), ('${GM}', '${S2}', 'student'),
         ('${GP}', '${P1}', 'owner'), ('${GP}', '${P2}', 'member'), ('${GP}', '${S2}', 'member')`,
    );
  });

  const members = async (who: string, group: string) => (await t.as<{ user_id: string }>(jwt(who), `select user_id from public.group_members where group_id = '${group}' order by user_id`)).map((r) => r.user_id);
  const names = async (who: string) => (await t.as<{ pseudonym: string }>(jwt(who), `select pseudonym from public.social_profiles order by pseudonym`)).map((r) => r.pseudonym);

  it("group_members: a student reads the mentor and themselves, the mentor reads everyone, a peer group is unchanged", async () => {
    expect(await members(S1, GM)).toEqual([M, S1].sort());
    expect(await members(S2, GM)).toEqual([M, S2].sort());
    expect(await members(M, GM)).toEqual([M, S1, S2].sort());
    expect(await members(P2, GP)).toEqual([P1, P2, S2].sort());
    // a stranger still sees nothing
    expect(await t.as(jwt(B), `select 1 as n from public.group_members`)).toEqual([]);
  });

  it("social_profiles: a student sees the mentor's and their own pseudonym – not the other student's; a shared PEER group still shows S2", async () => {
    expect(await names(S1)).toEqual(["Stiller Falke 21", "Weiser Adler 11"]);
    expect(await names(M)).toEqual(["Mutiger Luchs 22", "Stiller Falke 21", "Weiser Adler 11"]);
    // S2 sits in the mentor group AND in a peer group with P1 / P2: those two are visible through the peer group, S1 is not
    expect(await names(S2)).toEqual(["Frecher Fuchs 32", "Kluger Wolf 31", "Mutiger Luchs 22", "Weiser Adler 11"]);
    expect(await names(P2)).toEqual(["Frecher Fuchs 32", "Kluger Wolf 31", "Mutiger Luchs 22"]);
  });

  it("an aal1 session of a user with 2FA still sees neither", async () => {
    await t.db.exec(`insert into auth.mfa_factors (user_id, status) values ('${S1}', 'verified')`);
    try {
      expect(await t.as(jwt(S1, "aal1"), `select user_id from public.group_members`)).toEqual([]);
      expect(await t.as(jwt(S1, "aal2"), `select user_id from public.group_members`)).toHaveLength(2);
    } finally {
      await t.db.exec(`delete from auth.mfa_factors where user_id = '${S1}'`);
    }
  });
});

describe("the migration itself", () => {
  it("is 0018, runs after 0017 and every function it adds pins its search_path", () => {
    const sql = readFileSync(join(MIG_DIR, "0018_quotas_visibility.sql"), "utf8");
    const fns = [...sql.matchAll(/create (?:or replace )?function public\.(\w+)\(([^)]*)\)([\s\S]*?)\$\$;?/g)];
    expect(fns.length).toBeGreaterThanOrEqual(10);
    for (const f of fns) expect(f[0], f[1]).toMatch(/set search_path = ''/);
  });
});
