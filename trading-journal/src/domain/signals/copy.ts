/**
 * German copy of the "Einstiegs-Check" (other journal `signalpanel.tsx` / `forms.tsx`), adapted to Binance data.
 * Pure strings and formatters; the UI agents render them.
 */
import { STRENGTH_LABEL, type SignalCfg } from "./config";
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

/** "{Stärke} · {tiers} von {n} Timeframes". */
export function strengthLine(strength: number, tiers: number, ladderLength: number): string {
  return `${strengthText(strength)} · ${tiers} von ${ladderLength} Timeframes`;
}

/** Info panel ("So prüft das Journal"), adapted to Binance. */
export function signalInfo(cfg: SignalCfg, symbol = "BTCUSDT") {
  const ladder = cfg.ladder;
  return {
    title: "So prüft das Journal",
    what:
      `Aus den Binance-Kerzen (${symbol} Perp) rechnet das Journal deine Indikatoren nach: MCB/WaveTrend (Kanal ${cfg.wtChannel}, Schnitt ${cfg.wtAverage}, Signal ${cfg.wtSignal}), ` +
      `RSI ${cfg.rsiLen} mit gleitendem Durchschnitt ${cfg.rsiMaLen} und Premium/Discount nach LuxAlgo (Swing-Pivots mit Länge ${cfg.swingLookback}) auf ${cfg.zoneTf}. ` +
      `45m entsteht exakt aus drei 15m-Kerzen. Die laufende Kerze wird mit dem Live-Kurs ergänzt, wie im Chart. Werte können vom Bitstamp-Chart leicht abweichen; private Indikator-Skripte selbst sind nicht lesbar.`,
    formula: [
      `Long: MCB Bottom/Einstieg auf ${ladder.slice(0, cfg.required).join(" + ")} (Pflicht)${ladder.length > cfg.required ? ` · ${ladder.slice(cfg.required).join(", ")} = stärker` : ""} · RSI ≤ ${cfg.rsiOs + cfg.rsiNear} (Pflicht) · Discount = Bonus`,
      `Short: spiegelbildlich mit Top, RSI ≥ ${cfg.rsiOb - cfg.rsiNear} und Premium`,
    ],
    rows: [
      { k: "Signal gilt", v: `${cfg.signalLookback} Kerzen` },
      { k: "Bottom/Top", v: `wt1 und Kurs drehen aus ${cfg.revRange}-Kerzen-Tief/Hoch` },
      { k: "Kauf-/Verkaufssignal", v: `Kreuzung bei ≤ ${cfg.wtOs} / ≥ ${cfg.wtOb}` },
      { k: "Einstieg", v: "Kreuzung unter (Short: über) der Nulllinie" },
      { k: "Stärke", v: "Basis + Bestätigung = 1, jede weitere Stufe +1, Discount +1" },
      { k: "Score", v: "Leiter 55 · RSI 20 · Zone 15 · Bottom/Top 10" },
    ],
    verdict: "Einstellbar unter Einstellungen → Einstiegs-Check. Beim Eintragen eines Trades wird der Check mitgespeichert, so siehst du später, welche Signal-Stärke wirklich Geld bringt.",
  } as const;
}
