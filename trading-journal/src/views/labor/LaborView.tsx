/**
 * Labor page (P07, `h1 Labor`): honest backtests on real Binance history.
 *   Versuchsaufbau  ConfigCard (7, with "Eigene Idee" 8) · AssumptionsCard (5, 4)
 *   Lauf            RunCard (7) · TradesCard (5)
 *   Diagnose        DiagnosisCard (12)                                                        (after a run)
 *   Passt zu dir?   FitCard (12): the run against the journal (F49)                        (after a run, lazy)
 *   Belastung …     ExtrasSection (12): stress scenarios, Prüfbericht, filter comparison      (after a run, lazy)
 *   Forward-Test    ForwardSection (12): virtual accounts on new closed candles                (always, lazy chunk; F23)
 *   Optimierer      EvolveSection: improves strategies in the background, proposals only (lazy chunk; always)
 *   Robustheit      OverfitCard (5) · OosCard (7) · WalkForwardCard (7) · HeatmapCard (5)     (after a run)
 *   Vergleich       CompareRunsCard (8) · ReferenceCard (4)                                   (after a run)
 *   TradingView     AdapterStatusCard (6) · TvCompareCard (6)                                 (lazy chunk, always; F14)
 *   Versionen …     VersionsCard · PlaybookCard (DraftsSection, 12)                            (lazy chunk, always; F15 / F13 / F45)
 *   Muster-Entdecker DiscoverySection (12): patterns of a backtest / the journal vs. chance        (lazy chunk, always; Auftrag B)
 *   Zeitmaschine    TimeMachineSection (12): a hand-typed plan played through 10 000 simulated sessions and every earlier occasion (lazy chunk, always)
 * Above the set-up, when an idea came from the journal ("Diese Idee testen", F12): IdeaCard (12).
 * Every cell reveals once (`Reveal`, ends at `transform: none`), section titles rise letter by letter. The replay
 * sheet of a backtest trade is mounted here (`LabReplayHost`). Registered by the integrator (P14) as page `labor`.
 */
import { lazy, Suspense, useId, useMemo, type ReactNode } from "react";
import { sanitizeSignalCfg } from "@/domain/signals";
import { cn } from "@/lib/cn";
import { SectionNav, type SectionNavItem } from "@/primitives/SectionNav";
import { storageKey } from "@/store/storage";
import { useJournal } from "@/store/journalStore";
import { AnalysisNote } from "@/ui/AnalysisNote";
import { PendingBlock } from "@/ui/PendingCard";
import { PageHeader } from "@/views/setups/PageHeader";
import { ConfigCard } from "./ConfigCard";
import { DiagnosisCard } from "./DiagnosisCard";
import { IdeaCard } from "./IdeaCard";
import { LabReplayHost } from "./LabReplay";
import { LibraryHost } from "./LibraryHost";
import { useLabor } from "./laborStore";
import { HeatmapCard, OosCard, OverfitCard, WalkForwardCard } from "./RobustCards";
import { RunCard } from "./RunCard";
import { AssumptionsCard, CompareRunsCard, ReferenceCard } from "./SideCards";
import { LABOR } from "./strings";
import { TradesCard } from "./TradesCard";
import { Cell, SectionTitle } from "./ui";
import { DRAFTS } from "./draftStrings";
import { FORWARD } from "./forward/strings";
import { EVOLVE } from "@/views/evolve/strings";

/** F20 / F18 / F17: its own chunk, fetched only when a finished run is on the page. */
const ExtrasSection = lazy(() => import("./ExtrasSection"));
/** F49: „Passt zu dir?“ – the run against the journal; its own chunk (profile, comparison, texts). */
const FitCard = lazy(() => import("./FitCard"));
/** F14: adapter status + TradingView export comparison – its own chunk (the CSV reader and the comparison load with it). */
const TvSection = lazy(() => import("./TvSection"));

/** F23: the forward test's accounts – its own chunk, fetched when the page is shown (the background catch-up is `ForwardHost`). */
const ForwardSection = lazy(() => import("./forward/ForwardSection"));
/** F15 / F13 / F45: draft versions and the playbook exchange – its own chunk. */
const DraftsSection = lazy(() => import("./DraftsSection"));
/** Muster-Entdecker: patterns in the entries of a backtest or the journal, tested against chance – its own chunk (the whole search domain). */
const DiscoverySection = lazy(() => import("./DiscoverySection"));
/** F66: the background optimiser – its own chunk (the panel, the worker and the search load with it). */
const EvolveSection = lazy(() => import("@/views/evolve/EvolveSection"));
/** Zeitmaschine: the plan form + the card (charts, worker) – its own chunks, fetched when the page is shown. */
const TimeMachineSection = lazy(() => import("@/views/timemachine/LaborSection"));

