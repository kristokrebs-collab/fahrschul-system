/**
 * The Zeitmaschine of the Handelsplan (`Slots.tsx`): "spiel den Plan an echten Kerzen durch". The card itself is the
 * Zeitmaschine (`src/views/timemachine`); this host only gets it the history it needs. Nothing loads before the click: the
 * plan's session candles are too few to rebuild sessions from, so the Labor's own loader (cache first, closed candles only) asks
 * for the longer history of the same market and timeframe – and says what it asks for. A market the exchange does not know
 * (a stock, for now) gets the reason instead of a card. The plan itself is never changed and nothing is sent.
 */
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { HIST_MS, HIST_SOURCE, type HistInterval } from "@/domain/backtest/types";
import { MIN_POOL_BARS } from "@/domain/timemachine";
import { IS_FILE_BUILD, isFileProtocol } from "@/edition";
import { Button } from "@/primitives/Button";
import { HISTORY_DAYS } from "@/views/timemachine/tradePlan";
import type { TimeMachineCandle } from "@/views/timemachine/types";
import { loadErrorKind, loadLabData } from "@/views/labor/historySource";
import { LABOR } from "@/views/labor/strings";
import type { TimeMachineSlotProps } from "./types";

const TimeMachineCard = lazy(() => import("@/views/timemachine/TimeMachineCard"));

type Load = { status: "idle" } | { status: "loading"; done: number; total: number } | { status: "error"; message: string } | { status: "ok"; candles: TimeMachineCandle[]; fetchedAt: number };

/** The Labor loads 15m and up; a 5-minute plan is replayed on 15-minute candles (said in the text). */
function historyInterval(intervalMs: number): { iv: HistInterval; exact: boolean } {
  const exact = (Object.keys(HIST_MS) as HistInterval[]).find((k) => HIST_MS[k] === intervalMs);
  if (exact) return { iv: exact, exact: true };
  return { iv: "15m", exact: false };
}

export function TimeMachineSlotImpl({ symbol, side, entry, stop, target, intervalMs, source }: TimeMachineSlotProps) {
  const { iv, exact } = useMemo(() => historyInterval(intervalMs), [intervalMs]);
  const days = HISTORY_DAYS[HIST_SOURCE[iv] as keyof typeof HISTORY_DAYS];
  const key = `${symbol}|${iv}`;
  const [load, setLoad] = useState<{ key: string; v: Load }>({ key, v: { status: "idle" } });
  const ctl = useRef<AbortController | null>(null);
  const current: Load = load.key === key ? load.v : { status: "idle" };

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
    put({ status: "loading", done: 0, total: 0 });
    loadLabData({
      symbol,
      intervals: [iv],
      from: now - days * 86_400_000,
      to: now,
      funding: false,
      signal: mine.signal,
      onProgress: (done, total) => put({ status: "loading", done, total }),
    }).then(
      (res) => {
        const ms = HIST_MS[iv];
        const candles: TimeMachineCandle[] = (res.data[iv] ?? []).filter((b) => b.t * 1000 + ms <= now).map((b) => ({ time: b.t * 1000, open: b.o, high: b.h, low: b.l, close: b.c, ...(b.v != null ? { volume: b.v } : {}), closed: true }));
        if (candles.length < MIN_POOL_BARS) {
          put({ status: "error", message: candles.length ? `Für ${symbol} gibt es auf dem ${iv}-Chart nur ${candles.length} Kerzen – mindestens ${MIN_POOL_BARS} sind nötig.` : `Für ${symbol} liefert die Börse hier keine Kerzen.` });
          return;
        }
        put({ status: "ok", candles, fetchedAt: now });
      },
      (e: unknown) => {
        if (e instanceof Error && e.name === "AbortError") return;
        const kind = loadErrorKind(e);
        put({ status: "error", message: kind === "blocked" ? (IS_FILE_BUILD || isFileProtocol() ? LABOR.errors.blockedFile : LABOR.errors.blocked) : kind === "rate" ? LABOR.errors.rate : kind === "symbol" ? `Für ${symbol} gibt es hier keine Kerzen (die Börse kennt den Markt nicht) – die Zeitmaschine kann diesen Plan nicht durchspielen.` : "Die Kerzen konnten nicht geladen werden." });
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
            interval={iv}
            source={source.label}
            fetchedAt={current.fetchedAt}
            note={`Dein Handelsplan, durchgespielt auf ${current.candles.length} Kerzen (${iv}).`}
            framed={false}
          />
        </Suspense>
      </div>
    );
  }
  return (
    <div className="grid gap-3 rounded-xl border border-line-2 bg-ink-950/40 p-4" data-testid="hplan-timemachine" data-state={current.status}>
      <h3 className="label !text-mute">Zeitmaschine</h3>
      <p className="max-w-[64ch] text-[12.5px] leading-relaxed text-mute">
        Spielt deinen Plan ({side === "long" ? "Long" : "Short"} {symbol}) 10 000-mal durch neu gemischte Sitzungen echter Kerzen und sagt, wie oft Ziel oder Stop zuerst kam – mit Streuung und ohne die Zukunft zu zeigen. Dafür lädt sie bis zu {days} Tage {iv}-Kerzen von der Börse ({source.label}); erst nach deinem Klick.
        {exact ? "" : " Das Labor lädt keine kürzeren Kerzen als 15 Minuten, darum läuft der Plan auf 15-Minuten-Kerzen."}
      </p>
      {current.status === "loading" ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-[12.5px] text-fg" role="status" data-testid="hplan-timemachine-loading">
            Kerzen werden geladen{current.total > 0 ? ` (${current.done} von ${current.total})` : ""} …
          </p>
          <Button size="md" variant="ghost" onClick={() => {
              ctl.current?.abort();
              setLoad({ key, v: { status: "idle" } });
            }}
            data-testid="hplan-timemachine-cancel">
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
