/**
 * TradingView connection state of the client (Paket Verbindungen) – mirrors `/api/v1/connections/tradingview`. The plain
 * webhook address exists only here, only after the user created it in this session (`url`), and is never persisted: the
 * server keeps the hash. Closing the tab forgets it (the user can create a new one, which replaces the old address).
 */
import { create } from "zustand";
import { ApiError, apiFetch } from "@/cloud/api";
import { cloudEnabled } from "@/cloud/env";
import { useCloudSession } from "@/cloud/session";
import type { ReceivedSignal } from "@/domain/industryTrend/bridge";
import { hasClaudeRuntime } from "@/store/capability";
import { TV_APP_TEST_BODY, webhookUrl } from "./tvTemplates";

export interface TvReceipt {
  id: string;
  kind: "test" | "open" | "close" | "rejected";
  via: "app" | "extern";
  symbol: string | null;
  detail: string | null;
  receivedAt: string;
}

/** One delivery to the address, with its fate (`signals` of the server; older servers only know `receipts`, see `tvList`). */
export interface TvSignal extends ReceivedSignal {
  reason: string | null;
  source: string;
  signalId: string | null;
  market: string | null;
  via: "app" | "extern";
}

/** State of the OAuth connection to the official TradingView MCP (`mcp` of the server; tokens never reach the browser). */
export interface TvMcp {
  /** the operator set it up (`TV_MCP_CLIENT_ID`); false = "Einrichtung nötig (Betreiber)" */
  configured: boolean;
  host: string | null;
  connected: boolean;
  status: "active" | "invalid" | null;
  scope: string | null;
  lastError: string | null;
  lastTestAt: string | null;
  lastTestOk: boolean | null;
  createdAt: string | null;
}

export interface TvStatus {
  hasToken: boolean;
  token: { id: string; prefix: string; createdAt: string; lastUsedAt: string | null } | null;
  receipts: TvReceipt[];
  receiptsAvailable: boolean;
  /** B3: the last deliveries with their fate; absent on a server without the signal receiver */
  signals?: TvSignal[];
  signalsAvailable?: boolean;
  mcp?: TvMcp;
  tradeAlerts: { allowed: boolean; plan: string };
  origin: string | null;
}

export interface TvState {
  status: TvStatus | null;
  load: "idle" | "loading" | "ready" | "error";
  error: string | null;
  busy: "create" | "rotate" | "revoke" | "test" | null;
  /** The plain address of the last create / rotate in THIS session. */
  url: string | null;
  /** MCP connection: what is running, the last answer of the read test, an error in words, how the sign-in at TradingView ended */
  mcpBusy: "start" | "test" | "revoke" | null;
  mcpTest: { tools: number; watchlists: number | null } | null;
  mcpError: string | null;
  mcpReturn: "ok" | "abgebrochen" | "fehler" | null;
}

const INITIAL: TvState = { status: null, load: "idle", error: null, busy: null, url: null, mcpBusy: null, mcpTest: null, mcpError: null, mcpReturn: null };
export const useTv = create<TvState>()(() => ({ ...INITIAL }));

export function resetTvStore(): void {
  useTv.setState({ ...INITIAL });
}

const messageOf = (e: unknown): string => (e instanceof ApiError ? e.message : e instanceof Error && e.message ? e.message : "Das hat nicht geklappt. Bitte erneut versuchen.");

/** The build can talk to the functions and somebody is signed in. */
export function tvAvailable(): boolean {
  const s = useCloudSession.getState();
  return cloudEnabled() && !hasClaudeRuntime() && s.phase === "signedIn";
}

export async function loadTv(): Promise<TvStatus | null> {
  if (!tvAvailable()) {
    useTv.setState({ status: null, load: "idle", error: null });
    return null;
  }
  useTv.setState((s) => ({ load: s.status ? s.load : "loading" }));
  try {
    const status = await apiFetch<TvStatus>("/connections/tradingview");
    useTv.setState({ status, load: "ready", error: null });
    settleBranchen(status);
    return status;
  } catch (e) {
    useTv.setState({ load: "error", error: messageOf(e) });
    return null;
  }
}

/** Creates the address (first time) or replaces it (`rotate`). The old address stops working at once. */
export async function createTv(rotate: boolean): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  useTv.setState({ busy: rotate ? "rotate" : "create", error: null });
  try {
    const out = await apiFetch<{ token: string; path: string }>("/connections/tradingview", { method: "POST", body: { action: rotate ? "rotate" : "create" } });
    const origin = useTv.getState().status?.origin ?? null;
    const url = webhookUrl(out.token, origin, typeof location !== "undefined" ? location.origin : "");
    useTv.setState({ url });
    await loadTv();
    return { ok: true, url };
  } catch (e) {
    const error = messageOf(e);
    useTv.setState({ error });
    return { ok: false, error };
  } finally {
    useTv.setState({ busy: null });
  }
}

export async function revokeTv(): Promise<boolean> {
  useTv.setState({ busy: "revoke", error: null });
  try {
    await apiFetch("/connections/tradingview", { method: "DELETE" });
    useTv.setState({ url: null });
    await loadTv();
    return true;
  } catch (e) {
    useTv.setState({ error: messageOf(e) });
    return false;
  } finally {
    useTv.setState({ busy: null });
  }
}

