/**
 * Training history (F38): three counts with their sample size and a strip of the last rounds. Facts over the practice
 * rounds only – no score, no P&L, no ranking, and the plain sentence when the sample is too small.
 */
import { useMemo } from "react";
import { marksOf, rateText, sampleLine, trainingStats, type TrainingRound } from "@/domain/training";
import type { Setup } from "@/domain/types";
import { cn } from "@/lib/cn";
import { TRAIN } from "./strings";

const mark = (v: boolean | null): { glyph: string; cls: string; word: string } => (v === null ? { glyph: TRAIN.markNone, cls: "text-faint", word: "nicht gewertet" } : v ? { glyph: TRAIN.markYes, cls: "text-win", word: "ja" } : { glyph: TRAIN.markNo, cls: "text-loss", word: "nein" });

export function HistoryCard({ rounds, setups, setupId }: { rounds: readonly TrainingRound[]; setups: readonly Setup[]; setupId: string | null }) {
  const stats = useMemo(() => trainingStats(rounds, setupId), [rounds, setupId]);
  const marks = useMemo(() => marksOf(setupId ? rounds.filter((r) => r.setupId === setupId) : rounds, 24), [rounds, setupId]);
  const name = setupId ? (setups.find((s) => s.id === setupId)?.name ?? setupId) : "";
  return (
    <section className="grid gap-3 rounded-2xl border border-line-2 bg-ink-950/40 p-3.5" data-testid="training-history" aria-label={TRAIN.historyTitle}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="label">{TRAIN.historyTitle}</span>
        <span className="font-mono text-[11.5px] text-faint">{TRAIN.historyScope(setupId == null, name)}</span>
      </div>
      {stats.rounds === 0 ? (
        <p className="text-[12.5px] text-mute">{TRAIN.historyEmpty}</p>
      ) : (
        <>
          <div className="grid gap-2 sm:grid-cols-3">
            <Stat label={TRAIN.hRecognition} value={rateText(stats.recognition.hit, stats.recognition.answered)} sample={sampleLine(stats.recognition.answered)} extra={stats.recognition.unsure ? TRAIN.hUnsure(stats.recognition.unsure) : undefined} testId="hist-recognition" />
            <Stat label={TRAIN.hRules} value={rateText(stats.rules.followed, stats.rules.judged)} sample={sampleLine(stats.rules.judged)} testId="hist-rules" />
            <Stat label={TRAIN.hReflection} value={rateText(stats.reflection.done, stats.reflection.rounds)} sample={sampleLine(stats.reflection.rounds)} testId="hist-reflection" />
          </div>
          <div className="grid gap-1.5">
            <span className="text-[11.5px] text-faint">{TRAIN.hStrip}</span>
            <ol className="flex flex-wrap gap-1.5" aria-label={TRAIN.hStrip}>
              {marks.map((m, i) => (
                <li key={m.id} className="flex flex-col items-center gap-px rounded-md border border-line px-1.5 py-1 font-mono text-[11px] leading-none" title={`Runde ${stats.rounds - marks.length + i + 1}: erkannt ${mark(m.recognized).word}, Regeln ${mark(m.rules).word}, Reflexion ${m.reflected ? "ja" : "nein"}`}>
                  <span className={mark(m.recognized).cls}>{mark(m.recognized).glyph}</span>
                  <span className={mark(m.rules).cls}>{mark(m.rules).glyph}</span>
                  <span className={m.reflected ? "text-win" : "text-faint"}>{m.reflected ? TRAIN.markYes : TRAIN.markNone}</span>
                </li>
              ))}
            </ol>
          </div>
          <p className="text-[11.5px] text-faint">{TRAIN.hNoteline}</p>
        </>
      )}
    </section>
  );
}

function Stat({ label, value, sample, extra, testId }: { label: string; value: string; sample: string; extra?: string; testId: string }) {
  return (
    <div className={cn("rounded-xl border border-line bg-ink-950/50 px-3 py-2")} data-testid={testId}>
      <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">{label}</div>
      <div className="num mt-0.5 font-mono text-[15px] font-medium text-fg">{value}</div>
      <div className="mt-0.5 text-[11px] text-faint">{sample}</div>
      {extra && <div className="text-[11px] text-faint">{extra}</div>}
    </div>
  );
}
