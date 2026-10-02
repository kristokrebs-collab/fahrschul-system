import { useCallback, useState } from "react";

/** The four MarketPanel mini tiles in their default order. */
export const MARKET_TILE_IDS = ["funding", "oi", "taker", "book"] as const;
export type MarketTileId = (typeof MARKET_TILE_IDS)[number];

/** Per-browser UI preference (not journal data): the user's tile order after a drag. */
export const MARKET_TILES_KEY = "tj2-ui-market-tiles";

const isTileId = (v: unknown): v is MarketTileId => typeof v === "string" && (MARKET_TILE_IDS as readonly string[]).includes(v);

/**
 * Validates a stored order: JSON array of known ids, duplicates dropped, missing tiles appended in default order.
 * Anything else (garbage, an old format, a removed tile id) falls back to the default.
 */
export function parseTileOrder(raw: string | null | undefined): MarketTileId[] {
  if (!raw) return [...MARKET_TILE_IDS];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [...MARKET_TILE_IDS];
  }
  if (!Array.isArray(parsed)) return [...MARKET_TILE_IDS];
  const out: MarketTileId[] = [];
  for (const v of parsed) if (isTileId(v) && !out.includes(v)) out.push(v);
  for (const id of MARKET_TILE_IDS) if (!out.includes(id)) out.push(id);
  return out;
}

function readOrder(): MarketTileId[] {
  try {
    return parseTileOrder(localStorage.getItem(MARKET_TILES_KEY));
  } catch {
    return [...MARKET_TILE_IDS];
  }
}

/** Tile order state, read once on mount and written on every reorder (storage failures keep the in-memory order). */
export function useMarketTileOrder(): [MarketTileId[], (ids: string[]) => void] {
  const [order, setOrder] = useState(readOrder);
  const change = useCallback((ids: string[]) => {
    const next = parseTileOrder(JSON.stringify(ids));
    setOrder(next);
    try {
      localStorage.setItem(MARKET_TILES_KEY, JSON.stringify(next));
    } catch {
      /* private mode / quota: the order lives for this session only */
    }
  }, []);
  return [order, change];
}
