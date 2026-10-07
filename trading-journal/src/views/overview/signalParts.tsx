/**
 * Building blocks of the "Einstiegs-Check" card (`SignalCard`), ported from the other journal's `signalpanel.tsx`
 * onto our primitives and motion rules:
 * - every moving part is a transform / opacity on a pre-rendered layer (tile tone, strength dots, meter markers,
 *   zone marker), never `left` / `width` / colours;
 * - the zone marker and its price label follow the live price as MotionValues (no React render per trade);
 * - "leuchtet auf": a rung whose direction-matching event is new pops its dot and flashes a halo once; an event on the
 *   running bar pings three times (`.fx-ping`, finite) – then everything rests.
 */
import { animate, AnimatePresence, motion, useTransform } from "motion/react";
import { memo, useEffect, useRef, useState } from "react";
import { ageText, strengthLine, TOO_FEW_BARS, ZONE_TEXT, zoneFooterText, zonePillText, type Side, type SignalCfg, type TfCheck, type Verdict } from "@/domain/signals";
import { cn } from "@/lib/cn";
import { n0, n1 } from "@/lib/format";
import { priceMv } from "@/market";
import { formatNumber } from "@/motion/MotionNumber";
import { spring, stagger, tween } from "@/motion/tokens";
import { TextRoll } from "@/motion/TextRoll";
import { useReducedFx } from "@/motion/useReducedFx";
import { Badge } from "@/primitives/Badge";
import { RingGauge } from "@/primitives/RingGauge";
import { rollDirection } from "@/primitives/StatTile";
import { meterPct, rsiBands, verdictColor, verdictText, zonePosition, type RungView } from "./signalView";

const TONE_ON: Record<Side, string> = { long: "border-win/35 bg-win/[0.06]", short: "border-loss/35 bg-loss/[0.06]" };
const SIDE_TEXT: Record<Side, string> = { long: "text-win", short: "text-loss" };
const SIDE_BG: Record<Side, string> = { long: "bg-win", short: "bg-loss" };

/* ------------------------------------------------------------------ verdict row */

/** Score as a slot roll (direction of the change); the first value renders as is. */
function ScoreRoll({ score }: { score: number }) {
  const text = String(score);
  const [state, setState] = useState({ text, dir: "up" as "up" | "down" });
  if (state.text !== text) setState({ text, dir: rollDirection(state.text, text) });
  return <TextRoll text={text} mode="roll" direction={state.dir} />;
}

/** Four strength dots: a grey base and a pre-rendered tone dot that pops in (`spring.pop`, staggered) per level. */
const StrengthDots = memo(function StrengthDots({ strength, color }: { strength: number; color: string }) {
  const reduced = useReducedFx();
  return (
    <span className="flex gap-1" role="img" aria-label={`Stärke ${strength} von 4`}>
      {[1, 2, 3, 4].map((i) => (
        <span key={i} className="relative size-2 rounded-full bg-[#2c2c2c]" aria-hidden="true">
          <motion.span
            className="absolute inset-0 rounded-full"
            style={{ backgroundColor: color }}
            initial={false}
            animate={{ opacity: i <= strength ? 1 : 0, scale: i <= strength ? 1 : 0.4 }}
            transition={reduced ? tween.crossfade : { opacity: tween.fade, scale: { ...spring.pop, delay: (i - 1) * stagger.reveal } }}
          />
        </span>
      ))}
    </span>
  );
});

export interface VerdictRowProps {
  v: Verdict;
  ladderLength: number;
  /** count of fresh entries on this side since mount: each one flashes the ring halo once */
  flash: number;
}

/**
 * Score ring (draws on first view, follows later changes), verdict label (new label rises in on `spring.smooth`),
 * strength dots and `{Stärke} · {tiers} von {n} Timeframes`.
 */
