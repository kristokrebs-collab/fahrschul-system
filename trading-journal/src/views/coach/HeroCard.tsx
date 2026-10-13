/**
 * Coach hero (P04): the personal trading score as the hero numeral (Doto in the size of Analyse's Sharpe, `NumberCascade`
 * once in view; the page's `h1` already says „Coach“, so no wordmark repeats it – P1-10), the lesson of the week as the
 * headline (once per session a pixel ember fills it – `PixelTextFill` – then the key word gets the red marker,
 * `TactileHighlight tab={false}`), rotating short tips (`TextMorph cycle`) and the score's four parts (bars growing on
 * `spring.enter`). Reduced motion: everything in its final state.
 */
import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import type { TradingScore, WeeklyLesson } from "@/domain/coach";
import { cn } from "@/lib/cn";
import { NumberCascade } from "@/motion/fx/NumberCascade";
import { useFirstInView } from "@/motion/inView";
import { PixelTextFill } from "@/motion/pulse/PixelTextFill";
import { TactileHighlight } from "@/motion/pulse/TactileHighlight";
import { TextMorph } from "@/motion/pulse/TextMorph";
import { spring, stagger } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Card } from "@/primitives/Card";
import { storageKey } from "@/store/storage";
import { hashSeed } from "@/domain/coach";

const seenLesson = (key: string): boolean => {
  try {
    return sessionStorage.getItem(key) !== null;
  } catch {
    return true;
  }
};
const markLesson = (key: string): void => {
  try {
    sessionStorage.setItem(key, "1");
  } catch {
    // blocked storage: the fill plays again next time
  }
};

/** One lesson line with the marker on the key word (when the line contains it). */
function LessonLine({ line, highlight, active }: { line: string; highlight: string; active: boolean | undefined }) {
  const at = highlight ? line.indexOf(highlight) : -1;
  if (at < 0) return <span className="block">{line}</span>;
  return (
    <span className="block">
      {line.slice(0, at)}
      <TactileHighlight tone="signal" tab={false} active={active} padX={0.08} className="-mx-[0.08em]">
        {highlight}
      </TactileHighlight>
      {line.slice(at + highlight.length)}
    </span>
  );
}

/** The lesson of the week: pixel fill once per session and lesson, then the marker. */
export function Lesson({ lesson, className }: { lesson: WeeklyLesson; className?: string }) {
  const reduced = useReducedFx();
  const key = storageKey(`coach-lesson-${hashSeed(lesson.lines.join("|"))}`);
  const ref = useRef<HTMLDivElement>(null);
  const seen = useFirstInView(ref, !reduced);
  const [phase, setPhase] = useState<"fill" | "marker" | "static">(() => (!reduced && !seenLesson(key) ? "fill" : "static"));
  useEffect(() => {
    if (phase === "fill" && seen) markLesson(key);
  }, [phase, seen, key]);
  const text = "text-[clamp(20px,5.6vw,30px)] font-semibold leading-[1.12] tracking-[-0.025em] text-fg";
  return (
    <div ref={ref} className={className} data-testid="coach-lesson" data-source={lesson.source}>
      <span className="label">{lesson.source === "data" ? "Lektion der Woche · aus deinem Journal" : "Lektion der Woche · Grundsatz"}</span>
      <div className="mt-2 [text-wrap:balance]">
        {phase === "fill" && !reduced ? (
          <PixelTextFill as="p" lines={lesson.lines} playOnMount={false} play={seen} onDone={() => setPhase("marker")} className={text} />
        ) : (
          <p className={text}>
            {lesson.lines.map((l, i) => (
              <LessonLine key={i} line={l} highlight={lesson.highlight} active={phase === "marker" ? true : undefined} />
            ))}
          </p>
        )}
      </div>
    </div>
  );
}

const PART_TONE = (v: number | null) => (v == null ? "bg-white/15" : v >= 70 ? "bg-win/80" : v >= 45 ? "bg-white/60" : "bg-loss/75");

const SCORE_TONE = (v: number | null) => (v == null ? "text-faint" : v >= 75 ? "text-win" : v >= 45 ? "text-fg" : "text-loss");
const LABEL_TONE = (l: TradingScore["label"]) => (l === "Stark" ? "border-win/30 text-win" : l === "Kritisch" ? "border-loss/30 text-loss" : "border-line-2 text-mute");

