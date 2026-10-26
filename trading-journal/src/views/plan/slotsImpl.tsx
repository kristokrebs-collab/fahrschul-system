/**
 * The Zeitmaschine of the Handelsplan (`Slots.tsx`): "spiel den Plan an echten Kerzen durch". The card itself is the
 * Zeitmaschine (`src/views/timemachine`); this host only gets it the history it needs. Nothing loads before the click: the
 * plan's session candles are too few to rebuild sessions from, so a history source (`historySources.ts`) asks for the longer
 * history of the same market – crypto through the Labor's loader (cache first, closed candles only), stocks through the stock data
 * contract (hourly or daily candles as far back as Yahoo reaches) – and says what it asks for. Only closed candles that existed
 * before the plan reach the card. A market the source does not know, too few candles, a blocked source: the reason is shown instead of
 * a card. The plan itself is never changed and nothing is sent.
 */
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { CostModel } from "@/domain/backtest/types";
import type { TmInterval } from "@/domain/timemachine";
import { Button } from "@/primitives/Button";
import { Segmented } from "@/primitives/Segmented";
import { historySourceOf, type TmSetup } from "@/views/timemachine/historySources";
import type { TimeMachineCandle } from "@/views/timemachine/types";
import { SEG_TOUCH } from "@/views/labor/ui";
import type { TimeMachineSlotProps } from "./types";

const TimeMachineCard = lazy(() => import("@/views/timemachine/TimeMachineCard"));

type Load =
  | { status: "idle" }
  | { status: "loading"; done: number; total: number }
  | { status: "error"; message: string }
  | { status: "ok"; candles: TimeMachineCandle[]; fetchedAt: number; sourceLabel: string; interval: TmInterval; notes: string[]; setup: TmSetup };

/** A stock has no funding; fees and slippage are the plan's own assumptions (the risk settings), so the replay is costed like the sizing. */
export function stockCosts(feePct: number, slippagePct: number): CostModel {
  const bps = (x: number): number => Number((x * 10_000).toFixed(4));
  return { fees: { exchange: "Risiko-Einstellungen", makerBps: bps(feePct), takerBps: bps(feePct) }, slippage: { kind: "fixed", bps: bps(slippagePct) }, funding: { kind: "none" } };
}

export function TimeMachineSlotImpl({ symbol, side, entry, stop, target, intervalMs, sessionOpenMs, sessionCloseMs, entryAt, flatByMs, market, feePct, slippagePct }: TimeMachineSlotProps) {
  const hist = historySourceOf(market);
  const offer = useMemo(() => hist.choices(intervalMs), [hist, intervalMs]);
  const [pick, setPick] = useState<TmInterval | null>(null);
  const choice = offer.choices.find((c) => c.id === pick) ?? offer.choices[0]!;
  const key = `${symbol}|${choice.id}`;
  const [load, setLoad] = useState<{ key: string; v: Load }>({ key, v: { status: "idle" } });
  const ctl = useRef<AbortController | null>(null);
  const current: Load = load.key === key ? load.v : { status: "idle" };
  const costs = useMemo(() => (market === "stocks" ? stockCosts(feePct ?? 0, slippagePct ?? 0) : undefined), [market, feePct, slippagePct]);

  useEffect(() => () => ctl.current?.abort(), []);
  // a different market or timeframe drops a running load; the old answer no longer counts
  useEffect(() => {
    ctl.current?.abort();
  }, [key]);

  const start = () => {
    ctl.current?.abort();
    const mine = new AbortController();
    ctl.current = mine;
    const put = (v: Load) => !mine.signal.aborted && setLoad({ key, v });
    const now = Date.now();
    const plan = { intervalMs, sessionOpenMs, sessionCloseMs, entryAt, flatByMs, now, past: now >= sessionCloseMs };
    put({ status: "loading", done: 0, total: 0 });
    hist
      .load({ symbol, interval: choice.id, signal: mine.signal, until: hist.until(plan), onProgress: (done, total) => put({ status: "loading", done, total }) })
      .then(
        (res) => {
          if (!res.ok) return put({ status: "error", message: res.message });
          put({ status: "ok", candles: res.candles, fetchedAt: res.fetchedAt, sourceLabel: res.sourceLabel, interval: res.interval, notes: res.notes, setup: hist.setup(choice, plan, res.candles.length) });
        },
        (e: unknown) => {
          if (e instanceof Error && e.name === "AbortError") return;
          put({ status: "error", message: "Die Kerzen konnten nicht geladen werden." });
        },
      );
  };

  if (current.status === "ok") {
    return (
      <div data-testid="hplan-timemachine" data-state="ready">
        <Suspense fallback={<p className="text-[12.5px] text-mute">Wird geladen …</p>}>
          <TimeMachineCard
            symbol={symbol}
            side={side}
            entry={entry}
            stop={stop}
            target={target}
            candles={current.candles}
            interval={current.interval}
            source={current.sourceLabel}
            fetchedAt={current.fetchedAt}
            note={[current.setup.note, ...current.notes].join(" ")}
            framed={false}
            hosted
            market={market}
            {...(costs ? { costs } : {})}
            options={current.setup.options}
            startMs={current.setup.startMs}
          />
        </Suspense>
      </div>
    );
  }
  return (
    <div className="grid gap-3 rounded-xl border border-line-2 bg-ink-950/40 p-4" data-testid="hplan-timemachine" data-state={current.status}>
      <h3 className="label !text-mute">Zeitmaschine</h3>
      <p className="max-w-[64ch] text-[12.5px] leading-relaxed text-mute">
        Spielt deinen Plan ({side === "long" ? "Long" : "Short"} {symbol}) 10 000-mal durch neu gemischte Sitzungen echter Kerzen und sagt, wie oft Ziel oder Stop zuerst kam – mit Streuung und ohne die Zukunft zu zeigen. {hist.announce(choice)}
        {offer.hint}
      </p>
      {offer.choices.length > 1 && (
        <div className="grid gap-1.5" data-testid="hplan-timemachine-choice">
          <Segmented<TmInterval>
            aria-label="Kerzen für die Zeitmaschine"
            size="sm"
            options={offer.choices.map((c) => ({ v: c.id, label: c.label }))}
            value={choice.id}
            onChange={setPick}
            className={SEG_TOUCH}
          />
          <span className="text-[11.5px] leading-snug text-mute">Reichweite: {choice.reach}.</span>
        </div>
      )}
      {current.status === "loading" ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-[12.5px] text-fg" role="status" data-testid="hplan-timemachine-loading">
            Kerzen werden geladen{current.total > 0 ? ` (${current.done} von ${current.total})` : ""} …
          </p>
          <Button
            size="md"
            variant="ghost"
            onClick={() => {
              ctl.current?.abort();
              setLoad({ key, v: { status: "idle" } });
            }}
            data-testid="hplan-timemachine-cancel"
          >
            Abbrechen
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <Button size="md" onClick={start} data-testid="hplan-timemachine-start">
            Plan durchspielen
          </Button>
          {current.status === "error" ? (
            <p className="text-[12.5px] text-loss" role="alert" data-testid="hplan-timemachine-error">
              {current.message}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
