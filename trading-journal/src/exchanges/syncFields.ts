/**
 * Which trade fields belong to the exchange and which to the trader (P11) – the ONE rule of the exchange sync, shared
 * by the server (`netlify/functions/_lib/exchanges`, relative import), the SQL function `upsert_synced_trades`
 * (supabase/migrations/0003_exchange.sql mirrors these lists) and the local merge of signed-in devices without cloud
 * sync (`./localMerge.ts`).
 *
 * - SET keys: written by the exchange on every sync (prices, quantities, times, fees, funding, net P&L, fills).
 * - FILL keys: taken from the exchange only while the trader has not set them (stop, target, stop history, TP ladder,
 *   liquidation price) – a stop the trader typed is never replaced.
 * - Everything else (setups, checklist, notes, reason, emotion, tags, rating, psyche, screenshots, drawings, mistakes,
 *   account, timeframe, …) belongs to the trader and is never touched once the record exists.
 *
 * PURE and ALIAS-FREE: no `@/…` imports, no DOM – the Netlify functions import this file by relative path.
 */

/** Exchange-owned: overwritten on every sync. */
export const SYNC_SET_KEYS = [
  "exchange",
  "exchangeAccount",
  "externalId",
  "syncSource",
  "syncedAt",
  "origin",
  "market",
  "side",
  "status",
  "date",
  "exitDate",
  "pair",
  "entry",
  "exit",
  "qty",
  "size",
  "leverage",
  "marginMode",
  "fees",
  "fundingFees",
  "pnlManual",
  "pnl",
  "fills",
] as const;

/** Taken from the exchange only while the record has no value (null, "", [] or missing). */
export const SYNC_FILL_KEYS = ["stop", "target", "stopHistory", "targets", "liqPrice"] as const;

/** Bookkeeping keys that never make a record "changed" on their own. */
export const SYNC_VOLATILE_KEYS = ["syncedAt", "updatedAt"] as const;

export type SyncSetKey = (typeof SYNC_SET_KEYS)[number];
export type SyncFillKey = (typeof SYNC_FILL_KEYS)[number];

type Rec = Record<string, unknown>;

const isPlain = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);

/** null / undefined / "" / [] – a FILL key with such a value may be filled by the exchange. */
export function isEmptySyncValue(v: unknown): boolean {
  return v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
}

/** Deterministic JSON (sorted object keys) – equality of two records independent of key order. */
export function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`;
  if (isPlain(v)) {
    return `{${Object.keys(v)
      .filter((k) => v[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson(v[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

/** The exchange-owned part of a mapped trade: `{ set, fill }` (keys the record does not carry are left out). */
export function splitSyncFields(trade: Rec): { set: Rec; fill: Rec } {
  const set: Rec = {};
  const fill: Rec = {};
  for (const k of SYNC_SET_KEYS) if (trade[k] !== undefined) set[k] = trade[k];
  for (const k of SYNC_FILL_KEYS) if (!isEmptySyncValue(trade[k])) fill[k] = trade[k];
  return { set, fill };
}

/** Equal apart from the volatile bookkeeping keys (`syncedAt`, `updatedAt`). */
export function sameIgnoringVolatile(a: Rec, b: Rec): boolean {
  const strip = (r: Rec): Rec => {
    const o: Rec = { ...r };
    for (const k of SYNC_VOLATILE_KEYS) delete o[k];
    return o;
  };
  return stableJson(strip(a)) === stableJson(strip(b));
}

/**
 * Merges the exchange fields of `incoming` into the trader's `current` record: SET keys overwrite, FILL keys only fill
 * empty values, every other key of `current` stays exactly as it is. Returns `null` when nothing but the volatile keys
 * would change (no write needed), else the merged record with `updatedAt = nowIso`.
 */
export function mergeSyncedTrade<T extends Rec>(current: T, incoming: Rec, nowIso: string): T | null {
  const { set, fill } = splitSyncFields(incoming);
  const merged: Rec = { ...current, ...set };
  for (const [k, v] of Object.entries(fill)) if (isEmptySyncValue(merged[k])) merged[k] = v;
  if (sameIgnoringVolatile(merged, current)) return null;
  merged.updatedAt = nowIso;
  return merged as T;
}

/** Venue prefix of the deterministic synced trade id: `t_bx_<positionId>` for Bitunix. */
export const SYNC_ID_PREFIX: Readonly<Record<string, string>> = {
  bitunix: "t_bx_",
  binance: "t_bn_",
  bybit: "t_by_",
  okx: "t_ok_",
};

/** Deterministic id of a synced position (`t_bx_123`); ids from other characters are reduced to `[A-Za-z0-9_-]`. */
export function syncedTradeId(exchange: string, externalId: string): string {
  const prefix =
    SYNC_ID_PREFIX[exchange] ??
    `t_${exchange
      .replace(/[^a-z0-9]/gi, "")
      .slice(0, 6)
      .toLowerCase()}_`;
  return `${prefix}${externalId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 96)}`;
}

/** True for a record the exchange sync (API) wrote. */
export function isSyncedRecord(t: Rec): boolean {
  return typeof t.syncSource === "string" && t.syncSource.endsWith("-api");
}
