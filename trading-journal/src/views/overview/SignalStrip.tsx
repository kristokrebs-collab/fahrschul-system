import { AnimatePresence, motion } from "motion/react";
import { memo, useState, type CSSProperties } from "react";
import { LOADING_TEXT, NO_KIND_TEXT, OFFLINE_TEXT, SIGNAL_TITLE, type WtKind } from "@/domain/signals";
import { cn } from "@/lib/cn";
import { useSignalCheck } from "@/market";
import { spring, tween } from "@/motion/tokens";
import { TextRoll } from "@/motion/TextRoll";
import { usePressable } from "@/motion/usePressable";
import { useReducedFx } from "@/motion/useReducedFx";
import { Skeleton } from "@/primitives/Skeleton";
import { rollDirection } from "@/primitives/StatTile";
import { BiasBar } from "./BiasBar";
import { SIGNAL_CARD_ID } from "./SignalCard";
import { GhostDot, StateDot, StateLine, StrengthDots } from "./signalParts";
import { labelParts, partChips, PROV_TEXT, rungViews, statusPill, strengthView, verdictColor, verdictStateLine, verdictText, type PartChip, type RungView } from "./signalView";

export const SIGNAL_STRIP_DETAILS = "Details";

const STATUS_DOT: Record<string, string> = { live: "bg-win", warn: "bg-warn", error: "bg-loss", muted: "bg-faint" };
/** One-word event names for the chips (the dot colour carries the direction; the small crosses are "Kreuz", not "Einstieg"). */
const SHORT_KIND: Record<WtKind, string> = { bottom: "Bottom", buy: "Kauf", bull: "Kreuz", top: "Top", sell: "Verkauf", bear: "Kreuz" };

function Score({ score }: { score: number }) {
  const text = String(score);
  const [state, setState] = useState({ text, dir: "up" as "up" | "down" });
  if (state.text !== text) setState({ text, dir: rollDirection(state.text, text) });
  return <TextRoll text={text} mode="roll" direction={state.dir} />;
}

/**
 * One rung chip: timeframe, event dot (filled = strong, ring = zero-line cross; dashed + desaturated while provisional,
 * double ring when strongly confirmed) and the event word; lit chips glow (dashed tone while provisional).
 */
const RungChip = memo(function RungChip({ r, side }: { r: RungView; side: "long" | "short" }) {
  const tone = !r.event ? null : r.longKind ? "long" : "short";
  const prov = r.match && r.state === "provisional";
  const lit = r.lit && !prov;
  return (
    <span className="relative isolate flex min-w-0 items-center gap-2 overflow-clip rounded-lg border border-white/[0.07] bg-ink-950/60 px-2 py-1.5 [overflow-clip-margin:1px]" data-state={r.match ? r.state : "none"}>
      <motion.span
        aria-hidden="true"
        className={cn("pointer-events-none absolute -inset-px -z-10 rounded-lg border", side === "long" ? "border-win/35 bg-win/[0.07]" : "border-loss/35 bg-loss/[0.07]")}
        initial={false}
        animate={{ opacity: lit ? 1 : 0 }}
        transition={tween.crossfade}
      />
      <motion.span
        aria-hidden="true"
        className={cn("pointer-events-none absolute -inset-px -z-10 rounded-lg border border-dashed", side === "long" ? "border-[#65b488]/45 bg-[#65b488]/[0.04]" : "border-[#d27a7b]/45 bg-[#d27a7b]/[0.04]")}
        initial={false}
        animate={{ opacity: r.lit && prov ? 1 : 0 }}
        transition={tween.crossfade}
      />
      <span className="dot-num shrink-0 text-[14px] leading-none text-fg">{r.tf}</span>
      {r.intrabar ? (
        // intrabar memory: the forming candle showed it earlier, the price took it back (greyed, never counted)
        <>
          <span className="grid size-[6px] shrink-0 place-items-center overflow-visible">
            <GhostDot size={8} />
          </span>
          <span className="truncate text-[11px] text-faint" data-intrabar={r.intrabar.kind}>
            {SHORT_KIND[r.intrabar.kind]}
          </span>
        </>
      ) : (
        <>
          <StateDot tone={tone} strong={r.strong} state={r.match && r.state !== "none" ? r.state : "confirmed"} lit={false} size={6} />
          <span className={cn("truncate text-[11px]", r.match ? (prov ? PROV_TEXT[side] : side === "long" ? "text-win" : "text-loss") : "text-faint")}>
            {!r.check ? "–" : r.event ? SHORT_KIND[r.event.kind] : NO_KIND_TEXT}
            {prov && <span className="ml-1 text-warn">⚠</span>}
          </span>
        </>
      )}
    </span>
  );
});

/** The parts in one slim row: `● Top-Trader 3/4 · ● Divergenz 1h · ● S/R 3,1 R` (same dot language, lit while they hold). */
const PartsLine = memo(function PartsLine({ chips, side }: { chips: readonly PartChip[]; side: "long" | "short" }) {
  return (
    <span className="flex min-w-0 flex-wrap items-center justify-end gap-x-3 gap-y-1 text-[11px]">
      {chips.map((c) => {
        const has = c.tone === "ok" || c.tone === "part";
        return (
          <span
            key={c.id}
            className="flex shrink-0 items-center gap-1.5 whitespace-nowrap"
            data-testid={c.id === "traders" ? "signal-strip-whale" : `signal-strip-${c.id}`}
            data-lit={c.tone === "ok" || undefined}
            data-state={c.tone}
          >
            <StateDot tone={has ? side : null} strong={c.tone === "ok"} state={c.provisional ? "provisional" : "confirmed"} lit={false} size={6} />
            <span className={cn(c.tone === "ok" ? (c.provisional ? PROV_TEXT[side] : side === "long" ? "text-win" : "text-loss") : "text-faint")}>{c.label}</span>
            <span className="num font-mono text-mute">{c.value}</span>
          </span>
        );
      })}
    </span>
  );
});

