import { frame, motion, useMotionTemplate, useMotionValue, type HTMLMotionProps } from "motion/react";
import type { PointerEvent, ReactNode } from "react";
import { cn } from "@/lib/cn";
import { useReducedFx } from "@/motion/useReducedFx";
import { Label } from "@/primitives/Label";

export interface CardProps extends Omit<HTMLMotionProps<"div">, "children" | "title" | "style"> {
  children: ReactNode;
  /** Section title rendered as `<h2 class="label">` with the signal dot. */
  title?: ReactNode;
  /** Right-aligned header slot. */
  action?: ReactNode;
  /** `text-xs text-faint` note under the header. */
  note?: ReactNode;
  /** Skip the `flex h-full flex-col p-5` inner padding. */
  bare?: boolean;
  gradientSize?: number;
  /** Spotlight border colours (setup cards pass their colour as `gradientFrom`). */
  gradientFrom?: string;
  gradientTo?: string;
  gradientColor?: string;
  className?: string;
  innerClassName?: string;
}

/**
 * Spotlight card (Bundle `Xw`/`kt`, Plan 2.5 "Card"): pointer-tracked radial border gradient via
 * MotionValues + `useMotionTemplate` (measured in `frame.read`), sheen layer, glow layer, hover lift
 * (CSS 500 ms `ease.out`) and a PRE-RENDERED shadow layer crossfaded by opacity instead of a
 * `box-shadow` transition. Gated: no pointer tracking under reduced motion.
 */
export function Card({
  children,
  title,
  action,
  note,
  bare,
  gradientSize = 240,
  gradientFrom = "#9b9b9b",
  gradientTo = "#2c2c2c",
  gradientColor = "rgba(255,255,255,0.045)",
  className,
  innerClassName,
  ...rest
}: CardProps) {
  const reduced = useReducedFx();
  const x = useMotionValue(-gradientSize);
  const y = useMotionValue(-gradientSize);
  const border = useMotionTemplate`linear-gradient(var(--color-background) 0 0) padding-box, radial-gradient(${gradientSize}px circle at ${x}px ${y}px, ${gradientFrom}, ${gradientTo}, var(--color-border) 100%) border-box`;
  const glow = useMotionTemplate`radial-gradient(${gradientSize}px circle at ${x}px ${y}px, ${gradientColor}, transparent 100%)`;

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (reduced) return;
    const el = e.currentTarget;
    const { clientX, clientY } = e;
    frame.read(() => {
      const r = el.getBoundingClientRect();
      x.set(clientX - r.left);
      y.set(clientY - r.top);
    });
  };
  const reset = () => {
    x.set(-gradientSize);
    y.set(-gradientSize);
  };

  return (
    <div className="group relative h-full">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 rounded-2xl shadow-[0_18px_40px_rgb(0_0_0/0.35)] opacity-0 transition-[opacity,transform] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:-translate-y-0.5 group-hover:opacity-100"
      />
      <motion.div
        {...rest}
        onPointerMove={onPointerMove}
        onPointerLeave={reset}
        style={{ background: border, borderRadius: 16 }}
        className={cn(
          "group relative isolate h-full overflow-hidden rounded-2xl border border-transparent transition-[transform,box-shadow] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-0.5",
          className,
        )}
      >
        <div className="pointer-events-none absolute inset-px z-0 rounded-[inherit] bg-gradient-to-b from-white/[0.035] via-white/[0.01] to-transparent" />
        <motion.div className="pointer-events-none absolute inset-px z-0 rounded-[inherit] opacity-0 transition-opacity duration-300 group-hover:opacity-100" style={{ background: glow }} />
        <div className="relative z-10 h-full">
          {bare ? (
            children
          ) : (
            <div className={cn("flex h-full flex-col p-5", innerClassName)}>
              {(title || action || note) && (
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div className="grid gap-1">
                    {title && <Label>{title}</Label>}
                    {note && <span className="text-xs text-faint">{note}</span>}
                  </div>
                  {action}
                </div>
              )}
              {children}
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
