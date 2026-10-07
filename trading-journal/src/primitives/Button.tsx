import { motion, type HTMLMotionProps } from "motion/react";
import { useRef, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { usePressable } from "@/motion/usePressable";
import { useReducedFx } from "@/motion/useReducedFx";
import { rippleGeometry, spawnRipple } from "@/primitives/ripple";

export type ButtonVariant = "ghost" | "primary" | "danger";
export type ButtonSize = "sm" | "md";

export const buttonBase =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl border font-semibold transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-50";
export const buttonVariant: Record<ButtonVariant, string> = {
  ghost: "border-line-2 bg-white/[0.03] text-fg hover:bg-white/[0.07] hover:border-steel/40",
  primary: "border-transparent bg-gradient-to-b from-white to-[#d6d6d6] text-ink-950 shadow-[inset_0_1px_0_rgb(255_255_255/0.6)] hover:to-white",
  danger: "border-signal/40 bg-signal/10 text-[#ff8a90] hover:bg-signal/20",
};
export const buttonSize: Record<ButtonSize, string> = { md: "px-4 py-2 text-[13px]", sm: "px-3 py-1.5 text-xs" };

/** Ripple ink per variant: white on dark, ink on the white primary, signal red on destructive. */
export const rippleColor: Record<ButtonVariant, string> = {
  ghost: "rgb(255 255 255 / 0.18)",
  primary: "rgb(4 4 4 / 0.14)",
  danger: "rgb(229 32 46 / 0.32)",
};

export interface ButtonProps extends Omit<HTMLMotionProps<"button">, "children"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children?: ReactNode;
  /** Press ripple from the pointer (keyboard: from the centre). Default true; never while disabled or under reduced motion. */
  ripple?: boolean;
}

/**
 * Bundle `Re`: `motion.button` with `whileTap {scale:.96}` on `spring.press` (none while disabled).
 * NEW: a variant-coloured press ripple grows from the exact pointer point (keyboard presses from the centre),
 * `tween.ripple`, transform/opacity only, inside an overflow-hidden layer behind the label. Coarse pointers: ≥ 44 px
 * tap area (`.touch-hit`, no layout change).
 */
export function Button({ variant = "ghost", size = "md", className, type = "button", disabled, ripple = true, children, onPointerDown, onKeyDown, ...props }: ButtonProps) {
  const press = usePressable({ disabled: Boolean(disabled) });
  const reduced = useReducedFx();
  const host = useRef<HTMLSpanElement>(null);
  const inked = ripple && !reduced;

  const fire = (el: HTMLElement, clientX?: number, clientY?: number) => {
    const layer = host.current;
    if (!inked || disabled || !layer) return;
    const r = el.getBoundingClientRect();
    const px = clientX === undefined ? r.width / 2 : clientX - r.left;
    const py = clientY === undefined ? r.height / 2 : clientY - r.top;
    spawnRipple(layer, rippleGeometry(r.width, r.height, px, py), rippleColor[variant]);
  };

  return (
    <motion.button
      type={type}
      disabled={disabled}
      {...press}
      // `touch-hit`: coarse pointers get a ≥ 44 × 44 tap area (sm is 30 px tall) without a layout change
      className={cn(buttonBase, "touch-hit relative isolate", buttonSize[size], buttonVariant[variant], className)}
      onPointerDown={(e: PointerEvent<HTMLButtonElement>) => {
        onPointerDown?.(e);
        if (e.button === 0) fire(e.currentTarget, e.clientX, e.clientY);
      }}
      onKeyDown={(e: KeyboardEvent<HTMLButtonElement>) => {
        onKeyDown?.(e);
        if ((e.key === "Enter" || e.key === " ") && !e.repeat) fire(e.currentTarget);
      }}
      {...props}
    >
      {inked && <span ref={host} aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden rounded-[inherit]" />}
      {children}
    </motion.button>
  );
}
