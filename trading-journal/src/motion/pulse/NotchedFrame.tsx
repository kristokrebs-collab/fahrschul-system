import { useLayoutEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * pulse-motion `notched-project-card` (measured): a round notch with two concave "ears" is cut into the card's
 * bottom-right corner and holds an arrow disc. Hover (or keyboard focus, or `active`): the media un-greys over
 * 400 ms `ease`, the disc turns red over 300 ms (.4,0,.2,1) and the arrow slides 2 px towards the corner – no
 * scale, no spring. Compositor-only: the media is a static grayscale(1) copy under a colour copy whose opacity
 * fades (a crossfade is exactly the linear grayscale(p) interpolation, without a filter repaint per frame), the
 * red disc is pre-painted and only fades, the arrow moves by transform.
 */
export const CONFIG = {
  grayMs: 400,
  grayEase: "cubic-bezier(.25,.1,.25,1)", // CSS `ease`
  discMs: 300,
  discEase: "cubic-bezier(.4,0,.2,1)",
  iconShift: 2, // px, x + / y −
  // pack geometry at a 82 × 83 notch: inner radius 50, disc 69, disc 1.5 px past the edge
  notchInner: 50 / 82,
  disc: 69 / 82,
  discOut: 1.5 / 82,
  icon: 20 / 82,
  /** Nothing palette (pack: disc #1d1d1d → #520000). */
  discRest: "var(--color-ink-750, #1c1c1c)",
  discHover: "var(--color-signal, #e5202e)",
  iconColor: "rgb(255 255 255 / 0.72)",
} as const;

export interface NotchedFrameProps {
  children?: ReactNode;
  /** Optional decorative media (image, colour accent) that greys out at rest and gains colour on hover. Rendered twice (grey + colour copy): keep it id-free. */
  media?: ReactNode;
  /** Card corner radius = the radius of the two ears (px). */
  radius?: number;
  /** Notch edge length (px); content should keep this much room free in the bottom-right corner. */
  notchSize?: number;
  /** Forces the hover state (touch tap preview, selected card). */
  active?: boolean;
  /** Classes for the masked card surface (background, border, padding). */
  className?: string;
  /** Classes for the media slot. */
  mediaClassName?: string;
  /** Hairline that follows the notched outline (e.g. "var(--color-line)"); use it instead of a CSS border, which the mask would cut. */
  outline?: string;
  /** Classes for the outer wrapper (grid placement). */
  wrapperClassName?: string;
  style?: CSSProperties;
}

/** SVG path of the card outline with the notch (+ concave ears) cut out of the bottom-right corner. */
export function notchPath(w: number, h: number, radius: number, notch: number): string {
  const rn = notch * CONFIG.notchInner;
  const rc = Math.max(0, Math.min(radius, w / 2, h / 2));
  const re = Math.max(0, Math.min(radius, notch - rn - 0.5));
  const n = (v: number) => +v.toFixed(2);
  return [
    `M${n(rc)} 0`,
    `H${n(w - rc)}`,
    `A${n(rc)} ${n(rc)} 0 0 1 ${n(w)} ${n(rc)}`,
    `V${n(h - notch - re)}`,
    `A${n(re)} ${n(re)} 0 0 1 ${n(w - re)} ${n(h - notch)}`,
    `H${n(w - notch + rn)}`,
    `A${n(rn)} ${n(rn)} 0 0 0 ${n(w - notch)} ${n(h - notch + rn)}`,
    `V${n(h - re)}`,
    `A${n(re)} ${n(re)} 0 0 1 ${n(w - notch - re)} ${n(h)}`,
    `H${n(rc)}`,
    `A${n(rc)} ${n(rc)} 0 0 1 0 ${n(h - rc)}`,
    `V${n(rc)}`,
    `A${n(rc)} ${n(rc)} 0 0 1 ${n(rc)} 0`,
    "Z",
  ].join("");
}

function maskUrl(w: number, h: number, radius: number, notch: number): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><path fill="#000" d="${notchPath(w, h, radius, notch)}"/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

// State lives in one custom property per frame (hover only on real hover devices → no sticky touch hover);
// the transitions run on filter / opacity / transform, never on the variable itself. Inside `@layer components`, so
// Tailwind utilities on the same elements (e.g. `absolute` on the media slot) win.
const CSS = `@layer components{
.pn-frame{--pn-on:0}
@media (hover:hover){.pn-frame:hover{--pn-on:1}}
.pn-frame:has(:focus-visible),.pn-frame[data-active]{--pn-on:1}
.pn-media{position:relative;isolation:isolate}
.pn-gray{filter:grayscale(1)}
.pn-color{position:absolute;inset:0;opacity:var(--pn-on);transition:opacity ${CONFIG.grayMs}ms ${CONFIG.grayEase}}
.pn-disc-hot{opacity:var(--pn-on);transition:opacity ${CONFIG.discMs}ms ${CONFIG.discEase}}
.pn-icon{transform:translate(calc(var(--pn-on) * ${CONFIG.iconShift}px),calc(var(--pn-on) * -${CONFIG.iconShift}px));transition:transform ${CONFIG.discMs}ms ${CONFIG.discEase}}
@media (prefers-reduced-motion:reduce){.pn-color,.pn-disc-hot,.pn-icon{transition-duration:.01ms}}
}`;

/**
 * Card surface with the pack's notch: the outline (rounded corners + notch + ears) is ONE SVG mask, built once per
 * size (ResizeObserver), so the cut works on any background. The disc sits in the notch outside the mask.
 */
export function NotchedFrame({ children, media, radius = 16, notchSize = 56, active, outline, className, mediaClassName, wrapperClassName, style }: NotchedFrameProps) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const outlineRef = useRef<SVGSVGElement>(null);
  const hasOutline = !!outline;

  useLayoutEffect(() => {
    const el = surfaceRef.current;
    if (!el) return;
    let lastW = -1;
    let lastH = -1;
    const apply = (w: number, h: number) => {
      w = Math.round(w);
      h = Math.round(h);
      if (w === lastW && h === lastH) return;
      lastW = w;
      lastH = h;
      if (w < notchSize || h < notchSize) return;
      const url = maskUrl(w, h, radius, notchSize);
      el.style.maskImage = url;
      el.style.setProperty("-webkit-mask-image", url);
      el.style.maskSize = "100% 100%";
      el.style.setProperty("-webkit-mask-size", "100% 100%");
      el.style.maskRepeat = "no-repeat";
      el.style.setProperty("-webkit-mask-repeat", "no-repeat");
      const svg = outlineRef.current;
      if (svg) {
        svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
        // inset by half the hairline so the stroke stays inside the cut shape
        svg.firstElementChild?.setAttribute("d", notchPath(w - 1, h - 1, Math.max(0, radius - 0.5), notchSize - 0.5));
      }
    };
    // the size comes from the ResizeObserver's first report – delivered after the frame's layout and before its paint,
    // for every card of a page in ONE pass, so the first painted frame already carries the mask. Reading offsetWidth
    // here instead forced a style + layout per card, each invalidated by the previous card's new mask (≈ 95 ms of layout
    // thrash when the Entscheidungsgrundlagen page mounted on the tablet probe). Without ResizeObserver: read once.
    if (typeof ResizeObserver !== "function") {
      apply(el.offsetWidth, el.offsetHeight);
      return;
    }
    const ro = new ResizeObserver((entries) => {
      const box = entries[0]?.borderBoxSize?.[0];
      if (box) apply(box.inlineSize, box.blockSize);
      else apply(el.offsetWidth, el.offsetHeight);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [radius, notchSize, hasOutline]);

  const disc = Math.round(notchSize * CONFIG.disc);
  const out = -notchSize * CONFIG.discOut;
  const icon = Math.max(14, Math.round(notchSize * CONFIG.icon));

  return (
    <div className={cn("pn-frame relative isolate min-w-0", wrapperClassName)} data-active={active ? "" : undefined} style={style}>
      <style href="pulse-notched-frame" precedence="default">
        {CSS}
      </style>
      <div ref={surfaceRef} className={cn("relative h-full", className)} style={{ borderRadius: radius }}>
        {media !== undefined && (
          <div className={cn("pn-media", mediaClassName)}>
            <div className="pn-gray" aria-hidden="true">
              {media}
            </div>
            <div className="pn-color">{media}</div>
          </div>
        )}
        {children}
      </div>
      {outline && (
        <svg ref={outlineRef} aria-hidden="true" className="pointer-events-none absolute inset-0 size-full overflow-visible" preserveAspectRatio="none">
          <path transform="translate(.5 .5)" fill="none" stroke={outline} strokeWidth="1" />
        </svg>
      )}
      <span aria-hidden="true" className="pointer-events-none absolute grid place-items-center rounded-full" style={{ right: out, bottom: out, width: disc, height: disc, background: CONFIG.discRest }}>
        <span className="pn-disc-hot absolute inset-0 rounded-full" style={{ background: CONFIG.discHover }} />
        <svg className="pn-icon relative" width={icon} height={icon} viewBox="0 0 24 24" fill="none" stroke={CONFIG.iconColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M7 7h10v10" />
          <path d="M7 17 17 7" />
        </svg>
      </span>
    </div>
  );
}
