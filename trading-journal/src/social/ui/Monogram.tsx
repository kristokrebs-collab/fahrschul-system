import { cn } from "@/lib/cn";
import { DotMatrix, type DotTone } from "@/motion/DotMatrix";
import { matrixSafe, monogramOf } from "../pseudonym";

export interface MonogramProps {
  pseudonym: string;
  /** `xs` 24 px (comments), `sm` 32 px (lists), `md` 44 px (switcher), `lg` 64 px (the own card). */
  size?: "xs" | "sm" | "md" | "lg";
  tone?: DotTone;
  className?: string;
}

const DOT: Record<NonNullable<MonogramProps["size"]>, { dot: number; gap: number; box: string }> = {
  xs: { dot: 1.2, gap: 0.6, box: "size-6 rounded-lg" },
  sm: { dot: 1.6, gap: 0.8, box: "size-8 rounded-[10px]" },
  md: { dot: 2, gap: 1, box: "size-11 rounded-xl" },
  lg: { dot: 3, gap: 1.5, box: "size-16 rounded-2xl" },
};

/**
 * Dot-matrix avatar (P12): the two initials of a pseudonym on the 5 × 7 glyphs inside an ink tile – the community's
 * only "face". Decorative (the pseudonym is always written next to it).
 */
export function Monogram({ pseudonym, size = "sm", tone = "fg", className }: MonogramProps) {
  const d = DOT[size];
  return (
    <span aria-hidden="true" className={cn("grid shrink-0 place-items-center border border-line-2 bg-gradient-to-br from-ink-700 to-ink-900", d.box, className)}>
      <DotMatrix text={matrixSafe(monogramOf(pseudonym))} size={d.dot} gap={d.gap} tone={tone} glow={size === "md" || size === "lg"} />
    </span>
  );
}
