/**
 * Live leaves of the market panel. Every number here is a MotionValue rendered as a `motion.*` text child or
 * transform, so a trade, a book update or a clock second never re-renders React: the panel commits only when its
 * structure changes (status, scenario, a trigger coming into reach). Each leaf takes the provider snapshot value
 * as a `fallback` for the frame(s) before the MotionValues are seeded (`0` = unknown).
 */
import { motion, useMotionValue, useTransform, type MotionValue } from "motion/react";
import { memo, useCallback, useEffect, useMemo, useRef, type ReactNode, type Ref } from "react";
import { countdownLabel, livePreviewLabel, type Scenario } from "@/domain/trigger";
import { cn } from "@/lib/cn";
import { n0, signed } from "@/lib/format";
import {
  askMv,
  bidMv,
  flowImbalanceMv,
  fundingMv,
  fundingPct,
  liveAgeLabel,
  markMv,
  nextFundingMv,
  open24hMv,
  priceMv,
  priceReceivedAtMv,
  STRINGS,
  tradeCountMv,
  volAccumMv,
} from "@/market";
import { hhmmss } from "@/market/format";
import { useNowMv } from "@/motion/clock";
import { DotMatrix } from "@/motion/DotMatrix";
import { MorphCard } from "@/motion/MorphCard";
import { formatNumber, MotionNumber } from "@/motion/MotionNumber";
import { RollingDigits } from "@/motion/RollingDigits";
import { StatusPill } from "@/motion/StatusPill";
import { spring, tween } from "@/motion/tokens";
import { usePressable } from "@/motion/usePressable";
import { useReducedFx } from "@/motion/useReducedFx";
import { FLASH_MIN_INTERVAL_MS, useValueFlash } from "@/motion/ValueFlash";
import { WidgetGrid } from "@/motion/pulse/WidgetGrid";
import { Explainer } from "@/primitives/VerdictPanel";
import { bookExplain, fundingExplain, openInterestExplain, takerExplain } from "./marketExplain";
import { buyShare, change24h, distanceLabel, orFallback, priceDecimals, priceFlashStep, priceTick, triggerProximity } from "./marketMath";
import { useMarketTileOrder } from "./marketTiles";
import { jumpFromNaN, jumpFromUnknownPrice, useForceRefresh, useGlide, useMotionSelect, useOrderFlowMeter } from "./useMarket";

/** Formats a live price with the panel's precision (`86.100,4`). */
function priceFormatter(decimals: number): (v: number) => string {
  return (v) => formatNumber(v, { decimals });
}

/** Pre-rendered up/down flash layers: a soft wash, or a 2 px underline under reduced motion (opacity only). */
function FlashLayers({ up, down, reduced, className }: { up: Ref<HTMLSpanElement>; down: Ref<HTMLSpanElement>; reduced: boolean; className?: string }) {
  const layer = reduced ? "inset-x-0 -bottom-1 h-0.5 rounded-full" : cn("-z-10", className);
  return (
    <>
      <span ref={up} aria-hidden="true" className={cn("pointer-events-none absolute opacity-0", layer, reduced ? "bg-win" : "bg-win/15")} />
      <span ref={down} aria-hidden="true" className={cn("pointer-events-none absolute opacity-0", layer, reduced ? "bg-loss" : "bg-loss/15")} />
    </>
  );
}

/**
 * Signed counter of significant price moves (`priceTick`): `+1` per move up, `−1` per move down, so
 * `useValueFlash` fires once per move. The first price after "unknown" (start, symbol switch) only anchors.
 */
function usePriceMoves(minMove: number): MotionValue<number> {
  const moves = useMotionValue(0);
  useEffect(() => {
    let anchor = priceMv.get();
    return priceMv.on("change", (v) => {
      const t = priceTick(anchor, v, minMove);
      anchor = t.anchor;
      if (t.dir !== 0) moves.set(moves.get() + t.dir);
    });
  }, [moves, minMove]);
  return moves;
}

/* ------------------------------------------------------------------ price + 24 h change */

/** The 24 h change as displayed (2 decimals, no negative zero). */
function shownChange(v: number): number {
  const r = Math.round(v * 100) / 100;
  return r === 0 ? 0 : r;
}