export const VerdictRow = memo(function VerdictRow({ v, ladderLength, flash }: VerdictRowProps) {
  const reduced = useReducedFx();
  const color = verdictColor(v);
  const halo = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!flash || reduced || !halo.current) return;
    const a = animate(halo.current, { opacity: [0.9, 0], scale: [0.92, 1.08] }, tween.flash);
    return () => a.stop();
  }, [flash, reduced]);
  return (
    <div className="flex min-w-0 items-center gap-5" data-testid="signal-verdict">
      <div className="relative shrink-0">
        <span
          ref={halo}
          aria-hidden="true"
          className="pointer-events-none absolute -inset-1 rounded-full opacity-0"
          style={{ boxShadow: `0 0 28px 3px color-mix(in srgb, ${color} 45%, transparent), inset 0 0 18px color-mix(in srgb, ${color} 35%, transparent)` }}
        />
        <RingGauge value={v.score / 100} size={86} stroke={8} color={color} track="#1f1f1f" aria-label={`Score ${v.score} von 100`}>
          <span className="dot-num text-[26px] leading-none text-fg">
            <ScoreRoll score={v.score} />
          </span>
        </RingGauge>
      </div>
      <div className="grid min-w-0 gap-2">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div
            key={v.label}
            className={cn("text-[19px] font-semibold leading-tight tracking-tight", verdictText(v))}
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0, transition: reduced ? tween.fade : spring.smooth }}
            exit={{ opacity: 0, transition: tween.exit }}
            data-testid="signal-label"
          >
            {v.label}
          </motion.div>
        </AnimatePresence>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <StrengthDots strength={v.strength} color={color} />
          <span className="text-[12px] text-mute">{strengthLine(v.strength, v.tiers, ladderLength)}</span>
        </div>
      </div>
    </div>
  );
});

/* ------------------------------------------------------------------ meters */

interface Band {
  from: number;
  to: number;
  className: string;
}

export interface MeterProps {
  label: string;
  value: number;
  min: number;
  max: number;
  bands: readonly Band[];
  /** value in the side's extreme band → marker and number take the side colour */
  active: boolean;
  side: Side;
  sub?: string;
  /** thin tick marks (e.g. RSI 30 / 70) */
  ticks?: readonly number[];
}

/**
 * Small bar with shaded extreme bands and a marker. The marker rides a track-wide layer translated by `x: p%` (its own
 * width = the track), so it moves on the compositor (`spring.smooth`); the clip box keeps the layer from widening the
 * card.
 */
export const Meter = memo(function Meter({ label, value, min, max, bands, active, side, sub, ticks }: MeterProps) {
  const reduced = useReducedFx();
  const p = meterPct(value, min, max);
  return (
    <div className="mt-2.5">
      <div className="flex items-baseline justify-between gap-2 text-[10.5px]">
        <span className="uppercase tracking-[0.1em] text-faint">{label}</span>
        <span className={cn("num whitespace-nowrap font-mono", active ? SIDE_TEXT[side] : "text-mute")}>
          {n1(value)}
          {sub && <span className="ml-1.5 text-faint">{sub}</span>}
        </span>
      </div>
      <div className="relative mt-1 h-3 overflow-x-clip" aria-hidden="true">
        <span className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 overflow-hidden rounded-full bg-white/[0.05]">
          {bands.map((b, i) => (
            <span key={i} className={cn("absolute inset-y-0", b.className)} style={{ left: `${meterPct(b.from, min, max)}%`, right: `${100 - meterPct(b.to, min, max)}%` }} />
          ))}
          {ticks?.map((t) => (
            <span key={t} className="absolute inset-y-0 w-px bg-white/25" style={{ left: `${meterPct(t, min, max)}%` }} />
          ))}
        </span>
        <motion.span className="absolute inset-y-0 left-[1.5px] right-[1.5px]" initial={false} animate={{ x: `${p}%` }} transition={reduced ? { duration: 0 } : spring.smooth}>
          <span className={cn("absolute left-0 top-0 h-3 w-[3px] -translate-x-1/2 rounded-full", active ? SIDE_BG[side] : "bg-fg")} />
        </motion.span>
      </div>
    </div>
  );
});

/* ------------------------------------------------------------------ ladder */

/** Event dot: filled for strong kinds, outlined for the zero-line crosses; pops + flashes when its event is new. */
function EventDot({ rung, side, fresh }: { rung: RungView; side: Side; fresh: boolean }) {
  const reduced = useReducedFx();
  const e = rung.event;
  const tone = !e ? null : rung.longKind ? "win" : "loss";
  const fill = !tone ? "bg-line-2" : rung.strong ? (tone === "win" ? "bg-win" : "bg-loss") : tone === "win" ? "border border-win" : "border border-loss";
  // the dot lights up (glow) when it carries the selected direction's event
  const lit = rung.match && rung.lit;
  return (
    <span className="relative grid size-2 shrink-0 place-items-center" aria-hidden="true">
      <motion.span
        key={e ? `${e.kind}:${e.barsAgo}` : "none"}
        className={cn("size-2 rounded-full", fill)}
        style={lit ? { boxShadow: `0 0 8px 1px ${tone === "win" ? "rgb(61 220 132 / 0.55)" : "rgb(255 77 79 / 0.55)"}` } : undefined}
        initial={fresh && !reduced ? { scale: 0.3, opacity: 0 } : false}
        animate={{ scale: 1, opacity: 1 }}
        transition={spring.pop}
      />
      {e && e.barsAgo === 0 && rung.match && !reduced && <span key={`${e.kind}-ping`} className={cn("fx-ping", side === "long" ? "bg-win" : "bg-loss")} />}
    </span>
  );
}

