/**
 * Die Strategiesuche als schrittweiser Auftrag (rein, deterministisch; läuft im Lab-Worker oder in Leerlauf-Häppchen). Zwei Familien
 * teilen sich die 1.000 Varianten: „Eröffnungs-Range-Ausbruch“ (5-Minuten-Kerzen, alle 540 Varianten, `orb.ts`) und „Ausbruch mit
 * Trendfilter“ (der Rest, gezogen aus 24.000, mit der Engine des Backtest-Labors). Jede Familie hat ihren eigenen Datensatz und teilt
 * ihn selbst 80 / 20; gewählt wird über beide mit derselben Zielgröße.
 *
 *   prepare  Signalreihen der gezogenen Varianten
 *   score    alle Varianten auf den ERSTEN 80 % ihres Datensatzes (Trend: `runBacktest` – Entscheidung am Schluss der Kerze i, Füllung zur
 *            Eröffnung von i + 1, Stop vor Ziel, Gebühren, Slippage, Funding; ORB: `orbSession` – Gebühren, Slippage, kein Funding).
 *            Das Training bekommt von den Daten NUR seine 80 % (die Endtest-Kerzen werden ihm nicht einmal übergeben).
 *   seal     die Siegervariante steht fest (höchster Score, genug Trades der Familie, Erwartung > 0) und läuft EINMAL auf ihren ungesehenen 20 %
 *   rank     erst danach: alle übrigen Varianten auf ihren letzten 20 % – nur um zu zeigen, wo der Sieger in der Verteilung liegt.
 *            Diese Zahlen fließen in keine Auswahl ein (ein Test ändert den Endtest und prüft, dass der Sieger gleich bleibt)
 *   done     Kriterien (`judge`), Rang, Mehrfachtest-Korrektur über ALLE Varianten beider Familien
 *
 * Zielgröße: Ø R ÷ Streuung × √min(Trades, 100) (`scoreOf` des Labors) – für bis zu 100 Trades der t-Wert der Erwartung.
 *
 * Wiederverwendet statt nachgebaut: `runBacktest`/`evaluate`/`oosSplit` (Backtest-Labor), `evalConds` + `ruleBuilder.build`
 * (Regel-Baukasten), `sharpeOf`, `tTest`, `atrSeries`, `ema`. Der Deflated Sharpe des Overfit-Checks wird hier bewusst nicht benutzt: seine
 * Glücksgrenze wächst mit der Streuung der Varianten und hält damit gerade einen Markt mit echter Kante für Glück (gemessen: DSR ≈ 0 auf
 * Märkten mit eingebautem Muster, `tests/unit/lab.search.test.ts`).
 */
import { rng, sd as sdOf, tTest } from "@/domain/analytics/stats";
import { atrSeries } from "@/domain/backtest/bars";
import { sharpeOf } from "@/domain/backtest/metrics";
import { evaluate, oosSplit, type Window } from "@/domain/backtest/optimize";
import { evalConds, ruleBuilder, type RuleFacts } from "@/domain/backtest/strategies/rules";
import { now, type LabStrategy, type Params, type Prepared } from "@/domain/backtest/strategies/types";
import { HIST_MS, type BtTrade, type EngineCfg } from "@/domain/backtest/types";
import { adjustedP, criteriaOf, judge, type Criteria } from "./criteria";
import { orbCostsOf, orbDays, orbPrepare, orbSession, ORB_BAR_MS, type OrbParams, type OrbPrep } from "./orb";
import { condsOf, drawVariants, FAMILY_NAME, IS_SHARE, MIN_WINDOW_BARS, orbVariants, SEARCH_MODEL_VERSION, SEARCH_VARIANTS, signalKey, variantText } from "./space";
import type {
  AnyVariant,
  DatasetInfo,
  Deflation,
  Distribution,
  OrbInput,
  OrbVariant,
  RankInfo,
  SearchCounts,
  SearchCurves,
  SearchFamily,
  SearchJobInput,
  SearchPhase,
  SearchResult,
  SearchVariant,
  SectionStats,
  TrendInput,
  VariantRow,
  WinnerInfo,
} from "./types";

/** Rasterpunkte der Kurven: im Training und im Endtest (Anteile des Zeitraums, gleichmäßig). */
export const GRID_IS = 48;
export const GRID_OOS = 12;
/** Wenigste Handelstage (Werktage mit Sitzung) für die Eröffnungs-Range-Familie. */
export const MIN_ORB_DAYS = 25;
const DAY = 86_400_000;

