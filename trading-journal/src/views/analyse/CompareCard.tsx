/**
 * Compare card (P03): period vs. period, Makro vs. Scalp, setup vs. setup – the same numbers on both sides, the
 * difference A − B as a whisker around zero (80 % interval, growing from its centre) and an honest verdict per row.
 * The account comparison uses ALL trades (not the account switch).
 */
import { useMemo, useState } from "react";
import { accountSplit, ANA_EMPTY, CARD_TITLES, compareSets, explainCompare, PERIOD_LABELS, periodSplit, setupSplit, type CompareRow, type PeriodPreset } from "@/domain/analytics";
import type { AccountView } from "@/domain/account";
import type { Settings } from "@/domain/types";
import { cn } from "@/lib/cn";
import { n0, pct0, pf as fmtPf, r as fmtR, signed } from "@/lib/format";
import { RevealGroup, RevealItem } from "@/motion/Reveal";
import { MorphSelect } from "@/motion/pulse/MorphSelect";
import { EmptyState } from "@/primitives/EmptyState";
import { Segmented } from "@/primitives/Segmented";
import { useAccountView } from "@/store/journalStore";
import { useAnalyseUi, type CompareMode } from "./analyseStore";
import { AnaCard, CiWhisker, SEG_TOUCH, SigBadge, whiskerDomain } from "./ui";

const MODES: { v: CompareMode; label: string }[] = [
  { v: "period", label: "Zeitraum" },
  { v: "account", label: "Konto" },
  { v: "setup", label: "Setup" },
];
/** Columns from sm: label · A · B · Δ (whisker) · verdict. */
const ROW_GRID = "grid-cols-[minmax(0,8rem)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,9rem)_5.5rem] gap-2";
const ROW_GRID_SM = "sm:grid-cols-[minmax(0,8rem)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,9rem)_5.5rem]";
const PERIODS = (Object.keys(PERIOD_LABELS) as PeriodPreset[]).map((p) => ({ value: p, label: PERIOD_LABELS[p] }));

function valueText(r: CompareRow, v: number | null, cur: string): string {
  if (v == null) return "–";
  switch (r.key) {
    case "n":
      return n0(v);
    case "winRate":
      return pct0(v);
    case "exp":
    case "net":
      return `${signed(v, 0)} ${cur}`;
    case "avgR":
      return fmtR(v);
    case "pf":
      return fmtPf(v);
  }
}
function deltaText(r: CompareRow, cur: string): string {
  if (r.delta == null) return "–";
  if (r.key === "winRate") return `${signed(r.delta * 100, 0)} pp`;
  if (r.key === "avgR") return fmtR(r.delta);
  if (r.key === "pf") return signed(r.delta, 2);
  if (r.key === "n") return signed(r.delta, 0);
  return `${signed(r.delta, 0)} ${cur}`;
}

