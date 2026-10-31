import { motion } from "motion/react";
import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { shakeField } from "@/primitives/fieldFx";

export interface FieldProps {
  label: ReactNode;
  htmlFor?: string;
  children: ReactNode;
  /** Help text under the control (`text-[11px] text-faint`). */
  help?: ReactNode;
  /** Error text (`text-[11px] text-loss`), `role="alert"`; consumers link it via `aria-describedby={`${htmlFor}-error`}`. */
  error?: ReactNode;
  /** Unit suffix inside the control (`USDT`, `x`, `%`). */
  suffix?: ReactNode;
  /**
   * Shake + invalid-border pulse trigger: every time this changes to a new non-empty value (e.g. a submit counter
   * or `Date.now()` of the failed save) the field shakes once. Never fires on mount.
   */
  invalidKey?: string | number | null;
  className?: string;
}

/**
 * Bundle `Ae`: `grid min-w-0 content-start gap-1.5` with a `.label` label; suffix + error. NEW: `[data-field]` root
 * so `shakeField(inputOrId)` shakes the whole field, `invalidKey` for the prop-driven shake, error line fades in.
 */
export function Field({ label, htmlFor, children, help, error, suffix, invalidKey, className }: FieldProps) {
  const reduced = useReducedFx();
  const root = useRef<HTMLDivElement>(null);
  const seenKey = useRef(invalidKey);

  useEffect(() => {
    if (seenKey.current === invalidKey) return;
    seenKey.current = invalidKey;
    if (invalidKey === null || invalidKey === undefined || invalidKey === "") return;
    shakeField(root.current, { reduced });
  }, [invalidKey, reduced]);

  return (
    <div ref={root} data-field="" className={cn("grid min-w-0 content-start gap-1.5", className)}>
      <label htmlFor={htmlFor} className="label">
        {label}
      </label>
      {suffix ? (
        <div className="relative">
          <div className="[&_input]:pr-14">{children}</div>
          <span className="pointer-events-none absolute inset-y-0 right-3 grid place-items-center font-mono text-[12px] text-faint" aria-hidden="true">
            {suffix}
          </span>
        </div>
      ) : (
        children
      )}
      {error ? (
        <motion.span
          id={htmlFor ? `${htmlFor}-error` : undefined}
          role="alert"
          className="text-[11px] text-loss"
          initial={reduced ? false : { opacity: 0, y: -3 }}
          animate={{ opacity: 1, y: 0 }}
          transition={tween.fade}
        >
          {error}
        </motion.span>
      ) : (
        help && <span className="text-[11px] text-faint">{help}</span>
      )}
    </div>
  );
}
