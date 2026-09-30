import type { InputHTMLAttributes, Ref } from "react";
import { cn } from "@/lib/cn";

export const inputClass =
  "w-full rounded-xl border border-line bg-ink-950/70 px-3 py-2 text-[13.5px] text-fg outline-none transition-[border-color,box-shadow] duration-200 placeholder:text-faint focus:border-white/40 focus:shadow-[0_0_0_3px_rgb(255_255_255/0.07)] disabled:opacity-40";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Number field: `inputMode="decimal"` + `font-mono` (Plan 2.5). */
  numeric?: boolean;
  invalid?: boolean;
  ref?: Ref<HTMLInputElement>;
}

/** Bundle `ze` input. */
export function Input({ numeric, invalid, className, ref, ...props }: InputProps) {
  return (
    <input
      ref={ref}
      inputMode={numeric ? "decimal" : props.inputMode}
      aria-invalid={invalid || undefined}
      className={cn(inputClass, numeric && "font-mono", invalid && "border-loss/60 focus:border-loss", className)}
      {...props}
    />
  );
}

/** Same recipe for `<textarea>`. */
export function Textarea({ className, invalid, ...props }: InputHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean; rows?: number }) {
  return <textarea aria-invalid={invalid || undefined} className={cn(inputClass, "min-h-[80px] resize-y", invalid && "border-loss/60 focus:border-loss", className)} {...props} />;
}
