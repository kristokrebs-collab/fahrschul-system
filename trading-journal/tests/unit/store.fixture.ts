/**
 * Minimal legacy (v0) localStorage layout for deterministic count-based assertions.
 * `loadV0File()` returns the full legacy fixture `tests/fixtures/tj2-v0.json` (domain agent).
 */
import v0File from "../fixtures/tj2-v0.json";

export interface V0Fixture {
  "tj2-trades": unknown[];
  "tj2-settings": Record<string, unknown> | null;
  "tj2-hyblock": unknown[];
}

const INLINE: V0Fixture = {
  "tj2-trades": [
    {
      id: "t_abc1234x9z1",
      account: "scalp",
      side: "long",
      status: "closed",
      date: "2026-03-02T10:15",
      pair: "BTC/USDT",
      timeframe: "4h",
      entry: 84000,
      stop: 83000,
      target: 87000,
      exit: 86000,
      size: 1000,
      leverage: 4,
      fees: 1,
      pnlManual: null,
      setups: ["s_bo"],
      checks: { "g:trigger": true, "s_bo:c1": true },
      conviction: 4,
      followedPlan: true,
      emotion: "Ruhig",
      reason: "4H-Schluss über 85.900",
      notes: "",
      chart: "",
      pnl: 0,
      r: 0,
      createdAt: "2026-03-02T10:20:00.000Z",
      updatedAt: "2026-03-02T10:20:00.000Z",
      legacyExtra: "keep-me",
    },
    {
      // legacy record without `account` (→ scalp on read), short, open
      id: "t_open0000001",
      side: "short",
      status: "open",
      date: "2026-03-05T08:00",
      pair: "BTC/USDT",
      timeframe: "",
      entry: 85000,
      stop: 86000,
      target: 82000,
      exit: null,
      size: 500,
      leverage: 4,
      fees: null,
      pnlManual: null,
      setups: [],
      checks: {},
      conviction: null,
      followedPlan: null,
      emotion: "",
      reason: "",
      notes: "",
      chart: "",
      pnl: null,
      r: null,
      createdAt: "2026-03-05T08:01:00.000Z",
      updatedAt: "2026-03-05T08:01:00.000Z",
    },
  ],
  "tj2-settings": {
    currency: "USDT",
    pair: "BTC/USDT",
    startDate: "",
    capital: { makro: "20000", scalp: 5000 },
    setups: [{ id: "s_bo", name: "4H-Breakout über 85.900", color: "#6f9dc9", checklist: [{ id: "c1", text: "4H-Schluss über 85.900" }] }],
    rules: [{ id: "trigger", text: "Trigger ausgelöst, nicht geraten" }],
    customFlag: true,
  },
  "tj2-hyblock": [
    { id: "h_2", at: "2026-03-04T12:00", longPct: 58.4, delta: 3, deltaCandles: 2, structure: true, rsi: false, note: "" },
    { id: "h_1", at: "2026-03-03T12:00", longPct: 55, delta: -1, deltaCandles: 0, structure: false, rsi: false, note: "x" },
  ],
};

export function loadV0Fixture(): V0Fixture {
  return structuredClone(INLINE);
}

/** The full legacy fixture written by the domain agent. */
export function loadV0File(): V0Fixture {
  const json = v0File as unknown as Partial<V0Fixture>;
  return {
    "tj2-trades": Array.isArray(json["tj2-trades"]) ? json["tj2-trades"] : [],
    "tj2-settings": json["tj2-settings"] ?? null,
    "tj2-hyblock": Array.isArray(json["tj2-hyblock"]) ? json["tj2-hyblock"] : [],
  };
}

export function seedV0(fixture: V0Fixture = loadV0Fixture()): V0Fixture {
  localStorage.clear();
  localStorage.setItem("tj2-trades", JSON.stringify(fixture["tj2-trades"]));
  if (fixture["tj2-settings"]) localStorage.setItem("tj2-settings", JSON.stringify(fixture["tj2-settings"]));
  localStorage.setItem("tj2-hyblock", JSON.stringify(fixture["tj2-hyblock"]));
  return fixture;
}

/** A truly broken record: no `id` (the normaliser cannot invent one). Odd field types alone are NOT broken. */
export const BROKEN_TRADE = { side: 42, status: "closed", date: "2026-01-01T00:00", setups: "nope", marker: "t_broken" };

/** A legacy record the old app read fine: numbers as strings, `null` text, junk chart link. */
export const LEGACY_LOOSE_TRADE = {
  id: "t_loose000001",
  side: "long",
  status: "closed",
  date: "2026-02-01T09:00",
  pair: "BTC/USDT",
  entry: "100",
  stop: "90,5",
  exit: "110",
  size: "1000",
  notes: null,
  reason: null,
  chart: "javascript:alert(1)",
  setups: null,
  checks: null,
};
