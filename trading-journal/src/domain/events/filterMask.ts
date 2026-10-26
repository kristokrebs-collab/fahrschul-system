/**
 * Labor filter "Keine Einstiege X Minuten vor/nach einem Termin" (F43): the yes / no per signal candle that the filter
 * comparison (`@/domain/lab/filters`) needs. The entry of a signal at the close of bar `i` happens at the OPEN of the next
 * bar, `bars[i].t + execSec`; that instant must not lie within `minutes` before or after an appointment of a chosen kind.
 * Only appointments that follow a rule can be blocked – they exist for every candle of any backtest: Funding grid, Deribit
 * expiry, the opening of the US stock market. FOMC dates (the list ends in 2027) and the trader's own entries are no filter
 * kinds; the lab says so instead of blocking only part of the history.
 *
 * Pure and deterministic; the windows are computed once for the time range of the bars and swept with the bars.
 */
import { PASS, FAIL, type SideMask } from "../lab/filters/masks";
import type { EventFilterKind } from "./filterKinds";
import { expiryEvents, fundingEvents } from "./rules";
import { usEvents } from "./usEvents";
import { MINUTE } from "./types";

/** Merged `[start, end]` windows (ms UTC, both ends blocked) around the appointments in `[from, to]`. */
export function blockedWindows(from: number, to: number, minutes: number, kinds: readonly EventFilterKind[]): [number, number][] {
  const pad = minutes * MINUTE;
  const lo = from - pad - 1;
  const hi = to + pad + 1;
  const times: number[] = [];
  if (kinds.includes("funding")) for (const e of fundingEvents(lo, hi)) times.push(e.at);
  if (kinds.includes("expiry")) for (const e of expiryEvents(lo, hi)) times.push(e.at);
  if (kinds.includes("usOpen")) for (const e of usEvents(lo, hi)) if (e.kind === "usOpen") times.push(e.at);
  times.sort((a, b) => a - b);
  const out: [number, number][] = [];
  for (const t of times) {
    const last = out[out.length - 1];
    if (last && t - pad <= last[1]) last[1] = Math.max(last[1], t + pad);
    else out.push([t - pad, t + pad]);
  }
  return out;
}

/** Is `ms` inside one of the (sorted, merged) windows? */
export function inWindows(windows: readonly [number, number][], ms: number): boolean {
  let lo = 0;
  let hi = windows.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const w = windows[mid]!;
    if (ms < w[0]) hi = mid - 1;
    else if (ms > w[1]) lo = mid + 1;
    else return true;
  }
  return false;
}

/** Per signal candle: PASS when the entry at the next open is outside every window, FAIL inside. Never unknown. */
export function eventMask(bars: readonly { t: number }[], execSec: number, minutes: number, kinds: readonly EventFilterKind[]): SideMask {
  const n = bars.length;
  const long = new Uint8Array(n).fill(PASS);
  const short = new Uint8Array(n).fill(PASS);
  if (!n || !kinds.length) return { long, short };
  const first = bars[0]!.t * 1000;
  const last = (bars[n - 1]!.t + execSec) * 1000;
  const windows = blockedWindows(first, last, minutes, kinds);
  for (let i = 0; i < n; i++) {
    if (inWindows(windows, (bars[i]!.t + execSec) * 1000)) {
      long[i] = FAIL;
      short[i] = FAIL;
    }
  }
  return { long, short };
}
