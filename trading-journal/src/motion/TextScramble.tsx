import { animate, type AnimationPlaybackControls } from "motion/react";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/cn";
import { fxTiming, stagger } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";

export const SCRAMBLE_CHARSET = "0123456789#%&*+-=/<>";
/** Glyphs re-roll at ~30 fps (`fxTiming.scrambleReroll`). */
const REROLL_MS = fxTiming.scrambleReroll * 1000;

/** Duration for a `length`-character label: `0.25 s + length · stagger.letters`, clamped to 0.35–0.8 s (`fxTiming.scramble*`). */
export function scrambleDuration(length: number): number {
  return Math.min(fxTiming.scrambleMax, Math.max(fxTiming.scrambleMin, fxTiming.scrambleBase + length * stagger.letters));
}

/**
 * Pure frame of the decode: the first `⌊progress · n⌋` characters are final, the rest random glyphs from `charset`;
 * whitespace always stays whitespace so the word shapes are readable from the first frame.
 */
export function scrambleText(final: string, progress: number, rand: () => number, charset = SCRAMBLE_CHARSET): string {
  const chars = Array.from(final);
  const p = progress > 1 ? 1 : progress > 0 ? progress : 0;
  const locked = Math.floor(p * chars.length);
  const glyphs = Array.from(charset);
  return chars.map((ch, i) => (i < locked || /\s/.test(ch) || glyphs.length === 0 ? ch : (glyphs[Math.floor(rand() * glyphs.length)] ?? ch))).join("");
}

interface Runner {
  /** `onDone` fires only when the decode ran to its end (never on `stop`). */
  play(text: string, duration: number | undefined, charset: string, onDone?: () => void): void;
  stop(): void;
}

/** Imperative decode on two spans: hides the real text (opacity) and writes glyphs into the overlay's `data-t`. */
function createRunner(real: HTMLElement, overlay: HTMLElement): Runner {
  let controls: AnimationPlaybackControls | null = null;
  const finish = () => {
    controls = null;
    real.style.opacity = "";
    overlay.setAttribute("data-t", "");
  };
  return {
    play(text, duration, charset, onDone) {
      controls?.stop();
      const n = Array.from(text).length;
      if (n === 0) {
        finish();
        onDone?.();
        return;
      }
      let lastLocked = -1;
      let lastRoll = -Infinity;
      real.style.opacity = "0";
      overlay.setAttribute("data-t", scrambleText(text, 0, Math.random, charset));
      controls = animate(0, 1, {
        duration: duration ?? scrambleDuration(n),
        ease: "linear",
        onUpdate: (p) => {
          const locked = Math.floor(p * n);
          const now = performance.now();
          if (locked === lastLocked && now - lastRoll < REROLL_MS) return;
          lastLocked = locked;
          lastRoll = now;
          overlay.setAttribute("data-t", scrambleText(text, p, Math.random, charset));
        },
        onComplete: () => {
          finish();
          onDone?.();
        },
      });
    },
    stop() {
      controls?.stop();
      finish();
    },
  };
}

type ScrambleTag = "span" | "h1" | "h2" | "h3" | "p" | "div";

export interface TextScrambleProps {
  text: string;
  as?: ScrambleTag;
  className?: string;
  /** Seconds (default `scrambleDuration(length)`). */
  duration?: number;
  charset?: string;
  /** Decode on mount (default true). Text changes always decode. */
  scrambleOnMount?: boolean;
  /** Decode again on pointer hover. */
  scrambleOnHover?: boolean;
}

/**
 * Terminal-style decode (21st.dev / motion-primitives "Text Scramble"): characters cycle through `charset` at ~30 fps
 * and lock in left to right. The real text node is always the final string – it keeps the layout box, the accessible
 * name and `textContent`; during the decode it is only made transparent while an `aria-hidden` overlay shows the
 * glyphs via `::before { content: attr(data-t) }`. Zero React renders. Use a monospace/tabular font so glyphs
 * do not jitter. It decodes once per text – on mount (unless `scrambleOnMount={false}`) and on every text change, never
 * again when its effects merely re-run (a keep-alive page shown again). Reduced motion: the final text, immediately.
 */
export function TextScramble({ text, as = "span", className, duration, charset = SCRAMBLE_CHARSET, scrambleOnMount = true, scrambleOnHover = false }: TextScrambleProps) {
  const reduced = useReducedFx();
  const realRef = useRef<HTMLSpanElement>(null);
  const overlayRef = useRef<HTMLSpanElement>(null);
  const runner = useRef<Runner | null>(null);
  const mounted = useRef(false);
  /** The text whose decode completed (or that was shown without one): survives a keep-alive <Activity> hide/show. */
  const lastPlayed = useRef<string | null>(null);

  useEffect(() => {
    const real = realRef.current;
    const overlay = overlayRef.current;
    if (!real || !overlay) return;
    const r = createRunner(real, overlay);
    runner.current = r;
    return () => {
      r.stop();
      runner.current = null;
    };
  }, []);

  // decodes once per text: an effect re-run that is not a text change (a keep-alive page shown again) does not replay
  useEffect(() => {
    const first = !mounted.current;
    mounted.current = true;
    if (reduced) return;
    if (first && !scrambleOnMount) {
      lastPlayed.current = text;
      return;
    }
    if (lastPlayed.current === text) return;
    lastPlayed.current = text;
    let done = false;
    const r = runner.current;
    r?.play(text, duration, charset, () => {
      done = true;
    });
    return () => {
      // interrupted (StrictMode replay, hidden mid-run): let the next run finish the decode
      if (!done) lastPlayed.current = null;
      r?.stop();
    };
  }, [text, reduced, duration, charset, scrambleOnMount]);

  const onMouseEnter = scrambleOnHover && !reduced ? () => runner.current?.play(text, duration, charset) : undefined;
  // heading/paragraph variants only differ in semantics; the refs point at inner spans
  const Tag = as as "span";
  return (
    <Tag className={cn("relative inline-block", className)} onMouseEnter={onMouseEnter}>
      <span ref={realRef}>{text}</span>
      <span ref={overlayRef} aria-hidden="true" data-t="" className="pointer-events-none absolute inset-0 whitespace-pre before:content-[attr(data-t)]" />
    </Tag>
  );
}
