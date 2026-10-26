/**
 * Types of the Handelsplan that other panels build on. The slot `TimeMachineSlot` (`Slots.tsx`) gets the plan as it stands –
 * market, direction, entry, stop, target, size – plus the candles it was made from and the session, so a replay can walk the
 * plan through the candles. The slot only READS: it never changes the plan, never saves, never sends an order.
 */
import type { Candle } from "@/market/types";
import type { Side } from "@/domain/types";

export interface TimeMachineSlotProps {
  /** market symbol, `BTCUSDT` */
  symbol: string;
  side: Side;
  entry: number;
  stop: number;
  target: number;
  /** quantity of the plan, `null` while the size is open */
  qty: number | null;
  /** the candles the plan was made from (ascending; the last may still be running) */
  candles: readonly Candle[];
  /** candle length (ms) */
  intervalMs: number;
  /** the session: open and regular end (ms), IANA zone */
  sessionOpenMs: number;
  sessionCloseMs: number;
  tz: string;
  /** the close of the signal candle (ms), `null` = the entry was planned ahead or typed */
  entryAt: number | null;
  /** the "flat by" instant (ms) */
  flatByMs: number | null;
  /** price step, for the numbers */
  tick: number;
  currency: string;
  /** the market kind of the plan; absent = crypto */
  market?: "crypto" | "stocks";
  /** the plan's own fee per side and slippage (fractions, from the risk settings) – the stock history is costed with them; crypto keeps the Labor's costs */
  feePct?: number;
  slippagePct?: number;
  /** where the candles came from and when they were loaded */
  source: { label: string; fetchedAt: number | null };
}
