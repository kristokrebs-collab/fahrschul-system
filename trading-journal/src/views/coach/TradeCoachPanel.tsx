/**
 * Coach panel of ONE trade (P04, for the trade detail – P14 mounts `<TradeCoachPanel tradeId={id} />` inside
 * `src/overlays/TradeDetail.tsx`): the execution grade, a one-sentence verdict, plan against execution, R against the
 * plan, MAE / MFE, the rules met or broken, the entry-check and Box-zu-Box context, the behaviours this trade triggered
 * and how similar trades ended. Sections cascade in with the detail body (`StaggerItem`), the grade pops
 * (`spring.pop`). Renders nothing for an unknown id.
 */
import { motion } from "motion/react";
import { useMemo } from "react";
import { tradeReview, type ReviewLine, type ReviewSection } from "@/domain/coach";
import { cn } from "@/lib/cn";
import { pct0, r as fmtR, signed } from "@/lib/format";
import { StaggerItem } from "@/motion/Stagger";
import { spring } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { useEnriched, useJournal } from "@/store/journalStore";
import { openTrade } from "@/views/insights/ui";
import { eventsOf } from "./hooks";

const SECTION: Readonly<Record<ReviewSection, string>> = { plan: "Plan & Ausführung", excursion: "MAE / MFE", rules: "Regeln", context: "Kontext", behavior: "Verhalten" };
const ORDER: readonly ReviewSection[] = ["behavior", "plan", "rules", "excursion", "context"];
const TONE: Readonly<Record<ReviewLine["tone"], string>> = { win: "text-win", loss: "text-loss", warn: "text-warn", fg: "text-fg", mute: "text-mute" };
const GRADE_TONE: Readonly<Record<"A" | "B" | "C" | "D", string>> = { A: "text-win border-win/30", B: "text-fg border-line-2", C: "text-warn border-warn/30", D: "text-loss border-loss/30" };

export function TradeCoachPanel({ tradeId, className }: { tradeId: string; className?: string }) {
  const reduced = useReducedFx();
  const enriched = useEnriched();
  const settings = useJournal((s) => s.settings);
  const days = useJournal((s) => s.days);
  const review = useMemo(() => {
    const t = enriched.find((x) => x.id === tradeId);
    if (!t) return null;
    return tradeReview({ trade: t, all: enriched, settings, events: eventsOf(enriched, settings, days), currency: settings.currency });
  }, [enriched, settings, days, tradeId]);
  if (!review) return null;
  const sections = ORDER.map((s) => [s, review.lines.filter((l) => l.section === s)] as const).filter(([, ls]) => ls.length);
  return (
    <section className={cn("grid gap-3", className)} aria-label="Coach zu diesem Trade" data-testid="trade-coach-panel">
      <StaggerItem className="flex items-start gap-3 rounded-2xl border border-line bg-ink-950/60 p-3.5">
        {review.grade && (
          <motion.span
            className={cn("dot-num grid size-12 shrink-0 place-items-center rounded-xl border text-[26px] leading-none", GRADE_TONE[review.grade])}
            initial={reduced ? false : { scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={spring.pop}
            aria-label={`Ausführung Note ${review.grade}`}
            role="img"
          >
            {review.grade}
          </motion.span>
        )}
        <div className="grid min-w-0 gap-1">
          <span className="label">Coach</span>
          <p className={cn("text-[13.5px] leading-snug", TONE[review.verdict.tone])}>{review.verdict.text}</p>
        </div>
      </StaggerItem>
      {sections.map(([s, lines]) => (
        <StaggerItem key={s} className="grid gap-1">
          <span className="label">{SECTION[s]}</span>
          <dl className="grid">
            {lines.map((l, i) => (
              <div key={`${l.label}-${i}`} className="grid gap-0.5 border-b border-line/60 py-1.5 last:border-b-0">
                <div className="flex min-w-0 items-baseline justify-between gap-3 text-[12.5px]">
                  <dt className="shrink-0 text-mute">{l.label}</dt>
                  <dd className={cn("min-w-0 text-right font-mono [overflow-wrap:anywhere]", TONE[l.tone])}>{l.value}</dd>
                </div>
                {l.text && <p className="text-[11.5px] text-faint">{l.text}</p>}
              </div>
            ))}
          </dl>
        </StaggerItem>
      ))}
      {review.similar && (
        <StaggerItem className="grid gap-1.5 rounded-2xl border border-line bg-ink-950/40 p-3">
          <span className="label">Ähnliche Trades · {review.similar.label}</span>
          <p className="text-[12.5px] text-mute">
            {review.similar.n} Trades · <span className="text-fg">{pct0(review.similar.winRate)}</span> Win-Rate · Ø <span className="text-fg">{fmtR(review.similar.avgR)}</span> ·{" "}
            <span className={review.similar.net >= 0 ? "text-win" : "text-loss"}>
              {signed(review.similar.net, 0)} {settings.currency}
            </span>
          </p>
          <div className="flex flex-wrap gap-1.5">
            {review.similar.ids.map((id, i) => (
              <button key={id} type="button" onClick={() => openTrade(id)} className="touch-hit rounded-full border border-line-2 px-2.5 py-0.5 font-mono text-[11px] text-mute hover:text-fg">
                Trade {i + 1}
              </button>
            ))}
          </div>
        </StaggerItem>
      )}
    </section>
  );
}
