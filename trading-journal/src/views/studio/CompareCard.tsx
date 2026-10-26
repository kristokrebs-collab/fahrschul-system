/**
 * "Alle testen": the ticked strategies on the same candles, window, costs and train / test cut (`compareStrategies`),
 * as one table with a rank. Honest by construction: the number of compared strategies is on screen BEFORE and after the run,
 * the multiple-testing note names it (the more you compare, the likelier one wins by chance), the sample size of every row is
 * flagged, and the rank says whether it rests on the unseen test window. The ticked strategies can also all run as paper
 * accounts at once (the lab's forward test – never real money, never an order).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { multipleTestingNote, PERIOD_LABEL, STUDIO_PERIODS, type StoredStrategy } from "@/domain/strategytext";
import { normalizeWatchSymbol } from "@/domain/boxes";
import { Button } from "@/primitives/Button";
import { Card } from "@/primitives/Card";
import { Input } from "@/primitives/Input";
import { pushToast } from "@/store/uiStore";
import { ChipPick, FieldRow } from "@/views/labor/ui";
import { CompareTable, type RowLabel } from "./CompareTable";
import { startLiveAll } from "./live";
import { useStudio } from "./studioStore";
import { STUDIO } from "./strings";
import { Bar, dateText, Disclaimer } from "./ui";

const C = STUDIO.compare;

function LiveAll({ strategies }: { strategies: StoredStrategy[] }) {
  const selected = useStudio((s) => s.selected);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const chosen = strategies.filter((s) => selected.includes(s.id));
  const withVersion = chosen.filter((s) => s.versions.length > 0);
  if (chosen.length === 0) return null;
  const go = async (): Promise<void> => {
    setBusy(true);
    const res = await startLiveAll(withVersion.map((s) => s.id));
    setBusy(false);
    setConfirm(false);
    pushToast({ kind: res.failed.length ? "info" : "success", title: C.liveAllDone(res.started.length, res.failed.length), ...(res.failed[0] ? { detail: `${res.failed[0].name}: ${res.failed[0].error}` } : {}) });
  };
  return (
    <div className="grid gap-3" data-testid="studio-live-all">
      {!confirm ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => setConfirm(true)} disabled={withVersion.length === 0} data-testid="studio-live-all-start">
            {C.liveAll}
          </Button>
          {withVersion.length < chosen.length && <span className="text-[12.5px] text-faint">{C.saveFirst}</span>}
        </div>
      ) : (
        <div className="grid gap-3 rounded-xl border border-line-2 bg-ink-950/60 p-3" role="group" aria-label={C.liveAll} data-testid="studio-live-all-confirm">
          <p className="text-[12.5px] leading-relaxed text-fg/90">{C.liveAllExplain}</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => void go()} disabled={busy} data-testid="studio-live-all-yes">
              {C.liveAllConfirm(withVersion.length)}
            </Button>
            <Button onClick={() => setConfirm(false)} disabled={busy}>
              {STUDIO.live.cancel}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function CompareCard({ strategies, className }: { strategies: StoredStrategy[]; className?: string }) {
  const cmp = useStudio((s) => s.cmp);
  const setup = useStudio((s) => s.cmpSetup);
  const selected = useStudio((s) => s.selected);
  const tried = useStudio((s) => s.tried.length);
  const ref = useRef<HTMLDivElement>(null);
  const busy = cmp.status === "loading" || cmp.status === "running";
  const symOk = normalizeWatchSymbol(setup.symbol) != null;
  const pickedCount = strategies.filter((s) => selected.includes(s.id)).length;
  const run = cmp.run;

  // the result appears far from the button on a phone: bring it into view once the run starts
  useEffect(() => {
    if (cmp.status === "loading") ref.current?.scrollIntoView?.({ block: "start", behavior: "smooth" });
  }, [cmp.status, cmp.seq]);

  const labels = useMemo(() => {
    const out: Record<string, RowLabel> = {};
    for (const m of cmp.items) out[m.id] = { name: m.name, tag: C.version(m.versionNo) };
    return out;
  }, [cmp.items]);
  const before = useMemo(() => multipleTestingNote(pickedCount, Math.max(0, tried)), [pickedCount, tried]);
  const comparedCount = run ? run.result.multiple.count : pickedCount;
  const startedAt = run ? run.result.window : null;

  return (
    <Card title={C.title} note={C.note} className={className} data-testid="studio-compare" data-status={cmp.status}>
      <div ref={ref} className="grid gap-4 scroll-mt-20">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
          <FieldRow label={C.market} htmlFor="studio-cmp-symbol" hint={!symOk ? <span className="text-(--color-danger-text)">{STUDIO.editor.marketInvalid}</span> : undefined}>
            <Input id="studio-cmp-symbol" value={setup.symbol} onChange={(e) => useStudio.getState().setCmpSetup({ symbol: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 24) })} className="font-mono uppercase" autoComplete="off" spellCheck={false} invalid={!symOk} data-testid="studio-cmp-symbol" />
          </FieldRow>
          <FieldRow label={C.period}>
            <ChipPick id="studio-cmp-period" label={C.period} value={setup.period} options={STUDIO_PERIODS.map((p) => ({ v: p, label: PERIOD_LABEL[p] }))} onChange={(p) => useStudio.getState().setCmpSetup({ period: p })} />
          </FieldRow>
        </div>

        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1" data-testid="studio-cmp-count">
          <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">{C.compared}</span>
          <span className="num font-mono text-[22px] font-medium text-fg" data-testid="studio-cmp-n">
            {comparedCount}
          </span>
          {tried > 0 && comparedCount > 0 && <span className="text-[12px] text-faint">{tried === 1 ? "1 Variante in dieser Sitzung geprüft." : `${tried} Varianten in dieser Sitzung geprüft.`}</span>}
        </div>

        {!run && !busy && pickedCount >= 2 && (
          <p className="rounded-xl border border-warn/25 bg-warn/[0.05] px-3 py-2.5 text-[12.5px] leading-snug text-fg/90" data-testid="studio-cmp-before">
            {before.text}
          </p>
        )}
        {!run && !busy && pickedCount < 2 && cmp.status !== "error" && (
          <p className="text-[13px] text-mute" data-testid="studio-cmp-hint">
            {pickedCount === 1 ? C.pickOne : C.pickNone}
          </p>
        )}

        {busy && <Bar fraction={cmp.progress} label={cmp.status === "loading" ? C.loading : C.running(Math.floor(cmp.progress * 100))} testId="studio-cmp-progress" />}
        {cmp.error && !busy && (
          <p role="alert" className="text-[13px] text-(--color-danger-text)" data-testid="studio-cmp-error">
            {cmp.error}
          </p>
        )}

        {run && !busy && (
          <div className="grid gap-4" data-testid="studio-cmp-result">
            <div className="rounded-xl border border-warn/30 bg-warn/[0.06] px-3 py-2.5" data-testid="studio-cmp-multiple">
              <p className="text-[12.5px] font-medium text-warn">
                {C.compared}: {run.result.multiple.count}
                {run.result.multiple.trials > run.result.multiple.count ? ` (+ ${run.result.multiple.trials - run.result.multiple.count} früher geprüft)` : ""}
              </p>
              <p className="mt-1 text-[12.5px] leading-snug text-fg/90">{run.result.multiple.text}</p>
            </div>

            <CompareTable result={run.result} labels={labels} />

            {startedAt && (
              <p className="text-[12px] text-faint" data-testid="studio-cmp-window">
                {C.window(dateText(startedAt.fromMs), dateText(startedAt.cutMs), dateText(startedAt.toMs))} {run.symbol} · {PERIOD_LABEL[run.period]}.{" "}
                {run.result.rankBasis === "test" ? C.basisTest : run.result.rankBasis === "all" ? C.basisAll : ""}
              </p>
            )}
            <ul className="grid gap-1.5" aria-label="Hinweise" data-testid="studio-cmp-warnings">
              {run.result.warnings.slice(1).map((w) => (
                <li key={w} className="text-[12px] leading-snug text-mute">
                  {w}
                </li>
              ))}
            </ul>
          </div>
        )}

        {cmp.skipped.length > 0 && !busy && (
          <div className="grid gap-1.5" data-testid="studio-cmp-skipped">
            <h3 className="text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">{C.skipped}</h3>
            <ul className="grid gap-1">
              {cmp.skipped.map((s) => (
                <li key={s.id} className="text-[12.5px] text-mute">
                  {C.notReady(s.name, s.why)}
                </li>
              ))}
            </ul>
          </div>
        )}

        <LiveAll strategies={strategies} />
        <Disclaimer past />
      </div>
    </Card>
  );
}
