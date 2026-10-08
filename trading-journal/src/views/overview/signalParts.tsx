/**
 * Building blocks of the "Einstiegs-Check" card (`SignalCard`), ported from the other journal's `signalpanel.tsx`
 * onto our primitives and motion rules:
 * - every moving part is a transform / opacity on a pre-rendered layer (tile tone, strength dots, meter markers,
 *   zone marker), never `left` / `width` / colours;
 * - the zone marker and its price label follow the live price as MotionValues (no React render per trade);
 * - countdowns (`vorläufig · schließt in 12:04`) are text on the shared second clock (`useNowMv` → `motion.span`),
 *   never a React render per second;
 * - "leuchtet auf": a rung whose direction-matching event is new pops its dot and flashes a halo once; an event on the
 *   running bar pings three times (`.fx-ping`, finite) – then everything rests.
 *
 * Candle-close look (decision 9): a provisional signal is shown at ~50 % saturation with dashed outlines and the ⚠
 * countdown; confirmed = full colour + `bestätigt`; strong = full colour, a double ring + `stark bestätigt`.
 */
import { animate, AnimatePresence, motion, useTransform } from "motion/react";
import { memo, useEffect, useRef, useState, type ReactNode } from "react";
import { ageText, mmss, TOO_FEW_BARS, whaleCfgOf, ZONE_TEXT, zoneFooterText, zonePillText, type SignalCfg, type SignalState, type Side, type TfCheck, type TraderReading, type Verdict } from "@/domain/signals";
import type { DeltaPoint } from "@/domain/signals/traders";
import { cn } from "@/lib/cn";
import { n0, n1 } from "@/lib/format";
import { priceMv, signalClockOffset } from "@/market";
import { useNowMv } from "@/motion/clock";
import { formatNumber } from "@/motion/MotionNumber";
import { spring, stagger, tween } from "@/motion/tokens";
import { TextRoll } from "@/motion/TextRoll";
import { useReducedFx } from "@/motion/useReducedFx";
import { Badge } from "@/primitives/Badge";
import { RingGauge } from "@/primitives/RingGauge";
import { rollDirection } from "@/primitives/StatTile";
import {
  divHitLine,
  divSetupText,
  divTrendLine,
  labelParts,
  lageLine,
  meterPct,
  PROV_COLOR,
  PROV_TEXT,
  rsiBands,
  RUNG_STATE_TEXT,
  SIDE_COLOR,
  srView,
  stateLineText,
  strengthView,
  traderCells,
  verdictColor,
  verdictState,
  verdictText,
  zonePosition,
  type IntrabarView,
  type LageLineView,
  type PartCell,
  type PartView,
  type RungView,
  type TurnView,
  type StateLineView,
} from "./signalView";

const TONE_ON: Record<Side, string> = { long: "border-win/35 bg-win/[0.06]", short: "border-loss/35 bg-loss/[0.06]" };
/** Provisional tone: the side colour at ~50 % saturation, dashed. */
const TONE_PROV: Record<Side, string> = { long: "border-dashed border-[#65b488]/45 bg-[#65b488]/[0.035]", short: "border-dashed border-[#d27a7b]/45 bg-[#d27a7b]/[0.035]" };
const SIDE_TEXT: Record<Side, string> = { long: "text-win", short: "text-loss" };
const SIDE_BG: Record<Side, string> = { long: "bg-win", short: "bg-loss" };
/** provisional fills: the side colours at about 50 % saturation (as `PROV_TEXT`) */
const PROV_BG: Record<Side, string> = { long: "bg-[#65b488]", short: "bg-[#d27a7b]" };
const GLOW: Record<Side, string> = { long: "rgb(61 220 132 / 0.55)", short: "rgb(255 77 79 / 0.55)" };
const isFirm = (s: SignalState): boolean => s === "confirmed" || s === "strong";

/** Text tone of a state (provisional = warn marker, confirmed/strong = full side colour). */
const stateTone = (state: SignalState, side: Side): string => (state === "provisional" ? "text-warn" : isFirm(state) ? SIDE_TEXT[side] : "text-faint");
const STATE_ICON: Record<SignalState, string> = { none: "", provisional: "⚠", confirmed: "✓", strong: "✓✓" };

/* ------------------------------------------------------------------ state line + countdown */

/**
 * `mm:ss` until `closesAt` on the shared second clock (tabular figures: the width never jumps). `closesAt` is a
 * Binance candle time, so the device clock is corrected by the exchange clock offset.
 */
export const Countdown = memo(function Countdown({ closesAt, className }: { closesAt: number; className?: string }) {
  const now = useNowMv();
  const text = useTransform(now, (n) => mmss(closesAt - (n + signalClockOffset())));
  return <motion.span className={cn("num", className)}>{text}</motion.span>;
});

/**
 * The candle-close state line: `⚠ vorläufig · schließt in 12:04` (warn), `✓ bestätigt · 30m-Kerze geschlossen`,
 * `✓✓ stark bestätigt · 3 Schlüsse gehalten` (side colour) or, without an entry, the base candle's countdown (faint).
 * The text runs on the shared clock; the line keeps its height when empty.
 */
