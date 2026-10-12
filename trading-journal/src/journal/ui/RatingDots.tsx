import { motion } from "motion/react";
import { useState, type KeyboardEvent } from "react";
import type { TradeRating } from "@/domain/types";
import { cn } from "@/lib/cn";
import { DotMatrix, type DotFrame } from "@/motion";
import { spring } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";

/** Lit disc / dim ring of one 5 × 5 rating cell (the phosphor fades between them). */
const ON: DotFrame = [
  [0, 1, 1, 1, 0],
  [1, 1, 1, 1, 1],
  [1, 1, 1, 1, 1],
  [1, 1, 1, 1, 1],
  [0, 1, 1, 1, 0],
];
const PREVIEW: DotFrame = ON.map((row) => row.map((v) => v * 0.38));
const OFF: DotFrame = [
  [0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0],
  [0, 0, 0.5, 0, 0],
  [0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0],
];

export const RATING_LABELS: Record<TradeRating, string> = { 1: "Schwach", 2: "Mäßig", 3: "Solide", 4: "Stark", 5: "Lehrbuch" };

export interface RatingDotsProps {
  value: TradeRating | null;
  /** Without `onChange` the dots are a read-only display (`role="img"`). */
  onChange?: (v: TradeRating | null) => void;
  label?: string;
  size?: "sm" | "md";
  className?: string;
}

/**
 * Execution rating 1–5 as five dot-matrix cells (`DotMatrix` pattern mode): choosing lights the cells up to the value
 * with the phosphor rise, hover previews them dimly, re-choosing the same value clears it. A `radiogroup` of five
 * radios (`1 von 5 · Schwach` …, arrows move, Space / Enter choose). Read-only it is one `role="img"`.
 */
export function RatingDots({ value, onChange, label = "Bewertung", size = "md", className }: RatingDotsProps) {
  const reduced = useReducedFx();
  const [hover, setHover] = useState<number | null>(null);
  const dot = size === "sm" ? 2 : 3;
  const gap = 1;
  const cells = [1, 2, 3, 4, 5] as const;
  const frameOf = (n: number) => (value != null && n <= value ? ON : hover != null && n <= hover ? PREVIEW : OFF);

  if (!onChange) {
    return (
      <span role="img" aria-label={value ? `${label}: ${value} von 5 · ${RATING_LABELS[value]}` : `${label}: keine`} className={cn("inline-flex items-center gap-1", className)}>
        {cells.map((n) => (
          <DotMatrix key={n} pattern={frameOf(n)} rows={5} cols={5} size={dot} gap={gap} tone={value != null && n <= value ? "fg" : "mute"} glow={!reduced} />
        ))}
      </span>
    );
  }

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const cur = value ?? 0;
    const next = e.key === "ArrowRight" || e.key === "ArrowUp" ? Math.min(5, cur + 1) : e.key === "ArrowLeft" || e.key === "ArrowDown" ? Math.max(1, cur - 1) : null;
    if (next == null) return;
    e.preventDefault();
    onChange(next as TradeRating);
    const btn = e.currentTarget.querySelector<HTMLButtonElement>(`[data-rating="${next}"]`);
    btn?.focus();
  };

  return (
    <div role="radiogroup" aria-label={label} className={cn("inline-flex flex-wrap items-center gap-1.5", className)} onKeyDown={onKey} onPointerLeave={() => setHover(null)}>
      {cells.map((n) => {
        const on = value === n;
        return (
          <motion.button
            key={n}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={`${n} von 5 · ${RATING_LABELS[n]}`}
            data-rating={n}
            tabIndex={on || (value == null && n === 1) ? 0 : -1}
            onClick={() => onChange(on ? null : n)}
            onPointerEnter={(e) => {
              if (e.pointerType !== "touch") setHover(n);
            }}
            whileTap={reduced ? undefined : { scale: 0.88 }}
            transition={spring.press}
            className="grid place-items-center rounded-lg border border-transparent p-1.5 transition-colors hover:border-line-2 focus-visible:border-white/50 focus-visible:outline-none pointer-coarse:min-h-11 pointer-coarse:min-w-11"
          >
            <DotMatrix pattern={frameOf(n)} rows={5} cols={5} size={dot} gap={gap} tone={value != null && n <= value ? (value >= 4 ? "win" : "fg") : "mute"} glow={!reduced} />
          </motion.button>
        );
      })}
      <span className="ml-1 min-w-[5.5em] font-mono text-[11px] text-mute" aria-hidden="true">
        {value ? RATING_LABELS[value] : hover ? RATING_LABELS[hover as TradeRating] : "–"}
      </span>
    </div>
  );
}
