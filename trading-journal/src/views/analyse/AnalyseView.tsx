/**
 * Analyse page (P03, `h1 Analyse`): pro statistics with honest uncertainty over the account view of the Hero's switch
 * (`uiStore.acc`). Sections (lg, 12 columns):
 *   Kennzahlen       KennzahlenHero (12)
 *   Was kommen kann  MonteCarloCard (8) · RiskOfRuinCard (4)
 *   Wo deine Edge…   BreakdownCard (7) · HeatmapCard (5)
 *   Ausführung       ExcursionCard (6) · DistributionCard (6)
 *   Muster           RollingCard (7) · StreaksCard (5)
 *   Vergleich        BenchmarkCard (6) · CompareCard (6) · CustomStatCard (12)
 * Every cell reveals once (`Reveal`, ends at `transform: none`); section titles rise letter by letter. Without trades:
 * one calm preview card. Registered by the integrator (P14) as page `analyse` (`#analyse?dim=<dimension>`).
 */
import { useId, type ReactNode } from "react";
import { ACCOUNT_LABELS } from "@/domain/defaults";
import { ANALYSE_HIGHLIGHT, ANALYSE_LEAD, ANALYSE_TITLE, CARD_TITLES, SECTIONS } from "@/domain/analytics";
import { cn } from "@/lib/cn";
import { useCloseMorphDialogOnUnmount } from "@/motion/MorphDialog";
import { Reveal } from "@/motion/Reveal";
import { Card } from "@/primitives/Card";
import { EmptyState } from "@/primitives/EmptyState";
import { Segmented } from "@/primitives/Segmented";
import { storageKey } from "@/store/storage";
import { useUi, type AccFilter } from "@/store/uiStore";
import { PageHeader } from "@/views/setups/PageHeader";
import { BenchmarkCard } from "./BenchmarkCard";
import { BreakdownCard } from "./BreakdownCard";
import { CompareCard } from "./CompareCard";
import { CustomStatCard } from "./CustomStatCard";
import { DistributionCard } from "./DistributionCard";
import { ExcursionCard } from "./ExcursionCard";
import { HeatmapCard } from "./HeatmapCard";
import { useAnalyseBase, useRatios } from "./hooks";
import { KennzahlenHero } from "./KennzahlenHero";
import { MonteCarloCard } from "./MonteCarloCard";
import { RiskOfRuinCard } from "./RiskOfRuinCard";
import { RollingCard } from "./RollingCard";
import { StreaksCard } from "./StreaksCard";
import { SEG_TOUCH, SectionTitle } from "./ui";

export const ANALYSE_LEAD_FILL = { storageKey: storageKey("fill-analyse"), highlight: ANALYSE_HIGHLIGHT } as const;
const ACC_OPTIONS = (["all", "makro", "scalp"] as const).map((v) => ({ v, label: ACCOUNT_LABELS[v] }));

function Cell({ index, span, children }: { index: number; span: string; children: ReactNode }) {
  return (
    <Reveal index={index} className={cn("flex min-w-0 flex-col [&>*]:flex-1", span)}>
      {children}
    </Reveal>
  );
}

export const PREVIEW_ITEMS = [CARD_TITLES.hero, CARD_TITLES.monteCarlo, CARD_TITLES.ruin, CARD_TITLES.breakdown, CARD_TITLES.heatmap, CARD_TITLES.excursion, CARD_TITLES.distribution, CARD_TITLES.rolling, CARD_TITLES.streaks, CARD_TITLES.benchmark, CARD_TITLES.compare, CARD_TITLES.custom];

function PreviewCard() {
  return (
    <Card title={ANALYSE_TITLE} data-testid="ana-preview">
      <EmptyState
        title="Noch nichts zu analysieren"
        text="Sobald du Trades abschließt, rechnet die Analyse Sharpe, SQN, Kelly, Monte Carlo, Risk of Ruin und Breakdowns mit ehrlichen Intervallen – ab 5 Trades die ersten Kennzahlen, ab etwa 30 belastbar."
        line={false}
        action={
          <ul className="mt-2 flex max-w-[52ch] flex-wrap justify-center gap-1.5" aria-label="Kommende Analysen">
            {PREVIEW_ITEMS.map((t) => (
              <li key={t} className="rounded-full border border-line-2 px-2.5 py-0.5 text-[11px] text-mute">
                {t}
              </li>
            ))}
          </ul>
        }
      />
    </Card>
  );
}

