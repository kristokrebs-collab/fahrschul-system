import { animate, motion, useMotionValue, useTransform, type AnimationPlaybackControls, type HTMLMotionProps } from "motion/react";
import { useEffect, useImperativeHandle, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode, type Ref } from "react";
import { cn } from "@/lib/cn";
import { dwell, spring, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { buttonBase, buttonSize, buttonVariant, type ButtonSize, type ButtonVariant } from "@/primitives/Button";

export type HoldPhase = "idle" | "holding" | "armed" | "done";

type ControlledHandlers =
  | "ref"
  | "children"
  | "type"
  | "style"
  | "onClick"
  | "onPointerDown"
  | "onPointerUp"
  | "onPointerLeave"
  | "onPointerCancel"
  | "onKeyDown"
  | "onKeyUp"
  | "onBlur"
  | "onContextMenu";

export interface HoldButtonProps extends Omit<HTMLMotionProps<"button">, ControlledHandlers> {
  /** Visible label and accessible name (stays stable while holding). */
  children: ReactNode;
  /** Runs once the hold completes (or the assistive-tech fallback is confirmed). */
  onConfirm: () => void;
  /**
   * End of a press: `true` right after a completed hold (after `onConfirm`), `false` for a press released early
   * (pointer up, Enter / Space up) and – with `fallback={false}` – for an activation without a hold (assistive tech,
   * `element.click()`). Cancels (pointer leaves, pointer cancel, blur, Escape) never report.
   */
  onRelease?: (completed: boolean) => void;
  /** The native button (focus hand-off, measuring). */
  ref?: Ref<HTMLButtonElement>;
  /** Label crossfaded in while holding (visual only). */
  holdLabel?: string;
  /** Label (and accessible name) while the fallback waits for its confirming second activation. */
  armedLabel?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Hold duration in seconds (default `tween.hold`). */
  duration?: number;
  /**
   * Clicks that carry no pointer/keyboard hold (screen readers, switch access, `element.click()`) arm the button;
   * a second activation within 4 s confirms. Default true.
   */
  fallback?: boolean;
  /** Optional leading icon (decorative). */
  icon?: ReactNode;
}

const SHAKE_X = [0, -4, 4, -3, 3, 0];

const FILL: Record<ButtonVariant, string> = { danger: "bg-signal/35", ghost: "bg-white/[0.12]", primary: "bg-ink-950/20" };

/**
 * Hold-to-confirm for destructive actions (21st.dev / motion.dev "Hold to Confirm"). Press and hold: a fill sweeps
 * left → right linearly (`tween.hold`) while the button eases to scale .97 and the label crossfades to `holdLabel`.
 * Releasing early springs the fill back (`spring.press`) and shakes once (`tween.shake`). Completion flashes the fill,
 * draws a check (`tween.check`), ticks the haptics and calls `onConfirm`.
 *
 * Keyboard: hold Enter or Space. Assistive tech: the `fallback` arms on the first activation and confirms on the
 * second. Reduced motion keeps the hold mechanic but drops the scale, shake and check draw.
 */
export function HoldButton({
  children,
  onConfirm,
  onRelease,
  ref,
  holdLabel = "Halten …",
  armedLabel = "Zum Bestätigen erneut auslösen",
  variant = "danger",
  size = "md",
  duration = tween.hold.duration,
  fallback = true,
  icon,
  disabled,
  className,
  title = "Gedrückt halten zum Bestätigen",
  ...rest
}: HoldButtonProps) {
  const reduced = useReducedFx();
  const [phase, setPhase] = useState<HoldPhase>("idle");
  const progress = useMotionValue(0);
  const scale = useTransform(progress, [0, 1], [1, 0.97]);
  const labelOpacity = useTransform(progress, [0, 0.12], [1, 0]);
  const holdOpacity = useTransform(progress, [0.04, 0.18], [0, 1]);
  const btnRef = useRef<HTMLButtonElement>(null);
  const flashRef = useRef<HTMLSpanElement>(null);
  const confirmRef = useRef(onConfirm);
  const releaseRef = useRef(onRelease);
  useImperativeHandle(ref, () => btnRef.current as HTMLButtonElement, []);
  const m = useRef({ phase: "idle" as HoldPhase, controls: null as AnimationPlaybackControls | null, key: null as string | null, armTimer: 0, doneTimer: 0, reduced, duration });

  useEffect(() => {
    confirmRef.current = onConfirm;
    releaseRef.current = onRelease;
    m.current.reduced = reduced;
    m.current.duration = duration;
  }, [onConfirm, onRelease, reduced, duration]);

  useEffect(() => {
    const s = m.current;
    return () => {
      s.controls?.stop();
      clearTimeout(s.armTimer);
      clearTimeout(s.doneTimer);
    };
  }, []);

  const go = (next: HoldPhase) => {
    m.current.phase = next;
    setPhase(next);
  };

  const complete = () => {
    const s = m.current;
    s.controls?.stop();
    s.controls = null;
    s.key = null;
    clearTimeout(s.armTimer);
    progress.set(1);
    go("done");
    if (typeof navigator !== "undefined") navigator.vibrate?.(12);
    if (flashRef.current) animate(flashRef.current, { opacity: [s.reduced ? 0.25 : 0.45, 0] }, tween.flash);
    s.doneTimer = window.setTimeout(() => {
      go("idle");
      s.controls = animate(progress, 0, spring.press);
    }, dwell.holdCheck * 1000);
    confirmRef.current();
    releaseRef.current?.(true);
  };

  const start = () => {
    const s = m.current;
    if (disabled || s.phase === "done" || s.phase === "holding") return;
    clearTimeout(s.armTimer);
    s.controls?.stop();
    go("holding");
    const remaining = Math.max(0.05, s.duration * (1 - progress.get()));
    s.controls = animate(progress, 1, { ...tween.hold, duration: remaining, onComplete: complete });
  };

  /** `up`: the press ended (reported via `onRelease(false)`); `cancel`: it was aborted (leave, blur, Escape). */
  const release = (how: "up" | "cancel") => {
    const s = m.current;
    if (s.phase !== "holding") return;
    s.controls?.stop();
    const tapped = progress.get() < 0.2;
    go("idle");
    s.controls = animate(progress, 0, spring.press);
    if (tapped && !s.reduced && btnRef.current) animate(btnRef.current, { x: SHAKE_X }, tween.shake);
    if (how === "up") releaseRef.current?.(false);
  };
  const releaseUp = () => release("up");
  const cancel = () => release("cancel");

  const onPointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    start();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const s = m.current;
    if (e.key === "Escape") {
      s.key = null;
      cancel();
      return;
    }
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault(); // no native click: the hold decides
    if (e.repeat || s.key) return;
    s.key = e.key;
    start();
  };

  const onKeyUp = (e: KeyboardEvent<HTMLButtonElement>) => {
    const s = m.current;
    if (e.key !== s.key) return;
    e.preventDefault();
    s.key = null;
    releaseUp();
  };

  const onClick = (e: MouseEvent<HTMLButtonElement>) => {
    // pointer clicks (detail ≥ 1) are handled by the hold; detail 0 = AT / programmatic activation
    if (e.detail !== 0 || disabled) return;
    if (!fallback) {
      releaseRef.current?.(false);
      return;
    }
    const s = m.current;
    if (s.phase === "armed") {
      complete();
      return;
    }
    if (s.phase !== "idle") return;
    go("armed");
    s.armTimer = window.setTimeout(() => {
      if (m.current.phase === "armed") go("idle");
    }, dwell.armed * 1000);
  };

  return (
    <motion.button
      ref={btnRef}
      type="button"
      disabled={disabled}
      title={title}
      data-state={phase}
      className={cn(
        buttonBase,
        buttonSize[size],
        buttonVariant[variant],
        "relative isolate touch-manipulation select-none overflow-hidden [-webkit-touch-callout:none]",
        className,
      )}
      style={reduced ? undefined : { scale }}
      onPointerDown={onPointerDown}
      onPointerUp={releaseUp}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onBlur={cancel}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
      onClick={onClick}
      onContextMenu={(e) => e.preventDefault()}
      {...rest}
    >
      <motion.span aria-hidden="true" className={cn("pointer-events-none absolute inset-0 -z-10", FILL[variant])} style={{ scaleX: progress, originX: 0 }} />
      <span ref={flashRef} aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 bg-white opacity-0" />
      <span className="relative inline-grid place-items-center">
        <motion.span className="col-start-1 row-start-1 inline-flex items-center gap-2" style={{ opacity: labelOpacity }}>
          {icon}
          {phase === "armed" ? armedLabel : children}
        </motion.span>
        <motion.span
          aria-hidden="true"
          data-label={holdLabel}
          className="col-start-1 row-start-1 whitespace-nowrap before:content-[attr(data-label)]"
          style={{ opacity: phase === "done" ? 0 : holdOpacity }}
        />
        {phase === "done" && (
          <svg aria-hidden="true" viewBox="0 0 16 16" className="col-start-1 row-start-1 size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <motion.path d="M3.5 8.5l3 3 6-7" initial={reduced ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={tween.check} />
          </svg>
        )}
      </span>
    </motion.button>
  );
}
