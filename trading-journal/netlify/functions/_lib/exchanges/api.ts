/**
 * Shared pieces of the exchange functions (P11): availability check, plan state, error mapping, schedule info.
 */
import { limitOf, planIncludes } from "../../../../src/billing/plans";
import { envBool } from "../env";
import { HttpError } from "../http";
import { paymentsConfigured, planOf } from "../plan";
import { encryptionConfigured } from "./store";
import { ExchangeError } from "./types";

/** Cron cadence (keep in step with `exchange-sync-cron.mts` `config.schedule`). */
export const CRON_EVERY_MIN = 30;
/** Budget of a synchronous function call (Netlify stops synchronous functions at 10 s). */
export const SYNC_BUDGET_MS = 8_000;

/** 503 with an honest German hint when the server cannot hold exchange keys (no `EXCHANGE_ENC_KEY_V1`). */
export function requireExchangeSetup(): void {
  if (!encryptionConfigured()) {
    throw new HttpError(503, "exchange_unavailable", "Der Börsen-Sync ist auf diesem Server noch nicht eingerichtet (Verschlüsselungsschlüssel fehlt).");
  }
}

/** Venue error → HttpError (credential problems are 422, never 401 – a 401 means "your app session expired"). */
export function exchangeHttpError(e: unknown): unknown {
  if (!(e instanceof ExchangeError)) return e;
  const status = e.status === 401 || e.status === 403 ? 422 : e.status;
  return new HttpError(status, e.code, e.message);
}

export interface ExchangePlanState {
  plan: string;
  /** The plan includes the automatic sync (or payments are not set up yet – then nothing is gated). */
  entitled: boolean;
  /** Connections the plan allows (`null` = unlimited). */
  limit: number | null;
  gated: boolean;
}

export async function exchangePlanState(userId: string): Promise<ExchangePlanState> {
  const info = await planOf(userId);
  const gated = paymentsConfigured();
  const limit = gated ? limitOf(info.plan, "exchangeConnections") : Infinity;
  return { plan: info.plan, entitled: !gated || planIncludes(info.plan, "exchangeSync"), limit: Number.isFinite(limit) ? limit : null, gated };
}

export function cronEnabled(): boolean {
  return envBool("SYNC_CRON_ENABLED", true) && encryptionConfigured();
}

/** Next cron slot after `now` (every `CRON_EVERY_MIN` minutes on the UTC clock). */
export function nextCronAt(now = Date.now()): string {
  const step = CRON_EVERY_MIN * 60_000;
  return new Date(Math.floor(now / step) * step + step).toISOString();
}

/** `Intl`-valid zone sent by the client, else null. */
export function clientTz(v: unknown): string | null {
  if (typeof v !== "string" || !v || v.length > 64) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: v }).format(0);
    return v;
  } catch {
    return null;
  }
}
