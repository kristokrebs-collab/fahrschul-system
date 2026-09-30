import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { tween } from "@/motion/tokens";
import { GlyphCheck } from "@/primitives/icons";

export interface CheckboxRowProps {
  checked: boolean;
  onToggle: () => void;
  children: ReactNode;
  /** Secondary line (`text-[11px] text-faint`). */
  sub?: ReactNode;
  disabled?: boolean;
  className?: string;
}

/**
 * Bundle `Ff`: `role="checkbox"` row, checked `border-teal/35 bg-teal/[0.07]`, box `size-[18px] rounded-md border`
 * → `border-teal bg-teal`, check `M3.5 8.5l3 3 6-7` drawn via `pathLength` (`tween.check`, `initial:false`).
 */
export function CheckboxRow({ checked, onToggle, children, sub, disabled, className }: CheckboxRowProps) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      disabled={disabled}
      onClick={onToggle}
      className={cn(
        "flex w-full items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "border-teal/35 bg-teal/[0.07]" : "border-line bg-ink-950/40 hover:border-line-2",
        className,
      )}
    >
      <span className={cn("mt-0.5 grid size-[18px] shrink-0 place-items-center rounded-md border transition-colors duration-200", checked ? "border-teal bg-teal" : "border-line-2")}>
        <GlyphCheck className="size-3" style={{ color: "var(--color-ink-950)" }} drawn={checked} transition={tween.check} />
      </span>
      <span className="grid gap-0.5">
        <span className={cn("text-[13px]", checked ? "text-fg" : "text-mute")}>{children}</span>
        {sub && <span className="text-[11px] text-faint">{sub}</span>}
      </span>
    </button>
  );
}
