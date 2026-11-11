/**
 * Client adapter of the cloud table `simulations` (migration 0011): PostgREST calls for the signed-in user, RLS limits every call to
 * the own rows. Lazy: this file is imported only when a save happens while signed in (the Supabase client chunk is loaded by
 * `ensureCloud()`, never statically). Only figures and hashes go up – see `toRow` in `@/domain/timemachine`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { fromRow, toRow, type SimulationRecord } from "@/domain/timemachine";
import type { SimulationRemote } from "./simStore";

const COLUMNS = "id,trade_id,symbol,interval,seed,model_version,data_hash,data_bars,data_from,data_to,source,runs,horizon,plan,costs,metrics,result_hash,client_created_at,created_at";
const PAGE = 500;
const CHUNK = 50;

interface PgError {
  message?: string;
  code?: string;
}

function fail(what: string, error: PgError | null | undefined): never {
  throw new Error(`${what}: ${error?.message ?? "failed"}${error?.code ? ` (${error.code})` : ""}`);
}

export function createSupabaseSimulations(sb: SupabaseClient, userId: string): SimulationRemote {
  const table = () => sb.from("simulations");
  return {
    async upsert(records) {
      for (let i = 0; i < records.length; i += CHUNK) {
        const rows = records.slice(i, i + CHUNK).map((r) => ({ user_id: userId, ...toRow(r) }));
        const { error } = await table().upsert(rows, { onConflict: "user_id,id" });
        if (error) fail("simulations upsert", error);
      }
    },
    async pull() {
      const out: SimulationRecord[] = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await table()
          .select(COLUMNS)
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .range(from, from + PAGE - 1);
        if (error) fail("simulations pull", error);
        const rows = (data ?? []) as unknown[];
        for (const row of rows) {
          const r = fromRow(row);
          if (r) out.push(r);
        }
        if (rows.length < PAGE) return out;
      }
    },
    async remove(id) {
      const { error } = await table().delete().eq("user_id", userId).eq("id", id);
      if (error) fail("simulations delete", error);
    },
  };
}
