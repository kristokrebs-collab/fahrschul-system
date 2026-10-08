/**
 * "Long/Short-Tendenz": every condition of the Einstiegs-Check weighed against each other on ONE horizontal bar —
 * Long (left, win green) ↔ Short (right, loss red), a centre tick, the neutral zone and a needle (pure model:
 * `@/domain/signals/bias`).
 *
 * 120 Hz: the needle, the gradient fill (centre → needle) and the needle halo are ONE MotionValue (`useRevealValue`:
 * rests in the centre until first in view, then springs out), transform / opacity only. React renders only when the
 * engine publishes a new evaluation (≤ 1/s): the label and the percent swap through `TextRoll`. The spring depends on
 * how far the score jumped (`contextSpringAt(spring.smooth, …)`): a small drift glides critically damped, a big swing
 * moves directly with a little bounce. Reduced motion: the needle jumps.
 *
 * Full variant (`SignalCard`): a `MorphCard` (tap / click / Enter / Space) opening the explainer with a diverging bar
 * per condition; the meter itself is a sibling `role="meter"` (a button's children are presentational).
 * Compact variant (`SignalStrip`, which is itself a button): visual only, `aria-hidden`.
 */
import { motion, useTransform, type MotionValue } from "motion/react";
import { memo, useMemo, useRef, useState, type RefObject } from "react";
import { DEFAULT_SIGNAL_CFG, sanitizeWhaleCfg, whaleCfgOf, type SignalCfg } from "@/domain/signals";
import {
  BIAS_LABEL,
  BIAS_LEAN,
  BIAS_NO_DATA,
  BIAS_STRONG,
  BIAS_TITLE,
  biasMethodText,
  computeBias,
  contributionImpact,
  roundToSum,
  sanitizeBiasCfg,
  type Bias,
  type BiasCfg,
  type BiasContribution,
  type BiasInput as BiasSignals,
  type BiasLevel,
} from "@/domain/signals/bias";
import { cn } from "@/lib/cn";
import { useSignalCheck } from "@/market";
import { MorphCard, MorphTitle } from "@/motion/MorphCard";
import { contextSpringAt, smoothstep } from "@/motion/physics";
import { StaggerItem } from "@/motion/Stagger";
import { TextRoll } from "@/motion/TextRoll";
import { spring } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { useRevealValue } from "@/primitives/revealValue";
import { useJournal } from "@/store/journalStore";

export const BIAS_CARD_ID = "signal-bias";
export const BIAS_DETAILS = "Bedingungen ansehen";

type BiasInput = BiasSignals | null | undefined;

/** Score jumps below this glide on `spring.smooth` itself; from `BIAS_JUMP_FAST` on the context spring is at full tempo. */
const BIAS_JUMP_SLOW = 0.08;
const BIAS_JUMP_FAST = 0.6;
/** The needle stays this far (% of the bar) off the ends, so its cap never clips. */
const NEEDLE_INSET = 1.2;

interface BiasState {
  sig: BiasInput;
  cfg: SignalCfg;
  bias: Bias | null;
  prev: Bias | null;
}

/**
 * The bias of the published evaluation with the label hysteresis carried from the previous one (state from props:
 * recomputed only when the engine publishes, ≤ 1/s). `seed` = the level to continue from (explainer = the card's).
 */
export function useBias(sig: BiasInput, cfg: SignalCfg, seed?: BiasLevel | null): { bias: Bias | null; prev: Bias | null } {
  const [st, setSt] = useState<BiasState>(() => ({ sig, cfg, bias: computeBias(sig, cfg, seed), prev: null }));
  if (st.sig !== sig || st.cfg !== cfg) {
    const next: BiasState = { sig, cfg, bias: computeBias(sig, cfg, st.bias?.level ?? seed), prev: st.bias };
    setSt(next);
    return { bias: next.bias, prev: next.prev };
  }
  return { bias: st.bias, prev: st.prev };
}

