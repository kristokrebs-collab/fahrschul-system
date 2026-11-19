/**
 * Adapter of the live check to `explainDecision` (F10): which trigger price and stop the "zu spät" check reads, and how
 * the engine's `Signals` map to the explanation's inputs. Pure.
 */
import type { FeedState, WhyInput } from "@/domain/decision";
import type { Side, Signals, SignalCfg, TraderNetView } from "@/domain/signals";

/** A candle as far as the adapter reads it. */
export interface TriggerBar {
  time: number;
  close: number;
  closed: boolean;
}

/**
 * Close of the base rung's signal candle for `side` (the reference entry): the CLOSED candle whose open time is
 * `barOpen`. A signal that sits on the forming candle (vorläufig) has no trigger yet → `null`.
 */
export function triggerClose(bars: readonly TriggerBar[], barOpen: number): number | null {
  const bar = bars.find((b) => b.time === barOpen);
  return bar && bar.closed ? bar.close : null;
}

/** The stop the support/resistance part computed for the side (`null` = part off or no level). */
export function plannedStop(v: Pick<Signals["long"], "parts">): number | null {
  return v.parts?.find((p) => p.id === "sr")?.levels?.stop ?? null;
}

export interface WhyOptions {
  feed: FeedState;
  lageOn: boolean;
  maxLateR: number;
  /** close of the signal candle (see `triggerClose`) */
  trigger: number | null;
  price: number | null;
  /** the net position of the big Binance accounts (optional; shown as one explained row, never scored) */
  traderNet?: TraderNetView | null;
}

export function whyInput(snap: Signals & { cfg: SignalCfg }, side: Side, o: WhyOptions): WhyInput {
  const v = snap[side];
  const other = snap[side === "long" ? "short" : "long"];
  return {
    side,
    verdict: v,
    other: { valid: other.valid, strength: other.strength, label: other.label },
    checks: snap.checks,
    zone: snap.zone,
    cfg: snap.cfg,
    knife: snap.knife?.[side] ?? null,
    // `snap.lage`: undefined = no gate input; null = gate given but no Lage data
    lage: snap.lage === undefined ? null : { on: o.lageOn, hasData: snap.lage !== null && snap.lage.lage !== null },
    price: o.price,
    plan: { trigger: o.trigger, stop: plannedStop(v) },
    maxLateR: o.maxLateR,
    feed: o.feed,
    traderNet: o.traderNet ?? null,
  };
}
