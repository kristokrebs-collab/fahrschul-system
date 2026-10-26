/**
 * Squeeze observation (F07), reading the archive: the premium (funding rate, mark price), open-interest and long / short
 * rows of one symbol from the data archive (`@/market/archive`), at most 30 days, as the pure domain wants them. Only what
 * is stored is read; a missing number stays `null` and is never filled.
 */
import type { ArchiveDb } from "../archive/db";
import type { LsPt, OiPt, PremiumPt, SqueezeData } from "@/domain/squeeze";

export const SQUEEZE_DAYS = 30;
const DAY_MS = 24 * 3_600_000;
const FALLBACK_IV_MIN = 10;

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export interface SqueezeSnapshot {
  data: SqueezeData;
  /** the interval (minutes) of the newest tick in the log – the freshness rule needs it */
  ivMin: number;
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
