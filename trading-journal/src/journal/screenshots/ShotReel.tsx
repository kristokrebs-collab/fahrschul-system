import { useState } from "react";
import type { ScreenshotRef } from "@/domain/types";
import { ReelWindow } from "@/motion/pulse/ReelWindow";
import { ShotLightbox } from "./ShotLightbox";
import { ShotImage, ShotThumb } from "./ShotThumb";

/** At most this many pictures take part in the montage / tableau (the reel window has six slots). */
const REEL_MAX = 6;

/**
 * The screenshots of a trade in the detail: one picture → a `NotchedFrame` thumbnail; several → the pulse `ReelWindow`
 * (the pictures hard-cut faster and faster in the window, then spread into a tableau of thumbnails – each opens the
 * `StripWipe` lightbox). More than six: the first six in the tableau, `Alle n` opens the lightbox at the seventh.
 */
export function ShotReel({ shots, title }: { shots: readonly ScreenshotRef[]; title: string }) {
  const [view, setView] = useState<number | null>(null);
  if (!shots.length) return null;
  const head = shots.slice(0, REEL_MAX);
  return (
    <div className="grid gap-2">
      {shots.length === 1 ? (
        <ShotThumb shot={shots[0]!} index={0} onOpen={() => setView(0)} />
      ) : (
        <ReelWindow
          label={`${shots.length} Screenshots zu ${title}`}
          lines={[title, "Chart-Story"]}
          swapLines={[`${shots.length} Screenshots`, "Antippen zum Öffnen"]}
          reels={head.map((s) => (
            <ShotImage key={s.id} shot={s} />
          ))}
          cards={head.map((s, i) => (
            <button key={s.id} type="button" onClick={() => setView(i)} aria-label={`Screenshot ${i + 1} öffnen`} className="block aspect-[4/3] w-full overflow-hidden focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/70">
              <ShotImage shot={s} />
            </button>
          ))}
        />
      )}
      {shots.length > REEL_MAX && (
        <button type="button" onClick={() => setView(REEL_MAX)} className="justify-self-start rounded-full border border-line-2 px-3 py-1 text-[11.5px] text-mute hover:text-fg pointer-coarse:min-h-11">
          Alle {shots.length} ansehen
        </button>
      )}
      <ShotLightbox shots={shots} index={view} onIndex={setView} onClose={() => setView(null)} title="Screenshot" />
    </div>
  );
}
