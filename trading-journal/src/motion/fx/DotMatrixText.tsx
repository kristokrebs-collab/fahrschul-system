import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { DotMatrix, type DotTone } from "@/motion/DotMatrix";
import { fxTiming } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";

/**
 * DotMatrixText – the comfortable way to set a short value or label in the Nothing dot matrix (`DotMatrix` text
 * mode: digits, `- − + . , : % /`, upper-case letters, `↑ ↓ ! ?`): "A+", "1:5", "3/4", "PRO", "+2,4%".
 * - The text is upper-cased; `width` pads it (`padStart`, or `padEnd` with `align="left"`) so live values keep the
 *   grid and cross-fade through the phosphor instead of rebuilding it.
 * - Optional animated preset beside the text (`wave`, `snake`, `chevrons`, `chevrons-left`): decorative, FINITE –
 *   it plays `cycles` loops (default 3) and then rests on its frame; pass `cycles={Infinity}` only for a busy
 *   indicator that unmounts when the work is done (it also sleeps off screen, like every DotMatrix).
 * - Accessible: `role="img"` with `label` (default: the text as given); `decorative` hides it (aria-hidden) when the
 *   same value is spelled out next to it.
 * Reduced motion: DotMatrix shows a single static frame without glow.
 */
export type DotMatrixTextPreset = "wave" | "snake" | "chevrons" | "chevrons-left";

/** Frames per loop of each preset (DotMatrix presets) – for the finite `cycles` timing. */
export const PRESET_FRAMES: Record<DotMatrixTextPreset, number> = { wave: 24, snake: 49, chevrons: 4, "chevrons-left": 4 };

/** Upper-cased, padded matrix text. */
export function matrixText(text: string, width?: number, align: "left" | "right" = "right"): string {
  const t = text.toUpperCase();
  if (!width || t.length >= width) return t;
  return align === "left" ? t.padEnd(width, " ") : t.padStart(width, " ");
}

export interface DotMatrixTextProps {
  text: string;
  /** Pad to this many characters (fixed grid for live values). */
  width?: number;
  align?: "left" | "right";
  preset?: DotMatrixTextPreset;
  presetPosition?: "before" | "after";
  /** Loops of the preset before it rests (default 3). */
  cycles?: number;
  tone?: DotTone;
  presetTone?: DotTone;
  /** Dot size / gap in px (default 4 / 2). */
  size?: number;
  gap?: number;
  glow?: boolean;
  label?: string;
  decorative?: boolean;
  className?: string;
}

export function DotMatrixText({ text, width, align = "right", preset, presetPosition = "after", cycles = 3, tone = "fg", presetTone, size = 4, gap = 2, glow = true, label, decorative = false, className }: DotMatrixTextProps) {
  const reduced = useReducedFx();
  const [resting, setResting] = useState(false);
  const fps = fxTiming.matrixFps;

  // finite preset: rest after `cycles` loops (one timer, one render)
  useEffect(() => {
    if (!preset || reduced || !Number.isFinite(cycles)) return;
    const ms = (Math.max(1, cycles) * PRESET_FRAMES[preset] * 1000) / fps;
    const id = setTimeout(() => setResting(true), ms);
    return () => {
      clearTimeout(id);
      setResting(false);
    };
  }, [preset, cycles, reduced, fps]);

  const a11y = decorative ? { "aria-hidden": true as const } : { role: "img", "aria-label": label ?? text };
  // reduced motion: the pure activity glyphs (wave, snake) carry no information as a still frame – only the chevrons
  // (a direction) stay
  const shown = preset && !(reduced && (preset === "wave" || preset === "snake")) ? preset : undefined;
  const glyph = shown ? <DotMatrix preset={shown} tone={presetTone ?? tone} size={size} gap={gap} glow={glow} playing={!resting} fps={fps} /> : null;
  return (
    <span {...a11y} data-fx="dot-matrix-text" className={cn("inline-flex items-center gap-[0.5em] align-middle leading-none", className)}>
      {presetPosition === "before" ? glyph : null}
      <DotMatrix text={matrixText(text, width, align)} tone={tone} size={size} gap={gap} glow={glow} />
      {presetPosition === "after" ? glyph : null}
    </span>
  );
}
