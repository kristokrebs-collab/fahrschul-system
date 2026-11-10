/**
 * Receipt log of the TradingView webhook (Paket Verbindungen, B3; table `webhook_receipts`, migration 0012).
 * What is stored: time, kind (test / open / close / rejected), symbol, a short reason – never the alert text, the token
 * or an IP. Best effort: a missing table (migration not applied) or a failing write never fails the webhook itself.
 */
import { isMissingTable } from "../account";
import { supabaseAdmin } from "../supabase";

export type ReceiptKind = "test" | "open" | "close" | "rejected";
export type ReceiptVia = "app" | "extern";

export interface Receipt {
  id: string;
  kind: ReceiptKind;
  via: ReceiptVia;
  symbol: string | null;
  detail: string | null;
  receivedAt: string;
}

/** Rows kept per user. */
export const RECEIPTS_KEEP = 30;

const clean = (v: string | null | undefined, max: number): string | null => {
  if (!v) return null;
  // plain text only: control characters and markup characters never reach the card
  const t = [...v].map((c) => (c.charCodeAt(0) < 32 || c === "<" || c === ">" ? " " : c)).join("").replace(/\s+/g, " ").trim().slice(0, max);
  return t || null;
};

export async function recordReceipt(userId: string, r: { kind: ReceiptKind; via?: ReceiptVia; symbol?: string | null; detail?: string | null }): Promise<void> {
  try {
    const sb = supabaseAdmin();
    const { error } = await sb.from("webhook_receipts").insert({
      user_id: userId,
      source: "tradingview",
      kind: r.kind,
      via: r.via ?? "extern",
      symbol: clean(r.symbol, 40),
      detail: clean(r.detail, 200),
    });
    if (error) {
      if (!isMissingTable(error)) console.error("[fn] receipt write failed", error.code ?? "");
      return;
    }
    // keep the newest RECEIPTS_KEEP rows
    const old = await sb.from("webhook_receipts").select("id").eq("user_id", userId).order("received_at", { ascending: false }).range(RECEIPTS_KEEP, RECEIPTS_KEEP + 60);
    const ids = ((old.data ?? []) as { id: string }[]).map((x) => x.id);
    if (ids.length) await sb.from("webhook_receipts").delete().eq("user_id", userId).in("id", ids);
  } catch (e) {
    console.error("[fn] receipt write failed", e instanceof Error ? e.name : typeof e);
  }
}

export async function listReceipts(userId: string, limit = 10): Promise<{ receipts: Receipt[]; available: boolean }> {
  const { data, error } = await supabaseAdmin()
    .from("webhook_receipts")
    .select("id,kind,via,symbol,detail,received_at")
    .eq("user_id", userId)
    .order("received_at", { ascending: false })
    .limit(limit);
  if (error) {
    if (!isMissingTable(error)) console.error("[fn] receipt read failed", error.code ?? "");
    return { receipts: [], available: false };
  }
  return {
    available: true,
    receipts: ((data ?? []) as Record<string, unknown>[]).map((r) => ({
      id: String(r.id),
      kind: r.kind as ReceiptKind,
      via: r.via === "app" ? "app" : "extern",
      symbol: typeof r.symbol === "string" ? r.symbol : null,
      detail: typeof r.detail === "string" ? r.detail : null,
      receivedAt: String(r.received_at),
    })),
  };
}
