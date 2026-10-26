/**
 * „Zeitmaschine für diesen Trade“ – the sheet next to the trade detail. The trade's side, entry, stop and target are the plan; the
 * candles are the market's closed candles BEFORE the entry (so the answer is the one the Zeitmaschine could have given at that
 * moment); the card shows the odds, the fan, the histogram and the earlier occasions, and next to it what the trade really did.
 * Without candles (other market, venue unreachable, too little history) the sheet says so and shows nothing made up. Nothing is
 * written to the journal.
 *
 * Lazy chunk: `DeferredHosts` mounts it the first time `openTimeMachine` ran.
 */
import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import { HIST_MS, type HistInterval } from "@/domain/backtest/types";
import { MIN_POOL_BARS } from "@/domain/timemachine";
import type { EnrichedTrade } from "@/domain/types";
import { date as fmtDate, price as fmtPrice, r as fmtR, time as fmtTime } from "@/lib/format";
import { DotMatrix } from "@/motion/DotMatrix";
import { Sheet, StaggerItem } from "@/motion/Sheet";
import { Segmented, Skeleton } from "@/primitives";
import { useEnriched } from "@/store/journalStore";
import { loadErrorKind, loadLabData } from "@/views/labor/historySource";
import { LABOR } from "@/views/labor/strings";
import { SEG_TOUCH } from "@/views/labor/ui";
import { IS_FILE_BUILD, isFileProtocol } from "@/edition";
import { defaultReplayInterval } from "@/views/trades/replay/replayModel";
import { FORM_INTERVALS, type FormInterval } from "./formModel";
import { closeTimeMachine, useTmSheet } from "./sheetStore";
import { TM } from "./strings";
import { ASSUMED_R, HISTORY_DAYS, tmPlanOfTrade, type TradePlan } from "./tradePlan";
import type { TimeMachineCandle } from "./types";

const TimeMachineCard = lazy(() => import("./TimeMachineCard"));
const SOURCE = "Binance USDⓈ-M";

export default function TimeMachineHost() {
  const id = useTmSheet((s) => s.id);
  const enriched = useEnriched();
  const trade = id ? enriched.find((t) => t.id === id) : undefined;
  return (
    <Sheet open={trade != null} onClose={closeTimeMachine} title="Zeitmaschine für diesen Trade" size="lg" dismissGuard={false}>
      {trade ? <Body key={trade.id} trade={trade} /> : null}
    </Sheet>
  );
}

function Notice({ text, testId = "tm-trade-notice" }: { text: ReactNode; testId?: string }) {
  return (
    <StaggerItem className="grid min-h-[160px] place-items-center rounded-2xl border border-line bg-ink-950/50 p-6 text-center" data-testid={testId}>
      <div className="grid justify-items-center gap-3">
        <DotMatrix text="--" tone="mute" size={4} gap={2} glow={false} />
        <p className="max-w-[46ch] text-[13px] text-mute">{text}</p>
      </div>
    </StaggerItem>
  );
}

type Load = { status: "loading"; done: number; total: number } | { status: "error"; message: string } | { status: "ok"; candles: TimeMachineCandle[]; fetchedAt: number };

const when = (ms: number): string => `${fmtDate(new Date(ms))} ${fmtTime(new Date(ms))}`;

function Body({ trade }: { trade: EnrichedTrade }) {
  const [assumed, setAssumed] = useState<number>(ASSUMED_R[1]);
  const first = defaultReplayInterval(trade);
  const [interval, setIv] = useState<FormInterval>(first);
  const tp = useMemo(() => tmPlanOfTrade(trade, assumed), [trade, assumed]);
  if (!tp.ok) return <Notice text={tp.why} />;
  return <Loaded trade={trade} tp={tp.value} interval={interval} setInterval={setIv} assumed={assumed} setAssumed={setAssumed} />;
}