/** Zu wenige Daten im Handelsfenster. */
export class SearchDataError extends Error {
  constructor(
    public count: number,
    public unit: "Kerzen" | "Tage" = "Kerzen",
    public need: number = MIN_WINDOW_BARS,
  ) {
    super(`Zu wenige ${unit} für eine Suche: ${count} im Handelsfenster, nötig sind mindestens ${need}.`);
    this.name = "SearchDataError";
  }
}

const num = (x: number | null | undefined): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);
const r4 = (x: number): number => Math.round(x * 10_000) / 10_000;

/** Ein abgeschlossener Trade, familienneutral: Ergebnis in R nach Kosten, Anteil des Zeitraums beim Abschluss, Kosten in R. */
export interface Tr {
  r: number;
  f: number;
  costR: number | null;
}

/** Kennzahlen einer Handelsliste in R. */
export function sectionStats(trades: readonly Tr[]): SectionStats {
  const n = trades.length;
  const rs = trades.map((t) => t.r);
  const sumR = rs.reduce((a, b) => a + b, 0);
  let gw = 0;
  let gl = 0;
  let wins = 0;
  let cost = 0;
  let costN = 0;
  let cum = 0;
  let peak = 0;
  let dd = 0;
  for (const t of trades) {
    if (t.r > 0) {
      gw += t.r;
      wins++;
    } else gl += t.r;
    if (t.costR != null) {
      cost += t.costR;
      costN++;
    }
    cum += t.r;
    if (cum > peak) peak = cum;
    if (peak - cum > dd) dd = peak - cum;
  }
  const tt = tTest(rs, 0);
  return {
    n,
    avgR: n ? sumR / n : null,
    sdR: num(sdOf(rs)),
    sumR,
    winRate: n ? wins / n : null,
    pf: gl < 0 ? gw / -gl : null,
    pEdge: tt ? num(tt.pGreater) : null,
    maxDdR: dd,
    avgCostR: costN ? cost / costN : null,
  };
}

/** Zielgröße (Score des Backtest-Labors auf R-Listen): Ø R ÷ Streuung × √min(n, 100); unter 5 Trades `-Infinity`. */
export function scoreR(rs: readonly number[]): number {
  const n = rs.length;
  if (n < 5) return -Infinity;
  const sh = sharpeOf(rs);
  if (sh == null) {
    const m = rs.reduce((a, b) => a + b, 0) / n;
    return m > 0 ? 10 : m < 0 ? -10 : 0;
  }
  return sh * Math.sqrt(Math.min(n, 100));
}

/** Kumulierte R an den Rasterpunkten `grid` (Anteile des Zeitraums, aufsteigend); `trades` aufsteigend nach `f`. */
export function cumulativeAt(trades: readonly Tr[], grid: readonly number[]): number[] {
  const sorted = [...trades].sort((a, b) => a.f - b.f);
  const out: number[] = new Array(grid.length);
  let k = 0;
  let cum = 0;
  for (let g = 0; g < grid.length; g++) {
    while (k < sorted.length && sorted[k]!.f <= grid[g]! + 1e-12) cum += sorted[k++]!.r;
    out[g] = r4(cum);
  }
  return out;
}

/** Rasterpunkte der Kurven als Anteil des Zeitraums: 48 im Training (bis 0,8), 12 im Endtest (bis 1). */
export function gridFractions(): number[] {
  const out: number[] = [];
  for (let k = 1; k <= GRID_IS; k++) out.push((IS_SHARE * k) / GRID_IS);
  for (let k = 1; k <= GRID_OOS; k++) out.push(IS_SHARE + ((1 - IS_SHARE) * k) / GRID_OOS);
  return out;
}

const quantile = (sorted: readonly number[], q: number): number => {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
};

/** Histogramm der Endtest-Erwartung aller bewertbaren Varianten (24 gleich breite Behälter zwischen dem 2. und 98. Perzentil). */
export function distributionOf(rows: readonly VariantRow[], bins = 24): Distribution | null {
  const xs = rows.filter((r) => r.oosScore != null && r.oosAvgR != null).map((r) => r.oosAvgR!).sort((a, b) => a - b);
  if (xs.length < 20) return null;
  const min = r4(quantile(xs, 0.02));
  const max = r4(quantile(xs, 0.98));
  const span = Math.max(1e-9, max - min);
  const counts = new Array<number>(bins).fill(0);
  for (const x of xs) counts[Math.max(0, Math.min(bins - 1, Math.floor(((x - min) / span) * bins)))]!++;
  return { min, max, counts };
}

