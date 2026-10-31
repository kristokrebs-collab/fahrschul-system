/**
 * Berichte page (P04, `h1 Berichte`): day, week, month, quarter and year reports of the account of the Hero's switch
 * (`uiStore.acc`), built on the device from the journal (`@/domain/reports`). Every finished period with trades is in
 * the archive automatically; the running period can be opened too ("läuft noch").
 *
 *   header             title, lead, account switch
 *   toolbar (12)       kind · ‹ period › · "Neuester" / "Laufend" · focus chips (the hero's split flap rolls along)
 *   Hero (8) · side (4) report hero (net, figures, curve with strip wipe, highlights) · Export + Archiv
 *   sections (focus)   Performance (7) · Vergleich (5) · Strategie (7) · Risiko (5) · Psychologie (6) · Fehler (6) ·
 *                      Zielerreichung (12) · week report only: Wochenreview (7) · Wochenexperiment (5) (F37) ·
 *                      month report only: Monatsnutzen (12) (F60)
 *
 * Opening a finished report marks it seen (`settings.coach.reports.seen`, after a short look – flipping through does
 * not count). Registered by the integrator (P14) as page `berichte`.
 */
import { Fold } from "@/primitives/Fold";
import { lazy, Suspense, useEffect, useMemo, type ReactNode } from "react";
import { ACCOUNT_LABELS } from "@/domain/defaults";
import { BERICHTE_HIGHLIGHT, BERICHTE_LEAD, BERICHTE_TITLE, withReportSeen } from "@/domain/coach";
import { FOCUS_LABEL, KIND_LABEL, REPORT_FOCI, REPORT_KINDS, periodOf, shiftPeriod, type ReportFocus, type ReportKind } from "@/domain/reports";
import { cn } from "@/lib/cn";
import { textLink } from "@/lib/textLink";
import { tradeTime } from "@/lib/dates";
import { useCloseMorphDialogOnUnmount } from "@/motion/MorphDialog";
import { Reveal } from "@/motion/Reveal";
import { Card } from "@/primitives/Card";
import { FeatureLinks } from "@/app/FeatureLinks";
import { Later } from "@/primitives/Later";
import { RESERVE_CLASS, RESERVE_CLASS_DEFER, reserveStyle, type ReserveHeight } from "@/primitives/Reserve";
import { SectionNav, type SectionNavItem } from "@/primitives/SectionNav";
import { Segmented } from "@/primitives/Segmented";
import { Skeleton } from "@/primitives/Skeleton";
import { useJournal } from "@/store/journalStore";
import { storageKey } from "@/store/storage";
import { useUi, type AccFilter } from "@/store/uiStore";
import { AnalysisNote } from "@/ui/AnalysisNote";
import { SEG_TOUCH } from "@/views/insights/ui";
import { PageHeader } from "@/views/setups/PageHeader";
import { ArchiveCard } from "./ArchiveCard";
import { useBerichteUi } from "./berichteStore";
import { ExportCard } from "./ExportCard";
import { useReportPage } from "./hooks";
import { ReportHero } from "./ReportHero";
import { MonthBenefitCard } from "./MonthBenefitCard";
import { ExperimentCard, experimentVisible, WeekReviewCard } from "./WeekReview";
import { CompareCard, GoalsCard, MistakesCard, PerformanceCard, PsychCard, ReportRiskCard, StrategyCard } from "./sections";

// F70: das Transaktionsbuch (Hilfsrechnung) – eigener Chunk, geladen mit der Seite
const LedgerSection = lazy(() => import("./ledger/LedgerSection"));

export const BERICHTE_LEAD_FILL = { storageKey: storageKey("fill-berichte"), highlight: BERICHTE_HIGHLIGHT } as const;
/** A finished report counts as opened after this long on screen. */
export const SEEN_AFTER_MS = 1500;

const ACC_OPTIONS = (["all", "makro", "scalp"] as const).map((v) => ({ v, label: ACCOUNT_LABELS[v] }));
const KIND_OPTIONS = REPORT_KINDS.map((v) => ({ v, label: KIND_LABEL[v] }));

