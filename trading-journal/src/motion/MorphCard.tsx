import { motion, type HTMLMotionProps } from "motion/react";
import { useEffect, type ElementType, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { useMorphDialog } from "@/motion/MorphDialog";
import { radius, spring } from "@/motion/tokens";
import { usePressable } from "@/motion/usePressable";

/** Press feedback of a morph source: subtle enough not to read as a separate "click" before the morph takes over. */
const PRESS_SCALE = 0.985;

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
 * so the source is back at scale 1 whenever the shared layout measures it.
 */
export function MorphCard({ id, title, body, children, className, as = "button", borderRadius = radius.card, dialogClassName, motionProps }: MorphCardProps) {
  const { open, settled, show, returned } = useMorphDialog();
  const press = usePressable({ scale: PRESS_SCALE });
  const isOpen = open?.id === id;
  const hidden = isOpen && settled === id;
  const Tag = (as === "button" ? motion.button : motion.div) as ElementType;
  const openDialog = () => show({ id, title, body, className: dialogClassName });
  const { onLayoutAnimationComplete, transition, ...restMotion } = motionProps ?? {};
  // a source that leaves while its dialog closes (page switch from inside the dialog) has no reverse morph to wait for
  useEffect(() => () => returned(id), [returned, id]);
  return (
    <Tag
      layoutId={`morph-${id}`}
      layoutDependency={isOpen}
      whileTap={isOpen ? undefined : press.whileTap}
      {...(as === "button" ? { type: "button" } : { role: "button", tabIndex: 0 })}
      onClick={openDialog}
      onKeyDown={
        as === "div"
          ? (e: KeyboardEvent<HTMLDivElement>) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                openDialog();
              }
            }
          : undefined
      }
      aria-haspopup="dialog"
      aria-expanded={isOpen}
      aria-hidden={hidden || undefined}
      className={cn("group relative block w-full text-left", className)}
      style={{ borderRadius, visibility: hidden ? "hidden" : undefined }}
      {...restMotion}
      transition={{ ...press.transition, layout: spring.morph, ...transition }}
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
