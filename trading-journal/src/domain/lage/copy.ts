/**
 * German copy of the Lage-Ampel: headline, sign labels, chip texts, the method / backtest text of the "Details"
 * panel. Numbers through `@/lib/format` (de-DE, U+2212 minus).
 */
import { n0, pct } from "@/lib/format";
import type { LageSignId, LageState } from "./types";

export const LAGE_TITLE = "Lage";
export const LAGE_SETTINGS_TITLE = "Lage-Ampel";

/** The traffic-light word next to the dot. */
export const LAGE_STATE_WORD: Readonly<Record<LageState, string>> = { red: "Rot", amber: "Gelb", green: "Grün", none: "Keine Daten" };

export const LAGE_HEADLINE = {
  red: "Fällt noch · abwarten",
  amber: (n: number): string => `Umkehr bildet sich · ${n} von 4`,
  confirmed: "Umkehr bestätigt",
  intact: "Aufwärtstrend intakt",
  none: "Keine Daten",
} as const;

/** One line under the headline: what the state means for an entry. */
export const LAGE_MEANING: Readonly<Record<LageState, string>> = {
  red: "Tagestrend abwärts – Kaufsignale zählen nicht.",
  amber: "Tagestrend abwärts, erste Umkehr-Zeichen – Kaufsignale zählen noch nicht.",
  green: "Tagestrend intakt – Kaufsignale zählen.",
  none: "Zu wenige Tageskerzen – keine Sperre.",
};

/** `nur Warnung`: the same states, the entry counts anyway. */
export const LAGE_MEANING_WARN: Readonly<Record<LageState, string>> = {
  red: "Tagestrend abwärts – Kaufsignale zählen trotzdem (nur Warnung).",
  amber: "Tagestrend abwärts, erste Umkehr-Zeichen – Kaufsignale zählen trotzdem (nur Warnung).",
  green: LAGE_MEANING.green,
  none: LAGE_MEANING.none,
};

export const LAGE_OFF_TEXT = "Lage-Ampel aus – Kaufsignale zählen ohne Tagestrend.";

export const SIGN_LABEL: Readonly<Record<LageSignId, string>> = {
  U1: "Kurs über 1D-EMA 21",
  U2: "4H-Schluss über EMA 21",
  U3: "4H-EMA 21 über EMA 50",
  U4: "4H-Struktur dreht hoch",
};

/** Short form for chips. */
export const SIGN_SHORT: Readonly<Record<LageSignId, string>> = {
  U1: "Kurs > 1D-EMA 21",
  U2: "4H > EMA 21",
  U3: "4H-EMA 21 > 50",
  U4: "4H-Trend hoch",
};

export const TREND_TEXT: Readonly<Record<-1 | 0 | 1, string>> = { 1: "aufwärts", [-1]: "abwärts", 0: "noch kein Bruch" };

export const LAGE_NO_DATA = "Keine Tagesdaten – die Lage-Ampel sperrt nichts.";
export const LAGE_LOADING = "Tageskerzen werden geladen …";
export const DAILY_CLOSE_LABEL = "Tagesschluss in";
export const LAGE_DETAILS = "Details";
export const LAGE_EMA_TITLE = "EMA-Leiter";
export const LAGE_LEVELS_TITLE = "Widerstand / Support";
export const LAGE_SIGNS_TITLE = "Umkehr-Zeichen (4H)";

const fmtCache = new Map<string, Intl.DateTimeFormat>();
/** `02:00` in the given zone (default: the device's). */
export function clockText(ms: number, timeZone?: string): string {
  const key = timeZone ?? "";
  let f = fmtCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit", ...(timeZone ? { timeZone } : {}) });
    fmtCache.set(key, f);
  }
  return f.format(new Date(ms));
}

const dateFmtCache = new Map<string, Intl.DateTimeFormat>();
/** `17.05.` in the given zone. */
export function dayText(ms: number, timeZone?: string): string {
  const key = timeZone ?? "";
  let f = dateFmtCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", ...(timeZone ? { timeZone } : {}) });
    dateFmtCache.set(key, f);
  }
  return f.format(new Date(ms));
}

/** `2 Tagesschlüsse unter 1D-EMA 21 (83.381, −2,4 %)` — `dist` = price vs the EMA. */
export const belowText = (n: number, ema: number, dist: number | null): string =>
  `${n} ${n === 1 ? "Tagesschluss" : "Tagesschlüsse"} unter 1D-EMA 21 (${n0(ema)}${dist == null ? "" : `, ${pct(dist)}`})`;

