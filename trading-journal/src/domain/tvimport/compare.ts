/**
 * Comparison of a TradingView strategy-tester export with a lab run of the same market and time (F14). Pure.
 *
 * Trades are paired by direction and entry time (one execution bar of tolerance – the lab fills at the open of the bar after
 * the signal, and so does TradingView's strategy tester by default); each trade is used once. Only the COMMON period is
 * compared, and open TradingView trades are left out. What comes out are numbers (counts, net result, price moves, time
 * offsets) and OBSERVATIONS about where the two can differ – costs, the order of high and low inside a candle, delay – each
 * backed by the figures that make it plausible and phrased as "could", never as the proven cause.
 *
 * Money is only comparable when both sides traded the same size; the export has no risk sizing, the lab does. So the net is
 * shown with that caveat and the unit-free price moves (sum of entry → exit moves in %) next to it.
 */
import type { BtTrade } from "../backtest/types";
import type { TvTrade } from "./parse";

export type LabTrade = Pick<BtTrade, "side" | "entryTime" | "exitTime" | "entry" | "exit" | "pnl" | "fees" | "funding" | "slippage" | "qty" | "move" | "reason"> & { ambiguous?: boolean };

export interface ComparePair {
  tv: TvTrade;
  lab: LabTrade;
  /** TradingView entry − lab entry, in execution bars */
  entryBars: number;
  /** TradingView exit − lab exit, in execution bars (`null` without an exit time) */
  exitBars: number | null;
  /** entry price TradingView vs lab, in percent of the lab's (positive = TradingView filled higher) */
  entryDiffPct: number;
  exitDiffPct: number | null;
  /** price move entry → exit in the trade's direction, percent */
  tvMovePct: number | null;
  labMovePct: number;
}

export interface CompareReason {
  id: "costs" | "sizing" | "order" | "delay" | "exits" | "unpaired" | "period" | "scope";
  title: string;
  text: string;
}

export interface Comparison {
  barMs: number;
  /** the common period (entry times inside it are compared), `null` when the two do not overlap */
  window: { from: number; to: number } | null;
  tv: { total: number; open: number; closed: number; inWindow: number; outside: number };
  lab: { total: number; inWindow: number; outside: number };
  pairs: ComparePair[];
  onlyTv: TvTrade[];
  onlyLab: LabTrade[];
  /** net result of the paired trades (money, each side in its own sizing) and of all compared trades */
  net: { tvPaired: number | null; labPaired: number; tvAll: number | null; labAll: number; diffAll: number | null; diffPaired: number | null };
  /** sum of price moves in percent over the paired trades */
  moves: { tv: number | null; lab: number };
  costs: { fees: number; funding: number; slippage: number };
  qty: { tv: number | null; lab: number | null };
  /** share of TradingView's compared trades that have a partner (`null` without trades) */
  matchRate: number | null;
  reasons: CompareReason[];
}

export interface CompareOptions {
  /** length of one execution bar in ms */
  barMs: number;
  /** period of the lab run, ms */
  labFrom: number;
  labTo: number;
  /** entry-time tolerance in bars (default 1) */
  tolBars?: number;
}

const INTERVAL_MS: Readonly<Record<string, number>> = { "15m": 900_000, "30m": 1_800_000, "1h": 3_600_000, "2h": 7_200_000, "4h": 14_400_000, "1d": 86_400_000 };
export const barMsOf = (interval: string): number => INTERVAL_MS[interval] ?? 3_600_000;

const median = (xs: readonly number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);
const mean = (xs: readonly number[]): number | null => (xs.length ? sum(xs) / xs.length : null);
const de1 = (v: number): string => (Math.round(v * 10) / 10).toFixed(1).replace(".", ",");
const de2 = (v: number): string => (Math.round(v * 100) / 100).toFixed(2).replace(".", ",");
const n0 = (v: number): string => Math.round(v).toLocaleString("de-DE");

export function tvMovePct(t: Pick<TvTrade, "side" | "entryPrice" | "exitPrice">): number | null {
  if (t.entryPrice == null || t.exitPrice == null || !(t.entryPrice > 0)) return null;
  return ((t.side === "long" ? 1 : -1) * (t.exitPrice - t.entryPrice) * 100) / t.entryPrice;
}

