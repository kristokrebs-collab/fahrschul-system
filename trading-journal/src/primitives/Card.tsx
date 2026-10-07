import { AnimatePresence, animate, frame, motion, useMotionValue, useSpring, type HTMLMotionProps } from "motion/react";
import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { isScrolling } from "@/motion/scrollGate";
import { radius, spring, tween } from "@/motion/tokens";
import { useMediaQuery } from "@/motion/useMediaQuery";
import { useReducedFx } from "@/motion/useReducedFx";
import { nearestAngle, primeGlowRect, registerGlow } from "@/primitives/glowField";
import { useHoverRect } from "@/primitives/hoverRect";
import { Label } from "@/primitives/Label";

export interface CardProps extends Omit<HTMLMotionProps<"div">, "children" | "title" | "style"> {
  children: ReactNode;
  /** Section title rendered as `<h2 class="label">` with the signal dot. */
  title?: ReactNode;
  /** Right-aligned header slot. */
  action?: ReactNode;
  /** `text-xs text-faint` note under the header. */
  note?: ReactNode;
  /** Skip the `flex h-full flex-col p-5` inner padding. */
  bare?: boolean;
  /** Spotlight radius in px. */
  gradientSize?: number;
  /** Spotlight border colours (setup cards pass their colour as `gradientFrom`; it also tints the proximity arc). */
  gradientFrom?: string;
  gradientTo?: string;
  /** Inner glow colour under the pointer. */
  gradientColor?: string;
  /** Proximity border arc that points at a nearby pointer (default true). */
  edgeGlow?: boolean;
  /**
   * Classes of the card SURFACE (the inner `motion.div`), not of the outer wrapper: grid placement such as
   * `lg:col-span-*` does nothing here – put it on the cell that wraps the card.
   */
  className?: string;
  innerClassName?: string;
}

/** Half-width of the proximity arc in degrees. */
const ARC_SPREAD = 26;
const FINE_POINTER = "(hover: hover) and (pointer: fine)";

/**
 * Spotlight card (Bundle `Xw`/`kt`, Plan 2.5 "Card") – compositor-only at 120 Hz:
 * - spotlight: two PRE-RENDERED radial blobs (border tint inside a static `fx-ring` mask + inner glow) follow the
 *   pointer by `transform` only; the rect is measured on `pointerenter` and after scroll/resize, never per move;
 * - proximity arc (21st.dev "Glowing Effect"): a pre-rendered conic arc rotated by `spring.smooth` toward the
 *   pointer while it is within 64 px of the card and outside its dead centre; one shared tracker caps it at
 *   `MAX_ACTIVE_GLOWS` cards (`glowField.ts`);
 * - hover lift (CSS 500 ms `ease.out`) and a pre-rendered shadow layer crossfaded by opacity.
 * The two masked `fx-ring` layers exist only while needed – the spotlight ring while the pointer is on the card, the
 * arc while it is lit – so cards at rest add no card-sized composited layers (perf review perf-06).
 * Fine pointers only; under reduced motion the card keeps its static 1 px border.
 */
