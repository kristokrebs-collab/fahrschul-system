import { animate, AnimatePresence, motion, type AnimationPlaybackControls, type Variants } from "motion/react";
import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { STAGGER_HIDDEN, STAGGER_SHOWN, withSectionStagger } from "@/motion/Stagger";
import { spring, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import type { AuthView } from "../types";

/**
 * The login card as ONE card that morphs between its steps (R11, A5 "Interaktionen"). Kept apart from `AuthSheet`, so the
 * sheet only says WHAT it shows and this file says HOW it moves – a later change of the sheet's content (the return path of
 * the purchase flow) does not touch the motion.
 *
 * Two levels:
 * - **Between modes of one step** (Anmelden · Link per E-Mail · Registrieren share the step `entry`): the form stays mounted.
 *   The e-mail field, the mode switch and the submit row keep their DOM (value, focus, the password manager's idea of the
 *   form) and glide (`layout="position"` on `spring.layout`); the fields that only one mode has (password strength, consent,
 *   the notes) slide in / out as `MorphItem`s. Nothing is reloaded, nothing jumps.
 * - **Between steps** (entry → 2FA code → e-mail sent → new password …): the old step leaves on `tween.exit` while the new one
 *   enters on `spring.enter`, both inside ONE box whose height springs (`MorphHeight`, the card follows its content; the
 *   sheet around it follows the card). The two steps are on screen together for a moment, never one after the other, so
 *   the card is never empty and the height changes once.
 *
 * Reduced motion: no slide, no glide – instant swaps. Only transform / opacity move; the one declared exception is the
 * height of the card (`MorphHeight`).
 */

/** Order of the steps / modes (slide direction of a switch). */
export const MODE_ORDER: Readonly<Record<string, number>> = { signin: 0, magic: 1, signup: 2, reset: 3, sent: 4, mfa: 5, newPassword: 6, welcome: 7, account: 8 };

/** The morph step a view belongs to: the three entry modes are ONE step (one mounted form), every other view is its own. */
export function stepOf(view: AuthView): string {
  return view === "signin" || view === "magic" || view === "signup" ? "entry" : view;
}

/** Slide direction of a switch from `prev` to `view`: forward (+1) or back (−1) in `MODE_ORDER`. */
export function slideDir(view: string, prev: string): 1 | -1 {
  return (MODE_ORDER[view] ?? 0) >= (MODE_ORDER[prev] ?? 0) ? 1 : -1;
}

/** A step slides in from its side (x ±16 on `spring.enter`, fade `tween.fade`) and cascades its sections. */
export function viewVariants(dir: number, reduced: boolean): Variants {
  return {
    [STAGGER_HIDDEN]: reduced ? { opacity: 0 } : { opacity: 0, x: 16 * dir },
    [STAGGER_SHOWN]: { opacity: 1, x: 0, transitionEnd: { transform: "none" }, transition: withSectionStagger({ x: spring.enter, opacity: tween.fade }) },
  };
}

/** Focus lands on the first usable field of a new step when focus was lost with the old one (the old field is gone). */
export function focusFirstField(root: ParentNode | null): boolean {
  const el = root?.querySelector<HTMLElement>('[data-autofocus], input:not([type="hidden"]):not([disabled]), button:not([disabled])') ?? null;
  if (!el) return false;
  el.focus({ preventScroll: true });
  return true;
}

export interface AuthMorphProps {
  view: AuthView;
  /** Direction of the slide (`slideDir`). */
  dir: number;
  /** The body of the current view (`AuthSheet`'s `ViewBody`). */
  children: ReactNode;
}

/**
 * The card's height follows its content on a spring when the VIEW changes. Unlike `AutoHeight` (which pins the height from a
 * ResizeObserver callback, after the layout phase) the old height is pinned in a layout effect of the very commit that swaps the
 * content – before the sheet's panel (a `layoutId` / layout node when it morphed out of the header pill) measures itself. The panel
 * then sees no size change at the switch and does not run its own FLIP on top of this one; it simply follows the box as it grows.
 * Declared exception to "transform/opacity only", like `AutoHeight` and `Collapse`: the height of ONE box, only around a view change.
 * Changes that do not come with a view change (an error line appearing) are left to the panel as before.
 */
function MorphHeight({ trigger, className, children }: { trigger: string; className?: string; children: ReactNode }) {
  const reduced = useReducedFx();
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const known = useRef(0);
  const run = useRef<AnimationPlaybackControls | null>(null);
  useLayoutEffect(() => {
    const box = outer.current;
    const content = inner.current;
    // the mount commit reads nothing (a layout read there would force layout inside the click that opens the sheet): the observer below sets the baseline
    if (!box || !content || !known.current) return;
    const next = content.offsetHeight;
    const prev = run.current ? (parseFloat(box.style.height) || known.current) : known.current;
    known.current = next;
    if (!prev || reduced || Math.abs(next - prev) < 1) return;
    run.current?.stop();
    box.style.height = `${prev}px`;
    const controls = animate(prev, next, {
      ...spring.layout,
      onUpdate: (v) => {
        box.style.height = `${v}px`;
      },
      onComplete: () => {
        if (run.current !== controls) return;
        run.current = null;
        box.style.height = "";
      },
    });
    run.current = controls;
  }, [trigger, reduced]);
  // the baseline for the first switch, and any change that is not a switch (kept current only while nothing animates)
  useEffect(() => {
    const content = inner.current;
    if (!content || typeof ResizeObserver !== "function") return;
    const ro = new ResizeObserver(() => {
      if (!run.current) known.current = content.offsetHeight;
    });
    ro.observe(content);
    return () => {
      ro.disconnect();
      run.current?.stop();
    };
  }, []);
  return (
    <div ref={outer} className={className} style={{ overflowY: "clip" }}>
      <div ref={inner} className="flow-root">
        {children}
      </div>
    </div>
  );
}

/** The morphing card: one height-following box, the steps cross over inside it. */
export function AuthMorph({ view, dir, children }: AuthMorphProps) {
  const reduced = useReducedFx();
  const step = stepOf(view);
  const box = useRef<HTMLDivElement>(null);
  const first = useRef(true);

  // the step changed and the focus fell out of the sheet with the old step's field: put it on the new step's first field
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const id = requestAnimationFrame(() => {
      const el = box.current;
      const a = document.activeElement;
      if (!el) return;
      if (!a || a === document.body || (a instanceof HTMLElement && !a.isConnected)) focusFirstField(el.querySelector("[data-morph-step]:last-of-type") ?? el);
    });
    return () => cancelAnimationFrame(id);
  }, [step]);

  return (
    <MorphHeight trigger={view} className="-m-1 p-1">
      <div ref={box} className="relative" data-auth-morph={step}>
        {/* variant LABELS (not objects): the sheet body's hidden → shown reaches this step's `StaggerItem`s, also for a step that mounts later */}
        <AnimatePresence initial={false} mode="popLayout" custom={dir}>
          <motion.div
            key={step}
            data-morph-step=""
            custom={dir}
            variants={viewVariants(dir, reduced)}
            exit={reduced ? { opacity: 0, transition: tween.exit } : { opacity: 0, x: -12 * dir, transition: tween.exit }}
            className="grid gap-4"
          >
            {children}
          </motion.div>
        </AnimatePresence>
      </div>
    </MorphHeight>
  );
}

export interface MorphItemProps {
  /** Mounted while `true`; goes out with its exit when it turns `false`. */
  show?: boolean;
  /** A change of the key swaps the content (the old one leaves while the new one arrives). */
  itemKey?: string;
  className?: string;
  children: ReactNode;
}

/**
 * A block that only some modes have: it slides in from above (`y −10 → 0`, `spring.enter`, fade) and leaves upwards on `tween.exit`
 * while the blocks below glide to their new places (`layout="position"` – they are `MorphItem`s or `StaggerItem layout="position"`
 * themselves). The parent must be `relative` (the leaving block is taken out of the flow at once, `popLayout`).
 */
export function MorphItem({ show = true, itemKey = "item", className, children }: MorphItemProps) {
  const reduced = useReducedFx();
  return (
    <AnimatePresence initial={false} mode="popLayout">
      {show && (
        <motion.div
          key={itemKey}
          layout="position"
          className={className}
          initial={reduced ? false : { opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0, transitionEnd: { transform: "none" } }}
          exit={reduced ? { opacity: 0, transition: tween.exit } : { opacity: 0, y: -6, transition: tween.exit }}
          transition={{ y: spring.enter, opacity: tween.fade, layout: spring.layout }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