export const LABOR_LEAD_FILL = { storageKey: storageKey("fill-labor"), highlight: LABOR.highlight } as const;

function Section({ id, section, title, sub, children }: { id: string; section: string; title: string; sub: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="contents">
      <SectionTitle id={id} section={section} title={title} sub={sub} className="lg:col-span-12" />
      {children}
    </section>
  );
}

export function LaborView({ className }: { className?: string }) {
  const rawSignals = useJournal((s) => s.settings.signals);
  const signal = useMemo(() => sanitizeSignalCfg(rawSignals), [rawSignals]);
  const hasResult = useLabor((s) => s.result != null);
  const status = useLabor((s) => s.status);
  const runs = useLabor((s) => s.runs.length);
  const custom = useLabor((s) => s.cfg.strategy === "custom");
  const hasIdea = useLabor((s) => s.idea != null);
  const busy = status === "loading" || status === "running";
  const ids = { setup: useId(), run: useId(), diagnose: useId(), fit: useId(), extras: useId(), forward: useId(), robust: useId(), compare: useId(), tv: useId(), drafts: useId(), discovery: useId(), evolve: useId(), timemachine: useId() };
  const T = LABOR.sections;
  // the sections that exist right now (the ones below a run only after a finished run), for the "Inhalt" strip
  const shown = hasResult && !busy;
  const nav: SectionNavItem[] = [
    { id: "setup", label: T.setup.title },
    { id: "run", label: T.run.title },
    ...(shown ? [{ id: "diagnose", label: T.diagnose.title }, { id: "fit", label: T.fit.title }, { id: "extras", label: T.extras.title }] : []),
    { id: "forward", label: FORWARD.section.title },
    { id: "evolve", label: EVOLVE.section.title },
    ...(shown ? [{ id: "robust", label: T.robust.title }] : []),
    ...(hasResult || runs > 0 ? [{ id: "compare", label: T.compare.title }] : []),
    { id: "tv", label: T.tv.title },
    { id: "drafts", label: DRAFTS.section.title },
    { id: "discovery", label: "Muster-Entdecker" },
    { id: "timemachine", label: "Zeitmaschine" },
  ];
  return (
    <div className={cn("grid grid-cols-1 gap-5 lg:grid-cols-12", className)} data-testid="labor-view" data-status={status}>
      <PageHeader className="lg:col-span-12" title={LABOR.title} lead={LABOR.lead} leadFill={LABOR_LEAD_FILL} />
      <SectionNav items={nav} className="lg:col-span-12" />
      <Section id={ids.setup} section="setup" title={T.setup.title} sub={T.setup.sub}>
        {hasIdea && (
          <Cell index={0} span="lg:col-span-12">
            <IdeaCard />
          </Cell>
        )}
        <Cell index={0} span={custom ? "lg:col-span-8" : "lg:col-span-7"}>
          <ConfigCard signal={signal} />
        </Cell>
        {/* the assumptions stay in view beside the long set-up form (sticky under the page strip) instead of leaving an empty card floor */}
        <Cell index={1} span={custom ? "lg:col-span-4" : "lg:col-span-5"} className="lg:sticky lg:top-[136px] lg:self-start">
          <AssumptionsCard />
        </Cell>
      </Section>
      <Section id={ids.run} section="run" title={T.run.title} sub={T.run.sub}>
        <Cell index={0} span={hasResult && !busy ? "lg:col-span-7" : "lg:col-span-12"}>
          <RunCard />
        </Cell>
        {hasResult && !busy && (
          <Cell index={1} span="lg:col-span-5">
            <TradesCard />
          </Cell>
        )}
      </Section>
      {hasResult && !busy && (
        <Section id={ids.diagnose} section="diagnose" title={T.diagnose.title} sub={T.diagnose.sub}>
          <Cell index={0} span="lg:col-span-12">
            <DiagnosisCard />
          </Cell>
        </Section>
      )}
      {hasResult && !busy && (
        <Section id={ids.fit} section="fit" title={T.fit.title} sub={T.fit.sub}>
          <Cell index={0} span="lg:col-span-12">
            <Suspense fallback={<PendingBlock size="min-h-[434px] lg:min-h-[270px]" />}>
              <FitCard />
            </Suspense>
          </Cell>
        </Section>
      )}
      {hasResult && !busy && (
        <Section id={ids.extras} section="extras" title={T.extras.title} sub={T.extras.sub}>
          <Cell index={0} span="lg:col-span-12">
            <Suspense fallback={<PendingBlock size="min-h-[810px] lg:min-h-[535px]" />}>
              <ExtrasSection />
            </Suspense>
          </Cell>
        </Section>
      )}
      <Section id={ids.forward} section="forward" title={FORWARD.section.title} sub={FORWARD.section.sub}>
        <Cell index={0} span="lg:col-span-12">
          <Suspense fallback={<PendingBlock size="min-h-[1380px] lg:min-h-[840px]" />}>
            <ForwardSection />
          </Suspense>
        </Cell>
      </Section>
      <Section id={ids.evolve} section="evolve" title={EVOLVE.section.title} sub={EVOLVE.section.sub}>
        <Cell index={0} span="lg:col-span-12">
          <Suspense fallback={<PendingBlock size="min-h-[1375px] lg:min-h-[935px]" />}>
            <EvolveSection />
          </Suspense>
        </Cell>
      </Section>
      {hasResult && !busy && (
        <Section id={ids.robust} section="robust" title={T.robust.title} sub={T.robust.sub}>
          <Cell index={0} span="lg:col-span-5">
            <OverfitCard />
          </Cell>
          <Cell index={1} span="lg:col-span-7">
            <OosCard />
          </Cell>
          <Cell index={0} span="lg:col-span-7">
            <WalkForwardCard />
          </Cell>
          <Cell index={1} span="lg:col-span-5">
            <HeatmapCard />
          </Cell>
        </Section>
      )}
      {(hasResult || runs > 0) && (
        <Section id={ids.compare} section="compare" title={T.compare.title} sub={T.compare.sub}>
          <Cell index={0} span={hasResult ? "lg:col-span-8" : "lg:col-span-12"}>
            <CompareRunsCard />
          </Cell>
          {hasResult && (
            <Cell index={1} span="lg:col-span-4">
              <ReferenceCard />
            </Cell>
          )}
        </Section>
      )}
      <Section id={ids.tv} section="tv" title={T.tv.title} sub={T.tv.sub}>
        <Suspense
          fallback={
            <Cell index={0} span="lg:col-span-12">
              <PendingBlock size="min-h-[4010px] lg:min-h-[2200px]" />
            </Cell>
          }
        >
          <TvSection />
        </Suspense>
      </Section>
      <Section id={ids.drafts} section="drafts" title={DRAFTS.section.title} sub={DRAFTS.section.sub}>
        <Cell index={0} span="lg:col-span-12">
          <Suspense fallback={<PendingBlock size="min-h-[1775px] lg:min-h-[1175px]" />}>
            <DraftsSection />
          </Suspense>
        </Cell>
      </Section>
      <Section id={ids.discovery} section="discovery" title="Muster-Entdecker" sub="Was haben Gewinner und Verlierer gemeinsam – und hält das gegen den Zufall?">
        <Cell index={0} span="lg:col-span-12">
          <Suspense fallback={<PendingBlock size="min-h-[710px] lg:min-h-[420px]" />}>
            <DiscoverySection />
          </Suspense>
        </Cell>
      </Section>
      <Section id={ids.timemachine} section="timemachine" title="Zeitmaschine" sub="Den Plan 10 000 Mal durchspielen – und gegen jedes frühere Mal halten, als er ausgelöst hätte.">
        <Cell index={0} span="lg:col-span-12">
          <Suspense fallback={<PendingBlock size="min-h-[1165px] lg:min-h-[625px]" />}>
            <TimeMachineSection />
          </Suspense>
        </Cell>
      </Section>
      <AnalysisNote className="lg:col-span-12" lead="Ein Test zeigt, wie eine Idee in der Vergangenheit gelaufen wäre – keine Prognose." />
      <LabReplayHost />
      <LibraryHost />
    </div>
  );
}