/** The weights the bias reads from `settings.signals` (`bias` override + the whale weight) as a stable key; `null` without a signals object. */
function liveWeightsKey(settings: unknown): string | null {
  const sg = settings && typeof settings === "object" ? (settings as { signals?: unknown }).signals : undefined;
  if (!sg || typeof sg !== "object") return null;
  const r = sg as { bias?: unknown; whale?: unknown };
  return JSON.stringify({ bias: sanitizeBiasCfg(r.bias), whale: sanitizeWhaleCfg(r.whale).weight });
}

/**
 * `cfg` (the published evaluation's) with the bias weights read LIVE from the journal settings: the engine keeps its
 * config — and re-uses the snapshot — while only weights change (they do not change the evaluation), so an override
 * from a backup import or another tab would otherwise wait for a reload. Same identity while nothing differs.
 */
export function useLiveBiasCfg(cfg: SignalCfg): SignalCfg {
  const key = useJournal((s) => liveWeightsKey(s.settings));
  return useMemo(() => {
    if (key == null || key === liveWeightsKey({ signals: cfg })) return cfg;
    const live = JSON.parse(key) as { bias: BiasCfg; whale: number };
    return { ...cfg, bias: live.bias, whale: { ...whaleCfgOf(cfg), weight: live.whale } } as SignalCfg;
  }, [cfg, key]);
}

/** Needle spring for a score jump of `jump` (0 … 2): `spring.smooth` for a drift, livelier and direct for a swing. */
export function needleSpring(jump: number) {
  return contextSpringAt(spring.smooth, smoothstep(BIAS_JUMP_SLOW, BIAS_JUMP_FAST, Math.abs(jump)));
}

/** Score −1 … +1 → position 0 … 100 % on the bar (Long left: +1 → 0 %, Short right: −1 → 100 %). */
export const biasX = (score: number): number => ((1 - Math.max(-1, Math.min(1, score))) / 2) * 100;

const LEVEL_TEXT: Record<"long" | "short" | "none", string> = { long: "text-win", short: "text-loss", none: "text-fg" };
const toneOf = (b: Bias | null): keyof typeof LEVEL_TEXT => (!b || b.level === 0 ? "none" : b.level > 0 ? "long" : "short");

/* ------------------------------------------------------------------ the track */

/**
 * The bar: ambient long (left) / short (right) tints, the neutral zone (±`BIAS_LEAN`), ticks at the centre and at ±`BIAS_STRONG`,
 * the gradient fill from the centre to the needle (scaleX of a half-width layer) and the needle with its halo. All
 * driven by `score` (MotionValue) — no React render while it moves.
 */
