import type { ScreenshotRef } from "@/domain/types";
import { cn } from "@/lib/cn";
import { NotchedFrame } from "@/motion/pulse/NotchedFrame";
import { shotPlace, useShotUrl } from "./shots";

/** The picture of a reference (cover), a quiet placeholder while it loads, a hint when it is not reachable. */
export function ShotImage({ shot, className, fit = "cover" }: { shot: ScreenshotRef; className?: string; fit?: "cover" | "contain" }) {
  const s = useShotUrl(shot);
  if (s.status === "ok") return <img src={s.url} alt={shot.caption || "Screenshot"} draggable={false} className={cn("size-full select-none", fit === "cover" ? "object-cover" : "object-contain", className)} />;
  return (
    <span className={cn("grid size-full place-items-center bg-ink-850 text-center text-[10.5px] text-faint", className)}>
      {s.status === "loading" ? <span className="size-3 rounded-full bg-white/10" aria-hidden="true" /> : <span className="px-2">Nicht verfügbar{shot.store === "cloud" ? " · Cloud anmelden" : ""}</span>}
    </span>
  );
}

export interface ShotThumbProps {
  shot: ScreenshotRef;
  index: number;
  onOpen: () => void;
  className?: string;
  /** Shows where the picture lives (Lokal / Cloud). */
  badge?: boolean;
}

/**
 * Screenshot thumbnail as a pulse `NotchedFrame`: grey at rest, colour on hover / focus, the notch disc turns red and
 * its arrow nudges towards the corner. The whole frame is one button that opens the lightbox.
 */
export function ShotThumb({ shot, index, onOpen, className, badge }: ShotThumbProps) {
  return (
    <button type="button" onClick={onOpen} aria-label={`Screenshot ${index + 1} öffnen`} className={cn("group relative block w-full text-left focus-visible:outline-none", className)}>
      <NotchedFrame
        radius={14}
        notchSize={40}
        outline="rgb(var(--veil-rgb, 255 255 255) / 0.12)"
        className="overflow-hidden bg-ink-850"
        media={
          <div className="aspect-[4/3] w-full">
            <ShotImage shot={shot} />
          </div>
        }
      >
        {badge && (
          <span className="absolute left-2 top-2 rounded-full bg-ink-950/80 px-2 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.12em] text-mute" aria-hidden="true">
            {shotPlace(shot)}
          </span>
        )}
      </NotchedFrame>
    </button>
  );
}
