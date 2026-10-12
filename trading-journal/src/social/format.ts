/**
 * German number / label formatting of the community (P12) – PURE and alias-free (the functions build share titles
 * with it). U+2212 minus like the rest of the app.
 */
import type { SharePayload } from "./contract";
import type { SocialMetric, StatMetric } from "./metrics";

const de = (v: number, d: number) => Math.abs(v).toLocaleString("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d });
const sign = (v: number) => (v > 0 ? "+" : v < 0 ? "−" : "");

/** "+2,10R" · "−0,40R" · "–" */
export function fmtR(v: number | null | undefined, d = 2): string {
  return v == null || !Number.isFinite(v) ? "–" : `${sign(v)}${de(v, d)}R`;
}

/** "64 %" (unsigned) · "–" */
export function fmtPct(v: number | null | undefined, d = 0): string {
  return v == null || !Number.isFinite(v) ? "–" : `${de(v, d)} %`;
}

/** "+3,4 %" (signed move) · "–" */
export function fmtMove(v: number | null | undefined, d = 1): string {
  return v == null || !Number.isFinite(v) ? "–" : `${sign(v)}${de(v, d)} %`;
}

export const METRIC_LABEL: Readonly<Record<SocialMetric | StatMetric, string>> = {
  expectancy: "Erwartung",
  discipline: "Disziplin",
  consistency: "Konsistenz",
  winrate: "Trefferquote",
};

/** What the metric means, one short German sentence. */
export const METRIC_HINT: Readonly<Record<SocialMetric | StatMetric, string>> = {
  expectancy: "Ø R pro Trade, 90 Tage.",
  discipline: "Trades nach Plan und ohne Fehler.",
  consistency: "Anteil grüner Wochen.",
  winrate: "Anteil der Trades über 0 R.",
};

/** A metric's value as text ("+0,42R", "78 %"). */
export function metricText(metric: SocialMetric | StatMetric, v: number | null | undefined): string {
  return metric === "expectancy" ? fmtR(v) : fmtPct(v);
}

/** The value in dot-matrix spelling (no unit glyphs that the matrix lacks): "+0,42" / "78%". */
export function metricMatrix(metric: SocialMetric | StatMetric, v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "--";
  return metric === "expectancy" ? `${v > 0 ? "+" : v < 0 ? "-" : ""}${de(v, 2)}` : `${Math.round(v)}%`;
}

const SIDE = { long: "Long", short: "Short" } as const;

/** Short label of a shared payload ("BTCUSDT Long · +2,10R", "Setup · Breakout", "90 Tage · +0,42R"). */
export function shareTitle(p: SharePayload): string {
  switch (p.kind) {
    case "trade":
      return `${p.pair === "-" ? "Trade" : p.pair} ${SIDE[p.side]} · ${p.r != null ? fmtR(p.r) : p.movePct != null ? fmtMove(p.movePct) : p.result === "open" ? "offen" : "–"}`;
    case "setup":
      return `Setup · ${p.name}`;
    case "stats":
      return `${p.windowDays} Tage · ${fmtR(p.expectancyR)}`;
  }
}
