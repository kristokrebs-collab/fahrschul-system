/**
 * TradingView connection state of the client (Paket Verbindungen) – mirrors `/api/v1/connections/tradingview`. The plain
 * webhook address exists only here, only after the user created it in this session (`url`), and is never persisted: the
 * server keeps the hash. Closing the tab forgets it (the user can create a new one, which replaces the old address).
 */
import { create } from "zustand";
import { ApiError, apiFetch } from "@/cloud/api";
import { cloudEnabled } from "@/cloud/env";
import { useCloudSession } from "@/cloud/session";
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

export interface TvStatus {
  hasToken: boolean;
  token: { id: string; prefix: string; createdAt: string; lastUsedAt: string | null } | null;
  receipts: TvReceipt[];
  receiptsAvailable: boolean;
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
}

const INITIAL: TvState = { status: null, load: "idle", error: null, busy: null, url: null };
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
