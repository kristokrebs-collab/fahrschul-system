import { motion, type HTMLMotionProps } from "motion/react";
import type { ElementType, KeyboardEvent, ReactNode } from "react";
import { cn } from "@/lib/cn";
import { useMorphDialog } from "@/motion/MorphDialog";
import { radius, spring } from "@/motion/tokens";

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
 * starts closing so the reverse morph can crossfade into it.
 */
export function MorphCard({ id, title, body, children, className, as = "button", borderRadius = radius.card, dialogClassName, motionProps }: MorphCardProps) {
  const { open, settled, show } = useMorphDialog();
  const isOpen = open?.id === id;
  const hidden = isOpen && settled === id;
  const Tag = (as === "button" ? motion.button : motion.div) as ElementType;
  const openDialog = () => show({ id, title, body, className: dialogClassName });
  return (
    <Tag
      layoutId={`morph-${id}`}
      layoutDependency={isOpen}
      transition={{ layout: spring.morph }}
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
      {...motionProps}
    >
      {children}
    </Tag>
  );
}

export interface MorphTitleProps {
  id: string;
  as?: "span" | "dt" | "h3" | "div";
  className?: string;
  children: ReactNode;
}

/** Title source inside a `MorphCard` – travels into the dialog head via `layoutId="morph-title-{id}"`. */
export function MorphTitle({ id, as = "span", className, children }: MorphTitleProps) {
  const Tag = motion[as];
  return (
    <Tag layoutId={`morph-title-${id}`} layout="position" className={className}>
      {children}
    </Tag>
  );
}
