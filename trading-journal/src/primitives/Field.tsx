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
  /** A field the form cannot be saved without: a small "Pflicht" after the label (generated content, so part of the accessible name; `data-required` on the label). Optional fields stay unmarked. */
  required?: boolean;
  /**
   * Shake + invalid-border pulse trigger: every time this changes to a new non-empty value (e.g. a submit counter
   * or `Date.now()` of the failed save) the field shakes once. Never fires on mount.
   */
  invalidKey?: string | number | null;
  className?: string;
}

/**
 * Bundle `Ae`: `grid min-w-0 content-start gap-1.5` with a `.label` label; suffix + error. NEW: `[data-field]` root
 * so `shakeField(inputOrId)` shakes the whole field, `invalidKey` for the prop-driven shake, error line fades in. An `error`
 * that newly appears (no `invalidKey` given) shakes the field once too. `[data-rich]` pages: the label lights up while the
 * field has focus and turns loss-red while the control is `aria-invalid` (`controls.css`).
 */
export function Field({ label, htmlFor, children, help, error, suffix, required, invalidKey, className }: FieldProps) {
  const reduced = useReducedFx();
  const root = useRef<HTMLDivElement>(null);
  const seenKey = useRef(invalidKey);

  // an error that appears without an `invalidKey` shakes the field once as well (it never fires on mount)
  const hadError = useRef(Boolean(error));
  useEffect(() => {
    const has = Boolean(error);
    const appeared = has && !hadError.current;
    hadError.current = has;
    if (appeared && invalidKey === undefined) shakeField(root.current, { reduced });
  }, [error, invalidKey, reduced]);

  useEffect(() => {
    if (seenKey.current === invalidKey) return;
    seenKey.current = invalidKey;
    if (invalidKey === null || invalidKey === undefined || invalidKey === "") return;
    shakeField(root.current, { reduced });
  }, [invalidKey, reduced]);

  return (
    <div ref={root} data-field="" className={cn("grid min-w-0 content-start gap-1.5", className)}>
      {/* the marker is generated content (`::after`), not label text: the control keeps the name "Preis" for tests and search, assistive technology
          reads the generated "Pflicht" as part of the accessible name */}
      <label
        htmlFor={htmlFor}
        className={cn("label", required && "after:ml-1.5 after:font-mono after:text-[9.5px] after:font-medium after:normal-case after:tracking-[0.08em] after:text-mute after:content-['Pflicht']")}
        data-required={required ? "" : undefined}
      >
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
