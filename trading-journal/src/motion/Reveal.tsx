import { motion, useInView, type HTMLMotionProps, type Transition, type Variants } from "motion/react";
import { createContext, useContext, useRef, type ReactNode } from "react";
import { useIntroGate } from "@/intro/introStore";
import { canObserveInView } from "@/motion/inView";
import { isSafeFx } from "@/motion/safeFx";
import { spring, stagger, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";

/**
 * Blur-fade entrance (21st.dev / magicui "Blur Fade"): `{opacity 0, y 14, blur 6px}` (Samsung-Internet-safe effects:
 * no blur) → rest once the element is
 * 15 % in view (viewport shrunk by 50 px). `y` rides `spring.enter`, opacity/filter `tween.reveal`; delay =
 * `min(index, stagger.max) · stagger.reveal`.
 *
 * Contract (see README / e2e):
 * - ends at `transform: none` (motion drops an identity transform) and `filter: none` (`transitionEnd`), so a
 *   finished reveal is never a containing block for `position: fixed` descendants – still: never wrap the
 *   ChartCard body (fixed marker ghost) in a reveal;
 * - no x offset (390 px viewport must not scroll horizontally);
 * - reduced motion, or no `IntersectionObserver` (jsdom/SSR): `initial={false}` and no trigger – content is
 *   simply there, nothing is ever left at opacity 0;
 * - intro: while the stage covers the app or the surrounding intro cell has not landed (`useIntroGate`), the reveal
 *   holds its start pose and triggers once the gate opens and the element is (or was) in view.
 */

export const REVEAL_FROM = { opacity: 0, y: 14, filter: "blur(6px)" } as const;
const REVEAL_TO = { opacity: 1, y: 0, filter: "blur(0px)", transitionEnd: { filter: "none" } } as const;
/** Samsung-Internet-safe effects (`data-safe-fx`, `@/motion/safeFx`): the same fade-up without the blur. */
export const REVEAL_FROM_SAFE = { opacity: 0, y: 14 } as const;
const REVEAL_TO_SAFE = { opacity: 1, y: 0 } as const;
const REVEAL_VIEWPORT = { once: true, amount: 0.15, margin: "-50px" } as const;
/** Rest pose for `settled`: identity, applied instantly (motion drops the identity transform → `transform: none`). */
const REVEAL_REST = { opacity: 1, y: 0, filter: "none" } as const;
const INSTANT: Transition = { duration: 0 };

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
  /** Skip the entrance and rest at the final pose (e.g. the intro already carried this element into place). */
  settled?: boolean;
  children?: ReactNode;
}

/** One element that blur-fades in when it scrolls into view (once). */
export function Reveal({ index = 0, delay = 0, as = "div", settled = false, children, ...rest }: RevealProps) {
  const enabled = useRevealEnabled();
  const gate = useIntroGate();
  const ref = useRef<HTMLDivElement>(null);
  // the observer runs independently of the gate, so an element already in view reveals the moment the gate opens
  const inView = useInView(ref, { ...REVEAL_VIEWPORT, initial: !enabled });
  // motion.li / motion.section share the div prop surface for everything Reveal passes through
  const Tag = motion[as] as typeof motion.div;
  if (!enabled) {
    return (
      <Tag ref={ref} initial={false} {...rest}>
        {children}
      </Tag>
    );
  }
  if (settled) {
    return (
      <Tag ref={ref} initial={false} animate={REVEAL_REST} transition={INSTANT} {...rest}>
        {children}
      </Tag>
    );
  }
  // a blur over a card revealed while the page scrolls is the heaviest compositor work on the tablet: safe effects fade only
  const [from, to] = isSafeFx() ? [REVEAL_FROM_SAFE, REVEAL_TO_SAFE] : [REVEAL_FROM, REVEAL_TO];
  return (
    <Tag ref={ref} initial={from} animate={gate && inView ? to : from} transition={revealTransition(revealDelay(index, delay))} {...rest}>
      {children}
    </Tag>
  );
}

const ITEM_VARIANTS: Variants = {
  hidden: REVEAL_FROM,
  shown: { ...REVEAL_TO, transition: { default: tween.reveal, y: spring.enter } },
};
const ITEM_VARIANTS_SAFE: Variants = {
  hidden: REVEAL_FROM_SAFE,
  shown: { ...REVEAL_TO_SAFE, transition: { default: tween.reveal, y: spring.enter } },
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
 * steps) once the group is 15 % in view (and the intro gate is open). Driven by `animate` (not `whileInView`), so items mounted later – a list
 * that grows after the reveal – still enter instead of staying hidden.
 */
export function RevealGroup({ delay = 0, as = "div", children, ...rest }: RevealGroupProps) {
  const enabled = useRevealEnabled();
  const gate = useIntroGate();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { ...REVEAL_VIEWPORT, initial: !enabled }) && gate;
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
    <Tag variants={enabled ? (isSafeFx() ? ITEM_VARIANTS_SAFE : ITEM_VARIANTS) : undefined} {...rest}>
      {children}
    </Tag>
  );
}