export function CompareCard({ view, settings, cur }: { view: AccountView; settings: Settings; cur: string }) {
  const mode = useAnalyseUi((s) => s.compareMode);
  const period = useAnalyseUi((s) => s.comparePeriod);
  const pair = useAnalyseUi((s) => s.compareSetups);
  const set = useAnalyseUi((s) => s.set);
  const all = useAccountView("all");
  const [now] = useState(() => Date.now());
  const used = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of view.closed) for (const id of t.setups ?? []) counts.set(id, (counts.get(id) ?? 0) + 1);
    return settings.setups.filter((s) => counts.has(s.id)).sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0));
  }, [view.closed, settings.setups]);
  const idA = pair[0] && used.some((s) => s.id === pair[0]) ? pair[0] : (used[0]?.id ?? null);
  const idB = pair[1] && used.some((s) => s.id === pair[1]) && pair[1] !== idA ? pair[1] : (used.find((s) => s.id !== idA)?.id ?? null);
  const cmp = useMemo(() => {
    if (mode === "account") {
      const s = accountSplit(all.closed);
      return compareSets(s.a, s.b, s.labels);
    }
    if (mode === "setup") {
      if (!idA || !idB) return null;
      const name = (id: string) => settings.setups.find((s) => s.id === id)?.name ?? id;
      const s = setupSplit(view.closed, idA, idB, [name(idA), name(idB)]);
      return compareSets(s.a, s.b, s.labels);
    }
    const s = periodSplit(view.closed, period, now);
    return compareSets(s.a, s.b, s.labels);
  }, [mode, all.closed, view.closed, period, now, idA, idB, settings.setups]);
  const rows = cmp?.rows.filter((r) => r.key !== "n") ?? [];
  const setupOptions = used.map((s) => ({ value: s.id, label: s.name }));
  return (
    <AnaCard
      title={CARD_TITLES.compare}
      explain={explainCompare}
      data-testid="ana-compare"
    >
      <div className="grid gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Segmented<CompareMode> size="sm" aria-label="Vergleich" options={MODES} value={mode} onChange={(v) => set({ compareMode: v })} className={SEG_TOUCH} />
          {mode === "period" && <MorphSelect<PeriodPreset> value={period} onChange={(v) => set({ comparePeriod: v })} options={PERIODS} aria-label="Zeitraum" size="sm" className="w-44" data-testid="cmp-period" />}
        </div>
        {mode === "setup" &&
          (used.length < 2 ? (
            <p className="text-[12px] text-faint">Für den Vergleich brauchst du Trades mit mindestens zwei verschiedenen Setups.</p>
          ) : (
            <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
              <MorphSelect<string> value={idA ?? ""} onChange={(v) => set({ compareSetups: [v, v === idB ? idA : idB] })} options={setupOptions} aria-label="Setup A" size="sm" className="w-full" />
              <span className="text-[11px] text-faint">vs.</span>
              <MorphSelect<string> value={idB ?? ""} onChange={(v) => set({ compareSetups: [v === idA ? idB : idA, v] })} options={setupOptions} aria-label="Setup B" size="sm" className="w-full" />
            </div>
          ))}
        {!cmp || (!cmp.a.g.n && !cmp.b.g.n) ? (
          <EmptyState title={ANA_EMPTY.compare.title} text={ANA_EMPTY.compare.text} line={false} />
        ) : (
          <>
            {/* the two sides as a legend (full names), the columns below only "A" / "B" */}
            <p className="grid gap-0.5 text-[11.5px] sm:flex sm:flex-wrap sm:gap-x-5">
              <span className="truncate">
                <span className="font-semibold text-fg">A</span> = {cmp.a.label} <span className="text-faint">({cmp.a.g.n})</span>
              </span>
              <span className="truncate">
                <span className="font-semibold text-fg">B</span> = {cmp.b.label} <span className="text-faint">({cmp.b.g.n})</span>
              </span>
            </p>
            <div className={cn(ROW_GRID, "hidden border-b border-line pb-2 text-[11px] text-mute sm:grid")} aria-hidden="true">
              <span />
              <span className="font-semibold text-fg">A</span>
              <span className="font-semibold text-fg">B</span>
              <span>Δ A − B</span>
              <span />
            </div>
            <RevealGroup as="ul" key={`${mode}:${period}:${idA}:${idB}`} className="grid" aria-label="Vergleich">
              {rows.map((r, i) => {
                const tone = r.delta == null ? "text-faint" : r.delta > 0 ? "text-win" : r.delta < 0 ? "text-loss" : "text-faint";
                return (
                  <RevealItem as="li" key={r.key} className={cn("grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1.5 border-t border-line py-2.5 first:border-t-0", ROW_GRID_SM)} data-testid="cmp-row" data-key={r.key}>
                    <span className="truncate text-[12.5px] text-mute sm:order-1">{r.label}</span>
                    <span className="justify-self-end sm:order-5">{r.p != null || r.verdict === "wenig" ? <SigBadge verdict={r.verdict} /> : null}</span>
                    <span className="col-span-2 grid grid-cols-3 gap-2 sm:contents">
                      <span className={cn("num truncate font-mono text-[12.5px] sm:order-2", r.better === "a" ? "text-fg" : "text-mute")}>
                        <span className="text-faint sm:hidden">A </span>
                        {valueText(r, r.a, cur)}
                      </span>
                      <span className={cn("num truncate font-mono text-[12.5px] sm:order-3", r.better === "b" ? "text-fg" : "text-mute")}>
                        <span className="text-faint sm:hidden">B </span>
                        {valueText(r, r.b, cur)}
                      </span>
                      <span className={cn("num truncate text-right font-mono text-[12px] sm:hidden", tone)}>Δ {deltaText(r, cur)}</span>
                    </span>
                    <span className={cn("col-span-2 grid gap-0.5 sm:order-4 sm:col-span-1", !r.ci && "max-sm:hidden")}>
                      {r.ci ? <CiWhisker ci={r.ci} value={r.delta} domain={whiskerDomain([r.ci], [r.delta])} index={i} /> : null}
                      <span className={cn("num hidden font-mono text-[10.5px] sm:block", tone)}>{deltaText(r, cur)}</span>
                    </span>
                  </RevealItem>
                );
              })}
            </RevealGroup>
          </>
        )}
      </div>
    </AnaCard>
  );
}