export interface RungTileProps {
  rung: RungView;
  side: Side;
  cfg: SignalCfg;
  /** the tile's matching event is new since the last evaluation (not on mount) */
  fresh: boolean;
}

/** One ladder tile: timeframe + role, event (dot · text · age), MCB and RSI meters. Tone layers crossfade. */
export const RungTile = memo(function RungTile({ rung, side, cfg, fresh }: RungTileProps) {
  const reduced = useReducedFx();
  const glow = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!fresh || reduced || !glow.current) return;
    const a = animate(glow.current, { opacity: [1, 0] }, tween.flash);
    return () => a.stop();
  }, [fresh, reduced]);
  const c = rung.check;
  const bands = rsiBands(cfg);
  return (
    <div className="relative isolate min-w-0 overflow-hidden rounded-xl border border-line bg-ink-950/50 p-3" data-testid="signal-rung" data-lit={rung.lit || undefined}>
      {(["long", "short"] as const).map((s) => (
        <motion.span
          key={s}
          aria-hidden="true"
          className={cn("pointer-events-none absolute -inset-px -z-10 rounded-xl border", TONE_ON[s])}
          initial={false}
          animate={{ opacity: rung.lit && side === s ? 1 : 0 }}
          transition={tween.crossfade}
        />
      ))}
      <span ref={glow} aria-hidden="true" className={cn("pointer-events-none absolute inset-0 -z-10 opacity-0", side === "long" ? "bg-win/15" : "bg-loss/15")} />
      <div className="flex items-baseline justify-between gap-2">
        <span className="dot-num text-[20px] leading-none text-fg">{rung.tf}</span>
        <span className="truncate text-[10px] uppercase tracking-[0.12em] text-faint">{rung.role}</span>
      </div>
      {!c ? (
        <p className="mt-3 text-[11.5px] text-faint">{TOO_FEW_BARS}</p>
      ) : (
        <>
          <div className="mt-3 flex items-center justify-between gap-2">
            <span className={cn("inline-flex min-w-0 items-center gap-1.5 text-[12px] font-semibold", rung.match ? SIDE_TEXT[side] : rung.event ? "text-mute" : "text-faint")}>
              <EventDot rung={rung} side={side} fresh={fresh} />
              <span className="truncate">{rung.text}</span>
            </span>
            {rung.event && <span className="shrink-0 text-[10.5px] text-faint">{ageText(rung.event.barsAgo)}</span>}
          </div>
          <Meter
            label="MCB"
            value={c.wt.wt1}
            min={-100}
            max={100}
            bands={[
              { from: -100, to: cfg.wtOs, className: "bg-win/20" },
              { from: cfg.wtOb, to: 100, className: "bg-loss/20" },
            ]}
            active={rung.match}
            side={side}
          />
          <Meter
            label="RSI"
            value={c.rsi}
            min={0}
            max={100}
            bands={[
              { from: 0, to: bands.lo, className: "bg-win/30" },
              { from: bands.lo, to: bands.nearLo, className: "bg-win/12" },
              { from: bands.nearHi, to: bands.hi, className: "bg-loss/12" },
              { from: bands.hi, to: 100, className: "bg-loss/30" },
            ]}
            ticks={[bands.lo, bands.hi]}
            active={rung.rsiNear}
            side={side}
            sub={`Ø ${n1(c.rsiMa)}`}
          />
        </>
      )}
    </div>
  );
});

/* ------------------------------------------------------------------ zone gauge */

/**
 * Premium / Discount bar of `cfg.zoneTf`: discount and premium gradients, the outer 5 % LuxAlgo boxes, the
 * equilibrium band, and a marker + price label that follow the live price (MotionValues → transform). The labels sit
 * UNDER the bar with the range prices, so the marker never crosses text. The price label is translated by `−p %` of
 * its own width on top of the `p %` of the bar, so it always stays inside the bar's width.
 */
