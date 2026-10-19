/**
 * Coach page (P04, `h1 Coach`): a rule-based, evidence-first trading coach over the account view of the Hero's switch
 * (`uiStore.acc`). Everything is computed on the device from the journal – deterministic, with evidence trades,
 * minimum samples and honest confidence; the optional AI wording only rephrases computed facts.
 *
 *   Hero (12)               COACH wordmark · lesson of the week · rotating tips · trading score
 *   Chat (7) · Heute (5)    questions in German · today's trades, patterns, live alert and pause
 *   Leaks & Edges (12)      edges with confidence meters, leaks with a red sweep, what-if, evidence
 *   Plan (5) · Timeline (7) the three strongest steps (pinnable) · every detected pattern, newest first
 *   Profil (12)             Personal Trading Intelligence, the traits orbiting
 *   Signal-Posteingang (12) the signals / alerts the app raised, with a status and actions (F28)
 *   Verpasste Chancen (12)  signals of the app without a journal trade, with their outcome (F32, honest about the archive that starts empty)
 *   Signalbilanz (7) · Daten- und Alarmqualität (5)  per kind / setup / timeframe (F25) · gaps, delay, downtime (F27)
 *
 * Cells reveal once (`Reveal`, ends at `transform: none`). Registered by the integrator (P14) as page `coach`.
 */
import { useMemo, type ReactNode } from "react";
import { FeatureLinks } from "@/app/FeatureLinks";
import { ACCOUNT_LABELS } from "@/domain/defaults";
import { COACH_HIGHLIGHT, COACH_LEAD, COACH_TITLE } from "@/domain/coach";
import type { AnswerData } from "@/domain/coach/nlq";
import { cn } from "@/lib/cn";
import { useCloseMorphDialogOnUnmount } from "@/motion/MorphDialog";
import { Reveal } from "@/motion/Reveal";
import { Segmented } from "@/primitives/Segmented";
import { storageKey } from "@/store/storage";
import { useUi, type AccFilter } from "@/store/uiStore";
import { SEG_TOUCH } from "@/views/insights/ui";
import { PageHeader } from "@/views/setups/PageHeader";
import { ChatCard } from "./ChatCard";
import { DataQualityCard } from "./DataQualityCard";
import { MissedCard } from "./MissedCard";
import { EdgesCard } from "./EdgesCard";
import { HeroCard } from "./HeroCard";
import { useCoach } from "./hooks";
import { PlanCard } from "./PlanCard";
import { ProfileCard } from "./ProfileCard";
import { SignalBalanceCard } from "./SignalBalanceCard";
import { SignalInboxCard } from "./SignalInboxCard";
import { TimelineCard } from "./TimelineCard";
import { TodayCard } from "./TodayCard";

export const COACH_LEAD_FILL = { storageKey: storageKey("fill-coach"), highlight: COACH_HIGHLIGHT } as const;
const ACC_OPTIONS = (["all", "makro", "scalp"] as const).map((v) => ({ v, label: ACCOUNT_LABELS[v] }));

function Cell({ index, span, children }: { index: number; span: string; children: ReactNode }) {
  return (
    <Reveal index={index} className={cn("flex min-w-0 flex-col [&>*]:flex-1", span)}>
      {children}
    </Reveal>
  );
}

export function CoachView({ className }: { className?: string }) {
  const c = useCoach();
  const setAcc = useUi((s) => s.setAcc);
  useCloseMorphDialogOnUnmount();
  const { view, settings, events, now } = c;
  const data: AnswerData = useMemo(() => ({ closed: view.closed, settings, events, now, currency: settings.currency, start: view.start }), [view, settings, events, now]);
  const byId = useMemo(() => new Map(view.list.map((t) => [t.id, t])), [view.list]);
  return (
    <div className={cn("grid grid-cols-1 gap-5 lg:grid-cols-12", className)} data-testid="coach-view" data-n={view.closed.length}>
      <PageHeader
        className="lg:col-span-12"
        title={COACH_TITLE}
        lead={COACH_LEAD}
        leadFill={COACH_LEAD_FILL}
        action={<Segmented<AccFilter> aria-label="Konto des Coachs" options={ACC_OPTIONS} value={c.acc} onChange={setAcc} size="sm" className={SEG_TOUCH} />}
      />
      {/* related functions that are otherwise found by chance: a card at the bottom of this page, the sheets of a trade */}
      <FeatureLinks
        className="lg:col-span-12"
        items={[
          { id: "verpasste-chancen", label: "Verpasste Chancen" },
          { id: "ueben", label: "Üben" },
          { id: "was-waere-wenn", label: "Was wäre wenn" },
        ]}
      />
      <Cell index={0} span="lg:col-span-12">
        <HeroCard lesson={c.lesson} tips={c.tips} score={c.score} />
      </Cell>
      <Cell index={0} span="lg:col-span-7">
        <ChatCard data={data} enriched={view.list} aiNotes={c.prefs.aiNotes} />
      </Cell>
      <Cell index={1} span="lg:col-span-5">
        <TodayCard list={view.list} events={events} plan={c.plan} cur={c.cur} now={now} />
      </Cell>
      <Cell index={0} span="lg:col-span-12">
        <EdgesCard edges={c.edges} closed={view.closed} cur={c.cur} />
      </Cell>
      <Cell index={0} span="lg:col-span-5">
        <PlanCard plan={c.plan} list={view.list} events={events} settings={settings} now={now} />
      </Cell>
      <Cell index={1} span="lg:col-span-7">
        <TimelineCard events={events} trades={byId} />
      </Cell>
      <Cell index={0} span="lg:col-span-12">
        <ProfileCard profile={c.profile} />
      </Cell>
      <Cell index={0} span="lg:col-span-12">
        <SignalInboxCard list={view.list} now={now} />
      </Cell>
      <Cell index={0} span="lg:col-span-12">
        <MissedCard list={view.list} now={now} />
      </Cell>
      <Cell index={0} span="lg:col-span-7">
        <SignalBalanceCard list={view.list} now={now} />
      </Cell>
      <Cell index={1} span="lg:col-span-5">
        <DataQualityCard now={now} />
      </Cell>
    </div>
  );
}
