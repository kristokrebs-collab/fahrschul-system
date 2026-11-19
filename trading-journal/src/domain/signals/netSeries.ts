/**
 * The Top-Trader net card, pure parts that sit around the net logic of `traderNet.ts` (C3 – Wal-Karte): the two series the card
 * can show, the stored history (what is kept, how it joins the live series), and the gaps.
 *
 * - Two series of the SAME Binance cohort, counted differently: by POSITION size (`topLongShortPositionRatio`, the long share of
 *   the money in the positions) and by ACCOUNT (`topLongShortAccountRatio`, the share of accounts that are long). Neither is
 *   "Wale" and neither is on-chain; the card says so next to the numbers.
 * - The stored history ("Archiv") keeps one point per hour (or per period when it is longer than an hour) of what the card has
 *   shown, for up to 180 days. It grows while the card is used; nothing is estimated. A stretch with no point is a GAP and stays
 *   one: the plot breaks the line there, shades the stretch and says so in the readout – nothing is interpolated.
 * - A gap is a distance of more than `NET_GAP_FACTOR` × the larger spacing of its two neighbours.
 */
import { netDayText, type NetPoint } from "./traderNet";

export type NetSeriesId = "position" | "account";
export const NET_SERIES_IDS: readonly NetSeriesId[] = ["position", "account"];
export const isNetSeriesId = (v: unknown): v is NetSeriesId => v === "position" || v === "account";

export interface NetSeriesInfo {
  id: NetSeriesId;
  /** label of the switch */
  label: string;
  /** the subject of the headline sentence */
  who: string;
  /** the public Binance statistic it comes from */
  endpoint: string;
  /** who is counted */
  cohort: string;
  /** what the number is a share of */
  measure: string;
}

export const NET_SERIES: Readonly<Record<NetSeriesId, NetSeriesInfo>> = {
  position: {
    id: "position",
    label: "Positionen",
    who: "Top-Trader (Binance)",
    endpoint: "topLongShortPositionRatio",
    cohort: "obere 20 % der Konten nach Einsatz",
    measure: "Long-Anteil der Positionsgrößen",
  },
  account: {
    id: "account",
    label: "Konten",
    who: "Top-Trader (Binance, nach Konten)",
    endpoint: "topLongShortAccountRatio",
    cohort: "obere 20 % der Konten nach Einsatz",
    measure: "Anteil der Konten mit Long-Position",
  },
};

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/* ------------------------------------------------------------------------------------------------ stored history */

/** One stored point: the long share, the price the card showed with it (or `null`) and the spacing it stands for. */
export interface ArchivedNetPoint {
  t: number;
  /** long share, percent (0 … 100) */
  long: number;
  price: number | null;
  /** spacing (ms) */
  s: number;
}

/** The longest history that is kept. Older points are removed when the card stores new ones. */
export const ARCHIVE_KEEP_MS = 180 * DAY;
/** The finest spacing of the stored history. */
export const ARCHIVE_GRID_MS = HOUR;

/** The spacing the stored history has for a live series with this spacing. */
export const archiveStepOf = (liveStepMs: number): number => Math.max(ARCHIVE_GRID_MS, Number.isFinite(liveStepMs) && liveStepMs > 0 ? liveStepMs : ARCHIVE_GRID_MS);

/** The live points that go into the stored history: those on the hour grid (every point when the period is an hour or more). */
export function pointsForArchive(points: readonly NetPoint[], liveStepMs: number): ArchivedNetPoint[] {
  const s = archiveStepOf(liveStepMs);
  const out: ArchivedNetPoint[] = [];
  for (const p of points) {
    if (!Number.isFinite(p.t) || !Number.isFinite(p.longPct) || p.longPct < 0 || p.longPct > 100) continue;
    if (p.t % ARCHIVE_GRID_MS !== 0) continue;
    out.push({ t: p.t, long: p.longPct, price: p.price !== null && Number.isFinite(p.price) ? p.price : null, s });
  }
  return out;
}

/** A stored point as a net point (the net of a stored point comes from the long share alone: `2 · long − 100`). */
export const archivedToNet = (a: ArchivedNetPoint): NetPoint => ({ t: a.t, net: 2 * a.long - 100, longPct: a.long, price: a.price, s: a.s });

/** Tolerant read of a stored row (anything odd is dropped). */
export function archivedOf(raw: unknown): ArchivedNetPoint | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const t = r.t;
  const l = r.l;
  const p = r.p;
  const s = r.s;
  if (typeof t !== "number" || !Number.isFinite(t) || typeof l !== "number" || !Number.isFinite(l) || l < 0 || l > 100) return null;
  return { t, long: l, price: typeof p === "number" && Number.isFinite(p) ? p : null, s: typeof s === "number" && Number.isFinite(s) && s >= ARCHIVE_GRID_MS ? s : ARCHIVE_GRID_MS };
}

