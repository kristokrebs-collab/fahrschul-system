/**
 * The generated journal of the Analyse specs (and of `chart-rich.spec.ts`): 140 closed trades over ~10 months, seeded and
 * independent of the time of day (moved out of `analyse.spec.ts` so another spec can import it without re-registering that
 * spec's tests).
 */
/** Local wall-clock "YYYY-MM-DDTHH:mm" of an instant (the journal's `date` format). */
const local = (ms: number): string => {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

/**
 * The fixture's clock: Monday 00:00 (local) of the current week. Hours and weekdays of the generated trades – and with
 * them the session / weekday / heatmap buckets – then no longer drift with the time of day or the weekday the suite
 * runs on (a run at 09:25 met a `Spät` session of six straight losses, whose win-rate bar rightly ends at scaleX(0)).
 */
export function fixtureNow(at = Date.now()): number {
  const d = new Date(at);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

/** 140 closed trades over ~10 months, seeded (mulberry32). */
export function analyseTrades(now = fixtureNow(), n = 140): Record<string, unknown>[] {
  let a = 20261012;
  const rand = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const SETUPS = [
    { id: "s_bo", win: 0.52, rWin: 1.9 },
    { id: "s_sweep", win: 0.42, rWin: 1.5 },
    { id: "s_ml", win: 0.3, rWin: 1.2 },
  ];
  const span = 300 * 86_400_000;
  const out: Record<string, unknown>[] = [];
  for (let i = 0; i < n; i++) {
    const s = SETUPS[i % 3]!;
    const at = now - span + (i / n) * span + Math.floor(rand() * 20) * 3_600_000;
    const side = rand() < 0.62 ? "long" : "short";
    const entry = Math.round(58_000 + rand() * 30_000);
    const d = Math.round(entry * (0.006 + rand() * 0.01));
    const win = rand() < s.win;
    const r = win ? s.rWin * (0.5 + rand()) : -(0.8 + rand() * 0.35);
    const dir = side === "long" ? 1 : -1;
    const exit = Math.round(entry + dir * r * d);
    const stop = entry - dir * d;
    const target = entry + dir * 2.5 * d;
    const account = i % 4 === 0 ? "makro" : "scalp";
    const riskMoney = account === "makro" ? 200 : 50;
    const qty = riskMoney / d;
    const maeR = win ? 0.1 + rand() * 0.7 : 1 + rand() * 0.18;
    const mfeR = win ? Math.abs(r) + rand() * 1.2 : rand() * 1.4;
    const hold = (15 + Math.floor(rand() * 2400)) * 60_000;
    out.push({
      id: `e_ana_${i}`,
      account,
      side,
      status: "closed",
      date: local(at),
      exitDate: local(at + hold),
      pair: i % 5 === 0 ? "ETH/USDT" : "BTC/USDT",
      timeframe: ["15m", "1h", "4h"][i % 3],
      entry,
      stop,
      target,
      exit,
      size: Math.round(qty * entry),
      leverage: [3, 5, 10][i % 3],
      fees: 1,
      pnlManual: null,
      setups: [s.id],
      checks: {},
      conviction: (i % 5) + 1,
      followedPlan: rand() < 0.8,
      emotion: ["Ruhig", "Fokussiert", "FOMO", "Unsicher"][i % 4],
      reason: "",
      notes: "",
      chart: "",
      pnl: null,
      r: null,
      mistakes: [],
      atrPct: Math.round((0.8 + rand() * 3.6) * 100) / 100,
      mae: Math.round(maeR * d),
      mfe: Math.round(mfeR * d),
      tags: i % 6 === 0 ? ["news"] : i % 4 === 0 ? ["plan"] : [],
      createdAt: new Date(at).toISOString(),
      updatedAt: new Date(at).toISOString(),
    });
  }
  return out;
}

