import { AnimatePresence, animate, frame, motion, useMotionValue, useSpring, type AnimationPlaybackControls, type HTMLMotionProps } from "motion/react";
import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { observeInView } from "@/motion/inView";
import { NoLayoutCascade } from "@/motion/NoLayoutCascade";
import { useRich } from "@/motion/rich";
import { isScrolling } from "@/motion/scrollGate";
import { radius, spring, tween } from "@/motion/tokens";
import { useMediaQuery } from "@/motion/useMediaQuery";
import { useReducedFx } from "@/motion/useReducedFx";
import { BorderBeam } from "@/primitives/BorderBeam";
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
   * Rich pages, mouse only: a very light 3D tilt toward the pointer (degrees, `true` = 3) with a brighter glare that
   * follows it. Opt-in, because a tilted card is a transformed ancestor while hovered – never on a card with a
   * `position: fixed` ghost inside (chart marker, table ghost) or a morph source.
   */
  tilt?: boolean | number;
  /** Rich pages: the edge light runs one lap when the card is first seen and again (at most every 8 s) when a mouse enters – for the one highlighted card of a page. */
  highlight?: boolean;
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
/** Rich tilt (`tilt`): default degrees, perspective (px) and the pause between two beam laps. */
const TILT_DEG = 3;
const TILT_PERSPECTIVE = 900;
const BEAM_GAP_MS = 8000;
/** The glare of a tilting card: the spotlight blob, brighter (veil ink, so it turns to ink on paper). */
const GLARE = "rgb(var(--veil-rgb, 255 255 255) / 0.085)";

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
  gradientFrom = "var(--card-ring-from, #9b9b9b)",
  gradientTo = "var(--card-ring-to, #2c2c2c)",
  gradientColor = "var(--card-spot, rgba(255,255,255,0.045))",
  edgeGlow = true,
  tilt,
  highlight,
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
  const richPage = useRich();
  const rich = richPage && fx;
  const tiltDeg = rich && tilt ? (tilt === true ? TILT_DEG : tilt) : 0;
  const surface = useRef<HTMLDivElement>(null);
  const hoverRect = useHoverRect();
  const lastPointer = useRef({ x: 0, y: 0 });

  // spotlight blob offset (top-left of a 2·gradientSize square centred on the pointer)
  const x = useMotionValue(-gradientSize);
  const y = useMotionValue(-gradientSize);
  // tilt (rich pages, opt-in): rotation toward the pointer; perspective only while hovered, so a card at rest keeps `transform: none`
  const rx = useMotionValue(0);
  const ry = useMotionValue(0);
  const srx = useSpring(rx, spring.tilt);
  const sry = useSpring(ry, spring.tilt);
  const persp = useMotionValue(0);
  const hovering = useRef(false);
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

  const glide = useRef<AnimationPlaybackControls[]>([]);
  const place = (clientX: number, clientY: number, rect: DOMRect, smooth = false) => {
    for (const g of glide.current) g.stop();
    glide.current = [];
    const nx = clientX - rect.left - gradientSize;
    const ny = clientY - rect.top - gradientSize;
    if (tiltDeg > 0 && rect.width > 0 && rect.height > 0) {
      const u = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) - 0.5;
      const v = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height)) - 0.5;
      ry.set(u * 2 * tiltDeg);
      rx.set(-v * 2 * tiltDeg);
    }
    if (smooth) {
      glide.current = [animate(x, nx, tween.fade), animate(y, ny, tween.fade)];
      return;
    }
    x.set(nx);
    y.set(ny);
  };

  const track = (el: HTMLDivElement): DOMRect => {
    // a scroll under a resting pointer moves the card, not the pointer: the blob rides with the card while it scrolls
    // (no rect read per scroll event) and glides back under the pointer once the scroll has settled
    const rect = hoverRect.enter(el, () =>
      frame.read(() => {
        const r = hoverRect.read();
        if (r) place(lastPointer.current.x, lastPointer.current.y, r, true);
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
    if (tiltDeg > 0) {
      hovering.current = true;
      persp.set(TILT_PERSPECTIVE);
    }
    place(e.clientX, e.clientY, track(e.currentTarget));
    showRing(true);
    if (highlight) lap();
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
    if (tiltDeg > 0) {
      hovering.current = false;
      rx.set(0);
      ry.set(0);
    }
  };

  // tilt: the perspective goes once both springs have come to rest (`transform: none` again – no containing block left behind)
  useEffect(() => {
    if (tiltDeg <= 0) return;
    const settle = () => {
      if (!hovering.current && Math.abs(srx.get()) < 0.02 && Math.abs(sry.get()) < 0.02) persp.set(0);
    };
    const offs = [srx.on("change", settle), sry.on("change", settle)];
    return () => offs.forEach((off) => off());
  }, [tiltDeg, srx, sry, persp]);

  // highlight: one beam lap when the card is first seen (touch too), and again for a mouse that enters (not more often than every BEAM_GAP_MS)
  const [lapKey, setLapKey] = useState(0);
  const lastLap = useRef(0);
  const lap = () => {
    const now = performance.now();
    if (lastLap.current && now - lastLap.current < BEAM_GAP_MS) return;
    lastLap.current = now;
    setLapKey((n) => n + 1);
  };
  useEffect(() => {
    const el = surface.current;
    if (!richPage || reduced || !highlight || !el) return;
    let done = false;
    return observeInView(el, (inView) => {
      if (!inView || done) return;
      done = true;
      lap();
    });
  }, [richPage, reduced, highlight]);

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
  const arc = `conic-gradient(from ${-ARC_SPREAD}deg, transparent 0deg, ${gradientFrom} ${ARC_SPREAD * 0.55}deg, var(--card-ring-peak, #fff) ${ARC_SPREAD}deg, ${gradientFrom} ${ARC_SPREAD * 1.45}deg, transparent ${ARC_SPREAD * 2}deg)`;

  return (
    <div className="group relative h-full">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 rounded-2xl shadow-[0_18px_40px_rgb(0_0_0/calc(0.35*var(--shade,1)))] opacity-0 transition-[opacity,translate] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:-translate-y-0.5 group-hover:opacity-100"
      />
      <motion.div
        {...rest}
        ref={surface}
        onPointerEnter={onEnter}
        onPointerMove={onMove}
        onPointerLeave={onLeave}
        style={tiltDeg > 0 ? { borderRadius: radius.card, rotateX: srx, rotateY: sry, transformPerspective: persp } : { borderRadius: radius.card }}
        className={cn(
          // `p-px` instead of a CSS border: overflow clips at the padding box, so the ring layers below can light the edge
          "group relative isolate h-full overflow-hidden rounded-2xl bg-background p-px duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-0.5",
          // a tilting card must not let a CSS transition smear the transform that Motion writes every frame
          tiltDeg > 0 ? "transition-[translate]" : "transition-transform",
          className,
        )}
      >
        <div aria-hidden="true" className="pointer-events-none absolute inset-px z-0 rounded-[inherit] bg-gradient-to-b from-white/[0.035] via-white/[0.01] to-transparent" />
        {rich && (
          // rich pages: a soft frosted veil washes over the card while a mouse is on it (opacity only) + a hairline of light on its top edge
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-px z-0 rounded-[inherit] bg-gradient-to-br from-white/[0.05] via-white/[0.012] to-transparent opacity-0 shadow-[inset_0_1px_0_rgb(var(--veil-rgb,255_255_255)/0.08)] transition-opacity duration-500 group-hover:opacity-100"
          />
        )}
        {fx && (
          <motion.span
            aria-hidden="true"
            className="pointer-events-none absolute left-0 top-0 z-0 rounded-full opacity-0 transition-opacity duration-300 group-hover:opacity-100 group-hover:will-change-transform"
            style={{ x, y, width: size, height: size, background: `radial-gradient(closest-side, ${tiltDeg > 0 ? GLARE : gradientColor}, transparent)` }}
          />
        )}
        <span aria-hidden="true" className="pointer-events-none absolute inset-0 z-20 rounded-[inherit] border border-line" />
        {richPage && !reduced && highlight && lapKey > 0 && (
          <div aria-hidden="true" data-testid="card-beam" className="pointer-events-none absolute inset-0 z-20 rounded-[inherit]">
            <BorderBeam fire={lapKey} size={120} borderWidth={1} />
          </div>
        )}
        {/* the ring is `absolute inset-0`: its exit never moves a sibling, so no app-wide re-render after it */}
        <NoLayoutCascade>
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
        </NoLayoutCascade>
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
