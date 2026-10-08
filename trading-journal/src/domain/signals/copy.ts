/**
 * German copy of the "Einstiegs-Check" (other journal `signalpanel.tsx` / `forms.tsx`), adapted to Binance data.
 * Pure strings and formatters; the UI agents render them.
 */
import { STRENGTH_LABEL, divCfgOf, srCfgOf, strongClosesOf, whaleCfgOf, type SignalCfg } from "./config";
import type { WtKind } from "./mcb";
import type { Zone, ZoneInfo } from "./zones";

export const SIGNAL_TITLE = "Einstiegs-Check";

/** Event text per MCB kind (`null` = "kein Signal"). */
export const KIND_TEXT: Readonly<Record<WtKind, string>> = {
  bottom: "Bottom",
  buy: "Kaufsignal",
  bull: "Einstieg",
  top: "Top",
  sell: "Verkaufssignal",
  bear: "Einstieg Short",
};
export const NO_KIND_TEXT = "kein Signal";
export const kindText = (k: WtKind | null | undefined): string => (k ? KIND_TEXT[k] : NO_KIND_TEXT);
/** Filled dot for strong kinds, outlined for the small crosses. */
export const isStrongKind = (k: WtKind | null | undefined): boolean => !!k && k !== "bull" && k !== "bear";

/** Role of a rung: "Basis" (0), "Bestätigung" (< required), "stärker". */
export function roleText(i: number, required: number): string {
  return i === 0 ? "Basis" : i < required ? "Bestätigung" : "stärker";
}

/** "jetzt" for the running candle, otherwise "vor {n}". */
export const ageText = (barsAgo: number | null | undefined): string => (barsAgo == null ? "" : barsAgo === 0 ? "jetzt" : `vor ${barsAgo}`);

export const strengthText = (s: number): string => STRENGTH_LABEL[Math.max(0, Math.min(4, Math.round(s)))] ?? STRENGTH_LABEL[0]!;

export const ZONE_TEXT: Readonly<Record<Zone, string>> = { premium: "Premium", equilibrium: "Equilibrium", discount: "Discount" };
/** `Discount-Zone · 3 %` style pill text. */
export function zonePillText(z: Pick<ZoneInfo, "zone" | "deep" | "pos">): string {
  return `${ZONE_TEXT[z.zone]}${z.deep ? "-Zone" : ""} · ${Math.round(z.pos * 100)} %`;
}
export function zoneFooterText(z: Pick<ZoneInfo, "lux" | "brk"> | null): string {
  if (!z) return "Premium/Discount: zu wenig Kerzen.";
  if (!z.lux) return "Noch kein Swing-Pivot, Bereich der letzten 120 Kerzen";
  const s = z.brk ? ` · Struktur ${z.brk.kind} ${z.brk.dir === 1 ? "↑" : "↓"}` : "";
  return `LuxAlgo-Logik · Swing-Bereich seit dem letzten Pivot${s}`;
}

export const TOO_FEW_BARS = "Zu wenig Kerzen";
export const LOADING_TEXT = "Kerzen werden geladen …";
export const OFFLINE_TEXT = "Keine Marktdaten (Binance).";
export const STALE_TEXT = "Marktdaten veraltet, der Check zeigt den letzten Stand.";
export const DATA_SOURCE_NOTE = "aus Binance-Kerzen (BTCUSDT Perp) nachgerechnet; kann vom Bitstamp-Chart leicht abweichen";

export const RETRO_LOADING = "Kerzen für diesen Zeitpunkt werden geladen …";
export const RETRO_EMPTY = "Keine Kerzen für diesen Zeitpunkt.";

/** Top-Trader / Retail condition without data (older than ~30 days, no Binance futures data). */
export const WHALE_NO_DATA = "keine Daten";
export const WHALE_NO_DATA_HINT = "Binance-Futures-Daten (Top-Trader / alle Konten) fehlen für diesen Zeitpunkt; sie reichen ~30 Tage zurück und gibt es nur bei Binance.";

/** `+1,2 pp` / `−0,8 pp` (U+2212). */
export function ppText(x: number): string {
  if (!Number.isFinite(x)) return "–";
  return `${signedPp(x)} pp`;
}

