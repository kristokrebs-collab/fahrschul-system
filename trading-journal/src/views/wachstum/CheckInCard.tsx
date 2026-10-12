/**
 * "Heute" (P08): today's check-in at a glance – the mood glyph, stress / energy / sleep as small dot meters, the
 * words – with the button into the check-in sheet, and the open reviews (closed trades of the last 14 days without a
 * review) with "Jetzt reviewen" (the post-trade review sheet, newest first).
 */
import { motion } from "motion/react";
import { emotionTone, ENERGY_LABELS, MOOD_LABELS, STRESS_LABELS } from "@/domain/psych";
import { cn } from "@/lib/cn";
import { RollingDigits } from "@/motion/RollingDigits";
import { spring, stagger } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Button } from "@/primitives/Button";
import { Card } from "@/primitives/Card";
import { useGrowthUi } from "./growthStore";
import type { TodayState } from "./hooks";
import { WACHSTUM } from "./strings";
import { MoodGlyph } from "./ui";

const C = WACHSTUM.checkin;

/** Five dots, the first `value` lit – they pop in one after another. */
function Dots5({ value, tone, label }: { value: number | null; tone: "fg" | "loss" | "win"; label: string }) {
  const reduced = useReducedFx();
  const fill = tone === "loss" ? "bg-loss" : tone === "win" ? "bg-win" : "bg-fg";
  return (
    <span className="flex gap-1" role="img" aria-label={label}>
      {[1, 2, 3, 4, 5].map((n, i) => (
        <motion.span
          key={n}
          className={cn("size-2 rounded-full", value != null && n <= value ? fill : "bg-white/10")}
          initial={reduced ? false : { scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ ...spring.pop, delay: reduced ? 0 : i * stagger.rows }}
        />
      ))}
    </span>
  );
}

const WD = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"] as const;

/** The last seven days as mood glyph tiles (oldest left, today ringed); they rise one after another on mount. */
function WeekStrip({ week, todayKey }: { week: TodayState["week"]; todayKey: string }) {
  const reduced = useReducedFx();
  const n = week.filter((d) => d.checked).length;
  return (
    <div className="grid gap-2">
      <div className="flex items-baseline justify-between text-[11px]">
        <span className="label !text-[10px]">Letzte 7 Tage</span>
        <span className="num text-faint">{n}/7 eingecheckt</span>
      </div>
      <ol className="grid grid-cols-7 gap-1.5" aria-label={`Stimmung der letzten 7 Tage, ${n} von 7 eingecheckt`} data-testid="checkin-week">
        {week.map((d, i) => {
          const wd = WD[new Date(`${d.key}T12:00`).getDay()]!;
          return (
            <motion.li
              key={d.key}
              className={cn("grid justify-items-center gap-1 rounded-xl border py-2", d.key === todayKey ? "border-white/35" : "border-line", d.checked ? "bg-white/[0.03]" : "")}
              initial={reduced ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0, transitionEnd: { transform: "none" } }}
              transition={{ ...spring.enter, delay: reduced ? 0 : i * stagger.rows * 2 }}
              aria-label={`${wd}: ${d.mood ? MOOD_LABELS[d.mood - 1] : d.checked ? "Check-in" : "kein Check-in"}`}
            >
              <MoodGlyph mood={d.mood} size={2} />
              <span className={cn("text-[10px]", d.key === todayKey ? "text-fg" : "text-faint")}>{wd}</span>
            </motion.li>
          );
        })}
      </ol>
    </div>
  );
}

export function CheckInCard({ today }: { today: TodayState }) {
  const openCheckin = useGrowthUi((s) => s.openCheckin);
  const openReview = useGrowthUi((s) => s.openReview);
  const { checkin: c, mood, unreviewed } = today;
  const has = !!c || mood != null;
  return (
    <Card title="Check-in" note={has ? "Heute eingecheckt" : undefined} data-testid="growth-checkin" data-has={has ? "1" : "0"}>
      <div className="grid gap-4">
        <div className="flex items-center gap-4">
          <div className="grid size-[78px] shrink-0 place-items-center rounded-2xl border border-line bg-ink-950/60">
            <MoodGlyph mood={mood} size={6} label={mood ? `Stimmung: ${MOOD_LABELS[mood - 1]}` : "Noch keine Stimmung"} />
          </div>
          <div className="grid min-w-0 flex-1 gap-1.5">
            {has ? (
              <>
                <span className="text-[15px] font-semibold">{mood ? MOOD_LABELS[mood - 1] : "Stimmung offen"}</span>
                <div className="grid gap-1 text-[11.5px] text-mute">
                  <span className="flex items-center justify-between gap-2">
                    Stress <Dots5 value={c?.stress ?? null} tone={(c?.stress ?? 0) >= 4 ? "loss" : "fg"} label={c?.stress ? `Stress: ${STRESS_LABELS[c.stress - 1]}` : "Stress nicht gesetzt"} />
                  </span>
                  <span className="flex items-center justify-between gap-2">
                    Energie <Dots5 value={c?.energy ?? null} tone="win" label={c?.energy ? `Energie: ${ENERGY_LABELS[c.energy - 1]}` : "Energie nicht gesetzt"} />
                  </span>
                  <span className="flex items-center justify-between gap-2">
                    Schlaf <span className="num font-mono text-fg">{c?.sleep != null ? `${String(c.sleep).replace(".", ",")} h` : "–"}</span>
                  </span>
                </div>
              </>
            ) : (
              <p className="text-[13px] leading-relaxed text-mute">{C.empty}</p>
            )}
          </div>
        </div>
        {c && c.emotions.length > 0 && (
          <ul className="flex flex-wrap gap-1.5" aria-label="Gefühle heute">
            {c.emotions.map((w) => (
              <li key={w} className={cn("rounded-full border px-2.5 py-1 text-[11.5px]", emotionTone(w) === "neg" ? "border-signal/50 text-fg" : emotionTone(w) === "pos" ? "border-win/40 text-fg" : "border-line-2 text-mute")}>
                {w}
              </li>
            ))}
          </ul>
        )}
        <WeekStrip week={today.week} todayKey={today.key} />
        <Button variant={has ? "ghost" : "primary"} onClick={() => openCheckin(today.key)} data-testid="growth-checkin-open">
          {has ? C.ctaEdit : C.cta}
        </Button>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3" data-testid="growth-reviews" data-open={unreviewed.length}>
          {unreviewed.length ? (
            <>
              <span className="flex items-center gap-2 text-[12.5px]">
                <RollingDigits value={unreviewed.length} className="dot-num text-[18px] text-signal" aria-label={WACHSTUM.review.open(unreviewed.length)} />
                <span className="text-mute">{unreviewed.length === 1 ? "Trade ohne Review" : "Trades ohne Review"}</span>
              </span>
              <Button size="sm" onClick={() => openReview(unreviewed[0]!.id)} data-testid="growth-review-open">
                {WACHSTUM.review.openCta}
              </Button>
            </>
          ) : (
            <span className="text-[12px] text-faint">{WACHSTUM.review.none}</span>
          )}
        </div>
      </div>
    </Card>
  );
}
