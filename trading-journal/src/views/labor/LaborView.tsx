/**
 * Labor page (P07, `h1 Labor`): honest backtests on real Binance history.
 *   Versuchsaufbau  ConfigCard (7, with "Eigene Idee" 8) · AssumptionsCard (5, 4)
 *   Lauf            RunCard (7) · TradesCard (5)
 *   Diagnose        DiagnosisCard (12)                                                        (after a run)
 *   Passt zu dir?   FitCard (12): the run against the journal (F49)                        (after a run, lazy)
 *   Belastung …     ExtrasSection (12): stress scenarios, Prüfbericht, filter comparison      (after a run, lazy)
 *   Forward-Test    ForwardSection (12): virtual accounts on new closed candles                (always, lazy chunk; F23)
 *   Robustheit      OverfitCard (5) · OosCard (7) · WalkForwardCard (7) · HeatmapCard (5)     (after a run)
 *   Vergleich       CompareRunsCard (8) · ReferenceCard (4)                                   (after a run)
 *   TradingView     AdapterStatusCard (6) · TvCompareCard (6)                                 (lazy chunk, always; F14)
 *   Versionen …     VersionsCard · PlaybookCard (DraftsSection, 12)                            (lazy chunk, always; F15 / F13 / F45)
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
  const ids = { setup: useId(), run: useId(), diagnose: useId(), fit: useId(), extras: useId(), forward: useId(), robust: useId(), compare: useId(), tv: useId(), drafts: useId() };
  const T = LABOR.sections;
  // the sections that exist right now (the ones below a run only after a finished run), for the "Inhalt" strip
  const shown = hasResult && !busy;
  const nav: SectionNavItem[] = [
    { id: "setup", label: T.setup.title },
    { id: "run", label: T.run.title },
    ...(shown ? [{ id: "diagnose", label: T.diagnose.title }, { id: "fit", label: T.fit.title }, { id: "extras", label: T.extras.title }] : []),
    { id: "forward", label: FORWARD.section.title },
    ...(shown ? [{ id: "robust", label: T.robust.title }] : []),
    ...(hasResult || runs > 0 ? [{ id: "compare", label: T.compare.title }] : []),
    { id: "tv", label: T.tv.title },
    { id: "drafts", label: DRAFTS.section.title },
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
        <Cell index={1} span={custom ? "lg:col-span-4" : "lg:col-span-5"}>
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
            <Suspense fallback={null}>
              <FitCard />
            </Suspense>
          </Cell>
        </Section>
      )}
      {hasResult && !busy && (
        <Section id={ids.extras} section="extras" title={T.extras.title} sub={T.extras.sub}>
          <Cell index={0} span="lg:col-span-12">
            <Suspense fallback={null}>
              <ExtrasSection />
            </Suspense>
          </Cell>
        </Section>
      )}
      <Section id={ids.forward} section="forward" title={FORWARD.section.title} sub={FORWARD.section.sub}>
        <Cell index={0} span="lg:col-span-12">
          <Suspense fallback={null}>
            <ForwardSection />
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
        <Suspense fallback={null}>
          <TvSection />
        </Suspense>
      </Section>
      <Section id={ids.drafts} section="drafts" title={DRAFTS.section.title} sub={DRAFTS.section.sub}>
        <Cell index={0} span="lg:col-span-12">
          <Suspense fallback={null}>
            <DraftsSection />
          </Suspense>
        </Cell>
      </Section>
      <LabReplayHost />
      <LibraryHost />
    </div>
  );
}
