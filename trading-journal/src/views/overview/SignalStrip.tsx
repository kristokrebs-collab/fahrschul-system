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
import { rungViews, statusPill, verdictColor, verdictText, whaleView, type RungView, type WhaleRowView } from "./signalView";

export const SIGNAL_STRIP_DETAILS = "Details";

const STATUS_DOT: Record<string, string> = { live: "bg-win", warn: "bg-warn", error: "bg-loss", muted: "bg-faint" };
/** One-word event names for the chips (the dot colour carries the direction). */
const SHORT_KIND: Record<WtKind, string> = { bottom: "Bottom", buy: "Kauf", bull: "Einstieg", top: "Top", sell: "Verkauf", bear: "Einstieg" };

function Score({ score }: { score: number }) {
  const text = String(score);
  const [state, setState] = useState({ text, dir: "up" as "up" | "down" });
  if (state.text !== text) setState({ text, dir: rollDirection(state.text, text) });
  return <TextRoll text={text} mode="roll" direction={state.dir} />;
}

/** One rung chip: timeframe, event dot (filled = strong, ring = zero-line cross) and the event word; lit chips glow. */
const RungChip = memo(function RungChip({ r, side }: { r: RungView; side: "long" | "short" }) {
  const tone = !r.event ? null : r.longKind ? "win" : "loss";
  return (
    <span className="relative isolate flex min-w-0 items-center gap-2 overflow-hidden rounded-lg border border-white/[0.07] bg-ink-950/60 px-2 py-1.5">
      <motion.span
        aria-hidden="true"
        className={cn("pointer-events-none absolute -inset-px -z-10 rounded-lg border", side === "long" ? "border-win/35 bg-win/[0.07]" : "border-loss/35 bg-loss/[0.07]")}
        initial={false}
        animate={{ opacity: r.lit ? 1 : 0 }}
        transition={tween.crossfade}
      />
      <span className="dot-num shrink-0 text-[14px] leading-none text-fg">{r.tf}</span>
      <span
        aria-hidden="true"
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          !tone ? "bg-line-2" : r.strong ? (tone === "win" ? "bg-win" : "bg-loss") : tone === "win" ? "border border-win" : "border border-loss",
        )}
      />
      <span className={cn("truncate text-[11px]", r.match ? (side === "long" ? "text-win" : "text-loss") : "text-faint")}>{!r.check ? "–" : r.event ? SHORT_KIND[r.event.kind] : NO_KIND_TEXT}</span>
    </span>
  );
});

/** One slim line "● Top-Trader kaufen · Retail rot … 2/2×" under the chips: same dot language, lit when it holds. */
const WhaleLine = memo(function WhaleLine({ w, side }: { w: WhaleRowView; side: "long" | "short" }) {
  const lit = w.state === "ok";
  const tone = side === "long" ? "win" : "loss";
  return (
    <span className="flex min-w-0 items-center gap-2 px-0.5 text-[11px]" data-testid="signal-strip-whale" data-lit={lit || undefined}>
      <span
        aria-hidden="true"
        className={cn(
          "size-1.5 shrink-0 rounded-full transition-colors duration-300",
          lit ? (tone === "win" ? "bg-win" : "bg-loss") : w.state === "open" && w.run > 0 ? (tone === "win" ? "border border-win" : "border border-loss") : "bg-line-2",
        )}
      />
      <span className={cn("min-w-0 truncate transition-colors duration-300", lit ? (tone === "win" ? "text-win" : "text-loss") : "text-faint")}>{w.title}</span>
      <span className="num ml-auto shrink-0 font-mono text-faint">{w.state === "none" ? "keine Daten" : `${Math.min(w.run, 99)}/${w.need}× ${w.period ?? ""}`}</span>
    </span>
  );
});

/**
 * Compact "Einstiegs-Check" in the hero's left column (lg+, where the landscape-tablet layout left an empty band above
 * the KPI tiles): best verdict, score, strength dots, the timeframe ladder as chips and one slim "Top-Trader kaufen ·
 * Retail rot" line. The whole strip is one button
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
  const whale = snap && v ? whaleView(snap, v.side, snap.cfg) : null;
  const pill = statusPill(check.state);
  const color = v ? verdictColor(v) : "#9b9b9b";
  const open = () => document.getElementById(SIGNAL_CARD_ID)?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
  const whaleSaid = whale?.on && whale.state === "ok" ? `${whale.title}. ` : "";
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
                {v.label}
              </motion.span>
            </AnimatePresence>
            <span className="flex shrink-0 items-center gap-3">
              <span className="flex gap-1" aria-hidden="true">
                {[1, 2, 3, 4].map((i) => (
                  <span key={i} className="relative size-1.5 rounded-full bg-[#2c2c2c]">
                    <motion.span
                      className="absolute inset-0 rounded-full"
                      style={{ backgroundColor: color }}
                      initial={false}
                      animate={{ opacity: i <= v.strength ? 1 : 0, scale: i <= v.strength ? 1 : 0.4 }}
                      transition={reduced ? tween.crossfade : { opacity: tween.fade, scale: spring.pop }}
                    />
                  </span>
                ))}
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
          {whale?.on && (
            <span aria-hidden="true" className="contents">
              <WhaleLine w={whale} side={v.side} />
            </span>
          )}
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
