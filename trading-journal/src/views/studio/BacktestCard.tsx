/**
 * "Backtest": the open strategy's rules on real candles of the chosen market and period, through the lab's own engine –
 * trades, win rate, Ø R, profit factor, max drawdown, the equity curve, an honest sentence about the sample size, the
 * train / test split when the run has one, and the lab's observations (`diagnoseRun`, deterministic). The card ends with the
 * one calm sentence that a backtest shows the past, and the disclaimer.
 */
import { useMemo } from "react";
import { feePreset, type LabResult, type RunStats, type SlippageModel } from "@/domain/backtest/index";
import { customKey, diagnoseRun } from "@/domain/lab";
import { PERIOD_LABEL } from "@/domain/strategytext";
import { cn } from "@/lib/cn";
import { EquityDraw } from "@/motion/fx";
import { Badge } from "@/primitives/Badge";
import { Button } from "@/primitives/Button";
import { Card } from "@/primitives/Card";
import { useLabor } from "@/views/labor/laborStore";
import { Kpi, moneyText, numText, pctText, pfText, rText } from "@/views/labor/ui";
import { whyNotReady } from "./resolve";
import type { StudioRun } from "./runner";
import { useStudio } from "./studioStore";
import { STUDIO } from "./strings";
import { Bar, Disclaimer, dateTimeText, Mini } from "./ui";

const B = STUDIO.backtest;

const SLIP = (s: SlippageModel): string => (s.kind === "fixed" ? `Slippage fix ${s.bps} bp` : s.kind === "spread" ? `Spread ${s.bps} bp` : s.kind === "atr" ? `Slippage ${Math.round(s.frac * 100)} % ATR` : "ohne Slippage");
const FUND: Record<string, string> = { history: "echtes Funding", flat: "Funding pauschal", none: "ohne Funding" };

function useCostsLine(): string {
  const cfg = useLabor((s) => s.cfg);
  const fee = feePreset(cfg.exchange);
  return B.costs(`Gebühren ${fee.label ?? cfg.exchange}`, SLIP(cfg.slippage), FUND[cfg.funding] ?? cfg.funding);
}

function Split({ result }: { result: LabResult }) {
  const sp = result.split;
  const row = (title: string, s: RunStats | null, testId: string) => (
    <div className="grid gap-1 rounded-xl border border-line bg-ink-950/50 px-3 py-2.5" data-testid={testId}>
      <Mini>{title}</Mini>
      {s ? (
        <p className="num font-mono text-[13px] text-fg">
          {s.n} Trades · Ø {rText(s.avgR)} · {s.winRate == null ? "–" : `${Math.round(s.winRate * 100)} %`} · PF {pfText(s.pf)}
        </p>
      ) : (
        <p className="text-[12.5px] text-mute">–</p>
      )}
    </div>
  );
  return (
    <div className="grid gap-2" data-testid="studio-split">
      <Mini>{B.split.title}</Mini>
      {sp.params && sp.is && sp.oos ? (
        <>
          <div className="grid gap-2 sm:grid-cols-2">
            {row(B.split.train, sp.is, "studio-split-train")}
            {row(B.split.test, sp.oos, "studio-split-test")}
          </div>
          <p className="text-[11.5px] text-faint">{B.split.note}</p>
        </>
      ) : (
        <p className="text-[12.5px] text-mute">{B.split.none}</p>
      )}
    </div>
  );
}

function Findings({ run }: { run: StudioRun }) {
  const d = useMemo(() => {
    const fee = feePreset(run.cfg.exchange);
    return diagnoseRun(
      run.result,
      { strategy: "custom", costs: { exchange: fee.exchange, makerBps: fee.makerBps, takerBps: fee.takerBps, slippage: run.cfg.slippage, funding: run.fundingUsed }, capital: run.cfg.capital, riskPct: run.cfg.riskPct, maxLeverage: run.cfg.maxLeverage, custom: run.config },
      { bars: run.bars },
    );
  }, [run]);
  const top = d.findings.slice(0, 3);
  if (top.length === 0) return null;
  return (
    <div className="grid gap-2" data-testid="studio-findings">
      <Mini>{B.findings}</Mini>
      <ol className="grid gap-2">
        {top.map((f) => (
          <li key={f.id} className="grid gap-0.5 rounded-xl border border-line bg-ink-950/50 px-3 py-2">
            <span className="text-[13px] font-medium text-fg">{f.title}</span>
            <span className="text-[12.5px] leading-snug text-mute">{f.text}</span>
          </li>
        ))}
      </ol>
      <p className="text-[11.5px] text-faint">{B.findingsNote}</p>
    </div>
  );
}

