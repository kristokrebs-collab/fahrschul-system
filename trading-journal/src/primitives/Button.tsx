import { AnimatePresence, motion, type HTMLMotionProps } from "motion/react";
import { useRef, useState, type CSSProperties, type FocusEvent, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { attachMagnet } from "@/motion/buttonMagnet";
import { tween } from "@/motion/tokens";
import { usePressable } from "@/motion/usePressable";
import { useReducedFx } from "@/motion/useReducedFx";
import { BorderBeam } from "@/primitives/BorderBeam";
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

/** What the button reports back: `idle` (rest), `loading` (spinner), `success` (a ✓ draws, green wash), `error` (one short shake, red wash). */
export type ButtonStatus = "idle" | "loading" | "success" | "error";

/** The wash behind the label while `success` / `error`: solid green on the white primary, a veil on the rest. */
const washOk: Record<ButtonVariant, string> = { primary: "bg-win", secondary: "bg-win/15", ghost: "bg-win/15", danger: "bg-win/15" };
/** ✓ ink on that wash (the primary's ink flips with the theme, so it reads on the green in both). */
const checkInk: Record<ButtonVariant, string> = { primary: "text-ink-950", secondary: "text-win", ghost: "text-win", danger: "text-win" };

export interface ButtonProps extends Omit<HTMLMotionProps<"button">, "children"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children?: ReactNode;
  /** Busy: the label turns transparent (width and height stay), a small spinner shows, clicks are ignored, `aria-busy`. */
  loading?: boolean;
  /** Done: the label gives way to a ✓ that draws itself, a green wash fades in (width and height stay). The caller resets it (`useActionStatus`). */
  success?: boolean;
  /** Failed: the button shakes once and a red wash fades in; the label stays readable. The caller resets it. */
  error?: boolean;
  /** The same three states as one value (`loading` / `success` / `error` win when set). */
  status?: ButtonStatus;
  /** `false`: keep the label on `success` and only wash (the caller draws its own ✓, e.g. `CopyButton`). Default true. */
  statusIcon?: boolean;
  /** Press ripple from the pointer (keyboard: from the centre). Default true; never while disabled or under reduced motion. */
  ripple?: boolean;
  /**
   * Rich hover finish, only inside `[data-rich]` pages and only with a mouse: sweep shine (primary, secondary), label roll
   * (secondary with a plain-text label) and a fine magnet pull (large primary / secondary). `false` keeps the button exactly
   * as it was – for the main actions (save, pay, log in, delete) that keep their form and effect.
   */
  fx?: boolean;
  /** A coloured border run (a `BorderBeam` lap) while the mouse is over the button or the keyboard holds it, `[data-rich]` pages only: sparingly, for ONE highlighted action. */
  run?: boolean;
  /**
   * The busy indicator: `ring` (default, the small spinner) or `orbs` (six dots on a ring that breathe in turn – the order
   * button of the purchase flow; the CSS `.pay-orbs` comes with that chunk). Size and width of the button stay either way.
   */
  loader?: "ring" | "orbs";
}

/** `data-fx` tokens read by `controls.css` (`magnet` by this file). */
function fxTokens(variant: ButtonVariant, size: ButtonSize, text: boolean): string | undefined {
  const lead = variant === "primary" || variant === "secondary";
  const t: string[] = [];
  if (lead) t.push("shine");
  if (variant === "secondary" && text) t.push("roll");
  if (lead && size === "md") t.push("magnet");
  return t.length ? t.join(" ") : undefined;
}

/**
 * Bundle `Re`: `motion.button` with `whileTap {scale:.96}` on `spring.press` (none while disabled).
 * NEW: a variant-coloured press ripple grows from the exact pointer point (keyboard presses from the centre),
 * `tween.ripple`, transform/opacity only, inside an overflow-hidden layer behind the label. Coarse pointers: ≥ 44 px
 * tap area (`.touch-hit`, no layout change).
 */
