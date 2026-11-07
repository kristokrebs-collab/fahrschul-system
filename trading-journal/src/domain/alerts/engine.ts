/**
 * Vier Alarme (C2) – the engine: readings in, events out. Pure and deterministic: the clock and the memory are parameters,
 * nothing is read from or written to anywhere; the same inputs always give the same events and the same dedupe keys.
 *
 * Per (source, market) the engine keeps a PHASE: `green_confirm` / `red_confirm` while the source's confirmed state holds,
 * `green_warn` / `red_warn` while the market is within the warning distance of a confirming line, else `none`.
 *
 *   hysteresis   a warning starts at `distance <= warn` and ends only above `warn + hyst`; a confirmation starts at
 *                `margin >= confirm` and ends only below `confirm - hyst` – a market hovering on a line does not flicker
 *   one message  a jump straight to a confirmation fires ONE event (the confirmation), never "warning, then confirmation"
 *   order        in one cycle a warning never follows a confirmation of the same side; each event fires once per cycle
 *                (a warning is re-armed when the market recedes, a confirmation when the cycle ends)
 *   cycle        a new one starts when the market falls back to `none`, or confirms the OTHER side than the last confirmation
 *   first look   the first reading of a market sets the phase silently – switching alerts on never fires about what already is
 *   cooldown     the same event of the same market is not delivered twice within `cooldownMs` (the fire is kept, marked `suppressed`)
 *   stale        a reading older than `maxAgeMs`, or none at all, changes nothing (the market is reported in `skipped`)
 *   dedupe       `dedupKey` = account | market key | cycle | event | occurrence – a repeated run with the same memory makes the same key,
 *                and the database refuses a second row with it
 *   quiet        `quiet` marks a fire inside the user's quiet hours; WHAT happens then is the delivery's business (`delivery.ts`)
 */
import { eventOf, levelOf, sideOf, type AlertEvent, type AlertFire, type AlertMemory, type AlertMemoryMap, type AlertPhase, type AlertReading, type AlertSide, type AlertSkip, type SourceParams } from "./types";

export interface StepOptions {
  now: number;
  /** account id (part of the dedupe key) */
  userId: string;
  /** thresholds per source kind */
  params: Readonly<Record<string, SourceParams>>;
  /** cooldown in ms */
  cooldownMs: number;
  /** a reading older than this is stale, per source kind */
  maxAgeMs: Readonly<Record<string, number>>;
  /** is `ms` inside the user's quiet hours? */
  quiet(ms: number): boolean;
}

export interface StepResult {
  memory: AlertMemoryMap;
  fires: AlertFire[];
  skipped: AlertSkip[];
}

const opposite = (s: AlertSide): AlertSide => (s === "green" ? "red" : "green");

export function newMemory(phase: AlertPhase, now: number, held: AlertSide | null): AlertMemory {
  return { phase, cycle: 1, counts: {}, fired: phase === "none" ? [] : [phase], lastConfirm: held, last: {}, seen: now };
}

/**
 * The phase a reading means, given the phase before (for the hysteresis). A warning toward the OTHER side than the held state
 * wins over the held state (a market in a position that nears its stop is "red warn", not "green confirm"); a warning toward
 * the held side adds nothing and gives way to the confirmation.
 */
export function phaseOf(r: Pick<AlertReading, "held" | "margin" | "approach">, prev: AlertPhase, p: SourceParams): AlertPhase {
  let confirm: AlertPhase = "none";
  if (r.held) {
    const was = prev === eventOf(r.held, "confirm");
    if (r.margin >= (was ? p.confirm - p.hyst : p.confirm)) confirm = eventOf(r.held, "confirm");
  }
  let warn: AlertPhase = "none";
  if (r.approach) {
    const was = prev === eventOf(r.approach.side, "warn");
    if (r.approach.distance <= (was ? p.warn + p.hyst : p.warn)) warn = eventOf(r.approach.side, "warn");
  }
  if (warn !== "none" && (confirm === "none" || sideOf(warn) !== sideOf(confirm))) return warn;
  return confirm !== "none" ? confirm : warn;
}

