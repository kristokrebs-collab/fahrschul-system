/**
 * Data hooks of the Risiko page (P05) and the editor contract `useRiskPreview(draft)`.
 *
 * - Clock: `useMinute()` re-renders once per minute (day boundaries, the pause) – never per second; countdowns run on
 *   `nowMv` in leaf nodes.
 * - Prices: the live provider symbol's price is read from `priceMv` when the slow price snapshot changes (≤ every 10 s);
 *   the live uPnL itself is a MotionValue (`useLiveUpnl`) – zero React renders per tick.
 */
import { useTransform, type MotionValue } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { exposureReport, limitStatus, riskLimits, riskPreview, symbolOf, type ExposureLeg, type ExposureReport, type LimitReport, type RiskDraft, type RiskLimits, type RiskPreview, type RiskScope } from "@/domain/risk";
import type { AccountId, EnrichedTrade, Settings } from "@/domain/types";
import { useExchangePositions, type ExchangePosition } from "@/exchanges/positions";
import { priceMv, useProvider, usePriceSnapshot } from "@/market";
import { getEnriched, useEnriched, useJournal } from "@/store/journalStore";
import { useUi } from "@/store/uiStore";
import { useRiskGuardStore } from "./guard";

/** Re-renders at every full minute (cleared on unmount). */
export function useMinute(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const arm = () => {
      const n = Date.now();
      t = setTimeout(() => {
        setNow(Date.now());
        arm();
      }, 60_000 - (n % 60_000) + 50);
    };
    arm();
    return () => clearTimeout(t);
  }, []);
  return now;
}

export interface RiskBase {
  acc: RiskScope;
  settings: Settings;
  enriched: EnrichedTrade[];
  limits: RiskLimits;
  cur: string;
  /** start capital of the scope */
  capital: number;
  now: number;
  positions: readonly ExchangePosition[];
}

/** Account of the Hero's switch + settings + trades + positions + the minute clock. */
export function useRiskBase(): RiskBase {
  const acc = useUi((s) => s.acc);
  const settings = useJournal((s) => s.settings);
  const enriched = useEnriched();
  const positions = useExchangePositions();
  const now = useMinute();
  const limits = useMemo(() => riskLimits(settings), [settings]);
  const capital = acc === "all" ? settings.capital.makro + settings.capital.scalp : settings.capital[acc];
  return { acc, settings, enriched, limits, cur: settings.currency, capital, now, positions };
}

/** The live limit report of the scope (recomputed on data changes and once a minute). */
export function useLimitReport(base: RiskBase): LimitReport {
  const marks = useRiskGuardStore((s) => s.marks);
  const { enriched, settings, acc, now, positions } = base;
  return useMemo(() => limitStatus({ trades: enriched, settings, scope: acc, now, marks, positions }), [enriched, settings, acc, now, marks, positions]);
}

/** Live marks by symbol: the provider symbol's price (refreshed with the slow price snapshot) + venue marks. */
export function useMarks(positions: readonly ExchangePosition[]): Readonly<Record<string, number>> {
  const provider = useProvider();
  const snap = usePriceSnapshot(10_000);
  const sym = provider?.symbolInfo.binance ?? null;
  return useMemo(() => {
    const out: Record<string, number> = {};
    for (const p of positions) {
      const s = symbolOf(p.symbol);
      if (s && p.mark != null && p.mark > 0) out[s] = p.mark;
    }
    const live = priceMv.get();
    if (sym && snap.price != null && live > 0) out[sym] = live;
    return out;
  }, [positions, sym, snap.price]);
}

/** Exposure of the scope's open trades + the venue positions. */
export function useExposure(base: RiskBase): ExposureReport {
  const marks = useMarks(base.positions);
  const { enriched, acc, positions, capital } = base;
  const open = useMemo(() => enriched.filter((t) => t.result === "open" && (acc === "all" || (t.account ?? "scalp") === acc)), [enriched, acc]);
  return useMemo(() => exposureReport({ open, positions, prices: marks, capital }), [open, positions, marks, capital]);
}

/**
 * Live unrealised P&L of the legs: legs on the provider symbol follow `priceMv` (one transform, no React render per
 * tick), the others keep their last known uPnL (venue / snapshot).
 */
export function useLiveUpnl(legs: readonly ExposureLeg[]): MotionValue<number> {
  const provider = useProvider();
  const sym = provider?.symbolInfo.binance ?? null;
  const { live, fixed } = useMemo(() => {
    const liveLegs = legs.filter((l) => l.source === "journal" && sym && l.symbol === sym);
    const fixedSum = legs.filter((l) => !liveLegs.includes(l)).reduce((s, l) => s + (l.upnl ?? 0), 0);
    return { live: liveLegs.map((l) => ({ dir: l.side === "short" ? -1 : 1, qty: l.qty, entry: l.entry, upnl: l.upnl ?? 0 })), fixed: fixedSum };
  }, [legs, sym]);
  return useTransform(priceMv, (p) => fixed + live.reduce((s, l) => s + (p > 0 ? l.dir * l.qty * (p - l.entry) : l.upnl), 0));
}

/**
 * Editor contract (P14 binds it into the TradeEditor): checks a trade BEFORE it is saved against the limits of its
 * account – risk % vs. the per-trade limit, leverage rule, liquidation before the stop, day limit, open risk, trades
 * per day and a running pause. Warnings only; `null` without a draft.
 */
export function useRiskPreview(draft: RiskDraft | null | undefined): RiskPreview | null {
  const trades = useJournal((s) => s.trades);
  const settings = useJournal((s) => s.settings);
  const marks = useRiskGuardStore((s) => s.marks);
  const positions = useExchangePositions();
  const now = useMinute();
  const acc: AccountId = draft?.account ?? "scalp";
  const editId = draft?.id ?? null;
  // an edited trade is judged against the journal WITHOUT itself (its open risk / today's count would count twice)
  const report = useMemo(() => {
    const all = getEnriched(trades, settings);
    return limitStatus({ trades: editId ? all.filter((t) => t.id !== editId) : all, settings, scope: acc, now, marks, positions });
  }, [trades, settings, acc, now, marks, positions, editId]);
  const d = draft ?? null;
  const key = d ? JSON.stringify([d.account, d.side, d.status, d.entry, d.stop, d.target, d.size, d.qty, d.leverage, d.marginMode, d.margin]) : "";
  return useMemo(() => {
    if (!d) return null;
    return riskPreview(d, { limits: report.limits, report, capital: settings.capital[acc] ?? 0, now });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` fingerprints the draft (a new object per keystroke)
  }, [key, report, settings, acc, now]);
}
