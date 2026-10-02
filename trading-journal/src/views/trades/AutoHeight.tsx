import { animate, type AnimationPlaybackControls, type Transition } from "motion/react";
import { useLayoutEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { spring } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";

export interface AutoHeightProps {
  children: ReactNode;
  className?: string;
  /** Height spring (default `spring.layout`, the same spring the rows glide on). */
  transition?: Transition;
}

/**
 * Box that follows its content's height on a spring instead of snapping (TR-01/02/03, ED-01): a `ResizeObserver` on
 * the inner box reports the new height after layout and before paint, the outer box is pinned to the old height in the
 * same frame and springs to the new one, then goes back to `height: auto`. Vertical overflow is clipped (`overflow-y:
 * clip`, no scroll container) so growing content is uncovered and shrinking content folds away; horizontal overflow
 * stays visible (row highlights, negative margins).
 *
 * Declared exception to "transform/opacity only" – like `Collapse`: the height of one box animates so the content
 * below it is pushed smoothly instead of jumping; it runs only around a real size change. Reduced motion: plain
 * `height: auto`.
 */
export function AutoHeight({ children, className, transition = spring.layout }: AutoHeightProps) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const reduced = useReducedFx();
  const transitionRef = useRef(transition);

  useLayoutEffect(() => {
    transitionRef.current = transition;
  }, [transition]);

  useLayoutEffect(() => {
    const box = outer.current;
    const content = inner.current;
    if (!box || !content || reduced || typeof ResizeObserver !== "function") return;
    let last = content.offsetHeight;
    let shown = last;
    let anim: AnimationPlaybackControls | null = null;
    let shownPad = 0;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      const next = entry?.borderBoxSize?.[0]?.blockSize ?? content.offsetHeight;
      if (Math.abs(next - last) < 0.5) return;
      last = next;
      // outer padding / border (e.g. room for focus rings at the clip edge) rides on top of the content height
      const pad = anim ? shownPad : Math.max(0, box.offsetHeight - next);
      shownPad = pad;
      const from = anim ? parseFloat(box.style.height) || shown + pad : shown + pad;
      anim?.stop();
      box.style.height = `${from}px`;
      const controls = animate(from, next + pad, {
        ...transitionRef.current,
        onUpdate: (v) => {
          shown = v - pad;
          box.style.height = `${v}px`;
        },
        onComplete: () => {
          if (anim !== controls) return;
          anim = null;
          shown = next;
          box.style.height = "";
        },
      });
      anim = controls;
    });
    ro.observe(content);
    return () => {
      ro.disconnect();
      anim?.stop();
      box.style.height = "";
    };
  }, [reduced]);

  return (
    <div ref={outer} className={cn("[overflow-y:clip]", className)}>
      <div ref={inner} className="flow-root">
        {children}
      </div>
    </div>
  );
}
