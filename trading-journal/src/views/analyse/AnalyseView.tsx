/**
 * Analyse page (P03, `h1 Analyse`): pro statistics with honest uncertainty over the account view of the Hero's switch
 * (`uiStore.acc`). Sections (lg, 12 columns):
 *   Kennzahlen       KennzahlenHero (12) · CostsCard (12, Brutto → Gebühren → Funding → Netto)
 *   Was kommen kann  MonteCarloCard (8) · RiskOfRuinCard (4)
 *   Wo deine Edge…   BreakdownCard (7) · HeatmapCard (5)
 *   Ausführung       ExcursionCard (6) · DistributionCard (6)
 *   Muster           RollingCard (7) · StreaksCard (5)
 *   Vergleich        BenchmarkCard (6) · CompareCard (6) · CustomStatCard (12)
 * Every cell reveals once (`Reveal`, ends at `transform: none`); section titles rise letter by letter. Without trades:
 * one calm preview card. Registered by the integrator (P14) as page `analyse` (`#analyse?dim=<dimension>`).
 */
import { useId, useRef, type ReactNode } from "react";
import { Gate } from "@/billing/entitlements";
import { UpgradeTeaser } from "@/billing/ui/UpgradeTeaser";
import { ACCOUNT_LABELS } from "@/domain/defaults";
import { ANALYSE_HIGHLIGHT, ANALYSE_LEAD, ANALYSE_TITLE, CARD_TITLES, SECTIONS } from "@/domain/analytics";
import { cn } from "@/lib/cn";
import { useCloseMorphDialogOnUnmount } from "@/motion/MorphDialog";
import { Reveal } from "@/motion/Reveal";
import { Card } from "@/primitives/Card";
import { useIdlePrerender } from "@/primitives/idlePrerender";
import { Later } from "@/primitives/Later";
import { RESERVE_CLASS, RESERVE_CLASS_DEFER, reserveStyle, type ReserveHeight } from "@/primitives/Reserve";
import { EmptyState } from "@/primitives/EmptyState";
import { SectionNav, type SectionNavItem } from "@/primitives/SectionNav";
import { Segmented } from "@/primitives/Segmented";
import { storageKey } from "@/store/storage";
import { useUi, type AccFilter } from "@/store/uiStore";
import { AnalysisNote } from "@/ui/AnalysisNote";
import { PageHeader } from "@/views/setups/PageHeader";
import { BenchmarkCard } from "./BenchmarkCard";
import { BreakdownCard } from "./BreakdownCard";
import { CompareCard } from "./CompareCard";
import { CostsCard } from "./CostsCard";
import { CustomStatCard } from "./CustomStatCard";
import { DecisionCard } from "./decision/DecisionCard";
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

/**
 * `size` = the END size of the card in this cell (px at 390 / 640 / 1024 and up, measured on the finished page).
 * - `late`: the card's content arrives after the first paint (the Monte Carlo run, the daily candles of the benchmark) – the
 *   cell holds that size as a floor from the first frame (`Reserve`, `@/primitives/Reserve`), so the cards below never slide down
 *   when it lands (before: +367 px / +172 px after the first paint);
 * - `defer`: a cell below the first screenful skips style, layout and paint until it nears the viewport
 *   (`content-visibility: auto`, `Reveal defer`) and is rendered once in idle time (`useIdlePrerender`) – the page mounts
 *   with the work of its first screen instead of its 9 000 px; the card itself mounts after the page has painted, one per idle
 *   slice (`Later`), so the switch to the page is no longer one long task.
 */
function Cell({ index, span, size, late = false, defer = false, children }: { index: number; span: string; size?: ReserveHeight; late?: boolean; defer?: boolean; children: ReactNode }) {
  return (
    <Reveal
      index={index}
      defer={defer ? size : undefined}
      className={cn("flex min-w-0 flex-col [&>*]:flex-1", late && size && (defer ? RESERVE_CLASS_DEFER : RESERVE_CLASS), span)}
      style={!defer && late && size ? reserveStyle(size) : undefined}
    >
      {defer ? <Later>{children}</Later> : children}
    </Reveal>
  );
}

/** End sizes (px at 390 / 640 / 1024+) of the cells that load late or sit below the first screenful – measured on the finished page. */
const SIZE = {
  monteCarlo: { base: 944, sm: 744 },
  ruin: { base: 289, sm: 289, lg: 744 },
  breakdown: { base: 867, sm: 565 },
  heatmap: { base: 381, sm: 614, lg: 565 },
  excursion: { base: 333, sm: 333, lg: 510 },
  distribution: { base: 644, sm: 494, lg: 510 },
  rolling: { base: 300, sm: 280, lg: 496 },
  streaks: { base: 496, sm: 479, lg: 496 },
  benchmark: { base: 604, sm: 529 },
  compare: { base: 370, sm: 308, lg: 529 },
  decision: { base: 476, sm: 337, lg: 321 },
  custom: { base: 686, sm: 650, lg: 430 },
} as const satisfies Record<string, ReserveHeight>;

