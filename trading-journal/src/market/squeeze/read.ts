/**
 * Squeeze observation (F07), reading the archive: the premium (funding rate, mark price), open-interest and long / short
 * rows of one symbol from the data archive (`@/market/archive`), at most 30 days, as the pure domain wants them. Only what
 * is stored is read; a missing number stays `null` and is never filled.
 */
import type { ArchiveDb } from "../archive/db";
import { historyCoverage, squeezeDataFromHistory, type LsPt, type OiPt, type PremiumPt, type SqueezeData } from "@/domain/squeeze";

export const SQUEEZE_DAYS = 30;
const DAY_MS = 24 * 3_600_000;
const FALLBACK_IV_MIN = 10;

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export interface SqueezeSnapshot {
  data: SqueezeData;
  /** the interval (minutes) of the newest tick in the log – the freshness rule needs it */
  ivMin: number;
}

export interface HistorySnapshot {
  data: SqueezeData;
  /** first / last price sample (ms) and the hours between, `null` without a price series */
  first: number | null;
  last: number | null;
  hours: number;
  /** points per loaded series (0 = that series is missing for this symbol) */
  counts: { mark: number; funding: number; oi: number; ls: number; top: number };
}

/**
 * The loaded Binance history of one symbol (`…Hist` series, „Börsenhistorie nachladen“) as `SqueezeData`. Read on its own –
 * never merged with the collected series of `loadSqueezeData`. A series that was not loaded is empty, and the reading says
 * „keine Daten“ for it.
 */
export async function loadHistoryData(db: ArchiveDb, symbol: string, now: number, days = SQUEEZE_DAYS + 1): Promise<HistorySnapshot> {
  const from = now - days * DAY_MS;
  const [mark, fund, oi, ls, top] = await Promise.all([
    db.range("markHist", symbol, from, now),
    db.range("fundingHist", symbol, from - 9 * 3_600_000, now),
    db.range("oiHist", symbol, from, now),
    db.range("lsAccHist", symbol, from, now),
    db.range("lsTopPosHist", symbol, from, now),
  ]);
  const markPts = mark.flatMap((p) => {
    const v = num(p.d.mark);
    return v === null || v <= 0 ? [] : [{ t: p.t, mark: v }];
  });
  const fundPts = fund.flatMap((p) => {
    const v = num(p.d.rate);
    return v === null ? [] : [{ t: p.t, rate: v }];
  });
  const oiPts = oi.flatMap((p): OiPt[] => {
    const v = num(p.d.oi);
    return v === null ? [] : [{ t: p.t, oi: v }];
  });
  const longs = (rows: typeof ls): LsPt[] =>
    rows.flatMap((p): LsPt[] => {
      const v = num(p.d.long);
      return v === null ? [] : [{ t: p.t, long: v }];
    });
  const rows = { mark: markPts, funding: fundPts, oi: oiPts, ls: longs(ls), top: longs(top) };
  const cov = historyCoverage(rows);
  return {
    data: squeezeDataFromHistory(rows),
    first: cov?.first ?? null,
    last: cov?.last ?? null,
    hours: cov?.hours ?? 0,
    counts: { mark: markPts.length, funding: fundPts.length, oi: oiPts.length, ls: rows.ls.length, top: rows.top.length },
  };
}

export async function loadSqueezeData(db: ArchiveDb, symbol: string, now: number, days = SQUEEZE_DAYS): Promise<SqueezeSnapshot> {
  const from = now - days * DAY_MS;
  const [prem, oi, ls, top, ticks] = await Promise.all([
    db.range("premium", symbol, from, now),
    db.range("oi", symbol, from, now),
    db.range("lsAcc", symbol, from, now),
    db.range("lsTopPos", symbol, from, now),
    db.ticks(now - 3 * 3_600_000),
  ]);
  const premium: PremiumPt[] = prem.map((p) => ({ t: p.t, mark: num(p.d.mark), rate: num(p.d.rate) }));
  const oiPts = oi.flatMap((p): OiPt[] => {
    const v = num(p.d.oi);
    return v === null ? [] : [{ t: p.t, oi: v }];
  });
  const long = (rows: typeof ls): LsPt[] =>
    rows.flatMap((p): LsPt[] => {
      const v = num(p.d.long);
      return v === null ? [] : [{ t: p.t, long: v }];
    });
  return { data: { premium, oi: oiPts, ls: long(ls), top: long(top) }, ivMin: ticks.length ? ticks[ticks.length - 1]!.iv : FALLBACK_IV_MIN };
}
