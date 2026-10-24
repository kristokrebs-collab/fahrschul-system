/**
 * The optimiser as a section of the Labor page: hands the panel the strategies of the lab (the idea in the editor and the saved
 * drafts), loads their candles with the lab's own loader (cache first, same market, period and costs as the lab's set-up) and
 * connects "save" / "challenger" to the drafts and the forward test (`labHost.ts`). Its own lazy chunk (`LaborView`).
 */
import { useCallback, useMemo, useRef, useState } from "react";
import { DEFAULT_FUNDING_RATE, feePreset, fundingModelOf, type EngineCfg, type FundingPoint, type HistInterval } from "@/domain/backtest/index";
import { customStrategy } from "@/domain/backtest/strategies/custom";
import { higherTfsOf, type CustomConfig } from "@/domain/lab";
import { searchIntervals, searchWarmupMs } from "@/domain/evolve";
import { sanitizeSignalCfg } from "@/domain/signals";
import { useJournal } from "@/store/journalStore";
import { loadErrorKind, loadLabData } from "@/views/labor/historySource";
import { PERIOD_DAYS, useLabor } from "@/views/labor/laborStore";
import { LABOR } from "@/views/labor/strings";
import { EvolvePanel } from "./EvolvePanel";
import { draftEntryId, EDITOR_ID, saveProposalAsVersion, startProposalAsChallenger } from "./labHost";
import type { CandleSet, CandleStatus, StrategyEntry } from "./types";

const MAX_DRAFTS = 5;
const MIN_BARS = 300;

/** `undefined` = the candles are not loaded yet: with the real history chosen the model is an empty history until they are. */
function fundingOf(mode: "history" | "flat" | "none", points: FundingPoint[] | null | undefined): EngineCfg["costs"]["funding"] {
  if (mode === "none") return { kind: "none" };
  if (mode === "history" && points === undefined) return { kind: "history", points: [], fallbackRate: DEFAULT_FUNDING_RATE };
  return fundingModelOf(mode === "history" ? (points ?? null) : null, DEFAULT_FUNDING_RATE);
}

interface Loaded {
  /** what the candles were loaded for: a change of market, period, costs or rules' timeframes makes them stale */
  key: string;
  set: CandleSet;
  funding: FundingPoint[] | null;
}

export function EvolveSection() {
  const cfg = useLabor((s) => s.cfg);
  const drafts = useLabor((s) => s.drafts);
  const rawSignals = useJournal((s) => s.settings.signals);
  const signal = useMemo(() => sanitizeSignalCfg(rawSignals), [rawSignals]);
  const [loaded, setLoaded] = useState<Record<string, Loaded>>({});
  const [status, setStatus] = useState<Record<string, CandleStatus>>({});
  const inflight = useRef(new Set<string>());

  const editorIdea = cfg.custom;
  const configs = useMemo(() => {
    const list: { id: string; name: string; config: CustomConfig; label?: string }[] = [{ id: EDITOR_ID, name: `${editorIdea.name} (Editor)`, config: editorIdea }];
    for (const d of drafts.slice(0, MAX_DRAFTS)) list.push({ id: draftEntryId(d.id), name: d.name, config: d.config, label: d.origin ? "fremd" : undefined });
    return list;
  }, [editorIdea, drafts]);

  const keyOf = useCallback((id: string, c: (typeof configs)[number]): string => `${id}|${cfg.symbol}|${cfg.period}|${cfg.funding}|${c.config.interval}|${searchIntervals(c.config, higherTfsOf(c.config)).join(",")}`, [cfg.symbol, cfg.period, cfg.funding]);

  const engineOf = useCallback(
    (funding: FundingPoint[] | null | undefined): EngineCfg => {
      const fee = feePreset(cfg.exchange);
      return {
        capital: cfg.capital,
        riskPct: cfg.riskPct / 100,
        maxLeverage: cfg.maxLeverage,
        compounding: true,
        costs: { fees: { exchange: fee.exchange, makerBps: fee.makerBps, takerBps: fee.takerBps }, slippage: cfg.slippage, funding: fundingOf(cfg.funding, funding) },
      };
    },
    [cfg.exchange, cfg.capital, cfg.riskPct, cfg.maxLeverage, cfg.slippage, cfg.funding],
  );

  const entries = useMemo<StrategyEntry[]>(() => configs.map((c) => ({ id: c.id, name: c.name, config: c.config, symbol: cfg.symbol, signal, engine: engineOf(loaded[c.id]?.key === keyOf(c.id, c) ? loaded[c.id]!.funding : undefined), versionLabel: c.label })), [configs, cfg.symbol, signal, engineOf, loaded, keyOf]);

  const candles = useMemo(() => {
    const out: Record<string, CandleSet | undefined> = {};
    for (const c of configs) if (loaded[c.id]?.key === keyOf(c.id, c)) out[c.id] = loaded[c.id]!.set;
    return out;
  }, [configs, loaded, keyOf]);

  const load = useCallback(
    (ids: readonly string[]): void => {
      for (const id of ids) {
        const c = configs.find((x) => x.id === id);
        if (!c || inflight.current.has(id)) continue;
        inflight.current.add(id);
        setStatus((s) => ({ ...s, [id]: { state: "loading", progress: 0 } }));
        const now = Date.now();
        const fromMs = now - PERIOD_DAYS[cfg.period] * 86_400_000;
        const ivs = [...new Set<HistInterval>([...customStrategy.intervals({ config: c.config, signal }), ...searchIntervals(c.config, higherTfsOf(c.config))])];
        const warm = Math.max(searchWarmupMs(c.config), customStrategy.warmupMs({ config: c.config, signal }));
        void loadLabData({
          symbol: cfg.symbol,
          intervals: ivs,
          from: fromMs - warm,
          to: now,
          funding: cfg.funding === "history",
          onProgress: (done, total) => setStatus((s) => ({ ...s, [id]: { state: "loading", progress: total ? Math.min(1, done / total) : 0 } })),
        })
          .then((res) => {
            const exec = res.data[c.config.interval] ?? [];
            if (exec.length < MIN_BARS) {
              setStatus((s) => ({ ...s, [id]: { state: "error", message: LABOR.errors.noData } }));
              return;
            }
            const set: CandleSet = { data: res.data, fromMs, toMs: now, loadedAt: now, source: "Binance USDⓈ-M" };
            setLoaded((l) => ({ ...l, [id]: { key: keyOf(id, c), set, funding: res.funding } }));
            setStatus((s) => ({ ...s, [id]: { state: "idle" } }));
          })
          .catch((e: unknown) => {
            const kind = loadErrorKind(e);
            setStatus((s) => ({ ...s, [id]: { state: "error", message: kind === "blocked" ? LABOR.errors.blocked : kind === "rate" ? LABOR.errors.rate : kind === "symbol" ? LABOR.errors.symbol : LABOR.errors.failed } }));
          })
          .finally(() => inflight.current.delete(id));
      }
    },
    [configs, cfg.period, cfg.symbol, cfg.funding, signal, keyOf],
  );

  return (
    <div data-testid="evolve-section">
      <EvolvePanel strategies={entries} candles={candles} candleStatus={status} onLoadCandles={load} onSaveVersion={saveProposalAsVersion} onStartChallenger={startProposalAsChallenger} defaultSelected={[EDITOR_ID]} />
    </div>
  );
}

export default EvolveSection;
