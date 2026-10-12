/**
 * Berichte page (P04, `h1 Berichte`): day, week, month, quarter and year reports of the account of the Hero's switch
 * (`uiStore.acc`), built on the device from the journal (`@/domain/reports`). Every finished period with trades is in
 * the archive automatically; the running period can be opened too ("läuft noch").
 *
 *   header             title, lead, account switch
 *   toolbar (12)       kind · ‹ period › · "Neuester" / "Laufend" · focus chips (the hero's split flap rolls along)
 *   Hero (8) · side (4) report hero (net, figures, curve with strip wipe, highlights) · Export + Archiv
 *   sections (focus)   Performance (7) · Vergleich (5) · Strategie (7) · Risiko (5) · Psychologie (6) · Fehler (6) ·
 *                      Zielerreichung (12)
 *
 * Opening a finished report marks it seen (`settings.coach.reports.seen`, after a short look – flipping through does
 * not count). Registered by the integrator (P14) as page `berichte`.
 */
import { useEffect, type ReactNode } from "react";
import { ACCOUNT_LABELS } from "@/domain/defaults";
import { BERICHTE_HIGHLIGHT, BERICHTE_LEAD, BERICHTE_TITLE, withReportSeen } from "@/domain/coach";
import { FOCUS_LABEL, KIND_LABEL, REPORT_FOCI, REPORT_KINDS, periodOf, shiftPeriod, type ReportFocus, type ReportKind } from "@/domain/reports";
import { cn } from "@/lib/cn";
import { useCloseMorphDialogOnUnmount } from "@/motion/MorphDialog";
import { Reveal } from "@/motion/Reveal";
import { Segmented } from "@/primitives/Segmented";
import { useJournal } from "@/store/journalStore";
import { storageKey } from "@/store/storage";
import { useUi, type AccFilter } from "@/store/uiStore";
import { SEG_TOUCH } from "@/views/insights/ui";
import { PageHeader } from "@/views/setups/PageHeader";
import { ArchiveCard } from "./ArchiveCard";
import { useBerichteUi } from "./berichteStore";
import { ExportCard } from "./ExportCard";
import { useReportPage } from "./hooks";
import { ReportHero } from "./ReportHero";
import { CompareCard, GoalsCard, MistakesCard, PerformanceCard, PsychCard, ReportRiskCard, StrategyCard } from "./sections";

export const BERICHTE_LEAD_FILL = { storageKey: storageKey("fill-berichte"), highlight: BERICHTE_HIGHLIGHT } as const;
/** A finished report counts as opened after this long on screen. */
export const SEEN_AFTER_MS = 1500;

const ACC_OPTIONS = (["all", "makro", "scalp"] as const).map((v) => ({ v, label: ACCOUNT_LABELS[v] }));
const KIND_OPTIONS = REPORT_KINDS.map((v) => ({ v, label: KIND_LABEL[v] }));

function Cell({ index, span, children }: { index: number; span: string; children: ReactNode }) {
  return (
    <Reveal index={index} className={cn("flex min-w-0 flex-col [&>*]:flex-1", span)}>
      {children}
    </Reveal>
  );
}

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
          <Arrow dir="prev" label="Vorheriger Zeitraum" onClick={() => setPeriod(shiftPeriod(period, -1).key, "down")} />
          <span className="num min-w-[4.75rem] text-center font-mono text-[13px] text-fg" data-testid="report-period-label">
            {period.short}
          </span>
          <Arrow dir="next" label="Nächster Zeitraum" onClick={() => setPeriod(next.key, "up")} disabled={!canNext} />
          {newest && newest !== period.key ? (
            <button type="button" onClick={() => setPeriod(newest, newest > period.key ? "up" : "down")} className="touch-hit ml-1 text-[12px] text-mute underline decoration-line-2 underline-offset-4 hover:text-fg" data-testid="report-newest">
              Neuester
            </button>
          ) : running.key !== period.key ? (
            <button type="button" onClick={() => setPeriod(running.key, "up")} className="touch-hit ml-1 text-[12px] text-mute underline decoration-line-2 underline-offset-4 hover:text-fg" data-testid="report-running">
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
              className={cn("touch-hit min-h-8 rounded-full border px-3 py-1 text-[12px] transition-colors", focus === f ? "border-fg/60 bg-fg text-ink-950" : "border-line-2 text-mute hover:border-steel/40 hover:text-fg")}
            >
              {FOCUS_LABEL[f]}
            </button>
          ))}
        </div>
      </div>

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
              <Cell index={0} span="lg:col-span-7">
                <PerformanceCard report={report} bars={page.bars} />
              </Cell>
              <Cell index={1} span="lg:col-span-5">
                <CompareCard report={report} />
              </Cell>
            </>
          )}
          {show("strategy") && (
            <Cell index={0} span={focus === "all" ? "lg:col-span-7" : "lg:col-span-12"}>
              <StrategyCard report={report} />
            </Cell>
          )}
          {show("risk") && (
            <Cell index={1} span={focus === "all" ? "lg:col-span-5" : "lg:col-span-12"}>
              <ReportRiskCard report={report} />
            </Cell>
          )}
          {show("psychology") && (
            <Cell index={0} span={focus === "all" ? "lg:col-span-6" : "lg:col-span-12"}>
              <PsychCard report={report} />
            </Cell>
          )}
          {show("mistakes") && (
            <Cell index={1} span={focus === "all" ? "lg:col-span-6" : "lg:col-span-12"}>
              <MistakesCard report={report} />
            </Cell>
          )}
          {focus === "all" && (
            <Cell index={0} span="lg:col-span-12">
              <GoalsCard report={report} />
            </Cell>
          )}
        </>
      )}
    </div>
  );
}
