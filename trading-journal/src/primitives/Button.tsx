import { motion, type HTMLMotionProps } from "motion/react";
import { useRef, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { usePressable } from "@/motion/usePressable";
import { useReducedFx } from "@/motion/useReducedFx";
import { rippleGeometry, spawnRipple } from "@/primitives/ripple";

/** Four roles: `primary` (one per card), `secondary` (default), `ghost` (quiet: Abbrechen, Zurück), `danger`. */
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

// Focus: the global outline is swapped for a pre-rendered ring (`--ring-glow-btn`, tokens.css / themes.css), no transition.
export const buttonBase =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl border font-semibold transition-colors duration-200 focus-visible:outline-none! focus-visible:shadow-(--ring-glow-btn) disabled:cursor-not-allowed disabled:opacity-50";
export const buttonVariant: Record<ButtonVariant, string> = {
  // a whisper of a rim, the fill carries the shape; hover only brightens the fill
  secondary: "border-line bg-white/[0.05] text-fg hover:bg-white/[0.09]",
  // no rim, no fill until hover
  ghost: "border-transparent text-mute hover:bg-white/[0.06] hover:text-fg",
  primary:
    "border-transparent bg-gradient-to-b from-white to-(--color-primary-btn-to) text-ink-950 shadow-(--shadow-btn-sheen) hover:to-white focus-visible:shadow-[var(--shadow-btn-sheen),var(--ring-glow-btn)]",
  danger: "border-(--color-danger)/40 bg-(--color-danger)/10 text-(--color-danger-text) hover:bg-(--color-danger)/20 focus-visible:shadow-(--ring-glow-btn-danger)",
};
export const buttonSize: Record<ButtonSize, string> = { md: "px-4 py-2 text-[13px]", sm: "px-3 py-1.5 text-xs" };

/** Ripple ink per variant: white on dark, ink on the white primary, signal red on destructive. */
export const rippleColor: Record<ButtonVariant, string> = {
  secondary: "rgb(var(--veil-rgb, 255 255 255) / 0.18)",
  ghost: "rgb(var(--veil-rgb, 255 255 255) / 0.18)",
  primary: "rgb(var(--veil-ink-rgb, 4 4 4) / 0.14)",
  danger: "rgb(229 32 46 / 0.32)",
};

/** Spinner ink while `loading` (the label is transparent then, the width stays). */
const spinnerInk: Record<ButtonVariant, string> = {
  secondary: "text-fg",
  ghost: "text-fg",
  primary: "text-ink-950",
  danger: "text-(--color-danger-text)",
};

export interface ButtonProps extends Omit<HTMLMotionProps<"button">, "children"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children?: ReactNode;
  /** Busy: the label turns transparent (width and height stay), a small spinner shows, clicks are ignored, `aria-busy`. */
  loading?: boolean;
  /** Press ripple from the pointer (keyboard: from the centre). Default true; never while disabled or under reduced motion. */
  ripple?: boolean;
}

/**
 * Bundle `Re`: `motion.button` with `whileTap {scale:.96}` on `spring.press` (none while disabled).
 * NEW: a variant-coloured press ripple grows from the exact pointer point (keyboard presses from the centre),
 * `tween.ripple`, transform/opacity only, inside an overflow-hidden layer behind the label. Coarse pointers: ≥ 44 px
 * tap area (`.touch-hit`, no layout change).
 */
export function Button({ variant = "secondary", size = "md", className, type = "button", disabled, loading = false, ripple = true, children, onPointerDown, onKeyDown, onClick, ...props }: ButtonProps) {
  const off = Boolean(disabled) || loading;
  const press = usePressable({ disabled: off });
  const reduced = useReducedFx();
  const host = useRef<HTMLSpanElement>(null);
  const inked = ripple && !reduced;

  const fire = (el: HTMLElement, clientX?: number, clientY?: number) => {
    const layer = host.current;
    if (!inked || off || !layer) return;
    const r = el.getBoundingClientRect();
    const px = clientX === undefined ? r.width / 2 : clientX - r.left;
    const py = clientY === undefined ? r.height / 2 : clientY - r.top;
    spawnRipple(layer, rippleGeometry(r.width, r.height, px, py), rippleColor[variant]);
  };

  return (
    <motion.button
      type={type}
      disabled={disabled}
      aria-busy={loading || undefined}
      data-loading={loading || undefined}
      {...press}
      // `touch-hit`: coarse pointers get a ≥ 44 × 44 tap area (sm is 30 px tall) without a layout change
      className={cn(buttonBase, "touch-hit relative isolate", buttonSize[size], buttonVariant[variant], loading && "text-transparent", className)}
      onPointerDown={(e: PointerEvent<HTMLButtonElement>) => {
        onPointerDown?.(e);
        if (e.button === 0) fire(e.currentTarget, e.clientX, e.clientY);
      }}
      onKeyDown={(e: KeyboardEvent<HTMLButtonElement>) => {
        onKeyDown?.(e);
        if ((e.key === "Enter" || e.key === " ") && !e.repeat) fire(e.currentTarget);
      }}
      onClick={(e) => {
        if (loading) return e.preventDefault();
        onClick?.(e);
      }}
      {...props}
    >
      {inked && <span ref={host} aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden rounded-[inherit]" />}
      {children}
      {loading && (
        <span aria-hidden="true" className={cn("pointer-events-none absolute inset-0 grid place-items-center", spinnerInk[variant])}>
          <span className="size-3.5 rounded-full border-2 border-current border-t-transparent motion-safe:animate-spin" />
        </span>
      )}
    </motion.button>
  );
}
