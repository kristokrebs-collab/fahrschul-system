// @vitest-environment node
/// <reference types="node" />
/**
 * B1 two-user isolation, STATIC half: every migration in `supabase/migrations` (read from the directory – a later
 * migration is loaded and audited without editing this file) is executed on a real Postgres (PGlite + Supabase shim, see
 * `supabase.harness.ts`) and the catalog is checked against the rules below. A table / bucket / function that breaks a
 * rule fails with its name; the only way out is an entry in the exception lists WITH a reason, which is what makes the
 * exceptions visible in review.
 *
 * The REAL half (two roles with JWT claims reading, updating and deleting each other's rows) is
 * `supabase.isolation.test.ts`. Neither replaces a run against the production project (documented in docs/BETRIEB.md).
 *
 * Rules
 *  R1  every public table has row-level security on; `anon` holds no right on any public table
 *  R2  `authenticated` either holds no right at all (service-only, the functions reach it with the service role) or has,
 *      per right it holds, a PERMISSIVE policy whose condition ties the row to the caller (`auth.uid()` or a helper that
 *      reads it) – except the listed public-by-design tables
 *  R3  the aal2 rule (review SEC-01): every readable table also carries the RESTRICTIVE `mfa_satisfied()` policy
 *  R4  the browser may write directly only where listed (everything else goes through a function with the service role)
 *  R5  storage: every policy on `storage.objects` is bound to one bucket and to the caller's own folder; every bucket is private
 *  R6  SECURITY DEFINER functions pin `search_path`; the ones that do not read the caller's id are not executable by
 *      `anon` / `authenticated`
 *  R7  deletion completeness: every foreign key to `auth.users` cascades (or nulls), every user-owned table is in the
 *      account export or listed here with a reason; every column that names a user has that foreign key
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EXPORT_TABLES } from "../../netlify/functions/_lib/account";
import { bootDb, MIG_DIR, migrationFiles, type Db } from "./supabase.harness";

/** The migrations this test was written against. Others are audited too; these must exist. */
const KNOWN_MIGRATIONS = [
  "0001_core",
  "0002_billing",
  "0003_exchange",
  "0004_social",
  "0005_mfa_everywhere",
  "0006_sync_schedule",
  "0007_seats_screenshots",
  "0008_alert_watch",
  "0009_proofs_boards",
  "0010_cases",
  "0011_simulations",
];

/** R2 – tables every signed-in user may read in full (aggregates, no user rows). */
const PUBLIC_READ: Record<string, string> = {
  community_stats: "daily k ≥ 10 distributions of the community – no user id, no single record",
};

/** R3 – readable tables that are NOT behind the aal2 rule, with the reason. */
const NO_MFA_RULE: Record<string, string> = {
  profiles: "privacy opt-ins and the plan are read before the code step (the client must know whether a code is needed)",
  ...Object.fromEntries(Object.keys(PUBLIC_READ).map((t) => [t, "public aggregate, nothing personal"])),
};

/** R4 – where the browser itself may write (table → rights). Everything else is read-only for `authenticated`. */
const CLIENT_WRITABLE: Record<string, readonly string[]> = {
  journal_docs: ["insert", "update"],
  simulations: ["insert", "update", "delete"],
  profiles: ["update"],
};

/** R6 – SECURITY DEFINER functions that take the user id as an argument and may be called by `authenticated`. */
const DEFINER_CALLABLE_WITHOUT_AUTH_UID: Record<string, string> = {
  cloud_shots_allowed: "plan gate of the storage policy, called with auth.uid(); answers one boolean about a plan",
};

/** R2b – columns whose NAME looks like secret material but that the browser may read, with the reason. */
const READABLE_SECRET_LOOKING: Record<string, string> = {
  "audit_log.ip_hash": "salted pseudonym of the user's OWN sign-in address, shown in their own security log (not reversible, never another person's)",
  "simulations.data_hash": "public integrity hash of the user's own simulation input (the reproducibility proof the card shows)",
  "simulations.result_hash": "public integrity hash of the user's own simulation result (the reproducibility proof the card shows)",
};

