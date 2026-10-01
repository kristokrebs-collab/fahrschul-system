import { motion } from "motion/react";
import { Fragment, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { RollingDigits } from "@/motion/RollingDigits";
import { spring, stagger, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";

export interface PageHeaderProps {
  title: string;
  lead: string;
  /** Right-aligned actions (segmented controls, primary button). */
  action?: ReactNode;
  /** Optional count pill next to the title; the digits roll when it changes. */
  count?: number;
  /** Unit after the count (visible and in the pill's accessible label), e.g. `n => n === 1 ? "Grundlage" : "Grundlagen"`. */
  countUnit?: (n: number) => string;
  className?: string;
}

// px, not em: a unit change (em → 0) would make motion measure every word before animating
const WORD_FROM = { opacity: 0, y: 10, filter: "blur(4px)" };
const WORD_TO = { opacity: 1, y: 0, filter: "blur(0px)", transitionEnd: { filter: "none" } };

/**
 * Bundle `aT`: page title with the signal dot + lead paragraph + action slot
 * (`flex flex-wrap items-end justify-between gap-4`). Shared by the setups and settings pages.
 *
 * Entrance (21st.dev "Words Stagger"): the title's words rise out of a blur one after another (`stagger.words`,
 * y on `spring.enter`, opacity/blur on `tween.reveal`), the signal dot pops (`spring.pop`) and sends out one ring
 * (`tween.ripple`), the lead follows. Everything ends at `transform: none` / `filter: none`. Reduced motion: static.
 * The `h1`'s text stays the plain title (word spans, real spaces), so its accessible name never changes.
 */
export function PageHeader({ title, lead, action, count, countUnit, className }: PageHeaderProps) {
  const reduced = useReducedFx();
  const words = title.split(" ");
  // same beat as the trades PageHeader: the first word starts with the page enter
  const wordDelay = (i: number) => Math.min(i, stagger.max) * stagger.words;
  const unit = count == null ? "" : (countUnit?.(count) ?? "");
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-4", className)}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className="text-[clamp(22px,7.2vw,28px)] font-semibold tracking-tight [text-wrap:balance] [overflow-wrap:anywhere]">
            <motion.span
              className="relative mr-2 inline-block size-2 -translate-y-1 rounded-full bg-signal align-middle"
              aria-hidden="true"
              initial={reduced ? false : { scale: 0 }}
              animate={{ scale: 1 }}
              transition={spring.pop}
            >
              {!reduced && (
                <motion.span
                  className="absolute inset-0 rounded-full bg-signal"
                  initial={{ scale: 1, opacity: 0.7 }}
                  animate={{ scale: 3.2, opacity: 0 }}
                  transition={{ ...tween.ripple, delay: 0.12 }}
                />
              )}
            </motion.span>
            {words.map((word, i) => (
              <Fragment key={i}>
                {i > 0 && " "}
                <motion.span
                  className="inline-block"
                  initial={reduced ? false : WORD_FROM}
                  animate={WORD_TO}
                  transition={{ default: { ...tween.reveal, delay: wordDelay(i) }, y: { ...spring.enter, delay: wordDelay(i) } }}
                >
                  {word}
                </motion.span>
              </Fragment>
            ))}
          </h1>
          {count != null && (
            <motion.span
              className="inline-flex items-baseline gap-1.5 rounded-full border border-line-2 bg-white/[0.03] px-2.5 py-0.5 font-mono text-[12px] text-mute"
              initial={reduced ? false : { opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ default: { ...tween.fade, delay: wordDelay(words.length) }, scale: { ...spring.pop, delay: wordDelay(words.length) } }}
            >
              <RollingDigits value={count} className="text-fg" aria-label={unit ? `${count} ${unit}` : String(count)} />
              {unit && <span aria-hidden="true">{unit}</span>}
            </motion.span>
          )}
        </div>
        <motion.p
          className="mt-1 max-w-[62ch] text-[13.5px] text-mute"
          initial={reduced ? false : { opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ default: { ...tween.reveal, delay: wordDelay(words.length) }, y: { ...spring.enter, delay: wordDelay(words.length) } }}
        >
          {lead}
        </motion.p>
      </div>
      {action}
    </div>
  );
}