/**
 * The 42-px odometer on `priceMv` (one `spring.price` glide, digits roll at display rate) with the tenths dimmed
 * and a green/red wash on up/down moves of at least `priceFlashStep` (1 USD at BTC), at most one every
 * `FLASH_MIN_INTERVAL_MS` (a flip inside the gap only cuts the wash). The accessible text is the rounded price, ≤ 1 Hz.
 */
export const LivePrice = memo(function LivePrice({ fallback }: { fallback: number }) {
  const reduced = useReducedFx();
  const source = useTransform(priceMv, (v) => orFallback(v, fallback));
  const decimals = priceDecimals(fallback);
  const formatLabel = useMemo(() => (decimals <= 1 ? (v: number) => n0(v) : priceFormatter(decimals)), [decimals]);
  const moves = usePriceMoves(priceFlashStep(fallback));
  const up = useRef<HTMLSpanElement>(null);
  const down = useRef<HTMLSpanElement>(null);
  useValueFlash({ source: moves }, up, down, { cooldownMs: FLASH_MIN_INTERVAL_MS });
  return (
    <span className="relative isolate inline-flex">
      <FlashLayers up={up} down={down} reduced={reduced} className="-inset-x-2 -inset-y-1.5 rounded-xl" />
      <RollingDigits source={source} decimals={decimals} decimalClassName="text-faint" formatLabel={formatLabel} className="dot-num text-[42px] leading-none text-fg" />
    </span>
  );
});

/**
 * 24 h change chip, live: `(price / open24h − 1) · 100` on every trade, gliding on `spring.price`. The arrow turns
 * 180° on a sign flip (`spring.segment`) and the win/loss tint crossfades; only the flip re-renders.
 */
export const ChangeChip = memo(function ChangeChip({ fallback }: { fallback: number | null }) {
  const reduced = useReducedFx();
  const raw = useTransform(() => {
    const c = change24h(priceMv.get(), open24hMv.get());
    return Number.isFinite(c) ? c : (fallback ?? NaN);
  });
  const chg = useGlide(raw, { enabled: !reduced, jump: jumpFromNaN });
  const text = useTransform(chg, (v) => (Number.isFinite(v) ? `${signed(shownChange(v), 2)} % 24h` : "– % 24h"));
  const sources = useMemo(() => [chg], [chg]);
  // the tone follows the DISPLAYED figure, so `0,00` never shows a red arrow and noise below a basis point never flips it
  const rising = useMotionSelect(sources, () => !(shownChange(chg.get()) < 0));
  return (
    <span className={cn("relative inline-flex items-center gap-1.5 overflow-hidden rounded-full px-2 py-0.5 font-mono text-[12.5px] transition-colors duration-200", rising ? "text-win" : "text-loss")}>
      <motion.span aria-hidden="true" className="pointer-events-none absolute inset-0 bg-win/12" initial={false} animate={{ opacity: rising ? 1 : 0 }} transition={tween.crossfade} />
      <motion.span aria-hidden="true" className="pointer-events-none absolute inset-0 bg-loss/12" initial={false} animate={{ opacity: rising ? 0 : 1 }} transition={tween.crossfade} />
      <motion.svg aria-hidden="true" viewBox="0 0 8 8" className="relative size-2 shrink-0" initial={false} animate={{ rotate: rising ? 0 : 180 }} transition={spring.segment}>
        <path d="M4 1 7.5 6.5h-7z" fill="currentColor" />
      </motion.svg>
      {/* contained text leaves (perf-09): a gliding string lays out and repaints only itself, not the panel */}
      <motion.span className="relative min-w-[11ch] tabular-nums [contain:layout_paint]">{text}</motion.span>
    </span>
  );
});

/* ------------------------------------------------------------------ order flow */

const ORDER_FLOW_LABEL = "Orderflow: aggressive Käufe über, Verkäufe unter der Mittellinie";

/**
 * Live order-flow strip: a signed LED VU meter of the net aggressive volume per 100-ms window (buyers rise in green,
 * sellers fall in red, `DotMatrix` meter mode) next to the buy share of the decayed taker flow (15 s half-life) as a
 * compositor bar and a number.
 */
