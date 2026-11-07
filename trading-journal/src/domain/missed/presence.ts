/**
 * Presence trace as data (F27): segments in which the app was running, merged and read as a share of a window, with the breaks
 * („App war zu“) inside it. Pure; the beat itself is `src/market/presence.ts`. Kept apart from `quality.ts` so the always-loaded
 * host does not pull the statistics code.
 */
export const PRESENCE_GAP_MS = 150_000;
/** A break shorter than this is a reload or a short sleep and is not listed as an outage. */
export const OUTAGE_MIN_MS = 10 * 60_000;
export const OUTAGES_SHOWN = 8;
export const QUALITY_WINDOW_MS = 30 * 86_400_000;

export interface PresenceSeg {
  a: number;
  b: number;
}

export interface Outage {
  from: number;
  to: number;
  ms: number;
}

export interface PresenceReport {
  /** the trace has at least one beat */
  known: boolean;
  /** first beat inside the window (ms), `null` = unknown */
  since: number | null;
  /** observed span (since … now) and the time inside it the app was running */
  spanMs: number;
  openMs: number;
  /** open ÷ span, `null` = unknown */
  share: number | null;
  /** breaks of at least `OUTAGE_MIN_MS` inside the span, newest first (≤ `OUTAGES_SHOWN`) */
  outages: Outage[];
  outageCount: number;
  outageMs: number;
  /** the app is running right now (the last beat is recent) */
  running: boolean;
}

/** Sorted, merged segments (beats closer than `PRESENCE_GAP_MS` belong together). */
export function mergeSegments(segs: readonly PresenceSeg[], gap: number = PRESENCE_GAP_MS): PresenceSeg[] {
  const s = segs
    .filter((x) => Number.isFinite(x.a) && Number.isFinite(x.b) && x.b >= x.a)
    .map((x) => ({ a: x.a, b: x.b }))
    .sort((p, q) => p.a - q.a);
  const out: PresenceSeg[] = [];
  for (const x of s) {
    const last = out[out.length - 1];
    if (last && x.a - last.b <= gap) last.b = Math.max(last.b, x.b);
    else out.push(x);
  }
  return out;
}

/** The share of the last `windowMs` the app was running, and the breaks inside it. */
export function presenceReport(segs: readonly PresenceSeg[], now: number, windowMs: number = QUALITY_WINDOW_MS): PresenceReport {
  const merged = mergeSegments(segs);
  const from = now - windowMs;
  const inside = merged.filter((x) => x.b >= from).map((x) => ({ a: Math.max(x.a, from), b: Math.min(x.b, now) }));
  if (!inside.length) return { known: false, since: null, spanMs: 0, openMs: 0, share: null, outages: [], outageCount: 0, outageMs: 0, running: false };
  const since = inside[0]!.a;
  const spanMs = Math.max(0, now - since);
  const openMs = inside.reduce((s, x) => s + (x.b - x.a), 0);
  const breaks: Outage[] = [];
  for (let i = 1; i < inside.length; i++) breaks.push({ from: inside[i - 1]!.b, to: inside[i]!.a, ms: inside[i]!.a - inside[i - 1]!.b });
  const last = inside[inside.length - 1]!;
  const running = now - last.b <= PRESENCE_GAP_MS;
  if (!running) breaks.push({ from: last.b, to: now, ms: now - last.b });
  const outages = breaks.filter((x) => x.ms >= OUTAGE_MIN_MS).sort((p, q) => q.from - p.from);
  return {
    known: true,
    since,
    spanMs,
    openMs,
    share: spanMs > 0 ? Math.min(1, openMs / spanMs) : null,
    outages: outages.slice(0, OUTAGES_SHOWN),
    outageCount: outages.length,
    outageMs: outages.reduce((s, x) => s + x.ms, 0),
    running,
  };
}

