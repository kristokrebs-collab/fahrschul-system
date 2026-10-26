/**
 * Everything the Handelsplan page shows, in one hook: the form → the session → the candles (cache first, live refresh while the
 * session runs) → the pure model (`buildPlanModel`) with the live limits of the account. The candles are only loaded for a
 * source that exists (crypto today). The clock of the page ticks every ten seconds while the session is live, once a minute
 * while the page waits for the next "latest session", and never for a day in the past.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { buildPlanModel, candleWindow, latestSession, MIN, planOfSettings, sessionDay, sessionDef, TF_MS, type PlanForm, type PlanModel, type PlanPrefs, type SessionDay } from "@/domain/plan";
import { limitStatus, riskLimits, type LimitReport, type RiskLimits } from "@/domain/risk";
import { useExchangePositions } from "@/exchanges/positions";
import type { PlanCandles } from "@/market/plan/candles";
import { sourceOf, type PlanCandleSource } from "@/market/plan/sources";
import type { Candle } from "@/market/types";
import { useEnriched, useJournal } from "@/store/journalStore";
import { useRiskGuardStore } from "@/views/risiko/guard";
import { usePlanForm } from "./planStore";

export type CandleStatus = "idle" | "loading" | "ready" | "error" | "unavailable";

export interface CandleState {
  status: CandleStatus;
  candles: Candle[];
  sourceLabel: string;
  fetchedAt: number | null;
  fromCache: boolean;
  error: string | null;
  /** the time of the last trade the source reports (stocks), `null` = the source does not say */
  marketTime: number | null;
  /** what the source says about itself (stocks: unofficial, delayed, how far back it reaches) */
  notes: readonly string[];
}

const EMPTY: CandleState = { status: "idle", candles: [], sourceLabel: "keine Daten", fetchedAt: null, fromCache: false, error: null, marketTime: null, notes: [] };
/** A running session reloads its tail this often (one request of weight 1). */
export const LIVE_REFRESH_MS = 30_000;
const LIVE_TICK_MS = 10_000;
const IDLE_TICK_MS = 60_000;

function stateOf(r: PlanCandles, source: PlanCandleSource, status: CandleStatus): CandleState {
  const name = r.sourceLabel ?? source.label;
  // a source that names itself (stocks) is "cache" only when its refresh failed and the last good answer is shown
  const label = r.source === "proxy" ? `${name} (EU-Proxy)` : r.source === "cache" || (r.sourceLabel != null && r.fromCache && r.error != null) ? `${name} – Zwischenspeicher dieses Browsers` : name;
  return { status, candles: r.candles, sourceLabel: label, fetchedAt: r.fetchedAt, fromCache: r.fromCache, error: r.error, marketTime: r.marketTime ?? null, notes: r.notes ?? [] };
}

/** Candles for the form's session, cache first; `reload()` asks again at once. */
export function usePlanCandles(form: PlanForm, session: SessionDay, live: boolean): { state: CandleState; reload: () => void; loading: boolean } {
  const source = sourceOf(sessionDef(form.session).market);
  const { symbol, tf } = form;
  const { openMs, closeMs, tradingDay } = session;
  const key = `${symbol}|${tf}|${openMs}|${closeMs}`;
  const [loaded, setLoaded] = useState<{ key: string; state: CandleState }>({ key: "", state: EMPTY });
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);
  const loadedKey = useRef("");
  // "Neu laden" asks the source again even where it would answer from a fresh cache
  const forceFresh = useRef(false);

  useEffect(() => {
    if (!source.ready || !source.load || !tradingDay) return;
    const load = source.load;
    const ctl = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let alive = true;
    const run = async (): Promise<void> => {
      if (!alive) return;
      // a hidden tab keeps what it has (the first load of a window always runs)
      if (typeof document !== "undefined" && document.hidden && loadedKey.current === key) {
        if (live) timer = setTimeout(() => void run(), LIVE_REFRESH_MS);
        return;
      }
      setLoading(true);
      const win = candleWindow({ openMs, closeMs } as SessionDay, TF_MS[tf], Date.now());
      const fresh = forceFresh.current;
      forceFresh.current = false;
      try {
        const res = await load({
          symbol,
          interval: tf,
          from: win.from,
          to: win.to,
          signal: ctl.signal,
          ...(fresh ? { fresh: true } : {}),
          onCache: (r) => {
            if (alive) setLoaded((cur) => (cur.key === key && cur.state.status === "ready" ? cur : { key, state: stateOf(r, source, "loading") }));
          },
        });
        if (!alive) return;
        loadedKey.current = key;
        setLoaded({ key, state: stateOf(res, source, res.error && !res.candles.length ? "error" : "ready") });
      } catch (e) {
        if (!alive || (e as { name?: string }).name === "AbortError") return;
        setLoaded({ key, state: { ...EMPTY, status: "error", sourceLabel: source.label, error: "Die Kerzen ließen sich nicht laden." } });
      } finally {
        if (alive) setLoading(false);
      }
      if (alive && live) timer = setTimeout(() => void run(), LIVE_REFRESH_MS);
    };
    void run();
    return () => {
      alive = false;
      ctl.abort();
      if (timer) clearTimeout(timer);
    };
  }, [key, symbol, tf, openMs, closeMs, live, tick, source, tradingDay]);

  const state: CandleState = !source.ready
    ? { ...EMPTY, status: "unavailable", sourceLabel: source.label, error: source.notReady ?? null }
    : !tradingDay
      ? { ...EMPTY, status: "ready", sourceLabel: source.label }
      : loaded.key === key
        ? loaded.state
        : { ...EMPTY, status: "loading", sourceLabel: source.label };
  return {
    state,
    reload: () => {
      forceFresh.current = true;
      setTick((n) => n + 1);
    },
    loading,
  };
}