export function Button({
  variant = "secondary",
  size = "md",
  className,
  type = "button",
  disabled,
  loading = false,
  success = false,
  error = false,
  status,
  statusIcon = true,
  fx = true,
  run = false,
  loader = "ring",
  ripple = true,
  children,
  onPointerDown,
  onPointerEnter,
  onPointerLeave,
  onFocus,
  onBlur,
  onKeyDown,
  onClick,
  ...props
}: ButtonProps) {
  const state: ButtonStatus = loading ? "loading" : success ? "success" : error ? "error" : (status ?? "idle");
  const busy = state === "loading";
  const off = Boolean(disabled) || busy;
  const press = usePressable({ disabled: off });
  const reduced = useReducedFx();
  const host = useRef<HTMLSpanElement>(null);
  const inked = ripple && !reduced;
  const tokens = fx ? fxTokens(variant, size, variant === "secondary" && typeof children === "string") : undefined;
  // `run`: the beam only exists while the pointer / keyboard is on the button (rich pages), so nothing loops at rest
  const [hot, setHot] = useState(false);
  const lean = tokens?.includes("magnet") && !reduced;
  const label = tokens?.includes("roll") ? (
    <span className="btn-roll" data-t={children as string}>
      <span>{children}</span>
    </span>
  ) : (
    children
  );
  const washed = state === "success" || state === "error";
  const checked = state === "success" && statusIcon;

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
      aria-busy={busy || undefined}
      data-loading={busy || undefined}
      data-status={state === "idle" ? undefined : state}
      data-variant={variant}
      data-fx={tokens}
      {...press}
      // `touch-hit`: coarse pointers get a ≥ 44 × 44 tap area (sm is 30 px tall) without a layout change
      className={cn(buttonBase, "touch-hit relative isolate", buttonSize[size], buttonVariant[variant], (busy || checked) && "text-transparent", className)}
      onPointerDown={(e: PointerEvent<HTMLButtonElement>) => {
        onPointerDown?.(e);
        if (e.button === 0) fire(e.currentTarget, e.clientX, e.clientY);
      }}
      onPointerEnter={
        lean || run
          ? (e: PointerEvent<HTMLButtonElement>) => {
              onPointerEnter?.(e);
              if (e.pointerType !== "mouse" || off || !e.currentTarget.closest("[data-rich]")) return;
              if (lean) attachMagnet(e.currentTarget, e.clientX, e.clientY);
              if (run) setHot(true);
            }
          : onPointerEnter
      }
      onPointerLeave={
        run
          ? (e: PointerEvent<HTMLButtonElement>) => {
              onPointerLeave?.(e);
              setHot(false);
            }
          : onPointerLeave
      }
      onFocus={
        run
          ? (e: FocusEvent<HTMLButtonElement>) => {
              onFocus?.(e);
              if (!off && e.currentTarget.matches(":focus-visible") && e.currentTarget.closest("[data-rich]")) setHot(true);
            }
          : onFocus
      }
      onBlur={
        run
          ? (e: FocusEvent<HTMLButtonElement>) => {
              onBlur?.(e);
              setHot(false);
            }
          : onBlur
      }
      onKeyDown={(e: KeyboardEvent<HTMLButtonElement>) => {
        onKeyDown?.(e);
        if ((e.key === "Enter" || e.key === " ") && !e.repeat) fire(e.currentTarget);
      }}
      onClick={(e) => {
        if (busy) return e.preventDefault();
        onClick?.(e);
      }}
      {...props}
    >
      {inked && <span ref={host} aria-hidden="true" className="btn-fx pointer-events-none absolute inset-0 -z-10 overflow-hidden rounded-[inherit]" />}
      {run && hot && !off && <BorderBeam size={70} duration={3} borderWidth={1.5} />}
      <AnimatePresence initial={false}>
        {washed && (
          <motion.span
            key={state}
            aria-hidden="true"
            className={cn("pointer-events-none absolute inset-0 -z-10 rounded-[inherit]", state === "success" ? washOk[variant] : "bg-loss/15")}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={tween.fade}
          />
        )}
      </AnimatePresence>
      {label}
      {busy && (
        <span aria-hidden="true" className={cn("pointer-events-none absolute inset-0 grid place-items-center", spinnerInk[variant])}>
          {loader === "orbs" ? (
            <span className="pay-orbs" data-testid="button-orbs">
              {[0, 1, 2, 3, 4, 5].map((k) => (
                <i key={k} style={{ "--k": k } as CSSProperties} />
              ))}
            </span>
          ) : (
            <span className="size-3.5 rounded-full border-2 border-current border-t-transparent motion-safe:animate-spin" />
          )}
        </span>
      )}
      {checked && (
        <span aria-hidden="true" className={cn("pointer-events-none absolute inset-0 grid place-items-center", checkInk[variant])}>
          <svg viewBox="0 0 16 16" className="fx-check size-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path pathLength={1} d="M3.5 8.5l3 3 6-7" />
          </svg>
        </span>
      )}
    </motion.button>
  );
}
