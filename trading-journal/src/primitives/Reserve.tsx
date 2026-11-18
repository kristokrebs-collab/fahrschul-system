import { Suspense, type CSSProperties, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Skeleton, SkeletonSwap } from "@/primitives/Skeleton";

/**
 * Room for a card that arrives late (Feinschliff 2026-10, layout shift): a card whose content comes after the first paint
 * (a Monte Carlo run, daily candles, a lazy chunk) used to start small and push everything below it down when it
 * landed. `Reserve` holds the card's END size from the first frame instead – a `min-height` floor per breakpoint and,
 * until the content is there, a placeholder card of exactly that size (`CardSkeleton`).
 *
 *   // floor only – the card shows its own loading state inside the reserved box
 *   <Reserve height={{ base: 944, lg: 744 }}><MonteCarloCard … /></Reserve>
 *   // placeholder until `ready`, then a zero-shift crossfade; the floor goes with the placeholder
 *   <Reserve height={360} ready={candles.length > 0}><BenchmarkCard … /></Reserve>
 *   // lazy chunk: the fallback has the end size
 *   <Suspense fallback={<ReserveFallback height={360} />}><LazyCard /></Suspense>   (or `<ReserveSuspense height={360}>`)
 *
 * Heights are measured px of the finished card (mobile 390 / tablet / desktop 1280). They only need to be close: a card
 * that ends a little taller grows by the difference, one that ends shorter leaves a little air below its content.
 * Nothing here animates a size – the floor is a plain `min-height`, the placeholder shimmers by `transform`.
 */

/** px per breakpoint: `base` below 640 px, `sm` from 640 px, `lg` from 1024 px (each falls back to the one before). */
export type ReserveHeight = number | { base: number; sm?: number; lg?: number };

/** CSS custom properties of a reserve (`--reserve`, `--reserve-sm`, `--reserve-lg`), for `style`. */
export function reserveStyle(height: ReserveHeight): CSSProperties {
  const h = typeof height === "number" ? { base: height } : height;
  const base = Math.max(0, Math.round(h.base));
  const sm = Math.max(0, Math.round(h.sm ?? h.base));
  const lg = Math.max(0, Math.round(h.lg ?? h.sm ?? h.base));
  return { "--reserve": `${base}px`, "--reserve-sm": `${sm}px`, "--reserve-lg": `${lg}px` } as CSSProperties;
}

/** The floor itself: `min-height` from the custom properties of `reserveStyle`. */
export const RESERVE_CLASS = "min-h-(--reserve) sm:min-h-(--reserve-sm) lg:min-h-(--reserve-lg)";

/** Same floor for a deferred cell (`Reveal defer`), whose box carries 12 px of room above and below its card (`DEFER_CLASS`). */
export const RESERVE_CLASS_DEFER = "min-h-[calc(var(--reserve)+1.5rem)] sm:min-h-[calc(var(--reserve-sm)+1.5rem)] lg:min-h-[calc(var(--reserve-lg)+1.5rem)]";

/**
 * `content-visibility: auto` remembers the size a skipped cell had when it was last rendered; until then it assumes this one
 * (the cell's end size per breakpoint, from the same custom properties as the floor).
 */
export const INTRINSIC_CLASS = "[contain-intrinsic-block-size:auto_var(--reserve)] sm:[contain-intrinsic-block-size:auto_var(--reserve-sm)] lg:[contain-intrinsic-block-size:auto_var(--reserve-lg)]";

/**
 * Placeholder in a card's shape (rounded-2xl, hairline border, the label bar, then rows) that fills its parent. Use it
 * wherever a whole card is still to come; it is `aria-hidden` – say "wird geladen" through `aria-busy` of the owner.
 */
export function CardSkeleton({ className, rows = 4 }: { className?: string; rows?: number }) {
  return (
    <div className={cn("relative flex h-full min-h-24 flex-col gap-3 overflow-hidden rounded-2xl border border-line bg-white/[0.015] p-5", className)} aria-hidden="true" data-card-skeleton="">
      <Skeleton className="h-3 w-[min(140px,40%)] rounded" />
      <div className="mt-1 grid flex-1 content-start gap-3">
        {Array.from({ length: rows }, (_, i) => (
          <Skeleton key={i} className="h-4 rounded-md" style={{ width: `${92 - ((i * 17) % 38)}%` }} />
        ))}
      </div>
    </div>
  );
}

export interface ReserveProps {
  /** End size of the card (px per breakpoint). */
  height: ReserveHeight;
  /**
   * Omitted: the floor stays and the children are always shown (the card has its own loading state).
   * `false` / `true`: a `CardSkeleton` of the reserved size stands in until `true`, then the children crossfade in and the
   * floor is released (the content sets the height from there on).
   */
  ready?: boolean;
  /** A placeholder of your own (default `CardSkeleton`); it fills the reserved box. */
  skeleton?: ReactNode;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

/** A box that holds the end size of a late card (see the file comment). */
export function Reserve({ height, ready, skeleton, className, style, children }: ReserveProps) {
  const vars = { ...reserveStyle(height), ...style };
  if (ready === undefined) {
    return (
      <div className={cn("flex min-w-0 flex-col [&>*]:flex-1", RESERVE_CLASS, className)} style={vars}>
        {children}
      </div>
    );
  }
  return (
    <SkeletonSwap ready={ready} skeleton={skeleton ?? <CardSkeleton />} className={cn("min-w-0", !ready && RESERVE_CLASS, className)}>
      <div style={vars} className="flex min-w-0 flex-col [&>*]:flex-1">
        {children}
      </div>
    </SkeletonSwap>
  );
}

/** `Suspense` fallback with the end size of the lazy card (`CardSkeleton` on a floor), `aria-busy` for assistive tech. */
export function ReserveFallback({ height, className, rows }: { height: ReserveHeight; className?: string; rows?: number }) {
  return (
    <div className={cn("min-w-0", RESERVE_CLASS, className)} style={reserveStyle(height)} aria-busy="true">
      <CardSkeleton rows={rows} />
    </div>
  );
}

/** `<Suspense fallback={<ReserveFallback height={…} />}>` in one piece. */
export function ReserveSuspense({ height, className, rows, children }: { height: ReserveHeight; className?: string; rows?: number; children?: ReactNode }) {
  return <Suspense fallback={<ReserveFallback height={height} className={className} rows={rows} />}>{children}</Suspense>;
}
