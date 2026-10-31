/**
 * The answers of the navigation's finder: the best five functions for what was typed, each a navigation item with its name,
 * its task in plain words and where it lives. Its own chunk (the function register and its scorer load with it); nothing
 * is stored. No answer says so and points to the full list.
 *
 * Motion (Runde 10): the hits rise in one after the other (`nf-hit`, 45 ms apart), and the selection GLIDES – one plate behind
 * the hits follows the pointer and the keyboard focus from hit to hit on `spring.layout` (a transform; every hit is the same
 * 80 px high, so the plate needs no measuring, only its index). Reduced motion: the plate jumps, the hits are simply there.
 */
import { animate, motion, useMotionValue } from "motion/react";
import { useMemo, useRef, type CSSProperties, type FocusEvent, type PointerEvent } from "react";
import { groupOf, placeText, searchFeatures } from "@/app/featureQuery";
import { NAV_FINDER_STRINGS } from "@/app/NavFinder";
import { spring, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";

const SHOWN = 5;
/** Every hit is this high (px, three one-line rows + padding) and the list gaps 6 px: the plate's offset is `index · HIT_PITCH`. */
export const HIT_HEIGHT = 80;
export const HIT_PITCH = HIT_HEIGHT + 6;

const indexOf = (target: EventTarget | null): number => {
  const li = target instanceof Element ? target.closest<HTMLElement>("li[data-i]") : null;
  return li ? Number(li.dataset.i) : -1;
};

export default function NavFinderResults({ query, onOpen, onAll }: { query: string; onOpen: (id: string) => void; onAll: () => void }) {
  const hits = useMemo(() => searchFeatures(query).slice(0, SHOWN), [query]);
  const reduced = useReducedFx();
  const y = useMotionValue(0);
  const shown = useMotionValue(0);
  const at = useRef(-1);
  const wrap = useRef<HTMLDivElement>(null);

  const move = (index: number) => {
    if (index < 0 || index === at.current) return;
    const to = index * HIT_PITCH;
    // the first hit the plate meets: it appears there; afterwards it glides
    if (at.current < 0 || reduced) y.jump(to);
    else animate(y, to, spring.layout);
    if (at.current < 0) {
      if (reduced) shown.set(1);
      else animate(shown, 1, tween.hoverPill);
    }
    at.current = index;
  };
  const rest = () => {
    at.current = -1;
    if (reduced) shown.set(0);
    else animate(shown, 0, tween.hoverPill);
  };

  if (!hits.length) {
    return (
      <p className="text-[12.5px] leading-relaxed text-mute" data-testid="nav-finder-none" role="status">
        Dazu steht nichts in der Liste.{" "}
        <button type="button" data-cmd-item="" onClick={onAll} className="underline decoration-line-2 underline-offset-4 outline-none hover:text-fg focus-visible:outline-2 focus-visible:outline-white pointer-coarse:min-h-11">
          {NAV_FINDER_STRINGS.allHint}
        </button>
      </p>
    );
  }
  return (
    <div
      ref={wrap}
      className="relative"
      onPointerOver={(e: PointerEvent) => {
        // a touch tap also fires `pointerover`: only a mouse or pen hover claims the plate
        if (e.pointerType !== "touch") move(indexOf(e.target));
      }}
      onPointerLeave={() => {
        if (!wrap.current?.contains(document.activeElement)) rest();
      }}
      onFocusCapture={(e: FocusEvent) => move(indexOf(e.target))}
      onBlurCapture={(e: FocusEvent) => {
        if (!(e.relatedTarget instanceof Node && wrap.current?.contains(e.relatedTarget))) rest();
      }}
    >
      <ul className="grid gap-1.5" data-testid="nav-finder-results" aria-label={`${hits.length} Treffer`}>
        {hits.map((h, i) => (
          <li key={h.entry.id} data-i={i} className="nf-hit" style={{ "--i": i } as CSSProperties}>
            <button
              type="button"
              data-cmd-item=""
              data-feature={h.entry.id}
              onClick={() => onOpen(h.entry.id)}
              className="grid h-20 w-full min-w-0 content-center gap-0.5 rounded-xl border border-line-2 bg-ink-900 px-3 text-left outline-none transition-colors duration-200 focus-visible:border-white/60"
            >
              <span className="truncate text-[14.5px] font-medium text-fg">{h.entry.name}</span>
              <span className="truncate text-[12px] text-mute">{h.entry.task ?? groupOf(h.entry).name}</span>
              <span className="truncate font-mono text-[11px] text-mute">
                {groupOf(h.entry).name} · {placeText(h.entry)}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {/* the selection: one plate that glides from hit to hit (decorative, never takes a pointer) */}
      <motion.span aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 rounded-xl bg-white/[0.05] ring-1 ring-white/30" style={{ y, opacity: shown, height: HIT_HEIGHT }} />
    </div>
  );
}
