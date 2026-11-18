/**
 * Counters of the operator status (C4 Monitoring): registrations, sync runs, background jobs, webhooks and billing
 * problems of the last 24 hours – counts only, never a row, an address or an id. Read with the service role; a table
 * that does not exist yet (the jobs table of a later migration) is reported as unavailable, not as zero.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingTable } from "./account";
import { supabaseAdmin } from "./supabase";

export interface Counted {
  /** `false` = the table or the database could not be read – the numbers are not zero, they are unknown. */
  available: boolean;
  n: number | null;
}

export interface OpsStats {
  windowHours: number;
  registrations: Counted & { last7d: number | null };
  syncRuns: { available: boolean; total: number | null; errors: number | null; partial: number | null };
  jobs: { available: boolean; total: number | null; failed: number | null; note: string };
  webhooks: { available: boolean; received: number | null; failed: number | null; lastReceivedAt: string | null };
  billing: { available: boolean; pastDueOrUnpaid: number | null };
  appErrors: Counted;
  alertWatch: { available: boolean; at: string | null; ok: boolean | null; code: string | null };
}

const HOUR = 3_600_000;

async function count(sb: SupabaseClient, table: string, build: (q: ReturnType<ReturnType<SupabaseClient["from"]>["select"]>) => unknown): Promise<{ n: number | null; missing: boolean }> {
  try {
    const base = sb.from(table).select("*", { count: "exact", head: true });
    const { count: c, error } = (await build(base)) as { count: number | null; error: { code?: string } | null };
    if (error) return { n: null, missing: isMissingTable(error) };
    return { n: c ?? 0, missing: false };
  } catch {
    return { n: null, missing: false };
  }
}

export async function collectStats(now: Date = new Date(), sb: SupabaseClient = supabaseAdmin()): Promise<OpsStats> {
  const day = new Date(now.getTime() - 24 * HOUR).toISOString();
  const week = new Date(now.getTime() - 7 * 24 * HOUR).toISOString();
  type Q = { gte(c: string, v: string): Q; not(c: string, op: string, v: unknown): Q; in(c: string, v: unknown[]): Q; eq(c: string, v: unknown): Q };
  const q = (b: unknown) => b as Q;

  const [reg24, reg7, runsAll, runsErr, runsPart, evAll, evFail, past, errs] = await Promise.all([
    count(sb, "profiles", (b) => q(b).gte("created_at", day)),
    count(sb, "profiles", (b) => q(b).gte("created_at", week)),
    count(sb, "sync_runs", (b) => q(b).gte("started_at", day)),
    count(sb, "sync_runs", (b) => q(b).gte("started_at", day).eq("status", "error")),
    count(sb, "sync_runs", (b) => q(b).gte("started_at", day).eq("status", "partial")),
    count(sb, "stripe_events", (b) => q(b).gte("received_at", day)),
    count(sb, "stripe_events", (b) => q(b).gte("received_at", day).not("error", "is", null)),
    count(sb, "subscriptions", (b) => q(b).in("status", ["past_due", "unpaid"])),
    count(sb, "app_errors", (b) => q(b).gte("at", day)),
  ]);

  const lastReceivedAt: string | null = await Promise.resolve(sb.from("stripe_events").select("received_at").order("received_at", { ascending: false }).limit(1))
    .then(({ data }) => (data?.[0] as { received_at?: string } | undefined)?.received_at ?? null)
    .catch(() => null);

  // jobs: the table arrives with a later migration (alerts / jobs); until then it is "not available", not "0"
  const jobsAll = await count(sb, "jobs", (b) => q(b).gte("created_at", day));
  const jobsFailed = jobsAll.n === null ? jobsAll : await count(sb, "jobs", (b) => q(b).gte("created_at", day).in("status", ["failed", "dead"]));

  let alertWatch: OpsStats["alertWatch"] = { available: false, at: null, ok: null, code: null };
  try {
    const { data } = await sb.from("app_config").select("value").eq("key", "alert-watch").maybeSingle();
    const v = (data as { value?: { at?: unknown; ok?: unknown; code?: unknown } } | null)?.value;
    if (v) alertWatch = { available: true, at: typeof v.at === "string" ? v.at : null, ok: typeof v.ok === "boolean" ? v.ok : null, code: typeof v.code === "string" ? v.code : null };
  } catch {
    alertWatch = { available: false, at: null, ok: null, code: null };
  }

  const ok = (c: { n: number | null }) => c.n !== null;
  return {
    windowHours: 24,
    registrations: { available: ok(reg24), n: reg24.n, last7d: reg7.n },
    syncRuns: { available: ok(runsAll), total: runsAll.n, errors: runsErr.n, partial: runsPart.n },
    jobs: { available: ok(jobsAll), total: jobsAll.n, failed: jobsFailed.n, note: ok(jobsAll) ? "Aus der Tabelle jobs." : "Tabelle jobs fehlt (kommt mit der Alarm-Migration) – Zahlen unbekannt, nicht null." },
    webhooks: { available: ok(evAll), received: evAll.n, failed: evFail.n, lastReceivedAt },
    billing: { available: ok(past), pastDueOrUnpaid: past.n },
    appErrors: { available: ok(errs), n: errs.n },
    alertWatch,
  };
}