/**
 * The live series with the stored history in front of it: stored points count only where the live series does not reach
 * (older than its first point). Oldest first, every point carries the spacing it stands for.
 */
export function mergeNetPoints(archived: readonly ArchivedNetPoint[], live: readonly NetPoint[], liveStepMs: number): NetPoint[] {
  const liveSorted = [...live].sort((a, b) => a.t - b.t);
  const from = liveSorted.length ? liveSorted[0]!.t : Infinity;
  const old = archived
    .filter((a) => a.t < from)
    .sort((a, b) => a.t - b.t)
    .map(archivedToNet);
  const step = Number.isFinite(liveStepMs) && liveStepMs > 0 ? liveStepMs : ARCHIVE_GRID_MS;
  return [...old, ...liveSorted.map((p) => ({ ...p, s: p.s ?? step }))];
}

/* ------------------------------------------------------------------------------------------------ gaps */

export const NET_GAP_FACTOR = 2.5;

export interface NetGap {
  /** the last point before the gap / the first point after it (ms) */
  from: number;
  to: number;
  /** index of the point before the gap in the series it was found in */
  index: number;
}

/** The gaps of an ordered series: neighbours further apart than `NET_GAP_FACTOR` × the larger of their two spacings. */
export function findNetGaps(points: readonly NetPoint[], defaultStepMs: number): NetGap[] {
  const out: NetGap[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const step = Math.max(a.s ?? defaultStepMs, b.s ?? defaultStepMs);
    if (b.t - a.t > NET_GAP_FACTOR * step) out.push({ from: a.t, to: b.t, index: i - 1 });
  }
  return out;
}

/** The newest run without a gap. */
export function latestRun(points: readonly NetPoint[], gaps: readonly NetGap[]): NetPoint[] {
  const last = gaps[gaps.length - 1];
  return last ? points.slice(last.index + 1) : points.slice();
}

/** The runs between the gaps (a single run when there is no gap). */
export function runsOf(points: readonly NetPoint[], gaps: readonly NetGap[]): NetPoint[][] {
  const out: NetPoint[][] = [];
  let from = 0;
  for (const g of gaps) {
    out.push(points.slice(from, g.index + 1));
    from = g.index + 1;
  }
  out.push(points.slice(from));
  return out.filter((r) => r.length > 0);
}

/** The gaps that touch a time range `[a, b]`. */
export const gapsIn = (gaps: readonly NetGap[], a: number, b: number): NetGap[] => gaps.filter((g) => g.to >= a && g.from <= b);

const hhmm = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: "UTC", hourCycle: "h23" });
/** `28.10. 14:00` – a UTC time for a readout line. */
export const netStampText = (t: number): string => `${netDayText(t)} ${hhmm.format(new Date(t))}`;

/** Readout of a gap: `Lücke 28.10. 14:00 – 30.10. 02:00 UTC · 36 Std. ohne Messwerte`. */
export function gapText(g: Pick<NetGap, "from" | "to">): string {
  const h = Math.round((g.to - g.from) / HOUR);
  const len = h >= 48 ? `${Math.floor(h / 24)} Tage` : `${h} Std.`;
  return `Lücke ${netStampText(g.from)} – ${netStampText(g.to)} UTC · ${len} ohne Messwerte`;
}

/* ------------------------------------------------------------------------------------------------ export */

const iso = (t: number): string => new Date(t).toISOString();

/**
 * CSV of a series exactly as shown: UTC time, long share, net, price, where the point comes from. Gaps are NOT filled – a gap
 * is a missing row; the list of gaps follows as comment lines.
 */
export function netPointsToCsv(points: readonly NetPoint[], gaps: readonly NetGap[], liveFrom: number | null): string {
  const lines = ["zeit_utc,long_prozent,netto_punkte,preis,herkunft"];
  for (const p of points) {
    const from = liveFrom !== null && p.t >= liveFrom ? "geladen" : "gespeichert";
    lines.push([iso(p.t), p.longPct.toFixed(2), p.net.toFixed(2), p.price === null ? "" : String(p.price), from].join(","));
  }
  for (const g of gaps) lines.push(`# Lücke ohne Messwerte: ${iso(g.from)} bis ${iso(g.to)}`);
  return lines.join("\n") + "\n";
}