const BiasTrack = memo(function BiasTrack({ score, compact = false, empty = false }: { score: MotionValue<number>; compact?: boolean; empty?: boolean }) {
  const longScale = useTransform(score, (s) => Math.max(0, Math.min(1, s)));
  const shortScale = useTransform(score, (s) => Math.max(0, Math.min(1, -s)));
  const x = useTransform(score, (s) => `${Math.max(NEEDLE_INSET, Math.min(100 - NEEDLE_INSET, biasX(s)))}%`);
  const winHalo = useTransform(score, (s) => Math.max(0, Math.min(1, (s - BIAS_LEAN / 2) * 2.5)));
  const lossHalo = useTransform(score, (s) => Math.max(0, Math.min(1, (-s - BIAS_LEAN / 2) * 2.5)));
  const lean = BIAS_LEAN * 50;
  return (
    <span className={cn("relative block", compact ? "h-3" : "h-7")} data-testid={compact ? undefined : "bias-track"} aria-hidden="true">
      <span className={cn("absolute inset-x-0 top-1/2 -translate-y-1/2 overflow-hidden rounded-full bg-white/[0.05]", compact ? "h-1.5" : "h-2.5")}>
        <span className="absolute inset-y-0 left-0 w-1/2 bg-gradient-to-r from-win/[0.16] to-transparent" />
        <span className="absolute inset-y-0 right-0 w-1/2 bg-gradient-to-l from-loss/[0.16] to-transparent" />
        <span className="absolute inset-y-0 bg-white/[0.07]" style={{ left: `${50 - lean}%`, right: `${50 - lean}%` }} />
        {!empty && (
          <>
            <motion.span className="absolute inset-y-0 right-1/2 w-1/2 origin-right bg-gradient-to-l from-win/10 via-win/45 to-win" style={{ scaleX: longScale }} />
            <motion.span className="absolute inset-y-0 left-1/2 w-1/2 origin-left bg-gradient-to-r from-loss/10 via-loss/45 to-loss" style={{ scaleX: shortScale }} />
          </>
        )}
      </span>
      {!compact &&
        [-BIAS_STRONG, BIAS_STRONG].map((t) => (
          <span key={t} className="absolute top-1/2 h-3.5 w-px -translate-y-1/2 bg-white/[0.14]" style={{ left: `${biasX(t)}%` }} />
        ))}
      <span className={cn("absolute left-1/2 top-1/2 w-px -translate-x-1/2 -translate-y-1/2 bg-white/40", compact ? "h-3" : "h-5")} />
      {!empty && (
        <motion.span className="absolute inset-y-0 left-0 w-full" style={{ x }} data-testid={compact ? undefined : "bias-needle"}>
          {!compact && (
            <>
              <motion.span className="absolute left-0 top-1/2 size-7 -translate-x-1/2 -translate-y-1/2 rounded-full bg-win/35 blur-md" style={{ opacity: winHalo }} />
              <motion.span className="absolute left-0 top-1/2 size-7 -translate-x-1/2 -translate-y-1/2 rounded-full bg-loss/35 blur-md" style={{ opacity: lossHalo }} />
            </>
          )}
          <span
            className={cn(
              "absolute left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-fg shadow-[0_0_0_3px_rgb(4_4_4/0.75)]",
              compact ? "h-3 w-[3px]" : "h-6 w-1",
            )}
          />
        </motion.span>
      )}
    </span>
  );
});

/** Scale under the full bar: the labels sit OUTSIDE the bar, so the needle never crosses text. */
function BiasScale() {
  return (
    <span className="mt-1 grid grid-cols-3 gap-2 text-[10px] font-semibold uppercase tracking-[0.12em]" aria-hidden="true">
      <span className="text-win/80">Long</span>
      <span className="text-center text-faint">Neutral</span>
      <span className="text-right text-loss/80">Short</span>
    </span>
  );
}

/** `89 %` (Doto) + the leading side's word in its colour; the number slot-rolls in the direction of the change. */
function BiasFigure({ bias, dir, size = "card" }: { bias: Bias; dir: "up" | "down"; size?: "card" | "dialog" }) {
  return (
    <span className="flex shrink-0 items-baseline gap-2" data-testid="bias-percent">
      <span className={cn("dot-num leading-none text-fg", size === "card" ? "text-[26px]" : "text-[24px]")}>
        <TextRoll text={String(bias.pct)} mode="roll" direction={dir} />
        <span className="ml-1 text-[0.62em] text-mute">%</span>
      </span>
      <span className={cn("text-[12px] font-semibold uppercase tracking-[0.08em] transition-colors duration-300", bias.side ? LEVEL_TEXT[bias.side] : "text-faint")}>
        {bias.side === "long" ? "Long" : bias.side === "short" ? "Short" : "ausgeglichen"}
      </span>
    </span>
  );
}

/** The needle's MotionValue for a bias (first view: springs out of the centre). */
function useNeedle(ref: RefObject<Element | null>, bias: Bias | null, prev: Bias | null): MotionValue<number> {
  const target = bias?.score ?? 0;
  const jump = Math.abs(target - (prev?.score ?? 0));
  return useRevealValue(ref, target, { transition: needleSpring(jump), from: 0 });
}