/** The sections of the page, for its "Inhalt" strip (`data-section` on each `SectionTitle`). */
const NAV: readonly SectionNavItem[] = [
  { id: "ratios", label: SECTIONS.ratios },
  { id: "future", label: SECTIONS.future },
  { id: "edge", label: SECTIONS.edge },
  { id: "execution", label: SECTIONS.execution },
  { id: "patterns", label: SECTIONS.patterns },
  { id: "compare", label: SECTIONS.compare },
];

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
  const root = useRef<HTMLDivElement>(null);
  // the deferred cells render once in idle time, not inside the first scroll past them
  useIdlePrerender(root);
  return (
    <div ref={root} className={cn("grid grid-cols-1 gap-5 lg:grid-cols-12", className)} data-testid="analyse-view" data-n={view.closed.length}>
      <PageHeader
        className="lg:col-span-12"
        title={ANALYSE_TITLE}
        lead={ANALYSE_LEAD}
        leadFill={ANALYSE_LEAD_FILL}
        action={<Segmented<AccFilter> aria-label="Konto der Analyse" options={ACC_OPTIONS} value={acc} onChange={setAcc} size="sm" className={SEG_TOUCH} />}
      />
      {!empty && <SectionNav items={NAV} className="lg:col-span-12" />}
      {empty ? (
        <Cell index={0} span="lg:col-span-12">
          <PreviewCard />
        </Cell>
      ) : (
        <>
          <section aria-labelledby={ids.ratios} className="contents">
            <SectionTitle id={ids.ratios} section="ratios" title={SECTIONS.ratios} sub={`${view.closed.length} abgeschlossene Trades · ${ACCOUNT_LABELS[acc]} · Intervalle 80 %`} className="lg:col-span-12" />
            <Cell index={0} span="lg:col-span-12">
              <KennzahlenHero rep={rep} cur={cur} n={view.closed.length} />
            </Cell>
            <Cell index={1} span="lg:col-span-12">
              <CostsCard closed={view.closed} cur={cur} />
            </Cell>
          </section>
          <section aria-labelledby={ids.future} className="contents">
            <SectionTitle id={ids.future} section="future" title={SECTIONS.future} sub="Tausende mögliche Zukünfte aus deinen echten Trades." className="lg:col-span-12" />
            {/* plan gate `monteCarlo` (P10 / P14; without payments always open) */}
            <Gate
              feature="monteCarlo"
              fallback={
                <Cell index={0} span="lg:col-span-12">
                  <UpgradeTeaser feature="monteCarlo" />
                </Cell>
              }
            >
              <Cell index={0} span="lg:col-span-8" size={SIZE.monteCarlo} late defer>
                <MonteCarloCard view={view} cur={cur} />
              </Cell>
              <Cell index={1} span="lg:col-span-4" size={SIZE.ruin} defer>
                <RiskOfRuinCard view={view} settings={settings} rep={rep} />
              </Cell>
            </Gate>
          </section>
          <section aria-labelledby={ids.edge} className="contents">
            <SectionTitle id={ids.edge} section="edge" title={SECTIONS.edge} sub="Trade the best, fuck the rest – aber nur, was den Zufall übersteht." className="lg:col-span-12" />
            <Cell index={0} span="lg:col-span-7" size={SIZE.breakdown} defer>
              <BreakdownCard view={view} settings={settings} cur={cur} />
            </Cell>
            <Cell index={1} span="lg:col-span-5" size={SIZE.heatmap} defer>
              <HeatmapCard view={view} cur={cur} />
            </Cell>
          </section>
          <section aria-labelledby={ids.exec} className="contents">
            <SectionTitle id={ids.exec} section="execution" title={SECTIONS.execution} className="lg:col-span-12" />
            <Cell index={0} span="lg:col-span-6" size={SIZE.excursion} defer>
              <ExcursionCard view={view} cur={cur} />
            </Cell>
            <Cell index={1} span="lg:col-span-6" size={SIZE.distribution} defer>
              <DistributionCard view={view} cur={cur} />
            </Cell>
          </section>
          <section aria-labelledby={ids.patterns} className="contents">
            <SectionTitle id={ids.patterns} section="patterns" title={SECTIONS.patterns} className="lg:col-span-12" />
            <Cell index={0} span="lg:col-span-7" size={SIZE.rolling} defer>
              <RollingCard view={view} cur={cur} />
            </Cell>
            <Cell index={1} span="lg:col-span-5" size={SIZE.streaks} defer>
              <StreaksCard view={view} />
            </Cell>
          </section>
          <section aria-labelledby={ids.compare} className="contents">
            <SectionTitle id={ids.compare} section="compare" title={SECTIONS.compare} className="lg:col-span-12" />
            <Cell index={0} span="lg:col-span-6" size={SIZE.benchmark} late defer>
              <BenchmarkCard view={view} />
            </Cell>
            <Cell index={1} span="lg:col-span-6" size={SIZE.compare} defer>
              <CompareCard view={view} settings={settings} cur={cur} />
            </Cell>
            <Cell index={0} span="lg:col-span-12" size={SIZE.decision} defer>
              <DecisionCard view={view} cur={cur} />
            </Cell>
            <Cell index={0} span="lg:col-span-12" size={SIZE.custom} defer>
              <CustomStatCard view={view} settings={settings} cur={cur} />
            </Cell>
          </section>
        </>
      )}
      <AnalysisNote className="lg:col-span-12" lead="Auswertung deiner Trades – die Zukunftsrechnungen sind Wahrscheinlichkeiten, keine Zusagen." />
    </div>
  );
}
