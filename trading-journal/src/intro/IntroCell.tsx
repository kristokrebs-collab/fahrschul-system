import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { registerCell, registerIntroRoot, type CellState } from "@/intro/flight";
import { IntroFlightContext, IntroLandContext, useIntroPhase } from "@/intro/introStore";

export interface IntroCellProps {
  className?: string;
  style?: CSSProperties;
  /** false: the cell never flies in the build beat (deferred, below the fold) – it lands with the stage. */
  fly?: boolean;
  children: ReactNode;
}

/**
 * One overview cell in the intro build beat. Provides `IntroLandContext` (false until the cell has landed, so
 * count-ups, chart draws, bars and rings start when THIS cell arrives) and `IntroFlightContext` (true when the cell
 * was carried into place – its own entrance then replaces the scroll reveal). Without an intro ("off") it is a plain
 * wrapper: landed, never flown. The flight writes transform / z-index on this element directly (flight.ts).
 */
export function IntroCell({ className, style, fly = true, children }: IntroCellProps) {
  const ref = useRef<HTMLDivElement>(null);
  const phase = useIntroPhase();
  const [state, setState] = useState<CellState>({ landed: false, flown: false });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    return registerCell({
      el,
      fly,
      set: (next) => setState((prev) => (prev.landed === next.landed && prev.flown === next.flown ? prev : next)),
    });
  }, [fly]);

  const landed = phase === "off" || phase === "done" || state.landed;
  return (
    <div ref={ref} className={className} style={style} data-intro-cell="">
      <IntroFlightContext.Provider value={state.flown}>
        <IntroLandContext.Provider value={landed}>{children}</IntroLandContext.Provider>
      </IntroFlightContext.Provider>
    </div>
  );
}

/** Registers the overview grid as the element the portal zooms out of (scale 1.06 → 1, blur → 0). */
export function useIntroRoot(ref: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    return registerIntroRoot(el);
  }, [ref]);
}