/** Roll direction of the percent: up when the shown share grows. */
const pctRoll = (bias: Bias | null, prev: Bias | null): "up" | "down" => (!bias || !prev || bias.pct >= prev.pct ? "up" : "down");

/* ------------------------------------------------------------------ full (card) */

export interface BiasBarProps {
  /** the published evaluation (`useSignalCheck().snapshot`) */
  sig: BiasInput;
  cfg: SignalCfg;
  /** visual-only one-line variant for the hero strip (inside its button) */
  compact?: boolean;
  className?: string;
}

/**
 * The bar. Full: header (title, conditions counted, `Details`), label + percent, the bar, the Long · Neutral · Short
 * scale; the whole box is the `MorphCard` that opens the explainer. Compact: `Tendenz` · bar · label + percent.
 */
export function BiasBar({ compact = false, ...props }: BiasBarProps) {
  return compact ? <BiasStripBar {...props} /> : <BiasCardBar {...props} />;
}

/** Compact one-liner of the hero strip (`Tendenz` · bar · label + %), visual only (the strip is the button). */
function BiasStripBar({ sig, cfg: snapCfg, className }: Omit<BiasBarProps, "compact">) {
  const cfg = useLiveBiasCfg(snapCfg);
  const { bias, prev } = useBias(sig, cfg);
  const ref = useRef<HTMLSpanElement>(null);
  const needle = useNeedle(ref, bias, prev);
  const tone = toneOf(bias);
  return (
    <span
      ref={ref}
      aria-hidden="true"
      className={cn("grid grid-cols-[auto_minmax(48px,1fr)_auto] items-center gap-3", className)}
      data-testid="signal-strip-bias"
      data-level={bias?.level}
    >
      <span className="label !text-[9.5px]" data-testid="bias-strip-label">
        Tendenz
      </span>
      <BiasTrack score={needle} compact empty={!bias} />
      <span className="flex items-baseline gap-1.5 whitespace-nowrap text-[11px]" data-testid="bias-strip-text">
        <span className={cn("font-semibold transition-colors duration-300", LEVEL_TEXT[tone])}>
          <TextRoll text={bias?.label ?? BIAS_NO_DATA} />
        </span>
        {bias && (
          <span className="num font-mono text-mute">
            <TextRoll text={`${bias.pct} %`} mode="roll" direction={pctRoll(bias, prev)} />
          </span>
        )}
      </span>
    </span>
  );
}

