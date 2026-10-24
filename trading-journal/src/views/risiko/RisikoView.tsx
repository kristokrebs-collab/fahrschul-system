/**
 * Risiko page (P05, `h1 Risiko`): tools before the trade and limits that work live, over the account of the Hero's
 * switch (`uiStore.acc`). Sections (lg, 12 columns):
 *   Jetzt          LimitsCard (7) · ExposureCard (5)
 *   Vor dem Trade  CalculatorCard (7) · LiquidationCard (5)
 *   Portfolio      ScenarioCard (8) · MarginCard (4)
 *   Muster         CorrelationCard (7) · StreakCard (5) · RiskSpreadCard (12)
 *   Einstellungen  RiskSettingsCard (12)
 * Every cell reveals once (`Reveal`, ends at `transform: none`); section titles rise letter by letter. The page never
 * blocks the journal: it measures, warns and offers the pause. Registered by the integrator (P14) as page `risiko`.
 */
import { useId, useMemo, type ReactNode } from "react";
import { ACCOUNT_LABELS } from "@/domain/defaults";
import { clusterRisks, correlationClusters, correlationMatrix, riskWarnings, streakRisk, symbolOf, type RiskWarning } from "@/domain/risk";
import { tradeTime } from "@/lib/dates";
import { cn } from "@/lib/cn";
import { useProvider } from "@/market";
import { useBoxes } from "@/market/boxes";
import { useMultiDaily } from "@/market/multiDaily";
import { useCloseMorphDialogOnUnmount } from "@/motion/MorphDialog";
import { SectionNav, type SectionNavItem } from "@/primitives/SectionNav";
import { Segmented } from "@/primitives/Segmented";
import { storageKey } from "@/store/storage";
import { useUi, type AccFilter } from "@/store/uiStore";
import { SectionTitle } from "@/views/analyse/ui";
import { PageHeader } from "@/views/setups/PageHeader";
import { CalculatorCard, useCalcModel } from "./CalculatorCard";
import { CorrelationCard } from "./CorrelationCard";
import { ExposureCard } from "./ExposureCard";
import { useExposure, useLimitReport, useRiskBase } from "./hooks";
import { LimitsCard } from "./LimitsCard";
import { LiquidationCard, plannedRow } from "./LiquidationCard";
import { MarginCard } from "./MarginCard";
import { corrSymbols, liqRows, scenarioLegs } from "./model";
import { RiskSettingsCard } from "./RiskSettingsCard";
import { RiskSpreadCard } from "./RiskSpreadCard";
import { ScenarioCard } from "./ScenarioCard";
import { StreakCard } from "./StreakCard";
import { RISIKO } from "./strings";
import { Cell, SEG_TOUCH } from "./ui";

export const RISIKO_LEAD_FILL = { storageKey: storageKey("fill-risiko"), highlight: RISIKO.highlight } as const;
const ACC_OPTIONS = (["all", "makro", "scalp"] as const).map((v) => ({ v, label: ACCOUNT_LABELS[v] }));

function Section({ id, section, title, sub, children }: { id: string; section: string; title: string; sub: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="contents">
      <SectionTitle id={id} section={section} title={title} sub={sub} className="lg:col-span-12" />
      {children}
    </section>
  );
}

/** The sections of the page, for its "Inhalt" strip (`data-section` on each section title). */
const NAV: readonly SectionNavItem[] = [
  { id: "now", label: RISIKO.sections.now.title },
  { id: "before", label: RISIKO.sections.before.title },
  { id: "portfolio", label: RISIKO.sections.portfolio.title },
  { id: "patterns", label: RISIKO.sections.patterns.title },
  { id: "settings", label: RISIKO.sections.settings.title },
];