export const StateLine = memo(function StateLine({ line, side, className }: { line: StateLineView; side: Side; className?: string }) {
  const now = useNowMv();
  const text = useTransform(now, (n) => stateLineText(line, n + signalClockOffset()));
  return (
    <span className={cn("flex min-h-4 min-w-0 items-baseline gap-1.5 text-[11.5px] leading-4 transition-colors duration-300", stateTone(line.state, side), className)} data-testid="signal-state" data-state={line.state}>
      {STATE_ICON[line.state] && (
        <span aria-hidden="true" className="shrink-0 text-[10.5px]">
          {STATE_ICON[line.state]}
        </span>
      )}
      <motion.span className="num min-w-0">{text}</motion.span>
    </span>
  );
});

/* ------------------------------------------------------------------ verdict row */

/** Score as a slot roll (direction of the change); the first value renders as is. */
function ScoreRoll({ score }: { score: number }) {
  const text = String(score);
  const [state, setState] = useState({ text, dir: "up" as "up" | "down" });
  if (state.text !== text) setState({ text, dir: rollDirection(state.text, text) });
  return <TextRoll text={text} mode="roll" direction={state.dir} />;
}

/**
 * Four strength dots: a grey base and a pre-rendered tone dot that pops in (`spring.pop`, staggered) per level.
 * `outlined` (provisional entry): the levels it gets on the close as dashed rings in the desaturated colour.
 */
export const StrengthDots = memo(function StrengthDots({ strength, color, outlined = false, label, size = "md" }: { strength: number; color: string; outlined?: boolean; label: string; size?: "md" | "sm" }) {
  const reduced = useReducedFx();
  return (
    <span className="flex gap-1" role="img" aria-label={label}>
      {[1, 2, 3, 4].map((i) => (
        <span key={i} className={cn("relative rounded-full bg-[#2c2c2c]", size === "md" ? "size-2" : "size-1.5")} aria-hidden="true">
          <motion.span
            className="absolute inset-0 rounded-full"
            style={outlined ? { border: `1.5px dashed ${color}`, backgroundColor: "#0a0a0a" } : { backgroundColor: color }}
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
  /** the base candle's state line (countdown / bestätigt) */
  line: StateLineView;
}

/**
 * Score ring (draws on first view, follows later changes), verdict label (new label rises in on `spring.smooth`),
 * strength dots, `{Stärke} · {tiers} von {n} Timeframes` and the candle-close state line. A provisional entry: ring
 * and label in the desaturated side colour, the strength it gets on the close as dashed dots, `⚠ vorläufig · schließt
 * in mm:ss`; the label's `Vorläufig: ` prefix is kept for screen readers (the state line says it visually).
 */
export const VerdictRow = memo(function VerdictRow({ v, ladderLength, flash, line }: VerdictRowProps) {
  const reduced = useReducedFx();
  const color = verdictColor(v);
  const st = strengthView(v, ladderLength);
  const lbl = labelParts(v.label);
  const lage = lageLine(v);
  const halo = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!flash || reduced || !halo.current) return;
    const a = animate(halo.current, { opacity: [0.9, 0], scale: [0.92, 1.08] }, tween.flash);
    return () => a.stop();
  }, [flash, reduced]);
  return (
    <div className="flex min-w-0 items-center gap-5" data-testid="signal-verdict" data-state={verdictState(v)} data-lage={v.lage?.state} data-blocked={v.lage?.held ? "" : undefined}>
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
          {/* sequenced swap (Long ↔ Short, a new verdict): the old label leaves first, the new one starts once it has
              gone — two labels are never visible over each other (rule 5) */}
          <motion.div
            key={v.label}
            className={cn("text-[19px] font-semibold leading-tight tracking-tight", verdictText(v))}
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0, transition: { ...(reduced ? tween.fade : spring.smooth), delay: tween.exit.duration } }}
            exit={{ opacity: 0, y: reduced ? 0 : -6, transition: tween.exit }}
            data-testid="signal-label"
          >
            {lbl.prefix && <span className="sr-only">{lbl.prefix}</span>}
            {lbl.text}
          </motion.div>
        </AnimatePresence>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <StrengthDots strength={st.dots} color={color} outlined={st.outlined} label={st.aria} />
          <span className="text-[12px] text-mute">{st.line}</span>
        </div>
        <StateLine line={line} side={v.side} />
        {lage && <LageVerdictLine line={lage} />}
      </div>
    </div>
  );
});

const LAGE_LINE_TONE = { loss: "text-loss", warn: "text-warn" } as const;
const LAGE_LINE_DOT = { loss: "bg-loss", warn: "bg-warn" } as const;

/** The Lage-Ampel under a long verdict (`nur Warnung`, or no entry while red / amber): dot + text, wraps. */
function LageVerdictLine({ line }: { line: LageLineView }) {
  return (
    <span className={cn("flex min-w-0 items-baseline gap-1.5 text-[11.5px] leading-4", LAGE_LINE_TONE[line.tone])} data-testid="signal-lage">
      <span aria-hidden="true" className={cn("relative top-[-1px] size-[5px] shrink-0 self-center rounded-full", LAGE_LINE_DOT[line.tone])} />
      <span className="min-w-0">{line.text}</span>
    </span>
  );
}

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
  sub?: ReactNode;
  /** thin tick marks (e.g. RSI 30 / 70) */
  ticks?: readonly number[];
  /** the number shown (default `n1(value)`) */
  valueText?: string;
  /** label in normal case (part cards) instead of the small caps of the rung meters */
  plain?: boolean;
  /** an active value on a forming candle: number and thumb in the desaturated side colour (decision 9) */
  prov?: boolean;
}