/** `Tagesschluss über 1D-EMA 21 (83.381, +1,2 %)` */
export const aboveText = (ema: number, dist: number | null): string => `Tagesschluss über 1D-EMA 21 (${n0(ema)}${dist == null ? "" : `, ${pct(dist)}`})`;

/** `Trend wackelt: 1. Tagesschluss unter EMA 21 · rot, wenn der nächste auch darunter schließt (02:00)` */
export const wobbleText = (closeAt: number, timeZone?: string): string =>
  `Trend wackelt: 1. Tagesschluss unter EMA 21 · rot, wenn der nächste auch darunter schließt (${clockText(closeAt, timeZone)})`;

/** `unter 1D-EMA 200 (75.167, −3,1 %)` / `über 1D-EMA 200 (75.167, +8,2 %)` */
export const ema200Text = (above: boolean, ema: number, dist: number): string => `${above ? "über" : "unter"} 1D-EMA 200 (${n0(ema)}, ${pct(dist)})`;

/** Method of the "Details" panel: rules, backtest (honest numbers), limits. */
export const LAGE_METHOD = {
  ruleTitle: "So entscheidet die Ampel",
  rules: [
    { tone: "red", title: "Rot · fällt noch", text: "Die letzten 2 Tagesschlüsse lagen unter der 1D-EMA 21 und kein Umkehr-Zeichen ist an." },
    { tone: "amber", title: "Gelb · Umkehr bildet sich", text: "Tagestrend noch abwärts, aber mindestens eines der 4 Umkehr-Zeichen auf 4H ist an." },
    { tone: "green", title: "Grün · zählt", text: "Kein Abwärtstrend: der erste Tagesschluss über der 1D-EMA 21 beendet ihn. In den ersten 3 Tagen danach „Umkehr bestätigt“." },
  ],
  signsTitle: "Umkehr-Zeichen (nur im Abwärtstrend)",
  signs: [
    "U1 Kurs über der 1D-EMA 21 (zählt erst mit dem Tagesschluss als Trendwende)",
    "U2 letzter 4H-Schluss über der 4H-EMA 21",
    "U3 4H-EMA 21 über der 4H-EMA 50",
    "U4 interne 4H-Struktur aufwärts (letzter Bruch nach oben, LuxAlgo SMC)",
  ],
  effect:
    "Wirkung (Einstellung „Sperre“): Kaufsignale des Einstiegs-Checks zählen nur bei Grün. Bei Gelb und Rot bleibt das Signal sichtbar, aber blass („zählt nicht“) und meldet nichts. „Nur Warnung“ lässt sie zählen.",
  data: "Daten: geschlossene Tageskerzen (00:00 UTC) und 4H-Kerzen von Binance; der Live-Kurs nur für U1 und die Abstände. EMA-Leiter 1D/4H 21/50/200, Widerstände/Supports aus der Marktstruktur (LuxAlgo SMC, 4H und 1D).",
  backtestTitle: "Geprüft an der Historie",
  backtest: [
    "BTCUSDT, 24.03.–08.10.2026, 196 bestätigte Long-Einstiege des Checks (30m-Basis). „Messer“ = erst −3 %, dann +3 % (7 Tage).",
    "Ohne Filter: 39 % Messer, Ø +0,25 % nach 72 h.",
    "Grün: 109 Einstiege · 17 % Messer · Ø +1,36 % nach 72 h.",
    "Gelb: 14 · 50 % Messer.  Rot: 73 · 67 % Messer · Ø −1,33 % nach 72 h.",
  ],
  caveatsTitle: "Grenzen",
  caveats: [
    "Kleine Stichprobe (6,5 Monate); der Effekt stammt vor allem aus einem Abwärtstrend (17.05.–03.07.).",
    "Spot statt Perp, ohne Gebühren und Funding; Top-Trader-Daten gibt es historisch nicht.",
    "Grün kommt nach einem Tief im Schnitt ≈ 3 Tage bzw. +8 % später. Auch grüne Einstiege waren zu 17 % Messer.",
    "Die erste Welle aus einem Hoch fängt kein Trendfilter ab – die Ampel schützt davor, immer wieder in einen fallenden Trend zu kaufen.",
  ],
  fixed: "Kein Regler, feste Logik: die Regel wurde an der Historie geprüft, nicht auf eine gewünschte Signalhäufigkeit eingestellt.",
} as const;