export const OrderFlow = memo(function OrderFlow() {
  const reduced = useReducedFx();
  const meter = useOrderFlowMeter();
  const share = useTransform(() => buyShare(flowImbalanceMv.get(), volAccumMv.get()));
  const smooth = useGlide(share, { enabled: !reduced, jump: jumpFromNaN });
  const scaleX = useTransform(smooth, (s) => (Number.isFinite(s) ? s : 0.5));
  const text = useTransform(smooth, (s) => (Number.isFinite(s) ? `Käufe ${formatNumber(s * 100)} %` : "Käufe – %"));
  return (
    <div className="flex min-w-0 items-center gap-3">
      {/* glow off: the blurred glow group (252 more circles) cost ≈ ¼ of the meter's per-frame paint while trades flow */}
      <DotMatrix meter={meter} signed rows={7} cols={36} size={3} gap={1.5} tone="win" negativeTone="loss" glow={false} label={ORDER_FLOW_LABEL} className="shrink-0" />
      <div className="grid min-w-0 gap-1.5">
        <span className="label !text-[9.5px]">Orderflow</span>
        <span aria-hidden="true" className="relative block h-1 w-16 overflow-hidden rounded-full bg-loss/45">
          <motion.span className="absolute inset-0 origin-left rounded-full bg-win" style={{ scaleX }} />
        </span>
        <motion.span className="num whitespace-nowrap font-mono text-[11px] text-mute [contain:layout_paint]">{text}</motion.span>
      </div>
    </div>
  );
});

/* ------------------------------------------------------------------ funding line + mini tiles */

interface TileExplain {
  /** morph id (`market-tile-{id}`) */
  id: string;
  title: string;
  /** dialog body, evaluated when the tile is opened (live values read then) */
  body: () => ReactNode;
}

const TILE_SURFACE = "@container relative isolate min-w-0 overflow-hidden rounded-xl border border-line bg-ink-900 bg-[linear-gradient(rgb(4_4_4/0.3),rgb(4_4_4/0.3))] px-2.5 py-1.5";

/**
 * Mini tile; `flashOn` washes the whole tile green/red when that value moves by at least `minMove`, at most once per
 * `cooldownMs`. With `explain` the tile is a morph source: a tap (or Enter) opens its explainer – a press-and-hold still
 * lifts it for reordering (the grid swallows the click that ends a drag).
 */
function MiniTile({ label, flashOn, minMove, cooldownMs, chars = 0, explain, children }: { label: string; flashOn?: MotionValue<number>; minMove?: number; cooldownMs?: number; chars?: number; explain?: TileExplain; children: ReactNode }) {
  const reduced = useReducedFx();
  const up = useRef<HTMLSpanElement>(null);
  const down = useRef<HTMLSpanElement>(null);
  useValueFlash({ source: flashOn }, up, down, { minMove, cooldownMs, enabled: !!flashOn && !reduced });
  const content = (
    <>
      {flashOn && (
        <>
          <span ref={up} aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 bg-win/[0.09] opacity-0" />
          <span ref={down} aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 bg-loss/[0.09] opacity-0" />
        </>
      )}
      <div className="label flex items-center justify-between gap-1 !text-[9.5px]">
        <span className="truncate">{label}</span>
        {explain && (
          <span aria-hidden="true" className="shrink-0 text-faint transition-colors group-hover:text-fg">
            +
          </span>
        )}
      </div>
      {/* long values (Bid/Ask at ~1024 px) shrink to the tile instead of ellipsizing (MO-01): 0.6 em mono advance */}
      <div className="num truncate font-mono text-[12.5px] text-fg" style={chars > 0 ? { fontSize: `min(12.5px, calc(100cqw / ${(chars * 0.6).toFixed(2)}))` } : undefined}>
        {children}
      </div>
    </>
  );
  // opaque surface (same tint as the former bg-ink-950/30 over the panel): a lifted tile glides over its neighbours
  if (!explain) return <div className={TILE_SURFACE}>{content}</div>;
  return (
    <MorphCard id={explain.id} title={explain.title} as="div" borderRadius={12} body={explain.body} className={cn(TILE_SURFACE, "hover:border-white/25")}>
      {content}
    </MorphCard>
  );
}

export const TILES_LABEL = "Markt-Kacheln";

/** One displayed step of the funding rate (`0,0001 %`): finer estimate updates are not worth a flash. */
const FUNDING_DISPLAY_STEP = 1e-6;

export interface FundingBlockProps {
  /** snapshot fallbacks until `markMv` / `fundingMv` / `nextFundingMv` are seeded */
  mark: number;
  fundingRate: number;
  nextFundingTime: number;
  /** last price (rounded) – sets the Bid/Ask precision and its flash threshold */
  price: number | null;
  openInterest: number | null;
  takerDelta: number | null;
  /** base asset of the pair (`BTC`) – unit of the open interest */
  base?: string;
}

