import { AnimatePresence, motion, useMotionValue, useMotionValueEvent } from "motion/react";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import type { ReplayBar } from "@/chart/ReplayChart";
import type { EnrichedTrade } from "@/domain/types";
import { cn } from "@/lib/cn";
import { date as fmtDate, price as fmtPrice, time as fmtTime } from "@/lib/format";
import { useProvider } from "@/market";
import { loadBars, measurablePair, MEASURE_HINTS } from "@/market/excursion";
import { DotMatrix } from "@/motion/DotMatrix";
import { MotionNumber } from "@/motion/MotionNumber";
import { ScrubTimeline } from "@/motion/pulse/ScrubTimeline";
import { RollingDigits } from "@/motion/RollingDigits";
import { Sheet } from "@/motion/Sheet";
import { StaggerItem } from "@/motion/Stagger";
import { TextRoll } from "@/motion/TextRoll";
import { spring, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Segmented, Skeleton } from "@/primitives";
import { useEnriched } from "@/store/journalStore";
import type { BiasContext, BiasTest } from "@/domain/biasTest";
import { MirrorPanel, useMirrorState } from "@/views/biasTest";
import { BIAS } from "@/views/biasTest/strings";
import { barAt, buildReplay, defaultReplayInterval, phaseLabel, readoutAt, REPLAY_INTERVALS, replayWindow, type ReplayInterval } from "./replayModel";
import { closeReplay, useReplay } from "./replayStore";

/** The replay chart is its own lightweight-charts chunk. */
const ReplayChart = lazy(() => import("@/chart/ReplayChart"));
const CHART_H = 300;

type Load = { status: "loading" } | { status: "ok"; bars: ReplayBar[] } | { status: "error"; message: string };

/**
 * Host of the replay sheet (Journal v3): reads `useReplay` and renders `TradeReplay` for the open trade. Mounted once
 * next to the trade detail (`TradeDetail` renders it), so nothing else has to wire it.
 */
export function ReplayHost() {
  const id = useReplay((s) => s.id);
  const enriched = useEnriched();
  const trade = id ? enriched.find((t) => t.id === id) : undefined;
  return <TradeReplay trade={trade ?? null} onClose={closeReplay} />;
}

/**
 * Trade replay sheet: the trade plays bar by bar from N bars before the entry to N after the exit (`ScrubTimeline`:
 * play, 1× / 2× / 4×, scrub, keys). The chart (`ReplayChart`, lazy) shows the bars arriving, entry / exit markers pop
 * with a sonar, the MAE / MFE band grows; the R counter rolls (`RollingDigits`, velocity blur while scrubbing fast) and
 * the running MAE / MFE count. Everything follows ONE MotionValue (zero React renders per bar; only the phase label
 * re-renders when the phase changes). Honest states: no market connection, another pair than the live market, no
 * candles.
 */
export function TradeReplay({ trade, onClose }: { trade: EnrichedTrade | null; onClose: () => void }) {
  const open = trade != null;
  // blind bias test (F62): the market name stays covered in the title too
  const blindName = useMirrorState("replay").blind.hideName;
  return (
    <Sheet open={open} onClose={onClose} title={trade && !blindName ? `Replay · ${trade.pair || "Trade"}` : "Replay"} size="lg">
      {trade ? <ReplayBody key={trade.id} trade={trade} /> : null}
    </Sheet>
  );
}

