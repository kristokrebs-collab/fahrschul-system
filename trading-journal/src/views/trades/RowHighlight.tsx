import { AnimatePresence, cancelFrame, frame, motion } from "motion/react";
import { useEffect, useImperativeHandle, useRef, useState, type Ref, type RefObject } from "react";
import { radius, spring, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { insetBox, measureRow, sameBox, type RowBox } from "./rowGeometry";

export interface RowHighlightHandle {
  /** The pointer is over `row`; `null` once it left the rows. */
  hover(row: HTMLElement | null): void;
  /** `row` holds keyboard focus (`:focus-visible`); `null` once focus left it. */
  focus(row: HTMLElement | null): void;
  /** Re-measures the tracked row after the rows moved (sort, filter, insert, delete). */
  sync(): void;
}

export interface RowHighlightProps {
  ref: Ref<RowHighlightHandle>;
  /** The positioned scroll wrapper the highlight lives in (coordinate space of the measurement). */
  root: RefObject<HTMLElement | null>;
  /** Instance suffix (`useId`) → `layoutId="hover-trades-{id}"`. */
  id: string;
}

/** The pill floats 2 px inside the row rules. */
const ROW_INSET_PX = 2;

interface Target {
  box: RowBox;
  /** Shown for keyboard focus (brighter ring) rather than for the pointer. */
  focus: boolean;
}

/**
 * One gliding highlight for all table rows (replaces the per-row CSS hover background): an absolute pill in the
 * table's scroll wrapper whose box follows the hovered – else the focused – row. Moves are `layoutId` projections on
 * `spring.hover` (transform only, radius corrected), fades on `tween.hoverPill` and lingers .15 s after the pointer
 * leaves so a quick exit and re-entry glides instead of blinking. Pointer events are coalesced to one measurement
 * per frame (`frame.read`, transform-free offsets), and only this component re-renders – never the table.
 * Reduced motion: the pill jumps (MotionConfig) and appears/disappears without fades.
 */
export function RowHighlight({ ref, root, id }: RowHighlightProps) {
  const reduced = useReducedFx();
  const [target, setTarget] = useState<Target | null>(null);
  const track = useRef({ hover: null as HTMLElement | null, focus: null as HTMLElement | null, queued: false, flush: () => {} });

  useImperativeHandle(ref, () => {
    const t = track.current;
    t.flush = () => {
      t.queued = false;
      const el = t.hover ?? t.focus;
      const host = root.current;
      if (!el || !host || !el.isConnected || el.hasAttribute("data-exiting")) {
        setTarget(null);
        return;
      }
      const box = insetBox(measureRow(el, host), ROW_INSET_PX);
      const focus = el === t.focus;
      setTarget((prev) => (prev && prev.focus === focus && sameBox(prev.box, box) ? prev : { box, focus }));
    };
    const queue = () => {
      if (t.queued) return;
      t.queued = true;
      frame.read(t.flush);
    };
    return {
      hover(row) {
        if (t.hover === row) return;
        t.hover = row;
        queue();
      },
      focus(row) {
        if (t.focus === row) return;
        t.focus = row;
        queue();
      },
      sync: queue,
    };
  }, [root]);

  useEffect(() => {
    const t = track.current;
    return () => {
      cancelFrame(t.flush);
      t.queued = false;
    };
  }, []);

  return (
    <AnimatePresence>
      {target && (
        <motion.div
          key="row-highlight"
          layoutId={`hover-trades-${id}`}
          layoutDependency={target}
          aria-hidden="true"
          data-row-highlight={target.focus ? "focus" : "hover"}
          className="pointer-events-none absolute bg-white/[0.045]"
          style={{ top: target.box.top, left: target.box.left, width: target.box.width, height: target.box.height, borderRadius: radius.hover }}
          initial={reduced ? false : { opacity: 0 }}
          animate={{ opacity: 1, transition: reduced ? { duration: 0 } : tween.hoverPill }}
          exit={reduced ? undefined : { opacity: 0, transition: { ...tween.hoverPill, delay: 0.15 } }}
          transition={spring.hover}
        >
          <span className="absolute inset-0 rounded-[inherit] ring-1 ring-inset ring-white/[0.07]" />
          <motion.span
            className="absolute inset-0 rounded-[inherit] ring-1 ring-inset ring-white/30"
            initial={false}
            animate={{ opacity: target.focus ? 1 : 0 }}
            transition={reduced ? { duration: 0 } : tween.crossfade}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
