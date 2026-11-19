/**
 * Step 3 – Test: the rules of step 2 on the example candles, with the lab's engine and statistics (`runDemoBacktest`), the funnel
 * that shows where the signals stay, the figures with their intervals and – in plain sentences with the run's own numbers – what
 * they mean and what they do not. Starts on a click; a change of the rules marks the figures as belonging to the previous version.
 */
import { useMemo, useRef } from "react";
import { plainText } from "@/domain/demo/ideas";
import { meaningLines, DEMO_ASSUMPTIONS, runDemoBacktest, type DemoRun } from "@/domain/demo/backtest";
import { EXIT_LABEL } from "@/domain/backtest/types";
import { n0, pct0, pf as fmtPf, r as fmtR, signed } from "@/lib/format";
import { Button } from "@/primitives/Button";
import { useWidth } from "@/views/timemachine/parts";
import { closeDemo } from "./demoStore";
import { DemoCard, Fig } from "./DemoCard";
import { useDemoRules } from "./RulesStep";
import { patch, useSession } from "./session";
import { TEST } from "./strings";

async function openLab(): Promise<void> {
  closeDemo();
  const { openFeature } = await import("@/app/featureOpen");
  openFeature("eigene-idee");
}

/** The account curve as a plain SVG line (decorative; the figures are in text). */
function Curve({ values, capital }: { values: readonly number[]; capital: number }) {
  const host = useRef<HTMLDivElement>(null);
  const W = useWidth(host, 520);
  const H = 110;
  const lo = Math.min(capital, ...values);
  const hi = Math.max(capital, ...values);
  const span = hi - lo || 1;
  const y = (v: number): number => 8 + ((hi - v) / span) * (H - 16);
  const pts = values.map((v, i) => `${(6 + (i / Math.max(1, values.length - 1)) * (W - 12)).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const end = values[values.length - 1] ?? capital;
  return (
    <div ref={host} className="w-full min-w-0" data-testid="demo-curve">
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${TEST.curveLabel}: Start ${n0(capital)}, Ende ${n0(end)}`} className="block max-w-full">
        <rect width={W} height={H} rx={10} className="fill-ink-950/50" />
        <line x1={6} x2={W - 6} y1={y(capital)} y2={y(capital)} stroke="currentColor" className="text-mute" strokeDasharray="3 4" strokeWidth={1} />
        {values.length > 1 && <polyline points={pts} fill="none" stroke="currentColor" className={end >= capital ? "text-win" : "text-loss"} strokeWidth={1.75} strokeLinejoin="round" />}
      </svg>
    </div>
  );
}