/**
 * `size` = the END size of the card in this cell (px at 390 / 640 / 1024+, measured on the finished page with all cards shown): a cell
 * below the first screenful skips style, layout and paint while far away (`Reveal defer`), holds that size and mounts its card after
 * the page has painted (`Later`), one per idle slice. Only for the full report (focus „Alles“) – a single card at full width is
 * shorter, there the cell simply follows its content.
 */
function Cell({ index, span, size, children }: { index: number; span: string; size?: ReserveHeight; children: ReactNode }) {
  return (
    <Reveal index={index} defer={size} className={cn("flex min-w-0 flex-col [&>*]:flex-1", size && RESERVE_CLASS_DEFER, span)}>
      {size ? <Later>{children}</Later> : children}
    </Reveal>
  );
}

const SIZE = {
  performance: { base: 376, sm: 282, lg: 333 },
  compare: { base: 333, sm: 333, lg: 333 },
  strategy: { base: 373, sm: 277, lg: 410 },
  risk: { base: 410, sm: 410, lg: 410 },
  psych: { base: 338, sm: 276, lg: 276 },
  mistakes: { base: 185, sm: 169, lg: 276 },
  goals: { base: 410, sm: 237, lg: 237 },
  review: { base: 907, sm: 774, lg: 754 },
} as const satisfies Record<string, ReserveHeight>;

