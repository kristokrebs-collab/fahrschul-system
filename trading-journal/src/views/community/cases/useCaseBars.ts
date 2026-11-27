/**
 * The public candles of a Chartfall (F47): the lab's budgeted, cached Binance loader (`views/labor/historySource`,
 * loaded on demand so the community page does not carry it), converted to `CaseBar`s. Honest states: loading, the
 * exchange's reason for a failure, "no candles". Closed candles only; a series that is complete (the question's last
 * candle has closed) is remembered for the session.
 */
import { useEffect, useState } from "react";
import { CASES } from "@/social/caseStrings";
import { caseWindow, outcomeAt, type CaseBar } from "@/social/cases";
import type { CaseInfo } from "@/social/contract";

export type CaseBars = { status: "idle" } | { status: "loading" } | { status: "ok"; bars: CaseBar[] } | { status: "error"; message: string };

type Frame = Pick<CaseInfo, "pair" | "interval" | "anchorMs" | "horizon">;

const done = new Map<string, CaseBar[]>();
const keyOf = (c: Frame) => `${c.pair}|${c.interval}|${c.anchorMs}|${c.horizon}`;

/** Test hook: forget the remembered series. */
export function __resetCaseBars(): void {
  done.clear();
}

/** `enabled = false` loads nothing (a form that is not complete yet). `retry` reloads after an error. */
export function useCaseBars(c: Frame, enabled = true, retry = 0): CaseBars {
  const key = keyOf(c);
  const kept = enabled ? done.get(key) : undefined;
  const [state, setState] = useState<{ key: string; retry: number; v: CaseBars }>({ key: "", retry: 0, v: { status: "idle" } });

  useEffect(() => {
    if (!enabled || kept) return;
    let alive = true;
    (async () => {
      try {
        const mod = await import("@/views/labor/historySource");
        const win = caseWindow(c);
        const res = await mod.loadLabData({ symbol: c.pair, intervals: [c.interval], from: win.from, to: win.to, funding: false });
        const bars: CaseBar[] = (res.data[c.interval] ?? []).map((b) => ({ time: b.t * 1000, open: b.o, high: b.h, low: b.l, close: b.c }));
        if (!alive) return;
        if (!bars.length) return setState({ key, retry, v: { status: "error", message: CASES.loadErrors.none } });
        if (Date.now() >= outcomeAt(c)) done.set(key, bars);
        setState({ key, retry, v: { status: "ok", bars } });
      } catch (e) {
        if (!alive) return;
        let kind: keyof typeof CASES.loadErrors = "failed";
        try {
          kind = (await import("@/views/labor/historySource")).loadErrorKind(e);
        } catch {
          /* keep "failed" */
        }
        setState({ key, retry, v: { status: "error", message: CASES.loadErrors[kind] } });
      }
    })();
    return () => {
      alive = false;
    };
    // `key` covers the case (pair, size, anchor, horizon); `retry` is the reload button
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, retry, kept]);

  if (!enabled) return { status: "idle" };
  if (kept) return { status: "ok", bars: kept };
  return state.key === key && state.retry === retry ? state.v : { status: "loading" };
}
