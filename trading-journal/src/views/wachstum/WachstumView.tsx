/**
 * Wachstum page (P08, `h1 Wachstum`): psychology made measurable and progress steered to the PROCESS – discipline,
 * journaling, rule-keeping, routines – never to P&L or a trade count. The whole journal (no account switch: this is
 * about the person); a goal narrows itself with its scope. Sections (lg, 12 columns):
 *   Heute                       CheckInCard (5) · PreTradeCheck (7)
 *   Serien                      StreakBoard (12)
 *   Ziele                       GoalsCard (12)
 *   Challenges & Gewohnheiten   ChallengeCard (5) · HabitGrid (7)
 *   Psyche                      TrackersCard (7) · MoodCard (5) · CheckInInsights (12) · DiaryCard (12)
 *   Fortschritt                 SkillRadar (5) · BestsCard (7) · ProgressCard (12)
 * Every cell reveals once (`Reveal`, ends at `transform: none`), section titles rise letter by letter. The sheets
 * (check-in, goal, post-trade review) and the "Ziel erreicht" wipe are mounted here; the review sheet only once even
 * when the app host (`PostTradeReviewHost`, P14) is mounted too. Registered by the integrator (P14) as page `wachstum`.
 */
import { useId, useMemo } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";
import { useCloseMorphDialogOnUnmount } from "@/motion/MorphDialog";
import { useMediaQuery } from "@/motion/useMediaQuery";
import { Button } from "@/primitives/Button";
import { SectionNav, type SectionNavItem } from "@/primitives/SectionNav";
import { storageKey } from "@/store/storage";
import { AnalysisNote } from "@/ui/AnalysisNote";
import { PageHeader } from "@/views/setups/PageHeader";
import { BestsCard } from "./BestsCard";
import { ChallengeCard } from "./ChallengeCard";
import { CheckInCard } from "./CheckInCard";
import { CheckInInsights } from "./CheckInInsights";
import { CheckInSheet } from "./CheckInSheet";
import { DiaryCard } from "./DiaryCard";
import { GoalsCard } from "./GoalCard";
import { GoalSheet } from "./GoalSheet";
import { useGrowthUi } from "./growthStore";
import { HabitGrid } from "./HabitGrid";
import { useBests, useChallenges, useDeck, useDiary, useFactors, useGoals, useGrowthBase, useHabits, useSeries, useSkills, useStreaks, useToday, useTrackers } from "./hooks";
import { MoodCard } from "./MoodCard";
import { PostTradeReviewSheet } from "./PostTradeReview";
import { PreTradeCheck } from "./PreTradeCheck";
import { ProgressCard } from "./ProgressCard";
import { SkillRadar } from "./SkillRadar";
import { StreakBoard } from "./StreakBadge";
import { WACHSTUM } from "./strings";
import { TrackersCard } from "./TrackersCard";
import { GoalWipe, useGrowthTransitions } from "./transitions";
import { Cell, Section } from "./ui";

/** The sections of the page, for its "Inhalt" strip (`data-section` on each section title). */
const NAV: readonly SectionNavItem[] = [
  { id: "today", label: WACHSTUM.sections.today.title },
  { id: "streaks", label: WACHSTUM.sections.streaks.title },
  { id: "goals", label: WACHSTUM.sections.goals.title },
  { id: "routines", label: WACHSTUM.sections.routines.title },
  { id: "psyche", label: WACHSTUM.sections.psyche.title },
  { id: "progress", label: WACHSTUM.sections.progress.title },
];

export const WACHSTUM_LEAD_FILL = { storageKey: storageKey("fill-wachstum"), highlight: WACHSTUM.highlight } as const;

