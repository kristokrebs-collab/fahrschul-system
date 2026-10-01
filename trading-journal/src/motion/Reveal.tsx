import { motion, useInView, type HTMLMotionProps, type Transition, type Variants } from "motion/react";
import { createContext, useContext, useRef, type ReactNode } from "react";
import { canObserveInView } from "@/motion/inView";
import { spring, stagger, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";

/**
 * Blur-fade entrance (21st.dev / magicui "Blur Fade"): `{opacity 0, y 14, blur 6px}` → rest once the element is
 * 15 % in view (viewport shrunk by 50 px). `y` rides `spring.enter`, opacity/filter `tween.reveal`; delay =
 * `min(index, stagger.max) · stagger.reveal`.
 *
 * Contract (see README / e2e):
 * - ends at `transform: none` (motion drops an identity transform) and `filter: none` (`transitionEnd`), so a
 *   finished reveal is never a containing block for `position: fixed` descendants – still: never wrap the
 *   ChartCard body (fixed marker ghost) in a reveal;
 * - no x offset (390 px viewport must not scroll horizontally);
 * - reduced motion, or no `IntersectionObserver` (jsdom/SSR): `initial={false}` and no trigger – content is
 *   simply there, nothing is ever left at opacity 0.
 */

export const REVEAL_FROM = { opacity: 0, y: 14, filter: "blur(6px)" } as const;
const REVEAL_TO = { opacity: 1, y: 0, filter: "blur(0px)", transitionEnd: { filter: "none" } } as const;
const REVEAL_VIEWPORT = { once: true, amount: 0.15, margin: "-50px" } as const;

/** Stagger delay of the `index`-th revealed element (capped at `stagger.max` steps). */
export function revealDelay(index = 0, base = 0): number {
  return base + Math.min(Math.max(0, index), stagger.max) * stagger.reveal;
}

function revealTransition(delay: number): Transition {
  return { default: { ...tween.reveal, delay }, y: { ...spring.enter, delay } };
}

/** `true` when reveals may animate: motion allowed and an `IntersectionObserver` exists to trigger them. */
function useRevealEnabled(): boolean {
  const reduced = useReducedFx();
  return !reduced && canObserveInView();
}

type RevealTag = "div" | "section" | "article" | "li" | "header" | "aside" | "ul" | "ol";
type RevealOwned = "initial" | "animate" | "whileInView" | "viewport" | "transition" | "variants" | "exit";

export interface RevealProps extends Omit<HTMLMotionProps<"div">, RevealOwned> {
  /** Position in its row/grid → `min(index, stagger.max) · stagger.reveal` delay. */
  index?: number;
  /** Extra delay in seconds before the stagger. */
  delay?: number;
  as?: RevealTag;
  children?: ReactNode;
}

/** One element that blur-fades in when it scrolls into view (once). */
export function Reveal({ index = 0, delay = 0, as = "div", children, ...rest }: RevealProps) {
  const enabled = useRevealEnabled();
  // motion.li / motion.section share the div prop surface for everything Reveal passes through
  const Tag = motion[as] as typeof motion.div;
  if (!enabled) {
    return (
      <Tag initial={false} {...rest}>
        {children}
      </Tag>
    );
  }
  return (
    <Tag initial={REVEAL_FROM} whileInView={REVEAL_TO} viewport={REVEAL_VIEWPORT} transition={revealTransition(revealDelay(index, delay))} {...rest}>
      {children}
    </Tag>
  );
}

const ITEM_VARIANTS: Variants = {
  hidden: REVEAL_FROM,
  shown: { ...REVEAL_TO, transition: { default: tween.reveal, y: spring.enter } },
};

const RevealGroupContext = createContext(false);

export interface RevealGroupProps extends Omit<HTMLMotionProps<"div">, RevealOwned> {
  /** Delay (s) before the first item. */
  delay?: number;
  as?: RevealTag;
  children?: ReactNode;
}

/**
 * Container whose `RevealItem` children blur-fade in one after another (`stagger.reveal`, capped at `stagger.max`
 * steps) once the group is 15 % in view. Driven by `animate` (not `whileInView`), so items mounted later – a list
 * that grows after the reveal – still enter instead of staying hidden.
 */
export function RevealGroup({ delay = 0, as = "div", children, ...rest }: RevealGroupProps) {
  const enabled = useRevealEnabled();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { ...REVEAL_VIEWPORT, initial: !enabled });
  const Tag = motion[as] as typeof motion.div;
  const variants: Variants = { hidden: {}, shown: { transition: { delayChildren: (i: number) => revealDelay(i, delay) } } };
  return (
    <RevealGroupContext.Provider value={enabled}>
      <Tag
        ref={ref}
        initial={enabled ? "hidden" : false}
        animate={enabled ? (inView ? "shown" : "hidden") : undefined}
        variants={enabled ? variants : undefined}
        {...rest}
      >
        {children}
      </Tag>
    </RevealGroupContext.Provider>
  );
}

export interface RevealItemProps extends Omit<HTMLMotionProps<"div">, RevealOwned> {
  as?: RevealTag;
  children?: ReactNode;
}

/** Child of a `RevealGroup`; renders statically outside one (or when reveals are disabled). */
export function RevealItem({ as = "div", children, ...rest }: RevealItemProps) {
  const enabled = useContext(RevealGroupContext);
  const Tag = motion[as] as typeof motion.div;
  return (
    <Tag variants={enabled ? ITEM_VARIANTS : undefined} {...rest}>
      {children}
    </Tag>
  );
}
