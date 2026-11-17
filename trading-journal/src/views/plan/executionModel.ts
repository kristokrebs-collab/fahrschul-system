/**
 * Ausführbarkeits-Check (F44) of the Handelsplan – the pure part: German sentences built from the check (`@/domain/execution`)
 * and the reasons a book could not be read. No React, no I/O.
 */
import { FAIL_LABEL } from "@/domain/archive";
import { SPREAD_NORMAL_BPS, SPREAD_TIGHT_BPS, SPREAD_WIDE_BPS, TURNOVER_HUGE, TURNOVER_LARGE, type Band, type ExecCheck, type Impact, type Tone } from "@/domain/execution";
import { mio, n0, n1, n2 } from "@/lib/format";
import { priceText, qtyText } from "@/domain/plan";
import { splitSymbol } from "@/market/symbol";

export const EXEC_STRINGS = {
  title: "Ausführbarkeit jetzt (live)",
  lead: "Ein Blick ins Orderbuch: wie weit Kauf- und Verkaufskurs auseinanderliegen und wie viel deine Größe den Preis bewegen würde – gemessen an einer Momentaufnahme, nicht an einer Prognose.",
  button: "Spread und Tiefe prüfen",
  again: "Erneut prüfen",
  loading: "Lese das Orderbuch …",
  stocks: "Für Aktien ist keine Orderbuch-Quelle angebunden – dort gibt es keine Daten zu Spread und Tiefe, und die App schätzt keine.",
  source: "Binance USDⓈ-M · Orderbuch /fapi/v1/depth",
  moment: "Eine Momentaufnahme: Das Orderbuch ändert sich in Sekunden, und ein Stop im schnellen Markt kann schlechter füllen als hier gerechnet.",
  noBacktest: "Das ist der Unterschied zu einem Backtest: dort ist die Slippage eine Annahme, hier ist sie – für diesen Augenblick – gemessen.",
  assumed: "Angenommen",
  old: "Älter als eine Minute – prüfe erneut, bevor du dich darauf stützt.",
} as const;

/** `ok` etc. as a word, so a state is never colour alone. */
export const TONE_WORD: Readonly<Record<Tone, string>> = { ok: "in Ordnung", warn: "Achtung", bad: "Problem", unknown: "keine Daten" };

/** German reason why the book could not be read. */
export function failureText(kind: string): string {
  if (kind === "offline") return "Das Gerät ist offline.";
  if (kind === "bad_symbol") return "Binance kennt dieses Symbol nicht.";
  return FAIL_LABEL[kind] ?? `Fehler (${kind})`;
}

/** Quote currency of a USDⓈ-M symbol (`BTCUSDT` → `USDT`), „Quote“ when the symbol cannot be split. */
export const quoteOf = (symbol: string): string => splitSymbol(symbol.toUpperCase())?.quote ?? "Quote";
/** Base asset (`BTCUSDT` → `BTC`), the symbol itself when it cannot be split. */
export const baseOf = (symbol: string): string => splitSymbol(symbol.toUpperCase())?.base ?? symbol;

const bps = (v: number | null): string => (v === null ? "–" : `${n2(v)} bp`);

export function spreadLine(c: ExecCheck, tick: number): string {
  const t = c.touch;
  if (!t || !c.spread) return "Spread: kein Wert lesbar – das Orderbuch ist einseitig oder gekreuzt.";
  return `Spread ${bps(t.spreadBps)} (${priceText(t.spread, tick)}) – Kauf ${priceText(t.ask, tick)}, Verkauf ${priceText(t.bid, tick)} · ${c.spread.word}`;
}

export const SPREAD_RULE = `Richtwerte dieser App: bis ${SPREAD_TIGHT_BPS} bp eng, bis ${SPREAD_NORMAL_BPS} bp normal, bis ${SPREAD_WIDE_BPS} bp weit, darüber sehr weit (1 bp = 0,01 %).`;
export const TURNOVER_RULE = `Richtwerte dieser App: über ${n1(TURNOVER_LARGE * 100)} % des 24-h-Umsatzes ist die Order groß, über ${n1(TURNOVER_HUGE * 100)} % sehr groß.`;

/** `±0,1 %: Käufer 1,2 Mio · Verkäufer 0,9 Mio USDT` – a lower bound where the snapshot does not reach the edge of the band. */
export function bandLine(b: Band, quote: string): string {
  const reach = !b.bidCovered || !b.askCovered;
  const part = (v: number, covered: boolean): string => `${covered ? "" : "mindestens "}${mio(v)}`;
  return `±${n1(b.pct * 100)} %: Käufer ${part(b.bidValue, b.bidCovered)} · Verkäufer ${part(b.askValue, b.askCovered)} ${quote}${reach ? " (der Ausschnitt reicht nicht bis zum Rand)" : ""}`;
}

/** One leg (opening or closing): the average price, the impact and whether the levels cover the size. */
export function legLine(label: string, base: string, i: Impact | null, tick: number, lot: number): string {
  if (!i) return `${label}: kein Wert lesbar.`;
  const verb = i.action === "buy" ? "Kauf" : "Verkauf";
  const head = `${label} (${verb} ${qtyText(i.qty, lot)} ${base})`;
  if (i.avg === null) return `${head}: das Orderbuch hat auf dieser Seite keine Menge.`;
  if (!i.complete) return `${head}: das Orderbuch (die ersten ${n0(i.levels)} Stufen) reicht nicht – nur ${qtyText(i.filled, lot)} von ${qtyText(i.qty, lot)} ${base} (${n1((i.filled / i.qty) * 100)} %) würden gefüllt.`;
  return `${head}: Ø-Preis ${priceText(i.avg, tick)} · ${bps(i.impactBps)} über den besten Preis hinaus · ${bps(i.fromMidBps)} von der Mitte · ${n0(i.levels)} ${i.levels === 1 ? "Stufe" : "Stufen"}`;
}

export function assumptionLine(c: ExecCheck): string {
  const a = `${n2(c.assumedBps)} bp`;
  if (c.assumption === "unknown") return `Annahme im Plan: Slippage am Stop ${a}. Das Orderbuch reicht für den Stop-Ausstieg nicht aus oder ist nicht lesbar – kein Vergleich möglich.`;
  const m = bps(c.measuredBps);
  return c.assumption === "covered"
    ? `Annahme im Plan: Slippage am Stop ${a}. Das Orderbuch jetzt: ${m} von der Mitte – die Annahme deckt es.`
    : `Annahme im Plan: Slippage am Stop ${a}. Das Orderbuch jetzt: ${m} von der Mitte – mehr als angenommen; der Verlust am Stop wäre größer als geplant.`;
}

export function turnoverLine(c: ExecCheck, value: number | null, volume: number | null, quote: string, note: string | null): string {
  if (c.turnover === null || value === null || volume === null) return `Anteil am 24-h-Umsatz: keine Daten${note ? ` (${note})` : ""}.`;
  return `Die Order (≈ ${mio(value)} ${quote}) ist ${n2(c.turnover * 100)} % des 24-h-Umsatzes (${mio(volume)} ${quote}).`;
}

/** The one sentence on top. */
export function headline(tone: Tone): string {
  switch (tone) {
    case "ok":
      return "Das Orderbuch von jetzt trägt die Größe – Spread und Tiefe sind unauffällig.";
    case "warn":
      return "Das Orderbuch trägt die Größe nur mit Vorbehalt – siehe die gelben Zeilen.";
    case "bad":
      return "Das Orderbuch trägt die Größe nicht oder nur schlecht – siehe die roten Zeilen.";
    default:
      return "Kein Urteil möglich: Es fehlen Daten.";
  }
}