/** Advances ONE market by one reading. `reading` must not be stale (the caller checks). */
function stepOne(userId: string, r: AlertReading, mem: AlertMemory, o: StepOptions, p: SourceParams, fires: AlertFire[]): AlertMemory {
  const phase = phaseOf(r, mem.phase, p);
  const next: AlertMemory = { ...mem, counts: { ...mem.counts }, fired: [...mem.fired], last: { ...mem.last }, seen: o.now, phase };
  const left = mem.phase !== "none" && phase === "none";

  // a warning that ended (the market receded) is armed again; a market that fell back to nothing starts a new cycle
  if (mem.phase !== "none" && levelOf(mem.phase) === "warn" && phase !== mem.phase) next.fired = next.fired.filter((e) => e !== mem.phase);
  if (left) {
    next.cycle = mem.cycle + 1;
    next.counts = {};
    next.fired = [];
  }
  if (phase === "none" || phase === mem.phase) return next;

  const event: AlertEvent = phase;
  if (levelOf(event) === "confirm" && next.lastConfirm !== null && next.lastConfirm !== sideOf(event)) {
    next.cycle += 1;
    next.counts = {};
    next.fired = [];
  }
  if (levelOf(event) === "confirm") next.lastConfirm = sideOf(event);

  // order: a warning never follows the confirmation of its own side in the same cycle; an event fires once per cycle
  const used = next.fired.includes(event) || (levelOf(event) === "warn" && next.fired.includes(eventOf(sideOf(event), "confirm")));
  if (used) return next;
  next.fired.push(event);

  const n = (next.counts[event] ?? 0) + 1;
  next.counts[event] = n;
  const lastAt = mem.last[event];
  const suppressed = lastAt !== undefined && o.now - lastAt < o.cooldownMs ? "cooldown" : null;
  if (!suppressed) next.last[event] = o.now;
  const value = levelOf(event) === "warn" ? (r.approach?.distance ?? null) : Number.isFinite(r.margin) ? r.margin : null;
  fires.push({
    dedupKey: [userId, r.key, `c${next.cycle}`, event, `n${n}`].join("|"),
    key: r.key,
    source: r.source,
    market: r.market,
    event,
    at: o.now,
    detail: r.detail ?? "",
    value,
    quiet: o.quiet(o.now),
    suppressed,
  });
  return next;
}

/** The order events leave the engine in: confirmations before warnings, then by market key – stable for every run. */
function byOrder(a: AlertFire, b: AlertFire): number {
  const lv = (e: AlertEvent): number => (levelOf(e) === "confirm" ? 0 : 1);
  return lv(a.event) - lv(b.event) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0) || (a.event < b.event ? -1 : 1);
}

/**
 * One look at all readings of an account. Markets with no reading in `readings` keep their memory untouched (a source that is
 * down does not reset anything); a reading older than its source's `maxAgeMs` counts as no reading and is listed in `skipped`.
 */
export function stepAlerts(memory: AlertMemoryMap, readings: readonly AlertReading[], o: StepOptions): StepResult {
  const out: Record<string, AlertMemory> = { ...memory };
  const fires: AlertFire[] = [];
  const skipped: AlertSkip[] = [];
  const seen = new Set<string>();
  for (const r of readings) {
    if (seen.has(r.key)) continue; // one reading per market per look
    seen.add(r.key);
    const p = o.params[r.source];
    if (!p) continue;
    const maxAge = o.maxAgeMs[r.source] ?? Infinity;
    if (!Number.isFinite(r.asOf) || o.now - r.asOf > maxAge) {
      skipped.push({ key: r.key, reason: "stale" });
      continue;
    }
    const prev = out[r.key];
    if (!prev) {
      // first look: the state that already holds is the baseline, not news
      out[r.key] = newMemory(phaseOf(r, "none", p), o.now, r.held);
      continue;
    }
    out[r.key] = stepOne(o.userId, r, prev, o, p, fires);
  }
  fires.sort(byOrder);
  return { memory: out, fires, skipped };
}

/** Tolerant read of a stored memory map (database JSON). */
export function parseMemoryMap(raw: unknown): AlertMemoryMap {
  const out: Record<string, AlertMemory> = {};
  if (typeof raw !== "object" || raw === null) return out;
  const PH: readonly string[] = ["none", "green_warn", "green_confirm", "red_warn", "red_confirm"];
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v !== "object" || v === null) continue;
    const m = v as Record<string, unknown>;
    if (typeof m.phase !== "string" || !PH.includes(m.phase) || typeof m.cycle !== "number" || typeof m.seen !== "number") continue;
    const isEv = (e: unknown): e is AlertEvent => typeof e === "string" && PH.includes(e) && e !== "none";
    const rec = (x: unknown): Record<string, number> => {
      const o: Record<string, number> = {};
      if (typeof x === "object" && x !== null) for (const [kk, vv] of Object.entries(x as Record<string, unknown>)) if (isEv(kk) && typeof vv === "number" && Number.isFinite(vv)) o[kk] = vv;
      return o;
    };
    out[k] = {
      phase: m.phase as AlertPhase,
      cycle: Math.max(1, Math.floor(m.cycle)),
      counts: rec(m.counts),
      fired: Array.isArray(m.fired) ? m.fired.filter(isEv) : [],
      lastConfirm: m.lastConfirm === "green" || m.lastConfirm === "red" ? m.lastConfirm : null,
      last: rec(m.last),
      seen: m.seen,
    };
  }
  return out;
}

/** The side the other way round – exported for the sources' tests. */
export { opposite };
