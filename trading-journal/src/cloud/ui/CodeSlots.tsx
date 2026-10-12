import { motion } from "motion/react";
import { useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { RollingDigits } from "@/motion/RollingDigits";
import { spring, stagger, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { useShake } from "@/primitives/fieldFx";

export const CODE_LENGTH = 6;

export interface CodeSlotsProps {
  value: string;
  onChange: (code: string) => void;
  /** Called once when the sixth digit lands. */
  onComplete?: (code: string) => void;
  /** Accessible name of the input. */
  label: string;
  disabled?: boolean;
  /** Changes to a new non-empty value → the row shakes (wrong code). */
  invalidKey?: string | number | null;
  /** Code accepted: the slots light up win-green one after another. */
  accepted?: boolean;
  autoFocus?: boolean;
  id?: string;
  className?: string;
}

/** Digits only, at most six (paste of "123 456" works). */
export function cleanCode(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, CODE_LENGTH);
}

/**
 * Six-slot one-time-code input (P09 2FA). ONE real `<input inputMode="numeric" autocomplete="one-time-code">` lies
 * over the slots (transparent, so paste, SMS / password-manager autofill, screen readers and the keyboard work as in a
 * normal field); the slots are an `aria-hidden` mirror:
 * - every digit rolls in on its own odometer (`RollingDigits`, from 0 to the typed digit on `spring.digit`);
 * - the active slot lifts (scale on `spring.pop`) with a white edge, empty slots show a dim dot;
 * - a wrong code shakes the row (`useShake`, `tween.shake`); an accepted code lights the slots win-green in a
 *   cascade (`stagger.letters`).
 * Reduced motion: no roll / lift / cascade, colour changes only.
 */
export function CodeSlots({ value, onChange, onComplete, label, disabled, invalidKey, accepted, autoFocus, id, className }: CodeSlotsProps) {
  const reduced = useReducedFx();
  const auto = useId();
  const inputId = id ?? `code-${auto}`;
  const [focused, setFocused] = useState(false);
  const { ref: row, shake } = useShake<HTMLDivElement>();
  const seenKey = useRef(invalidKey);
  useEffect(() => {
    if (seenKey.current === invalidKey) return;
    seenKey.current = invalidKey;
    if (invalidKey !== null && invalidKey !== undefined && invalidKey !== "") shake();
  }, [invalidKey, shake]);

  const digits = value.split("");
  const active = Math.min(value.length, CODE_LENGTH - 1);
  return (
    <div className={cn("relative mx-auto w-full max-w-[22rem]", className)}>
      <div ref={row} aria-hidden="true" className="grid grid-cols-6 gap-2 sm:gap-2.5">
        {Array.from({ length: CODE_LENGTH }, (_, i) => {
          const d = digits[i];
          const isActive = focused && !disabled && i === active && value.length < CODE_LENGTH;
          return (
            <motion.span
              key={i}
              data-slot={i}
              className={cn(
                "relative grid aspect-[4/5] place-items-center overflow-hidden rounded-xl border bg-ink-950/70 font-dot text-[26px] leading-none text-fg transition-colors duration-200",
                accepted ? "border-win/70 text-win" : isActive ? "border-white/60" : d ? "border-line-2" : "border-line",
              )}
              initial={false}
              animate={reduced ? undefined : { scale: isActive ? 1.06 : 1, y: accepted ? [0, -4, 0] : 0 }}
              transition={accepted ? { y: { ...tween.flash, delay: i * stagger.letters } } : { scale: spring.pop }}
            >
              <span className={cn("transition-opacity duration-200", d ? "opacity-100" : "opacity-0")}>
                <RollingDigits value={d ? Number(d) : 0} instant={reduced} />
              </span>
              {!d && <span className={cn("absolute size-1.5 rounded-full", isActive ? "bg-fg" : "bg-faint/60")} />}
              {isActive && !reduced && (
                <motion.span
                  className="pointer-events-none absolute inset-0 rounded-[inherit] shadow-[inset_0_0_18px_rgb(255_255_255/0.08)]"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={tween.fade}
                />
              )}
            </motion.span>
          );
        })}
      </div>
      <input
        id={inputId}
        aria-label={label}
        className="absolute inset-0 h-full w-full cursor-text rounded-xl bg-transparent text-transparent caret-transparent opacity-0 outline-none [font-size:16px]"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]*"
        maxLength={CODE_LENGTH + 2}
        value={value}
        disabled={disabled}
        autoFocus={autoFocus}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(e) => {
          const next = cleanCode(e.target.value);
          onChange(next);
          if (next.length === CODE_LENGTH && value.length !== CODE_LENGTH) onComplete?.(next);
        }}
      />
    </div>
  );
}