/**
 * Small bar with shaded extreme bands and a marker. The marker rides a track-wide layer translated by `x: p%` (its own
 * width = the track), so it moves on the compositor (`spring.smooth`); the clip box keeps the layer from widening the
 * card.
 */
export const Meter = memo(function Meter({ label, value, min, max, bands, active, side, sub, ticks, valueText, plain = false, prov = false }: MeterProps) {
  const reduced = useReducedFx();
  const p = meterPct(value, min, max);
  return (
    <div className="mt-2.5">
      <div className="flex items-baseline justify-between gap-2 text-[10.5px]">
        <span className={cn("min-w-0", plain ? "truncate text-[11.5px] text-mute" : "uppercase tracking-[0.1em] text-faint")}>{label}</span>
        <span className={cn("num shrink-0 whitespace-nowrap font-mono", plain && "text-[12px]", active ? (prov ? PROV_TEXT[side] : SIDE_TEXT[side]) : "text-mute")}>
          {valueText ?? n1(value)}
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
          <span className={cn("absolute left-0 top-0 h-3 w-[3px] -translate-x-1/2 rounded-full", active ? (prov ? PROV_BG[side] : SIDE_BG[side]) : "bg-fg")} />
        </motion.span>
      </div>
    </div>
  );
});

/* ------------------------------------------------------------------ ladder */

/**
 * Event dot (10 px box): filled for strong kinds, outlined for the zero-line crosses. Provisional: a DASHED ring in the
 * desaturated colour (strong kinds keep a faint fill). Strong (stark bestätigt): a second ring around it. Pops +
 * flashes when its event is new.
 */
export function StateDot({ tone, strong, state, lit, size = 8 }: { tone: Side | null; strong: boolean; state: SignalState; lit: boolean; size?: number }) {
  if (!tone) return <span aria-hidden="true" className="block shrink-0 rounded-full bg-line-2" style={{ width: size, height: size }} />;
  if (state === "provisional") {
    const c = PROV_COLOR[tone];
    return (
      <svg aria-hidden="true" viewBox="0 0 10 10" className="block shrink-0" style={{ width: size + 2, height: size + 2, margin: -1 }}>
        <circle cx="5" cy="5" r="4" fill={strong ? c : "none"} fillOpacity={strong ? 0.35 : 0} stroke={c} strokeWidth="1.5" strokeDasharray="2.1 1.55" />
      </svg>
    );
  }
  const color = SIDE_COLOR[tone];
  const ring = state === "strong" ? `0 0 0 1.5px #0a0a0a, 0 0 0 2.5px ${color}` : "";
  const glow = lit ? `0 0 8px 1px ${GLOW[tone]}` : "";
  const shadow = [ring, glow].filter(Boolean).join(", ");
  return (
    <span
      aria-hidden="true"
      className="block shrink-0 rounded-full"
      style={{ width: size, height: size, ...(strong ? { backgroundColor: color } : { border: `1.5px solid ${color}` }), ...(shadow ? { boxShadow: shadow } : null) }}
    />
  );
}

function EventDot({ rung, side, fresh }: { rung: RungView; side: Side; fresh: boolean }) {
  const reduced = useReducedFx();
  const e = rung.event;
  const tone: Side | null = !e ? null : rung.longKind ? "long" : "short";
  // the state belongs to the selected direction: a muted other-direction event shows as confirmed
  const state: SignalState = rung.match ? (rung.state === "none" ? "confirmed" : rung.state) : "confirmed";
  return (
    <span className="relative grid size-2.5 shrink-0 place-items-center rounded-full" aria-hidden="true">
      <motion.span
        key={e ? `${e.kind}:${e.barsAgo}:${state}` : "none"}
        className="grid place-items-center"
        initial={fresh && !reduced ? { scale: 0.3, opacity: 0 } : false}
        animate={{ scale: 1, opacity: 1 }}
        transition={spring.pop}
      >
        <StateDot tone={tone} strong={rung.strong} state={state} lit={rung.match && rung.lit && isFirm(state)} />
      </motion.span>
      {e && e.barsAgo === 0 && rung.match && !reduced && <span key={`${e.kind}-ping`} className={cn("fx-ping", rung.state === "provisional" ? (side === "long" ? "bg-[#65b488]" : "bg-[#d27a7b]") : side === "long" ? "bg-win" : "bg-loss")} />}
    </span>
  );
}

/**
 * Rung state line: `⚠ vorläufig · schließt in 12:04` (the words `schließt in` only where the tile is wide enough,
 * container query), `✓ bestätigt`, `✓✓ stark bestätigt`; empty (height kept) without a signal for the side.
 */
function RungStateLine({ rung, side }: { rung: RungView; side: Side }) {
  const st = rung.match ? rung.state : "none";
  return (
    <span className={cn("mt-1.5 flex min-h-4 items-center gap-1 whitespace-nowrap text-[10.5px] leading-4", stateTone(st, side))} data-testid="signal-rung-state" data-state={st}>
      {st !== "none" && (
        <>
          <span aria-hidden="true">{STATE_ICON[st]}</span>
          <span>{RUNG_STATE_TEXT[st]}</span>
          {st === "provisional" && rung.closesAt != null && (
            <>
              <span aria-hidden="true" className="text-warn/60">
                ·
              </span>
              <span className="hidden @[12.5rem]/rung:inline">schließt in</span>
              <Countdown closesAt={rung.closesAt} />
            </>
          )}
        </>
      )}
    </span>
  );
}

