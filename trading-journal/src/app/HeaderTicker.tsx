/**
 * Live market ticker in the header, visible on every page: a status dot that pings on every trade print, the base
 * asset, the last price gliding on `spring.price` with a green/red flash per significant move, and the live 24 h change
 * (`price / open24h − 1`) that moves with every trade. Everything renders from MotionValues (`priceMv`, `open24hMv`,
 * `tradeCountMv`): zero React renders per tick; the dot re-renders on health changes only. Decorative duplicate of the
 * market panel (`aria-hidden`): a constantly changing number is never announced. Reduced motion: no glide, no ping,
 * the flash becomes an underline.
 */
import { motion, useMotionValue, useSpring, useTransform, type MotionValue } from "motion/react";
import { memo, useEffect, useMemo, useRef } from "react";
import { cn } from "@/lib/cn";
import { open24hMv, priceMv, resolveSymbol, tradeCountMv, useStatusTone } from "@/market";
import { formatNumber } from "@/motion/MotionNumber";
import { PulseDot } from "@/motion/PulseDot";
import { spring } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { FLASH_MIN_INTERVAL_MS, useValueFlash } from "@/motion/ValueFlash";
import { useJournal } from "@/store/journalStore";

/** A move larger than this share of the price is a jump (reconnect gap, symbol switch), never a glide. */
export const TICKER_MAX_GLIDE = 0.02;

/** Pure: display decimals of a live price (≥ 1000 → 1, ≥ 10 → 2, ≥ 1 → 3, else 5). */
export function tickerDecimals(price: number): number {
  if (!Number.isFinite(price) || price >= 1000) return 1;
  if (price >= 10) return 2;
  if (price >= 1) return 3;
  return 5;
}

/** Pure: de-DE price label, `–` while unknown (`priceMv` is 0 until the first print). */
export function tickerPrice(price: number): string {
  return Number.isFinite(price) && price > 0 ? formatNumber(price, { decimals: tickerDecimals(price) }) : "–";
}

/** Pure: the live 24 h change in % rounded to the displayed 2 decimals (no negative zero); `NaN` while unknown. */
export function tickerChangePct(price: number, open24h: number): number {
  if (!(price > 0) || !(open24h > 0)) return NaN;
  const r = Math.round((price / open24h - 1) * 10_000) / 100;
  return r === 0 ? 0 : r;
}

/** Pure: `+1,23 %` / `−0,40 %` / `0,00 %`, `– %` while unknown. */
export function tickerChange(price: number, open24h: number): string {
  const c = tickerChangePct(price, open24h);
  return Number.isFinite(c) ? formatNumber(c, { decimals: 2, signed: true, suffix: " %" }) : "– %";
}

/** Pure: whether the glide must jump to `to` instead of springing (unknown on either side, or a gap > 2 %). */
export function tickerJump(from: number, to: number): boolean {
  if (!(from > 0) || !(to > 0)) return true;
  return Math.abs(to - from) > from * TICKER_MAX_GLIDE;
}

/** Pure: minimum move between two ticker flashes – ten display ticks (1 USD at BTC, 0,1 at a 2-decimal price). */
export function tickerFlashStep(price: number): number {
  return 10 ** (1 - tickerDecimals(price));
}

/**
 * Pure flash step: the anchor moves only on a significant move (`≥ minMove`, default `tickerFlashStep(anchor)`) and
 * then reports its direction; the first price after "unknown" only anchors.
 */
export function priceStep(anchor: number, next: number, minMove = tickerFlashStep(anchor)): { anchor: number; dir: -1 | 0 | 1 } {
  if (!(next > 0)) return { anchor: 0, dir: 0 };
  if (!(anchor > 0)) return { anchor: next, dir: 0 };
  const move = next - anchor;
  if (Math.abs(move) < minMove) return { anchor, dir: 0 };
  return { anchor: next, dir: move > 0 ? 1 : -1 };
}