function ReplayBody({ trade }: { trade: EnrichedTrade }) {
  const provider = useProvider();
  const reduced = useReducedFx();
  const [interval, setTf] = useState<ReplayInterval>(() => defaultReplayInterval(trade));
  const [load, setLoad] = useState<{ key: string; v: Load } | null>(null);
  const pairOk = measurablePair(trade.pair, provider);
  const key = `${trade.id}|${interval}|${provider?.symbol ?? ""}`;

  useEffect(() => {
    if (!provider || !pairOk) return;
    let alive = true;
    const w = replayWindow(trade, interval);
    loadBars(provider, interval, w.from, w.to).then(
      (bars) => alive && setLoad({ key, v: bars.length ? { status: "ok", bars } : { status: "error", message: MEASURE_HINTS.noData } }),
      () => alive && setLoad({ key, v: { status: "error", message: MEASURE_HINTS.failed } }),
    );
    return () => {
      alive = false;
    };
    // `key` covers trade id, interval and provider
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const state: Load = useMemo(
    () => (!provider ? { status: "error", message: MEASURE_HINTS.noProvider } : !pairOk ? { status: "error", message: `${MEASURE_HINTS.otherPair} (${provider.symbol})` } : load?.key === key ? load.v : { status: "loading" }),
    [provider, pairOk, load, key],
  );
  const model = useMemo(() => (state.status === "ok" ? buildReplay(trade, state.bars, interval) : null), [state, trade, interval]);
  const mirror = useMirrorState("replay");
  // the header tells the position and the result: covered in a blind test, and the exit never shows while the picture is frozen
  const coverPosition = mirror.blind.hidePosition;
  const coverResult = mirror.frozen || mirror.blind.hidePnl || coverPosition;

  return (
    <div className="grid gap-4">
      <StaggerItem className="flex flex-wrap items-center justify-between gap-3">
        <div className="grid gap-0.5">
          {!coverPosition && <span className={cn("font-mono text-xs font-semibold uppercase tracking-[0.12em]", trade.side === "short" && !mirror.blind.neutralColors ? "text-loss" : trade.side !== "short" && !mirror.blind.neutralColors ? "text-win" : "text-fg")}>{trade.side === "short" ? "▼ Short" : "▲ Long"}</span>}
          <span className="text-[12.5px] text-mute">
            {fmtDate(new Date(trade.date))} {fmtTime(new Date(trade.date))}
            {!coverPosition && ` · ${fmtPrice(trade.entry)}${coverResult ? "" : ` → ${trade.result === "open" ? "offen" : fmtPrice(trade.exit)}`}`}
          </span>
        </div>
        <Segmented<ReplayInterval> aria-label="Kerzen" size="sm" value={interval} onChange={setTf} options={REPLAY_INTERVALS.map((v) => ({ v, label: v, disabled: mirror.frozen && v !== interval }))} />
      </StaggerItem>
      <StaggerItem>
        <AnimatePresence mode="wait" initial={false}>
          {state.status === "error" ? (
            <motion.div key="error" className="grid min-h-[200px] place-items-center rounded-2xl border border-line bg-ink-950/50 p-6 text-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: tween.exit }} transition={tween.fade}>
              <div className="grid justify-items-center gap-3">
                <DotMatrix text="--" tone="mute" size={4} gap={2} glow={false} />
                <p className="max-w-[40ch] text-[13px] text-mute">{state.message}</p>
              </div>
            </motion.div>
          ) : state.status === "loading" || !model ? (
            <motion.div key="loading" className="grid h-[300px] place-items-center rounded-2xl border border-line bg-ink-950/50" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: tween.exit }} transition={tween.fade}>
              <div className="grid justify-items-center gap-3">
                <DotMatrix preset="wave" tone="fg" size={4} gap={2} playing={!reduced} label="Kerzen werden geladen" />
                <span className="text-[12px] text-mute">Kerzen werden geladen …</span>
              </div>
            </motion.div>
          ) : (
            <motion.div key={`ok-${trade.id}`} initial={reduced ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0, transitionEnd: { transform: "none" } }} transition={{ opacity: tween.fade, y: spring.enter }}>
              <ReplayPlayer trade={trade} model={model} bars={state.status === "ok" ? state.bars : []} interval={interval} />
            </motion.div>
          )}
        </AnimatePresence>
      </StaggerItem>
      {!trade.exitDate && trade.status !== "open" && <p className="text-[12px] text-faint">Ohne Ausstiegszeit zeigt der Replay den Verlauf ab dem Einstieg.</p>}
    </div>
  );
}

