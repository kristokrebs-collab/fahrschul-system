/**
 * Small runtime shared by the `@/motion/fx` effects: the Nothing tone palette as CSS variables, a jsdom-safe WAAPI
 * starter and the "play once when first in view / on every replay key" trigger every one-shot effect uses.
 */
import { useEffect, useEffectEvent, useRef, type RefObject } from "react";
import { useFirstInView } from "@/motion/inView";
import { usePlayTrigger } from "@/motion/pulse/textKit";
import { cssEasing, type ReplayEase } from "@/motion/replay";

/** Tones of the fx kit – red (`signal`) stays the ONE accent; win / loss only for P&L meaning. */
export type FxTone = "fg" | "mute" | "win" | "loss" | "signal" | "warn";

export const FX_TONE: Record<FxTone, string> = {
  fg: "var(--color-fg)",
  mute: "var(--color-mute)",
  win: "var(--color-win)",
  loss: "var(--color-loss)",
  signal: "var(--color-signal)",
  warn: "var(--color-warn)",
};

/** Same palette as plain hex (canvas drawing cannot resolve CSS variables cheaply per frame). */
export const FX_HEX: Record<FxTone, string> = {
  fg: "#f2f2f2",
  mute: "#9b9b9b",
  win: "#3ddc84",
  loss: "#ff4d4f",
  signal: "#e5202e",
  warn: "#ffb020",
};

export interface WaapiTiming {
  /** seconds (tween token units) */
  duration: number;
  ease: ReplayEase;
  delay?: number;
  iterations?: number;
  fill?: FillMode;
  direction?: PlaybackDirection;
}

/**
 * Starts one native WAAPI animation (compositor-run for transform / opacity) from a tween token. Returns `null`
 * where WAAPI is missing (jsdom) – callers then simply show their resting style.
 */
export function playWaapi(el: Element | null | undefined, keyframes: Keyframe[], t: WaapiTiming): Animation | null {
  if (!el || typeof (el as HTMLElement).animate !== "function") return null;
  return (el as HTMLElement).animate(keyframes, {
    duration: t.duration * 1000,
    delay: (t.delay ?? 0) * 1000,
    easing: cssEasing(t.ease),
    iterations: t.iterations ?? 1,
    fill: t.fill ?? "none",
    direction: t.direction ?? "normal",
  });
}

/**
 * One-shot trigger of the fx kit: `run` fires on every new `play` key (number change / boolean false → true) and –
 * with `playOnView` – once, the first time `ref` is at least 10 % on screen (shared observer, intro-gated; without an
 * IntersectionObserver at once). `enabled: false` (reduced motion) never fires.
 */
export function useFxPlay(ref: RefObject<Element | null>, play: number | boolean | undefined, playOnView: boolean, enabled: boolean, run: () => void): void {
  const fire = useEffectEvent(() => {
    if (enabled) run();
  });
  usePlayTrigger(play, false, () => {
    if (enabled) run();
  });
  const seen = useFirstInView(ref, playOnView && enabled);
  const viewed = useRef(false);
  useEffect(() => {
    if (!playOnView || !enabled || !seen || viewed.current) return;
    viewed.current = true;
    fire();
  }, [seen, playOnView, enabled]);
}