/** Dashed neutral ring: an event that was on the forming candle and is gone (intrabar memory, never counted). */
export function GhostDot({ size = 10 }: { size?: number }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 10 10" className="block shrink-0" style={{ width: size, height: size }}>
      <circle cx="5" cy="5" r="4" fill="none" stroke="#6f6f6f" strokeWidth="1.5" strokeDasharray="2.1 1.55" />
    </svg>
  );
}

/**
 * Intrabar memory in the event row: `◌ Kaufsignal · intrabar` greyed — the forming candle showed it earlier and the
 * price took it back (tv-check 2026-10-08: the 1h Kaufsignal 13:11–13:25, gone at 13:26). Never counted.
 */
function IntrabarRow({ ib }: { ib: IntrabarView }) {
  return (
    <div className="mt-3 flex items-center justify-between gap-2" data-testid="signal-rung-intrabar" data-kind={ib.kind} title={ib.aria}>
      <span className="inline-flex min-w-0 items-center gap-1.5 text-[12px] font-semibold text-faint">
        <span className="grid size-2.5 shrink-0 place-items-center">
          <GhostDot />
        </span>
        <span className="truncate">
          <span className="sr-only">{ib.aria}</span>
          {/* a phone's 2-up tile: the one-word name, so "intrabar" stays beside it */}
          <span aria-hidden="true" className="@max-[10rem]/rung:hidden">
            {ib.text}
          </span>
          <span aria-hidden="true" className="hidden @max-[10rem]/rung:inline">
            {ib.short}
          </span>
        </span>
      </span>
      <span aria-hidden="true" className="shrink-0 text-[10.5px] text-faint">
        intrabar
      </span>
    </div>
  );
}

/** Its line (the state line's slot, same height): `13:11–13:25 · bei 82.466 · nicht gehalten` (words where the tile is wide enough). */
function IntrabarLine({ ib }: { ib: IntrabarView }) {
  return (
    <span aria-hidden="true" className="mt-1.5 flex min-h-4 items-center gap-1 whitespace-nowrap text-[10.5px] leading-4 text-faint" data-testid="signal-rung-intrabar-span">
      <span className="num">{ib.span}</span>
      <span className="text-faint/60">·</span>
      <span className="hidden @[12.5rem]/rung:inline">bei</span>
      <span className="num">{ib.price}</span>
      <span className="hidden @[15.5rem]/rung:inline">· nicht gehalten</span>
    </span>
  );
}

