import { motion } from "motion/react";
import { cn } from "@/lib/cn";
import { INTRO_KEY, useIntroPhase } from "@/intro/introStore";
import { spring, stagger, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";

/** Session flag of the intro (owned by the intro; re-exported for existing imports). */
export { INTRO_KEY };

export interface SplitTextProps {
  text: string;
  className?: string;
  /** Force the reveal regardless of the intro (e.g. storybook). */
  force?: boolean;
}

const HIDDEN = { y: "110%", opacity: 0, scale: 0.9 } as const;
const SHOWN = { y: 0, opacity: 1, scale: 1 } as const;

/**
 * Bundle `p2` wordmark reveal: letters `y:110%→0` on `spring.reveal` (`delay .1 + i·.035`), shimmer band
 * sweeps `x` (transform only, NOT `left`) on `tween.shimmer`. It is part of the intro: letters wait hidden while the
 * intro stage covers the app and reveal when the journal builds itself (phase "build"); without an intro (phase
 * "off"/"done") and under reduced motion the wordmark renders static. Accessible text: a leading `.sr-only` span.
 */
export function SplitText({ text, className, force = false }: SplitTextProps) {
  const reduced = useReducedFx();
  const phase = useIntroPhase();
  const mode = reduced ? "static" : force || phase === "build" ? "play" : phase === "stage" ? "hidden" : "static";
  const animated = mode !== "static";
  return (
    // the real text is an sr-only span; the per-letter visual layer is aria-hidden (no `role="text"` / aria-label on a
    // generic element, which NVDA/JAWS do not read)
    <span className={cn("relative inline-flex overflow-hidden", className)}>
      <span className="sr-only">{text}</span>
      {text.split("").map((ch, i) =>
        animated ? (
          <motion.span
            key={i}
            aria-hidden="true"
            className="inline-block whitespace-pre"
            initial={HIDDEN}
            animate={mode === "play" ? SHOWN : HIDDEN}
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
      {mode === "play" && (
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
