/**
 * Labor page (P07, `h1 Labor`): honest backtests on real Binance history.
 *   Versuchsaufbau  ConfigCard (7, with "Eigene Idee" 8) · AssumptionsCard (5, 4)
 *   Lauf            RunCard (7) · TradesCard (5)
 *   Diagnose        DiagnosisCard (12)                                                        (after a run)
 *   Belastung …     ExtrasSection (12): stress scenarios, Prüfbericht, filter comparison      (after a run, lazy)
 *   Robustheit      OverfitCard (5) · OosCard (7) · WalkForwardCard (7) · HeatmapCard (5)     (after a run)
 *   Vergleich       CompareRunsCard (8) · ReferenceCard (4)                                   (after a run)
 * Every cell reveals once (`Reveal`, ends at `transform: none`), section titles rise letter by letter. The replay
 * sheet of a backtest trade is mounted here (`LabReplayHost`). Registered by the integrator (P14) as page `labor`.
 */
import { lazy, Suspense, useId, useMemo, type ReactNode } from "react";
import { sanitizeSignalCfg } from "@/domain/signals";
import { cn } from "@/lib/cn";
import { storageKey } from "@/store/storage";
import { useJournal } from "@/store/journalStore";
import { PageHeader } from "@/views/setups/PageHeader";
import { ConfigCard } from "./ConfigCard";
import { DiagnosisCard } from "./DiagnosisCard";
import { LabReplayHost } from "./LabReplay";
import { useLabor } from "./laborStore";
import { HeatmapCard, OosCard, OverfitCard, WalkForwardCard } from "./RobustCards";
import { RunCard } from "./RunCard";
import { AssumptionsCard, CompareRunsCard, ReferenceCard } from "./SideCards";
import { LABOR } from "./strings";
import { TradesCard } from "./TradesCard";
import { Cell, SectionTitle } from "./ui";

/** F20 / F18 / F17: its own chunk, fetched only when a finished run is on the page. */
const ExtrasSection = lazy(() => import("./ExtrasSection"));

export const LABOR_LEAD_FILL = { storageKey: storageKey("fill-labor"), highlight: LABOR.highlight } as const;

function Section({ id, title, sub, children }: { id: string; title: string; sub: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="contents">
      <SectionTitle id={id} title={title} sub={sub} className="lg:col-span-12" />
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
  const busy = status === "loading" || status === "running";
  const ids = { setup: useId(), run: useId(), diagnose: useId(), extras: useId(), robust: useId(), compare: useId() };
  const T = LABOR.sections;
  return (
    <div className={cn("grid grid-cols-1 gap-5 lg:grid-cols-12", className)} data-testid="labor-view" data-status={status}>
      <PageHeader className="lg:col-span-12" title={LABOR.title} lead={LABOR.lead} leadFill={LABOR_LEAD_FILL} />
      <Section id={ids.setup} title={T.setup.title} sub={T.setup.sub}>
        <Cell index={0} span={custom ? "lg:col-span-8" : "lg:col-span-7"}>
          <ConfigCard signal={signal} />
        </Cell>
        <Cell index={1} span={custom ? "lg:col-span-4" : "lg:col-span-5"}>
          <AssumptionsCard />
        </Cell>
      </Section>
      <Section id={ids.run} title={T.run.title} sub={T.run.sub}>
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
        <Section id={ids.diagnose} title={T.diagnose.title} sub={T.diagnose.sub}>
          <Cell index={0} span="lg:col-span-12">
            <DiagnosisCard />
          </Cell>
        </Section>
      )}
      {hasResult && !busy && (
        <Section id={ids.extras} title={T.extras.title} sub={T.extras.sub}>
          <Cell index={0} span="lg:col-span-12">
            <Suspense fallback={null}>
              <ExtrasSection />
            </Suspense>
          </Cell>
        </Section>
      )}
      {hasResult && !busy && (
        <Section id={ids.robust} title={T.robust.title} sub={T.robust.sub}>
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
        <Section id={ids.compare} title={T.compare.title} sub={T.compare.sub}>
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
      <LabReplayHost />
    </div>
  );
}