export interface PlanVm {
  form: PlanForm;
  model: PlanModel;
  candles: CandleState;
  reload: () => void;
  loading: boolean;
  now: number;
  live: boolean;
  limits: RiskLimits;
  report: LimitReport;
  capital: number;
  currency: string;
  prefs: PlanPrefs;
}

export function usePlanModel(): PlanVm {
  const form = usePlanForm((s) => s.form);
  const settings = useJournal((s) => s.settings);
  const enriched = useEnriched();
  const positions = useExchangePositions();
  const marks = useRiskGuardStore((s) => s.marks);
  const [now, setNow] = useState(() => Date.now());

  const minute = Math.floor(now / MIN);
  const session = useMemo(
    () => (form.day ? sessionDay(form.session, form.day, form.cutoffMin) : latestSession(form.session, minute * MIN + MIN - 1, form.cutoffMin)),
    // the latest session can only change with the minute
    [form.day, form.session, form.cutoffMin, minute],
  );
  const live = now >= session.openMs && now < session.closeMs + 5 * MIN;
  useEffect(() => {
    // a fresh reading right after the day or the live state changed, then the slow tick (none for a past day)
    const kick = setTimeout(() => setNow(Date.now()), 0);
    const step = live ? LIVE_TICK_MS : form.day ? 0 : IDLE_TICK_MS;
    const id = step ? setInterval(() => setNow(Date.now()), step) : null;
    return () => {
      clearTimeout(kick);
      if (id != null) clearInterval(id);
    };
  }, [live, form.day]);

  const { state, reload, loading } = usePlanCandles(form, session, live);

  const limits = useMemo(() => riskLimits(settings), [settings]);
  const cfg = useMemo(() => planOfSettings(settings), [settings]);
  const report = useMemo(
    () => limitStatus({ trades: enriched, settings, scope: form.account, now: minute * MIN + MIN - 1, marks, positions }),
    [enriched, settings, form.account, minute, marks, positions],
  );
  const capital = settings.capital[form.account] ?? 0;
  const last = state.candles[state.candles.length - 1];
  const lastClose = last?.close ?? null;
  const fetchedAt = state.fetchedAt;
  // the price is as old as the last trade the source reports (stocks), else as old as the fetch
  const priceAt = state.marketTime ?? fetchedAt;
  const fresh = useMemo(() => (live && lastClose != null && priceAt != null && !state.fromCache ? { price: lastClose, at: Math.min(priceAt, fetchedAt ?? priceAt) } : null), [live, lastClose, priceAt, fetchedAt, state.fromCache]);

  const model = useMemo(
    () =>
      buildPlanModel({
        form,
        candles: state.candles,
        now,
        prefs: cfg.prefs,
        capital,
        currency: settings.currency,
        limits,
        report,
        sourceLabel: state.sourceLabel,
        fetchedAt,
        fresh,
        marketTime: state.marketTime,
        sourceNotes: state.notes,
      }),
    [form, state.candles, state.sourceLabel, state.marketTime, state.notes, fetchedAt, now, cfg.prefs, capital, settings.currency, limits, report, fresh],
  );
  return { form, model, candles: state, reload, loading, now, live, limits, report, capital, currency: model.currency, prefs: cfg.prefs };
}