/** Posts the test body to the user's own address from this app (proves the address works end to end), then reloads the receipts. */
export async function sendAppTest(): Promise<{ ok: true } | { ok: false; error: string }> {
  const url = useTv.getState().url;
  if (!url) return { ok: false, error: "Die Zieladresse ist nur direkt nach dem Erstellen sichtbar. Erstelle eine neue." };
  useTv.setState({ busy: "test", error: null });
  try {
    // TradingView posts text/plain, so the test does too (no CORS preflight, no token header)
    const res = await fetch(url, { method: "POST", headers: { "content-type": "text/plain" }, body: TV_APP_TEST_BODY });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      const error = body?.error?.message ?? `Die Zieladresse hat mit ${res.status} geantwortet.`;
      useTv.setState({ error });
      return { ok: false, error };
    }
    await loadTv();
    return { ok: true };
  } catch {
    const error = "Die Zieladresse ist nicht erreichbar. Prüfe deine Verbindung und versuche es erneut.";
    useTv.setState({ error });
    return { ok: false, error };
  } finally {
    useTv.setState({ busy: null });
  }
}

/** The list the card shows: the signals when the server has them, else the older receipts in the same shape. */
export function tvList(status: TvStatus | null | undefined): TvSignal[] {
  if (!status) return [];
  if (status.signalsAvailable && status.signals) return status.signals;
  return status.receipts.map((r): TvSignal => ({
    id: r.id,
    kind: r.kind === "test" ? "test" : "signal",
    status: r.kind === "rejected" ? "rejected" : "processed",
    reason: r.kind === "rejected" ? r.detail : null,
    schemaId: r.kind === "open" || r.kind === "close" ? "legacy-action" : null,
    source: "tradingview",
    signalId: null,
    strategy: null,
    market: null,
    symbol: r.symbol,
    direction: r.kind === "open" ? "long" : r.kind === "close" ? "flat" : null,
    time: null,
    data: null,
    via: r.via,
    receivedAt: r.receivedAt,
  }));
}

/**
 * B3 → C1: received Branchen-Signale are settled against the PAPER book (`views/aktien/branchen/signalBridge`, its own lazy chunk, loaded only
 * when such a signal is there). Idempotent, old signals ignored, nothing is sent anywhere. Same test as `isBranchenSignal` in the domain
 * (kept inline so this file does not pull the paper rules into its chunk).
 */
function settleBranchen(status: TvStatus): void {
  const rows = status.signalsAvailable ? status.signals : undefined;
  if (!rows?.some((s) => s.kind === "signal" && s.status === "processed" && (s.schemaId === "branchen-trend/1" || s.data?.zustand))) return;
  void import("@/views/aktien/branchen/signalBridge").then((m) => m.runBridge(rows)).catch(() => undefined);
}

/* ------------------------------------------------------------------------------------------------ MCP connection (OAuth, read only) */

/** Where the browser may be sent to sign in: an https address, nothing else (a server answer is data, not a command). */
export const isHttpsUrl = (u: unknown): u is string => {
  if (typeof u !== "string") return false;
  try {
    return new URL(u).protocol === "https:";
  } catch {
    return false;
  }
};

/** Starts the sign-in at TradingView: the server makes the address (PKCE + state), the browser goes there and comes back to the settings. */
export async function startMcp(go: (url: string) => void = (u) => location.assign(u)): Promise<boolean> {
  useTv.setState({ mcpBusy: "start", mcpError: null, mcpReturn: null });
  try {
    const out = await apiFetch<{ url?: unknown }>("/connections/tradingview/mcp/start", { method: "POST" });
    if (!isHttpsUrl(out.url)) throw new Error("Der Server hat keine gültige Anmelde-Adresse geliefert.");
    go(out.url);
    return true;
  } catch (e) {
    useTv.setState({ mcpError: messageOf(e) });
    return false;
  } finally {
    useTv.setState({ mcpBusy: null });
  }
}

/** The read test (initialize, tools/list, list_watchlists – nothing is written). */
export async function testMcp(): Promise<boolean> {
  useTv.setState({ mcpBusy: "test", mcpError: null });
  try {
    const out = await apiFetch<{ tools: number; watchlists: number | null }>("/connections/tradingview/mcp/test", { method: "POST" });
    useTv.setState({ mcpTest: { tools: out.tools, watchlists: out.watchlists } });
    await loadTv();
    return true;
  } catch (e) {
    useTv.setState({ mcpError: messageOf(e), mcpTest: null });
    await loadTv();
    return false;
  } finally {
    useTv.setState({ mcpBusy: null });
  }
}

/** Revokes at TradingView (best effort) and deletes the tokens on the server. `revoked: false` = TradingView did not confirm. */
export async function revokeMcp(): Promise<{ ok: boolean; revoked: boolean }> {
  useTv.setState({ mcpBusy: "revoke", mcpError: null });
  try {
    const out = await apiFetch<{ ok: boolean; revoked: boolean }>("/connections/tradingview/mcp", { method: "DELETE" });
    useTv.setState({ mcpTest: null, mcpReturn: null });
    await loadTv();
    return { ok: true, revoked: !!out.revoked };
  } catch (e) {
    useTv.setState({ mcpError: messageOf(e) });
    return { ok: false, revoked: false };
  } finally {
    useTv.setState({ mcpBusy: null });
  }
}
