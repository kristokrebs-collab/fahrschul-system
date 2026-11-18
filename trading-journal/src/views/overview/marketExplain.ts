/**
 * Explainers behind the MarketPanel mini tiles (Funding / OI / Taker / Bid-Ask) and the weekly confirmation rows:
 * a tap on a tile opens one of these in the shared MorphDialog, so every tile that looks interactive does something
 * on touch (tablet audit 2a.3 / 2a.5). Pure data with the live values read at open time.
 */
import type { ExplainerData } from "@/primitives/VerdictPanel";
import { n0, n1, signed } from "@/lib/format";
import { fundingPct } from "@/market";
import { formatNumber } from "@/motion/MotionNumber";
import { hhmmss } from "@/market/format";

/** Funding above this (per 8 h) is crowded long; below `FUNDING_LOW` shorts pay. */
const FUNDING_HIGH = 0.0005;
const FUNDING_LOW = -0.0001;

export function fundingExplain(rate: number, nextFundingAt: number, now: number, mark: number): ExplainerData {
  const verdict: ExplainerData["verdict"] =
    rate >= FUNDING_HIGH
      ? { tone: "warn", text: "Sehr hohes Funding: Longs sind teuer und gedrängt, Rücksetzer werden wahrscheinlicher." }
      : rate <= FUNDING_LOW
        ? { tone: "warn", text: "Negatives Funding: Shorts zahlen Longs. Viele Shorts im Markt, Short-Squeeze möglich." }
        : { tone: "mute", text: "Funding im normalen Bereich, keine einseitige Hebelposition." };
  return {
    title: "Funding-Rate",
    what: "Die Funding-Rate hält den Perpetual-Kurs nah am Spot-Kurs. Positiv: Longs zahlen Shorts (der Markt ist eher long gehebelt), negativ: Shorts zahlen Longs. Binance rechnet alle 8 Stunden ab.",
    rows: [
      ["Aktuell (8 h)", fundingPct(rate)],
      ["Nächstes Funding", nextFundingAt > now ? `in ${hhmmss(nextFundingAt - now)}` : "–"],
      ["Mark-Preis", mark > 0 ? n0(mark) : "–"],
    ],
    verdict,
  };
}

export function openInterestExplain(oi: number | null, base: string): ExplainerData {
  return {
    title: "Open Interest",
    what: `Summe aller offenen Kontrakte auf Binance (in ${base}). Steigt das OI mit dem Kurs, kommen neue Longs dazu; steigt es bei fallendem Kurs, neue Shorts. Fällt es, werden Positionen geschlossen oder liquidiert.`,
    rows: [["Aktuell", oi == null ? "–" : `${n0(oi)} ${base}`]],
    verdict: { tone: "mute", text: "Für Richtung und Stärke einer Bewegung zusammen mit dem Kurs lesen; den Verlauf zeigt der OI-Bereich im Chart." },
  };
}

export function takerExplain(delta: number | null): ExplainerData {
  const verdict: ExplainerData["verdict"] =
    delta == null
      ? null
      : delta > 5
        ? { tone: "win", text: "Aggressive Käufer überwiegen deutlich." }
        : delta < -5
          ? { tone: "loss", text: "Aggressive Verkäufer überwiegen deutlich." }
          : { tone: "mute", text: "Käufer und Verkäufer halten sich etwa die Waage." };
  return {
    title: "Taker-Delta",
    what: "Anteil der aggressiven Käufe minus Anteil der aggressiven Verkäufe (Taker-Volumen, Binance) in der letzten Periode. Positiv: Käufer kaufen in den Markt, negativ: Verkäufer verkaufen in den Markt.",
    formula: "(Taker-Kauf − Taker-Verkauf) / Gesamt · 100",
    rows: [["Aktuell", delta == null ? "–" : `${signed(delta, 1)} %`]],
    verdict,
  };
}

export function bookExplain(bid: number, ask: number, decimals: number): ExplainerData {
  const ok = bid > 0 && ask > 0;
  const spread = ok ? ask - bid : null;
  const bps = ok && spread != null ? (spread / ((ask + bid) / 2)) * 10_000 : null;
  return {
    title: "Bid / Ask",
    what: "Bester Kaufkurs (Bid) und bester Verkaufskurs (Ask) im Orderbuch. Der Abstand dazwischen (Spread) zeigt, wie liquide der Markt gerade ist: je enger, desto günstiger kommst du rein und raus.",
    rows: [
      ["Bid", ok ? formatNumber(bid, { decimals }) : "–"],
      ["Ask", ok ? formatNumber(ask, { decimals }) : "–"],
      ["Spread", spread == null ? "–" : `${formatNumber(spread, { decimals })} (${n1(bps)} bp)`],
    ],
    verdict: null,
  };
}

/** The weekly confirmation rows (`WeeklyChecks`): what the two checks mean. */
export function weeklyExplain(title: string, lowerHigh: number, rsiWeekly: number, closeW: number | null, rsiW: number | null): ExplainerData {
  return {
    title,
    what: "Zwei Wochen-Bedingungen als übergeordnete Bestätigung: der letzte geschlossene Wochen-Schluss über deinem Lower High und der Wochen-RSI über deiner Schwelle. Beide erfüllt bedeutet, dass der Wochen-Trend gedreht hat.",
    rows: [
      ["Wochen-Schluss", closeW == null ? "–" : n0(closeW)],
      ["Lower High (Weekly)", n0(lowerHigh)],
      ["Wochen-RSI", rsiW == null ? "–" : n1(rsiW)],
      ["RSI-Schwelle", n1(rsiWeekly)],
    ],
    verdict:
      closeW != null && rsiW != null && closeW > lowerHigh && rsiW > rsiWeekly
        ? { tone: "win", text: "Beide Wochen-Bedingungen sind erfüllt." }
        : { tone: "mute", text: "Noch nicht beide Wochen-Bedingungen erfüllt; ✕ = Bedingung offen, nicht entfernen." },
  };
}
