/**
 * Motion profiles per plan (Runde 11, A5): the frame's material and motion grow with the plan, as token sets on `html[data-motion-tier]`
 * (`shell-motion.css`): `free` clear and calm, `pro` more material depth, `premium` + one border-beam lap and reveals, `team` + avatar /
 * role transitions. Cosmetics only – no feature, limit or content depends on it.
 *
 * The tier comes from the SERVER-CONFIRMED plan and from nothing else: the shell binds the one source (`bindTierSource`: the billing store's
 * effective plan, `useMotionTierSync` in `App.tsx`), and `setMotionTier(tier)` – the hook the purchase flow calls after a real plan change – only
 * accepts the tier that source names. A call with another tier (a flag, a devtools write, a stale caller) returns `false` and changes nothing; with no
 * source bound yet it does nothing. The first tier of a session is applied silently; a later CHANGE plays a short introduction (`html[data-motion-intro]`,
 * ~1 s, an edge light that runs once through the sidebar and the bar; never under reduced motion).
 */
import { useEffect, useSyncExternalStore } from "react";
import type { PlanId } from "@/billing/types";
import { applyMotionMode, motionMode, motionReduced, useMotionPref } from "@/motion/profile";

export const MOTION_TIERS = ["free", "pro", "premium", "team"] as const;
export type MotionTier = (typeof MOTION_TIERS)[number];
/** How long `data-motion-intro` stays on after a real plan change (ms). */
export const TIER_INTRO_MS = 1100;

/** Pure: the profile of a plan. Anything unknown is `free` (calm is the safe side). */
export function motionTierOf(plan: PlanId | string | null | undefined): MotionTier {
  return plan === "pro" || plan === "premium" || plan === "team" ? plan : "free";
}

let source: (() => MotionTier) | null = null;
let current: MotionTier | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<(t: MotionTier | null) => void>();

/** The shell binds the one source of the tier (the server-confirmed plan). Returns the unbind. */
export function bindTierSource(read: () => MotionTier): () => void {
  source = read;
  return () => {
    if (source === read) source = null;
  };
}

/** The tier now in force (`null` before the first confirmed plan). */
export const currentMotionTier = (): MotionTier | null => current;
export const onMotionTier = (fn: (t: MotionTier | null) => void): (() => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

/** The tier now in force, as a hook (`null` before the first confirmed plan). */
export function useMotionTier(): MotionTier | null {
  return useSyncExternalStore(onMotionTier, currentMotionTier, () => null);
}

/** Test seam: forget everything (and the attributes). */
export function resetMotionTier(): void {
  source = null;
  current = null;
  if (timer) clearTimeout(timer);
  timer = undefined;
  if (typeof document !== "undefined") {
    document.documentElement.removeAttribute("data-motion-tier");
    document.documentElement.removeAttribute("data-motion-intro");
  }
}

/**
 * Applies `tier` when it is the confirmed one. Returns whether it is now in force. A change from one tier to another (not the first
 * one of the session) starts the introduction unless motion is reduced.
 */
export function setMotionTier(tier: MotionTier): boolean {
  if (!source || !(MOTION_TIERS as readonly string[]).includes(tier)) return false;
  if (source() !== tier) return false;
  if (current === tier) return true;
  const first = current === null;
  current = tier;
  if (typeof document === "undefined") return true;
  const el = document.documentElement;
  el.setAttribute("data-motion-tier", tier);
  for (const fn of listeners) fn(tier);
  if (!first) {
    const device = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!motionReduced(motionMode(), device)) {
      el.removeAttribute("data-motion-intro");
      // one frame between remove and set, so the CSS animation restarts when two changes follow each other
      requestAnimationFrame(() => {
        if (current === tier) el.setAttribute("data-motion-intro", tier);
      });
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => el.removeAttribute("data-motion-intro"), TIER_INTRO_MS + 120);
    }
  }
  return true;
}

/**
 * Mounted once by the shell: binds the confirmed plan as the source and keeps `data-motion-tier` in step with it. `plan` is the
 * billing store's effective plan (`useEffectivePlan().plan`) – Free without payments, without a login, or while the plan is unknown.
 */
export function useMotionTierSync(plan: PlanId | string | null | undefined, read?: () => PlanId | string | null | undefined): void {
  const tier = motionTierOf(plan);
  // `read` asks the store at the moment of the call (the purchase flow calls before React has re-rendered); without it the rendered plan answers
  useEffect(() => bindTierSource(() => (read ? motionTierOf(read()) : tier)), [tier, read]);
  useEffect(() => {
    setMotionTier(tier);
  }, [tier, read]);
  // the reader's setting is written to the document once at start (`profile.ts`); re-applied here so a late store sees it
  const mode = useMotionPref((s) => s.mode);
  useEffect(() => applyMotionMode(mode), [mode]);
}