/** R7 – user-owned tables that are not (separately) in the account export. */
const EXPORT_EXCEPTIONS: Record<string, string> = {
  journal_docs: "exported as `journal` (backup format) by collectExport",
  alert_phone_secrets: "the phone number, encrypted (AES-GCM) + HMAC for uniqueness; the export lists the MASKED number (alert_phones). Known gap: the plain number is not part of the export file (the user entered it themselves)",
  alert_state: "internal memory of the alert engine (hysteresis / cooldown state), derived from the exported alert settings and events",
  jobs: "delivery queue of the alert pipeline (ids, counters, lease tokens) – the outcome is exported as alert_deliveries",
  tv_mcp_states: "short-lived (minutes) PKCE state of a running TradingView connection – no lasting data",
  mfa_recovery_codes: "HMAC hashes of the recovery codes (secret material, useless outside the server); the export would only show hashes – the status (how many are left) is in the account view",
  sync_cursor: "internal resume position of the exchange sync (a timestamp per stream) – no personal content",
  "group_reviews.reviewed_by": "the mentor who reviewed – the review itself is exported by its author; reviewer id is set null on deletion",
  "referrals.referred_id": "another person's account (the invited one) – never exported, set null on deletion",
};

/** Columns that name a user: must be a foreign key to auth.users. */
const USER_COLUMNS = ["user_id", "owner_id", "author_id", "referrer_id", "referred_id", "student_id", "mentor_id", "member_id", "created_by", "reviewed_by"];

let t: Db;
beforeAll(async () => {
  t = await bootDb();
}, 120_000);
afterAll(async () => {
  await t?.db.close();
});

interface TableRow {
  oid: number;
  relname: string;
  relrowsecurity: boolean;
  anon_any: boolean;
  sel: boolean;
  ins: boolean;
  upd: boolean;
  del: boolean;
}
interface PolicyRow {
  tablename: string;
  policyname: string;
  cmd: string;
  permissive: string;
  roles: string[] | string;
  qual: string | null;
  with_check: string | null;
}

async function tables(): Promise<TableRow[]> {
  return t.catalog<TableRow>(`
    select c.oid::int as oid, c.relname, c.relrowsecurity,
      (has_any_column_privilege('anon', c.oid, 'select') or has_any_column_privilege('anon', c.oid, 'insert') or has_any_column_privilege('anon', c.oid, 'update') or has_table_privilege('anon', c.oid, 'delete')) as anon_any,
      has_any_column_privilege('authenticated', c.oid, 'select') as sel,
      has_any_column_privilege('authenticated', c.oid, 'insert') as ins,
      has_any_column_privilege('authenticated', c.oid, 'update') as upd,
      has_table_privilege('authenticated', c.oid, 'delete') as del
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') order by c.relname`);
}

const policies = (schema = "public") => t.catalog<PolicyRow>(`select tablename, policyname, cmd, permissive, roles::text as roles, qual, with_check from pg_policies where schemaname = '${schema}' order by tablename, policyname`);

const forAuthenticated = (p: PolicyRow): boolean => /authenticated|public/.test(String(p.roles));
const covers = (p: PolicyRow, right: "SELECT" | "INSERT" | "UPDATE" | "DELETE"): boolean => p.cmd === right || p.cmd === "ALL";