export function Card({
  children,
  title,
  action,
  note,
  bare,
  gradientSize = 240,
  gradientFrom = "#9b9b9b",
  gradientTo = "#2c2c2c",
  gradientColor = "rgba(255,255,255,0.045)",
  edgeGlow = true,
  className,
  innerClassName,
  onPointerEnter,
  onPointerMove,
  onPointerLeave,
  ...rest
}: CardProps) {
  const reduced = useReducedFx();
  const finePointer = useMediaQuery(FINE_POINTER, false);
  const fx = finePointer && !reduced;
  const surface = useRef<HTMLDivElement>(null);
  const hoverRect = useHoverRect();
  const lastPointer = useRef({ x: 0, y: 0 });

  // spotlight blob offset (top-left of a 2·gradientSize square centred on the pointer)
  const x = useMotionValue(-gradientSize);
  const y = useMotionValue(-gradientSize);
  // proximity arc
  const arcTarget = useMotionValue(0);
  const arcRotate = useSpring(arcTarget, spring.smooth);
  const arcOpacity = useMotionValue(0);
  const arcWillChange = useMotionValue("auto");
  /** Spotlight ring mounted (pointer on the card) / proximity arc mounted (lit or fading out). */
  const [ringOn, setRingOn] = useState(false);
  const ringRef = useRef(false);
  const [arcOn, setArcOn] = useState(false);
  const showRing = (on: boolean) => {
    if (ringRef.current === on) return;
    ringRef.current = on;
    setRingOn(on);
  };

  const place = (clientX: number, clientY: number, rect: DOMRect) => {
    x.set(clientX - rect.left - gradientSize);
    y.set(clientY - rect.top - gradientSize);
  };

  const track = (el: HTMLDivElement): DOMRect => {
    // a scroll under a resting pointer moves the card, not the pointer: re-place the blob from the last position
    const rect = hoverRect.enter(el, () =>
      frame.read(() => {
        const r = hoverRect.read();
        if (r) place(lastPointer.current.x, lastPointer.current.y, r);
      }),
    );
    primeGlowRect(el, rect);
    return rect;
  };

  const onEnter = (e: PointerEvent<HTMLDivElement>) => {
    onPointerEnter?.(e);
    // a card scrolling under a resting pointer: no rect read now – `onMove` starts tracking on the next real move
    if (!fx || e.pointerType !== "mouse" || isScrolling()) return;
    lastPointer.current = { x: e.clientX, y: e.clientY };
    place(e.clientX, e.clientY, track(e.currentTarget));
    showRing(true);
  };

  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    onPointerMove?.(e);
    // Chrome's synthetic moves while content scrolls under the pointer: no rect read until the scroll settles (the
    // `hoverRect` scroll callback keeps a tracked blob in place); the first real move afterwards re-tracks
    if (!fx || e.pointerType !== "mouse" || isScrolling()) return;
    lastPointer.current = { x: e.clientX, y: e.clientY };
    const rect = hoverRect.tracks(e.currentTarget) ? hoverRect.read() : track(e.currentTarget);
    if (rect) place(e.clientX, e.clientY, rect);
    showRing(true);
  };

  const onLeave = (e: PointerEvent<HTMLDivElement>) => {
    onPointerLeave?.(e);
    hoverRect.leave();
    showRing(false);
  };

  useEffect(() => {
    const el = surface.current;
    if (!fx || !edgeGlow || !el) return;
    let lit = false;
    const unregister = registerGlow(el, (active, angle) => {
      if (active) {
        if (!lit && arcOpacity.get() < 0.05) {
          // waking from dark: point straight at the pointer instead of sweeping round from the last angle
          arcTarget.jump(angle);
          arcRotate.jump(angle);
        } else {
          arcTarget.set(nearestAngle(arcTarget.get(), angle));
        }
      }
      if (active === lit) return;
      lit = active;
      if (active) {
        arcWillChange.set("transform");
        setArcOn(true);
      }
      animate(arcOpacity, active ? 1 : 0, {
        ...tween.fade,
        onComplete: () => {
          if (lit) return;
          arcWillChange.set("auto");
          setArcOn(false);
        },
      });
    });
    return () => {
      unregister();
      arcOpacity.jump(0);
      arcWillChange.set("auto");
      setArcOn(false);
    };
  }, [fx, edgeGlow, arcTarget, arcRotate, arcOpacity, arcWillChange]);

  const size = gradientSize * 2;
  const arc = `conic-gradient(from ${-ARC_SPREAD}deg, transparent 0deg, ${gradientFrom} ${ARC_SPREAD * 0.55}deg, #fff ${ARC_SPREAD}deg, ${gradientFrom} ${ARC_SPREAD * 1.45}deg, transparent ${ARC_SPREAD * 2}deg)`;

  return (
    <div className="group relative h-full">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 rounded-2xl shadow-[0_18px_40px_rgb(0_0_0/0.35)] opacity-0 transition-[opacity,translate] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:-translate-y-0.5 group-hover:opacity-100"
      />
      <motion.div
        {...rest}
        ref={surface}
        onPointerEnter={onEnter}
        onPointerMove={onMove}
        onPointerLeave={onLeave}
        style={{ borderRadius: radius.card }}
        className={cn(
          // `p-px` instead of a CSS border: overflow clips at the padding box, so the ring layers below can light the edge
          "group relative isolate h-full overflow-hidden rounded-2xl bg-background p-px transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-0.5",
          className,
        )}
      >
        <div aria-hidden="true" className="pointer-events-none absolute inset-px z-0 rounded-[inherit] bg-gradient-to-b from-white/[0.035] via-white/[0.01] to-transparent" />
        {fx && (
          <motion.span
            aria-hidden="true"
            className="pointer-events-none absolute left-0 top-0 z-0 rounded-full opacity-0 transition-opacity duration-300 group-hover:opacity-100 group-hover:will-change-transform"
            style={{ x, y, width: size, height: size, background: `radial-gradient(closest-side, ${gradientColor}, transparent)` }}
          />
        )}
        <span aria-hidden="true" className="pointer-events-none absolute inset-0 z-20 rounded-[inherit] border border-line" />
        <AnimatePresence initial={false}>
          {fx && ringOn && (
            <motion.span
              key="spot-ring"
              aria-hidden="true"
              className="fx-ring pointer-events-none absolute inset-0 z-20 rounded-[inherit] p-px"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={tween.fade}
            >
              <motion.span
                className="absolute left-0 top-0 rounded-full will-change-transform"
                style={{ x, y, width: size, height: size, background: `radial-gradient(closest-side, ${gradientFrom}, ${gradientTo}, transparent)` }}
              />
            </motion.span>
          )}
        </AnimatePresence>
        {fx && edgeGlow && arcOn && (
          <motion.span aria-hidden="true" className="fx-ring pointer-events-none absolute inset-0 z-20 rounded-[inherit] p-px [container-type:size]" style={{ opacity: arcOpacity }}>
            {/* sized to the card's diagonal (≤ √2 × the longer side), not the sum of its sides: the rotating disc stays
                as small as a full turn allows */}
            <motion.span
              className="absolute left-1/2 top-1/2 aspect-square w-[calc(max(100cqw,100cqh)*1.42)] -translate-x-1/2 -translate-y-1/2"
              style={{ rotate: arcRotate, willChange: arcWillChange, background: arc }}
            />
          </motion.span>
        )}
        <div className="relative z-10 h-full">
          {bare ? (
            children
          ) : (
            <div className={cn("flex h-full flex-col p-5", innerClassName)}>
              {(title || action || note) && (
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div className="grid gap-1">
                    {title && <Label>{title}</Label>}
                    {note && <span className="text-xs text-faint">{note}</span>}
                  </div>
                  {action}
                </div>
              )}
              {children}
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