/**
 * Compact "Einstiegs-Check" in the hero's left column (lg+, where the landscape-tablet layout left an empty band above
 * the KPI tiles): best verdict, score, strength dots, the bias line, the timeframe ladder as chips (with their
 * candle-close state) and one slim line with the entry's state (⚠ vorläufig · schließt in mm:ss / bestätigt, on the
 * shared clock) and the graded parts. The whole strip is one button
 * that glides to the full card (`SIGNAL_CARD_ID`). Renders ≤ 1/s (published check state); opaque surface, so the hero
 * dot matrix never shows through its text.
 */
export function SignalStrip({ className }: { className?: string }) {
  const check = useSignalCheck();
  const reduced = useReducedFx();
  const press = usePressable({ scale: 0.99 });
  const snap = check.snapshot;
  const v = snap?.best ?? null;
  const rungs = snap && v ? rungViews(snap, v, v.side, snap.cfg) : [];
  const chips = v ? partChips(v) : [];
  const traders = v?.parts?.find((p) => p.id === "traders");
  const pill = statusPill(check.state);
  const color = v ? verdictColor(v) : "#9b9b9b";
  const st = v ? strengthView(v, snap?.cfg.ladder.length ?? 4) : null;
  const open = () => document.getElementById(SIGNAL_CARD_ID)?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
  const whaleSaid = traders?.ok ? `${traders.label}. ` : "";
  const name = v ? `${SIGNAL_TITLE}: ${v.label}, Score ${v.score} von 100. ${whaleSaid}${SIGNAL_STRIP_DETAILS} ansehen` : `${SIGNAL_TITLE}: ${check.message ?? LOADING_TEXT}`;
  return (
    <motion.button
      type="button"
      onClick={open}
      aria-label={name}
      whileTap={press.whileTap}
      transition={press.transition}
      data-testid="signal-strip"
      data-hero-mask="box"
      className={cn("group/strip @container/strip grid w-full gap-2.5 rounded-2xl border border-white/10 bg-ink-900 p-3.5 text-left hover:border-white/25", className)}
    >
      <span className="flex items-center justify-between gap-3">
        <span className="label flex min-w-0 items-center gap-2 !text-[10px]">
          <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", STATUS_DOT[pill.tone])} />
          <span className="truncate">
            {SIGNAL_TITLE} · {pill.label}
          </span>
        </span>
        <span className="shrink-0 text-[11px] text-mute group-hover/strip:text-fg">{SIGNAL_STRIP_DETAILS} ↓</span>
      </span>
      {v && snap ? (
        <>
          <span className="flex items-center justify-between gap-3">
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span
                key={v.label}
                className={cn("min-w-0 truncate text-[15px] font-semibold tracking-tight", verdictText(v))}
                initial={reduced ? { opacity: 0 } : { opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0, transition: reduced ? tween.fade : spring.smooth }}
                exit={{ opacity: 0, transition: tween.exit }}
              >
                {labelParts(v.label).prefix && <span className="sr-only">{labelParts(v.label).prefix}</span>}
                {labelParts(v.label).text}
              </motion.span>
            </AnimatePresence>
            <span className="flex shrink-0 items-center gap-3">
              <span aria-hidden="true" className="contents">
                <StrengthDots strength={st?.dots ?? 0} color={color} outlined={st?.outlined} label={st?.aria ?? ""} size="sm" />
              </span>
              <span className="dot-num text-[20px] leading-none text-fg" aria-hidden="true">
                <Score score={v.score} />
              </span>
            </span>
          </span>
          <BiasBar sig={snap} cfg={snap.cfg} compact />
          {/* one row of chips when the strip is wide enough for the words, two rows below ~30 rem (lg at 1024 px) */}
          <span
            className="grid grid-cols-2 gap-1.5 @min-[30rem]/strip:grid-cols-[repeat(var(--rungs),minmax(0,1fr))]"
            style={{ "--rungs": Math.max(1, rungs.length) } as CSSProperties}
            aria-hidden="true"
          >
            {rungs.map((r) => (
              <RungChip key={r.tf} r={r} side={v.side} />
            ))}
          </span>
          <span aria-hidden="true" className="flex min-w-0 items-center justify-between gap-3 px-0.5">
            <StateLine line={verdictStateLine(snap, v, snap.cfg)} side={v.side} className="text-[11px]" />
            {chips.length > 0 && <PartsLine chips={chips} side={v.side} />}
          </span>
        </>
      ) : (
        <>
          <span className="text-[13px] text-mute">{check.state === "loading" ? (check.message ?? LOADING_TEXT) : (check.message ?? OFFLINE_TEXT)}</span>
          <span className="grid grid-cols-2 gap-1.5 @min-[30rem]/strip:grid-cols-4" aria-hidden="true">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-[30px] rounded-lg" />
            ))}
          </span>
        </>
      )}
    </motion.button>
  );
}
