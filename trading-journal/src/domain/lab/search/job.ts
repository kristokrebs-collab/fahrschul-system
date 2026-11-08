/**
 * Die Strategiesuche als schrittweiser Auftrag (rein, deterministisch; läuft im Lab-Worker oder in Leerlauf-Häppchen). Zwei Familien
 * teilen sich die 1.000 Varianten: „Eröffnungs-Range-Ausbruch“ (5-Minuten-Kerzen, alle 540 Varianten, `orb.ts`) und „Ausbruch mit
 * Trendfilter“ (der Rest, gezogen aus 24.000, mit der Engine des Backtest-Labors). Jede Variante läuft mit DREI Stop-Führungen (fest /
 * Einstand ab +1 R / Nachziehen ab +1 R) – 3.000 Kandidaten. Jede Familie hat ihren eigenen Datensatz und teilt ihn selbst 80 / 20; gewählt
 * wird über alle Kandidaten mit derselben Zielgröße.
 *
 *   prepare  Signalreihen der gezogenen Varianten
 *   score    alle Varianten × Stop-Führungen auf den ERSTEN 80 % ihres Datensatzes (Trend: `runBacktest` – Entscheidung am Schluss der Kerze
 *            i, Füllung zur Eröffnung von i + 1, Stop vor Ziel, Stop-Führung der Engine, Gebühren, Slippage, Funding; ORB: `orbSession` –
 *            Gebühren, Slippage, kein Funding). Das Training bekommt von den Daten NUR seine 80 % (die Endtest-Kerzen werden ihm nicht einmal
 *            übergeben). Je Variante zählt ihre beste Stop-Führung (Zeile, Kurve); der Sieger ist der beste der 3.000 Kandidaten.
 *   seal     der Sieger (Variante + Stop-Führung) steht fest und läuft EINMAL auf seinen ungesehenen 20 %; danach – als Vergleich, nicht als
 *            Auswahl – dieselben Einstiegsregeln mit den zwei anderen Stop-Führungen auf denselben 20 %
 *   rank     erst danach: alle übrigen Varianten (je mit ihrer Trainings-Stop-Führung) auf ihren letzten 20 % – nur um zu zeigen, wo der
 *            Sieger in der Verteilung liegt. Diese Zahlen fließen in keine Auswahl ein (ein Test ändert den Endtest und prüft, dass der Sieger
 *            gleich bleibt)
 *   done     Kriterien (`judge`), Rang, Mehrfachtest-Korrektur über ALLE Kandidaten beider Familien, Rückgangs-Risiko (Neuziehung der
 *            Endtest-Trades) und der Vergleich der Stop-Führungen (`risk.ts`)
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
import { runBacktest } from "@/domain/backtest/engine";
import { evalConds, ruleBuilder, type RuleFacts } from "@/domain/backtest/strategies/rules";
import { now, type LabStrategy, type Params, type Prepared } from "@/domain/backtest/strategies/types";
import { HIST_MS, type BtStrategy, type BtTrade, type EngineCfg, type PositionMgmt } from "@/domain/backtest/types";
import { adjustedP, criteriaOf, judge, type Criteria } from "./criteria";
import { orbCostsOf, orbDays, orbPrepare, orbSession, ORB_BAR_MS, type OrbParams, type OrbPrep } from "./orb";
import { compareStops, riskOf } from "./risk";
import { condsOf, drawVariants, FAMILY_NAME, IS_SHARE, MANAGE_AFTER_R, MIN_WINDOW_BARS, orbVariants, SEARCH_MODEL_VERSION, SEARCH_VARIANTS, signalKey, STOP_RULES, variantText } from "./space";
import type {
  AnyVariant,
  CostInfo,
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
  StopRule,
  TrendInput,
  VariantRow,
  WinnerInfo,
} from "./types";

/** Rasterpunkte der Kurven: im Training und im Endtest (Anteile des Zeitraums, gleichmäßig). */
export const GRID_IS = 96;
export const GRID_OOS = 24;
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
  /** Kerze des Einstiegs (Index im Datensatz der Familie) – paart dieselben Einstiege verschiedener Stop-Führungen */
  e: number;
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

