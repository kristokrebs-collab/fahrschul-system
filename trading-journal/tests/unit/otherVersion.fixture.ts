/**
 * Data exactly as the OTHER journal version (branch `claude/dreamy-dirac-uwi1be`, commit 9287d42) writes it:
 * - localStorage `tj2-trades` / `tj2-settings` / `tj2-hyblock` (no `tj2-meta`), settings via its `normalizeSettings`
 *   (`signals`, `mistakes`, `s_mtf` first, `market.symbol: "BITSTAMP:BTCUSD"`), trades with `signal` (SignalSnap)
 *   and `mistakes`;
 * - JSON backup `{ exportedAt, settings, trades }` (`pages.tsx:211`: enriched trades minus
 *   `items, checked, complete, move, risk, rr, result`; no `hyblock`, no `schemaVersion`).
 */
export const OTHER_SIGNAL_CFG = {
  ladder: ["30m", "45m", "1h", "4h"],
  required: 2,
  wtSource: "close",
  wtChannel: 9,
  wtAverage: 21,
  wtSignal: 2,
  wtOb: 53,
  wtObStrong: 60,
  wtOs: -53,
  wtOsStrong: -60,
  signalLookback: 3,
  revRange: 28,
  rsiLen: 14,
  rsiMaLen: 14,
  rsiOb: 70,
  rsiOs: 30,
  rsiNear: 10,
  swingLookback: 50,
  zoneTf: "1h",
};

export const OTHER_MTF_SETUP = {
  id: "s_mtf",
  name: "Multi-TF Signal (MCB + RSI + Discount)",
  account: "both",
  color: "#9aa9bb",
  desc: "Ab 30m: MCB zeigt Bottom/Einstieg (Short: Top), die nächst höhere Timeframe bestätigt, die dritte macht den Einstieg stärker. RSI nahe überverkauft/überkauft, Discount (Short: Premium) ist Bonus. Wird live geprüft.",
  checklist: [
    { id: "mtf_base", text: "MCB-Signal auf der Basis-Timeframe (mind. 30m)" },
    { id: "mtf_next", text: "Nächst höhere Timeframe bestätigt" },
    { id: "mtf_third", text: "Dritte Timeframe bestätigt (stärker)" },
    { id: "mtf_rsi", text: "RSI nahe überverkauft (Short: überkauft)" },
    { id: "mtf_zone", text: "Preis im Discount (Short: Premium)" },
  ],
};

export const OTHER_MISTAKES = ["Zu früh rein", "Kein Stop", "Stop verschoben", "Zu großer Hebel", "FOMO-Einstieg", "Gegen den Plan", "Zu früh raus", "Revenge-Trade", "Eigener Tag"];

/** What the other version's `normalizeSettings` returns (and its `saveSettings` persists): no unknown keys. */
export function otherSettings(): Record<string, unknown> {
  return {
    currency: "USDT",
    pair: "BTC/USDT",
    startDate: "",
    capital: { makro: 20000, scalp: 5000 },
    setups: [
      OTHER_MTF_SETUP,
      { id: "s_bo", name: "4H-Breakout über 85.900", account: "scalp", color: "#6f9dc9", desc: "", checklist: [{ id: "c1", text: "4H-Schluss über 85.900" }] },
    ],
    rules: [{ id: "trigger", text: "Trigger ausgelöst, nicht geraten" }],
    backtest: { winRate: 0.6215, avgWin: 0.1664, avgLoss: -0.0931, expectancy: 0.0682, label: "214 Signale" },
    hyblock: { longEndpoint: "topTraderAccountsLongShort", longField: "", deltaEndpoint: "whaleRetailDelta", deltaField: "", coin: "BTC", exchange: "binance_perp_stable", timeframe: "1h" },
    signals: { ...OTHER_SIGNAL_CFG, rsiNear: 12 },
    mistakes: [...OTHER_MISTAKES],
    market: { symbol: "BITSTAMP:BTCUSD", longTrigger: 85900, longStop: 85300, shortTrigger: 84500, lowerHigh: 82829, rsiWeekly: 62.09, invalidation: 75500, zoneLow: 81500, zoneHigh: 82200 },
  };
}

export const OTHER_SIGNAL_SNAP = {
  at: "2026-10-01T08:30:00.000Z",
  side: "long",
  score: 72,
  strength: 2,
  tiers: 2,
  label: "Stark",
  valid: true,
  rsiOk: true,
  zoneOk: false,
  zone: "equilibrium",
  deep: false,
  tfs: [
    { tf: "30m", kind: "bottom", wt: -58.4, rsi: 33.1 },
    { tf: "45m", kind: "buy", wt: -49.2, rsi: 36.4 },
    { tf: "1h", kind: null, wt: -31, rsi: 41.2 },
    { tf: "4h", kind: null, wt: -12.5, rsi: 46 },
  ],
};

/** Trades as the other version stores them (raw, `pnl`/`r` written by its form). */
export function otherTrades(): Array<Record<string, unknown>> {
  return [
    {
      id: "t_other_1",
      account: "scalp",
      date: "2026-10-01T10:30",
      pair: "BTC/USDT",
      timeframe: "45m",
      side: "long",
      status: "closed",
      entry: 61000,
      stop: 60400,
      target: 62500,
      exit: 62000,
      size: 6100,
      leverage: 4,
      fees: 2,
      pnlManual: null,
      setups: ["s_mtf"],
      checks: { "s_mtf:mtf_base": true, "s_mtf:mtf_next": true, "g:trigger": true },
      reason: "Bottom auf 30m und 45m",
      conviction: 4,
      followedPlan: true,
      emotion: "Ruhig",
      notes: "",
      chart: "",
      pnl: 98,
      r: 1.63,
      createdAt: "2026-10-01T10:31:00.000Z",
      updatedAt: "2026-10-01T10:31:00.000Z",
      signal: OTHER_SIGNAL_SNAP,
      mistakes: ["Zu früh raus"],
    },
    {
      id: "t_other_2",
      account: "makro",
      date: "2026-10-02T14:00",
      pair: "BTC/USDT",
      timeframe: "2h",
      side: "short",
      status: "open",
      entry: 63000,
      stop: 64000,
      target: 60000,
      exit: null,
      size: 12600,
      leverage: 2,
      fees: null,
      pnlManual: null,
      setups: [],
      checks: {},
      reason: "",
      conviction: null,
      followedPlan: null,
      emotion: "",
      notes: "",
      chart: "",
      createdAt: "2026-10-02T14:01:00.000Z",
      updatedAt: "2026-10-02T14:01:00.000Z",
      signal: null,
      mistakes: [],
    },
  ];
}

/** The other version's JSON backup (Einstellungen → Daten → Backup (JSON)). */
export function otherBackup(): { exportedAt: string; settings: Record<string, unknown>; trades: Array<Record<string, unknown>> } {
  return { exportedAt: "2026-10-03T09:00:00.000Z", settings: otherSettings(), trades: otherTrades() };
}

/** Seeds localStorage the way the other file leaves it (shared file:// storage): raw keys, no `tj2-meta`. */
export function seedOtherVersion(): void {
  localStorage.clear();
  localStorage.setItem("tj2-trades", JSON.stringify(otherTrades()));
  localStorage.setItem("tj2-settings", JSON.stringify(otherSettings()));
  localStorage.setItem("tj2-hyblock", JSON.stringify([{ id: "h_o1", at: "2026-10-01T09:00", longPct: 61, delta: 2, deltaCandles: 2, structure: true, rsi: false, note: "" }]));
}
