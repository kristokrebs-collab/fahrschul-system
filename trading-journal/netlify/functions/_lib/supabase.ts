/**
 * Service-role Supabase client (Wave-0 contract, owner P09). Bypasses RLS – use it only after `requireUser` and always
 * filter by the verified `user.id`. Never call `signIn*` / `signUp` on it (a user session would replace the key).
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "./env";

let cached: SupabaseClient | null = null;
let override: SupabaseClient | null = null;

/** Memoised admin client from `SUPABASE_URL` + `SUPABASE_SECRET_KEY` (or the test double). */
export function supabaseAdmin(): SupabaseClient {
  if (override) return override;
  cached ??= createClient(env("SUPABASE_URL"), env("SUPABASE_SECRET_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { "x-client-info": "trading-journal-functions" } },
  });
  return cached;
}

/** Alias used in the package plans (`admin()`). */
export const admin = supabaseAdmin;

/** Tests: inject a fake client (`null` restores the real one). */
export function setSupabaseAdminForTests(client: SupabaseClient | null): void {
  override = client;
  cached = null;
}
