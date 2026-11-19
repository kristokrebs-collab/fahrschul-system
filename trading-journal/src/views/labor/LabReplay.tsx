/**
 * Replay of a backtest trade (P07): the journal's replay chart (`ReplayChart`, lazy chunk) on the bars the run used,
 * driven by ONE MotionValue through `ScrubTimeline` (play, 1× / 2× / 4×, scrub, keys); R counter rolls, MAE / MFE count,
 * the phase label morphs. Zero React renders per bar. Mounted once by the Labor page, opened from the trade list.
 */
import { useMotionValue, useMotionValueEvent } from "motion/react";
import { lazy, Suspense, useMemo, useState } from "react";
import { EXIT_LABEL, HIST_MS, type BtTrade } from "@/domain/backtest/index";
import { cn } from "@/lib/cn";
import { date as fmtDate, price as fmtPrice, time as fmtTime } from "@/lib/format";
import { MotionNumber } from "@/motion/MotionNumber";
import { ScrubTimeline } from "@/motion/pulse/ScrubTimeline";
import { RollingDigits } from "@/motion/RollingDigits";
import { Sheet } from "@/motion/Sheet";
import { StaggerItem } from "@/motion/Stagger";
import { TextRoll } from "@/motion/TextRoll";
import { Skeleton } from "@/primitives";
import { labReplayModel, type LabReplayModel } from "./labReplay";
import { useLabor } from "./laborStore";
import { LABOR } from "./strings";

const ReplayChart = lazy(() => import("@/chart/ReplayChart"));
const CHART_H = 300;

export function LabReplayHost() {
  const id = useLabor((s) => s.replayId);
  const result = useLabor((s) => s.result);
  const bars = useLabor((s) => s.bars);
  const openReplay = useLabor((s) => s.openReplay);
  const trade = id && result ? (result.trades.find((t) => t.id === id) ?? null) : null;
  const model = useMemo(() => (trade && result ? labReplayModel(trade, bars, HIST_MS[result.interval as keyof typeof HIST_MS] ?? 14_400_000) : null), [trade, result, bars]);
  return (
    <Sheet open={!!trade} onClose={() => openReplay(null)} title={trade ? `${LABOR.replay} · ${trade.tag}` : LABOR.replay} size="lg">
      {trade && model ? <Body key={trade.id} trade={trade} model={model} interval={result!.interval} /> : null}
    </Sheet>
  );
}

function phaseOf(m: LabReplayModel, n: number): string {
  if (n <= m.trade.entryIndex) return "Vor dem Einstieg";
  if (m.trade.exitIndex != null && n > m.trade.exitIndex) return "Nach dem Ausstieg";
  return "Im Trade";
}

function Body({ trade, model, interval }: { trade: BtTrade; model: LabReplayModel; interval: string }) {
  const step = useMotionValue(0);
  const rMv = useMotionValue(0);
  const maeMv = useMotionValue(0);
  const mfeMv = useMotionValue(0);
  const [phase, setPhase] = useState(() => phaseOf(model, 0));
  useMotionValueEvent(step, "change", (v) => {
    const s = v <= 0 ? null : (model.steps[Math.min(model.steps.length, Math.floor(v)) - 1] ?? null);
    rMv.set(s?.r ?? 0);
    maeMv.set(s?.mae ?? 0);
    mfeMv.set(s?.mfe ?? 0);
    const p = phaseOf(model, Math.floor(v));
    if (p !== phase) setPhase(p);
  });
  const at = (ms: number) => `${fmtDate(new Date(ms))} ${fmtTime(new Date(ms))}`;
  const barTime = (t: number) => {
    const b = model.bars[Math.max(0, Math.min(model.bars.length - 1, Math.ceil(t) - 1))];
    return b ? at(b.time) : "–";
  };
  return (
    <div className="grid gap-4" data-testid="labor-replay">
      <StaggerItem className="flex flex-wrap items-center justify-between gap-3">
        <div className="grid gap-0.5">
          <span className={cn("font-mono text-xs font-semibold uppercase tracking-[0.12em]", trade.side === "short" ? "text-loss" : "text-win")}>{trade.side === "short" ? "▼ Short" : "▲ Long"}</span>
          <span className="text-[12.5px] text-mute">
            {at(trade.entryTime)} · {fmtPrice(trade.entry)} → {fmtPrice(trade.exit)} · {EXIT_LABEL[trade.reason]}
          </span>
        </div>
        {trade.grade && <span className="rounded-full border border-line-2 px-2.5 py-1 font-mono text-[11px] text-fg/85">{trade.grade}</span>}
      </StaggerItem>
      <StaggerItem>
        <Suspense fallback={<Skeleton height={CHART_H} />}>
          <ReplayChart bars={model.bars} trade={model.trade} steps={model.steps} step={step} wipeKey={trade.id} height={CHART_H} />
        </Suspense>
      </StaggerItem>
      <StaggerItem className="grid grid-cols-3 gap-2" role="group" aria-label="Replay-Werte">
        <Readout label="R">
          <RollingDigits source={rMv} decimals={2} className="dot-num text-[22px]" aria-label="R im Replay" />
        </Readout>
        <Readout label="MAE">
          <span className="text-loss">
            <MotionNumber source={maeMv} decimals={2} />
          </span>
        </Readout>
        <Readout label="MFE">
          <span className="text-win">
            <MotionNumber source={mfeMv} decimals={2} />
          </span>
        </Readout>
      </StaggerItem>
      <StaggerItem className="flex items-center justify-between text-[12px]">
        <span className="label">Phase</span>
        <span className="font-mono text-fg/85">
          <TextRoll text={phase} mode="morph" />
        </span>
      </StaggerItem>
      <StaggerItem>
        <ScrubTimeline
          label="Replay-Zeitleiste"
          title={`${model.total} Kerzen · ${interval === "1d" ? "1D" : interval}`}
          total={model.total}
          spans={model.spans}
          markers={model.markers}
          time={step}
          defaultTime={0}
          autoPlay
          playSeconds={Math.max(6, Math.min(16, model.total / 9))}
          step={1}
          bigStep={10}
          formatTime={barTime}
        />
      </StaggerItem>
      <p className="text-[11.5px] text-faint">Leertaste spielt ab, Pfeile gehen eine Kerze weiter. Kerzen aus dem Lauf, kein Blick in die Zukunft.</p>
    </div>
  );
}

function Readout({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-ink-950/50 px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">{label}</div>
      <div className="num mt-0.5 font-mono text-[15px] font-medium">{children}</div>
    </div>
  );
}
