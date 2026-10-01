import type { InputHTMLAttributes, Ref, TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export const inputClass =
  "w-full rounded-xl border border-line bg-ink-950/70 px-3 py-2 text-[13.5px] text-fg outline-none transition-[border-color,box-shadow] duration-200 placeholder:text-faint focus:border-white/40 focus:shadow-[0_0_0_3px_rgb(255_255_255/0.07)] disabled:opacity-40";

/** The control drops its CSS focus shadow: the glow is the pre-rendered ring layer next to it. */
const controlClass = "peer relative focus:shadow-none";
const invalidClass = "border-loss/60 focus:border-loss";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Number field: `inputMode="decimal"` + `font-mono` (Plan 2.5). */
  numeric?: boolean;
  invalid?: boolean;
  ref?: Ref<HTMLInputElement>;
  /** Classes for the wrapper (layout: width, grid placement); `className` styles the control itself. */
  wrapperClassName?: string;
}

/**
 * Focus glow + invalid pulse layers shared by `Input` and `Textarea`, both PRE-RENDERED (`--ring-glow-*`
 * box-shadows) and only faded/scaled: the ring settles from .985 to 1 while fading in on focus (`peer-focus`),
 * the pulse ring is driven by `shakeField` (opacity keyframes).
 */
function Rings({ invalid }: { invalid?: boolean }) {
  return (
    <>
      <span
        aria-hidden="true"
        data-input-ring=""
        className="pointer-events-none absolute inset-0 scale-[0.985] rounded-xl opacity-0 transition-[opacity,scale] duration-200 ease-out peer-focus:scale-100 peer-focus:opacity-100 peer-disabled:hidden"
        style={{ boxShadow: invalid ? "var(--ring-glow-invalid)" : "var(--ring-glow-input)" }}
      />
      <span
        aria-hidden="true"
        data-input-pulse=""
        className="pointer-events-none absolute inset-0 rounded-xl border border-loss opacity-0"
        style={{ boxShadow: "var(--ring-pulse-invalid)" }}
      />
    </>
  );
}

/**
 * Bundle `ze` input. NEW: wrapped in a `grid` box (`[data-input]`) that carries the pre-rendered focus glow and the
 * invalid pulse ring (`shakeField` / `Field invalidKey`), so focus feedback is compositor-only.
 */
export function Input({ numeric, invalid, className, wrapperClassName, ref, ...props }: InputProps) {
  return (
    <span data-input="" className={cn("relative grid w-full min-w-0", wrapperClassName)}>
      <input
        ref={ref}
        inputMode={numeric ? "decimal" : props.inputMode}
        aria-invalid={invalid || undefined}
        className={cn(inputClass, controlClass, numeric && "font-mono", invalid && invalidClass, className)}
        {...props}
      />
      <Rings invalid={invalid} />
    </span>
  );
}

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
  ref?: Ref<HTMLTextAreaElement>;
  wrapperClassName?: string;
}

/** Same recipe for `<textarea>`. */
export function Textarea({ className, invalid, wrapperClassName, ref, ...props }: TextareaProps) {
  return (
    <span data-input="" className={cn("relative grid w-full min-w-0", wrapperClassName)}>
      <textarea ref={ref} aria-invalid={invalid || undefined} className={cn(inputClass, controlClass, "min-h-[80px] resize-y", invalid && invalidClass, className)} {...props} />
      <Rings invalid={invalid} />
    </span>
  );
}