async function ownerFunctions(): Promise<string[]> {
  const rows = await t.catalog<{ proname: string }>(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and (p.prosrc like '%auth.uid()%' or p.prosrc like '%auth.jwt()%') and p.proname <> 'mfa_satisfied'`);
  return rows.map((r) => r.proname);
}

describe("migrations", () => {
  it("are numbered from 0001, once each; the known ones exist (others are audited as well)", () => {
    const files = migrationFiles();
    const nums = files.map((f) => f.slice(0, 4));
    expect(new Set(nums).size, "two migrations with the same number").toBe(nums.length);
    expect(nums[0]).toBe("0001");
    const names = files.map((f) => f.replace(/\.sql$/, ""));
    for (const k of KNOWN_MIGRATIONS) expect(names, `missing migration ${k}`).toContain(k);
  });

  it("static text: every `create table public.x` has a matching `enable row level security`", () => {
    const all = migrationFiles().map((f) => readFileSync(join(MIG_DIR, f), "utf8"));
    const text = all.join("\n");
    const created = [...text.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?public\.([a-z_0-9]+)/gi)].map((m) => m[1]!.toLowerCase());
    expect(created.length).toBeGreaterThan(20);
    const enabled = new Set([...text.matchAll(/alter\s+table\s+(?:if\s+exists\s+)?public\.([a-z_0-9]+)\s+enable\s+row\s+level\s+security/gi)].map((m) => m[1]!.toLowerCase()));
    expect(created.filter((c) => !enabled.has(c)), "tables created without ENABLE ROW LEVEL SECURITY").toEqual([]);
  });
});

describe("R1 – row-level security on, anon locked out", () => {
  it("every public table has RLS on and `anon` holds no right", async () => {
    const rows = await tables();
    expect(rows.length).toBeGreaterThan(20);
    expect(rows.filter((r) => !r.relrowsecurity).map((r) => r.relname)).toEqual([]);
    expect(rows.filter((r) => r.anon_any).map((r) => r.relname)).toEqual([]);
  });
});

describe("R2 – what `authenticated` may do is tied to the caller", () => {
  it("each right it holds has a permissive policy that names the caller (auth.uid() or a helper that reads it)", async () => {
    const [rows, pols, helpers] = await Promise.all([tables(), policies(), ownerFunctions()]);
    const names = new RegExp(`auth\\.uid\\(\\)|\\b(${helpers.join("|")})\\(`);
    const problems: string[] = [];
    for (const r of rows) {
      const mine = pols.filter((p) => p.tablename === r.relname && forAuthenticated(p));
      for (const [has, right] of [[r.sel, "SELECT"], [r.ins, "INSERT"], [r.upd, "UPDATE"], [r.del, "DELETE"]] as const) {
        if (!has) continue;
        const permissive = mine.filter((p) => p.permissive === "PERMISSIVE" && covers(p, right));
        if (!permissive.length) {
          problems.push(`${r.relname}: authenticated can ${right} but no permissive policy covers it`);
          continue;
        }
        if (r.relname in PUBLIC_READ && right === "SELECT") continue;
        for (const p of permissive) {
          const cond = right === "INSERT" ? p.with_check : right === "UPDATE" ? `${p.qual ?? ""} ${p.with_check ?? ""}` : p.qual;
          if (!cond || !names.test(cond)) problems.push(`${r.relname}: policy "${p.policyname}" (${right}) does not tie the row to the caller: ${cond ?? "null"}`);
          if (right === "UPDATE" && !(p.with_check && names.test(p.with_check))) problems.push(`${r.relname}: policy "${p.policyname}" (UPDATE) has no WITH CHECK that names the caller – a row could be handed to someone else`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it("public-by-design tables stay what they claim: aggregates without a user column", async () => {
    for (const table of Object.keys(PUBLIC_READ)) {
      const cols = await t.catalog<{ column_name: string }>(`select column_name from information_schema.columns where table_schema = 'public' and table_name = '${table}'`);
      expect(cols.map((c) => c.column_name).filter((c) => USER_COLUMNS.includes(c)), `${table} gained a user column`).toEqual([]);
    }
  });

  it("every exception list entry still points at a real table (no stale exceptions)", async () => {
    const names = new Set((await tables()).map((r) => r.relname));
    for (const k of [...Object.keys(PUBLIC_READ), ...Object.keys(NO_MFA_RULE), ...Object.keys(CLIENT_WRITABLE)]) expect(names.has(k), `${k} is listed but does not exist`).toBe(true);
  });
});

describe("R2b – no secret-looking column is readable by the browser", () => {
  it("`authenticated` holds no select right on token / hash / ciphertext / lease columns", async () => {
    const rows = await t.catalog<{ t: string; c: string }>(`
      select c.relname as t, a.attname as c
      from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p') and a.attnum > 0 and not a.attisdropped
        and has_column_privilege('authenticated', c.oid, a.attnum, 'select')
        and a.attname ~ '(_enc$|_hash$|^lease_token$|^lease_|secret|password|refresh|access_token)'`);
    const found = rows.map((r) => `${r.t}.${r.c}`).filter((k) => !(k in READABLE_SECRET_LOOKING));
    expect(found, "readable by the browser although it looks like secret material – restrict the grant or list it with a reason").toEqual([]);
  });
});

describe("R3 – the aal2 rule", () => {
  it("every table the user can read carries the restrictive mfa_satisfied() policy", async () => {
    const [rows, pols] = await Promise.all([tables(), policies()]);
    const missing = rows
      .filter((r) => r.sel && !(r.relname in NO_MFA_RULE))
      .filter((r) => !pols.some((p) => p.tablename === r.relname && p.permissive === "RESTRICTIVE" && covers(p, "SELECT") && /mfa_satisfied\(\)/.test(p.qual ?? "")))
      .map((r) => r.relname);
    expect(missing, "readable without the aal2 rule").toEqual([]);
  });

  it("tables the user can WRITE are behind it for writes too", async () => {
    const [rows, pols] = await Promise.all([tables(), policies()]);
    const bad: string[] = [];
    for (const r of rows.filter((x) => x.ins || x.upd || x.del)) {
      if (r.relname in NO_MFA_RULE) continue;
      const ok = pols.some((p) => p.tablename === r.relname && p.permissive === "RESTRICTIVE" && p.cmd === "ALL" && /mfa_satisfied\(\)/.test(`${p.qual} ${p.with_check}`));
      if (!ok) bad.push(r.relname);
    }
    expect(bad).toEqual([]);
  });
});

describe("R4 – direct writes from the browser only where listed", () => {
  it("authenticated writes only the listed tables with the listed rights", async () => {
    const rows = await tables();
    const found: Record<string, string[]> = {};
    for (const r of rows) {
      const rights = [r.ins && "insert", r.upd && "update", r.del && "delete"].filter(Boolean) as string[];
      if (rights.length) found[r.relname] = rights;
    }
    for (const [table, rights] of Object.entries(found)) {
      expect(Object.keys(CLIENT_WRITABLE), `${table}: the browser may write here (${rights.join(", ")}) – review and list it`).toContain(table);
      for (const right of rights) expect(CLIENT_WRITABLE[table], `${table}: ${right} is not on the list`).toContain(right);
    }
  });
});

describe("R5 – storage", () => {
  it("every storage policy is bound to one bucket and to the caller's own folder; every bucket is private", async () => {
    const pols = await policies("storage");
    expect(pols.length).toBeGreaterThan(0);
    const bad: string[] = [];
    for (const p of pols) {
      const cond = `${p.qual ?? ""} ${p.with_check ?? ""}`;
      if (!/bucket_id = '[a-z_]+'/.test(cond)) bad.push(`${p.policyname}: no bucket`);
      if (!/storage\.foldername\(name\)\)\[1\] = \(\( SELECT auth\.uid\(\)/.test(cond)) bad.push(`${p.policyname}: not the caller's folder`);
      if (p.permissive !== "PERMISSIVE") bad.push(`${p.policyname}: unexpected restrictive policy`);
    }
    expect(bad).toEqual([]);
    const buckets = await t.catalog<{ id: string; public: boolean; file_size_limit: number | null }>("select id, public, file_size_limit from storage.buckets");
    expect(buckets.map((b) => b.id).sort()).toEqual(expect.arrayContaining(["screenshots", "backups"]));
    expect(buckets.filter((b) => b.public).map((b) => b.id), "public bucket").toEqual([]);
    // the one bucket the browser writes to has a size limit
    const policyBuckets = new Set(pols.map((p) => /bucket_id = '([a-z_]+)'/.exec(`${p.qual} ${p.with_check}`)?.[1]).filter(Boolean));
    for (const b of buckets.filter((x) => policyBuckets.has(x.id))) expect(b.file_size_limit, `${b.id}: client-writable bucket without a size limit`).not.toBeNull();
  });

  it("the buckets the functions clean up on account deletion exist in the migrations", async () => {
    const { USER_BUCKETS } = await import("../../netlify/functions/_lib/account");
    const buckets = (await t.catalog<{ id: string }>("select id from storage.buckets")).map((b) => b.id);
    for (const b of USER_BUCKETS) expect(buckets).toContain(b);
    // …and no other bucket holds per-user folders that the deletion would miss
    expect(buckets.filter((b) => !(USER_BUCKETS as readonly string[]).includes(b))).toEqual([]);
  });
});