function Result({ run, stale }: { run: DemoRun; stale: boolean }) {
  const s = run.stats;
  if (run.status !== "ok" || !s) {
    return (
      <p className="rounded-xl border border-warn/30 bg-warn/[0.06] px-3 py-2.5 text-[13px] leading-relaxed text-fg" role="status" data-testid="demo-test-problem">
        {run.status === "invalid" ? TEST.invalid(run.reason ?? "") : TEST.nodata(run.reason ?? "")}
      </p>
    );
  }
  const meaning = meaningLines(run);
  const nodes = run.funnel?.nodes ?? [];
  return (
    <div className="grid gap-4" data-testid="demo-test-result" data-n={s.n} data-stale={stale ? "1" : "0"}>
      {stale && (
        <p className="rounded-xl border border-warn/30 bg-warn/[0.06] px-3 py-2 text-[12.5px] text-fg" role="status" data-testid="demo-test-stale">
          {TEST.stale}
        </p>
      )}
      {run.note && <p className="text-[12.5px] leading-relaxed text-mute">{run.note}</p>}
      <section className="grid gap-2" aria-label={TEST.tilesTitle}>
        <h3 className="label">{TEST.tilesTitle}</h3>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Fig label={TEST.tile.trades} value={s.n} testId="demo-fig-n" />
          <Fig label={TEST.tile.rate} value={s.winRate == null ? "–" : pct0(s.winRate)} sub={s.winRateCI ? `80 %-Spanne ${pct0(s.winRateCI.lo).replace(" %", "")}–${pct0(s.winRateCI.hi)}` : undefined} testId="demo-fig-rate" />
          <Fig label={TEST.tile.avgR} value={s.avgR == null ? "–" : fmtR(s.avgR)} sub={s.rCI ? `80 %-Spanne ${signed(s.rCI.lo, 2)} bis ${signed(s.rCI.hi, 2)}` : undefined} tone={s.avgR == null ? undefined : s.avgR > 0 ? "win" : s.avgR < 0 ? "loss" : undefined} testId="demo-fig-avgr" />
          <Fig label={TEST.tile.net} value={`${signed(s.netPct * 100, 1)} %`} sub={`${signed(s.net, 0)} von ${n0(10000)}`} tone={s.net > 0 ? "win" : s.net < 0 ? "loss" : undefined} testId="demo-fig-net" />
          <Fig label={TEST.tile.dd} value={pct0(s.maxDD)} testId="demo-fig-dd" />
          <Fig label={TEST.tile.pf} value={fmtPf(s.pf)} testId="demo-fig-pf" />
        </div>
      </section>
      <section className="grid gap-2" aria-label={TEST.meaning} data-testid="demo-meaning">
        <h3 className="label">{TEST.meaning}</h3>
        <ul className="grid gap-1.5 text-[12.5px] leading-relaxed text-fg">
          {meaning.map((l, i) => (
            <li key={i} className="list-inside list-disc">
              {l}
            </li>
          ))}
        </ul>
      </section>
      {run.curve.length > 1 && (
        <section className="grid gap-2" aria-label={TEST.curve}>
          <h3 className="label">{TEST.curve}</h3>
          <Curve values={run.curve} capital={10000} />
        </section>
      )}
      {nodes.length > 0 && (
        <section className="grid gap-2" aria-label={TEST.funnel} data-testid="demo-funnel">
          <h3 className="label">{TEST.funnel}</h3>
          <p className="text-[12px] leading-relaxed text-mute">{TEST.funnelLead}</p>
          <ul className="grid gap-1">
            {nodes.map((nd) => {
              const total = nd.t + nd.f + nd.u;
              return (
                <li key={`${nd.side}-${nd.id}`} className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 border-b border-line/70 py-1 text-[12.5px] last:border-b-0" style={{ paddingLeft: `${nd.depth * 12}px` }}>
                  <span className="min-w-0 text-fg">{nd.label}</span>
                  <span className="num font-mono text-mute">
                    {n0(nd.t)} von {n0(total)} Kerzen{nd.u > 0 ? ` · ${n0(nd.u)} unbekannt` : ""}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="text-[12.5px] font-medium text-fg">{TEST.funnelEdges(run.funnel?.edges ?? 0, s.n)}</p>
        </section>
      )}
      {run.trades.length > 0 ? (
        <section className="grid gap-2" aria-label={TEST.tradesTitle}>
          <h3 className="label">{TEST.tradesTitle}</h3>
          <ul className="grid gap-1.5" data-testid="demo-test-trades">
            {run.trades.slice(0, 6).map((t, i) => (
              <li key={t.id} className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 rounded-xl border border-line bg-ink-950/50 px-3 py-1.5 text-[12.5px]">
                <span className="num font-mono text-fg">
                  {i + 1} · {t.side === "long" ? "Long" : "Short"} · Kerze {t.entryIndex - run.start + 1} → {t.exitIndex - run.start + 1}
                </span>
                <span className={`num font-mono ${t.r > 0 ? "text-win" : t.r < 0 ? "text-loss" : "text-fg"}`}>
                  {EXIT_LABEL[t.reason]} · {fmtR(t.r)}
                </span>
              </li>
            ))}
          </ul>
          {run.trades.length > 6 && <p className="text-[12px] text-mute">{TEST.tradesMore(run.trades.length - 6)}</p>}
        </section>
      ) : (
        <p className="text-[13px] text-fg">{TEST.none}</p>
      )}
      <section className="grid gap-1.5" aria-label={TEST.assumptions}>
        <h3 className="label">{TEST.assumptions}</h3>
        <ul className="grid gap-1 text-[12px] leading-relaxed text-mute">
          {DEMO_ASSUMPTIONS.map((a, i) => (
            <li key={i} className="list-inside list-disc">
              {a}
            </li>
          ))}
          <li className="list-inside list-disc">{`${n0(run.bars)} Kerzen, davon ${n0(run.warmupBars)} zum Aufwärmen der Regeln und ${n0(run.tradableBars)} zum Handeln.`}</li>
        </ul>
      </section>
    </div>
  );
}

export function TestStep() {
  const { rules, fromWords, mode } = useDemoRules();
  const key = useMemo(() => JSON.stringify(rules), [rules]);
  const run = useSession((s) => s.run);
  const testKey = useSession((s) => s.testKey);
  const busy = useSession((s) => s.testBusy);
  const plain = useMemo(() => plainText(rules)[0] ?? "", [rules]);
  const go = (): void => {
    patch({ testBusy: true });
    // one frame for „Rechnet …“ to paint before the (synchronous) run
    setTimeout(() => {
      const r = runDemoBacktest(rules);
      patch({ run: r, testKey: key, testBusy: false });
    }, 30);
  };
  return (
    <DemoCard step="test" title={TEST.title} lead={TEST.lead} candles>
      <div className="grid gap-1">
        <span className="label">{TEST.idea}</span>
        <p className="text-[13px] text-fg" data-testid="demo-test-idea">
          {mode === "words" && fromWords ? "Deine Idee in Worten" : "Die Baukasten-Idee"}: {plain}
        </p>
      </div>
      <div>
        <Button variant="primary" onClick={go} disabled={busy} data-testid="demo-test-run">
          {busy ? TEST.running : run ? TEST.again : TEST.run}
        </Button>
      </div>
      {run && <Result run={run} stale={testKey !== key} />}
      {run && run.status === "ok" && (
        <div>
          <Button size="sm" onClick={() => void openLab()} data-testid="demo-open-lab">
            {TEST.openLab}
          </Button>
        </div>
      )}
    </DemoCard>
  );
}
