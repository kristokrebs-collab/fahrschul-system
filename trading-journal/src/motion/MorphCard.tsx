import { motion, type HTMLMotionProps } from "motion/react";
import { useEffect, useRef, useState, type ElementType, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { cn } from "@/lib/cn";
import { useMorphDialog } from "@/motion/MorphDialog";
import { contextSpringAt } from "@/motion/physics";
import { radius, spring, tween } from "@/motion/tokens";
import { usePressable } from "@/motion/usePressable";
import { useReducedFx } from "@/motion/useReducedFx";

/** Press feedback of a morph source: subtle enough not to read as a separate "click" before the morph takes over. */
const PRESS_SCALE = 0.985;
/** A `borderRadius` at or above this is a pill source (`radius.pill`): it morphs through a separate surface span. */
const PILL_RADIUS = 999;
/** Source content fade (OV-04/05): out the moment its dialog opens, back in once the reverse morph has landed. */
const CONTENT_OUT_MS = 60;
const AWAY_SURFACE = { zIndex: 2, backgroundColor: "var(--color-ink-800)" } as const;
const CONTENT_IN_MS = 200;

/**
 * Fades the direct children of `el` out while `away` and back in afterwards (WAAPI on opacity, compositor-only):
 * the morph only ever carries the empty surface, never scaled-up text. No-op on mount and under reduced motion.
 */
function useContentAway(ref: RefObject<HTMLElement | null>, away: boolean, reduced: boolean): void {
  const prev = useRef(away);
  useEffect(() => {
    if (prev.current === away) return;
    prev.current = away;
    const el = ref.current;
    if (!el || reduced || typeof el.animate !== "function") return;
    const anims = Array.from(el.children).map((k) =>
      k.animate([{ opacity: away ? 1 : 0 }, { opacity: away ? 0 : 1 }], { duration: away ? CONTENT_OUT_MS : CONTENT_IN_MS, easing: "ease-out", fill: away ? "forwards" : "none" }),
    );
    return () => anims.forEach((a) => a.cancel());
  }, [ref, away, reduced]);
}

export interface MorphCardProps {
  /** Shared id (→ `layoutId="morph-{id}"`), e.g. `fact-net`, `bt-{k}-{filter}`, `setup-rank-{id}`. */
  id: string;
  title: string;
  /** Dialog body, evaluated when opening. */
  body: () => ReactNode;
  children: ReactNode;
  className?: string;
  /** `button` (default) or `div` (role=button, Enter opens) when the card contains interactive children. */
  as?: "button" | "div";
  /** Source radius, default `radius.card` (16). Pills pass `radius.pill`. */
  borderRadius?: number;
  /** Extra width class for the dialog (e.g. `max-w-[720px]`). */
  dialogClassName?: string;
  /** Extra motion props forwarded to the source element (e.g. `layout`, `layoutDependency`). */
  motionProps?: Omit<HTMLMotionProps<"div">, "children" | "style" | "layoutId">;
}

/**
 * Morph source (Bundle `aa`): a `layoutId="morph-{id}"` element with `style.borderRadius` that opens
 * the shared `MorphDialog`. While the dialog's open morph has completed the source is
 * `visibility:hidden` (no `opacity-0` pop, rule 9) and becomes visible again the moment the dialog
 * starts closing so the reverse morph can crossfade into it; when that reverse morph finishes (or the card
 * unmounts) it reports back (`returned`) so the dialog can release `inert` and return focus.
 * Press feedback: `whileTap` scale .985 on `spring.press` (`usePressable`), switched off while its dialog is open
 * so the source is back at scale 1 whenever the shared layout measures it. After a swipe-dismiss the reverse morph runs
 * on `contextSpringAt(spring.morph, closeTempo)` (the token itself for every other close).
 *
 * Morph surface (OV-04/05): the source's content fades out the moment its dialog opens and back in after the reverse
 * morph, so the shared layout only ever scales an empty surface. Pill sources (`borderRadius >= 999`) keep their
 * label and border on the button and morph through a separate, invisible, childless `layoutId` span whose radius is
 * h/2 of the pill (measured at the click) – the panel grows out of the pill's real shape instead of a 9999 px oval.
 */
export function MorphCard({ id, title, body, children, className, as = "button", borderRadius = radius.card, dialogClassName, motionProps }: MorphCardProps) {
  const { open, settled, closing, closeTempo, show, returned } = useMorphDialog();
  const press = usePressable({ scale: PRESS_SCALE });
  const isOpen = open?.id === id;
  const hidden = isOpen && settled === id;
  const away = isOpen || closing === id;
  const reduced = useReducedFx();
  const srcRef = useRef<HTMLElement>(null);
  useContentAway(srcRef, away, reduced);
  const pill = borderRadius >= PILL_RADIUS;
  // pill surface radius = h/2 of the real pill (measured at the click): a 9999 radius would morph the panel through
  // a huge oval that cuts across its neighbours
  const [pillRadius, setPillRadius] = useState(14);
  const Tag = (as === "button" ? motion.button : motion.div) as ElementType;
  const openDialog = (el: HTMLElement) => {
    if (pill) setPillRadius(Math.max(1, el.offsetHeight / 2));
    show({ id, title, body, className: dialogClassName, pill });
  };
  const { onLayoutAnimationComplete, transition, ...restMotion } = motionProps ?? {};
  // reverse morph after a swipe: the release tempo picks a livelier context spring (the token itself at tempo 0)
  const morphSpring = closing === id && closeTempo > 0 ? contextSpringAt(spring.morph, closeTempo) : spring.morph;
  // a source that leaves while its dialog closes (page switch from inside the dialog) has no reverse morph to wait for
  useEffect(() => () => returned(id), [returned, id]);
  if (pill) {
    return (
      <Tag
        whileTap={isOpen ? undefined : press.whileTap}
        {...(as === "button" ? { type: "button" } : { role: "button", tabIndex: 0 })}
        onClick={(e: { currentTarget: HTMLElement }) => openDialog(e.currentTarget)}
        onKeyDown={
          as === "div"
            ? (e: KeyboardEvent<HTMLDivElement>) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  openDialog(e.currentTarget);
                }
              }
            : undefined
        }
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        className={cn("group relative isolate block w-full text-left", className)}
        style={{ borderRadius }}
        {...restMotion}
        transition={{ ...press.transition, ...transition }}
      >
        {/* the morph source: an empty, invisible surface with the pill's box (the dialog panel hides it on take-over) */}
        <motion.span
          aria-hidden="true"
          layoutId={`morph-${id}`}
          layoutDependency={isOpen}
          className="pointer-events-none invisible absolute inset-0 -z-10"
          style={{ borderRadius: pillRadius }}
          transition={{ layout: morphSpring }}
          onLayoutAnimationComplete={() => {
            onLayoutAnimationComplete?.();
            if (!isOpen) returned(id);
          }}
        />
        <motion.span
          className="relative block"
          initial={false}
          animate={{ opacity: away ? 0 : 1 }}
          transition={away ? { duration: 0.06, ease: "linear" } : tween.fade}
        >
          {children}
        </motion.span>
      </Tag>
    );
  }
  return (
    <Tag
      layoutId={`morph-${id}`}
      layoutDependency={isOpen}
      whileTap={isOpen ? undefined : press.whileTap}
      {...(as === "button" ? { type: "button" } : { role: "button", tabIndex: 0 })}
      onClick={(e: { currentTarget: HTMLElement }) => openDialog(e.currentTarget)}
      onKeyDown={
        as === "div"
          ? (e: KeyboardEvent<HTMLDivElement>) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                openDialog(e.currentTarget);
              }
            }
          : undefined
      }
      aria-haspopup="dialog"
      aria-expanded={isOpen}
      aria-hidden={hidden || undefined}
      ref={srcRef}
      className={cn("group relative block w-full text-left", className)}
      // while its dialog is up (and during the reverse morph) the source is an opaque surface above its neighbours:
      // nothing shows through it, and it never draws translucently over the tiles it slides across
      style={{ borderRadius, visibility: hidden ? "hidden" : undefined, ...(away ? AWAY_SURFACE : null) }}
      {...restMotion}
      transition={{ ...press.transition, layout: morphSpring, ...transition }}
      onLayoutAnimationComplete={() => {
        onLayoutAnimationComplete?.();
        if (!isOpen) returned(id);
      }}
    >
      {children}
    </Tag>
  );
}

export interface MorphTitleProps {
  /** The id of the surrounding `MorphCard` (→ `layoutId="morph-title-{id}"`). */
  id: string;
  as?: "span" | "dt" | "h3" | "div";
  className?: string;
  /** Strict measure trigger; defaults to whether this card's dialog is open (like `MorphCard`). */
  layoutDependency?: unknown;
  children: ReactNode;
}

/**
 * Title source inside a `MorphCard` – travels into the dialog head via `layoutId="morph-title-{id}"`. Measured only
 * when its dialog opens or closes (`layoutDependency`), so value / hover re-renders of the tile never force a layout read.
 */
export function MorphTitle({ id, as = "span", className, layoutDependency, children }: MorphTitleProps) {
  const { open } = useMorphDialog();
  const Tag = motion[as];
  return (
    <Tag layoutId={`morph-title-${id}`} layout="position" layoutDependency={layoutDependency ?? open?.id === id} className={className}>
      {children}
    </Tag>
  );
}
