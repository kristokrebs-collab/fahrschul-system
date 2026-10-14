/**
 * Pure view helpers of the Lage panel (`LagePanel.tsx`): ladder columns split at the price with aligned price rows,
 * countdown / feed texts, tones. No React.
 */
import { clockText, dayText, LAGE_MEANING, LAGE_MEANING_WARN, LAGE_OFF_TEXT, type Lage, type LageEma, type LageLevel, type LageSettings, type LageState, type LageTone } from "@/domain/lage";
import type { LageFeedStatus } from "@/market";

export type LightTone = "win" | "warn" | "loss" | "mute";
export const STATE_TONE: Readonly<Record<LageState, LightTone>> = { green: "win", amber: "warn", red: "loss", none: "mute" };

export interface LadderColumn<T> {
  /** rows above the price, highest first */
  above: T[];
  /** rows at / below the price, highest first */
  below: T[];
}

/** EMA ladder split at the price (the domain sorts it highest first). */
export function emaColumn(l: Pick<Lage, "emaLadder" | "price">): LadderColumn<LageEma> {
  const p = l.price;
  if (p == null) return { above: l.emaLadder.slice(), below: [] };
  return { above: l.emaLadder.filter((e) => e.value > p), below: l.emaLadder.filter((e) => e.value <= p) };
}

/** Levels per side the panel shows: at least 1, at most 4. */
export const LEVEL_ROWS = { min: 1, max: 4 } as const;

/**
 * The nearest resistances (shown highest first) and supports (nearest first). With `fit` (the EMA column) each side
 * shows as many levels as the EMA column has rows on that side (1 … 4, as far as there are levels), so both columns
 * fill the same rows and their price rows line up without empty spacers.
 */
export function levelColumn(l: Pick<Lage, "levels">, fit?: LadderColumn<unknown>): LadderColumn<LageLevel> {
  const n = (rows: number | undefined): number => Math.min(LEVEL_ROWS.max, Math.max(LEVEL_ROWS.min, rows ?? 2));
  return { above: l.levels.resistances.slice(0, n(fit?.above.length)).reverse(), below: l.levels.supports.slice(0, n(fit?.below.length)) };
}

/** Spacer rows that put both columns' price rows on the same line and end them together. */
export function alignPad(a: LadderColumn<unknown>, b: LadderColumn<unknown>): { aTop: number; bTop: number; aBottom: number; bBottom: number } {
  const top = Math.max(a.above.length, b.above.length);
  const bottom = Math.max(a.below.length, b.below.length);
  return { aTop: top - a.above.length, bTop: top - b.above.length, aBottom: bottom - a.below.length, bBottom: bottom - b.below.length };
}

/** `8:29 h` · `12 min` · `< 1 min` (duration, never a clock time). */
export function closeInText(ms: number): string {
  if (!(ms > 0)) return "< 1 min";
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "< 1 min";
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")} h`;
}

/** One line under the headline: what the state means under the user's setting, and since when. */
export function meaningText(l: Pick<Lage, "state" | "since">, s: LageSettings, timeZone?: string): string {
  if (!s.on) return LAGE_OFF_TEXT;
  const base = (s.mode === "warn" ? LAGE_MEANING_WARN : LAGE_MEANING)[l.state];
  if (l.state === "none" || l.since == null) return base;
  const what = l.state === "green" ? "Grün" : "Abwärtstrend";
  return `${base} ${what} seit ${dayText(l.since, timeZone)}`;
}

/** Feed line: `Tageskerzen Binance · Stand 15:32`, the failure with the next try, or the loading text. */
export function feedText(s: LageFeedStatus, timeZone?: string): { text: string; tone: "mute" | "warn" } {
  const src = s.source === "bybit" ? "Bybit" : s.source === "proxy" ? "Binance (EU-Proxy)" : "Binance";
  const stand = s.fetchedAt != null ? `Stand ${clockText(s.fetchedAt, timeZone)}` : null;
  const next = s.nextAt != null ? `nächster Versuch ${clockText(s.nextAt, timeZone)}` : null;
  switch (s.state) {
    case "idle":
      return { text: "Marktdaten aus", tone: "mute" };
    case "loading":
      return { text: "Tageskerzen werden geladen …", tone: "mute" };
    case "offline":
      return { text: ["Offline", stand].filter(Boolean).join(" · "), tone: "warn" };
    case "error":
      return { text: [s.detail ?? "Tageskerzen nicht erreichbar", next].filter(Boolean).join(" · "), tone: "warn" };
    case "stale":
      return { text: [s.detail, stand, s.detail && s.detail.startsWith("Tagesschluss") ? null : next].filter(Boolean).join(" · "), tone: "warn" };
    default:
      return { text: [`Tageskerzen ${src}`, stand].filter(Boolean).join(" · "), tone: "mute" };
  }
}

/**
 * Keeps values together in a wrapping chip: a number with its unit and sign (`−2,4 %`), and a short value group in
 * parentheses (`(83.381, −2,4 %)`) — a narrow chip breaks before the group, never inside it.
 */
export const keepTogether = (text: string): string =>
  text
    .replace(/\(([^()]{1,24})\)/g, (m) => m.replace(/ /g, "\u00a0"))
    .replace(/(\d) %/g, "$1\u00a0%")
    .replace(/([\u2212+]) (?=\d)/g, "$1\u00a0");

export const CHIP_DOT: Readonly<Record<LageTone, string>> = { neg: "bg-loss", pos: "bg-win", warn: "bg-warn", info: "bg-faint" };
