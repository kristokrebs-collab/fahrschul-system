/**
 * Emotion diary (P08) as a `ScrubTimeline`: one row per day with something to say (check-in, notes, trades with their
 * psyche, patterns), a bar per day tinted by the feeling of the day (calm / tense / neutral). Scrubbing or "Abspielen"
 * walks the days; the entry under the playhead opens below (React state changes only when the DAY changes – the
 * timeline itself never re-renders per frame).
 */
import { AnimatePresence, motion, useMotionValue, useMotionValueEvent } from "motion/react";
import { useState } from "react";
import { BEHAVIOR_LABEL, type BehaviorKey } from "@/domain/coach/events";
import { diarySummary, emotionTone, MOOD_LABELS, type DiaryDay } from "@/domain/psych";
import { cn } from "@/lib/cn";
import { r as fmtR } from "@/lib/format";
import { ScrubTimeline, type ScrubSpan } from "@/motion/pulse/ScrubTimeline";
import { spring, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { useMediaQuery } from "@/motion/useMediaQuery";
import { Card } from "@/primitives/Card";
import { useUi } from "@/store/uiStore";
import { WACHSTUM } from "./strings";
import { MoodGlyph } from "./ui";

export const DIARY_ROWS = 10;

const toneOf = (d: DiaryDay): ScrubSpan["tone"] => (d.feel == null ? "mute" : d.feel > 0.2 ? "win" : d.feel < -0.2 ? "loss" : "fg");

function Entry({ d }: { d: DiaryDay }) {
  const openDetail = useUi((s) => s.openDetail);
  return (
    <div className="grid gap-3" data-testid="diary-entry" data-day={d.key}>
      <div className="flex items-center gap-3">
        <div className="grid size-12 shrink-0 place-items-center rounded-xl border border-line bg-ink-950/60">
          <MoodGlyph mood={d.mood} size={3} />
        </div>
        <div className="grid min-w-0 gap-0.5">
          <span className="text-[13.5px] font-semibold">{d.label}</span>
          <span className="truncate text-[11.5px] text-mute">{diarySummary(d, MOOD_LABELS) || "Kein Check-in"}</span>
        </div>
      </div>
      {d.checkin && d.checkin.emotions.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {d.checkin.emotions.map((w) => (
            <li key={w} className={cn("rounded-full border px-2 py-0.5 text-[11px]", emotionTone(w) === "neg" ? "border-signal/50" : emotionTone(w) === "pos" ? "border-win/40" : "border-line-2 text-mute")}>
              {w}
            </li>
          ))}
        </ul>
      )}
      {[
        ["Plan", d.plan],
        ["Notiz", d.note],
        ["Review", d.review],
      ]
        .filter(([, t]) => t)
        .map(([l, t]) => (
          <p key={l} className="text-[12.5px] leading-relaxed text-fg">
            <span className="label mr-2 !text-[9.5px]">{l}</span>
            {t}
          </p>
        ))}
      {d.trades.length > 0 && (
        <ul className="grid gap-1.5">
          {d.trades.map((t) => (
            <li key={t.id}>
              <button type="button" onClick={() => openDetail(t.id, "insights")} className="grid w-full gap-0.5 rounded-xl border border-line px-3 py-2 text-left transition-colors hover:border-white/30">
                <span className="flex items-center justify-between gap-2 text-[12px]">
                  <span className="font-medium">
                    {t.pair} · {t.side === "long" ? "Long" : "Short"}
                  </span>
                  <span className={cn("num font-mono", t.result === "win" ? "text-win" : t.result === "loss" ? "text-loss" : "text-mute")}>{t.r != null ? fmtR(t.r) : t.result === "open" ? "offen" : "–"}</span>
                </span>
                {(t.preNote || t.postNote) && <span className="text-[11.5px] leading-snug text-mute">{[t.preNote && `Vorher: ${t.preNote}`, t.postNote && `Nachher: ${t.postNote}`].filter(Boolean).join(" · ")}</span>}
                {t.flags.length > 0 && <span className="text-[10.5px] text-faint">{t.flags.map((f) => BEHAVIOR_LABEL[f as BehaviorKey] ?? f).join(", ")}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {d.patterns.length > 0 && <p className="text-[11.5px] text-signal">Muster: {d.patterns.join(", ")}</p>}
    </div>
  );
}

function Timeline({ shown }: { shown: readonly DiaryDay[] }) {
  const reduced = useReducedFx();
  const wide = useMediaQuery("(min-width: 640px)", true);
  const total = shown.length;
  const time = useMotionValue(total);
  const [idx, setIdx] = useState(total - 1);
  useMotionValueEvent(time, "change", (t) => {
    const i = Math.max(0, Math.min(total - 1, Math.ceil(t) - 1));
    if (i !== idx) setIdx(i);
  });
  const spans: ScrubSpan[] = shown.map((d, i) => ({ id: d.key, label: d.label, start: i, duration: 1, tone: toneOf(d), meta: d.mood ? MOOD_LABELS[d.mood - 1] : d.trades.length ? `${d.trades.length} Trade${d.trades.length === 1 ? "" : "s"}` : undefined }));
  const cur = shown[Math.max(0, Math.min(total - 1, idx))];
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
      <ScrubTimeline
        label="Tagebuch durchblättern"
        title="Tag für Tag"
        total={total}
        spans={spans}
        time={time}
        playSeconds={Math.max(3, total * 0.6)}
        step={1}
        bigStep={3}
        formatTime={(t) => shown[Math.max(0, Math.min(total - 1, Math.ceil(t) - 1))]?.label ?? ""}
        labelWidth={wide ? 96 : 64}
        rowHeight={26}
      />
      <div className="min-w-0 rounded-2xl border border-line bg-ink-950/40 p-4">
        <AnimatePresence mode="wait" initial={false}>
          {cur && (
            <motion.div key={cur.key} initial={reduced ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0, transitionEnd: { transform: "none" } }} exit={{ opacity: 0, transition: tween.exit }} transition={spring.enter}>
              <Entry d={cur} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

export function DiaryCard({ days, className }: { days: readonly DiaryDay[]; className?: string }) {
  const shown = days.slice(-DIARY_ROWS);
  const total = shown.length;
  return (
    <Card title={WACHSTUM.psyche.diary} note={total ? `Die letzten ${total} Einträge · ziehen oder abspielen` : undefined} className={className} data-testid="growth-diary" data-n={total}>
      {total === 0 ? (
        <p className="text-[12.5px] leading-relaxed text-mute">{WACHSTUM.psyche.diaryEmpty}</p>
      ) : (
        // a new entry starts a fresh timeline (playhead on the newest day)
        <Timeline key={`${total}:${shown[total - 1]!.key}`} shown={shown} />
      )}
    </Card>
  );
}