export function AnalyseView({ className }: { className?: string }) {
  const { view, settings, cur, acc } = useAnalyseBase();
  const setAcc = useUi((s) => s.setAcc);
  const rep = useRatios(view);
  const ids = { ratios: useId(), future: useId(), edge: useId(), exec: useId(), patterns: useId(), compare: useId() };
  useCloseMorphDialogOnUnmount();
  const empty = view.closed.length === 0;
  return (
    <div className={cn("grid grid-cols-1 gap-5 lg:grid-cols-12", className)} data-testid="analyse-view" data-n={view.closed.length}>
      <PageHeader
        className="lg:col-span-12"
        title={ANALYSE_TITLE}
        lead={ANALYSE_LEAD}
        leadFill={ANALYSE_LEAD_FILL}
        action={<Segmented<AccFilter> aria-label="Konto der Analyse" options={ACC_OPTIONS} value={acc} onChange={setAcc} size="sm" className={SEG_TOUCH} />}
      />
      {empty ? (
        <Cell index={0} span="lg:col-span-12">
          <PreviewCard />
        </Cell>
      ) : (
        <>
          <section aria-labelledby={ids.ratios} className="contents">
            <SectionTitle id={ids.ratios} title={SECTIONS.ratios} sub={`${view.closed.length} abgeschlossene Trades · ${ACCOUNT_LABELS[acc]} · Intervalle 80 %`} className="lg:col-span-12" />
            <Cell index={0} span="lg:col-span-12">
              <KennzahlenHero rep={rep} cur={cur} n={view.closed.length} />
            </Cell>
          </section>
          <section aria-labelledby={ids.future} className="contents">
            <SectionTitle id={ids.future} title={SECTIONS.future} sub="Tausende mögliche Zukünfte aus deinen echten Trades." className="lg:col-span-12" />
            <Cell index={0} span="lg:col-span-8">
              <MonteCarloCard view={view} cur={cur} />
            </Cell>
            <Cell index={1} span="lg:col-span-4">
              <RiskOfRuinCard view={view} settings={settings} rep={rep} />
            </Cell>
          </section>
          <section aria-labelledby={ids.edge} className="contents">
            <SectionTitle id={ids.edge} title={SECTIONS.edge} sub="Trade the best, fuck the rest – aber nur, was den Zufall übersteht." className="lg:col-span-12" />
            <Cell index={0} span="lg:col-span-7">
              <BreakdownCard view={view} settings={settings} cur={cur} />
            </Cell>
            <Cell index={1} span="lg:col-span-5">
              <HeatmapCard view={view} cur={cur} />
            </Cell>
          </section>
          <section aria-labelledby={ids.exec} className="contents">
            <SectionTitle id={ids.exec} title={SECTIONS.execution} className="lg:col-span-12" />
            <Cell index={0} span="lg:col-span-6">
              <ExcursionCard view={view} cur={cur} />
            </Cell>
            <Cell index={1} span="lg:col-span-6">
              <DistributionCard view={view} cur={cur} />
            </Cell>
          </section>
          <section aria-labelledby={ids.patterns} className="contents">
            <SectionTitle id={ids.patterns} title={SECTIONS.patterns} className="lg:col-span-12" />
            <Cell index={0} span="lg:col-span-7">
              <RollingCard view={view} cur={cur} />
            </Cell>
            <Cell index={1} span="lg:col-span-5">
              <StreaksCard view={view} />
            </Cell>
          </section>
          <section aria-labelledby={ids.compare} className="contents">
            <SectionTitle id={ids.compare} title={SECTIONS.compare} className="lg:col-span-12" />
            <Cell index={0} span="lg:col-span-6">
              <BenchmarkCard view={view} />
            </Cell>
            <Cell index={1} span="lg:col-span-6">
              <CompareCard view={view} settings={settings} cur={cur} />
            </Cell>
            <Cell index={0} span="lg:col-span-12">
              <CustomStatCard view={view} settings={settings} cur={cur} />
            </Cell>
          </section>
        </>
      )}
    </div>
  );
}
