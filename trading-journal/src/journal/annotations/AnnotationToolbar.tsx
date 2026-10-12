import { AnimatePresence, motion } from "motion/react";
import { useId, useState, type KeyboardEvent } from "react";
import type { AnnotationKind } from "@/domain/types";
import { cn } from "@/lib/cn";
import { radius, spring, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";

/** Same palette as `ANNOTATION_COLORS` in the chart primitive (kept here so this file never pulls the chart chunk). */
export const DRAW_COLORS = [
  { key: "fg", hex: "#f2f2f2", label: "Weiß" },
  { key: "mute", hex: "#9b9b9b", label: "Grau" },
  { key: "win", hex: "#3ddc84", label: "Grün" },
  { key: "loss", hex: "#ff4d4f", label: "Rot" },
] as const;

export const TOOLS: readonly { kind: AnnotationKind; label: string; points: 1 | 2; icon: string }[] = [
  { kind: "hline", label: "Linie", points: 1, icon: "M3 12h18" },
  { kind: "trend", label: "Trend", points: 2, icon: "M4 18L20 6" },
  { kind: "box", label: "Box", points: 2, icon: "M5 7h14v10H5z" },
  { kind: "arrow", label: "Pfeil", points: 2, icon: "M5 19L19 5M19 5h-7M19 5v7" },
  { kind: "text", label: "Text", points: 1, icon: "M6 6h12M12 6v12" },
];

export interface AnnotationToolbarProps {
  tool: AnnotationKind | null;
  onTool: (t: AnnotationKind | null) => void;
  color: string;
  onColor: (hex: string) => void;
  /** Placed points of the current two-point tool (0 or 1). */
  placed: number;
  /** A drawing is selected (`Löschen` removes it). */
  selected: boolean;
  onDelete: () => void;
  count: number;
  onClear: () => void;
  text: string;
  onText: (t: string) => void;
  className?: string;
}

/**
 * Drawing tools of the trade chart (Journal v3): line, trend, box, arrow, text, four colours, delete selected / all.
 * The active tool sits on a sliding thumb (`layoutId`, `spring.segment`); the hint line says what the next click does.
 * `aria-pressed` toggles; Escape leaves the tool.
 */
export function AnnotationToolbar({ tool, onTool, color, onColor, placed, selected, onDelete, count, onClear, text, onText, className }: AnnotationToolbarProps) {
  const reduced = useReducedFx();
  const [confirmClear, setConfirmClear] = useState(false);
  const uid = useId();
  const active = TOOLS.find((t) => t.kind === tool);
  const hint = active ? (active.points === 2 ? (placed ? "Zweiten Punkt in den Chart tippen" : "Ersten Punkt in den Chart tippen") : active.kind === "text" ? "Text eingeben, dann in den Chart tippen" : "Preis im Chart antippen") : selected ? "Zeichnung gewählt" : count ? `${count} Zeichnung${count === 1 ? "" : "en"} · antippen zum Wählen` : "Werkzeug wählen und in den Chart zeichnen";
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape" && tool) {
      e.stopPropagation();
      e.nativeEvent.stopImmediatePropagation();
      onTool(null);
    }
  };
  return (
    <div className={cn("grid gap-1.5", className)} onKeyDown={onKey}>
      <div className="flex flex-wrap items-center gap-1" role="toolbar" aria-label="Zeichenwerkzeuge">
        {TOOLS.map((t) => {
          const on = tool === t.kind;
          return (
            <button
              key={t.kind}
              type="button"
              aria-pressed={on}
              aria-label={t.label}
              title={t.label}
              onClick={() => onTool(on ? null : t.kind)}
              className={cn("relative grid size-8 place-items-center rounded-lg text-mute transition-colors hover:text-fg pointer-coarse:size-11", on && "text-ink-950")}
            >
              {on && <motion.span layoutId={`annotation-tool-${uid}`} className="absolute inset-0 bg-fg" style={{ borderRadius: radius.thumb }} transition={{ layout: reduced ? { duration: 0 } : spring.segment }} />}
              <svg viewBox="0 0 24 24" className="relative size-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d={t.icon} />
              </svg>
            </button>
          );
        })}
        <span className="mx-1 h-5 w-px bg-line-2" aria-hidden="true" />
        <div className="flex items-center gap-1" role="group" aria-label="Farbe">
          {DRAW_COLORS.map((c) => (
            <button key={c.key} type="button" aria-pressed={color === c.hex} aria-label={c.label} onClick={() => onColor(c.hex)} className="grid size-7 place-items-center rounded-full pointer-coarse:size-11">
              <span className={cn("size-3.5 rounded-full ring-offset-2 ring-offset-ink-850 transition-shadow", color === c.hex && "ring-1 ring-white/70")} style={{ background: c.hex }} />
            </button>
          ))}
        </div>
        <span className="flex-1" />
        <AnimatePresence initial={false}>
          {selected && (
            <motion.button
              key="del"
              type="button"
              onClick={onDelete}
              initial={reduced ? false : { opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, transition: tween.exit }}
              transition={{ scale: spring.pop, opacity: tween.fade }}
              className="rounded-full border border-loss/40 px-2.5 py-1 text-[11.5px] text-[#ff8a90] pointer-coarse:min-h-11"
            >
              Zeichnung löschen
            </motion.button>
          )}
        </AnimatePresence>
        {count > 0 && !selected && (
          <button
            type="button"
            onClick={() => (confirmClear ? (onClear(), setConfirmClear(false)) : setConfirmClear(true))}
            onBlur={() => setConfirmClear(false)}
            className={cn("rounded-full border px-2.5 py-1 text-[11.5px] transition-colors pointer-coarse:min-h-11", confirmClear ? "border-loss/50 text-[#ff8a90]" : "border-line-2 text-mute hover:text-fg")}
          >
            {confirmClear ? "Wirklich alle?" : "Alle löschen"}
          </button>
        )}
      </div>
      {tool === "text" && (
        <input
          aria-label="Text der Notiz"
          value={text}
          onChange={(e) => onText(e.target.value)}
          placeholder="Notiz am Chart, z. B. „Liquidität geholt“"
          maxLength={60}
          className="h-8 rounded-lg border border-line bg-ink-950/70 px-2.5 text-[12px] text-fg outline-none placeholder:text-faint focus:border-white/40 pointer-coarse:h-11"
        />
      )}
      <span className="font-mono text-[10.5px] text-faint">{hint}</span>
    </div>
  );
}
