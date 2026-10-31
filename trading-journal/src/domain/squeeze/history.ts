/**
 * Squeeze observation (F07), the sample: how often the SAME observation held earlier in the archive and what the price did
 * afterwards. Consecutive samples with the observation on the same side form one episode (counted once); what followed is
 * the mark price change from the episode's first sample to a fixed time later, read from the archive – an episode without a
 * price at the end (the horizon has not passed, or the app was closed then) has no outcome and is not counted. The change is
 * given „in favour of the crowd“: for a crowded long side a rising price is positive, for a crowded short side a falling one.
 * Counter-examples are counted, not hidden. Nothing is estimated; the archive starts empty, so the sample starts at zero.
 * Pure.
 */
import type { SqueezeCfg } from "./config";
import { nearestWithin, readingAt } from "./evaluate";
import type { SqueezeData, SqueezeSide } from "./types";

const MIN = 60_000;
const HOUR = 60 * MIN;
/** Two samples further apart than this do not belong to one episode (the longest tick interval is 15 minutes). */
export const EPISODE_STEP_MS = 40 * MIN;
export const HORIZONS = [4, 24] as const;
export type Horizon = (typeof HORIZONS)[number];

export interface Episode {
  side: SqueezeSide;
  /** first and last sample (ms) */
  start: number;
  end: number;
  samples: number;
  mark0: number | null;
  /** price change in favour of the crowd as a fraction, per horizon; `null` = no price then */
  edge: Readonly<Record<Horizon, number | null>>;
}

/** Earlier episodes of the observation (ascending by start). */
export function findEpisodes(data: SqueezeData, cfg: SqueezeCfg): Episode[] {
  const out: Episode[] = [];
  const prem = data.premium;
  let cur: { side: SqueezeSide; start: number; end: number; samples: number; mark0: number | null } | null = null;
  const flush = () => {
    if (!cur) return;
    const c = cur;
    const edge = Object.fromEntries(
      HORIZONS.map((h) => {
        const target = c.start + h * HOUR;
        const p = c.mark0 && c.mark0 > 0 ? nearestWithin(prem as readonly { t: number; mark: number | null }[], target, Math.max(15 * MIN, h * HOUR * 0.1)) : null;
        const end = prem.length ? prem[prem.length - 1]!.t : 0;
        if (!p || p.mark === null || !(p.mark > 0) || target > end + 15 * MIN) return [h, null];
        const move = p.mark / c.mark0! - 1;
        return [h, c.side === "long" ? move : -move];
      }),
    ) as Record<Horizon, number | null>;
    out.push({ ...c, edge });
    cur = null;
  };
  for (const p of prem) {
    const r = readingAt(data, cfg, p);
    const side = r.state === "watch" ? r.side : null;
    if (cur && side === cur.side && p.t - cur.end <= EPISODE_STEP_MS) {
      cur.end = p.t;
      cur.samples += 1;
      continue;
    }
    flush();
    if (side) cur = { side, start: p.t, end: p.t, samples: 1, mark0: p.mark };
  }
  flush();
  return out;
}

export type SampleWord = "keine" | "zu wenig" | "dünn" | "tragfähig";
/** The same words as the Signalbilanz: under 5 „zu wenig“, under 10 „dünn“, else „tragfähig“. */
export const sampleWord = (n: number): SampleWord => (n <= 0 ? "keine" : n < 5 ? "zu wenig" : n < 10 ? "dünn" : "tragfähig");

export interface HorizonStats {
  hours: Horizon;
  /** episodes with a price at the end */
  n: number;
  /** of those: the price went against the crowd (edge < 0) / with it (edge ≥ 0) */
  against: number;
  withCrowd: number;
  median: number | null;
  min: number | null;
  max: number | null;
  word: SampleWord;
}

const median = (xs: readonly number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/** Counts and spread of what followed, for episodes of `side` (or both when `null`). */
export function summarize(episodes: readonly Episode[], hours: Horizon, side: SqueezeSide | null = null): HorizonStats {
  const xs = episodes.filter((e) => (side ? e.side === side : true)).map((e) => e.edge[hours]).filter((v): v is number => v !== null);
  return {
    hours,
    n: xs.length,
    against: xs.filter((v) => v < 0).length,
    withCrowd: xs.filter((v) => v >= 0).length,
    median: median(xs),
    min: xs.length ? Math.min(...xs) : null,
    max: xs.length ? Math.max(...xs) : null,
    word: sampleWord(xs.length),
  };
}

/** Hours the archive covers (first to last premium sample), 0 without data. */
export function coverageHours(data: SqueezeData): number {
  const p = data.premium;
  return p.length > 1 ? (p[p.length - 1]!.t - p[0]!.t) / HOUR : 0;
}