// ── die beiden Familien ─────────────────────────────────────────────────────────────────────────────────────────

interface Ctx {
  family: SearchFamily;
  crit: Criteria;
  info: DatasetInfo;
  runIs(v: AnyVariant): Tr[];
  runOos(v: AnyVariant): Tr[];
}

const btTr = (t: BtTrade, f: number): Tr => {
  const risk = Math.abs(t.entry - t.stop) * t.qty;
  return { r: t.r, f, costR: risk > 0 ? (t.fees + t.funding + t.slippage) / risk : null };
};

function trendCtx(input: TrendInput, engine: EngineCfg): Ctx {
  const { bars, interval, meta } = input;
  const nBars = bars.length;
  let start = 0;
  while (start < nBars && bars[start]!.t * 1000 < input.fromMs) start++;
  if (nBars - start < MIN_WINDOW_BARS) throw new SearchDataError(Math.max(0, nBars - start));
  const split = oosSplit(start, nBars - 1, IS_SHARE);
  if (!split) throw new SearchDataError(nBars - start);
  const isWin: Window = split.is;
  const oosWin: Window = split.oos;
  const secLen = HIST_MS[interval] / 1000;
  const strat = ruleBuilder as unknown as LabStrategy<RuleFacts, unknown>;
  const atr = atrSeries(bars);
  const hits = new Map<string, Uint8Array>();
  // Das Training sieht die Kerzen des Endtests nicht einmal: die Engine bekommt nur die ersten 80 % (Kerzen, ATR, Signale gekürzt).
  // Sonst könnte z. B. die Funding-Marke eines Abrechnungszeitpunkts genau am Schnitt den Schluss der ersten Endtest-Kerze lesen
  // (gefunden und per Test belegt, siehe docs/STRATEGIESUCHE.md „Prüfung der Labor-Funktionen“).
  const isEnd = isWin.to + 1;
  const isBars = bars.slice(0, isEnd);
  const isAtr = atr.slice(0, isEnd);
  const prepOf = (v: SearchVariant, training: boolean): Prepared<RuleFacts> => {
    const key = signalKey(v);
    let hit = hits.get(key);
    if (!hit) hits.set(key, (hit = evalConds(bars, condsOf(v))));
    return training ? { interval, bars: isBars, atr: isAtr, start, facts: { hit: hit.subarray(0, isEnd), side: v.side } } : { interval, bars, atr, start, facts: { hit, side: v.side } };
  };
  const params = (v: SearchVariant): Params => ({ targetR: v.targetR, stopAtr: v.stopAtr, maxBars: v.maxBars });
  const isLen = Math.max(1, isWin.to - isWin.from);
  const oosLen = Math.max(1, oosWin.to - oosWin.from);
  return {
    family: "trend",
    crit: criteriaOf("trend"),
    info: {
      ...meta,
      family: "trend",
      unit: "Kerzen",
      bars: nBars,
      window: nBars - start,
      isBars: isWin.to - isWin.from + 1,
      oosBars: oosWin.to - oosWin.from + 1,
      fromT: bars[start]!.t * 1000,
      cutT: bars[oosWin.from]!.t * 1000,
      toT: (bars[nBars - 1]!.t + secLen) * 1000,
    },
    runIs: (v) => evaluate(strat, prepOf(v as SearchVariant, true), params(v as SearchVariant), engine, isWin, false).trades.map((t) => btTr(t, (IS_SHARE * (t.exitIndex - isWin.from)) / isLen)),
    runOos: (v) => evaluate(strat, prepOf(v as SearchVariant, false), params(v as SearchVariant), engine, oosWin, false).trades.map((t) => btTr(t, IS_SHARE + ((1 - IS_SHARE) * (t.exitIndex - oosWin.from)) / oosLen)),
  };
}

