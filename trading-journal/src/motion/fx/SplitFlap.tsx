import { useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { TextRoll } from "@/motion/TextRoll";

/**
 * SplitFlap – a departure-board tile for period and label switches ("Woche" → "Monat", "Q3" → "Q4"): the label slot-
 * rolls through `TextRoll mode="roll"` (`spring.digit`, exit `tween.exit`) inside dark tiles with a hinge line.
 * With `order` the direction follows the sequence (a later value rolls up, an earlier one down) – like flipping
 * forward / back. `tiles` gives every character its own tile (fixed width with `minChars`), all flipping together.
 * The accessible text is always exactly the label (TextRoll keeps an sr-only copy; tiles mode adds one and hides the
 * tiles). Reduced motion: TextRoll swaps instantly.
 */
export interface SplitFlapProps {
  text: string;
  /** Known sequence (periods: ["Tag", "Woche", "Monat", "Jahr"]) – sets the roll direction. */
  order?: readonly string[];
  /** Fixed direction (overrides `order`). */
  direction?: "up" | "down";
  /** One tile per character (default false: one tile for the whole label). */
  tiles?: boolean;
  /** Tiles mode: pad to at least this many tiles (right-aligned values pad left, see `align`). */
  minChars?: number;
  align?: "left" | "right";
  className?: string;
  tileClassName?: string;
}

/** Roll direction for a switch from `prev` to `next` within `order` (unknown values roll up). */
export function flapDirection(prev: string, next: string, order?: readonly string[]): "up" | "down" {
  if (!order) return "up";
  const a = order.indexOf(prev);
  const b = order.indexOf(next);
  return a >= 0 && b >= 0 && b < a ? "down" : "up";
}

/** Characters of the tiles (padded with blanks to `minChars`). */
export function flapChars(text: string, minChars = 0, align: "left" | "right" = "left"): string[] {
  const chars = Array.from(text);
  const pad = Math.max(0, minChars - chars.length);
  const blanks = Array<string>(pad).fill(" ");
  return align === "right" ? [...blanks, ...chars] : [...chars, ...blanks];
}

function Tile({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "relative inline-flex min-w-[1.15em] items-center justify-center overflow-hidden rounded-[6px] border border-line-2 bg-ink-800 px-[0.32em] py-[0.12em] leading-none text-fg",
        "shadow-[inset_0_1px_0_rgb(255_255_255/0.05)]",
        className,
      )}
    >
      <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-white/[0.035]" />
      {children}
      <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-1/2 z-[1] h-px -translate-y-1/2 bg-black/70" />
    </span>
  );
}

export function SplitFlap({ text, order, direction, tiles = false, minChars = 0, align = "left", className, tileClassName }: SplitFlapProps) {
  // derived from the previous label (React's "store info from previous renders" pattern – no effect, no ref read)
  const [prev, setPrev] = useState(text);
  const [dir, setDir] = useState<"up" | "down">("up");
  if (prev !== text) {
    setPrev(text);
    setDir(flapDirection(prev, text, order));
  }
  const d = direction ?? dir;

  if (!tiles) {
    return (
      <span data-fx="split-flap" className={cn("inline-flex", className)}>
        <Tile className={tileClassName}>
          <TextRoll text={text} mode="roll" direction={d} />
        </Tile>
      </span>
    );
  }
  const chars = flapChars(text, minChars, align);
  return (
    <span data-fx="split-flap" data-tiles="" className={cn("inline-flex gap-[0.14em]", className)}>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true" className="inline-flex gap-[0.14em]">
        {chars.map((ch, i) => (
          <Tile key={i} className={tileClassName}>
            <TextRoll text={ch === " " ? " " : ch} mode="roll" direction={d} />
          </Tile>
        ))}
      </span>
    </span>
  );
}
