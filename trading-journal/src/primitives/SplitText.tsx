import { motion } from "motion/react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { spring, stagger, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";

export const INTRO_KEY = "tj2-intro";

function seenIntro(): boolean {
  try {
    if (sessionStorage.getItem(INTRO_KEY)) return true;
    sessionStorage.setItem(INTRO_KEY, "1");
    return false;
  } catch {
    return true;
  }
}

export interface SplitTextProps {
  text: string;
  className?: string;
  /** Force the reveal regardless of the session flag (e.g. storybook). */
  force?: boolean;
}

/**
 * Bundle `p2` wordmark reveal: letters `y:110%→0` on `spring.reveal` (`delay .1 + i·.035`), shimmer band
 * sweeps `x` (transform only, NOT `left`) on `tween.shimmer`. Runs once per session (`sessionStorage`
 * `tj2-intro`) and never under reduced motion – then it renders static. Accessible text: a leading `.sr-only` span.
 */
export function SplitText({ text, className, force = false }: SplitTextProps) {
  const reduced = useReducedFx();
  // decided once per mount: the session flag is consumed in the lazy initializer
  const [fresh] = useState(() => force || !seenIntro());
  const animateIn = fresh && !reduced;
  return (
    // the real text is an sr-only span; the per-letter visual layer is aria-hidden (no `role="text"` / aria-label on a
    // generic element, which NVDA/JAWS do not read)
    <span className={cn("relative inline-flex overflow-hidden", className)}>
      <span className="sr-only">{text}</span>
      {text.split("").map((ch, i) =>
        animateIn ? (
          <motion.span
            key={i}
            aria-hidden="true"
            className="inline-block whitespace-pre"
            initial={{ y: "110%", opacity: 0, scale: 0.9 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            transition={{ ...spring.reveal, delay: 0.1 + i * stagger.letters }}
          >
            {ch}
          </motion.span>
        ) : (
          <span key={i} aria-hidden="true" className="inline-block whitespace-pre">
            {ch}
          </span>
        ),
      )}
      {animateIn && (
        <motion.span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,transparent_40%,rgb(255_255_255/0.3)_50%,transparent_60%)]"
          initial={{ x: "-120%" }}
          animate={{ x: "120%" }}
          transition={tween.shimmer}
        />
      )}
    </span>
  );
}