/** Pairs the trades and derives the figures and observations. */
export function compareTrades(tvAll: readonly TvTrade[], labAll: readonly LabTrade[], opts: CompareOptions): Comparison {
  const { barMs } = opts;
  const tol = (opts.tolBars ?? 1) * barMs;
  const tvClosed = tvAll.filter((t) => !t.open && t.entryTime != null);
  const openN = tvAll.filter((t) => t.open).length;

  // common period: from the later start to the earlier end
  const tvStart = tvClosed.length ? Math.min(...tvClosed.map((t) => t.entryTime!)) : null;
  const tvEnd = tvClosed.length ? Math.max(...tvClosed.map((t) => t.exitTime ?? t.entryTime!)) : null;
  const window = tvStart != null && tvEnd != null && Math.max(tvStart, opts.labFrom) <= Math.min(tvEnd, opts.labTo) ? { from: Math.max(tvStart, opts.labFrom), to: Math.min(tvEnd, opts.labTo) } : null;
  const inWin = (t: number): boolean => window != null && t >= window.from && t <= window.to;
  const tv = window ? tvClosed.filter((t) => inWin(t.entryTime!)) : [];
  const lab = window ? labAll.filter((t) => inWin(t.entryTime)) : [];

  // greedy pairing in time order: the nearest free partner of the same direction within the tolerance
  const used = new Set<number>();
  const pairs: ComparePair[] = [];
  const onlyLab: LabTrade[] = [];
  for (const l of [...lab].sort((a, b) => a.entryTime - b.entryTime)) {
    let best = -1;
    let bestD = Infinity;
    tv.forEach((t, i) => {
      if (used.has(i) || t.side !== l.side) return;
      const d = Math.abs(t.entryTime! - l.entryTime);
      if (d <= tol && d < bestD) {
        best = i;
        bestD = d;
      }
    });
    if (best < 0) {
      onlyLab.push(l);
      continue;
    }
    used.add(best);
    const t = tv[best]!;
    pairs.push({
      tv: t,
      lab: l,
      entryBars: (t.entryTime! - l.entryTime) / barMs,
      exitBars: t.exitTime != null ? (t.exitTime - l.exitTime) / barMs : null,
      entryDiffPct: t.entryPrice != null && l.entry > 0 ? ((t.entryPrice - l.entry) * 100) / l.entry : 0,
      exitDiffPct: t.exitPrice != null && l.exit > 0 ? ((t.exitPrice - l.exit) * 100) / l.exit : null,
      tvMovePct: tvMovePct(t),
      labMovePct: l.move * 100,
    });
  }
  const onlyTv = tv.filter((_, i) => !used.has(i));

  const tvPnl = (ts: readonly TvTrade[]): number | null => (ts.length && ts.every((t) => t.pnl != null) ? sum(ts.map((t) => t.pnl!)) : ts.length ? null : 0);
  const tvPaired = tvPnl(pairs.map((p) => p.tv));
  const tvAllNet = tvPnl(tv);
  const labPaired = sum(pairs.map((p) => p.lab.pnl));
  const labAllNet = sum(lab.map((t) => t.pnl));
  const movesTv = pairs.map((p) => p.tvMovePct);
  const costs = { fees: sum(pairs.map((p) => p.lab.fees)), funding: sum(pairs.map((p) => p.lab.funding)), slippage: sum(pairs.map((p) => p.lab.slippage)) };
  const qty = { tv: mean(pairs.flatMap((p) => (p.tv.qty != null ? [Math.abs(p.tv.qty)] : []))), lab: mean(pairs.map((p) => p.lab.qty)) };

  const out: Comparison = {
    barMs,
    window,
    tv: { total: tvAll.length, open: openN, closed: tvClosed.length, inWindow: tv.length, outside: tvClosed.length - tv.length },
    lab: { total: labAll.length, inWindow: lab.length, outside: labAll.length - lab.length },
    pairs,
    onlyTv,
    onlyLab,
    net: { tvPaired, labPaired, tvAll: tvAllNet, labAll: labAllNet, diffAll: tvAllNet != null ? labAllNet - tvAllNet : null, diffPaired: tvPaired != null ? labPaired - tvPaired : null },
    moves: { tv: movesTv.every((m) => m != null) && movesTv.length ? sum(movesTv as number[]) : null, lab: sum(pairs.map((p) => p.labMovePct)) },
    costs,
    qty,
    matchRate: tv.length ? pairs.length / tv.length : null,
    reasons: [],
  };
  out.reasons = reasonsOf(out);
  return out;
}