function ReplayPlayer({ trade, model, bars, interval }: { trade: EnrichedTrade; model: NonNullable<ReturnType<typeof buildReplay>>; bars: ReplayBar[]; interval: ReplayInterval }) {
  const step = useMotionValue(0);
  const rMv = useMotionValue(0);
  const maeMv = useMotionValue(0);
  const mfeMv = useMotionValue(0);
  const [phase, setPhase] = useState(() => phaseLabel(model, 0));
  const hasR = model.steps.some((s) => s.r != null);
  const mirror = useMirrorState("replay");
  // a bias test (F62) freezes the picture at the anchor bar: the chart gets only the bars up to it and no exit / target
  const frozenN = mirror.anchorMs != null ? barAt(bars, mirror.anchorMs) + 1 : null;
  const fixed = useMotionValue(frozenN ?? 0);
  useEffect(() => {
    if (frozenN != null) fixed.set(frozenN);
  }, [fixed, frozenN]);
  const chartBars = useMemo(() => (frozenN != null ? bars.slice(0, frozenN) : bars), [bars, frozenN]);
  const chartTrade = useMemo(() => (frozenN != null ? { ...model.trade, exit: null, exitIndex: null, target: null, result: "open" as const } : model.trade), [model.trade, frozenN]);
  const capture = (): BiasContext | { reason: string } => {
    const n = Math.floor(step.get());
    const bar = bars[n - 1];
    return n < 1 || !bar ? { reason: BIAS.setup.noStep } : { surface: "replay", symbol: trade.pair, interval, anchorMs: bar.time, tradeId: trade.id };
  };
  const canResume = (t: BiasTest) => t.context.tradeId === trade.id && t.context.interval === interval && bars.some((b) => b.time === t.context.anchorMs);
  const barTime = (t: number) => {
    const b = bars[Math.max(0, Math.min(bars.length - 1, Math.ceil(t) - 1))];
    if (!b) return "–";
    const d = new Date(b.time);
    return `${fmtDate(d)} ${fmtTime(d)}`;
  };
  useMotionValueEvent(step, "change", (v) => {
    const s = readoutAt(model.steps, v);
    rMv.set(s?.r ?? 0);
    maeMv.set(s?.mae ?? 0);
    mfeMv.set(s?.mfe ?? 0);
    const p = phaseLabel(model, Math.floor(v));
    if (p !== phase) setPhase(p);
  });
  return (
    <div className="grid gap-3">
      <Suspense fallback={<Skeleton height={CHART_H} />}>
        <ReplayChart
          bars={chartBars}
          trade={chartTrade}
          steps={model.steps}
          step={frozenN != null ? fixed : step}
          wipeKey={interval}
          height={CHART_H}
          flipped={mirror.view.flipped}
          showTrade={mirror.view.layers.trades && !mirror.blind.hidePosition}
          neutral={mirror.blind.neutralColors}
        />
      </Suspense>
      {!mirror.frozen && (
        <>
          <div className="grid grid-cols-3 gap-2" role="group" aria-label="Replay-Werte">
            <Readout label="R">{hasR ? <RollingDigits source={rMv} decimals={2} className="dot-num text-[22px]" aria-label="R im Replay" /> : <span className="text-faint">–</span>}</Readout>
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
          </div>
          <div className="flex items-center justify-between text-[12px]">
            <span className="label">Phase</span>
            <span className="font-mono text-fg/85">
              <TextRoll text={phase} mode="morph" />
            </span>
          </div>
          <ScrubTimeline
            label="Replay-Zeitleiste"
            title={`${model.total} Kerzen · ${interval}`}
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
          <p className="text-[11.5px] text-faint">
            Leertaste spielt ab, Pfeile gehen eine Kerze weiter. {trade.mfeR != null ? `Gespeichert: MFE ${trade.mfeR.toFixed(2).replace(".", ",")} R.` : ""}
          </p>
        </>
      )}
      <MirrorPanel surface="replay" capture={capture} canResume={canResume} layers={["trades"]} tradeId={trade.id} className="border-t border-line pt-3" />
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