/** MCB meter's side note: `↗ 82.447` (narrow) / `· dreht ab 82.447` — the close at which the forming candle's MCB crosses. */
function TurnSub({ turn, side }: { turn: TurnView; side: Side }) {
  return (
    <span data-testid="signal-rung-turn" data-kind={turn.kind} title={turn.aria}>
      <span className="sr-only">{turn.aria}</span>
      <span aria-hidden="true">
        <span className="@[12.5rem]/rung:hidden">{side === "long" ? "↗" : "↘"} </span>
        <span className="hidden @[12.5rem]/rung:inline">· dreht ab </span>
        {turn.value}
      </span>
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

/** One ladder tile: timeframe + role, event (dot · text · age), candle-close state, MCB and RSI meters. Tone layers crossfade. */
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
  const prov = rung.lit && rung.state === "provisional";
  const eventTone = rung.match ? (rung.state === "provisional" ? PROV_TEXT[side] : SIDE_TEXT[side]) : rung.event ? "text-mute" : "text-faint";
  return (
    <div
      className="@container/rung relative isolate min-w-0 overflow-clip rounded-xl border border-line bg-ink-950/50 p-3 [overflow-clip-margin:1px]"
      data-testid="signal-rung"
      data-lit={rung.lit || undefined}
      data-state={rung.match ? rung.state : "none"}
    >
      {(["long", "short"] as const).map((s) => (
        <motion.span
          key={s}
          aria-hidden="true"
          className={cn("pointer-events-none absolute -inset-px -z-10 rounded-xl border", TONE_ON[s])}
          initial={false}
          animate={{ opacity: rung.lit && !prov && side === s ? 1 : 0 }}
          transition={tween.crossfade}
        />
      ))}
      {(["long", "short"] as const).map((s) => (
        <motion.span
          key={`p-${s}`}
          aria-hidden="true"
          className={cn("pointer-events-none absolute -inset-px -z-10 rounded-xl border", TONE_PROV[s])}
          initial={false}
          animate={{ opacity: prov && side === s ? 1 : 0 }}
          transition={tween.crossfade}
        />
      ))}
      <span ref={glow} aria-hidden="true" className={cn("pointer-events-none absolute inset-0 -z-10 opacity-0", side === "long" ? "bg-win/15" : "bg-loss/15")} />
      <div className="flex items-baseline justify-between gap-2">
        <span className="dot-num shrink-0 text-[20px] leading-none text-fg">{rung.tf}</span>
        {/* narrow tiles (2-up on a phone): tighter letters, so "Bestätigung" fits next to the timeframe */}
        <span className="truncate text-[10px] uppercase tracking-[0.12em] text-faint @max-[10rem]/rung:text-[9.5px] @max-[10rem]/rung:tracking-[0.03em]">{rung.role}</span>
      </div>
      {!c ? (
        <p className="mt-3 text-[11.5px] text-faint">{TOO_FEW_BARS}</p>
      ) : (
        <>
          {rung.intrabar ? (
            <IntrabarRow ib={rung.intrabar} />
          ) : (
            <div className="mt-3 flex items-center justify-between gap-2">
              <span className={cn("inline-flex min-w-0 items-center gap-1.5 text-[12px] font-semibold transition-colors duration-300", eventTone)}>
                <EventDot rung={rung} side={side} fresh={fresh} />
                <span className="truncate">{rung.text}</span>
              </span>
              {rung.event && <span className="shrink-0 text-[10.5px] text-faint">{ageText(rung.event.barsAgo)}</span>}
            </div>
          )}
          {rung.intrabar ? <IntrabarLine ib={rung.intrabar} /> : <RungStateLine rung={rung} side={side} />}
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
            prov={rung.match && rung.state === "provisional"}
            side={side}
            sub={rung.turn ? <TurnSub turn={rung.turn} side={side} /> : undefined}
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
            prov={rung.match && rung.state === "provisional"}
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
      {/* marker and label follow every tick on their own compositor layers (a move never repaints the card; a new price
          repaints the label's small layer only) */}
      <div className="relative mt-3 h-4 overflow-x-clip" aria-hidden="true">
        <motion.span className="absolute inset-y-0 left-0 w-full will-change-transform" style={{ x }}>
          <motion.span className="num absolute left-0 top-0 whitespace-nowrap font-mono text-[10.5px] leading-4 text-fg will-change-transform [contain:layout_paint]" style={{ x: labelX }}>
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
        <motion.span className="absolute inset-y-0 left-0 w-full will-change-transform" style={{ x }} aria-hidden="true">
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

/* ------------------------------------------------------------------ graded parts (decisions 5 + 10) */

const TONE_SR: Record<PartView["tone"], string> = { ok: "erfüllt: ", part: "teilweise: ", open: "offen: ", none: "keine Daten: " };

/** Thin grade bar: `segments` (Top-Trader: one per part, lit = met) or one continuous fill (scaleX = grade). */
function GradeBar({ grade, segments, side, prov }: { grade: number; segments?: readonly (boolean | null)[]; side: Side; prov: boolean }) {
  const reduced = useReducedFx();
  const fill = prov ? PROV_BG[side] : SIDE_BG[side];
  if (segments) {
    // one layer per side: on a side switch the old side's segments fade out in their own colour, and a side whose
    // parts do not hold never lights up (no flash of the new colour on segments that are leaving)
    return (
      <span className="mt-2.5 grid grid-cols-4 gap-1" aria-hidden="true">
        {segments.map((m, i) => (
          <span key={i} className="relative h-1 overflow-hidden rounded-full bg-white/[0.06]">
            {(["long", "short"] as const).map((s) => (
              <motion.span
                key={s}
                className={cn("absolute inset-0 origin-left rounded-full", prov ? PROV_BG[s] : SIDE_BG[s])}
                initial={false}
                animate={{ opacity: m && side === s ? 1 : 0, scaleX: m && side === s ? 1 : 0 }}
                transition={reduced ? { duration: 0 } : { opacity: { ...tween.crossfade, delay: i * stagger.reveal }, scaleX: { ...tween.bar, delay: i * stagger.reveal } }}
              />
            ))}
          </span>
        ))}
      </span>
    );
  }
  return (
    <span className="relative mt-2.5 block h-1 overflow-hidden rounded-full bg-white/[0.06]" aria-hidden="true">
      <motion.span className={cn("absolute inset-0 origin-left rounded-full", fill)} initial={false} animate={{ scaleX: Math.max(0, Math.min(1, grade)) }} transition={reduced ? { duration: 0 } : spring.smooth} />
    </span>
  );
}

/**
 * Shell of one graded part, in the ladder's visual language: tone layer while it holds (dashed + desaturated when the
 * grade rests on a forming candle), state dot, title, points (`+7,5 von 10`, `+1 Stärke` while it holds), the grade
 * bar and the part's own body. The halo flashes once when it lights up (not on mount).
 */
function PartShell({ pv, side, testId, segments, children }: { pv: PartView; side: Side; testId: string; segments?: readonly (boolean | null)[]; children: ReactNode }) {
  const reduced = useReducedFx();
  const lit = pv.tone === "ok";
  const prov = pv.provisional && pv.tone !== "none";
  const glow = useRef<HTMLSpanElement>(null);
  const was = useRef(lit);
  useEffect(() => {
    const rose = lit && !was.current;
    was.current = lit;
    if (!rose || reduced || !glow.current) return;
    const a = animate(glow.current, { opacity: [1, 0] }, tween.flash);
    return () => a.stop();
  }, [lit, reduced]);
  const has = pv.tone === "ok" || pv.tone === "part";
  const titleTone = lit ? (prov ? PROV_TEXT[side] : SIDE_TEXT[side]) : pv.tone === "none" ? "text-mute" : "text-fg";
  return (
    <div
      className="relative isolate flex min-w-0 flex-col overflow-clip rounded-xl border border-line bg-ink-950/50 p-3 [overflow-clip-margin:1px]"
      data-testid={testId}
      data-part={pv.id}
      data-lit={lit || undefined}
      data-state={pv.tone}
      data-provisional={prov || undefined}
    >
      {(["long", "short"] as const).map((s) => (
        <motion.span
          key={s}
          aria-hidden="true"
          className={cn("pointer-events-none absolute -inset-px -z-10 rounded-xl border", TONE_ON[s])}
          initial={false}
          animate={{ opacity: lit && !prov && side === s ? 1 : 0 }}
          transition={tween.crossfade}
        />
      ))}
      {(["long", "short"] as const).map((s) => (
        <motion.span
          key={`p-${s}`}
          aria-hidden="true"
          className={cn("pointer-events-none absolute -inset-px -z-10 rounded-xl border", TONE_PROV[s])}
          initial={false}
          animate={{ opacity: lit && prov && side === s ? 1 : 0 }}
          transition={tween.crossfade}
        />
      ))}
      <span ref={glow} aria-hidden="true" className={cn("pointer-events-none absolute inset-0 -z-10 opacity-0", side === "long" ? "bg-win/15" : "bg-loss/15")} />
      <div className="flex items-start justify-between gap-x-3 gap-y-1">
        <span className="inline-flex min-w-0 items-center gap-2">
          <span className="grid size-2.5 shrink-0 place-items-center">
            <StateDot tone={has ? side : null} strong={lit} state={prov ? "provisional" : "confirmed"} lit={lit && !prov} />
          </span>
          <span className={cn("min-w-0 text-[12.5px] font-semibold leading-snug transition-colors duration-300", titleTone)}>
            <span className="sr-only">{TONE_SR[pv.tone]}</span>
            {pv.title}
          </span>
        </span>
        {/* room for "+10 von 10 +1 Stärke" at all times: the bonus comes and goes with the market (≤ 1/s), and a points
            label that widened squeezed the title onto a second line – the whole part (and the card below it) jumped */}
        <span className="num min-w-[18ch] shrink-0 whitespace-nowrap pt-px text-right text-[10.5px] text-faint" data-testid="signal-part-points">
          {pv.pointsText}
          {lit && pv.bonus && <span className={cn("ml-1.5", prov ? PROV_TEXT[side] : SIDE_TEXT[side])}>+1 Stärke</span>}
        </span>
      </div>
      <GradeBar grade={pv.grade} segments={segments} side={side} prov={prov} />
      {children}
    </div>
  );
}

/** One cell of the Top-Trader scorecard: small caps title with its dot, the value, what it must show. */
function TraderCell({ c, side }: { c: PartCell; side: Side }) {
  const met = c.met === true;
  return (
    <div
      className={cn("relative h-full min-w-0 rounded-lg border px-2.5 py-2 transition-colors duration-300", met ? TONE_ON[side] : "border-line bg-ink-950/40")}
      data-testid="signal-part-cell"
      data-id={c.id}
      data-met={c.met === null ? "none" : String(met)}
    >
      <span className="flex items-center gap-1.5">
        <StateDot tone={c.met === null ? null : met ? side : null} strong={met} state="confirmed" lit={met} size={6} />
        <span className="truncate text-[9.5px] font-semibold uppercase tracking-[0.12em] text-faint">{c.title}</span>
      </span>
      {/* never cut (rule 5: numbers are never truncated): a long value ("Discount · 15 %" in a 390-px cell) wraps at
          its space, balanced */}
      <span className={cn("num mt-1 block font-mono text-[14px] leading-tight transition-colors duration-300 [text-wrap:balance]", met ? SIDE_TEXT[side] : c.met === null ? "text-faint" : "text-fg")}>
        <span className="sr-only">{c.met === null ? "keine Daten: " : met ? "erfüllt: " : "offen: "}</span>
        {c.value}
      </span>
      <span className="mt-0.5 block text-[10.5px] leading-snug text-faint">{c.sub}</span>
    </div>
  );
}

const sparkKey = (pts: readonly DeltaPoint[]): string => pts.map((p) => `${p.time}:${p.delta}`).join("|");

/**
 * Static sparkline of the Whale–Retail-Delta: the reading's last 12 five-minute points (oldest left), the side's
 * threshold as a dashed hairline when it lies near the curve, the newest point as a dot. Plain SVG (no animation, no
 * layout read); memoised on the points, so it re-renders only when the 5-min series changes.
 */
const DeltaSpark = memo(
  function DeltaSpark({ points, level }: { points: readonly DeltaPoint[]; level: number }) {
    if (points.length < 2) return null;
    const vals = points.map((p) => p.delta);
    let lo = Math.min(...vals);
    let hi = Math.max(...vals);
    const span = Math.max(1, hi - lo);
    // the threshold joins the scale only when it is near the curve (else the curve would flatten to a line)
    const showLevel = level >= lo - span && level <= hi + span;
    if (showLevel) {
      lo = Math.min(lo, level);
      hi = Math.max(hi, level);
    }
    const pad = Math.max(0.2, (hi - lo) * 0.12);
    lo -= pad;
    hi += pad;
    const x = (i: number): number => (i / (points.length - 1)) * 100;
    const y = (v: number): number => 22 - ((v - lo) / (hi - lo)) * 20;
    const d = vals.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(2)} ${y(v).toFixed(2)}`).join(" ");
    const last = vals[vals.length - 1]!;
    return (
      <svg
        viewBox="0 0 100 24"
        preserveAspectRatio="none"
        className="mt-1.5 block h-5 w-full overflow-visible"
        role="img"
        aria-label={`Delta letzte Stunde: ${n1(vals[0])} → ${n1(last)} pp`}
        data-testid="signal-delta-spark"
        data-points={points.length}
      >
        {showLevel && <line x1="0" x2="100" y1={y(level)} y2={y(level)} stroke="currentColor" strokeOpacity="0.28" strokeWidth="1" strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />}
        <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        {/* a zero-length round-capped segment: a dot that stays round under the stretched viewBox */}
        <path d={`M${x(vals.length - 1).toFixed(2)} ${y(last).toFixed(2)} l0 0`} stroke="currentColor" strokeWidth="4" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      </svg>
    );
  },
  (a, b) => a.level === b.level && sparkKey(a.points) === sparkKey(b.points),
);

/**
 * The Whale–Retail-Delta cell ("Retail rot" / "Retail grün"), like Hyblock: the delta in pp with its change over the
 * window (`−3,5 pp · 1h −2,1`), the last hour as a sparkline, the two long shares behind it (`Konten 65,6 % · Retail
 * 69,1 %`) and the rule it must meet.
 */
function DeltaCell({ c, side, reading, level }: { c: PartCell; side: Side; reading: TraderReading | null | undefined; level: number }) {
  const met = c.met === true;
  const [main, ...rest] = c.value.split(" · ");
  const pts = c.met === null ? [] : (reading?.deltaSeries ?? []);
  // each share stays whole; a narrow cell wraps at the separator
  const shares = reading && reading.account != null && reading.retail != null ? [`Konten ${n1(reading.account)} %`, `Retail ${n1(reading.retail)} %`] : null;
  return (
    <div
      className={cn("relative h-full min-w-0 rounded-lg border px-2.5 py-2 transition-colors duration-300", met ? TONE_ON[side] : "border-line bg-ink-950/40")}
      data-testid="signal-part-cell"
      data-id={c.id}
      data-met={c.met === null ? "none" : String(met)}
    >
      <span className="flex items-center gap-1.5">
        <StateDot tone={c.met === null ? null : met ? side : null} strong={met} state="confirmed" lit={met} size={6} />
        <span className="min-w-0 text-[9.5px] font-semibold uppercase leading-tight tracking-[0.12em] text-faint">{c.title}</span>
      </span>
      <span className={cn("num mt-1 block font-mono text-[14px] leading-tight transition-colors duration-300 [text-wrap:balance]", met ? SIDE_TEXT[side] : c.met === null ? "text-faint" : "text-fg")}>
        <span className="sr-only">{c.met === null ? "keine Daten: " : met ? "erfüllt: " : "offen: "}</span>
        <span className="whitespace-nowrap">{main}</span>
        {/* the change wraps under the level in a narrow cell (never cut) */}
        {rest.length > 0 && (
          <>
            {" "}
            <span className="whitespace-nowrap text-[11px] text-mute">· {rest.join(" · ")}</span>
          </>
        )}
      </span>
      {pts.length > 1 && (
        <span className={cn("block transition-colors duration-300", met ? SIDE_TEXT[side] : "text-mute")}>
          <DeltaSpark points={pts} level={level} />
        </span>
      )}
      {shares && (
        <span className="num mt-1 block text-[10.5px] leading-snug text-mute" data-testid="signal-delta-shares">
          <span className="whitespace-nowrap">{shares[0]}</span> · <span className="whitespace-nowrap">{shares[1]}</span>
        </span>
      )}
      <span className="mt-0.5 block text-[10.5px] leading-snug text-faint">{c.sub}</span>
    </div>
  );
}

/** Top-Trader-Kombi (decision 5): four cells lit / unlit with their values, segments = met parts. */
function TradersCard({ pv, side, cfg, wide }: { pv: PartView; side: Side; cfg: SignalCfg; wide: boolean }) {
  const cells = traderCells(pv.part, cfg);
  const red = whaleCfgOf(cfg).deltaRed;
  return (
    <PartShell pv={pv} side={side} testId="signal-whale" segments={cells.map((c) => c.met === true)}>
      <div className={cn("mt-2.5 grid grid-cols-2 gap-1.5", wide && "md:grid-cols-4 xl:grid-cols-2")} role="list" aria-label="Top-Trader-Teile">
        {cells.map((c) => (
          <div key={c.id} role="listitem" className="min-w-0">
            {c.id === "retail" ? <DeltaCell c={c} side={side} reading={pv.part.reading} level={side === "long" ? red : -red} /> : <TraderCell c={c} side={side} />}
          </div>
        ))}
      </div>
      {!pv.data && <p className="mt-2 text-[11px] leading-snug text-faint">Binance-Top-Trader-Daten fehlen (nur Binance, ~30 Tage zurück) · zählt nicht</p>}
    </PartShell>
  );
}

/** Divergences (decision 10): one row per ladder rung (what, which timeframe) and the best hit (where). */
function DivCard({ pv, side, cfg }: { pv: PartView; side: Side; cfg: SignalCfg }) {
  const hits = pv.part.hits ?? [];
  const trends = pv.part.trends ?? [];
  const line = divHitLine(pv.part);
  const tl = divTrendLine(pv.part);
  return (
    <PartShell pv={pv} side={side} testId="signal-div">
      <ul className="mt-2.5 grid gap-1" aria-label="Divergenzen je Timeframe">
        {pv.part.items.map((it) => {
          const own = hits.filter((h) => h.tf === it.id);
          const ownTl = trends.filter((t) => t.tf === it.id);
          const firm = own.some((h) => h.state !== "provisional") || ownTl.some((t) => t.state !== "provisional");
          const st: SignalState = !it.met ? "none" : firm ? "confirmed" : "provisional";
          const regular = own.some((h) => h.kind === "regular");
          return (
            <li key={it.id} className="grid grid-cols-[auto_2.5rem_minmax(0,1fr)] items-start gap-2 text-[11.5px] leading-5" data-testid="signal-div-row" data-tf={it.id} data-state={st} data-trend={ownTl.length ? "1" : undefined}>
              <span className="grid h-5 w-2.5 place-items-center">
                <StateDot tone={it.met ? side : null} strong={regular} state={st === "none" ? "confirmed" : st} lit={false} size={7} />
              </span>
              <span className={cn("num font-mono", it.met ? "text-fg" : "text-mute")}>{it.label}</span>
              {/* wraps instead of being cut (RSI + WT + Trendlinie on a 390-px phone) */}
              <span className={cn("min-w-0 [text-wrap:pretty]", it.met ? (st === "provisional" ? PROV_TEXT[side] : SIDE_TEXT[side]) : it.met === null ? "text-faint" : "text-mute")}>
                <span className="sr-only">{it.met ? "erfüllt: " : it.met === null ? "keine Daten: " : "offen: "}</span>
                {it.value}
              </span>
            </li>
          );
        })}
      </ul>
      <div className="mt-auto grid gap-0.5 pt-2 text-[11px] leading-snug text-faint">
        {tl && <p data-testid="signal-div-trend">{tl}</p>}
        <p data-testid="signal-div-hit">{line ?? divSetupText(cfg)}</p>
      </div>
    </PartShell>
  );
}

/** Support / resistance (decision 10): distance to the level leaned on (ATR) and room to the next one (R). */
function SrCard({ pv, side, cfg }: { pv: PartView; side: Side; cfg: SignalCfg }) {
  const v = srView(pv.part, cfg);
  const tint = side === "long" ? "bg-win/20" : "bg-loss/20";
  return (
    <PartShell pv={pv} side={side} testId="signal-sr">
      {!pv.data ? (
        <p className="mt-2.5 text-[11.5px] leading-snug text-faint">keine Daten · zu wenig Kerzen auf {v.tf ?? "dem Zonen-Timeframe"}</p>
      ) : (
        <>
          <Meter
            plain
            label={v.near.label}
            value={v.near.distAtr == null ? v.near.max : Math.min(v.near.max, v.near.distAtr)}
            min={0}
            max={v.near.max}
            bands={[{ from: 0, to: v.near.band, className: tint }]}
            ticks={[v.near.band]}
            active={v.near.met === true}
            side={side}
            valueText={v.near.value}
          />
          <p className="mt-1 truncate text-[10.5px] text-faint" data-testid="signal-sr-lean">
            {v.near.level}
          </p>
          <Meter
            plain
            label={v.room.label}
            value={v.room.r == null ? 0 : Math.min(v.room.max, v.room.r)}
            min={0}
            max={v.room.max}
            bands={[{ from: v.room.minR, to: v.room.max, className: tint }]}
            ticks={[v.room.minR]}
            active={v.room.met === true}
            side={side}
            valueText={v.room.value}
          />
          <p className="mt-1 truncate text-[10.5px] text-faint" data-testid="signal-sr-target">
            {v.room.level}
            {v.tf ? ` · ${v.tf}` : ""}
          </p>
        </>
      )}
    </PartShell>
  );
}

/**
 * `Teil-Bedingungen`: the graded parts of the selected side (Top-Trader-Kombi, Divergenzen, Support / Widerstand) —
 * each adds points in proportion to its grade and +1 strength while it holds fully. xl: one row (the scorecard a bit
 * wider); md: the scorecard over the two others; phone: stacked.
 */
export const PartsSection = memo(function PartsSection({ parts, side, cfg, points }: { parts: readonly PartView[]; side: Side; cfg: SignalCfg; points: number }) {
  if (!parts.length) return null;
  const traders = parts.find((p) => p.id === "traders");
  const three = parts.length === 3 && !!traders;
  const cols = three ? "xl:grid-cols-[1.25fr_1fr_1fr]" : parts.length === 2 ? "md:grid-cols-2" : "";
  return (
    <section className="grid gap-2.5" aria-label="Teil-Bedingungen" data-testid="signal-parts">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-mute">Teil-Bedingungen</span>
        <span className="num text-[11px] text-faint">zählen anteilig · {points > 0 ? `+${n1(points)} Punkte` : "keine Punkte"}</span>
      </div>
      <div className={cn("grid gap-2", three && "md:grid-cols-2", cols)}>
        {parts.map((pv) =>
          pv.id === "traders" ? (
            <div key={pv.id} className={cn("grid min-w-0", three && "md:col-span-2 xl:col-span-1")}>
              <TradersCard pv={pv} side={side} cfg={cfg} wide={three} />
            </div>
          ) : (
            <div key={pv.id} className="grid min-w-0">
              {pv.id === "div" ? <DivCard pv={pv} side={side} cfg={cfg} /> : <SrCard pv={pv} side={side} cfg={cfg} />}
            </div>
          ),
        )}
      </div>
    </section>
  );
});
