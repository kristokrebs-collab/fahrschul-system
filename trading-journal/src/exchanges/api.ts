/**
 * Calls of the exchange functions (P11) through `apiFetch` (same origin, bearer token, German `ApiError`s).
 * Every call needs a signed-in cloud session; secrets are sent once (connect) and never come back.
 */
import { apiFetch } from "@/cloud/api";
import type {
  ApiToken,
  ConnectInput,
  ConnectResult,
  ExchangeConnection,
  ExchangeStatus,
  JournalAccount,
  PositionsResult,
  PullResult,
  SyncResult,
  TokenScope,
} from "./types";

/** The browser's IANA zone (the server writes trade times as local wall clock in it). */
export function browserTz(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Berlin";
  } catch {
    return "Europe/Berlin";
  }
}

export const fetchExchangeStatus = () => apiFetch<ExchangeStatus>("/exchange/sync");

export const connectExchange = (input: ConnectInput) => apiFetch<ConnectResult>("/exchange/connect", { method: "POST", body: input });

export const patchConnection = (connectionId: string, patch: { journalAccount?: JournalAccount; syncEnabled?: boolean; label?: string }) =>
  apiFetch<{ connection: ExchangeConnection }>("/exchange/connect", { method: "PATCH", body: { connectionId, ...patch } });

export const disconnectExchange = (connectionId: string) => apiFetch<{ ok: true }>("/exchange/disconnect", { method: "POST", body: { connectionId } });

export const runExchangeSync = (opts: { connectionId?: string; dryRun?: boolean; from?: string } = {}) =>
  apiFetch<SyncResult>("/exchange/sync", {
    method: "POST",
    query: { dryRun: opts.dryRun ? 1 : undefined },
    body: { connectionId: opts.connectionId, tz: browserTz(), from: opts.from },
  });

/** Starts the first import in the background (202, empty body); progress shows up as the run `runId`. */
export const startBackfill = (connectionId: string, from: string, runId: string) =>
  apiFetch<unknown>("/exchange/backfill", { method: "POST", body: { connectionId, from, runId, tz: browserTz() } });

export const pullServerTrades = (since: string | null) => apiFetch<PullResult>("/exchange/sync", { query: since ? { since } : { pull: 1 } });

export const fetchExchangePositions = () => apiFetch<PositionsResult>("/exchange/positions");

export const listApiTokens = () => apiFetch<{ tokens: ApiToken[] }>("/trades/tokens");
export const createApiToken = (name: string, scopes: TokenScope[]) => apiFetch<{ token: string; info: ApiToken }>("/trades/tokens", { method: "POST", body: { name, scopes } });
export const revokeApiToken = (id: string) => apiFetch<{ ok: true }>(`/trades/tokens/${encodeURIComponent(id)}`, { method: "DELETE" });
