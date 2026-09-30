import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

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
  className?: string;
}

/** Bundle `Ae`: `grid min-w-0 content-start gap-1.5` with a `.label` label; NEW: suffix + error. */
export function Field({ label, htmlFor, children, help, error, suffix, className }: FieldProps) {
  return (
    <div className={cn("grid min-w-0 content-start gap-1.5", className)}>
      <label htmlFor={htmlFor} className="label">
        {label}
      </label>
      {suffix ? (
        <div className="relative">
          <div className="[&>input]:pr-14">{children}</div>
          <span className="pointer-events-none absolute inset-y-0 right-3 grid place-items-center font-mono text-[12px] text-faint" aria-hidden="true">
            {suffix}
          </span>
        </div>
      ) : (
        children
      )}
      {error ? (
        <span id={htmlFor ? `${htmlFor}-error` : undefined} role="alert" className="text-[11px] text-loss">
          {error}
        </span>
      ) : (
        help && <span className="text-[11px] text-faint">{help}</span>
      )}
    </div>
  );
}