function Arrow({ dir, onClick, disabled, label }: { dir: "prev" | "next"; onClick: () => void; disabled?: boolean; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      data-testid={`report-${dir}`}
      className="touch-hit grid size-10 shrink-0 place-items-center rounded-full border border-line-2 text-mute transition-colors hover:border-steel/40 hover:text-fg disabled:opacity-35 disabled:hover:border-line-2 disabled:hover:text-mute"
    >
      <svg viewBox="0 0 16 16" className="size-4" aria-hidden="true">
        <path d={dir === "prev" ? "M10 3.5 5.5 8l4.5 4.5" : "M6 3.5 10.5 8 6 12.5"} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

export function BerichteView({ className }: { className?: string }) {
  const page = useReportPage();
  const { report, period, archive, kind, now, settings } = page;
  const setAcc = useUi((s) => s.setAcc);
  const setKind = useBerichteUi((s) => s.setKind);
  const setPeriod = useBerichteUi((s) => s.setPeriod);
  const focus = useBerichteUi((s) => s.focus);
  const setFocus = useBerichteUi((s) => s.setFocus);
  const dir = useBerichteUi((s) => s.dir);
  const saveSettings = useJournal((s) => s.saveSettings);
  useCloseMorphDialogOnUnmount();

  const next = shiftPeriod(period, 1);
  const canNext = next.from <= now;
  // back only while older trades exist (no endless walk through empty periods)
  const canPrev = useMemo(() => page.view.closed.some((t) => +tradeTime(t) < period.from), [page.view.closed, period.from]);
  const newest = archive[0]?.period.key ?? null;
  const running = periodOf(kind, now);

  // a finished report that stays on screen for a moment counts as opened
  const key = report.complete && !report.empty ? period.key : null;
  useEffect(() => {
    if (!key) return;
    const t = setTimeout(() => {
      const s = useJournal.getState().settings;
      const nextSettings = withReportSeen(s, [key]);
      if (nextSettings !== s) void saveSettings(nextSettings);
    }, SEEN_AFTER_MS);
    return () => clearTimeout(t);
  }, [key, saveSettings]);

  const show = (s: Exclude<ReportFocus, "all">) => focus === "all" || focus === s;
  const showExperiment = focus === "all" && kind === "week" && experimentVisible(page);
  // the cards on the page right now (they follow the focus and the kind of report), for the "Inhalt" strip
  const nav: SectionNavItem[] = [
    { id: "report-hero", label: "Bericht" },
    { id: "report-export", label: "Export" },
    { id: "report-archive", label: "Archiv" },
    ...(report.empty
      ? []
      : [
          ...(focus === "all" ? [{ id: "report-performance", label: "Performance" }, { id: "report-compare", label: "Vergleich" }] : []),
          ...(show("strategy") ? [{ id: "report-strategy", label: "Strategie" }] : []),
          ...(show("risk") ? [{ id: "report-risk", label: "Risiko" }] : []),
          ...(show("psychology") ? [{ id: "report-psych", label: "Psychologie" }] : []),
          ...(show("mistakes") ? [{ id: "report-mistakes", label: "Fehler" }] : []),
          ...(focus === "all" ? [{ id: "report-goals", label: "Ziele" }] : []),
          ...(focus === "all" && kind === "week" ? [{ id: "week-review", label: "Wochenreview" }] : []),
        ]),
    ...(showExperiment ? [{ id: "week-experiment", label: "Experiment" }] : []),
    ...(focus === "all" && kind === "month" ? [{ id: "benefit-card", label: "Monatsnutzen" }] : []),
    { id: "ledger-card", label: "Transaktionsbuch" },
  ];
  return (
    <div className={cn("grid grid-cols-1 gap-5 lg:grid-cols-12", className)} data-testid="berichte-view" data-kind={kind} data-key={period.key}>
      <PageHeader
        className="lg:col-span-12"
        title={BERICHTE_TITLE}
        lead={BERICHTE_LEAD}
        leadFill={BERICHTE_LEAD_FILL}
        action={<Segmented<AccFilter> aria-label="Konto der Berichte" options={ACC_OPTIONS} value={page.acc} onChange={setAcc} size="sm" className={SEG_TOUCH} />}
      />

      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-3 lg:col-span-12" data-testid="report-toolbar">
        <Segmented<ReportKind> aria-label="Art des Berichts" options={KIND_OPTIONS} value={kind} onChange={setKind} size="sm" className={SEG_TOUCH} />
        <div className="flex min-w-0 items-center gap-2" role="group" aria-label="Zeitraum">
          <Arrow dir="prev" label="Vorheriger Zeitraum" onClick={() => setPeriod(shiftPeriod(period, -1).key, "down")} disabled={!canPrev} />
          <span className="num min-w-[4.75rem] text-center font-mono text-[13px] text-fg" data-testid="report-period-label">
            {period.short}
          </span>
          <Arrow dir="next" label="Nächster Zeitraum" onClick={() => setPeriod(next.key, "up")} disabled={!canNext} />
          {newest && newest !== period.key ? (
            <button type="button" onClick={() => setPeriod(newest, newest > period.key ? "up" : "down")} className={cn(textLink, "ml-1 text-[12px]")} data-testid="report-newest">
              Neuester
            </button>
          ) : running.key !== period.key ? (
            <button type="button" onClick={() => setPeriod(running.key, "up")} className={cn(textLink, "ml-1 text-[12px]")} data-testid="report-running">
              Laufend
            </button>
          ) : null}
        </div>
        <div className="flex min-w-0 flex-wrap gap-1.5 lg:ml-auto" role="group" aria-label="Fokus des Berichts">
          {REPORT_FOCI.map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={focus === f}
              onClick={() => setFocus(f)}
              data-testid="report-focus"
              className={cn("touch-hit min-h-8 rounded-full border px-3 py-1 text-[12px] transition-colors pointer-coarse:min-h-11", focus === f ? "border-line-2 bg-ink-750 text-fg" : "border-line-2 text-mute hover:border-steel/40 hover:text-fg")}
            >
              {FOCUS_LABEL[f]}
            </button>
          ))}
        </div>
      </div>

      <SectionNav items={nav} className="lg:col-span-12" />

      <Cell index={0} span="lg:col-span-8">
        <ReportHero report={report} dir={dir} />
      </Cell>
      <div className="grid min-w-0 content-start gap-5 lg:col-span-4">
        <Reveal index={1} className="min-w-0">
          <ExportCard report={report} focus={focus} />
        </Reveal>
        <Reveal index={2} className="min-w-0">
          <ArchiveCard archive={archive} kind={kind} current={period.key} cur={settings.currency} now={now} />
        </Reveal>
      </div>

      {!report.empty && (
        <>
          {focus === "all" && (
            <>
              <Cell index={0} span="lg:col-span-7" size={SIZE.performance}>
                <PerformanceCard report={report} bars={page.bars} />
              </Cell>
              <Cell index={1} span="lg:col-span-5" size={SIZE.compare}>
                <CompareCard report={report} />
              </Cell>
            </>
          )}
          {show("strategy") && (
            <Cell index={0} span={focus === "all" ? "lg:col-span-7" : "lg:col-span-12"} size={focus === "all" ? SIZE.strategy : undefined}>
              <StrategyCard report={report} />
            </Cell>
          )}
          {show("risk") && (
            <Cell index={1} span={focus === "all" ? "lg:col-span-5" : "lg:col-span-12"} size={focus === "all" ? SIZE.risk : undefined}>
              <ReportRiskCard report={report} />
            </Cell>
          )}
          {show("psychology") && (
            // 7 / 5 like the rows above – the column gutter runs through (P2-14)
            <Cell index={0} span={focus === "all" ? "lg:col-span-7" : "lg:col-span-12"} size={focus === "all" ? SIZE.psych : undefined}>
              <PsychCard report={report} />
            </Cell>
          )}
          {show("mistakes") && (
            <Cell index={1} span={focus === "all" ? "lg:col-span-5" : "lg:col-span-12"} size={focus === "all" ? SIZE.mistakes : undefined}>
              <MistakesCard report={report} />
            </Cell>
          )}
          {focus === "all" && (
            <Cell index={0} span="lg:col-span-12" size={SIZE.goals}>
              <GoalsCard report={report} />
            </Cell>
          )}
          {focus === "all" && kind === "week" && (
            <Cell index={0} span={showExperiment ? "lg:col-span-7" : "lg:col-span-12"} size={SIZE.review}>
              <WeekReviewCard page={page} />
            </Cell>
          )}
        </>
      )}
      {/* also for a week without trades: an accepted experiment of that week is read there („zu wenig Daten“) */}
      {showExperiment && (
        <Cell index={1} span="lg:col-span-5">
          <ExperimentCard page={page} />
        </Cell>
      )}
      {/* F60: the month's look back – also for a month without trades (alerts, check-ins and experiments are recorded too) */}
      {focus === "all" && kind === "month" && (
        <Cell index={0} span="lg:col-span-12">
          <MonthBenefitCard page={page} />
        </Cell>
      )}
      {/* F70: independent of the period and the focus – the whole journal as a ledger */}
      {/* no `Cell` (Reveal): the ledger grows with every 50 rows and a reveal waits for 15 % of its element in view – a card that tall would stay at opacity 0 */}
      <Fold id="berichte-ledger" title="Transaktionsbuch" hint="Käufe, Verkäufe, Gebühren und Funding aus deinem Journal, mit Abgleich und CSV" className="lg:col-span-12">
        <Suspense
          fallback={
            // the head of the book alone (year, zone, summary, reconciliation) is ≈ 640 px at 1280 and ≈ 900 px at 390: the floor of the
            // placeholder; the rows come below it (50 per page), so the scroll bar of the page does not jump by thousands of px
            <div className={RESERVE_CLASS} style={reserveStyle({ base: 900, lg: 640 })} data-testid="ledger-loading" aria-busy="true">
              <Card title="Transaktionsbuch" className="h-full">
                <Skeleton className="h-[780px] lg:h-[520px]" />
              </Card>
            </div>
          }
        >
          <LedgerSection acc={page.acc} />
        </Suspense>
      </Fold>
      {/* the same figures, looked at over the whole journal instead of one period */}
      <FeatureLinks
        className="lg:col-span-12"
        lead="Siehe auch"
        items={[
          { id: "kennzahlen", label: "Kennzahlen" },
          { id: "analyse-aufschluesselung", label: "Aufschlüsselung" },
          { id: "analyse-kosten", label: "Gebühren und Funding" },
        ]}
      />
      <AnalysisNote className="lg:col-span-12" lead="Berechnet aus deinem Journal – eine Rückschau, keine Prognose." />
    </div>
  );
}
