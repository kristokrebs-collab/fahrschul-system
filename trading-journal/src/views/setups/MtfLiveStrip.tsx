import { memo } from "react";
import { LOADING_TEXT, SIGNAL_TITLE, strengthText } from "@/domain/signals";
import { cn } from "@/lib/cn";
import { useSignalCheck } from "@/market";
import { StatusPill } from "@/motion/StatusPill";
import { signalTone, StrengthDots } from "@/overlays/SignalSummary";
import { navigate } from "@/store/router";
import { statusPill, verdictText } from "@/views/overview/signalView";

export const MTF_LIVE_STRINGS = {
  title: "Live-Check",
  open: SIGNAL_TITLE,
  link: "Zum Einstiegs-Check →",
  score: (score: number, tiers: number, n: number) => `Score ${score} · ${tiers} von ${n} TF`,
  aria: (text: string) => `${SIGNAL_TITLE} öffnen: ${text}`,
} as const;

/**
 * Live state of the automatic entry check on the `Multi-TF Signal` setup card (`s_mtf`, whose checklist the check
 * ticks automatically): status pill (Lädt / Live / Veraltet / Offline), the stronger side's verdict with its strength
 * dots and `Score · x von n TF`. The whole strip is one button to the overview, where the full `Einstiegs-Check` card
 * lives. Its own `useSignalCheck` subscription (≤ 1 re-render per second, only when the rounded result changes) keeps
 * the card itself from re-rendering. No live region: the toast island announces new entries.
 */
export const MtfLiveStrip = memo(function MtfLiveStrip({ className }: { className?: string }) {
  const check = useSignalCheck();
  const snap = check.snapshot;
  const best = snap?.best ?? null;
  const pill = statusPill(check.state);
  const text = best ? `${best.label} · ${strengthText(best.valid ? best.strength : 0)}` : (check.message ?? LOADING_TEXT);
  return (
    <button
      type="button"
      onClick={() => navigate("overview")}
      aria-label={MTF_LIVE_STRINGS.aria(text)}
      data-testid="mtf-live"
      data-state={check.state}
      className={cn(
        "group grid min-w-0 gap-1.5 rounded-xl border border-line bg-ink-950/50 px-3 py-2.5 text-left transition-colors duration-200 hover:border-white/25 focus-visible:border-white/40 pointer-coarse:min-h-11",
        className,
      )}
    >
      <span className="flex min-w-0 items-center justify-between gap-2">
        <span className="text-[9.5px] font-semibold uppercase tracking-[0.1em] text-faint">{MTF_LIVE_STRINGS.title}</span>
        <StatusPill tone={pill.tone} label={pill.label} expanded />
      </span>
      {best && snap ? (
        <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <span className={cn("min-w-0 text-[13px] font-semibold leading-snug [overflow-wrap:anywhere]", verdictText(best))}>{best.label}</span>
          <StrengthDots strength={best.valid ? best.strength : 0} dot={signalTone(best).dot} />
          <span className="num whitespace-nowrap font-mono text-[11.5px] text-mute">{MTF_LIVE_STRINGS.score(best.score, best.tiers, snap.cfg.ladder.length)}</span>
        </span>
      ) : (
        <span className="text-[12px] text-faint">{text}</span>
      )}
      <span className="text-[11.5px] font-medium text-mute transition-colors group-hover:text-fg">{MTF_LIVE_STRINGS.link}</span>
    </button>
  );
});
