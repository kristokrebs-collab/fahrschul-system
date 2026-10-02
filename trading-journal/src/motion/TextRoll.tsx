import { AnimatePresence, motion, useIsPresent } from "motion/react";
import type { Ref } from "react";
import { cn } from "@/lib/cn";
import { spring, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";

export type TextRollMode = "morph" | "roll";

export interface TextRollProps {
  /** The current label. */
  text: string;
  /**
   * `morph` (default): letters shared by the old and new label glide to their new place, removed letters blur out,
   * new ones blur in. `roll`: the whole label slot-rolls (old out, new in). Labels longer than
   * `MORPH_MAX_CHARS` always roll.
   */
  mode?: TextRollMode;
  /** Roll direction: `up` (new label comes from below, default) or `down`. */
  direction?: "up" | "down";
  className?: string;
}

/** Longer labels roll instead of morphing (per-letter layout nodes stop paying off). */
export const MORPH_MAX_CHARS = 24;

export interface MorphGlyph {
  /** Stable identity: the character plus its occurrence index (`e-0`, `e-1` …). */
  key: string;
  ch: string;
}

/** Splits `text` into grapheme-ish glyphs keyed by character + occurrence, so shared letters keep their identity. */
export function morphGlyphs(text: string): MorphGlyph[] {
  const seen = new Map<string, number>();
  return Array.from(text).map((ch) => {
    const n = seen.get(ch) ?? 0;
    seen.set(ch, n + 1);
    return { key: `${ch}-${n}`, ch };
  });
}

const BLUR_IN = { opacity: 0, filter: "blur(4px)" };
const SHOWN = { opacity: 1, filter: "blur(0px)", transitionEnd: { filter: "none" } };

/**
 * One morphing letter. The character is drawn via `::before { content: attr(data-ch) }`: the visual layer adds no
 * text nodes, so the parent's `textContent` stays exactly the label (held by the sr-only span). `ref` reaches the
 * span so `AnimatePresence mode="popLayout"` can measure and pop exiting letters.
 */
function Glyph({ ch, dep, ref }: { ch: string; dep: string; ref?: Ref<HTMLSpanElement> }) {
  const present = useIsPresent();
  return (
    <motion.span
      ref={ref}
      layout="position"
      layoutDependency={dep}
      data-ch={ch}
      data-exiting={present ? undefined : ""}
      className="inline-block whitespace-pre before:content-[attr(data-ch)]"
      initial={BLUR_IN}
      animate={SHOWN}
      exit={{ ...BLUR_IN, transition: tween.exit }}
      transition={{ layout: spring.digit, default: tween.fade }}
    />
  );
}

/**
 * Animated label swap (21st.dev / motion-primitives "Text Morph" + "Text Roll"). The accessible text is always the
 * current `text`, synchronously (sr-only span); the animated layer is `aria-hidden` and contributes no text nodes, so
 * `getByText`, accessible names and `textContent` never see half-morphed or duplicated labels.
 * No animation on mount. Reduced motion: a plain opacity crossfade.
 */
export function TextRoll({ text, mode = "morph", direction = "up", className }: TextRollProps) {
  const reduced = useReducedFx();
  const roll = mode === "roll" || Array.from(text).length > MORPH_MAX_CHARS;
  const dir = direction === "up" ? 1 : -1;

  let visual;
  if (reduced) {
    visual = (
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={text}
          data-text={text}
          className="inline-block whitespace-pre before:content-[attr(data-text)]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: tween.exit }}
          transition={tween.crossfade}
        />
      </AnimatePresence>
    );
  } else if (roll) {
    visual = (
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={text}
          data-text={text}
          className="inline-block whitespace-pre before:content-[attr(data-text)]"
          initial={{ y: `${dir * 60}%`, ...BLUR_IN }}
          animate={{ y: 0, ...SHOWN }}
          exit={{ y: `${-dir * 60}%`, ...BLUR_IN, transition: { default: tween.exit, y: spring.digit } }}
          transition={{ y: spring.digit, default: tween.fade }}
        />
      </AnimatePresence>
    );
  } else {
    visual = (
      <AnimatePresence mode="popLayout" initial={false}>
        {morphGlyphs(text).map((g) => (
          <Glyph key={g.key} ch={g.ch} dep={text} />
        ))}
      </AnimatePresence>
    );
  }

  return (
    <span className={cn("relative inline-flex whitespace-pre", className)}>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true" className={cn("relative inline-flex", roll && !reduced && "overflow-hidden py-[0.12em] -my-[0.12em]")}>
        {visual}
      </span>
    </span>
  );
}
