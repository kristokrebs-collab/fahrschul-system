import { useLayoutEffect, useRef } from "react";
import { cn } from "@/lib/cn";
import { prefersReducedMotion } from "@/motion/pulse/engine";
import { createTimeline, splitChars, usePlayTrigger } from "@/motion/pulse/textKit";
import { useReducedFx } from "@/motion/useReducedFx";

/** pulse-motion `text-animate` (measured): linear typing, one character per 65 ms, hard cut-in, caret 500/500. */
export const CONFIG = {
  msPerChar: 65,
  caretBlinkMs: 1000, // full cycle: 500 on / 500 off (steps)
  caretWidth: "2px",
  caretHeight: "1.05em",
  caretColor: "currentColor",
} as const;

/** Visible characters `elapsed` ms after the start: floor(elapsed / msPerChar) + 1, clamped (first char at once). */
export function typedCount(elapsed: number, length: number, msPerChar: number = CONFIG.msPerChar): number {
  if (elapsed < 0 || length === 0) return 0;
  return Math.min(length, Math.floor(elapsed / msPerChar) + 1);
}

const CARET_CSS = `@keyframes pulse-tw-blink{0%{opacity:1}50%{opacity:0}100%{opacity:0}}
[data-pulse-tw-caret]{animation:pulse-tw-blink ${CONFIG.caretBlinkMs}ms steps(1,end) infinite}
[data-pulse="typewriter"][data-typing] [data-pulse-tw-caret]{animation:none}
@media (prefers-reduced-motion:reduce){[data-pulse-tw-caret]{animation:none}}`;

export interface TypewriterProps {
  text: string;
  play?: number | boolean;
  /** Type once on mount (default true). Without a pending play the full text shows (pack rest state). */
  playOnMount?: boolean;
  msPerChar?: number;
  /** ms before the first character (default 0: the first character appears at once). */
  delay?: number;
  /** Show the blinking caret (default true). */
  cursor?: boolean;
  onDone?: () => void;
  align?: "left" | "center" | "right";
  className?: string;
  as?: "span" | "p" | "div";
}

interface Engine {
  play(delay: number, msPerChar: number, onDone?: () => void): void;
  showAll(): void;
  clear(): void;
  destroy(): void;
}

function createEngine(root: HTMLElement, node: Text, text: string): Engine {
  const chars = splitChars(text);
  let shown = -1;
  let ms: number = CONFIG.msPerChar;
  let doneCb: (() => void) | undefined;
  const set = (n: number) => {
    if (n === shown) return;
    shown = n;
    node.nodeValue = chars.slice(0, n).join("");
  };
  const finish = () => {
    set(chars.length);
    root.removeAttribute("data-typing");
    const cb = doneCb;
    doneCb = undefined;
    cb?.();
  };
  const timeline = createTimeline(root, (e) => {
    const n = typedCount(e, chars.length, ms);
    set(n);
    if (n >= chars.length) {
      finish();
      return false;
    }
    return true;
  });
  return {
    play(delay, msPerChar, onDone) {
      timeline.stop();
      ms = msPerChar > 0 ? msPerChar : CONFIG.msPerChar;
      doneCb = onDone;
      root.setAttribute("data-typing", "");
      set(0);
      if (chars.length === 0) {
        finish();
        return;
      }
      timeline.start(delay);
    },
    showAll() {
      timeline.stop();
      finish();
    },
    clear() {
      set(0);
      root.setAttribute("data-typing", "");
    },
    destroy() {
      timeline.stop();
      doneCb = undefined;
      set(chars.length);
      root.removeAttribute("data-typing");
    },
  };
}

/**
 * Typewriter (pack `text-animate`): the character count comes from the rAF clock, the text node is written only when
 * it changes (~15 writes/s), the caret blinks by CSS steps (solid while typing, still under reduced motion). An
 * invisible copy of the full text (plus caret) reserves the final box, so typing never shifts layout or wraps outside.
 * The text is announced once (sr-only); the typed overlay is aria-hidden. Reduced motion: full text at once.
 */
export function Typewriter({ text, play, playOnMount = true, msPerChar = CONFIG.msPerChar, delay = 0, cursor = true, onDone, align = "left", className, as = "span" }: TypewriterProps) {
  const reduced = useReducedFx();
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const typedRef = useRef<HTMLSpanElement | null>(null);
  const engine = useRef<Engine | null>(null);
  const mountPending = useRef(playOnMount || play === true);

  useLayoutEffect(() => {
    const root = rootRef.current;
    const typed = typedRef.current;
    if (!root || !typed) return;
    let node = typed.firstChild;
    if (!(node instanceof Text)) {
      node = document.createTextNode(text);
      typed.prepend(node);
    }
    const e = createEngine(root, node as Text, text);
    engine.current = e;
    if (mountPending.current && !prefersReducedMotion()) e.clear();
    mountPending.current = false;
    return () => {
      e.destroy();
      engine.current = null;
    };
  }, [text]);

  useLayoutEffect(() => {
    if (reduced) engine.current?.showAll();
  }, [reduced]);

  usePlayTrigger(play, playOnMount, () => {
    if (reduced) {
      engine.current?.showAll();
      onDone?.();
      return;
    }
    engine.current?.play(delay, msPerChar, onDone);
  });

  const Root = as as "span";
  const alignCls = align === "center" ? "text-center" : align === "right" ? "text-right" : "text-left";
  const caret = (
    <span
      data-pulse-tw-caret=""
      className="inline-block align-text-bottom"
      style={{ width: CONFIG.caretWidth, height: CONFIG.caretHeight, marginLeft: "1px", background: CONFIG.caretColor }}
    />
  );
  return (
    <Root ref={rootRef} className={cn("relative inline-block", alignCls, className)} data-pulse="typewriter">
      {cursor ? (
        <style href="pulse-typewriter" precedence="default">
          {CARET_CSS}
        </style>
      ) : null}
      <span className="sr-only">{text}</span>
      {/* final box: same text + caret, invisible */}
      <span aria-hidden="true" className="invisible block whitespace-pre-wrap">
        {text}
        {cursor ? <span className="inline-block" style={{ width: CONFIG.caretWidth, marginLeft: "1px" }} /> : null}
      </span>
      <span key={text} ref={typedRef} aria-hidden="true" className="absolute inset-0 block whitespace-pre-wrap">
        {text}
        {cursor ? caret : null}
      </span>
    </Root>
  );
}