function orbCtx(input: OrbInput, engine: EngineCfg): Ctx {
  const { bars, meta } = input;
  const full = orbPrepare(bars);
  const first = Math.ceil(input.fromMs / DAY);
  const daysOf = (p: OrbPrep, s: "ny" | "london"): number[] => orbDays(p, s).filter((d) => d >= first);
  const all = [...new Set([...daysOf(full, "ny"), ...daysOf(full, "london")])].sort((a, b) => a - b);
  if (all.length < MIN_ORB_DAYS) throw new SearchDataError(all.length, "Tage", MIN_ORB_DAYS);
  const startDay = all[0]!;
  const endDay = all[all.length - 1]!;
  const cutDay = startDay + Math.round((endDay - startDay + 1) * IS_SHARE);
  const startMs = startDay * DAY;
  const cutMs = cutDay * DAY;
  const endMs = (endDay + 1) * DAY;
  const cutIdx = bars.findIndex((b) => b.t * 1000 >= cutMs);
  if (cutIdx <= 0 || all.filter((d) => d >= cutDay).length < 3) throw new SearchDataError(all.length, "Tage", MIN_ORB_DAYS);
  // das Training bekommt nur die Kerzen vor dem Schnitt
  const trainPrep = orbPrepare(bars.slice(0, cutIdx));
  const costs = orbCostsOf(engine.costs.fees, engine.costs.slippage);
  const days = { ny: { is: daysOf(trainPrep, "ny"), oos: daysOf(full, "ny").filter((d) => d >= cutDay) }, london: { is: daysOf(trainPrep, "london"), oos: daysOf(full, "london").filter((d) => d >= cutDay) } };
  const paramsOf = (v: OrbVariant): OrbParams => ({ session: v.session, rangeMin: v.rangeMin, volThr: v.volThr, targetR: v.targetR, stop: v.stop, trend: v.trend });
  const run = (v: OrbVariant, prep: OrbPrep, list: number[], f: (ms: number) => number): Tr[] => {
    const out: Tr[] = [];
    const p = paramsOf(v);
    for (const d of list) {
      const t = orbSession(prep, d, p, costs).trade;
      if (t?.state === "closed") out.push({ r: t.r, costR: t.costR, f: f(prep.bars[t.kExit]!.t * 1000 + ORB_BAR_MS) });
    }
    return out;
  };
  const isDays = all.filter((d) => d < cutDay).length;
  return {
    family: "orb",
    crit: criteriaOf("orb"),
    info: {
      ...meta,
      family: "orb",
      unit: "Tage",
      bars: bars.length,
      window: all.length,
      isBars: isDays,
      oosBars: all.length - isDays,
      fromT: startMs,
      cutT: cutMs,
      toT: bars[bars.length - 1]!.t * 1000 + ORB_BAR_MS,
    },
    runIs: (v) => run(v as OrbVariant, trainPrep, days[(v as OrbVariant).session].is, (ms) => (IS_SHARE * (ms - startMs)) / (cutMs - startMs)),
    runOos: (v) => run(v as OrbVariant, full, days[(v as OrbVariant).session].oos, (ms) => IS_SHARE + ((1 - IS_SHARE) * (ms - cutMs)) / (endMs - cutMs)),
  };
}

// ── der Auftrag ──────────────────────────────────────────────────────────────────────────────────────────────────

export interface SearchJob {
  step(deadline: number): boolean;
  /** 0…1 über alle Phasen */
  progress(): number;
  result(): SearchResult;
  phase(): SearchPhase;
  /** echte Zahl der laufenden Phase: bisher geprüfte Varianten */
  checked(): { phase: SearchPhase; done: number; total: number };
  counts(): SearchCounts;
}

/** Die gesetzte Ziehung: bei beiden Familien alle ORB-Varianten (54 %) und der Rest Trend-Ausbruch, gemischt; bei einer Familie in Ziehungsreihenfolge. */
export function assembleVariants(input: Pick<SearchJobInput, "seed" | "count"> & { trend?: Pick<TrendInput, "interval">; orb?: unknown }): AnyVariant[] {
  const limit = Math.max(0, Math.floor(input.count ?? SEARCH_VARIANTS));
  const rand = rng((Math.floor(input.seed) ^ 0x5bd1e995) >>> 0);
  const shuffle = <T,>(xs: T[]): T[] => {
    for (let i = xs.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [xs[i], xs[j]] = [xs[j]!, xs[i]!];
    }
    return xs;
  };
  const orbAll = input.orb ? orbVariants() : [];
  const orbN = input.trend ? Math.min(orbAll.length, Math.round(limit * (orbAll.length / SEARCH_VARIANTS))) : Math.min(orbAll.length, limit);
  const orb: OrbVariant[] = orbN < orbAll.length ? shuffle(orbAll).slice(0, orbN) : orbAll;
  const trend: SearchVariant[] = input.trend ? drawVariants(input.trend.interval, input.seed, limit - orb.length) : [];
  const list: AnyVariant[] = input.trend && input.orb ? shuffle([...orb, ...trend]) : [...orb, ...trend];
  return list.map((v, i) => ({ ...v, id: i }));
}

