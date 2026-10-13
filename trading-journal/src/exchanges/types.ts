/**
 * Client view of the exchange functions (P11) – the JSON the Netlify functions answer (`netlify/functions/exchange-*`).
 * No secret ever appears here: the server returns the last 4 characters of a key at most.
 */
import type { Trade } from "@/domain/types";
import type { ExchangeId, ExchangePosition } from "./positions";

export type JournalAccount = "makro" | "scalp";
export type ConnectionStatus = "active" | "invalid" | "revoked" | "paused";

export interface ExchangeConnection {
  id: string;
  exchange: ExchangeId;
  label: string;
  keyLast4: string;
  permissions: string[];
  status: ConnectionStatus;
  lastSyncAt: string | null;
  lastError: string | null;
  journalAccount: JournalAccount;
  syncEnabled: boolean;
  createdAt: string;
}

export type RunKind = "manual" | "cron" | "backfill" | "dry_run";
export type RunStatus = "running" | "ok" | "partial" | "error";

export interface SyncCounts {
  fetched: number;
  inserted: number;
  updated: number;
  unchanged: number;
  skipped: number;
}

export interface SyncRun extends SyncCounts {
  id: string;
  connectionId: string | null;
  exchange: string;
  kind: RunKind;
  status: RunStatus;
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
  more: boolean;
  dryRun: boolean;
}

export interface ExchangePlan {
  plan: string;
  entitled: boolean;
  /** Allowed connections, `null` = unlimited. */
  limit: number | null;
  gated: boolean;
}

export interface ExchangeStatus {
  /** The server can store keys (encryption key set). */
  configured: boolean;
  cron: { enabled: boolean; everyMin: number; nextAt: string };
  plan: ExchangePlan;
  connections: ExchangeConnection[];
  runs: SyncRun[];
}

export interface PositionCheck {
  id: string;
  externalId: string;
  pair: string;
  side: "long" | "short";
  date: string;
  exitDate: string;
  qty: number;
  entry: number;
  exit: number;
  gross: number;
  realizedPnl: number;
  fee: number;
  funding: number;
  net: number;
  fills: number;
  stop: number | null;
  target: number | null;
  /** Journal state of the deterministic id. */
  state: "new" | "exists" | "deleted";
}

export interface PnlConvention {
  feesIncluded: boolean | null;
  samples: number;
  votesExcluded: number;
  votesIncluded: number;
  /** Decided on this batch (else the stored / documented convention was used). */
  used: boolean;
}

export interface SyncResult {
  runId: string;
  status: RunStatus;
  counts: SyncCounts;
  more: boolean;
  window: { from: number; to: number };
  dryRun: boolean;
  trades: Trade[];
  checks: PositionCheck[];
  convention: PnlConvention;
  fillsSkipped: number;
  requests: number;
}

export interface ConnectInput {
  exchange: ExchangeId;
  apiKey: string;
  secret: string;
  label?: string;
  journalAccount: JournalAccount;
  readOnlyConfirmed: true;
}

export interface ConnectResult {
  connection: ExchangeConnection;
  account: { marginCoin: string; available: number; margin: number; unrealizedPnl: number };
}

export interface PulledTrade {
  id: string;
  data: Record<string, unknown>;
  updatedAt: string;
}

export interface PullResult {
  trades: PulledTrade[];
  more: boolean;
  /** Cursor after the last trade of this page (send it as `since`); null for an empty page. Older servers omit it. */
  next?: string | null;
  serverAt: string;
}

export interface PositionsResult {
  positions: ExchangePosition[];
  errors: { connectionId: string; code: string; message: string }[];
  at: string;
}

export type TokenScope = "trades:read" | "trades:write" | "webhook:tradingview";

export interface ApiToken {
  id: string;
  name: string;
  prefix: string;
  scopes: TokenScope[];
  lastUsedAt: string | null;
  createdAt: string;
}