/** `+1,2` / `−0,8` / `±0,0` (one decimal, symmetric rounding, U+2212), without the unit. */
export function signedPp(x: number): string {
  if (!Number.isFinite(x)) return "–";
  const r = (Math.sign(x) * Math.round(Math.abs(x) * 10)) / 10; // symmetric: −0,85 → −0,9 like +0,85 → +0,9
  const abs = Math.abs(r).toFixed(1).replace(".", ",");
  return `${r > 0 ? "+" : r < 0 ? "−" : "±"}${abs}`;
}

/**
 * Whale–Retail-Delta as shown (like Hyblock): `−3,5 pp · 1h −2,1` (the level and its change over the window), `−3,5 pp`
 * without an older point, `keine Daten` without a delta.
 */
export function deltaText(delta: number | null | undefined, chg: number | null | undefined, window: string): string {
  if (delta == null) return chg == null ? WHALE_NO_DATA : `${window} ${signedPp(chg)} pp`;
  return chg == null ? ppText(delta) : `${ppText(delta)} · ${window} ${signedPp(chg)}`;
}

/**
 * The rule of the `retail` item in words: long `< 0 oder fällt ≥ 1 pp (1h)` ("Retail rot"), short `> 0 oder steigt ≥ 1 pp
 * (1h)` ("Retail grün"); the level threshold mirrored (`deltaRed` −2 → long `< −2`, short `> 2`).
 */
export function deltaRuleText(side: "long" | "short", w: { deltaRed: number; deltaFall: number; deltaWindow: string }): string {
  const long = side === "long";
  const level = long ? w.deltaRed : -w.deltaRed;
  const sign = level < 0 ? "−" : "";
  return `${long ? "<" : ">"} ${sign}${dec(Math.abs(level))} oder ${long ? "fällt" : "steigt"} ≥ ${dec(w.deltaFall)} pp (${w.deltaWindow})`;
}

/** Honest source note: Binance's cohorts, not Hyblock's. */
export const WHALE_DELTA_NOTE =
  "Whale–Retail-Delta = Long-Anteil der Binance-Top-Trader nach Konten (Top 20 % nach Margin) minus Long-Anteil aller Konten, 5-min-Daten. Das sind Binance-Kohorten, nicht Hyblocks eigene – der Wert kann von Hyblocks „Whale vs Retail Delta“ leicht abweichen.";

/** `2 Perioden` / `1 Periode`. */
export const periodsText = (n: number): string => `${n} ${n === 1 ? "Periode" : "Perioden"}`;

/** "{Stärke} · {tiers} von {n} Timeframes". */
export function strengthLine(strength: number, tiers: number, ladderLength: number): string {
  return `${strengthText(strength)} · ${tiers} von ${ladderLength} Timeframes`;
}

/** `1,5` (de-DE, at most one decimal). */
const dec = (x: number): string => String(Math.round(x * 10) / 10).replace(".", ",");