describe("R6 – functions", () => {
  it("SECURITY DEFINER functions pin search_path; the ones that do not read the caller are not callable by anon / authenticated", async () => {
    const fns = await t.catalog<{ proname: string; prosecdef: boolean; proconfig: string[] | null; prosrc: string; anon_x: boolean; auth_x: boolean }>(`
      select p.proname, p.prosecdef, p.proconfig, p.prosrc,
        has_function_privilege('anon', p.oid, 'execute') as anon_x, has_function_privilege('authenticated', p.oid, 'execute') as auth_x
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prokind = 'f'`);
    const definers = fns.filter((f) => f.prosecdef);
    expect(definers.length).toBeGreaterThan(10);
    const bad: string[] = [];
    for (const f of definers) {
      if (!(f.proconfig ?? []).some((c) => c.startsWith("search_path="))) bad.push(`${f.proname}: SECURITY DEFINER without a pinned search_path`);
      if (f.anon_x) bad.push(`${f.proname}: SECURITY DEFINER callable by anon`);
      const readsCaller = /auth\.uid\(\)|auth\.jwt\(\)/.test(f.prosrc);
      if (f.auth_x && !readsCaller && !(f.proname in DEFINER_CALLABLE_WITHOUT_AUTH_UID)) bad.push(`${f.proname}: SECURITY DEFINER callable by authenticated without reading the caller (auth.uid / auth.jwt)`);
    }
    expect(bad).toEqual([]);
  });
});

