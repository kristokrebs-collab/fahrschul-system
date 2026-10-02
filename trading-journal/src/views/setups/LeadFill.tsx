import { useEffect, useState } from "react";
import { useIntroSettled } from "@/intro/introStore";
import { cn } from "@/lib/cn";
import { PixelTextFill } from "@/motion/pulse/PixelTextFill";
import { TactileHighlight } from "@/motion/pulse/TactileHighlight";
import { useReducedFx } from "@/motion/useReducedFx";

export const LEAD_FILL = {
  /** The fill ends in the lead's own colour (`text-mute`), so the hand-off to the plain paragraph is invisible. */
  fillVar: "[--color-fg:var(--color-mute)]",
  /**
   * Marker side padding (em), cancelled by an equal negative margin: the word keeps its exact advance (identical
   * wrapping at the hand-off), the bar reaches a little into the spaces around it but never a neighbouring glyph.
   */
  markerPad: 0.1,
  markerClass: "-mx-[0.1em]",
} as const;

export interface LeadFillProps {
  text: string;
  /** sessionStorage key: the fill plays once per session and page (e.g. `tj2-fill-setups`). */
  storageKey: string;
  /** Key word inside `text` that gets the tactile marker (tone invert) after the fill. Must occur in `text`. */
  highlight?: string;
  /** ms before the ember starts (let the page enter first). */
  delayMs?: number;
  className?: string;
}

function seen(key: string): boolean {
  try {
    return sessionStorage.getItem(key) !== null;
  } catch {
    return true;
  }
}

function markSeen(key: string) {
  try {
    sessionStorage.setItem(key, "1");
  } catch {
    // storage blocked: the fill simply plays again next time
  }
}

/**
 * Page subtitle recipe (pulse-motion `pixel-text-fill` → `tactile-highlight`): once per session the lead "ignites" –
 * grey rest text, a signal-red pixel ember sweeps, the fill follows – then the paragraph hands off to plain text in
 * the identical layout and the key word gets the marker wipe. Already seen this session / reduced motion: the plain
 * paragraph with the marker already on. Waits for a running intro to settle. The text is real text in both phases.
 */
export function LeadFill({ text, storageKey, highlight, delayMs = 0, className }: LeadFillProps) {
  const reduced = useReducedFx();
  const settled = useIntroSettled();
  const [phase, setPhase] = useState<"fill" | "marker" | "static">(() => (!reduced && !seen(storageKey) ? "fill" : "static"));
  const filling = phase === "fill" && !reduced;

  useEffect(() => {
    if (filling && settled) markSeen(storageKey);
  }, [filling, settled, storageKey]);

  if (filling) {
    return <PixelTextFill as="p" lines={[text]} playOnMount={false} play={settled} delay={delayMs} onDone={() => setPhase("marker")} className={cn(className, LEAD_FILL.fillVar)} />;
  }

  const at = highlight ? text.indexOf(highlight) : -1;
  if (!highlight || at < 0) return <p className={className}>{text}</p>;
  return (
    <p className={className}>
      {text.slice(0, at)}
      <TactileHighlight tone="invert" active={phase === "marker" ? true : undefined} padX={LEAD_FILL.markerPad} tab={false} className={LEAD_FILL.markerClass}>
        {highlight}
      </TactileHighlight>
      {text.slice(at + highlight.length)}
    </p>
  );
}
