import { cn } from "@/lib/cn";

/**
 * One look for every on/off pill (filters, choices, toggles) that is not a `Button`: a quiet outline when off,
 * a plain brighter fill when on (no rim, no inverted block). Keyboard focus uses the same ring as `Button`.
 * Sizes keep the 32 px row of the old pills; coarse pointers get 44 px. Pair with `aria-pressed` / `role="radio"`.
 */
export type ChipSize = "sm" | "md";
export type ChipTone = "neutral" | "win" | "loss";

const base =
  "inline-flex items-center justify-center gap-1.5 rounded-full border transition-colors duration-200 focus-visible:outline-none! focus-visible:shadow-(--ring-glow-btn) disabled:cursor-not-allowed disabled:opacity-40 pointer-coarse:min-h-11";
const size: Record<ChipSize, string> = { sm: "min-h-8 px-2.5 py-1 text-[11.5px]", md: "min-h-8 px-3 py-1.5 text-[12px] font-medium" };
const onTone: Record<ChipTone, string> = {
  neutral: "border-transparent bg-white/[0.12] text-fg",
  win: "border-transparent bg-win/15 text-fg",
  loss: "border-transparent bg-signal/15 text-fg",
};
const off = "border-line-2 text-mute hover:bg-white/[0.05] hover:text-fg";

export function chipClass(on: boolean, opts: { size?: ChipSize; tone?: ChipTone; className?: string } = {}): string {
  const { size: s = "md", tone = "neutral", className } = opts;
  return cn(base, size[s], on ? onTone[tone] : off, className);
}