/** The trading score as the hero's one big number (cascades in), the unit muted in Plex Sans, the verdict as a pill. */
export function ScoreHero({ score, className }: { score: TradingScore; className?: string }) {
  const num = "dot-num text-[clamp(56px,13vw,96px)] leading-none";
  return (
    <div className={cn("grid min-w-0 gap-2", className)} data-testid="coach-score">
      <div className="flex flex-wrap items-center gap-3">
        <span className="label">Trading-Score</span>
        <span className={cn("rounded-full border px-2.5 py-0.5 font-mono text-[11px] tracking-wide", LABEL_TONE(score.label))}>{score.label}</span>
      </div>
      {/* the profile headline lives in „Dein Profil“ only (it stood here, in the orbit and above the table – P2-07) */}
      <span className="flex items-baseline gap-2">
        {score.score == null ? <span className={cn(num, "text-faint")}>–</span> : <NumberCascade value={score.score} decimals={0} className={cn(num, SCORE_TONE(score.score))} />}
        <span className="font-sans text-lg font-medium text-mute">/ 100</span>
      </span>
    </div>
  );
}

/** What the score is made of: the four parts grow once in view, the biggest lever below. */
export function ScoreParts({ score, className }: { score: TradingScore; className?: string }) {
  const reduced = useReducedFx();
  const ref = useRef<HTMLDivElement>(null);
  const seen = useFirstInView(ref, !reduced);
  const on = seen || reduced;
  return (
    <div ref={ref} className={cn("grid content-start gap-3", className)} data-testid="coach-score-parts">
      <span className="label">Teile des Scores</span>
      <ul className="grid gap-2" aria-label="Teile des Scores">
        {score.parts.map((p, i) => (
          <li key={p.key} className="grid gap-1">
            <div className="flex items-baseline justify-between gap-2 text-[12px]">
              <span className="text-mute">
                {p.label}
                <span className="ml-1.5 text-[10.5px] text-faint">{Math.round(p.weight * 100)} %</span>
              </span>
              <span className="num font-mono text-fg">{p.value == null ? "–" : p.value}</span>
            </div>
            <span aria-hidden="true" className="relative h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
              <motion.span
                className={cn("absolute inset-y-0 left-0 rounded-full", PART_TONE(p.value))}
                style={{ width: `${p.value ?? 0}%`, originX: 0 }}
                initial={reduced ? false : { scaleX: 0 }}
                animate={{ scaleX: on ? 1 : 0 }}
                transition={{ ...spring.enter, delay: reduced ? 0 : stagger.lead + Math.min(i, stagger.max) * stagger.reveal }}
              />
            </span>
            <span className="text-[10.5px] text-faint">{p.detail}</span>
          </li>
        ))}
      </ul>
      {score.weakest && (
        <p className="text-[12px] text-mute">
          Größter Hebel: <span className="text-fg">{score.weakest.label}</span>
        </p>
      )}
    </div>
  );
}

export function HeroCard({ lesson, tips, score, className }: { lesson: WeeklyLesson; tips: readonly string[]; score: TradingScore; className?: string }) {
  return (
    <Card className={className} data-testid="coach-hero" innerClassName="!p-0">
      <div className="grid gap-6 p-5 sm:p-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] lg:gap-10">
        <div className="grid min-w-0 content-start gap-5">
          <ScoreHero score={score} />
          <Lesson lesson={lesson} />
          {tips.length > 0 && (
            <div className="flex min-w-0 items-center gap-2.5 border-t border-line pt-3.5">
              <span className="label shrink-0">Tipp</span>
              <span className="min-w-0 text-[13.5px] text-fg" data-testid="coach-tips">
                <span className="sr-only">{tips.join(" · ")}</span>
                <span aria-hidden="true">
                  <TextMorph cycle={[...tips]} />
                </span>
              </span>
            </div>
          )}
        </div>
        <ScoreParts score={score} className="border-t border-line pt-5 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0" />
      </div>
    </Card>
  );
}