/** Full bar of the card: a `MorphCard` (tap / click / Enter / Space → explainer) plus the sibling meter. */
function BiasCardBar({ sig, cfg: snapCfg, className }: Omit<BiasBarProps, "compact">) {
  const cfg = useLiveBiasCfg(snapCfg);
  const { bias, prev } = useBias(sig, cfg);
  const ref = useRef<HTMLDivElement>(null);
  const needle = useNeedle(ref, bias, prev);
  const dir = pctRoll(bias, prev);
  const tone = toneOf(bias);
  const label = bias?.label ?? BIAS_NO_DATA;
  const seedLevel = bias?.level ?? null;
  const name = bias ? `${BIAS_TITLE}: ${bias.valueText}. ${BIAS_DETAILS}` : `${BIAS_TITLE}: ${BIAS_NO_DATA}`;
  return (
    <div ref={ref} className={cn("relative", className)} data-testid={BIAS_CARD_ID} data-level={bias?.level} data-score={bias ? bias.score.toFixed(3) : undefined}>
      {/* the meter for assistive tech (a button's children are presentational, so it sits beside it) */}
      <div
        role="meter"
        aria-label={BIAS_TITLE}
        aria-valuemin={-100}
        aria-valuemax={100}
        aria-valuenow={bias ? Math.round(bias.score * 100) : 0}
        aria-valuetext={bias?.valueText ?? BIAS_NO_DATA}
        className="sr-only"
      />
      <MorphCard
        id={BIAS_CARD_ID}
        title={BIAS_TITLE}
        borderRadius={12}
        className="rounded-xl border border-line bg-ink-950/50 p-4 hover:border-white/25"
        body={() => <BiasExplain seed={seedLevel} />}
        motionProps={{ "aria-label": name }}
      >
        <span className="flex items-center justify-between gap-3">
          <span className="flex min-w-0 items-center gap-2">
            <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-signal" />
            <MorphTitle id={BIAS_CARD_ID} as="span" className="label truncate !text-fg">
              {BIAS_TITLE}
            </MorphTitle>
            {bias && (
              <span className="hidden shrink-0 text-[11px] text-faint sm:inline">
                · {bias.used} von {bias.total} Bedingungen
              </span>
            )}
          </span>
          <span className="shrink-0 text-[11px] text-mute transition-colors group-hover:text-fg">Details ›</span>
        </span>
        {/* xl: label + figure over the verdict ring, the bar over the ladder (same column split as the row below; the
            10 px gap makes up for this box's 16 px padding, so the bar starts where the 30m tile starts) */}
        <span className="mt-3 grid gap-2 xl:grid-cols-[minmax(280px,0.8fr)_2fr] xl:items-center xl:gap-x-2.5">
          <span className="flex items-baseline justify-between gap-3 xl:pr-8">
            <span className={cn("min-w-0 text-[20px] font-semibold leading-none tracking-tight transition-colors duration-300", LEVEL_TEXT[tone])} data-testid="bias-label">
              <TextRoll text={label} />
            </span>
            {bias && <BiasFigure bias={bias} dir={dir} />}
          </span>
          <span className="block">
            <BiasTrack score={needle} empty={!bias} />
            <BiasScale />
          </span>
        </span>
      </MorphCard>
    </div>
  );
}

/* ------------------------------------------------------------------ explainer */

const fmtVote = (v: number): string => {
  const r = Math.round(v * 100) / 100;
  return `${r > 0 ? "+" : r < 0 ? "−" : "±"}${Math.abs(r).toFixed(2).replace(".", ",")}`;
};

/** `Long` / `Short` / `neutral` word of one vote. */
export function voteWord(v: number | null): string {
  if (v == null) return "keine Daten";
  if (Math.abs(v) < 0.05) return "neutral";
  return v > 0 ? "Long" : "Short";
}

/**
 * One condition: name, vote word + number, a diverging bar (left Long, right Short, from the centre), detail, and
 * `Gewicht 16 % → +0,16` (weight share and the row's contribution to the sum, both rounded so the rows add up exactly).
 */
const ContributionRow = memo(function ContributionRow({ c, pct, cents }: { c: BiasContribution; pct: number; cents: number }) {
  const reduced = useReducedFx();
  const v = c.vote;
  const side = v == null || Math.abs(v) < 0.05 ? null : v > 0 ? "long" : "short";
  const mag = v == null ? 0 : Math.min(1, Math.abs(v));
  return (
    <li className={cn("grid gap-1.5", v == null && "opacity-60")} data-testid="bias-row" data-id={c.id} data-vote={v == null ? "none" : v.toFixed(2)}>
      <span className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 text-[12.5px] font-semibold leading-snug text-fg">{c.label}</span>
        <span className={cn("shrink-0 whitespace-nowrap text-[11.5px]", side ? LEVEL_TEXT[side] : "text-faint")}>
          {voteWord(v)}
          {v != null && <span className="num ml-1.5 font-mono">{fmtVote(v)}</span>}
        </span>
      </span>
      <span className="relative block h-2 overflow-hidden rounded-full bg-white/[0.05]" aria-hidden="true">
        {side && (
          <motion.span
            className={cn("absolute inset-y-0 w-1/2", side === "long" ? "right-1/2 origin-right bg-gradient-to-l from-win/25 to-win" : "left-1/2 origin-left bg-gradient-to-r from-loss/25 to-loss")}
            initial={reduced ? false : { scaleX: 0 }}
            animate={{ scaleX: mag }}
            transition={reduced ? { duration: 0 } : needleSpring(mag)}
          />
        )}
        <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-white/35" />
      </span>
      <span className="flex items-baseline justify-between gap-3 text-[11px] leading-snug">
        <span className="min-w-0 text-mute">{c.detail}</span>
        <span className="num shrink-0 whitespace-nowrap font-mono text-faint" data-testid="bias-row-weight">
          {c.vote == null ? "zählt nicht" : `Gewicht ${pct} % → ${fmtVote(cents / 100)}`}
        </span>
      </span>
    </li>
  );
});