export function WachstumView({ className }: { className?: string }) {
  const b = useGrowthBase();
  const today = useToday(b);
  const streaks = useStreaks(b);
  const goals = useGoals(b);
  const challenges = useChallenges(b);
  const trackers = useTrackers(b);
  const checkinStreak = streaks.find((s) => s.key === "checkin")?.current ?? 0;
  const deck = useDeck(b, trackers, checkinStreak);
  const wide = useMediaQuery("(min-width: 640px)", true);
  const habits = useHabits(b, wide ? 5 : 3);
  const factors = useFactors(b);
  const diary = useDiary(b);
  const skills = useSkills(b);
  const bests = useBests(b, streaks);
  const series = useSeries(b);
  const openCheckin = useGrowthUi((s) => s.openCheckin);
  const doneChallenges = useMemo(() => b.prefs.challenges.filter((c) => c.status === "done").sort((a, z) => (z.endedAt ?? "").localeCompare(a.endedAt ?? "")).map((c) => c.title), [b.prefs.challenges]);
  const existingHabits = useMemo(() => b.prefs.habits.filter((h) => !h.archived).map((h) => h.id), [b.prefs.habits]);
  useGrowthTransitions(goals.active, challenges);
  useCloseMorphDialogOnUnmount();

  const ids = { today: useId(), streaks: useId(), goals: useId(), routines: useId(), psyche: useId(), progress: useId() };
  const S = WACHSTUM.sections;
  const has = !!today.checkin || today.mood != null;
  return (
    <div className={cn("grid grid-cols-1 gap-5 lg:grid-cols-12", className)} data-testid="wachstum-view" data-n={b.p.closed.length}>
      <PageHeader
        className="lg:col-span-12"
        title={WACHSTUM.title}
        lead={WACHSTUM.lead}
        leadFill={WACHSTUM_LEAD_FILL}
        action={
          <Button onClick={() => openCheckin(today.key)} data-testid="wachstum-checkin">
            {has ? WACHSTUM.checkin.ctaEdit : WACHSTUM.checkin.cta}
          </Button>
        }
      />
      <SectionNav items={NAV} className="lg:col-span-12" />
      <Section id={ids.today} section="today" title={S.today.title} sub={S.today.sub}>
        <Cell index={0} span="lg:col-span-5">
          <CheckInCard today={today} />
        </Cell>
        <Cell index={1} span="lg:col-span-7">
          <PreTradeCheck checkin={today.checkin} mood={today.mood} events={b.events} todayKey={today.key} />
        </Cell>
      </Section>
      <Section id={ids.streaks} section="streaks" title={S.streaks.title} sub={S.streaks.sub}>
        <Cell index={0} span="lg:col-span-12">
          <StreakBoard streaks={streaks} />
        </Cell>
      </Section>
      <Section id={ids.goals} section="goals" title={S.goals.title} sub={S.goals.sub}>
        <Cell index={0} span="lg:col-span-12">
          <GoalsCard goals={goals.active} week={goals.week} />
        </Cell>
      </Section>
      <Section id={ids.routines} section="routines" title={S.routines.title} sub={S.routines.sub}>
        <Cell index={0} span="lg:col-span-5">
          <ChallengeCard running={challenges} suggestions={deck} todayKey={today.key} done={doneChallenges} />
        </Cell>
        <Cell index={1} span="lg:col-span-7">
          <HabitGrid rows={habits.rows} columns={habits.columns} todayKey={today.key} existing={existingHabits} />
        </Cell>
      </Section>
      <Section id={ids.psyche} section="psyche" title={S.psyche.title} sub={S.psyche.sub}>
        <Cell index={0} span="lg:col-span-7">
          <TrackersCard trackers={trackers} />
        </Cell>
        <Cell index={1} span="lg:col-span-5">
          <MoodCard factors={factors} cur={b.settings.currency} />
        </Cell>
        <Cell index={0} span="lg:col-span-12">
          <CheckInInsights days={b.days} trades={b.enriched} settings={b.settings} />
        </Cell>
        <Cell index={0} span="lg:col-span-12">
          <DiaryCard days={diary} />
        </Cell>
      </Section>
      <Section id={ids.progress} section="progress" title={S.progress.title} sub={S.progress.sub}>
        <Cell index={0} span="lg:col-span-5">
          <SkillRadar now={skills.now} before={skills.before} />
        </Cell>
        <Cell index={1} span="lg:col-span-7">
          <BestsCard bests={bests.bests} next={bests.next} />
        </Cell>
        <Cell index={0} span="lg:col-span-12">
          <ProgressCard points={series} />
        </Cell>
      </Section>
      <AnalysisNote lead="Auswertung deiner Einträge und Trades – Beobachtungen, keine Prognose." />
      {/* the overlays live outside the page's subtree (transformed while it enters): fixed layers need the viewport */}
      {typeof document !== "undefined" &&
        createPortal(
          <div data-layer="wachstum-overlays">
            <CheckInSheet />
            <GoalSheet />
            <PostTradeReviewSheet />
            <GoalWipe />
          </div>,
          document.body,
        )}
    </div>
  );
}
