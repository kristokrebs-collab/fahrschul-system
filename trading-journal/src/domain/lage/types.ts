/**
 * Types of the "Lage-Ampel" (decision 23, knife-lab REPORT § RECOMMENDATION): the higher-timeframe context that
 * decides whether a long entry of the Einstiegs-Check counts. Pure data, no React.
 */
import type { Bar } from "../signals/indicators";
import type { LevelKind, StructureCfg } from "../signals/structure";

/** `none` = too few daily bars (no gate, "keine Daten"). */
export type LageState = "red" | "amber" | "green" | "none";

/** The four 4H reversal signs, read only while the daily trend is down (`abwaerts`). */
export type LageSignId = "U1" | "U2" | "U3" | "U4";

export interface LageSign {
  id: LageSignId;
  /** German label, e.g. `Kurs über 1D-EMA 21` */
  label: string;
  /** `null` = no data for it (4H series missing) */
  met: boolean | null;
  /** values behind it, e.g. `81.356 · EMA 83.381 (−2,4 %)` */
  detail: string;
}

/** `neg` = speaks against an entry, `pos` = for it, `warn` = caution in a green phase, `info` = context. */
export type LageTone = "neg" | "pos" | "warn" | "info";

export interface LageChip {
  id: string;
  text: string;
  tone: LageTone;
}

export interface LageEma {
  /** `1D-21`, `4H-50`, … */
  id: string;
  tf: "1D" | "4H";
  len: 21 | 50 | 200;
  /** `1D-EMA 21` */
  label: string;
  value: number;
  /** price / value − 1 (+ = the price is above the EMA) */
  dist: number;
}

export interface LageLevel {
  /** stable key: `4H:ob:81330` */
  id: string;
  tf: "4H" | "1D";
  /** side as the live price sees it: below = support, above = resistance (a support the price fell through reads as resistance; `label` keeps its origin) */
  side: "support" | "resistance";
  kind: LevelKind;
  /** `4H Demand-OB`, `1D Internes Hoch` */
  label: string;
  /** the edge facing the price */
  price: number;
  top: number;
  btm: number;
  /** level / price − 1 (signed) */
  dist: number;
  /** |level − price| in ATR 14 of the 4H series (1D ATR without 4H data) */
  distAtr: number;
}

export interface LageDaily {
  /** open time of the last CLOSED daily bar (ms) */
  at: number;
  /** its close time = open + 1 day (ms) */
  closeAt: number;
  close: number;
  ema21: number;
  ema50: number;
  /** `null` with fewer than 200 daily bars */
  ema200: number | null;
  /** close / EMA 21 − 1 at that close */
  dist21: number;
  /** consecutive daily closes below the EMA 21, ending at the last closed bar (0 = the last close is above) */
  below: number;
}

export interface LageH4 {
  /** open time of the last CLOSED 4H bar (ms) */
  at: number;
  closeAt: number;
  close: number;
  ema21: number;
  ema50: number;
  ema200: number | null;
  /** EMA 21 above EMA 50 */
  cross: boolean;
  /** swing / internal structure trend (LuxAlgo, closed bars): 1 up, −1 down, 0 none yet */
  trend: -1 | 0 | 1;
  itrend: -1 | 0 | 1;
  atr: number;
}

export interface LageData {
  /** closed bars used */
  daily: number;
  h4: number;
  h1: number;
  /** enough daily bars for the gate (`LAGE_MIN_DAILY`) */
  ok: boolean;
  /** daily EMA 200 is meaningful (≥ 200 bars) */
  ema200: boolean;
  /** a live price was given (else the newest close stands in) */
  live: boolean;
}

export interface Lage {
  state: LageState;
  /** headline: `Fällt noch · abwarten` · `Umkehr bildet sich · 2 von 4` · `Umkehr bestätigt` · `Aufwärtstrend intakt` · `Keine Daten` */
  title: string;
  /** when the current daily-trend phase began (the daily close that started it, ms); `null` = before the data */
  since: number | null;
  /** green within `LAGE_CONFIRM_DAYS` after a red phase ("Umkehr bestätigt") */
  confirmed: boolean;
  /** the last two daily closes below the 1D-EMA 21 */
  abwaerts: boolean;
  /** last close below / the one before below */
  unter1: boolean;
  unter2: boolean;
  /** U1 … U4 (always computed; they only decide the state while `abwaerts`) */
  signs: LageSign[];
  /** met signs (0 … 4) */
  signsMet: number;
  /** chips with values, most important first (see `computeLage`) */
  reasons: LageChip[];
  /** `Trend wackelt: …` in a green phase after the first close below, else `null` */
  wobble: LageChip | null;
  /** 1D + 4H EMA 21 / 50 / 200, highest first */
  emaLadder: LageEma[];
  /** nearest first; the 2 nearest supports + 2 resistances of the 4H structure and of the 1D structure (1D ones next to a 4H level dropped), split by the live price */
  levels: { resistances: LageLevel[]; supports: LageLevel[] };
  daily: LageDaily | null;
  h4: LageH4 | null;
  /** new 20-bar low on the last three closed 1H bars (`null` without 1H bars) */
  newLow1h: boolean | null;
  /** price the distances use (live price, else the newest close) */
  price: number | null;
  /** 1D-EMA 21 at the last close and the price's distance to it (snapshot fields) */
  ema21_1d: number | null;
  dist: number | null;
  /** next daily close, 00:00 UTC (ms) */
  dailyCloseAt: number;
  /** evaluation time (ms) */
  at: number;
  data: LageData;
}

export interface LageOptions {
  /** 1H bars for the "neues 20-Kerzen-Tief (1H)" chip (closed bars are picked here) */
  h1?: readonly Bar[] | null;
  /** structure options (defaults: swing 50, internal 5, eqLen 3, eqThreshold 0.1, no range levels) */
  structure?: Partial<StructureCfg>;
  /** IANA zone for clock times in the texts (default: the device's) */
  timeZone?: string;
}

/** User setting `settings.signals.lage` (Einstellungen → Lage-Ampel). */
export interface LageSettings {
  on: boolean;
  /** `block` = entries count only on green (default), `warn` = they count, the panel and the ladder warn */
  mode: "block" | "warn";
}

/** Phase-2 gate result for an entry signal. */
export interface LageGate {
  state: LageState;
  /** the entry counts (valid, notifies) */
  counts: boolean;
  /** the entry is held back by the Lage (gate on, mode `block`, red or amber) */
  blocked: boolean;
  /** short reason for the ladder / verdict, `null` when nothing is to be said (green, off, no data) */
  label: string | null;
}

/** Stored on trades (phase 2): `trade.signal.lage`. */
export interface LageSnapshot {
  state: LageState;
  /** ids of the met reversal signs */
  signs: LageSignId[];
  ema21_1d: number | null;
  dist: number | null;
}
