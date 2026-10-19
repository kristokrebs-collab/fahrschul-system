import { AnimatePresence, motion } from "motion/react";
import { useId, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { useTouchMoveGuard } from "@/motion/a11y";
import { contextSpring, contextSpringAt, haptic, physics, pointerSpeed, pointerTempo, snapIndex, tempoOf, useAxisDrag, type AxisDragMove, type AxisDragRelease } from "@/motion/physics";
import { radius, spring, tween } from "@/motion/tokens";
import { useCanHover } from "@/motion/useMediaQuery";
import { useReducedFx } from "@/motion/useReducedFx";

export interface SegmentedOption<T extends string> {
  v: T;
  label: ReactNode;
  disabled?: boolean;
}

export interface SegmentedProps<T extends string> {
  options: readonly SegmentedOption<T>[];
  value: T | null | undefined;
  onChange: (value: T) => void;
  size?: "sm" | "md";
  /** Extra thumb classes per value (Long → `bg-win/15 border-win/30`, Short → `bg-loss/15 border-loss/30`). */
  tones?: Partial<Record<T, string>>;
  className?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
}

/** The label (not the item, so the shared thumb is never measured mid-press) dips to .97 while pressed. */
const LABEL_PRESS = { pressed: { scale: 0.97 } };

/**
 * Coarse pointers: every segment is at least 44 px wide (layout) and its tap area 44 px tall (an invisible ::after
 * that grows up and down, never sideways into the neighbouring segment – no layout change in dense chart headers).
 */
const COARSE_HIT: Record<"sm" | "md", string> = {
  sm: "pointer-coarse:min-w-11 pointer-coarse:justify-center pointer-coarse:after:absolute pointer-coarse:after:inset-x-0 pointer-coarse:after:-inset-y-2.5 pointer-coarse:after:content-['']",
  md: "pointer-coarse:min-w-11 pointer-coarse:justify-center pointer-coarse:after:absolute pointer-coarse:after:inset-x-0 pointer-coarse:after:-inset-y-1.5 pointer-coarse:after:content-['']",
};

/** Rest geometry of one segment, read once per gesture (pointerdown). */
interface SegRect {
  i: number;
  cx: number;
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/**
 * Pure: the segment for a horizontal position inside the pressed row (the root can wrap onto two rows): the one whose
 * box contains `x`, else the nearest centre. -1 when the row is empty.
 */
export function segmentAt(row: readonly SegRect[], x: number): number {
  let best = -1;
  let bestD = Infinity;
  for (const r of row) {
    if (x >= r.left && x <= r.right) return r.i;
    const d = Math.abs(x - r.cx);
    if (d < bestD) {
      bestD = d;
      best = r.i;
    }
  }
  return best;
}

/**
 * Bundle `or`/`YG`: `role="radiogroup"` with a shared-layout thumb (`layoutId="bg-{useId}"`, `spring.segment`),
 * roving tabindex + arrow/Home/End keys. NEW (21st.dev "Segmented Tabs with hover ghost"): a faint ghost
 * (`layoutId="seg-hover-{useId}"`, `spring.hover`, opacity `tween.hoverPill`) glides under the hovered segment and
 * fades out when the pointer leaves the control; the pressed label scales to .97 (`spring.press`).
 * Hover devices only; no ghost under reduced motion. z-order: ghost < thumb < label.
 *
 * Physics (additive, `@/motion/physics`):
 * - iOS press-slide-release: press, slide (after 10 px, angle-locked) and the thumb follows the finger segment by
 *   segment (selection haptic per change); release commits the segment under the finger – or, after a flick
 *   (> 600 px/s), the segment nearest to the projected position (UIScrollView fast deceleration). One `onChange` per
 *   gesture, the click after it is swallowed, a vertical pan keeps scrolling (`touch-action: pan-y`).
 * - Context springs: the thumb travels on `spring.segment` itself for taps and keys, a little shorter and bouncier when
 *   the input was fast; the hover ghost likewise on `spring.hover`.
 * - `aria-checked` follows `value` only (assistive tech sees commits, never the preview).
 */
export function Segmented<T extends string>({ options, value, onChange, size = "md", tones, className, ...aria }: SegmentedProps<T>) {
  const id = useId();
  const refs = useRef<Map<T, HTMLButtonElement>>(new Map());
  const reduced = useReducedFx();
  const canHover = useCanHover();
  const [hovered, setHovered] = useState<{ v: T; speed: number } | null>(null);
  const [preview, setPreview] = useState<T | null>(null);
  const [thumbTempo, setThumbTempo] = useState(0);
  const ghost = canHover && !reduced;

  const enabled = options.filter((o) => !o.disabled);
  const select = (v: T, tempo: number) => {
    setThumbTempo(tempo);
    onChange(v);
  };
  const move = (from: T | null | undefined, step: number) => {
    if (enabled.length === 0) return;
    const i = enabled.findIndex((o) => o.v === from);
    const next = enabled[(i + step + enabled.length) % enabled.length] ?? enabled[0];
    if (!next) return;
    select(next.v, 0);
    refs.current.get(next.v)?.focus();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
        e.preventDefault();
        move(value, 1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        e.preventDefault();
        move(value, -1);
        break;
      case "Home": {
        e.preventDefault();
        const first = enabled[0];
        if (first) {
          select(first.v, 0);
          refs.current.get(first.v)?.focus();
        }
        break;
      }
      case "End": {
        e.preventDefault();
        const last = enabled[enabled.length - 1];
        if (last) {
          select(last.v, 0);
          refs.current.get(last.v)?.focus();
        }
        break;
      }
    }
  };

  /* ---------------------------------------------------------------- press-slide-release */

  const geo = useRef<{ row: SegRect[] }>({ row: [] });
  const previewRef = useRef<T | null>(null);
  const showPreview = (v: T | null, tempo: number) => {
    if (previewRef.current === v) return;
    previewRef.current = v;
    setThumbTempo(tempo);
    setPreview(v);
  };
  const optionAt = (i: number) => (i >= 0 ? options[i] : undefined);

  const drag = useAxisDrag({
    axis: "x",
    pointerTypes: ["mouse", "touch", "pen"],
    // vertical scrolling and pinch-zoom stay with the browser
    touchAction: "pan-y pinch-zoom",
    onPress: (e) => {
      // one layout read per gesture: the enabled segments in the pressed row (the root may wrap)
      const all: SegRect[] = [];
      options.forEach((o, i) => {
        const el = refs.current.get(o.v);
        if (!el || o.disabled) return;
        const r = el.getBoundingClientRect();
        all.push({ i, cx: r.left + r.width / 2, top: r.top, bottom: r.bottom, left: r.left, right: r.right });
      });
      const y = e.clientY;
      const hit = all.find((r) => y >= r.top && y <= r.bottom) ?? all[0];
      geo.current.row = hit ? all.filter((r) => Math.abs(r.top - hit.top) < 2) : [];
    },
    onMove: (m: AxisDragMove) => {
      const o = optionAt(segmentAt(geo.current.row, m.clientX));
      if (!o || o.v === previewRef.current) return;
      showPreview(o.v, tempoOf(Math.abs(m.velocity().x)));
      haptic();
    },
    onRelease: (r: AxisDragRelease) => {
      const row = geo.current.row;
      const target =
        Math.abs(r.vx) > physics.flickMinSpeed
          ? (row[
              snapIndex(
                row.map((s) => s.cx),
                r.clientX,
                r.vx,
                { rate: physics.decelFast, minSpeed: physics.flickMinSpeed },
              )
            ]?.i ?? -1)
          : segmentAt(row, r.clientX);
      const o = optionAt(target);
      previewRef.current = null;
      setPreview(null);
      if (o && o.v !== value) select(o.v, r.tempo);
      return "none";
    },
    onCancel: () => showPreview(null, 0),
  });
  // native non-passive touchmove guard while sliding: an unconsumed fast slide makes Chrome swallow the next tap
  const touchGuard = useTouchMoveGuard(drag.isDragging);

  const shown = preview ?? value;
  const hasValue = options.some((o) => o.v === value);
  const hoverIn = (v: T, disabled?: boolean) => (e: PointerEvent<HTMLButtonElement>) => {
    if (ghost && e.pointerType === "mouse" && !disabled) setHovered({ v, speed: pointerSpeed() });
  };
  const thumbTransition = contextSpringAt(spring.segment, thumbTempo);
  const ghostTransition = contextSpring(spring.hover, hovered?.speed ?? 0);

  return (
    <div
      ref={touchGuard}
      role="radiogroup"
      onKeyDown={onKeyDown}
      onPointerLeave={() => setHovered(null)}
      {...drag.handlers}
      style={drag.style}
      className={cn("inline-flex flex-wrap gap-0.5 rounded-xl border border-line bg-ink-950/60 p-1", className)}
      {...aria}
    >
      {options.map((o, i) => {
        const checked = o.v === value;
        const thumb = o.v === shown;
        return (
          <motion.button
            key={o.v}
            ref={(el) => {
              if (el) refs.current.set(o.v, el);
              else refs.current.delete(o.v);
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            data-checked={thumb ? "true" : "false"}
            tabIndex={checked || (!hasValue && i === 0) ? 0 : -1}
            disabled={o.disabled}
            onClick={(e: MouseEvent<HTMLButtonElement>) => select(o.v, e.detail === 0 ? 0 : pointerTempo())}
            onPointerEnter={hoverIn(o.v, o.disabled)}
            whileTap={o.disabled ? undefined : "pressed"}
            className={cn(
              "relative inline-flex rounded-lg font-medium text-mute transition-colors hover:text-fg data-[checked=true]:text-fg disabled:opacity-40",
              size === "sm" ? "px-2.5 py-1 text-xs" : "px-3.5 py-1.5 text-[13px]",
              COARSE_HIT[size],
            )}
          >
            <AnimatePresence initial={false}>
              {thumb && (
                <motion.span
                  layoutId={`bg-${id}`}
                  layoutDependency={shown}
                  aria-hidden="true"
                  className={cn("absolute inset-0 rounded-lg border border-line-2 bg-ink-750 z-[1]", tones?.[o.v])}
                  style={{ borderRadius: radius.thumb }}
                  transition={thumbTransition}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                />
              )}
            </AnimatePresence>
            <AnimatePresence>
              {ghost && hovered?.v === o.v && (
                <motion.span
                  layoutId={`seg-hover-${id}`}
                  layoutDependency={hovered.v}
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 z-0 rounded-lg bg-white/[0.06]"
                  style={{ borderRadius: radius.thumb }}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1, transition: tween.hoverPill }}
                  exit={{ opacity: 0, transition: tween.hoverPill }}
                  transition={ghostTransition}
                />
              )}
            </AnimatePresence>
            <motion.span variants={LABEL_PRESS} transition={spring.press} className="relative z-10 inline-flex items-center gap-1.5">
              {o.label}
            </motion.span>
          </motion.button>
        );
      })}
    </div>
  );
}
