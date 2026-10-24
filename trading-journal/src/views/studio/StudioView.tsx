/**
 * Strategie-Studio (`h1 Strategie-Studio`): write a strategy in plain German, let the studio turn it into the lab's rules, check
 * them on real candles and let them run on paper – never with money, never with an order.
 *   Deine Strategie     StrategyList (several drafts, tick for "Alle testen") · EditorCard (text, examples, Verstehen, speichern)
 *                       Understanding: Das habe ich verstanden · Unklar · Fragen an dich · Meine Annahmen · So rechnet das Labor
 *   Prüfen              BacktestCard · LiveCard
 *   Alle testen         CompareCard (several strategies, same data / window / train-test, honest multiple-testing note)
 *   Entwürfe …          VersionsCard (v1, v2 …, compare two versions)
 *   Weitere Werkzeuge   MoreTools (pattern discovery and optimiser slots, proposals)
 * Every cell reveals once; every result card ends with "Keine professionelle Finanzberatung."
 */
import { useEffect, useId, useMemo, type ReactNode } from "react";
import { studioCfgOf } from "@/domain/strategytext";
import { cn } from "@/lib/cn";
import { useJournal } from "@/store/journalStore";
import { storageKey } from "@/store/storage";
import { AnalysisNote } from "@/ui/AnalysisNote";
import { PageHeader } from "@/views/setups/PageHeader";
import { Cell, SectionTitle } from "@/views/labor/ui";
import { BacktestCard } from "./BacktestCard";
import { CompareCard } from "./CompareCard";
import { EditorCard } from "./EditorCard";
import { LiveCard } from "./LiveCard";
import { MoreTools } from "./MoreTools";
import { StrategyList } from "./StrategyList";
import { flushStudio, useStudio } from "./studioStore";
import { STUDIO } from "./strings";
import { Understanding } from "./Understanding";
import { VersionsCard } from "./VersionsCard";

export const STUDIO_LEAD_FILL = { storageKey: storageKey("fill-studio"), highlight: STUDIO.highlight } as const;

function Section({ id, title, sub, children }: { id: string; title: string; sub: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="contents">
      <SectionTitle id={id} title={title} sub={sub} className="lg:col-span-12" />
      {children}
    </section>
  );
}

export function StudioView({ className }: { className?: string }) {
  const raw = useJournal((s) => s.settings.studio);
  const strategies = useMemo(() => studioCfgOf(raw).strategies, [raw]);
  const hasText = useStudio((s) => s.editor.text.trim().length > 0);
  const selected = useStudio((s) => s.selected);
  const cmpActive = useStudio((s) => s.cmp.status !== "idle");
  const ids = { write: useId(), test: useId(), compare: useId(), versions: useId(), more: useId() };
  const T = STUDIO.sections;

  // first visit of the session: pick up where the trader stopped (the newest strategy), unless something is being written
  useEffect(() => {
    const st = useStudio.getState();
    if (st.editor.id == null && !st.editor.text && strategies.length > 0) {
      const newest = [...strategies].sort((a, b) => b.updatedAt - a.updatedAt)[0]!;
      void st.open(newest.id);
    }
    // only on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // leaving the page writes the working copy
  useEffect(
    () => () => {
      void flushStudio();
    },
    [],
  );

  const showCompare = cmpActive || selected.length >= 2 || strategies.length >= 2;
  return (
    <div className={cn("grid grid-cols-1 gap-5 lg:grid-cols-12", className)} data-testid="studio-view">
      <PageHeader className="lg:col-span-12" title={STUDIO.title} lead={STUDIO.lead} leadFill={STUDIO_LEAD_FILL} />
      <Section id={ids.write} title={T.write.title} sub={T.write.sub}>
        <Cell index={0} span="lg:col-span-4">
          <StrategyList strategies={strategies} />
        </Cell>
        <Cell index={1} span="lg:col-span-8">
          <EditorCard />
        </Cell>
        <Cell index={0} span="lg:col-span-12">
          <Understanding />
        </Cell>
      </Section>
      {hasText && (
        <Section id={ids.test} title={T.test.title} sub={T.test.sub}>
          <Cell index={0} span="lg:col-span-7">
            <BacktestCard />
          </Cell>
          <Cell index={1} span="lg:col-span-5">
            <LiveCard strategies={strategies} />
          </Cell>
        </Section>
      )}
      {showCompare && (
        <Section id={ids.compare} title={T.compare.title} sub={T.compare.sub}>
          <Cell index={0} span="lg:col-span-12">
            <CompareCard strategies={strategies} />
          </Cell>
        </Section>
      )}
      {hasText && (
        <Section id={ids.versions} title={T.versions.title} sub={T.versions.sub}>
          <Cell index={0} span="lg:col-span-12">
            <VersionsCard strategies={strategies} />
          </Cell>
        </Section>
      )}
      {hasText && (
        <Section id={ids.more} title={T.more.title} sub={T.more.sub}>
          <Cell index={0} span="lg:col-span-12">
            <MoreTools strategies={strategies} />
          </Cell>
        </Section>
      )}
      <AnalysisNote lead="Ein Backtest zeigt, wie deine Regeln in der Vergangenheit gelaufen wären – keine Prognose." />
    </div>
  );
}
