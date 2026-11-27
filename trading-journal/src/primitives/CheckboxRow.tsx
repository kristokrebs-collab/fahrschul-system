import { animate } from "motion/react";
import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { spring, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { GlyphCheck } from "@/primitives/icons";

export interface CheckboxRowProps {
  checked: boolean;
  onToggle: () => void;
  children: ReactNode;
  /** Secondary line (`text-[11px] text-faint`). */
  sub?: ReactNode;
  disabled?: boolean;
  /**
   * To-do style: when checked, a strike line draws across the label (every wrapped line, left → right) and the
   * label dims. The drawn line needs a plain-string label; other labels get a static line-through.
   */
  strike?: boolean;
  className?: string;
}

/**
 * Bundle `Ff`: `role="checkbox"` row, box `size-[18px] rounded-md border`, check `M3.5 8.5l3 3 6-7` drawn via
 * `pathLength` (`tween.check`, `initial:false`). NEW (21st.dev "Animated Checkbox"): the box pops on `spring.pop`
 * (from .8 when checking, .92 when unchecking) while a pre-rendered fill scales in; the row tint (`border-teal/35
 * bg-teal/[0.07]`) is a pre-rendered layer crossfaded by opacity; optional strike draw (`.fx-strike`, clip-path).
 * Reduced motion: no pop, instant states.
 */
export function CheckboxRow({ checked, onToggle, children, sub, disabled, strike = false, className }: CheckboxRowProps) {
  const reduced = useReducedFx();
  const box = useRef<HTMLSpanElement>(null);
  const shown = useRef(checked);

  useEffect(() => {
    if (shown.current === checked) return;
    shown.current = checked;
    if (reduced || !box.current) return;
    animate(box.current, { scale: [checked ? 0.8 : 0.92, 1] }, spring.pop);
  }, [checked, reduced]);

  const drawn = strike && typeof children === "string";

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      data-checked={checked ? "true" : "false"}
      disabled={disabled}
      onClick={onToggle}
      className={cn(
        "relative isolate flex w-full items-start gap-3 rounded-xl border border-line bg-ink-950/40 px-3 py-2.5 text-left transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-50",
        !checked && "hover:border-line-2",
        className,
      )}
    >
      <span
        aria-hidden="true"
        data-tint=""
        className={cn(
          "pointer-events-none absolute -inset-px -z-10 rounded-[inherit] border border-teal/35 bg-teal/[0.07] transition-opacity duration-200 ease-out",
          checked ? "opacity-100" : "opacity-0",
        )}
      />
      <span ref={box} data-box="" className={cn("relative mt-0.5 grid size-[18px] shrink-0 place-items-center rounded-md border", checked ? "border-teal" : "border-line-2")}>
        <span
          aria-hidden="true"
          className={cn(
            "absolute -inset-px rounded-[inherit] bg-teal transition-[opacity,scale] duration-200 ease-out",
            checked ? "scale-100 opacity-100" : "scale-50 opacity-0",
          )}
        />
        <GlyphCheck className="relative size-3" style={{ color: "var(--color-ink-950)" }} drawn={checked} transition={reduced ? { duration: 0 } : tween.check} />
      </span>
      <span className="grid gap-0.5">
        <span
          data-strike={drawn ? (children as string) : undefined}
          data-struck={drawn ? (checked ? "true" : "false") : undefined}
          className={cn(
            "text-[13px] transition-opacity duration-200",
            checked ? "text-fg" : "text-mute",
            drawn && "fx-strike",
            strike && !drawn && checked && "line-through decoration-white/50",
            strike && checked && "opacity-55",
          )}
        >
          {children}
        </span>
        {sub && <span className="text-[11px] text-faint">{sub}</span>}
      </span>
    </button>
  );
}
