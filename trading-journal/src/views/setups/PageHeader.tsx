import { motion } from "motion/react";
import { Fragment, lazy, Suspense, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Quiet, useRichFx } from "@/motion/rich";
import { RollingDigits } from "@/motion/RollingDigits";
import { spring, stagger, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { LeadFill } from "./LeadFill";

/** Rich pages only: slow light spots, pointer spotlight and a ghost word behind the header (lazy chunk, own CSS). */
const PageAura = lazy(() => import("@/motion/rich/PageAura"));

export interface PageHeaderProps {
  title: string;
  lead: string;
  /** Right-aligned actions (segmented controls, primary button). */
  action?: ReactNode;
  /** Optional count pill next to the title; the digits roll when it changes. */
  count?: number;
  /** Unit after the count (visible and in the pill's accessible label), e.g. `n => n === 1 ? "Grundlage" : "Grundlagen"`. */
  countUnit?: (n: number) => string;
  /** Subtitle recipe (`LeadFill`): pixel fill once per session (`storageKey`), then the marker on `highlight`. */
  leadFill?: { storageKey: string; highlight?: string };
  /** Rich pages, wide screens: a word set huge and outlined (7 % ink) behind the header. Not the title – a short word of the page's theme. */
  ghost?: string;
  className?: string;
}

// px, not em: a unit change (em → 0) would make motion measure every word before animating
const WORD_FROM = { opacity: 0, y: 10, filter: "blur(4px)" };
/** The ember starts once the lead has faded in. */
const FILL_AFTER_LEAD_S = 0.25;
const WORD_TO = { opacity: 1, y: 0, filter: "blur(0px)", transitionEnd: { filter: "none" } };
/** Rich pages: each word is pulled up out of a clip line (px, not %: the same unit at both ends, no measuring). */
const PULL_FROM = { y: 40, filter: "blur(3px)" };
const PULL_TO = { y: 0, filter: "blur(0px)", transitionEnd: { filter: "none" } };
/** The clip of a pulled-up word: the line box, a little room left and right for the glyph overshoot. */
const PULL_CLIP = "inline-block [clip-path:inset(-0.2em_-0.2em_0_-0.2em)]";

/**
 * Bundle `aT`: page title with the signal dot + lead paragraph + action slot
 * (`flex flex-wrap items-end justify-between gap-4`). Shared by the setups and settings pages.
 *
 * Entrance (21st.dev "Words Stagger"): the title's words rise out of a blur one after another (`stagger.words`,
 * y on `spring.enter`, opacity/blur on `tween.reveal`), the signal dot pops (`spring.pop`) and sends out one ring
 * (`tween.ripple`), the lead follows. Everything ends at `transform: none` / `filter: none`. Reduced motion: static.
 * The `h1`'s text stays the plain title (word spans, real spaces), so its accessible name never changes.
 * With `leadFill` the lead is the pulse subtitle recipe (`LeadFill`: pixel fill once per session, then a marker).
 */
export function PageHeader({ title, lead, action, count, countUnit, leadFill, ghost, className }: PageHeaderProps) {
  const reduced = useReducedFx();
  const rich = useRichFx();
  const words = title.split(" ");
  // same beat as the trades PageHeader: the first word starts with the page enter
  const wordDelay = (i: number) => Math.min(i, stagger.max) * stagger.words;
  const unit = count == null ? "" : (countUnit?.(count) ?? "");
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-4", rich && "relative isolate", className)}>
      {rich && (
        <Quiet>
          <Suspense fallback={null}>
            <PageAura ghost={ghost} />
          </Suspense>
        </Quiet>
      )}
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
                {rich ? (
                  <span className={PULL_CLIP}>
                    <motion.span
                      className="inline-block"
                      initial={PULL_FROM}
                      animate={PULL_TO}
                      transition={{ default: { ...tween.reveal, delay: wordDelay(i) }, y: { ...spring.enter, delay: wordDelay(i) } }}
                    >
                      {word}
                    </motion.span>
                  </span>
                ) : (
                  <motion.span
                    className="inline-block"
                    initial={reduced ? false : WORD_FROM}
                    animate={WORD_TO}
                    transition={{ default: { ...tween.reveal, delay: wordDelay(i) }, y: { ...spring.enter, delay: wordDelay(i) } }}
                  >
                    {word}
                  </motion.span>
                )}
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
        <motion.div
          className="mt-1 max-w-[62ch] text-[13.5px] text-mute"
          initial={reduced ? false : { opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ default: { ...tween.reveal, delay: wordDelay(words.length) }, y: { ...spring.enter, delay: wordDelay(words.length) } }}
        >
          {leadFill ? (
            <LeadFill text={lead} storageKey={leadFill.storageKey} highlight={leadFill.highlight} delayMs={Math.round((wordDelay(words.length) + FILL_AFTER_LEAD_S) * 1000)} />
          ) : (
            <p>{lead}</p>
          )}
        </motion.div>
      </div>
      {action}
    </div>
  );
}