function Result({ run, outdated, seq }: { run: StudioRun; outdated: boolean; seq: number }) {
  const r = run.result;
  const s = r.stats;
  const values = useMemo(() => r.equity.map((p) => p.equity), [r.equity]);
  const capital = r.equity[0]?.equity ?? 0;
  const small = s.n < 30;
  return (
    <div className={cn("grid gap-4", outdated && "opacity-70")} data-testid="studio-result" data-n={s.n}>
      <p className="text-[12px] text-faint" data-testid="studio-stand">
        {B.stand(run.symbol, r.interval === "1d" ? "1D" : r.interval, PERIOD_LABEL[run.period], dateTimeText(run.at))}
        {outdated ? ` · ${B.outdated}` : ` · ${B.forText}`}
      </p>

      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6" data-testid="studio-kpis">
        <Kpi label={B.kpi.trades} sub={`${s.wins} G · ${s.losses} V`}>
          <span data-testid="studio-kpi-trades">{s.n}</span>
        </Kpi>
        <Kpi label={B.kpi.winRate}>{s.winRate == null ? "–" : `${Math.round(s.winRate * 100)} %`}</Kpi>
        <Kpi label={B.kpi.avgR} tone={(s.avgR ?? 0) > 0 ? "text-win" : (s.avgR ?? 0) < 0 ? "text-loss" : undefined}>
          {rText(s.avgR)}
        </Kpi>
        <Kpi label={B.kpi.pf}>{pfText(s.pf)}</Kpi>
        <Kpi label={B.kpi.maxDD} tone={s.maxDD > 0.2 ? "text-loss" : undefined}>
          {pctText(-s.maxDD, 1, false)}
        </Kpi>
        <Kpi label={B.kpi.net} tone={s.net > 0 ? "text-win" : s.net < 0 ? "text-loss" : undefined} sub={moneyText(s.net)}>
          {pctText(s.netPct)}
        </Kpi>
      </dl>

      <div className={cn("flex flex-wrap items-start gap-2 rounded-xl border px-3 py-2.5", small ? "border-warn/30 bg-warn/[0.06]" : "border-line bg-ink-950/50")} data-testid="studio-sample" data-level={small ? "small" : "ok"}>
        <Badge tone={small ? "warn" : "mute"}>{small ? "Kleine Stichprobe" : "Stichprobe"}</Badge>
        <p className="min-w-0 flex-1 text-[12.5px] leading-snug text-fg/90">{small ? B.small(s.n) : B.enough(s.n)}</p>
      </div>

      {s.n > 0 && values.length > 1 ? (
        <div className="grid gap-1.5" data-testid="studio-equity">
          <Mini>{B.equity}</Mini>
          <EquityDraw values={values} baseline={capital} height={160} play={seq} label={`Eigenkapital von ${numText(capital, 0)} auf ${numText(values[values.length - 1], 0)} USDT über ${s.n} Trades`} />
        </div>
      ) : (
        <p className="text-[13px] text-mute">{B.noTrades}</p>
      )}

      <Split result={r} />
      <Findings run={run} />
    </div>
  );
}

export function BacktestCard({ className }: { className?: string }) {
  const bt = useStudio((s) => s.bt);
  const editor = useStudio((s) => s.editor);
  const parsed = useStudio((s) => s.parsed);
  const costs = useCostsLine();
  const busy = bt.status === "loading" || bt.status === "running";
  const hasText = editor.text.trim().length > 0;
  const fresh = parsed != null && parsed.text === editor.text;
  const why = fresh ? whyNotReady(parsed.rules, parsed) : null;
  const run = bt.run && bt.forId === editor.id ? bt.run : null;
  const outdated = run != null && (bt.forText !== editor.text || (fresh && customKey(parsed.rules) !== customKey(run.config)));
  const pct = Math.floor(bt.progress * 100);

  return (
    <Card title={B.title} note={B.note} className={className} data-testid="studio-backtest" data-status={bt.status}>
      <div className="grid gap-4">
        <p className="text-[12px] text-faint" data-testid="studio-costs">
          {costs}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {busy ? (
            <Button variant="danger" onClick={() => useStudio.getState().cancelBacktest()} data-testid="studio-cancel">
              {B.cancel}
            </Button>
          ) : (
            <Button variant="primary" onClick={() => void useStudio.getState().runBacktest()} disabled={!hasText} data-testid="studio-run">
              {B.run}
            </Button>
          )}
          {!busy && why && (
            <span className="text-[12px] text-faint" data-testid="studio-run-hint">
              {B.needsReady} {why}
            </span>
          )}
        </div>

        {busy && <Bar fraction={bt.progress} label={bt.status === "loading" && bt.load.total ? B.loading(bt.load.done, bt.load.total) : B.running(pct)} testId="studio-progress" />}
        {bt.error && !busy && (
          <p role="alert" className="text-[13px] text-(--color-danger-text)" data-testid="studio-bt-error">
            {bt.error}
          </p>
        )}
        {run && !busy && <Result run={run} outdated={outdated} seq={bt.seq} />}
        <Disclaimer past />
      </div>
    </Card>
  );
}