export function RisikoView({ className }: { className?: string }) {
  const base = useRiskBase();
  const setAcc = useUi((s) => s.setAcc);
  const report = useLimitReport(base);
  const ex = useExposure(base);
  const calc = useCalcModel(base);
  const provider = useProvider();
  const liveSym = provider?.symbolInfo.binance ?? null;
  // the live pair's 4h ATR (Box-zu-Box store) for distances in ATR
  const boxes = useBoxes({ enabled: ex.legs.some((l) => l.symbol === liveSym) });
  const atr4h = boxes.tfs["4h"]?.analysis?.box.atr ?? null;
  const atrOf = useMemo(() => (s: string | null) => (s && s === liveSym && atr4h ? atr4h : null), [liveSym, atr4h]);
  const rows = useMemo(() => liqRows(ex.legs, base.limits.tiers, base.capital, atrOf), [ex.legs, base.limits.tiers, base.capital, atrOf]);
  const planned = useMemo(() => plannedRow(calc, base.limits.tiers, liveSym && symbolOf(calc.pair) === liveSym ? atr4h : null), [calc, base.limits.tiers, liveSym, atr4h]);
  const legs = useMemo(() => scenarioLegs(ex.legs, rows), [ex.legs, rows]);

  const scoped = useMemo(() => base.enriched.filter((t) => base.acc === "all" || (t.account ?? "scalp") === base.acc), [base.enriched, base.acc]);
  const closed = useMemo(() => scoped.filter((t) => t.result !== "open").sort((a, b) => +tradeTime(a) - +tradeTime(b)), [scoped]);
  const equityNow = useMemo(() => base.capital + closed.reduce((s, t) => s + (t.pnl ?? 0), 0), [base.capital, closed]);
  const symbols = useMemo(() => corrSymbols(scoped, base.positions), [scoped, base.positions]);
  const daily = useMultiDaily(symbols);
  const cm = useMemo(() => correlationMatrix(daily.series), [daily.series]);
  const clusters = useMemo(() => correlationClusters(cm), [cm]);
  const crisks = useMemo(() => clusterRisks(clusters, ex.legs), [clusters, ex.legs]);
  const sr = useMemo(() => {
    const withR = closed.filter((t) => t.r != null && Number.isFinite(t.r)).length;
    // the Monte Carlo draws the own R multiples (else ±1 per win / loss: the streak pattern is what matters)
    const sign = (t: (typeof closed)[number]) => ((t.pnl ?? 0) > 0 ? 1 : (t.pnl ?? 0) < 0 ? -1 : 0);
    const sample = withR >= closed.length * 0.6 ? closed.map((t) => (t.r != null && Number.isFinite(t.r) ? t.r : sign(t))) : closed.map(sign);
    return streakRisk({ results: closed.map((t) => t.result), sample, riskPct: base.limits.riskPerTradePct });
  }, [closed, base.limits.riskPerTradePct]);
  const warnings: RiskWarning[] = useMemo(
    () => riskWarnings({ report, exposure: ex, clusters: crisks, liquidations: rows.filter((r) => r.distPct != null).map((r) => ({ label: r.label, distPct: r.distPct!, distAtr: r.distAtr })), now: base.now }),
    [report, ex, crisks, rows, base.now],
  );

  const ids = { now: useId(), before: useId(), portfolio: useId(), patterns: useId(), settings: useId() };
  useCloseMorphDialogOnUnmount();
  const T = RISIKO.sections;
  return (
    <div className={cn("grid grid-cols-1 gap-5 lg:grid-cols-12", className)} data-testid="risiko-view" data-worst={report.worst}>
      <PageHeader
        className="lg:col-span-12"
        title={RISIKO.title}
        lead={RISIKO.lead}
        leadFill={RISIKO_LEAD_FILL}
        action={<Segmented<AccFilter> aria-label={RISIKO.accLabel} options={ACC_OPTIONS} value={base.acc} onChange={setAcc} size="sm" className={SEG_TOUCH} />}
      />
      <SectionNav items={NAV} className="lg:col-span-12" />
      <Section id={ids.now} section="now" title={T.now.title} sub={`${T.now.sub} ${ACCOUNT_LABELS[base.acc]}.`}>
        <Cell index={0} span="lg:col-span-7">
          <LimitsCard report={report} now={base.now} warnings={warnings} />
        </Cell>
        <Cell index={1} span="lg:col-span-5">
          <ExposureCard ex={ex} cur={base.cur} />
        </Cell>
      </Section>
      <Section id={ids.before} section="before" title={T.before.title} sub={T.before.sub}>
        <Cell index={0} span="lg:col-span-7">
          <CalculatorCard base={base} />
        </Cell>
        <Cell index={1} span="lg:col-span-5">
          <LiquidationCard rows={rows} planned={planned} />
        </Cell>
      </Section>
      <Section id={ids.portfolio} section="portfolio" title={T.portfolio.title} sub={T.portfolio.sub}>
        <Cell index={0} span="lg:col-span-8">
          <ScenarioCard legs={legs} equity={equityNow} cur={base.cur} />
        </Cell>
        <Cell index={1} span="lg:col-span-4">
          <MarginCard ex={ex} capital={base.capital} cur={base.cur} />
        </Cell>
      </Section>
      <Section id={ids.patterns} section="patterns" title={T.patterns.title} sub={T.patterns.sub}>
        <Cell index={0} span="lg:col-span-7">
          <CorrelationCard symbols={symbols} view={daily} cm={cm} clusters={clusters} />
        </Cell>
        <Cell index={1} span="lg:col-span-5">
          <StreakCard sr={sr} riskPct={base.limits.riskPerTradePct} />
        </Cell>
        <Cell index={0} span="lg:col-span-12">
          <RiskSpreadCard closed={closed} settings={base.settings} limit={base.limits.maxLossTradePct} />
        </Cell>
      </Section>
      <Section id={ids.settings} section="settings" title={T.settings.title} sub={T.settings.sub}>
        <Cell index={0} span="lg:col-span-12">
          <RiskSettingsCard />
        </Cell>
      </Section>
    </div>
  );
}