function Loaded({ trade, tp, interval, setInterval, assumed, setAssumed }: { trade: EnrichedTrade; tp: TradePlan; interval: FormInterval; setInterval: (v: FormInterval) => void; assumed: number; setAssumed: (v: number) => void }) {
  const { symbol, entryMs } = tp;
  const key = `${symbol}|${entryMs}|${interval}`;
  const [answer, setAnswer] = useState<{ key: string; v: Load } | null>(null);
  // the answer counts only for the market, moment and timeframe it was asked for; until it comes the sheet is loading
  const load: Load = answer?.key === key ? answer.v : { status: "loading", done: 0, total: 0 };
  useEffect(() => {
    const ctl = new AbortController();
    const ivMs = HIST_MS[interval as HistInterval];
    const now = Date.now();
    const put = (v: Load) => !ctl.signal.aborted && setAnswer({ key, v });
    loadLabData({
      symbol,
      intervals: [interval as HistInterval],
      from: entryMs - HISTORY_DAYS[interval] * 86_400_000,
      to: entryMs,
      funding: false,
      signal: ctl.signal,
      onProgress: (done, total) => put({ status: "loading", done, total }),
    }).then(
      (res) => {
        // only candles that had CLOSED when the trade was entered: the sheet must not know the outcome
        const candles: TimeMachineCandle[] = (res.data[interval as HistInterval] ?? []).filter((b) => b.t * 1000 + ivMs <= entryMs).map((b) => ({ time: b.t * 1000, open: b.o, high: b.h, low: b.l, close: b.c, ...(b.v != null ? { volume: b.v } : {}), closed: true }));
        if (candles.length < MIN_POOL_BARS) {
          put({ status: "error", message: candles.length ? `Vor diesem Einstieg gibt es auf dem ${interval}-Chart nur ${candles.length} Kerzen – mindestens ${MIN_POOL_BARS} sind nötig. Ein größerer Zeiteinheit hilft.` : `Für ${symbol} liefert die Börse vor diesem Einstieg keine Kerzen.` });
          return;
        }
        put({ status: "ok", candles, fetchedAt: now });
      },
      (e: unknown) => {
        if (e instanceof Error && e.name === "AbortError") return;
        const kind = loadErrorKind(e);
        put({ status: "error", message: kind === "blocked" ? (IS_FILE_BUILD || isFileProtocol() ? LABOR.errors.blockedFile : LABOR.errors.blocked) : kind === "rate" ? LABOR.errors.rate : kind === "symbol" ? `Für ${symbol} gibt es hier keine Kerzen (die Börse kennt den Markt nicht) – die Zeitmaschine kann diesen Trade nicht durchspielen.` : "Die Kerzen konnten nicht geladen werden." });
      },
    );
    return () => ctl.abort();
  }, [key, symbol, entryMs, interval]);

  const { plan } = tp;
  const real = trade.status === "open" ? "noch offen" : trade.r != null ? `${fmtR(trade.r)}${trade.exit != null ? ` (Ausstieg ${fmtPrice(trade.exit)})` : ""}` : "R unbekannt";
  return (
    <div className="grid gap-4" data-testid="tm-trade">
      <StaggerItem className="grid gap-1.5">
        <span className={trade.side === "short" ? "font-mono text-xs font-semibold uppercase tracking-[0.12em] text-loss" : "font-mono text-xs font-semibold uppercase tracking-[0.12em] text-win"}>
          {trade.side === "short" ? "▼ Short" : "▲ Long"} · {trade.pair}
        </span>
        <p className="text-[12.5px] text-mute">
          Eingestiegen {when(entryMs)} · {fmtPrice(plan.entry)} · Stop {fmtPrice(plan.stop)} · Ziel {fmtPrice(plan.target)}
          {tp.targetAssumed ? " (angenommen)" : ""}
        </p>
        <p className="text-[12.5px] text-mute" data-testid="tm-trade-actual">
          Was wirklich passiert ist: {real}. Die Zeitmaschine kennt davon nichts – sie sieht nur Kerzen bis zum Einstieg.
        </p>
      </StaggerItem>

      <StaggerItem className="grid gap-3 rounded-2xl border border-line-2 bg-ink-950/40 p-3.5" data-testid="tm-trade-controls">
        <div className="grid gap-1.5">
          <span className="label">Zeiteinheit der Kerzen</span>
          <Segmented<FormInterval> aria-label="Zeiteinheit" size="sm" options={FORM_INTERVALS.map((v) => ({ v, label: v === "1d" ? "1T" : v }))} value={interval} onChange={setInterval} className={SEG_TOUCH} />
        </div>
        {tp.targetAssumed && (
          <div className="grid gap-1.5">
            <span className="label">Ziel – im Trade nicht eingetragen, angenommen</span>
            <Segmented<`${number}`> aria-label="Angenommenes Ziel" size="sm" options={ASSUMED_R.map((x) => ({ v: `${x}` as const, label: `${x} R` }))} value={`${assumed}`} onChange={(v) => setAssumed(Number(v))} className={SEG_TOUCH} />
            <span className="text-[11.5px] text-faint">Die Annahme ist deine Wahl, nicht die Entscheidung des Trades.</span>
          </div>
        )}
      </StaggerItem>

      {load.status === "loading" && (
        <StaggerItem className="grid h-[160px] place-items-center rounded-2xl border border-line bg-ink-950/50" data-testid="tm-trade-loading">
          <div className="grid justify-items-center gap-3">
            <DotMatrix preset="wave" tone="fg" size={4} gap={2} label="Lade Kerzen" />
            <span className="num text-[12px] text-mute">Lade Kerzen vor dem Einstieg … {load.total > 0 ? `${load.done} von ${load.total} Seiten` : ""}</span>
          </div>
        </StaggerItem>
      )}
      {load.status === "error" && <Notice text={load.message} testId="tm-trade-empty" />}
      {load.status === "ok" && (
        <StaggerItem>
          <Suspense fallback={<Skeleton height={220} />}>
            <TimeMachineCard
              symbol={symbol}
              side={plan.side}
              entry={plan.entry}
              stop={plan.stop}
              target={plan.target}
              candles={load.candles}
              interval={interval}
              costs={tp.costs}
              source={SOURCE}
              fetchedAt={load.fetchedAt}
              startMs={load.candles[load.candles.length - 1]!.time + HIST_MS[interval as HistInterval]}
              note={`${TM.title}, so wie sie am Einstieg gerechnet hätte: ${load.candles.length} Kerzen vor ${when(entryMs)}.`}
              framed={false}
            />
          </Suspense>
        </StaggerItem>
      )}
    </div>
  );
}
