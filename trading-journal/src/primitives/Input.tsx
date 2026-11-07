import { useCallback, useRef, type InputHTMLAttributes, type Ref, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export const inputClass =
  "w-full rounded-xl border border-line bg-ink-950/70 px-3 py-2 text-[13.5px] text-fg outline-none transition-[border-color,box-shadow] duration-200 placeholder:text-faint focus:border-white/40 focus:shadow-(--ring-focus-input) disabled:opacity-40";

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
  /** `type="search"` only: the round × (default true). `false` for a field that brings its own clear button. */
  clearable?: boolean;
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

/** Sets a React-controlled input's value from outside and lets React's `onChange` see it (the native setter + an `input` event). */
function clearInput(el: HTMLInputElement | null): void {
  if (!el) return;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(el, "");
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.focus();
}

/**
 * Bundle `ze` input. NEW: wrapped in a `grid` box (`[data-input]`) that carries the pre-rendered focus glow and the
 * invalid pulse ring (`shakeField` / `Field invalidKey`), so focus feedback is compositor-only.
 * `type="search"`: inside `[data-rich]` pages a round „×“ pops in (spring scale) as soon as there is text and clears it
 * (focus stays in the field); elsewhere the browser's own clear button stays. A search field without a placeholder gets a
 * blank one, so the CSS can tell „empty“ from „has text“.
 */
export function Input({ numeric, invalid, className, wrapperClassName, clearable = true, ref, ...props }: InputProps) {
  const own = useRef<HTMLInputElement | null>(null);
  const search = props.type === "search" && clearable;
  const setRef = useCallback(
    (el: HTMLInputElement | null) => {
      own.current = el;
      if (typeof ref === "function") ref(el);
      else if (ref) ref.current = el;
    },
    [ref],
  );
  return (
    <span data-input="" className={cn("relative grid w-full min-w-0", wrapperClassName)}>
      <input
        ref={setRef}
        inputMode={numeric ? "decimal" : props.inputMode}
        aria-invalid={invalid || undefined}
        // coarse pointers: ≥ 44 px tall (a 38 px field is hard to hit on a tablet)
        className={cn(inputClass, controlClass, "pointer-coarse:min-h-11", numeric && "font-mono", invalid && invalidClass, className)}
        {...props}
        placeholder={props.placeholder ?? (search ? " " : undefined)}
      />
      {search && (
        <button type="button" tabIndex={-1} aria-label="Suche leeren" className="fx-clear touch-hit" onClick={() => clearInput(own.current)}>
          <svg viewBox="0 0 12 12" className="size-3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
            <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" />
          </svg>
        </button>
      )}
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