/** `priceMv` gliding on `spring.price`; jumps on unknown / large gaps and under reduced motion. */
function usePriceGlide(reduced: boolean): MotionValue<number> {
  const target = useMotionValue(priceMv.get());
  const glide = useSpring(target, spring.price);
  useEffect(() => {
    const now = priceMv.get();
    target.jump(now);
    glide.jump(now);
    return priceMv.on("change", (v) => {
      if (reduced || tickerJump(glide.get(), v)) {
        target.jump(v);
        glide.jump(v);
      } else target.set(v);
    });
  }, [reduced, target, glide]);
  return glide;
}

/** Counter of significant moves (`+1` up, `−1` down): one flash per move. */
function usePriceMoves(): MotionValue<number> {
  const moves = useMotionValue(0);
  useEffect(() => {
    let anchor = priceMv.get();
    return priceMv.on("change", (v) => {
      const s = priceStep(anchor, v);
      anchor = s.anchor;
      if (s.dir !== 0) moves.set(moves.get() + s.dir);
    });
  }, [moves]);
  return moves;
}

/** The dot: tone from the trade feed's health, a ping per print (≤ 4 Hz), no idle loop. */
function TickerDot() {
  const tone = useStatusTone("aggTrade");
  return <PulseDot tone={tone} size={6} rings={0} ping={tradeCountMv} />;
}

const TickerPrice = memo(function TickerPrice({ glide, reduced }: { glide: MotionValue<number>; reduced: boolean }) {
  const text = useTransform(glide, tickerPrice);
  const moves = usePriceMoves();
  const up = useRef<HTMLSpanElement>(null);
  const down = useRef<HTMLSpanElement>(null);
  useValueFlash({ source: moves }, up, down, { cooldownMs: FLASH_MIN_INTERVAL_MS });
  const layer = reduced ? "inset-x-0 -bottom-1 h-0.5 rounded-full" : "-inset-x-1.5 -inset-y-1 -z-10 rounded-md";
  return (
    <span className="relative isolate inline-flex">
      <span ref={up} className={cn("pointer-events-none absolute opacity-0", layer, reduced ? "bg-win" : "bg-win/20")} />
      <span ref={down} className={cn("pointer-events-none absolute opacity-0", layer, reduced ? "bg-loss" : "bg-loss/20")} />
      <motion.span className="tabular-nums text-fg [contain:layout_paint]">{text}</motion.span>
    </span>
  );
});

const TickerChange = memo(function TickerChange({ glide, className }: { glide: MotionValue<number>; className?: string }) {
  const text = useTransform(() => tickerChange(glide.get(), open24hMv.get()));
  // only the sign flips the tint: a string MotionValue, so the style is written on a flip and never per tick
  const color = useTransform(() => {
    const c = tickerChangePct(glide.get(), open24hMv.get());
    return c > 0 ? "var(--color-win)" : c < 0 ? "var(--color-loss)" : "var(--color-mute)";
  });
  return (
    <motion.span className={cn("tabular-nums [contain:layout_paint]", className)} style={{ color }}>
      {text}
    </motion.span>
  );
});

export function HeaderTicker({ className }: { className?: string }) {
  const reduced = useReducedFx();
  const symbol = useJournal((s) => s.settings.market.symbol);
  const base = useMemo(() => {
    const info = resolveSymbol(symbol);
    return info.base ?? info.binance;
  }, [symbol]);
  const glide = usePriceGlide(reduced);
  return (
    <div
      aria-hidden="true"
      data-header-ticker=""
      className={cn("pointer-events-none flex min-w-0 shrink-0 items-center gap-2 rounded-full border border-line bg-ink-950/60 px-2.5 py-1.5 font-mono text-[12px] leading-none", className)}
    >
      <TickerDot />
      <span className="text-faint max-sm:hidden">{base}</span>
      <TickerPrice glide={glide} reduced={reduced} />
      <TickerChange glide={glide} className="max-lg:hidden" />
    </div>
  );
}