describe("R7 – deletion completeness", () => {
  interface Fk {
    t: string;
    col: string;
    d: string;
  }
  const fks = () => t.catalog<Fk>(`select c.conrelid::regclass::text as t, a.attname as col, c.confdeltype::text as d from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey) where c.contype = 'f' and c.confrelid = 'auth.users'::regclass and c.conrelid::regclass::text not like 'auth.%' order by 1, 2`);

  it("every foreign key to auth.users cascades or nulls – deleting the auth user leaves no row that blocks it", async () => {
    const rows = await fks();
    expect(rows.length).toBeGreaterThan(20);
    expect(rows.filter((r) => !["c", "n"].includes(r.d)).map((r) => `${r.t}.${r.col}`)).toEqual([]);
  });

  it("every column that names a user is such a foreign key (no orphan-able user id)", async () => {
    const cols = await t.catalog<{ table_name: string; column_name: string }>(
      `select table_name, column_name from information_schema.columns where table_schema = 'public' and column_name in (${USER_COLUMNS.map((c) => `'${c}'`).join(",")}) order by 1, 2`,
    );
    const have = new Set((await fks()).map((r) => `${r.t.replace(/^public\./, "")}.${r.col}`));
    expect(cols.map((c) => `${c.table_name}.${c.column_name}`).filter((k) => !have.has(k))).toEqual([]);
  });

  it("every user-owned table (cascade) is in the account export or listed with a reason", async () => {
    const owned = (await fks()).filter((r) => r.d === "c").map((r) => ({ table: r.t.replace(/^public\./, ""), col: r.col }));
    const exported = new Set(EXPORT_TABLES.map((e) => `${e.table}.${e.userColumn}`));
    const missing = owned.filter((o) => !exported.has(`${o.table}.${o.col}`) && !(o.table in EXPORT_EXCEPTIONS) && !(`${o.table}.${o.col}` in EXPORT_EXCEPTIONS)).map((o) => `${o.table}.${o.col}`);
    expect(missing, "user-owned but neither exported nor listed in EXPORT_EXCEPTIONS").toEqual([]);
    // set-null columns (another person's id) are listed too, so nobody exports them by accident
    const nulled = (await fks()).filter((r) => r.d === "n").map((r) => `${r.t.replace(/^public\./, "")}.${r.col}`);
    for (const k of nulled) if (!["audit_log.user_id", "app_errors.user_id"].includes(k)) expect(EXPORT_EXCEPTIONS, `${k} (set null) needs a decision`).toHaveProperty([k]);
  });

  it("the export never selects a column that would hold a secret", () => {
    const secret = /(^|,)(token_hash|api_key_enc|secret_enc|[a-z_]*_enc|password|referred_id)(,|$)/;
    expect(EXPORT_TABLES.filter((e) => secret.test(e.columns)).map((e) => e.table)).toEqual([]);
  });
});
