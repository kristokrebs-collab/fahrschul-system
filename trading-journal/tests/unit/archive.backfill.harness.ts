/**
 * A fake Binance for the history load's tests: answers by path like the documented endpoints (openInterestHist, the three
 * ratios, fundingRate, markPriceKlines) with `startTime` / `endTime` / `limit` semantics, deterministic values (the same
 * functions build the expectations), failures per path, and a record of the requests.
 */
const MIN = 60_000;
const H = 60 * MIN;
export const STEP = 5 * MIN;

export interface Net {
  calls: string[];
  /** path → HTTP status (default 200) */
  status: Record<string, number>;
  /** every path answers this status when set */
  all: number | null;
  /** the exchange only holds history from here */
  holdsFrom: number;
}
export const net = (): Net => ({ calls: [], status: {}, all: null, holdsFrom: 0 });

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
export const pathOf = (input: string): string => new URL(input, "https://x.test").pathname.replace("/api/binance", "");

/** The deterministic values. */
export const oiAt = (t: number): number => 1000 + ((t / STEP) % 17);
export const longAt = (t: number, kind: string): number => (kind === "global" ? 55 : kind === "topPos" ? 45 : 60) + ((t / STEP) % 5);
export const markAt = (t: number): number => 80_000 + ((t / STEP) % 100);

/** A fake Binance (`direct`) or proxy host; `now` is the default `endTime`. */
export function host(n: Net, label: string, now: number) {
  return async (input: string): Promise<Response> => {
    const path = pathOf(input);
    n.calls.push(`${label}:${path}`);
    const st = n.all ?? n.status[path] ?? 200;
    if (st !== 200) return json({ code: -1, msg: "x" }, st);
    const u = new URL(input, "https://x.test");
    const symbol = u.searchParams.get("symbol") ?? "BTCUSDT";
    const start = Number(u.searchParams.get("startTime") ?? 0);
    const end = Number(u.searchParams.get("endTime") ?? now);
    const limit = Number(u.searchParams.get("limit") ?? 500);
    const grid = (from: number, to: number): number[] => {
      const out: number[] = [];
      for (let t = Math.ceil(Math.max(from, n.holdsFrom) / STEP) * STEP; t <= to && out.length < limit; t += STEP) out.push(t);
      return out;
    };
    if (path === "/futures/data/openInterestHist") return json(grid(start, end).map((t) => ({ symbol, sumOpenInterest: String(oiAt(t)), sumOpenInterestValue: String(oiAt(t) * 80_000), timestamp: t })));
    const kind = path === "/futures/data/globalLongShortAccountRatio" ? "global" : path === "/futures/data/topLongShortPositionRatio" ? "topPos" : path === "/futures/data/topLongShortAccountRatio" ? "topAcc" : null;
    if (kind) return json(grid(start, end).map((t) => ({ symbol, longShortRatio: "1.2", longAccount: String(longAt(t, kind) / 100), shortAccount: String(1 - longAt(t, kind) / 100), timestamp: t })));
    if (path === "/fapi/v1/fundingRate") {
      const rows: unknown[] = [];
      for (let t = Math.ceil(start / (8 * H)) * 8 * H; t <= end && rows.length < limit; t += 8 * H) rows.push({ symbol, fundingTime: t, fundingRate: "0.00010000", markPrice: "" });
      return json(rows);
    }
    if (path === "/fapi/v1/markPriceKlines") {
      // open times; the candle that has not closed yet is returned too, like the exchange does
      return json(grid(start, end).map((t) => [t, "1", "2", "0.5", String(markAt(t + STEP)), "0", t + STEP - 1, "0", 60, "0", "0", "0"]));
    }
    return json({}, 404);
  };
}