/**
 * `Mark {n0} · Funding {±0,0100 %} · nächstes Funding in {hh:mm:ss}` as ONE text node (the mark glides, the
 * countdown follows the shared second clock) plus the Funding / OI / Taker / Bid-Ask tiles (`sm+`), which the user can
 * reorder by press-and-hold (or keyboard); the order persists in `tj2-ui-market-tiles`.
 */
export const FundingBlock = memo(function FundingBlock({ mark, fundingRate, nextFundingTime, price, openInterest, takerDelta, base = "BTC" }: FundingBlockProps) {
  const reduced = useReducedFx();
  const now = useNowMv();
  const markLive = useTransform(markMv, (v) => orFallback(v, mark));
  const markShown = useGlide(markLive, { enabled: !reduced, jump: jumpFromUnknownPrice });
  const rate = useTransform(fundingMv, (v) => (v !== 0 ? v : fundingRate));
  const line = useTransform(() => {
    const m = markShown.get();
    const r = rate.get();
    const next = orFallback(nextFundingMv.get(), nextFundingTime);
    const n = now.get();
    return `Mark ${n0(m)} · Funding ${fundingPct(r)} · nächstes Funding in ${hhmmss(next - n)}`;
  });
  const fundingText = useTransform(rate, fundingPct);

  const decimals = priceDecimals(price);
  const bidAsk = useTransform(() => {
    const b = bidMv.get();
    const a = askMv.get();
    return b > 0 && a > 0 ? `${formatNumber(b, { decimals })} / ${formatNumber(a, { decimals })}` : "–";
  });
  // a book wash only for moves that matter (≈ 10 ppm), not for every one-tick flicker of the queue
  const bookMinMove = price != null && price > 0 ? price * 1e-5 : 0;
  const [order, setOrder] = useMarketTileOrder();
  // `84.205,9 / 84.206,0`: two prices + separator (+1 for a digit more while the price moves)
  const bookChars = price != null && price > 0 ? 2 * formatNumber(price, { decimals }).length + 4 : 0;
  // stable nodes (values are MotionValues); no item `label`: the tile content (label + live value) names the tile
  const tiles = useMemo(
    () => [
      {
        id: "funding",
        node: (
          <MiniTile
            label="Funding"
            flashOn={rate}
            minMove={FUNDING_DISPLAY_STEP}
            explain={{ id: "market-tile-funding", title: "Funding-Rate", body: () => <Explainer bare d={fundingExplain(rate.get(), orFallback(nextFundingMv.get(), nextFundingTime), Date.now(), orFallback(markMv.get(), mark))} /> }}
          >
            <motion.span>{fundingText}</motion.span>
          </MiniTile>
        ),
      },
      {
        id: "oi",
        node: (
          <MiniTile label="OI" explain={{ id: "market-tile-oi", title: "Open Interest", body: () => <Explainer bare d={openInterestExplain(openInterest, base)} /> }}>
            <MotionNumber value={openInterest} format={n0} flash />
          </MiniTile>
        ),
      },
      {
        id: "taker",
        node: (
          <MiniTile label="Taker" explain={{ id: "market-tile-taker", title: "Taker-Delta", body: () => <Explainer bare d={takerExplain(takerDelta)} /> }}>
            <MotionNumber value={takerDelta} decimals={1} signed suffix=" %" flash />
          </MiniTile>
        ),
      },
      {
        id: "book",
        node: (
          <MiniTile
            label="Bid/Ask"
            flashOn={bidMv}
            minMove={bookMinMove}
            cooldownMs={FLASH_MIN_INTERVAL_MS}
            chars={bookChars}
            explain={{ id: "market-tile-book", title: "Bid / Ask", body: () => <Explainer bare d={bookExplain(bidMv.get(), askMv.get(), decimals)} /> }}
          >
            <motion.span>{bidAsk}</motion.span>
          </MiniTile>
        ),
      },
    ],
    [rate, fundingText, openInterest, takerDelta, bookMinMove, bidAsk, bookChars, nextFundingTime, mark, base, decimals],
  );

  return (
    <>
      <motion.p className="num font-mono text-[11px] text-faint [contain:layout_paint]">{line}</motion.p>
      {/* hold → lift → reorder (pulse `draggable-widget-grid`); the order is a per-browser preference */}
      <WidgetGrid
        items={tiles}
        order={order}
        onOrderChange={setOrder}
        aria-label={TILES_LABEL}
        className="hidden grid-cols-2 gap-2 sm:grid"
        itemClassName="rounded-xl"
      />
    </>
  );
});

