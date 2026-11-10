/**
 * Idle sign-out (P09 Sitzungen): after N minutes without input on this device the session is signed out locally (the
 * journal stays). The last activity is kept in memory and written to localStorage at most once a minute, so a browser
 * closed for days is caught on the next start too. No per-event React state, no timers per event: one passive listener
 * set and one 30-s check.
 */
import { create } from "zustand";
import { readJson, storageKey, writeJson } from "@/store/storage";

export const IDLE_KEY = storageKey("cloud-idle");
export const ACTIVE_KEY = storageKey("cloud-active");
export const IDLE_CHOICES = [0, 30, 120, 480] as const;
export type IdleMinutes = (typeof IDLE_CHOICES)[number];
const CHECK_MS = 30_000;
const WRITE_MS = 60_000;

/** Pure: idle limit reached? (`limitMin` 0 = never). */
export function idleExpired(lastActive: number, now: number, limitMin: number): boolean {
  return limitMin > 0 && lastActive > 0 && now - lastActive >= limitMin * 60_000;
}

function readMinutes(): IdleMinutes {
  const v = readJson<unknown>(IDLE_KEY, 0);
  return (IDLE_CHOICES as readonly number[]).includes(v as number) ? (v as IdleMinutes) : 0;
}

export const useIdlePref = create<{ minutes: IdleMinutes }>()(() => ({ minutes: readMinutes() }));

export function setIdleMinutes(minutes: IdleMinutes): void {
  writeJson(IDLE_KEY, minutes);
  useIdlePref.setState({ minutes });
}

export interface IdleWatchOptions {
  onExpire: () => void;
  now?: () => number;
  target?: Pick<Window, "addEventListener" | "removeEventListener">;
}

/**
 * Starts watching (returns the stop). Checks once at start against the stored last activity (a tab closed for days),
 * then every 30 s.
 */
export function watchIdle(opts: IdleWatchOptions): () => void {
  const now = opts.now ?? Date.now;
  const target = opts.target ?? (typeof window === "undefined" ? undefined : window);
  let last = readJson<number>(ACTIVE_KEY, 0) || now();
  let written = 0;
  let fired = false;
  const touch = () => {
    last = now();
    if (last - written >= WRITE_MS) {
      written = last;
      writeJson(ACTIVE_KEY, last);
    }
  };
  const check = () => {
    if (fired) return;
    if (idleExpired(last, now(), useIdlePref.getState().minutes)) {
      fired = true;
      opts.onExpire();
    }
  };
  check();
  if (!fired) touch();
  const events = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
  for (const ev of events) target?.addEventListener(ev, touch, { passive: true, capture: true });
  const onVisible = () => {
    if (typeof document !== "undefined" && document.visibilityState === "visible") check();
  };
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisible);
  const timer = setInterval(check, CHECK_MS);
  return () => {
    clearInterval(timer);
    for (const ev of events) target?.removeEventListener(ev, touch, { capture: true });
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisible);
  };
}