/** Rasterpunkte der Kurven als Anteil des Zeitraums: 96 im Training (bis 0,8), 24 im Endtest (bis 1). */
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
  runIs(v: AnyVariant, rule: StopRule): Tr[];
  runOos(v: AnyVariant, rule: StopRule): Tr[];
}

/** Stop-Führung der Engine des Labors: Einstand bzw. Nachziehen ab +1 R (Abstand = der Anfangs-Stop, k × ATR). */
export function manageOf(rule: StopRule, v: SearchVariant): PositionMgmt | null {
  if (rule === "be") return { breakEven: { after: { kind: "r", value: MANAGE_AFTER_R }, to: "entry" } };
  if (rule === "trail") return { trail: { kind: "atr", value: v.stopAtr, activateR: MANAGE_AFTER_R } };
  return null;
}

const btTr = (t: BtTrade, f: number): Tr => {
  const risk = Math.abs(t.entry - t.stop) * t.qty;
  return { r: t.r, f, costR: risk > 0 ? (t.fees + t.funding + t.slippage) / risk : null, e: t.entryIndex };
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
  /** ein Lauf der Engine mit der Stop-Führung der Variante (fest = genau `evaluate` des Labors) */
  const run = (v: SearchVariant, rule: StopRule, training: boolean, win: Window): BtTrade[] => {
    const prep = prepOf(v, training);
    const manage = manageOf(rule, v);
    if (!manage) return evaluate(strat, prep, params(v), engine, win, false).trades;
    const base = strat.build(prep, params(v));
    const s: BtStrategy = {
      start: base.start,
      signalAt: (i) => {
        const x = base.signalAt(i);
        return x ? { ...x, manage } : null;
      },
    };
    return runBacktest(prep.bars, s, engine, { from: win.from, to: win.to, equity: false, atr: prep.atr, secLen }).trades;
  };
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
    runIs: (v, rule) => run(v as SearchVariant, rule, true, isWin).map((t) => btTr(t, (IS_SHARE * (t.exitIndex - isWin.from)) / isLen)),
    runOos: (v, rule) => run(v as SearchVariant, rule, false, oosWin).map((t) => btTr(t, IS_SHARE + ((1 - IS_SHARE) * (t.exitIndex - oosWin.from)) / oosLen)),
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
  const paramsOf = (v: OrbVariant, manage: StopRule): OrbParams => ({ session: v.session, rangeMin: v.rangeMin, volThr: v.volThr, targetR: v.targetR, stop: v.stop, trend: v.trend, manage });
  const run = (v: OrbVariant, rule: StopRule, prep: OrbPrep, list: number[], f: (ms: number) => number): Tr[] => {
    const out: Tr[] = [];
    const p = paramsOf(v, rule);
    for (const d of list) {
      const t = orbSession(prep, d, p, costs).trade;
      if (t?.state === "closed") out.push({ r: t.r, costR: t.costR, f: f(prep.bars[t.kExit]!.t * 1000 + ORB_BAR_MS), e: t.j + 1 });
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
    runIs: (v, rule) => run(v as OrbVariant, rule, trainPrep, days[(v as OrbVariant).session].is, (ms) => (IS_SHARE * (ms - startMs)) / (cutMs - startMs)),
    runOos: (v, rule) => run(v as OrbVariant, rule, full, days[(v as OrbVariant).session].oos, (ms) => IS_SHARE + ((1 - IS_SHARE) * (ms - cutMs)) / (endMs - cutMs)),
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

/** Kosten-Annahmen der Läufe in Worten. */
export function costsOf(engine: EngineCfg, families: readonly SearchFamily[]): CostInfo {
  const { fees, slippage, funding } = engine.costs;
  const de = (x: number, d = 2): string => x.toFixed(d).replace(".", ",");
  const slip =
    slippage.kind === "fixed"
      ? `${de(slippage.bps, 0)} Basispunkte je Market-Füllung`
      : slippage.kind === "spread"
        ? `halber Spread ${de(slippage.bps, 0)} Basispunkte je Market-Füllung`
        : slippage.kind === "atr"
          ? `${de(slippage.frac * 100, 0)} % der ATR je Market-Füllung`
          : "keine";
  const trendFunding = funding.kind === "history" ? "Funding-Historie der Börse" : funding.kind === "flat" ? `flach ${de(funding.ratePer8h * 100, 3)} % je 8 h` : "keins (Spot)";
  const fund = !families.includes("trend") ? "nicht eingerechnet (Eröffnungs-Range)" : families.includes("orb") ? `${trendFunding}; Eröffnungs-Range ohne Funding` : trendFunding;
  return { takerBps: fees.takerBps, makerBps: fees.makerBps, slippage: slip, funding: fund };
}

export function createSearchJob(input: SearchJobInput): SearchJob {
  if (!input.trend && !input.orb) throw new Error("Keine Familie gewählt.");
  const ctxs: Partial<Record<SearchFamily, Ctx>> = {};
  if (input.trend) ctxs.trend = trendCtx(input.trend, input.engine);
  if (input.orb) ctxs.orb = orbCtx(input.orb, input.engine);
  const families = (["orb", "trend"] as const).filter((f) => ctxs[f]);
  const variants = assembleVariants(input);
  const total = variants.length;
  const rules = STOP_RULES;
  const ctxOf = (v: AnyVariant): Ctx => ctxs[v.family]!;
  const grid = gridFractions();
  const gIs = grid.slice(0, GRID_IS);
  const gOos = grid.slice(GRID_IS);

  const rows: VariantRow[] = variants.map((v) => ({ id: v.id, family: v.family, stop: "fixed", isScores: rules.map(() => null), isN: 0, isAvgR: null, isScore: null, oosN: 0, oosAvgR: null, oosScore: null }));
  /** Vergleichswert des Endtests: Ø R ÷ Streuung je Trade; `null` unter der Mindestzahl Trades der Familie (kein Vergleich auf dünner Zahl) */
  const oosScoreOf = (v: AnyVariant, tr: readonly Tr[]): number | null => {
    if (tr.length < ctxOf(v).crit.minOosTrades) return null;
    const s = sharpeOf(tr.map((t) => t.r));
    return s == null ? null : r4(s);
  };
  const isCurves: number[][] = new Array(total);
  const byFamily: Record<SearchFamily, number> = { trend: variants.filter((v) => v.family === "trend").length, orb: variants.filter((v) => v.family === "orb").length };
  const counts: SearchCounts = { variants: total, byFamily, stopRules: rules.length, candidates: total * rules.length, isRuns: 0, qualified: 0, oosRuns: 0, winnerOosRuns: 0, compareRuns: 0 };
  let phase: SearchPhase = "prepare";
  let cursor = 0;
  /** der beste Kandidat bisher: Variante, Stop-Führung, Zielgröße, seine Trades und die seiner zwei Geschwister (dieselben Einstiegsregeln) */
  let best: { i: number; rule: StopRule; score: number; trades: Tr[]; siblings: { rule: StopRule; trades: Tr[]; score: number | null }[] } | null = null;
  let winnerOos: Tr[] | null = null;
  let siblingOos: { rule: StopRule; trades: Tr[] }[] = [];
  let winnerIdx = -1;
  let final: SearchResult | null = null;

  const result = (winner: WinnerInfo | null, verdict: SearchResult["verdict"], rank: RankInfo | null, deflation: Deflation | null, winnerCurve: number[]): SearchResult => ({
    model: SEARCH_MODEL_VERSION,
    seed: input.seed,
    families: [...families],
    datasets: families.map((f) => ctxs[f]!.info),
    counts: { ...counts },
    rows,
    winner,
    winnerFamily: winner?.variant.family ?? null,
    verdict,
    rank,
    deflation,
    distribution: distributionOf(rows),
    curves: { grid, isPoints: gIs.length, is: isCurves, winner: winnerCurve } satisfies SearchCurves,
    costs: costsOf(input.engine, families),
  });

  const finish = (): SearchResult => {
    if (!best) {
      return result(
        null,
        {
          passed: false,
          checks: [],
          reason: `Keine der ${total.toLocaleString("de-DE")} Varianten hatte im Training mit einer der drei Stop-Führungen genug Trades und eine positive Erwartung nach allen Kosten. Es gibt nichts, was den Endtest verdient – ein anderer Zeitraum, eine andere Kerzenlänge oder eine andere Familie kann mehr Trades bringen.`,
        },
        null,
        null,
        new Array(grid.length).fill(0),
      );
    }
    const b = best;
    const win = variants[b.i]!;
    const oosTrades = winnerOos ?? [];
    const isS = sectionStats(b.trades);
    const oosS = sectionStats(oosTrades);
    // Mehrfachtest: das beste von N Training-p sieht allein durch Glück gut aus – korrigiert um ALLE Kandidaten (Varianten × Stop-Führungen)
    const deflation: Deflation = { isP: isS.pEdge, adjP: adjustedP(isS.pEdge, counts.candidates), trials: counts.candidates };
    const verdict = judge({ family: win.family, is: isS, oos: oosS, deflation });
    const sortedOos = [...oosTrades].sort((x, y) => x.f - y.f);
    const risk = riskOf({ rs: sortedOos.map((t) => t.r), fs: sortedOos.map((t) => t.f), grid: gOos, riskPct: input.engine.riskPct, seed: input.seed });
    const stopRuns = rules.map((rule) => {
      if (rule === b.rule) return { rule, isRs: b.trades.map((t) => t.r), isScore: b.score, oosRs: oosTrades.map((t) => t.r), oosEs: oosTrades.map((t) => t.e) };
      const sib = b.siblings.find((x) => x.rule === rule)!;
      const o = siblingOos.find((x) => x.rule === rule)?.trades ?? [];
      return { rule, isRs: sib.trades.map((t) => t.r), isScore: sib.score, oosRs: o.map((t) => t.r), oosEs: o.map((t) => t.e) };
    });
    const stops = compareStops(stopRuns, b.rule, verdict.passed, input.seed);
    const winner: WinnerInfo = { variant: win, stop: b.rule, text: variantText(win, b.rule), is: isS, oos: oosS, stops, risk };
    // Rang nach demselben Verhältnis Erwartung ÷ Streuung (R-Vielfache verschiedener Stop-/Ziel-Aufbauten sind nicht vergleichbar, das Verhältnis ist es eher)
    const w = rows[win.id]!.oosScore;
    const valid = rows.filter((r) => r.oosScore != null && r.oosAvgR != null);
    const winnerValid = w != null;
    const above = w == null ? 0 : valid.filter((r) => r.oosScore! > w).length;
    const sorted = valid.map((r) => r.oosAvgR!).sort((x, y) => x - y);
    const top = rows
      .filter((r) => r.isScore != null)
      .sort((x, y) => y.isScore! - x.isScore! || x.id - y.id)
      .slice(0, 10)
      .map((r) => r.oosAvgR)
      .filter((x): x is number => x != null)
      .sort((x, y) => x - y);
    const of = valid.length + (winnerValid ? 0 : 1);
    const rank: RankInfo = {
      rank: winnerValid ? 1 + above : null,
      of,
      beaten: winnerValid && of > 1 ? (of - 1 - above) / (of - 1) : null,
      quantiles: sorted.length >= 5 ? { p10: r4(quantile(sorted, 0.1)), p25: r4(quantile(sorted, 0.25)), p50: r4(quantile(sorted, 0.5)), p75: r4(quantile(sorted, 0.75)), p90: r4(quantile(sorted, 0.9)) } : null,
      topTenMedianOos: top.length ? r4(quantile(top, 0.5)) : null,
    };
    return result(winner, verdict, rank, deflation, cumulativeAt([...b.trades, ...oosTrades], grid));
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
        // eine Variante = drei Kandidaten (fest, Einstand, Nachziehen) auf denselben Trainingskerzen
        const v = variants[cursor]!;
        const c = ctxOf(v);
        const runs = rules.map((rule) => {
          const tr = c.runIs(v, rule);
          counts.isRuns++;
          const st = sectionStats(tr);
          const score = tr.length >= c.crit.minIsTrades && (st.avgR ?? 0) > 0 ? scoreR(tr.map((t) => t.r)) : -Infinity;
          if (Number.isFinite(score)) counts.qualified++;
          return { rule, tr, st, score };
        });
        // die beste Stop-Führung dieser Variante (bei Gleichstand die einfachere, also die frühere in STOP_RULES)
        let k = 0;
        for (let q = 1; q < runs.length; q++) if (runs[q]!.score > runs[k]!.score) k = q;
        const top = runs[k]!;
        rows[v.id] = {
          ...rows[v.id]!,
          stop: top.rule,
          isScores: runs.map((x) => (Number.isFinite(x.score) ? r4(x.score) : null)),
          isN: top.tr.length,
          isAvgR: top.st.avgR == null ? null : r4(top.st.avgR),
          isScore: Number.isFinite(top.score) ? r4(top.score) : null,
        };
        isCurves[v.id] = cumulativeAt(top.tr, gIs);
        if (Number.isFinite(top.score) && (!best || top.score > best.score || (top.score === best.score && top.tr.length > best.trades.length))) {
          best = {
            i: v.id,
            rule: top.rule,
            score: top.score,
            trades: top.tr,
            siblings: runs.filter((x) => x !== top).map((x) => ({ rule: x.rule, trades: x.tr, score: Number.isFinite(x.score) ? x.score : null })),
          };
        }
        if (++cursor >= total) phase = "seal";
        return;
      }
      case "seal": {
        if (best) {
          // genau ein Lauf des Siegers (Variante + Stop-Führung) auf dem ungesehenen Endtest – erst danach die Vergleichsläufe
          winnerIdx = best.i;
          const v = variants[winnerIdx]!;
          winnerOos = ctxOf(v).runOos(v, best.rule);
          counts.oosRuns++;
          counts.winnerOosRuns++;
          const st = sectionStats(winnerOos);
          rows[winnerIdx] = { ...rows[winnerIdx]!, oosN: st.n, oosAvgR: st.avgR == null ? null : r4(st.avgR), oosScore: oosScoreOf(v, winnerOos) };
          // Vergleich, keine Auswahl: dieselben Einstiegsregeln mit den zwei anderen Stop-Führungen auf denselben ungesehenen Kerzen
          siblingOos = best.siblings.map((x) => {
            counts.oosRuns++;
            counts.compareRuns++;
            return { rule: x.rule, trades: ctxOf(v).runOos(v, x.rule) };
          });
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
          const tr = ctxOf(v).runOos(v, rows[v.id]!.stop);
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
          return 0.02 + 0.76 * (cursor / Math.max(1, total));
        case "seal":
          return 0.78;
        case "rank":
          return 0.8 + 0.18 * (cursor / Math.max(1, total));
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

/** Bequem für Tests und die Demo-Vorschau: die ganze Suche in einem Rutsch. */
export function runSearchSync(input: SearchJobInput): SearchResult {
  return createSearchJob(input).result();
}

export { FAMILY_NAME };