export function createSearchJob(input: SearchJobInput): SearchJob {
  if (!input.trend && !input.orb) throw new Error("Keine Familie gewählt.");
  const ctxs: Partial<Record<SearchFamily, Ctx>> = {};
  if (input.trend) ctxs.trend = trendCtx(input.trend, input.engine);
  if (input.orb) ctxs.orb = orbCtx(input.orb, input.engine);
  const families = (["orb", "trend"] as const).filter((f) => ctxs[f]);
  const variants = assembleVariants(input);
  const total = variants.length;
  const ctxOf = (v: AnyVariant): Ctx => ctxs[v.family]!;
  const grid = gridFractions();
  const gIs = grid.slice(0, GRID_IS);

  const rows: VariantRow[] = variants.map((v) => ({ id: v.id, family: v.family, isN: 0, isAvgR: null, isScore: null, oosN: 0, oosAvgR: null, oosScore: null }));
  /** Vergleichswert des Endtests: Ø R ÷ Streuung je Trade; `null` unter der Mindestzahl Trades der Familie (kein Vergleich auf dünner Zahl) */
  const oosScoreOf = (v: AnyVariant, tr: readonly Tr[]): number | null => {
    if (tr.length < ctxOf(v).crit.minOosTrades) return null;
    const s = sharpeOf(tr.map((t) => t.r));
    return s == null ? null : r4(s);
  };
  const isCurves: number[][] = new Array(total);
  const byFamily: Record<SearchFamily, number> = { trend: variants.filter((v) => v.family === "trend").length, orb: variants.filter((v) => v.family === "orb").length };
  const counts: SearchCounts = { variants: total, byFamily, isRuns: 0, qualified: 0, oosRuns: 0, winnerOosRuns: 0 };
  let phase: SearchPhase = "prepare";
  let cursor = 0;
  let best: { i: number; score: number; trades: Tr[] } | null = null;
  let winnerOos: Tr[] | null = null;
  let winnerIdx = -1;
  let final: SearchResult | null = null;

  const finish = (): SearchResult => {
    const win = best ? variants[best.i]! : null;
    const isTrades = best?.trades ?? [];
    const oosTrades = winnerOos ?? [];
    let winner: WinnerInfo | null = null;
    let rank: RankInfo | null = null;
    let deflation: Deflation | null = null;
    let winnerCurve: number[] = new Array(grid.length).fill(0);
    if (win && best) {
      winner = { variant: win, text: variantText(win), is: sectionStats(isTrades), oos: sectionStats(oosTrades) };
      winnerCurve = cumulativeAt([...isTrades, ...oosTrades], grid);
      // Rang nach demselben Verhältnis Erwartung ÷ Streuung (R-Vielfache verschiedener Stop-/Ziel-Aufbauten sind nicht vergleichbar, das Verhältnis ist es eher)
      const w = rows[win.id]!.oosScore;
      const valid = rows.filter((r) => r.oosScore != null && r.oosAvgR != null);
      const winnerValid = w != null;
      const above = w == null ? 0 : valid.filter((r) => r.oosScore! > w).length;
      const sorted = valid.map((r) => r.oosAvgR!).sort((a, b) => a - b);
      const top = rows
        .filter((r) => r.isScore != null)
        .sort((a, b) => b.isScore! - a.isScore! || a.id - b.id)
        .slice(0, 10)
        .map((r) => r.oosAvgR)
        .filter((x): x is number => x != null)
        .sort((a, b) => a - b);
      const of = valid.length + (winnerValid ? 0 : 1);
      rank = {
        rank: winnerValid ? 1 + above : null,
        of,
        beaten: winnerValid && of > 1 ? (of - 1 - above) / (of - 1) : null,
        quantiles: sorted.length >= 5 ? { p10: r4(quantile(sorted, 0.1)), p25: r4(quantile(sorted, 0.25)), p50: r4(quantile(sorted, 0.5)), p75: r4(quantile(sorted, 0.75)), p90: r4(quantile(sorted, 0.9)) } : null,
        topTenMedianOos: top.length ? r4(quantile(top, 0.5)) : null,
      };
      // Mehrfachtest: das beste von N Training-p sieht allein durch Glück gut aus – das p wird um N Versuche korrigiert (`adjustedP`)
      deflation = { isP: winner.is.pEdge, adjP: adjustedP(winner.is.pEdge, total), trials: total };
    }
    const verdict = winner
      ? judge({ family: win!.family, is: winner.is, oos: winner.oos, deflation })
      : {
          passed: false,
          checks: [],
          reason: `Keine der ${total} Varianten hatte im Training genug Trades und eine positive Erwartung nach allen Kosten. Es gibt nichts, was den Endtest verdient – ein anderer Zeitraum, eine andere Kerzenlänge oder eine andere Familie kann mehr Trades bringen.`,
        };
    const curves: SearchCurves = { grid, isPoints: gIs.length, is: isCurves, winner: winnerCurve };
    return {
      model: SEARCH_MODEL_VERSION,
      seed: input.seed,
      families: [...families],
      datasets: families.map((f) => ctxs[f]!.info),
      counts: { ...counts },
      rows,
      winner,
      winnerFamily: win?.family ?? null,
      verdict,
      rank,
      deflation,
      distribution: distributionOf(rows),
      curves,
    };
  };

  /** Eine Einheit Arbeit der aktuellen Phase. */
  const unit = (): void => {
    switch (phase) {
      case "prepare": {
        // die Signalreihen entstehen beim ersten Gebrauch (Cache); hier nur der Übergang, damit „prepare“ sichtbar bleibt
        phase = "score";
        return;
      }
      case "score": {
        const v = variants[cursor]!;
        const c = ctxOf(v);
        const tr = c.runIs(v);
        counts.isRuns++;
        const st = sectionStats(tr);
        const score = tr.length >= c.crit.minIsTrades && (st.avgR ?? 0) > 0 ? scoreR(tr.map((t) => t.r)) : -Infinity;
        rows[v.id] = { ...rows[v.id]!, isN: tr.length, isAvgR: st.avgR == null ? null : r4(st.avgR), isScore: Number.isFinite(score) ? r4(score) : null };
        isCurves[v.id] = cumulativeAt(tr, gIs);
        if (Number.isFinite(score)) {
          counts.qualified++;
          if (!best || score > best.score || (score === best.score && tr.length > best.trades.length)) best = { i: v.id, score, trades: tr };
        }
        if (++cursor >= total) phase = "seal";
        return;
      }
      case "seal": {
        if (best) {
          // genau ein Lauf der Siegervariante auf dem ungesehenen Endtest
          winnerIdx = best.i;
          const v = variants[winnerIdx]!;
          winnerOos = ctxOf(v).runOos(v);
          counts.oosRuns++;
          counts.winnerOosRuns++;
          const st = sectionStats(winnerOos);
          rows[winnerIdx] = { ...rows[winnerIdx]!, oosN: st.n, oosAvgR: st.avgR == null ? null : r4(st.avgR), oosScore: oosScoreOf(v, winnerOos) };
        }
        cursor = 0;
        phase = best ? "rank" : "done";
        return;
      }
      case "rank": {
        if (cursor === winnerIdx) {
          cursor++;
        } else if (cursor < total) {
          const v = variants[cursor]!;
          const tr = ctxOf(v).runOos(v);
          counts.oosRuns++;
          const avg = tr.length ? tr.reduce((a, t) => a + t.r, 0) / tr.length : null;
          rows[v.id] = { ...rows[v.id]!, oosN: tr.length, oosAvgR: avg == null ? null : r4(avg), oosScore: oosScoreOf(v, tr) };
          cursor++;
        }
        if (cursor >= total) phase = "done";
        return;
      }
      case "done":
        return;
    }
  };

  const doneWork = (): void => {
    if (!final) final = finish();
  };
  const finished = (): boolean => phase === "done";

  return {
    step(deadline) {
      while (!finished()) {
        unit();
        if (!finished() && now() >= deadline) return false;
      }
      doneWork();
      return true;
    },
    progress() {
      switch (phase) {
        case "prepare":
          return 0;
        case "score":
          return 0.02 + 0.6 * (cursor / Math.max(1, total));
        case "seal":
          return 0.62;
        case "rank":
          return 0.64 + 0.34 * (cursor / Math.max(1, total));
        case "done":
          return 1;
      }
    },
    result() {
      while (!finished()) unit();
      doneWork();
      return final!;
    },
    phase: () => phase,
    checked: () => ({ phase, done: phase === "done" || phase === "seal" ? total : phase === "prepare" ? 0 : cursor, total }),
    counts: () => ({ ...counts }),
  };
}

/** Bequem für Tests und Showroom: die ganze Suche in einem Rutsch. */
export function runSearchSync(input: SearchJobInput): SearchResult {
  return createSearchJob(input).result();
}

export { FAMILY_NAME };
