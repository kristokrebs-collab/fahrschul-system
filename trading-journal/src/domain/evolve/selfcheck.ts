/**
 * The self-check: "Hat sich der Vorschlag live bestätigt?" (pure). A proposal that was started as a challenger (a virtual
 * forward account, `@/domain/forward`) is held against the expectation it was made with: Ø R and the net result per 30 days
 * (in percent of the capital) of the test windows. A verdict needs at least `MIN_LIVE_DAYS` days and `MIN_LIVE_TRADES`
 * trades – before that it says "noch zu früh" and nothing else.
 *
 *   confirmed  Ø R live is at or above the LOWER end of the 80 % interval of the expectation, and the net result is positive
 *   below      Ø R live is under that lower end
 *   open       in between (e.g. Ø R fine, money not) – no verdict
 *
 * Both sides are measured the same way as in the search: R per trade limited to ±5, funding income not counted (`score.ts`).
 * "Confirmed" is a statement about a few weeks and a few trades, not a proof; the text says so. Prediction and outcome are
 * both shown in percent per 30 days so they can be read side by side.
 */
import type { Interval } from "../analytics/stats";
import { accountView, type ForwardAccount } from "../forward";
import { scoredPnl, scoredR } from "./score";
import type { Expected } from "./types";

export const MIN_LIVE_DAYS = 21;
export const MIN_LIVE_TRADES = 10;
const DAY = 86_400_000;

const de = (v: number, d = 1): string => v.toFixed(d).replace(".", ",").replace("-", "−");
const signed = (v: number, d = 1): string => `${v > 0 ? "+" : ""}${de(v, d)}`;

export interface LiveFacts {
  startMs: number;
  /** close of the last processed candle (ms), null = nothing processed */
  asOfMs: number | null;
  n: number;
  avgR: number | null;
  avgRCI: Interval | null;
  /** net result as a fraction of the start capital */
  netPct: number | null;
}

export type LiveLevel = "early" | "confirmed" | "below" | "open";

export interface LiveCheck {
  level: LiveLevel;
  days: number;
  n: number;
  expectedPct: number | null;
  actualPct: number | null;
  expectedR: number | null;
  actualR: number | null;
  headline: string;
  text: string;
  notes: string[];
}

/** The live facts of a forward account. */
export function liveFactsOf(a: ForwardAccount): LiveFacts {
  const v = accountView(a);
  // the expectation was made without funding income and with R capped per trade (`score.ts`); the live figure is measured the same way
  const rs = a.trades.map(scoredR);
  const avgR = rs.length ? rs.reduce((x, y) => x + y, 0) / rs.length : null;
  const net = a.capital > 0 ? a.trades.reduce((s, t) => s + scoredPnl(t), 0) / a.capital : null;
  return { startMs: a.startMs, asOfMs: v.upTo, n: v.stats.n, avgR, avgRCI: v.stats.rCI, netPct: net };
}

export function liveCheck(exp: Expected, live: LiveFacts): LiveCheck {
  const days = live.asOfMs != null ? Math.max(0, (live.asOfMs - live.startMs) / DAY) : 0;
  const actualPct = live.netPct != null && days > 0 ? ((live.netPct * 100) / days) * 30 : null;
  const base = { days, n: live.n, expectedPct: exp.pctPer30d, actualPct, expectedR: exp.avgR, actualR: live.avgR };
  const notes = ["Das ist ein Zwischenstand aus wenigen Wochen und wenigen Trades, kein Beweis. Vergangene Ergebnisse sind keine Prognose."];
  const sides =
    `Erwartet (aus den Testfenstern): ${exp.avgR != null ? `Ø ${signed(exp.avgR, 2)} R` : "Ø R unbekannt"}${exp.pctPer30d != null ? `, ${signed(exp.pctPer30d)} % pro 30 Tage` : ""}. ` +
    `Tatsächlich im Vorwärtstest (${de(days, 0)} Tage, ${live.n} Trades): ${live.avgR != null ? `Ø ${signed(live.avgR, 2)} R` : "noch kein abgeschlossener Trade"}${actualPct != null ? `, ${signed(actualPct)} % pro 30 Tage` : ""}.`;
  if (days < MIN_LIVE_DAYS || live.n < MIN_LIVE_TRADES) {
    return { level: "early", ...base, headline: "Noch zu früh für ein Urteil", text: `Der Vorwärtstest läuft seit ${de(days, 0)} Tagen mit ${live.n} Trades. Ein Urteil gibt es frühestens nach ${MIN_LIVE_DAYS} Tagen und ${MIN_LIVE_TRADES} Trades. ${sides}`, notes };
  }
  if (exp.avgR == null || live.avgR == null) return { level: "open", ...base, headline: "Nicht entscheidbar", text: `Es fehlt eine der beiden Zahlen. ${sides}`, notes };
  const floor = exp.avgRCI ? exp.avgRCI.lo : exp.avgR * 0.5;
  if (live.avgR < floor) {
    return { level: "below", ...base, headline: "Nicht bestätigt", text: `Der Vorwärtstest liegt unter dem, was die Testfenster erwarten ließen (untere Grenze des 80-%-Bereichs: ${signed(floor, 2)} R). ${sides}`, notes: [...notes, "Ein Rückstand nach wenigen Wochen kann Zufall sein – er kann aber auch zeigen, dass der Vorschlag nur auf die Vergangenheit passte."] };
  }
  if ((actualPct ?? 0) > 0) return { level: "confirmed", ...base, headline: "Bisher bestätigt", text: `Der Vorwärtstest liegt im erwarteten Bereich oder darüber (untere Grenze des 80-%-Bereichs: ${signed(floor, 2)} R). ${sides}`, notes };
  return { level: "open", ...base, headline: "Nicht eindeutig", text: `Ø R liegt im erwarteten Bereich, das Geld-Ergebnis aber nicht im Plus. ${sides}`, notes };
}
