import { motion, useMotionValue, useSpring } from "motion/react";
import { useId, type PointerEvent } from "react";
import { ChartAttribution } from "@/chart/Attribution";
import { spring } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { useHoverRect } from "@/primitives/hoverRect";

export const FOOTER_TEXT = "TRADE JOURNAL";

/** Bundle `f2` stroke-draw: 4 s easeInOut, once when in view (Plan 3.3 "Footer"). */
const DRAW = { duration: 4, ease: "easeInOut" } as const;

/**
 * Outline wordmark (Bundle `f2`, Plan 2.5 "Footer-Outline"): SVG `<text>` `fill-transparent stroke-line-2`
 * `strokeWidth .4`, `strokeDasharray 1000` draw-in once in view, hover reveals a mouse-following radial mask
 * over a `#8a8a8a → #fff → #e5202e` gradient. The mask follows via MotionValues and the hover layers fade by CSS
 * (`group-hover`, hover devices only), so a hover never re-renders React; the rect is measured once per hover
 * (`useHoverRect`), never per move.
 */
export function FooterOutline({ text = FOOTER_TEXT }: { text?: string }) {
  const id = useId().replace(/:/g, "");
  const reduced = useReducedFx();
  const hoverRect = useHoverRect();
  const rawX = useMotionValue(0.5);
  const rawY = useMotionValue(0.5);
  const cx = useSpring(rawX, spring.tooltip);
  const cy = useSpring(rawY, spring.tooltip);

  const follow = (e: PointerEvent<SVGSVGElement>, r: DOMRect | null) => {
    if (!r) return;
    rawX.set((e.clientX - r.left) / Math.max(1, r.width));
    rawY.set((e.clientY - r.top) / Math.max(1, r.height));
  };
  const onPointerEnter = (e: PointerEvent<SVGSVGElement>) => {
    if (e.pointerType !== "mouse") return;
    const r = hoverRect.enter(e.currentTarget);
    // start the mask under the pointer instead of sweeping in from the last spot
    const x = (e.clientX - r.left) / Math.max(1, r.width);
    const y = (e.clientY - r.top) / Math.max(1, r.height);
    rawX.jump(x);
    rawY.jump(y);
    cx.jump(x);
    cy.jump(y);
  };
  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    if (e.pointerType !== "mouse") return;
    follow(e, hoverRect.tracks(e.currentTarget) ? hoverRect.read() : hoverRect.enter(e.currentTarget));
  };

  const textProps = { x: "50%", y: "50%", textAnchor: "middle", dominantBaseline: "middle", strokeWidth: "0.4" } as const;
  return (
    <svg className="group h-full w-full select-none" onPointerEnter={onPointerEnter} onPointerLeave={() => hoverRect.leave()} onPointerMove={onPointerMove} aria-hidden="true">
      <defs>
        <linearGradient id={`tg${id}`} gradientUnits="objectBoundingBox">
          <stop offset="0%" stopColor="#8a8a8a" />
          <stop offset="40%" stopColor="#ffffff" />
          <stop offset="65%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#e5202e" />
        </linearGradient>
        <motion.radialGradient id={`rm${id}`} gradientUnits="objectBoundingBox" r={0.22} cx={cx} cy={cy}>
          <stop offset="0%" stopColor="white" />
          <stop offset="100%" stopColor="black" />
        </motion.radialGradient>
        <mask id={`m${id}`} maskContentUnits="objectBoundingBox">
          <rect x="0" y="0" width="1" height="1" fill={`url(#rm${id})`} />
        </mask>
      </defs>
      {/* opacity fades on 0.2 s ease-out (= tween.fade, CSS, compositor); `hover:` variants only apply on hover-capable devices */}
      <text {...textProps} className="fill-transparent stroke-line-2 font-sans text-[72px] font-bold opacity-0 transition-opacity duration-200 ease-out group-hover:opacity-80">
        {text}
      </text>
      <motion.text
        {...textProps}
        className="fill-transparent stroke-line-2 font-sans text-[72px] font-bold"
        initial={reduced ? false : { strokeDashoffset: 1000, strokeDasharray: 1000 }}
        whileInView={{ strokeDashoffset: 0, strokeDasharray: 1000 }}
        viewport={{ once: true }}
        transition={DRAW}
      >
        {text}
      </motion.text>
      <text
        {...textProps}
        stroke={`url(#tg${id})`}
        mask={`url(#m${id})`}
        className="fill-transparent font-sans text-[72px] font-bold opacity-0 transition-opacity duration-200 ease-out group-hover:opacity-100"
      >
        {text}
      </text>
    </svg>
  );
}

/** `footer.mt-16 h-28 sm:h-36` (Plan 2.6) with the outline text and the mandatory lightweight-charts attribution (Plan 5.8). */
export function Footer() {
  return (
    <footer className="mt-16">
      <div className="h-28 sm:h-36">
        <FooterOutline />
      </div>
      <ChartAttribution className="pb-4 text-center" />
    </footer>
  );
}
