import { useEffect, useRef, type CSSProperties } from "react";
import { cn } from "@/lib/cn";
import { observeInView } from "@/motion/inView";
import { ease, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";

type ShimmerTag = "span" | "p" | "div";

export interface TextShimmerProps {
  /** The label – rendered as-is, so `textContent` and the accessible name stay exactly this string. */
  children: string;
  as?: ShimmerTag;
  className?: string;
  /** Seconds per sweep (default `tween.shimmerText`). */
  duration?: number;
  /** Band half-width per character in px (default 2 → `len · 2px`). */
  spread?: number;
  /** `false` renders the static base colour (e.g. once loading finished). */
  active?: boolean;
  /** Base and band colours (default mute → white). */
  baseColor?: string;
  bandColor?: string;
}

function cssEase(e: unknown): string {
  if (Array.isArray(e)) return `cubic-bezier(${e.join(",")})`;
  if (e === "easeOut") return "ease-out";
  if (e === "easeIn") return "ease-in";
  if (e === "easeInOut") return "ease-in-out";
  return typeof e === "string" ? e : `cubic-bezier(${ease.out.join(",")})`;
}

/**
 * Loading/status label with a bright band sweeping across muted text (21st.dev / motion-primitives "Text
 * Shimmer"): `background-clip: text`, band = `bandColor`, base = `baseColor`, looping linearly every 2 s.
 *
 * Declared motion exception (`text-shimmer`): the sweep moves `background-position` (a paint, not a composite) –
 * a glyph-clipped band cannot be transformed independently of its glyphs. Kept cheap: short labels only, a native
 * WAAPI animation (no per-frame JS), paused while off-screen. Reduced motion / `active={false}`: static base colour.
 */
export function TextShimmer({
  children,
  as = "span",
  className,
  duration = tween.shimmerText.duration,
  spread = 2,
  active = true,
  baseColor = "var(--color-mute)",
  bandColor = "var(--color-fg)",
}: TextShimmerProps) {
  const reduced = useReducedFx();
  const ref = useRef<HTMLSpanElement>(null);
  const on = active && !reduced;

  useEffect(() => {
    const el = ref.current;
    if (!on || !el || typeof el.animate !== "function") return;
    // motion-exception: text-shimmer — background-position sweep on a short label (see the component doc)
    const anim = el.animate([{ backgroundPosition: "100% center" }, { backgroundPosition: "0% center" }], {
      duration: duration * 1000,
      iterations: Infinity,
      easing: cssEase(tween.shimmerText.ease),
    });
    const unobserve = observeInView(el, (inView) => (inView ? anim.play() : anim.pause()));
    return () => {
      unobserve();
      anim.cancel();
    };
  }, [on, duration]);

  // the paragraph/div variants only differ in semantics; the ref is used as a plain HTMLElement
  const Tag = as as "span";
  const style: CSSProperties | undefined = on
    ? {
        color: "transparent",
        WebkitTextFillColor: "transparent",
        backgroundImage: `linear-gradient(90deg, transparent calc(50% - var(--shimmer-spread)), ${bandColor}, transparent calc(50% + var(--shimmer-spread))), linear-gradient(${baseColor}, ${baseColor})`,
        backgroundSize: "250% 100%, auto",
        backgroundRepeat: "no-repeat",
        backgroundPosition: "100% center",
        WebkitBackgroundClip: "text",
        backgroundClip: "text",
        ["--shimmer-spread" as string]: `${Math.max(8, children.length * spread)}px`,
      }
    : { color: baseColor };

  return (
    <Tag ref={ref} className={cn("inline-block", className)} style={style} data-shimmer={on ? "" : undefined}>
      {children}
    </Tag>
  );
}