/* ------------------------------------------------------------------ status pill */

export interface LivePillProps {
  /** snapshot `receivedAt` of the price until `priceReceivedAtMv` is seeded */
  receivedAt: number | null;
  /** next `ticker24h` refresh (epoch ms) → the 30-s ring runs by itself until then */
  ringEndsAt: number | null;
}

const RING_MS = 30_000;

/**
 * The LivePill button: age label (`Live` / `Live · vor 12s` / `vor 3 min`) as a MotionValue on the shared clock,
 * the 30-s refresh ring on the compositor, a heartbeat while live and a sonar ping per trade print (≤ 4 Hz). React
 * re-renders only when the label changes length (pill width) or the tone flips past 120 s.
 */
export const LivePill = memo(function LivePill({ receivedAt, ringEndsAt }: LivePillProps) {
  const { refresh, refreshing, disabled } = useForceRefresh();
  const now = useNowMv();
  const press = usePressable({ disabled: disabled && !refreshing });
  const read = useCallback(() => liveAgeLabel(orFallback(priceReceivedAtMv.get(), receivedAt) || undefined, now.get(), refreshing), [now, receivedAt, refreshing]);
  const text = useTransform(() => read().text);
  const sources = useMemo(() => [now, priceReceivedAtMv], [now]);
  const shape = useMotionSelect(sources, () => {
    const a = read();
    return `${a.warn ? "w" : "l"}${a.text.length}`;
  });
  const ring = useMemo(() => (ringEndsAt != null ? { endsAt: ringEndsAt, ms: RING_MS } : 0), [ringEndsAt]);
  return (
    <motion.button
      type="button"
      onClick={refresh}
      disabled={disabled && !refreshing}
      title={STRINGS.refreshNow}
      aria-label={STRINGS.refreshNow}
      className="touch-hit rounded-full disabled:cursor-default"
      whileTap={press.whileTap}
      transition={press.transition}
    >
      <StatusPill
        tone={shape.startsWith("w") ? "warn" : "live"}
        expanded
        ring={ring}
        spinning={refreshing}
        label={<motion.span className="tabular-nums">{text}</motion.span>}
        layoutKey={shape}
        feed="markPrice"
        pingOn={tradeCountMv}
      />
    </motion.button>
  );
});


/* ------------------------------------------------------------------ preview + distances */

/** `Aktuelle 4H-Kerze: würde … auslösen, schließt in mm:ss` – the countdown runs on the shared clock. */
export const PreviewLine = memo(function PreviewLine({ preview, closesAt }: { preview: Scenario; closesAt: number }) {
  const now = useNowMv();
  const text = useTransform(now, (n) => livePreviewLabel(preview, countdownLabel(closesAt - n)));
  return <motion.span>{text}</motion.span>;
});

function Distance({ text, proximity, fill }: { text: MotionValue<string>; proximity: MotionValue<number>; fill: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <motion.span className="num font-mono [contain:layout_paint]">{text}</motion.span>
      <span aria-hidden="true" className="relative block h-1 w-10 overflow-hidden rounded-full bg-white/[0.07]">
        <motion.span className={cn("absolute inset-0 origin-left rounded-full", fill)} style={{ scaleX: proximity }} />
      </span>
    </span>
  );
}

/**
 * `Long-Trigger in +0,42 %` / `Short-Trigger in …` following the gliding price every frame, each with a proximity
 * bar (`scaleX`, full at the level, empty 2 % away).
 */
export const TriggerDistances = memo(function TriggerDistances({ price, longTrigger, shortTrigger }: { price: MotionValue<number>; longTrigger: number; shortTrigger: number }) {
  const longText = useTransform(price, (p) => distanceLabel("long", longTrigger, p));
  const shortText = useTransform(price, (p) => distanceLabel("short", shortTrigger, p));
  const longProx = useTransform(price, (p) => triggerProximity("long", longTrigger, p));
  const shortProx = useTransform(price, (p) => triggerProximity("short", shortTrigger, p));
  return (
    <>
      <Distance text={longText} proximity={longProx} fill="bg-win/70" />
      <Distance text={shortText} proximity={shortProx} fill="bg-loss/70" />
    </>
  );
});