/** The observations, each only when the figures support it. Wording: "kann", never "ist die Ursache". */
function reasonsOf(c: Comparison): CompareReason[] {
  const r: CompareReason[] = [];
  const bars = (v: number): string => `${de1(Math.abs(v))} Kerze${Math.abs(v) === 1 ? "" : "n"}`;

  if (c.window == null) {
    r.push({ id: "period", title: "Kein gemeinsamer Zeitraum", text: "Der Export und der Labor-Lauf überlappen sich nicht. Wähle im Labor einen Zeitraum, der die Trades der Datei enthält, und rechne neu." });
    return r;
  }
  const openText = c.tv.open === 1 ? "1 offener TradingView-Trade bleibt außen vor" : `${c.tv.open} offene TradingView-Trades bleiben außen vor`;
  if (c.tv.outside || c.lab.outside) {
    r.push({
      id: "period",
      title: "Nur der gemeinsame Zeitraum zählt",
      text: `Verglichen werden Einstiege im gemeinsamen Zeitraum. Außerhalb liegen ${c.tv.outside} Trades aus TradingView und ${c.lab.outside} aus dem Labor${c.tv.open ? `; ${openText}` : ""}.`,
    });
  } else if (c.tv.open) {
    r.push({ id: "period", title: "Offene Trades", text: `${openText[0]!.toUpperCase()}${openText.slice(1)}.` });
  }

  const labCost = c.costs.fees + c.costs.funding;
  if (c.pairs.length && labCost > 0) {
    r.push({
      id: "costs",
      title: "Kosten",
      text: `Das Labor zieht bei den ${c.pairs.length} gepaarten Trades ${n0(c.costs.fees)} USDT Gebühren${c.costs.funding ? ` und ${n0(Math.abs(c.costs.funding))} USDT Funding` : ""} ab (Slippage steckt in den Fill-Preisen: ${n0(c.costs.slippage)} USDT). TradingView rechnet nur Kommission und Slippage aus den Strategie-Eigenschaften – ohne Eintrag dort 0. Das kann einen Teil des Unterschieds im Netto erklären.`,
    });
  }

  if (c.qty.tv != null && c.qty.lab != null && c.qty.tv > 0 && c.qty.lab > 0) {
    const ratio = c.qty.lab / c.qty.tv;
    if (ratio > 1.15 || ratio < 1 / 1.15)
      r.push({ id: "sizing", title: "Positionsgröße", text: `Im Schnitt handelt TradingView ${de2(c.qty.tv)} Einheiten, das Labor ${de2(c.qty.lab)} (Risiko-Sizing). Geldbeträge sind deshalb nicht direkt vergleichbar; die Summe der Preisbewegungen in % ist es.` });
  }

  // same bar of exit, but another price/result → the order of high and low inside a candle
  const ambiguous = c.pairs.filter((p) => p.lab.ambiguous).length;
  const sameBarOtherPrice = c.pairs.filter((p) => p.exitBars === 0 && p.exitDiffPct != null && Math.abs(p.exitDiffPct) > 0.1).length;
  if (ambiguous || sameBarOtherPrice) {
    const parts = [
      ambiguous ? `${ambiguous} gepaarte${ambiguous === 1 ? "r" : ""} Trade${ambiguous === 1 ? "" : "s"} hatte${ambiguous === 1 ? "" : "n"} Stop und Ziel in derselben Kerze (das Labor nimmt dann den Stop)` : "",
      sameBarOtherPrice ? `${sameBarOtherPrice} endete${sameBarOtherPrice === 1 ? "" : "n"} in derselben Kerze, aber zu einem anderen Preis (mehr als 0,1 %)` : "",
    ].filter(Boolean);
    r.push({ id: "order", title: "Reihenfolge innerhalb der Kerze", text: `${parts.join("; ")}. Welche Kante zuerst kam, steht in Kerzen nicht drin; TradingView schätzt den Verlauf anders als das Labor. Das kann solche Abweichungen erklären.` });
  }

  const entryOff = c.pairs.filter((p) => p.entryBars !== 0);
  const med = median(c.pairs.map((p) => p.entryBars));
  if (entryOff.length) {
    r.push({
      id: "delay",
      title: "Verzögerung beim Einstieg",
      text: `${entryOff.length} von ${c.pairs.length} Paaren steigen nicht in derselben Kerze ein; im Median ${med === 0 || med == null ? "0 Kerzen" : `${bars(med)} ${med > 0 ? "später" : "früher"} in TradingView`}. Das kann an der Ausführung liegen (Signal auf Kerzenschluss vs. Intrabar, process_orders_on_close) oder an einem Zeitzonen-Versatz der Datei.`,
    });
  }
  const exitLater = c.pairs.filter((p) => p.exitBars != null && p.exitBars > 0).length;
  const exitEarlier = c.pairs.filter((p) => p.exitBars != null && p.exitBars < 0).length;
  if (exitLater || exitEarlier)
    r.push({ id: "exits", title: "Ausstiege", text: `${exitEarlier} Ausstieg${exitEarlier === 1 ? "" : "e"} kam${exitEarlier === 1 ? "" : "en"} in TradingView früher, ${exitLater} später als im Labor. Unterschiedliche Stop-/Ziel-Logik (zum Beispiel Trailing oder Gegensignal in Pine) kann das verursachen.` });

  if (c.onlyTv.length || c.onlyLab.length)
    r.push({
      id: "unpaired",
      title: "Trades ohne Gegenstück",
      text: `${c.onlyTv.length} Trade${c.onlyTv.length === 1 ? "" : "s"} nur in TradingView, ${c.onlyLab.length} nur im Labor. Häufige Gründe: andere Signal-Definition in Pine, Pyramiding oder Umkehr-Orders, eine andere Zeiteinheit, andere Datenreihe, oder die Datei ist in einer anderen Zeitzone (siehe Versatz).`,
    });

  r.push({ id: "scope", title: "Was der Export nicht sagt", text: "Die Datei nennt weder Markt noch Zeiteinheit. Der Vergleich nimmt an, dass sie zum gewählten Labor-Lauf passen. Ein Unterschied hier ist eine Beobachtung, kein Beweis für einen Fehler auf einer der Seiten." });
  return r;
}
