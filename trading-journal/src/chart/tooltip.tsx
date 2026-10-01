/**
 * Crosshair tooltip overlay (Plan 5.6). Position lives in MotionValues (`spring.tooltip`), text is
 * written through DOM refs – no React state per crosshair move. Box classes = Plan 2.5 "Tooltip (Charts)".
 */
import { useImperativeHandle, useRef, type Ref } from "react";
import { motion, useMotionValue, useSpring } from "motion/react";
import { spring } from "@/motion/tokens";
import { cn } from "@/lib/cn";
import { fmt } from "./format";
import { formatChartTime } from "./theme";

export const TOOLTIP_CLASS =
  "rounded-xl border border-line-2 bg-ink-850/95 px-3 py-2 text-xs shadow-[0_12px_32px_rgb(0_0_0/0.45)] backdrop-blur-sm";

export interface TooltipData {
  /** UTC seconds */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface TooltipText {
  time: string;
  open: string;
  high: string;
  low: string;
  close: string;
  /** candle change `(close − open) / open`, signed, 2 decimals, `%` */
  delta: string;
  tone: "win" | "loss" | "fg";
}

export function candleDelta(d: Pick<TooltipData, "open" | "close">): number | null {
  if (!Number.isFinite(d.open) || d.open === 0 || !Number.isFinite(d.close)) return null;
  return ((d.close - d.open) / d.open) * 100;
}

export function formatTooltip(d: TooltipData): TooltipText {
  const delta = candleDelta(d);
  return {
    time: formatChartTime(d.time as never),
    open: fmt.price(d.open),
    high: fmt.price(d.high),
    low: fmt.price(d.low),
    close: fmt.price(d.close),
    delta: delta == null ? "–" : `${fmt.signed(delta, 2)} %`,
    tone: delta == null || delta === 0 ? "fg" : delta > 0 ? "win" : "loss",
  };
}

export interface TooltipHandle {
  /** Move to chart-relative css px and update the text. */
  move(point: { x: number; y: number }, data: TooltipData, bounds: { width: number; height: number }): void;
  hide(): void;
}

export const TOOLTIP_WIDTH = 176;
const OFFSET = 14;

/** Places the box right of the cursor, flips left near the right edge; clamps vertically. */
export function placeTooltip(
  point: { x: number; y: number },
  bounds: { width: number; height: number },
  size: { width: number; height: number } = { width: TOOLTIP_WIDTH, height: 108 },
): { x: number; y: number } {
  const x = point.x + OFFSET + size.width > bounds.width ? point.x - OFFSET - size.width : point.x + OFFSET;
  const y = Math.max(4, Math.min(point.y - size.height / 2, bounds.height - size.height - 4));
  return { x: Math.max(4, x), y };
}

export interface ChartTooltipProps {
  ref?: Ref<TooltipHandle>;
  className?: string;
}

const TONE_CLASS = { win: "text-win", loss: "text-loss", fg: "text-fg" } as const;

export function ChartTooltip({ ref, className }: ChartTooltipProps) {
  const rawX = useMotionValue(0);
  const rawY = useMotionValue(0);
  const x = useSpring(rawX, spring.tooltip);
  const y = useSpring(rawY, spring.tooltip);
  const visible = useMotionValue(0);
  const box = useRef<HTMLDivElement>(null);
  const els = useRef<Record<keyof TooltipText, HTMLElement | null>>({
    time: null,
    open: null,
    high: null,
    low: null,
    close: null,
    delta: null,
    tone: null,
  });
  const shown = useRef(false);
  // the box has a fixed width and row count: measure once instead of forcing a layout read on every move
  const size = useRef<{ width: number; height: number } | null>(null);
  const tone = useRef<TooltipText["tone"] | null>(null);

  useImperativeHandle(
    ref,
    () => ({
      move(point, data, bounds) {
        const text = formatTooltip(data);
        if (!size.current && box.current?.offsetHeight) size.current = { width: box.current.offsetWidth || TOOLTIP_WIDTH, height: box.current.offsetHeight };
        const pos = placeTooltip(point, bounds, size.current ?? undefined);
        if (!shown.current) {
          // first show: no fly-in from the previous position
          rawX.jump(pos.x);
          rawY.jump(pos.y);
          x.jump(pos.x);
          y.jump(pos.y);
          shown.current = true;
        } else {
          rawX.set(pos.x);
          rawY.set(pos.y);
        }
        const e = els.current;
        if (e.time) e.time.textContent = text.time;
        if (e.open) e.open.textContent = text.open;
        if (e.high) e.high.textContent = text.high;
        if (e.low) e.low.textContent = text.low;
        if (e.close) e.close.textContent = text.close;
        if (e.delta) {
          e.delta.textContent = text.delta;
          if (tone.current !== text.tone) {
            tone.current = text.tone;
            e.delta.className = cn("num text-right font-mono font-medium", TONE_CLASS[text.tone]);
          }
        }
        visible.set(1);
      },
      hide() {
        visible.set(0);
        shown.current = false;
      },
    }),
    [rawX, rawY, x, y, visible],
  );

  return (
    <motion.div
      ref={box}
      role="status"
      aria-live="off"
      className={cn("pointer-events-none absolute left-0 top-0 z-10 will-change-transform", TOOLTIP_CLASS, className)}
      style={{ x, y, opacity: visible, width: TOOLTIP_WIDTH }}
    >
      <div ref={(n) => void (els.current.time = n)} className="num font-mono text-[11px] text-mute" />
      <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
        <dt className="text-mute">O</dt>
        <dd ref={(n) => void (els.current.open = n)} className="num text-right font-mono font-medium" />
        <dt className="text-mute">H</dt>
        <dd ref={(n) => void (els.current.high = n)} className="num text-right font-mono font-medium" />
        <dt className="text-mute">L</dt>
        <dd ref={(n) => void (els.current.low = n)} className="num text-right font-mono font-medium" />
        <dt className="text-mute">C</dt>
        <dd ref={(n) => void (els.current.close = n)} className="num text-right font-mono font-medium" />
        <dt className="text-mute">Δ</dt>
        <dd ref={(n) => void (els.current.delta = n)} className="num text-right font-mono font-medium" />
      </dl>
    </motion.div>
  );
}
