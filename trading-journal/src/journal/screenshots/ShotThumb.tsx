import type { ScreenshotRef } from "@/domain/types";
import { cn } from "@/lib/cn";
import { NotchedFrame } from "@/motion/pulse/NotchedFrame";
import { isShrunkVersion } from "./info";
import { shotPlace, useShotUrl, type ShotVariant } from "./shots";

export interface ShotImageProps {
  shot: ScreenshotRef;
  className?: string;
  fit?: "cover" | "contain";
  /** `preview` (default): the small derived picture, fast. `original`: the exact stored file. */
  variant?: ShotVariant;
  /** Called once the browser has the picture (the viewer swaps the preview for the original then). */
  onLoaded?: () => void;
}

/** The picture of a reference (cover), a quiet placeholder while it loads, a hint when it is not reachable. */
export function ShotImage({ shot, className, fit = "cover", variant = "preview", onLoaded }: ShotImageProps) {
  const s = useShotUrl(shot, variant);
  if (s.status === "ok") {
    return (
      <img
        src={s.url}
        alt={shot.caption || "Screenshot"}
        draggable={false}
        decoding="async"
        onLoad={onLoaded}
        className={cn("size-full select-none", fit === "cover" ? "object-cover" : "object-contain", className)}
      />
    );
  }
  const gone = shot.storage === "ram" ? "Nicht gespeichert (war nur im Arbeitsspeicher)" : `Nicht verfügbar${shot.store === "cloud" ? " · Cloud anmelden" : ""}`;
  return (
    <span className={cn("grid size-full place-items-center bg-ink-850 text-center text-[10.5px] text-faint", className)}>
      {s.status === "loading" ? <span className="size-3 rounded-full bg-white/10" aria-hidden="true" /> : <span className="px-2">{gone}</span>}
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
          <span className="absolute left-2 top-2 flex max-w-[calc(100%-1rem)] flex-wrap gap-1" aria-hidden="true">
            <span className={cn("rounded-full bg-ink-950/80 px-2 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.12em]", shot.storage === "ram" ? "text-warn" : "text-mute")}>{shotPlace(shot)}</span>
            {isShrunkVersion(shot) && <span className="rounded-full bg-ink-950/80 px-2 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.12em] text-mute">verkleinert</span>}
          </span>
        )}
      </NotchedFrame>
    </button>
  );
}