/**
 * Explainer body (MorphDialog): the bar again, the method, and every condition's vote. Reads the live check itself,
 * so it follows the engine while open; `seed` continues the card's label hysteresis.
 */
export function BiasExplain({ seed }: { seed?: BiasLevel | null }) {
  const snap = useSignalCheck().snapshot;
  const cfg = useLiveBiasCfg(snap?.cfg ?? DEFAULT_SIGNAL_CFG);
  const { bias, prev } = useBias(snap, cfg, seed);
  const ref = useRef<HTMLDivElement>(null);
  const needle = useNeedle(ref, bias, prev);
  const dir = pctRoll(bias, prev);
  const tone = toneOf(bias);
  // shares in whole % adding up to 100, contributions in hundredths adding up to the shown sum (largest remainder)
  const pcts = useMemo(() => (bias ? roundToSum(bias.contributions.map((c) => c.share * 100)) : []), [bias]);
  const cents = useMemo(() => (bias ? roundToSum(bias.contributions.map((c) => contributionImpact(c) * 100)) : []), [bias]);
  if (!snap || !bias) return <p className="text-[13px] text-mute">{BIAS_NO_DATA}</p>;
  const sumCents = cents.reduce((a, x) => a + x, 0);
  return (
    <div className="grid gap-5" data-testid="bias-explain">
      <StaggerItem>
        <div ref={ref} className="grid gap-2 rounded-xl border border-line bg-ink-950/40 p-4">
          <div className="flex items-baseline justify-between gap-3">
            <span className={cn("text-[19px] font-semibold leading-none tracking-tight", LEVEL_TEXT[tone])}>
              <TextRoll text={bias.label} />
            </span>
            <BiasFigure bias={bias} dir={dir} size="dialog" />
          </div>
          <BiasTrack score={needle} />
          <BiasScale />
        </div>
      </StaggerItem>
      <StaggerItem>
        <p className="max-w-[70ch] text-[13px] leading-relaxed text-mute">{biasMethodText(cfg)}</p>
      </StaggerItem>
      <StaggerItem>
        <ul className="grid gap-4" aria-label="Beiträge der Bedingungen">
          {bias.contributions.map((c, i) => (
            <ContributionRow key={c.id} c={c} pct={pcts[i] ?? 0} cents={cents[i] ?? 0} />
          ))}
        </ul>
      </StaggerItem>
      <StaggerItem>
        <p className="rounded-xl border border-line-2 bg-white/[0.03] px-3 py-2 text-[12.5px] leading-relaxed text-mute" data-testid="bias-sum">
          Summe <span className="num font-mono text-fg">{fmtVote(sumCents / 100)}</span>
          {bias.limit && (
            <>
              {" "}
              · begrenzt auf <span className="num font-mono text-fg">{fmtVote(bias.score)}</span> ({bias.limit.text})
            </>
          )}{" "}
          → <span className={cn("font-semibold", LEVEL_TEXT[tone])}>{BIAS_LABEL[bias.level]}</span>
          {bias.hold && ` (${bias.hold})`} · {bias.percent} · {bias.used} von {bias.total} Bedingungen mit Daten
        </p>
      </StaggerItem>
    </div>
  );
}
