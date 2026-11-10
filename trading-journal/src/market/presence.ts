/**
 * Anwesenheitsspur (F27): when was the app actually running? Alerts exist only while a tab runs the app, so „Alarme laufen nur bei
 * offener App“ gets a number: a beat every `BEAT_MS` while a tab is open, stored as short segments `{ id, a, b }` (start, last beat)
 * under `tj2-presence` (`storageKey("presence")`, versioned `{ v: 1, segs }`, the last `PRESENCE_DAYS` days, at most `PRESENCE_CAP`
 * segments). This device only, not part of the backup or the cloud sync; nothing is sent anywhere.
 *
 * A beat further than `PRESENCE_GAP_MS` after the previous one starts a NEW segment (the tab was closed, frozen or the device slept);
 * several tabs write their own segments, the report merges them. The trace starts the day it is first written – before that the
 * share of open time is unknown, and the report says so. `PresenceHost` is a leaf that renders nothing.
 */
import { useEffect } from "react";
import { mergeSegments, PRESENCE_GAP_MS, type PresenceSeg } from "@/domain/missed/presence";
import { readJson, storageKey, writeJson } from "@/store/storage";

export const PRESENCE_KEY = storageKey("presence");
export const PRESENCE_VERSION = 1;
export const PRESENCE_DAYS = 35;
export const PRESENCE_CAP = 400;
export const BEAT_MS = 30_000;

interface Seg extends PresenceSeg {
  id: string;
}

const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Tolerant read: `[]` for anything unreadable or of another version. */
export function parsePresence(raw: unknown): Seg[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const w = raw as { v?: unknown; segs?: unknown };
  if (w.v !== PRESENCE_VERSION || !Array.isArray(w.segs)) return [];
  const out: Seg[] = [];
  for (const s of w.segs) {
    if (!s || typeof s !== "object") continue;
    const o = s as Record<string, unknown>;
    if (typeof o.id === "string" && fin(o.a) && fin(o.b) && o.b >= o.a) out.push({ id: o.id.slice(0, 24), a: o.a, b: o.b });
  }
  return out;
}

/** The stored segments (all tabs). */
export function readPresence(): readonly PresenceSeg[] {
  return parsePresence(readJson<unknown>(PRESENCE_KEY, null)).map(({ a, b }) => ({ a, b }));
}

/** Adds a beat of tab `id` at `now`; returns the segments to store (pure). */
export function applyBeat(segs: readonly Seg[], id: string, now: number): Seg[] {
  const keep = segs.filter((s) => now - s.b <= PRESENCE_DAYS * 86_400_000);
  const own = keep.find((s) => s.id === id && now - s.b <= PRESENCE_GAP_MS);
  const others = keep.filter((s) => s !== own);
  // a tab that restarts its segment after a break: older segments of the same id stay as plain history
  const next = own ? [...others, { ...own, b: now }] : [...others, { id, a: now, b: now }];
  return next.sort((p, q) => p.a - q.a).slice(-PRESENCE_CAP);
}

let tabId: string | null = null;
const myId = (): string => (tabId ??= Math.random().toString(36).slice(2, 8));

/** One beat now (never throws). */
export function beat(now: number = Date.now()): void {
  try {
    writeJson(PRESENCE_KEY, { v: PRESENCE_VERSION, segs: applyBeat(parsePresence(readJson<unknown>(PRESENCE_KEY, null)), myId(), now) });
  } catch {
    /* the trace is a convenience; a full or blocked store must not break the app */
  }
}

/** Starts the beat; returns the stop. */
export function startPresence(): () => void {
  beat();
  const timer = setInterval(() => beat(), BEAT_MS);
  const onVisible = (): void => {
    if (typeof document === "undefined" || document.visibilityState === "visible") beat();
  };
  const onHide = (): void => beat();
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisible);
  if (typeof window !== "undefined") window.addEventListener("pagehide", onHide);
  return () => {
    clearInterval(timer);
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisible);
    if (typeof window !== "undefined") window.removeEventListener("pagehide", onHide);
  };
}

/** Leaf host (mounted once in `DeferredHosts`): keeps the beat while the app runs. Renders nothing. */
export function PresenceHost(): null {
  useEffect(() => startPresence(), []);
  return null;
}

/** Merged segments of all tabs, for the report. */
export const presenceSegments = (): PresenceSeg[] => mergeSegments(readPresence());

/** Tests: forget the tab id. */
export function __resetPresence(): void {
  tabId = null;
}
