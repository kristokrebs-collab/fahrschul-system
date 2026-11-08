import { useEffect, useLayoutEffect, useRef } from "react";
import { cn } from "@/lib/cn";
import { createTimeline, splitChars, type Timeline } from "@/motion/pulse/textKit";
import { CONFIG as TYPEWRITER } from "@/motion/pulse/Typewriter";
import { TextShimmer } from "@/motion/TextShimmer";
import { useReducedFx } from "@/motion/useReducedFx";

/**
 * CoachStream – a coach answer that types itself out while it streams in: `Typewriter` timing (65 ms per character,
 * hard cut-in, caret) on the shared rAF clock (`createTimeline`: pauses off-screen, lands on the right character on
 * return), plus a `TextShimmer` "Coach denkt …" while `thinking` and nothing has arrived yet.
 *
 * Streaming: when `text` grows (`text` starts with what is already typed) typing simply continues; any other change
 * restarts. Long answers never crawl: a chunk is typed in at most `maxCatchUp` ms (per-character time shrinks).
 * The full text is always in an sr-only span (screen readers get it at once, no aria-live – the ToastIsland is the
 * only live region); the typed layer is aria-hidden and written as ONE text node only when the count changes.
 * The caret blinks 3× after the text caught up, then rests hidden (finite). Reduced motion: the full text at once.
 */
export const COACH_STREAM = {
  msPerChar: TYPEWRITER.msPerChar,
  /** a pending chunk is typed in at most this long (ms) */
  maxCatchUp: 2400,
  thinkingLabel: "Coach denkt …",
} as const;

const CARET_CSS = `@keyframes fx-coach-caret{0%{opacity:1}50%{opacity:0}100%{opacity:0}}
[data-fx-caret]{opacity:0}
[data-fx="coach-stream"][data-typing] [data-fx-caret]{opacity:1}
[data-fx="coach-stream"][data-caught-up] [data-fx-caret]{animation:fx-coach-caret ${TYPEWRITER.caretBlinkMs}ms steps(1,end) 3}
@media (prefers-reduced-motion:reduce){[data-fx-caret]{animation:none!important;opacity:0!important}}`;

/** Per-character time for `remaining` characters: the Typewriter pace, faster when the chunk is long. */
export function streamPace(remaining: number, msPerChar: number = COACH_STREAM.msPerChar, maxCatchUp: number = COACH_STREAM.maxCatchUp): number {
  if (remaining <= 0) return msPerChar;
  return Math.max(4, Math.min(msPerChar, maxCatchUp / remaining));
}

/** Characters typed `elapsed` ms after a chunk started at `base` typed characters (first new char at once). */
export function streamCount(elapsed: number, base: number, length: number, ms: number): number {
  if (elapsed < 0) return base;
  return Math.min(length, base + Math.floor(elapsed / ms) + 1);
}

export interface CoachStreamProps {
  /** The answer so far (grows while it streams). */
  text: string;
  /** The coach is working: shows the shimmer label while no text has arrived. */
  thinking?: boolean;
  thinkingLabel?: string;
  msPerChar?: number;
  maxCatchUp?: number;
  cursor?: boolean;
  /** Show the text at once (e.g. answers from the history, not the live one). */
  instant?: boolean;
  /** Called every time the typing caught up with `text`. */
  onCaughtUp?: () => void;
  className?: string;
  as?: "div" | "p" | "span";
}

export function CoachStream({ text, thinking = false, thinkingLabel = COACH_STREAM.thinkingLabel, msPerChar = COACH_STREAM.msPerChar, maxCatchUp = COACH_STREAM.maxCatchUp, cursor = true, instant = false, onCaughtUp, className, as = "div" }: CoachStreamProps) {
  const reduced = useReducedFx();
  const rootRef = useRef<HTMLDivElement>(null);
  const nodeRef = useRef<HTMLSpanElement>(null);
  const st = useRef({ chars: [] as string[], shown: 0, typed: "", tl: null as Timeline | null, onCaughtUp });
  useLayoutEffect(() => {
    st.current.onCaughtUp = onCaughtUp;
  });

  useLayoutEffect(() => {
    const s = st.current;
    const root = rootRef.current;
    const node = nodeRef.current;
    if (!root || !node) return;
    const write = (n: number) => {
      if (n === s.shown && node.textContent === s.typed) return;
      s.shown = n;
      s.typed = s.chars.slice(0, n).join("");
      node.textContent = s.typed;
    };
    const caughtUp = () => {
      root.removeAttribute("data-typing");
      if (s.chars.length > 0) root.setAttribute("data-caught-up", "");
      s.onCaughtUp?.();
    };
    const chars = splitChars(text);
    const continues = text.startsWith(s.typed);
    s.chars = chars;
    s.tl?.stop();
    if (!continues) write(0);
    if (reduced || instant || chars.length === 0) {
      write(chars.length);
      root.removeAttribute("data-typing");
      root.removeAttribute("data-caught-up");
      if (chars.length > 0) s.onCaughtUp?.();
      return;
    }
    if (s.shown >= chars.length) {
      write(chars.length);
      return;
    }
    const base = s.shown;
    const ms = streamPace(chars.length - base, msPerChar, maxCatchUp);
    root.removeAttribute("data-caught-up");
    root.setAttribute("data-typing", "");
    const tl = createTimeline(root, (e) => {
      const n = streamCount(e, base, chars.length, ms);
      write(n);
      if (n >= chars.length) {
        caughtUp();
        return false;
      }
      return true;
    });
    s.tl = tl;
    tl.start();
  }, [text, reduced, instant, msPerChar, maxCatchUp]);

  useEffect(() => () => st.current.tl?.stop(), []);

  const Root = as as "div";
  const waiting = thinking && text.length === 0;
  return (
    <Root ref={rootRef} data-fx="coach-stream" className={cn("relative", className)}>
      {cursor ? (
        <style href="fx-coach-stream" precedence="default">
          {CARET_CSS}
        </style>
      ) : null}
      {waiting ? <TextShimmer className="text-[13px]">{thinkingLabel}</TextShimmer> : null}
      <span className="sr-only">{text}</span>
      <span aria-hidden="true" className="whitespace-pre-wrap">
        <span ref={nodeRef} />
        {cursor && !waiting ? <span data-fx-caret="" className="ml-px inline-block h-[1.05em] w-[2px] translate-y-[0.15em] bg-current" /> : null}
      </span>
    </Root>
  );
}
