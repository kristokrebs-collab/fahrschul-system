/**
 * Server environment (Wave-0 contract, owner P09). Netlify: mark every value as SECRET, scope "Functions", never use a
 * `VITE_` prefix (Vite would inline it into the client bundle). Names: see `.env.example`.
 * Reads `Netlify.env` (v2 runtime) and falls back to `process.env` (tests, `netlify dev`).
 */
import { HttpError } from "./http";

export const SERVER_ENV = [
  "SUPABASE_URL",
  "SUPABASE_SECRET_KEY",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_PRICE_PRO_MONTHLY",
  "STRIPE_PRICE_PRO_YEARLY",
  "STRIPE_PRICE_PREMIUM_MONTHLY",
  "STRIPE_PRICE_PREMIUM_YEARLY",
  "STRIPE_PRICE_TEAM_MONTHLY",
  "STRIPE_PRICE_TEAM_YEARLY",
  "TRIAL_DAYS",
  "EXCHANGE_ENC_KEY_V1",
  "SITE_ORIGIN",
  "SYNC_CRON_ENABLED",
  "LOG_SAMPLE_RATE",
  "IP_HASH_PEPPER",
  "ANTHROPIC_API_KEY",
  "COACH_MODEL",
  "ROUTER_MODEL",
  "VISION_MODEL",
] as const;

/** Known names plus further key versions for rotation (`EXCHANGE_ENC_KEY_V2`, …). */
export type ServerEnvName = (typeof SERVER_ENV)[number] | `EXCHANGE_ENC_KEY_V${number}`;

type NetlifyEnvGlobal = { Netlify?: { env?: { get(name: string): string | undefined } } };

/** Raw value, `undefined` when unset or empty. */
export function envOptional(name: ServerEnvName): string | undefined {
  const fromNetlify = (globalThis as NetlifyEnvGlobal).Netlify?.env?.get(name);
  const v = fromNetlify ?? process.env[name];
  return v === undefined || v === "" ? undefined : v;
}

/** Required value; a missing one is a deploy mistake → 500 `server_misconfigured` (the name is logged, not returned). */
export function env(name: ServerEnvName): string {
  const v = envOptional(name);
  if (v === undefined) {
    console.error(`[fn] missing env ${name}`);
    throw new HttpError(500, "server_misconfigured", "Der Server ist nicht vollständig eingerichtet.");
  }
  return v;
}

/** Integer value or `fallback` when unset / not an integer. */
export function envInt(name: ServerEnvName, fallback: number): number {
  const v = envOptional(name);
  const n = v === undefined ? NaN : Number(v);
  return Number.isInteger(n) ? n : fallback;
}

/** Number value or `fallback`. */
export function envNumber(name: ServerEnvName, fallback: number): number {
  const v = envOptional(name);
  const n = v === undefined ? NaN : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** "1" / "true" / "yes" / "on" → true, "0" / "false" / "no" / "off" → false, else `fallback`. */
export function envBool(name: ServerEnvName, fallback: boolean): boolean {
  const v = envOptional(name)?.trim().toLowerCase();
  if (v === "1" || v === "true" || v === "yes" || v === "on") return true;
  if (v === "0" || v === "false" || v === "no" || v === "off") return false;
  return fallback;
}
