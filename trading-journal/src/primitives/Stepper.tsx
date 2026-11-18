import { motion } from "motion/react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { TextRoll } from "@/motion/TextRoll";
import { pressScale, spring } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";

export interface StepperProps {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  step?: number;
  /** Accessible names of the two buttons („Weniger“ / „Mehr“ …). */
  decreaseLabel: string;
  increaseLabel: string;
  /** Shown text of the value (default `String(value)`). */
  format?: (value: number) => string;
  /** `data-testid` of the value `<output>`. */
  testId?: string;
  className?: string;
}

const btn =
  "touch-hit grid size-8 place-items-center rounded-full text-mute transition-colors hover:text-fg disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none! focus-visible:shadow-(--ring-glow-btn)";

/**
 * Number field with step buttons (`−` / `+`): the figure ROLLS to the next one – up for a larger value, down for a smaller one
 * (`TextRoll`, so `textContent` and the accessible name stay exactly the figure) – and the buttons squeeze on press
 * (`pressScale.small`, `spring.press`). The width of the output is fixed (`w-8`), so a roll never moves a neighbour. The value is
 * clamped to `min` / `max`; at a limit the button is disabled. Reduced motion: no roll, no squeeze.
 */
export function Stepper({ value, onChange, min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY, step = 1, decreaseLabel, increaseLabel, format = String, testId, className }: StepperProps) {
  const reduced = useReducedFx();
  const [seen, setSeen] = useState(value);
  const [dir, setDir] = useState<"up" | "down">("up");
  if (seen !== value) {
    setSeen(value);
    setDir(value > seen ? "up" : "down");
  }
  const go = (delta: number) => onChange(Math.min(max, Math.max(min, value + delta)));
  const tap = reduced ? undefined : { scale: pressScale.small };
  return (
    <div className={cn("flex items-center rounded-full border border-line-2 bg-ink-950", className)}>
      <motion.button type="button" aria-label={decreaseLabel} disabled={value <= min} onClick={() => go(-step)} whileTap={tap} transition={spring.press} className={btn}>
        −
      </motion.button>
      <output aria-live="off" className="num grid w-8 place-items-center font-mono text-[14px]" data-testid={testId}>
        <TextRoll text={format(value)} mode="roll" direction={dir} />
      </output>
      <motion.button type="button" aria-label={increaseLabel} disabled={value >= max} onClick={() => go(step)} whileTap={tap} transition={spring.press} className={btn}>
        +
      </motion.button>
    </div>
  );
}