export const ZoneGauge = memo(function ZoneGauge({ c, side }: { c: TfCheck | null; side: Side }) {
  const z = c?.zone ?? null;
  // marker position in % of the bar, kept 2 % off the edges (the marker is 3 px wide)
  const pct = useTransform(priceMv, (p) => Math.max(2, Math.min(98, (z ? zonePosition(p, z) : 0.5) * 100)));
  const x = useTransform(pct, (q) => `${q}%`);
  const labelX = useTransform(pct, (q) => `${-q}%`);
  const priceText = useTransform(priceMv, (p) => (p > 0 ? formatNumber(p, { decimals: 0 }) : z ? n0(z.lo + (z.hi - z.lo) * z.pos) : "–"));
  if (!c || !z) return <p className="text-[12px] text-faint">{zoneFooterText(null)}</p>;
  const good = side === "long" ? z.zone === "discount" : z.zone === "premium";
  return (
    <div className="min-w-0" data-testid="signal-zone">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-mute">Zone · {c.tf}</span>
        <Badge tone={good ? (side === "long" ? "win" : "loss") : "mute"}>{zonePillText(z)}</Badge>
      </div>
      {/* price label row above the bar (its own band: it never covers the header or the range prices) */}
      <div className="relative mt-3 h-4 overflow-x-clip" aria-hidden="true">
        <motion.span className="absolute inset-y-0 left-0 w-full" style={{ x }}>
          <motion.span className="num absolute left-0 top-0 whitespace-nowrap font-mono text-[10.5px] leading-4 text-fg" style={{ x: labelX }}>
            {priceText}
          </motion.span>
        </motion.span>
      </div>
      <div className="relative mt-1 h-8 overflow-hidden rounded-lg border border-line">
        <div className="absolute inset-y-0 left-0 w-[47.5%] bg-gradient-to-r from-win/[0.14] to-win/[0.03]" />
        <div className="absolute inset-y-0 right-0 w-[47.5%] bg-gradient-to-l from-loss/[0.14] to-loss/[0.03]" />
        <div className="absolute inset-y-0 left-0 w-[5%] bg-win/35" />
        <div className="absolute inset-y-0 right-0 w-[5%] bg-loss/35" />
        <div className="absolute inset-y-0 left-[47.5%] w-[5%] bg-white/[0.07]" />
        <motion.span className="absolute inset-y-0 left-0 w-full" style={{ x }} aria-hidden="true">
          <span className="absolute inset-y-1 left-0 w-[3px] -translate-x-1/2 rounded-full bg-fg shadow-[0_0_0_3px_rgb(4_4_4/0.6)]" />
        </motion.span>
      </div>
      <div className="mt-1.5 grid grid-cols-3 gap-2 text-[10px] uppercase tracking-[0.1em]">
        <span className="min-w-0">
          <span className="block font-semibold text-win/80">{ZONE_TEXT.discount}</span>
          <span className="num block font-mono normal-case tracking-normal text-faint">{n0(z.lo)}</span>
        </span>
        <span className="min-w-0 text-center">
          <span className="block font-semibold text-mute">EQ</span>
          <span className="num block font-mono normal-case tracking-normal text-faint">{n0(z.eq)}</span>
        </span>
        <span className="min-w-0 text-right">
          <span className="block font-semibold text-loss/80">{ZONE_TEXT.premium}</span>
          <span className="num block font-mono normal-case tracking-normal text-faint">{n0(z.hi)}</span>
        </span>
      </div>
      <p className="mt-2 text-[11px] leading-snug text-faint">{zoneFooterText(z)}</p>
    </div>
  );
});

/* ------------------------------------------------------------------ reasons */

/** ✓ / · list of the verdict's reasons (ladder rungs, RSI, zone). */
export const Reasons = memo(function Reasons({ v }: { v: Verdict }) {
  return (
    <ul className="grid content-start gap-1.5" aria-label="Bedingungen">
      {v.reasons.map((r) => (
        <li key={r.text} className="flex items-start gap-2 text-[12.5px] leading-snug">
          <span
            aria-hidden="true"
            className={cn("mt-px grid size-4 shrink-0 place-items-center rounded-full text-[9px] font-bold", r.ok ? "bg-win/20 text-win" : "bg-white/[0.06] text-faint")}
          >
            {r.ok ? "✓" : "·"}
          </span>
          <span className={r.ok ? "text-fg" : "text-mute"}>
            <span className="sr-only">{r.ok ? "erfüllt: " : "offen: "}</span>
            {r.text}
          </span>
        </li>
      ))}
    </ul>
  );
});