/** Info panel ("So prüft das Journal"), adapted to Binance. */
export function signalInfo(cfg: SignalCfg, symbol = "BTCUSDT") {
  const ladder = cfg.ladder;
  const w = whaleCfgOf(cfg);
  const d = divCfgOf(cfg);
  const r = srCfgOf(cfg);
  const pts = (weight: number): string => (weight > 0 ? `bis +${weight} Score (anteilig), voll erfüllt +1 Stärke` : "nur Anzeige, zählt nicht");
  const partRows = [
    ...(w.on
      ? [
          {
            k: "Top-Trader-Kombi",
            v: `4 Teile, je mehr erfüllt, desto stärker: Top-Trader > ${dec(w.topPct)} % Long nach Positionen, > ${dec(w.topPct)} % Long nach Konten, Retail rot = Whale–Retail-Delta (Top-Trader-Konten minus alle Konten, Long-%) ${deltaRuleText("long", w)}, Preis im Discount; Short spiegelbildlich (> ${dec(w.topPct)} % Short, Retail grün = Delta ${deltaRuleText("short", w)}, Premium). Binance-5-min-Daten (Binance-Kohorten, nicht Hyblocks – Werte können leicht abweichen), ${pts(w.weight)} ab ${w.bonusParts} von 4.`,
          },
        ]
      : []),
    ...(d.on
      ? [
          {
            k: "Divergenzen",
            v: `RSI ${cfg.rsiLen} und WaveTrend wt1 gegen den Kurs an Pivots (${d.left} Kerzen links / ${d.right} rechts), regulär = Umkehr, ${d.hidden ? "versteckt = Fortsetzung, " : ""}gilt ${d.maxAge} Kerzen nach der Bestätigung; ${pts(d.weight)} bei einer regulären auf geschlossener Kerze.`,
          },
        ]
      : []),
    ...(r.on
      ? [
          {
            k: "Support/Widerstand",
            v: `LuxAlgo-Struktur (Swing ${cfg.swingLookback}, intern ${r.internal}): Swing-Hochs/-Tiefs, BOS/CHoCH, Order-Blocks, EQH/EQL. Long: nahe Support/Demand (≤ ${dec(r.nearAtr)} ATR) und Platz bis zum nächsten Widerstand (≥ ${dec(r.minR)} R); Short spiegelbildlich. ${pts(r.weight)}.`,
          },
        ]
      : []),
  ];
  const bonus = [w.on && w.weight > 0 ? "Top-Trader-Kombi" : "", d.on && d.weight > 0 ? "Divergenz" : "", r.on && r.weight > 0 ? "Support + Platz" : ""].filter(Boolean);
  const bonusText = bonus.length ? ` · ${bonus.join(", ")} = Bonus` : "";
  return {
    title: "So prüft das Journal",
    what:
      `Aus den Binance-Kerzen (${symbol} Perp) rechnet das Journal deine Indikatoren nach: MCB/WaveTrend (Kanal ${cfg.wtChannel}, Schnitt ${cfg.wtAverage}, Signal ${cfg.wtSignal}), ` +
      `RSI ${cfg.rsiLen} mit gleitendem Durchschnitt ${cfg.rsiMaLen} und Premium/Discount nach LuxAlgo (Swing-Pivots mit Länge ${cfg.swingLookback}) auf ${cfg.zoneTf}. ` +
      `45m entsteht exakt aus drei 15m-Kerzen. Die laufende Kerze wird mit dem Live-Kurs ergänzt, wie im Chart: ein Signal darauf ist vorläufig und zählt erst, wenn die Kerze damit schließt. ` +
      `Werte können vom Bitstamp-Chart leicht abweichen; private Indikator-Skripte selbst sind nicht lesbar.`,
    formula: [
      `Long: MCB Bottom/Einstieg auf ${ladder.slice(0, cfg.required).join(" + ")} (Pflicht)${ladder.length > cfg.required ? ` · ${ladder.slice(cfg.required).join(", ")} = stärker` : ""} · RSI ≤ ${cfg.rsiOs + cfg.rsiNear} (Pflicht) · Discount = Bonus${bonusText}`,
      `Short: spiegelbildlich mit Top, RSI ≥ ${cfg.rsiOb - cfg.rsiNear} und Premium`,
      `Bestätigt, sobald die ${ladder[0]}-Kerze mit dem Signal geschlossen hat; vorher vorläufig (zählt nicht als Einstieg)`,
    ],
    rows: [
      { k: "Signal gilt", v: `${cfg.signalLookback} Kerzen` },
      { k: "Bestätigung", v: `vorläufig auf der laufenden Kerze · bestätigt nach ihrem Schluss · stark bestätigt nach ${strongClosesOf(cfg)} Schlüssen ohne Bruch` },
      { k: "Bottom/Top", v: `wt1 und Kurs drehen aus ${cfg.revRange}-Kerzen-Tief/Hoch` },
      { k: "Kauf-/Verkaufssignal", v: `Kreuzung bei ≤ ${cfg.wtOs} / ≥ ${cfg.wtOb}` },
      { k: "Einstieg", v: "Kreuzung unter (Short: über) der Nulllinie" },
      { k: "Stärke", v: "Basis + Bestätigung = 1, jede weitere Stufe +1, Discount +1, jede voll erfüllte Teil-Bedingung +1 (bis Maximal)" },
      { k: "Score", v: "Leiter 55 · RSI 20 · Zone 15 · Bottom/Top 10" },
      { k: "Teil-Bedingungen", v: "zählen anteilig nach Gewicht (z. B. 3 von 4 = ¾ der Punkte); eine vorläufige Stufe zählt in der Leiter halb" },
      ...partRows,
    ],
    verdict: "Einstellbar unter Einstellungen → Einstiegs-Check. Beim Eintragen eines Trades wird der Check mitgespeichert (auch ob vorläufig oder bestätigt), so siehst du später, welche Signal-Stärke wirklich Geld bringt.",
  } as const;
}
