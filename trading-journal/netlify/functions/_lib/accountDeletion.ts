/**
 * Account deletion vs. ending a subscription (B1) – kept apart on purpose, in this order:
 * 1. `deletionPlan` (GET): what a deletion would touch – subscription status, the data (trades, files) – so the user decides
 *    knowing it;
 * 2. the app offers the export;
 * 3. `POST` with the confirmation word and, while a subscription runs, an explicit acknowledgement – enforced HERE, not only
 *    in the UI;
 * 4. everything goes: subscriptions (Stripe, immediately, no pro-rata refund – said in the texts), seats, the files of the
 *    private buckets (verified empty afterwards), recovery codes, then the auth user (cascade).
 * `verifyErased` reads the per-user tables once more after the deletion and lists what is still there (names and counts,
 * never rows) – the report goes into the answer and the log so a hole in the cascade is visible.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { EXPORT_TABLES, isMissingTable, listUserFiles, USER_BUCKETS } from "./account";
import { planOf } from "./plan";
import { supabaseAdmin } from "./supabase";

export type SubscriptionState = "none" | "running" | "ending" | "issue";

export interface DeletionPlan {
  confirmWord: string;
  subscription: {
    state: SubscriptionState;
    plan: string;
    status: string;
    /** End of the paid period (ISO) or `null`. */
    currentPeriodEnd: string | null;
    /** The user already cancelled: the plan runs to `currentPeriodEnd`. */
    cancelAtPeriodEnd: boolean;
  };
  data: { trades: number; hyblock: number; days: number; screenshots: number; backups: number };
}

const OPEN = new Set(["trialing", "active", "past_due", "unpaid", "paused", "incomplete"]);

interface SubRow {
  status: string;
  plan: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
}

async function openSubscription(userId: string, sb: SupabaseClient): Promise<SubRow | null> {
  const { data, error } = await sb.from("subscriptions").select("status, plan, current_period_end, cancel_at_period_end").eq("user_id", userId).order("updated_at", { ascending: false }).limit(10);
  if (error) {
    if (!isMissingTable(error)) console.error("[fn] subscriptions read failed", error.code);
    return null;
  }
  return ((data ?? []) as SubRow[]).find((r) => OPEN.has(r.status)) ?? null;
}

async function countDocs(userId: string, kind: string, sb: SupabaseClient): Promise<number> {
  try {
    const { count, error } = await sb.from("journal_docs").select("*", { count: "exact", head: true }).eq("user_id", userId).eq("kind", kind).eq("deleted", false);
    return error ? 0 : (count ?? 0);
  } catch {
    return 0;
  }
}

export async function deletionPlan(userId: string, confirmWord: string, sb: SupabaseClient = supabaseAdmin()): Promise<DeletionPlan> {
  const [sub, plan, trades, hyblock, days, screenshots, backups] = await Promise.all([
    openSubscription(userId, sb),
    planOf(userId),
    countDocs(userId, "trade", sb),
    countDocs(userId, "hyblock", sb),
    countDocs(userId, "day", sb),
    listUserFiles("screenshots", userId, sb).then((l) => l.length),
    listUserFiles("backups", userId, sb).then((l) => l.length),
  ]);
  const profileOpen = OPEN.has(plan.status) && plan.plan !== "free";
  let state: SubscriptionState = "none";
  if (sub) state = sub.cancel_at_period_end ? "ending" : sub.status === "past_due" || sub.status === "unpaid" ? "issue" : "running";
  else if (profileOpen) state = "running";
  return {
    confirmWord,
    subscription: { state, plan: sub?.plan ?? (profileOpen ? plan.plan : "free"), status: sub?.status ?? plan.status, currentPeriodEnd: sub?.current_period_end ?? null, cancelAtPeriodEnd: !!sub?.cancel_at_period_end },
    data: { trades, hyblock, days, screenshots, backups },
  };
}

/** Files left in the private buckets of the user (0 each when the cleanup is complete). */
export async function leftoverFiles(userId: string, sb: SupabaseClient = supabaseAdmin()): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const b of USER_BUCKETS) out[b] = (await listUserFiles(b, userId, sb)).length;
  return out;
}

/** After the user is gone: tables of `EXPORT_TABLES` that still hold rows of that id (`{}` = erased completely). */
export async function verifyErased(userId: string, sb: SupabaseClient = supabaseAdmin()): Promise<Record<string, number>> {
  const left: Record<string, number> = {};
  for (const t of [...EXPORT_TABLES, { table: "journal_docs", userColumn: "user_id", columns: "kind" }]) {
    try {
      const { count, error } = await sb.from(t.table).select("*", { count: "exact", head: true }).eq(t.userColumn, userId);
      if (!error && (count ?? 0) > 0) left[t.table] = count ?? 0;
    } catch {
      /* unreadable table: nothing to report */
    }
  }
  return left;
}
