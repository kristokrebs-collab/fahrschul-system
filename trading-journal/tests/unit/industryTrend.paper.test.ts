/**
 * C1: the rules of the Papier-Portfolio (Branchen-Signal → Papier-Position), pure. Hand-worked sizes, every rule on its own, the
 * states of a position, and the idempotence: the same signal – or the same button twice, or many tries in a row – makes ONE position.
 */
import { describe, expect, it } from "vitest";
import type { Bar } from "@/domain/backtest/types";
import {
  bookOfStored,
  bookStats,
  CHECK_PLAN,
  closePosition,
  decide,
  emptyBook,
  INSTRUMENTS,
  instrumentOf,
  MAX_BAR_AGE_DAYS,
  MAX_OPEN,
  MAX_SIGNAL_AGE_DAYS,
  openPosition,
  openPositions,
  PAPER_CAPITAL,
  planFromBars,
  positionForRed,
  positionIdOf,
  signalAgeDays,
  signalIdOf,
  signalOfRow,
  type CheckPlan,
  type DecideInput,
  type PaperBook,
  type SimFacts,
  type TrendSignal,
} from "@/domain/industryTrend/paper";
import { latticeBars } from "./timemachine.helpers";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 6, 12, 0, 0); // 6 Nov 2026, noon UTC
const ymd = (ms: number): string => new Date(ms).toISOString().slice(0, 10).replace(/-/g, "");
const FRESH = ymd(NOW - DAY); // yesterday's data day

const sig = (over: Partial<TrendSignal> = {}): TrendSignal => {
  const base = { branche: "Food", state: "gruen" as const, datum: "20260901", asOf: FRESH, source: "tradingview" as const, strategie: "s-20-40-2.8-0.02-2.0", ...over };
  return { ...base, signalId: signalIdOf(base) };
};

/** 300 daily candles, the last one closed this morning (age < 1 day). */
const bars = (n = 300): Bar[] => {
  const lastT = Math.floor(NOW / DAY) * 86_400 - 86_400;
  return latticeBars(n, 0.5, 86_400, lastT - (n - 1) * 86_400);
};

const plan: CheckPlan = { entry: 100, stop: 96, target: 108, atr: 2, lastCloseMs: NOW - 3_600_000 };

const simFor = (s: TrendSignal, over: Partial<SimFacts> = {}, p: CheckPlan = plan): SimFacts => ({
  simulationId: `sim_${"a".repeat(32)}`,
  tradeId: positionIdOf(s.signalId),
  symbol: "PBJ",
  runs: 10_000,
  verdictId: "coin",
  verdict: "Nahe am Break-even",
  targetP: 0.32,
  stopP: 0.34,
  expectancyR: -0.01,
  plan: { side: "long", entry: p.entry, stop: p.stop, target: p.target },
  ...over,
});

const input = (over: Partial<DecideInput> = {}): DecideInput => {
  const signal = over.signal ?? sig();
  return { signal, now: NOW, book: emptyBook(), instrument: instrumentOf("Food"), bars: bars(), plan, sim: simFor(signal), ...over };
};

const failed = (d: ReturnType<typeof decide>): string[] => d.checks.filter((c) => !c.ok).map((c) => c.id);

describe("Signal", () => {
  it("die ID ist stabil: gleiches Signal, gleiche ID – ein anderer Tag, eine andere Richtung oder Quelle ist ein anderes", () => {
    const a = sig();
    expect(sig().signalId).toBe(a.signalId);
    expect(a.signalId).toMatch(/^sig_[0-9a-f]{20}$/);
    const ids = new Set([a.signalId, sig({ datum: "20260902" }).signalId, sig({ state: "rot" }).signalId, sig({ source: "ken-french" }).signalId, sig({ branche: "Banks" }).signalId, sig({ strategie: "s-65-20-1.0-0.01-2.0" }).signalId]);
    expect(ids.size).toBe(6);
  });

  it("eine Zeile der Ampel: kauf → grün, cash → rot, „seit Beginn“ → 00000000; der Datenstand ist der letzte Datentag", () => {
    const g = signalOfRow({ code: "Food", state: "kauf", since: 20260901 }, 20260930, "s-x");
    expect(g).toMatchObject({ branche: "Food", state: "gruen", datum: "20260901", asOf: "20260930", source: "ken-french" });
    expect(signalOfRow({ code: "Food", state: "cash", since: null }, 20260930, "s-x")).toMatchObject({ state: "rot", datum: "00000000" });
    expect(g.signalId).toBe(signalIdOf(g));
  });

  it("das Alter in Tagen: vom Ende des Datentags bis jetzt; Unlesbares ist unendlich alt", () => {
    expect(signalAgeDays(FRESH, NOW)).toBeCloseTo(0.5, 1); // yesterday 23:59:59 → noon today
    expect(signalAgeDays(ymd(NOW - 10 * DAY), NOW)).toBeCloseTo(9.5, 1);
    expect(signalAgeDays("20261107", NOW)).toBe(0); // a day in the future is not "negative"
    expect(signalAgeDays("gestern", NOW)).toBe(Infinity);
    expect(signalAgeDays("", NOW)).toBe(Infinity);
  });
});

describe("Instrumente", () => {
  it("nur Branchen mit einem ETF der Liste können eröffnen; die Liste kennt nur gültige Kürzel", () => {
    expect(instrumentOf("Food")?.symbol).toBe("PBJ");
    expect(instrumentOf("Guns")).toBeNull();
    expect(instrumentOf("gibt-es-nicht")).toBeNull();
    for (const [code, i] of Object.entries(INSTRUMENTS)) {
      expect(i.symbol, code).toMatch(/^[A-Z]{2,5}$/);
      expect(i.name.length).toBeGreaterThan(5);
    }
  });
});

describe("Prüfplan aus den Kerzen", () => {
  it("Einstieg = letzter Schluss, Stop = 2 × ATR darunter, Ziel = 2 R darüber, Zeitstopp 20 Tage", () => {
    const b = bars();
    const p = planFromBars(b)!;
    expect(p.entry).toBeCloseTo(b[b.length - 1]!.c, 3);
    expect(p.atr).toBeGreaterThan(0);
    expect(p.entry - p.stop).toBeCloseTo(CHECK_PLAN.stopAtr * p.atr, 2);
    expect(p.target - p.entry).toBeCloseTo(CHECK_PLAN.targetR * (p.entry - p.stop), 2);
    expect(CHECK_PLAN.horizon).toBe(20);
    expect(p.lastCloseMs).toBe((b[b.length - 1]!.t + 86_400) * 1000);
  });

  it("zu wenige Kerzen für einen ATR → kein Plan", () => {
    expect(planFromBars(bars(10))).toBeNull();
    expect(planFromBars([])).toBeNull();
  });
});

describe("Risikoregel", () => {
  it("alles in Ordnung → Ja; Größe von Hand: 100 $ Risiko ÷ 4 $ je Stück = 25 Stück, Deckel 2 500 $ ÷ 100 = 25 → 25 Stück, 2 500 $, Risiko 100 $", () => {
    const d = decide(input());
    expect(d.ok).toBe(true);
    expect(failed(d)).toEqual([]);
    expect(d.checks.map((c) => c.id)).toEqual(["notaus", "gruen", "alter", "instrument", "doppel", "offen", "kerzen", "zeitmaschine", "limit", "groesse"]);
    expect(d.sizing).toEqual({ qty: 25, entry: 100, stop: 96, target: 108, riskPerShare: 4, riskAmount: 100, notional: 2500 });
  });

  it("der Deckel bindet bei engem Stop: 50 $ Einstieg, 1 $ Risiko je Stück → Risiko erlaubt 100, Deckel 50 → 50 Stück", () => {
    const p: CheckPlan = { entry: 50, stop: 49, target: 52, atr: 0.5, lastCloseMs: NOW };
    const s = sig();
    expect(decide(input({ plan: p, sim: simFor(s, {}, p) })).sizing).toMatchObject({ qty: 50, notional: 2500, riskAmount: 50 });
  });

  it("jede Regel einzeln: Not-Aus", () => {
    const d = decide(input({ book: { ...emptyBook(), killSwitch: true } }));
    expect(failed(d)).toEqual(["notaus"]);
    expect(d.ok).toBe(false);
  });

  it("jede Regel einzeln: Rot ist Cash – nie eine Short-Position", () => {
    const s = sig({ state: "rot" });
    const d = decide(input({ signal: s, sim: simFor(s) }));
    expect(failed(d)).toContain("gruen");
    expect(d.checks.find((c) => c.id === "gruen")!.text).toMatch(/nie.*Short/);
    expect(d.ok).toBe(false);
  });

  it("jede Regel einzeln: veraltete Signale eröffnen nichts – an der Grenze noch, einen Tag später nicht", () => {
    const edge = sig({ asOf: ymd(NOW - (MAX_SIGNAL_AGE_DAYS - 1) * DAY) });
    expect(decide(input({ signal: edge, sim: simFor(edge) })).checks.find((c) => c.id === "alter")!.ok).toBe(true);
    const old = sig({ asOf: ymd(NOW - (MAX_SIGNAL_AGE_DAYS + 2) * DAY) });
    const d = decide(input({ signal: old, sim: simFor(old) }));
    expect(failed(d)).toEqual(["alter"]);
    expect(d.checks.find((c) => c.id === "alter")!.text).toMatch(/veraltet/);
    const weeks = sig({ asOf: ymd(NOW - 40 * DAY) });
    expect(failed(decide(input({ signal: weeks, sim: simFor(weeks) })))).toEqual(["alter"]);
    const junk = sig({ asOf: "bald" });
    expect(failed(decide(input({ signal: junk, sim: simFor(junk) })))).toEqual(["alter"]);
  });

  it("jede Regel einzeln: ohne ETF in der Liste nichts", () => {
    const s = sig({ branche: "Guns" });
    expect(failed(decide(input({ signal: s, instrument: null, sim: simFor(s) })))).toContain("instrument");
  });

  it("jede Regel einzeln: Kerzen – fehlen, zu wenige, zu alt", () => {
    expect(failed(decide(input({ bars: null, barsProblem: "Die Quelle antwortet nicht.", plan: null, sim: null })))).toContain("kerzen");
    expect(decide(input({ bars: null, barsProblem: "Die Quelle antwortet nicht.", plan: null, sim: null })).checks.find((c) => c.id === "kerzen")!.text).toBe("Die Quelle antwortet nicht.");
    expect(failed(decide(input({ bars: bars(120) })))).toEqual(["kerzen"]);
    const stale = latticeBars(300, 0.5, 86_400, Math.floor(NOW / 1000) - (MAX_BAR_AGE_DAYS + 5 + 300) * 86_400);
    const d = decide(input({ bars: stale }));
    expect(failed(d)).toEqual(["kerzen"]);
    expect(d.checks.find((c) => c.id === "kerzen")!.text).toMatch(/veraltet/);
  });

  it("jede Regel einzeln: Zeitmaschine – fehlt, passt nicht zum Plan oder Trade, zu wenige Läufe, „Stop deutlich vor Ziel“", () => {
    const s = sig();
    const z = (over: Partial<SimFacts>): string[] => failed(decide(input({ sim: simFor(s, over) })));
    expect(failed(decide(input({ sim: null })))).toEqual(["zeitmaschine"]);
    expect(z({ plan: { side: "long", entry: 100, stop: 95, target: 108 } })).toEqual(["zeitmaschine"]);
    expect(z({ tradeId: "pp_anderer" })).toEqual(["zeitmaschine"]);
    expect(z({ symbol: "XYZ" })).toEqual(["zeitmaschine"]);
    expect(z({ runs: 999 })).toEqual(["zeitmaschine"]);
    expect(z({ verdictId: "strongStop" })).toEqual(["zeitmaschine"]);
    expect(decide(input({ sim: simFor(s, { verdictId: "strongStop" }) })).checks.find((c) => c.id === "zeitmaschine")!.text).toMatch(/keine Prognose/);
    // the other verdicts pass the gate (they are shown, not blocked)
    for (const v of ["coin", "breakeven", "target", "stop", "strongTarget", "none"]) expect(z({ verdictId: v }), v).toEqual([]);
  });

  it("jede Regel einzeln: Doppelsignal und zweite Position", () => {
    const s = sig();
    const first = openPosition({ ...input(), simulationId: `sim_${"b".repeat(32)}` });
    expect(first.status).toBe("opened");
    const book = first.book;
    // the same signal again
    expect(failed(decide(input({ book })))).toContain("doppel");
    // a NEW green signal of the same industry while the first is open
    const next = sig({ datum: "20261105" });
    const d = decide(input({ signal: next, book, sim: simFor(next) }));
    expect(failed(d)).toEqual(["offen"]);
    expect(d.checks.find((c) => c.id === "offen")!.text).toMatch(/höchstens eine/);
    // the same ETF through another industry
    const other = sig({ branche: "Fin" });
    expect(failed(decide(input({ signal: other, book, instrument: instrumentOf("Food"), sim: simFor(other) })))).toContain("offen");
    expect(s.signalId).not.toBe(next.signalId);
  });

  it("jede Regel einzeln: höchstens fünf offene Positionen, Konto zu klein", () => {
    let book: PaperBook = emptyBook();
    const codes = ["Food", "Banks", "Util", "Oil", "Gold"];
    for (const c of codes) {
      const s = sig({ branche: c });
      const inst = instrumentOf(c)!;
      const p: CheckPlan = { entry: 100, stop: 50, target: 200, atr: 25, lastCloseMs: NOW };
      const o = openPosition({ signal: s, now: NOW, book, instrument: inst, bars: bars(), plan: p, sim: simFor(s, { symbol: inst.symbol }, p), simulationId: `sim_${"c".repeat(32)}` });
      expect(o.status).toBe("opened");
      book = o.book;
    }
    expect(openPositions(book)).toHaveLength(MAX_OPEN);
    const s = sig({ branche: "Chips" });
    const d = decide(input({ signal: s, book, instrument: instrumentOf("Chips"), sim: simFor(s, { symbol: "SMH" }) }));
    expect(failed(d)).toEqual(["offen"]);
    expect(d.checks.find((c) => c.id === "offen")!.text).toMatch(/Grenze 5/);
    // a share that costs more than the cap: no whole share fits
    const big: CheckPlan = { entry: 5000, stop: 4900, target: 5200, atr: 50, lastCloseMs: NOW };
    const s2 = sig();
    const tiny = decide(input({ plan: big, sim: simFor(s2, {}, big) }));
    expect(failed(tiny)).toEqual(["limit", "groesse"]);
    expect(tiny.sizing).toBeNull();
    expect(tiny.checks.find((c) => c.id === "limit")!.text).toMatch(/deckel/i);
  });

  it("kein Hebel: das freie Geld des Papierkontos begrenzt die Größe", () => {
    let book: PaperBook = emptyBook();
    const take = (code: string, notional: number): void => {
      const s = sig({ branche: code });
      const inst = instrumentOf(code)!;
      const p: CheckPlan = { entry: 100, stop: 90, target: 120, atr: 5, lastCloseMs: NOW };
      const o = openPosition({ signal: s, now: NOW, book, instrument: inst, bars: bars(), plan: p, sim: simFor(s, { symbol: inst.symbol }, p), simulationId: `sim_${"d".repeat(32)}` });
      expect(o.status).toBe("opened");
      book = { ...o.book, positions: o.book.positions.map((x) => (x.branche === code ? { ...x, notional } : x)) };
    };
    take("Banks", 4_000);
    take("Util", 4_000);
    take("Oil", 1_500); // 9 500 $ bound, 500 $ free
    const s = sig();
    const d = decide(input({ book, sim: simFor(s) }));
    expect(d.sizing?.qty).toBe(5); // 500 $ ÷ 100 $ per share
    expect(PAPER_CAPITAL).toBe(10_000);
  });
});

describe("Eine Position je Signal – idempotent", () => {
  const base = (over: Partial<DecideInput & { simulationId: string }> = {}) => ({ ...input(), simulationId: `sim_${"e".repeat(32)}`, ...over });

  it("die Position trägt signalId, simulationId und tradeId; die ID ist aus dem Signal abgeleitet", () => {
    const o = openPosition(base());
    expect(o.status).toBe("opened");
    if (o.status !== "opened") return;
    const p = o.position;
    expect(p).toMatchObject({ signalId: sig().signalId, simulationId: `sim_${"e".repeat(32)}`, side: "long", status: "open", symbol: "PBJ", qty: 25, entry: 100, stop: 96, target: 108, modus: "PAPIER", gesendet: false });
    expect(p.id).toBe(positionIdOf(sig().signalId));
    expect(p.tradeId).toBe(p.id);
    expect(p.id).toMatch(/^pp_[0-9a-f]{20}$/);
    expect(p.signalAgeDays).toBeLessThan(MAX_SIGNAL_AGE_DAYS);
    expect(o.book.positions).toHaveLength(1);
  });

  it("dasselbe Signal noch einmal (auch auf dem alten Buch) gibt „duplicate“ mit der ersten Position – es entsteht keine zweite", () => {
    const first = openPosition(base());
    expect(first.status).toBe("opened");
    const again = openPosition(base({ book: first.book }));
    expect(again.status).toBe("duplicate");
    expect(again.book.positions).toHaveLength(1);
    // even when the caller still holds the OLD empty book (two tabs): the id is the same, the store refuses by id
    const stale = openPosition(base({ book: emptyBook() }));
    expect(stale.status).toBe("opened");
    if (first.status === "opened" && stale.status === "opened") expect(stale.position.id).toBe(first.position.id);
  });

  it("viele Versuche hintereinander (auch gemischt mit anderen Signalen derselben Branche) ergeben nie mehr als eine offene Position je Branche", () => {
    let book = emptyBook();
    let tries = 0;
    for (let i = 0; i < 60; i++) {
      const s = sig({ datum: i % 3 === 0 ? "20260901" : i % 3 === 1 ? "20261001" : "20261101" });
      const o = openPosition({ ...input({ signal: s, book, sim: simFor(s) }), simulationId: `sim_${"f".repeat(32)}` });
      book = o.book;
      tries++;
    }
    expect(tries).toBe(60);
    expect(openPositions(book).filter((p) => p.branche === "Food")).toHaveLength(1);
    expect(book.positions).toHaveLength(1);
  });

  it("eine abgelehnte Eröffnung ändert das Buch nicht", () => {
    const book = emptyBook();
    const o = openPosition(base({ book: { ...book, killSwitch: true } }));
    expect(o.status).toBe("refused");
    expect(o.book.positions).toHaveLength(0);
    if (o.status === "refused") expect(failed(o.decision)).toEqual(["notaus"]);
    const stale = sig({ asOf: ymd(NOW - 30 * DAY) });
    expect(openPosition({ ...input({ signal: stale, sim: simFor(stale) }), simulationId: `sim_${"e".repeat(32)}` }).status).toBe("refused");
  });
});

describe("Zustände: offen → geschlossen", () => {
  const opened = () => {
    const o = openPosition({ ...input(), simulationId: `sim_${"e".repeat(32)}` });
    if (o.status !== "opened") throw new Error("not opened");
    return o;
  };

  it("Ausstieg bei Rot: Preis, Gewinn in Geld und in R (Risiko 100 $ = 1 R)", () => {
    const o = opened();
    const c = closePosition(o.book, o.position.id, 104, "rot", NOW + DAY, "sig_" + "1".repeat(20))!;
    expect(c.position).toMatchObject({ status: "closed", exit: 104, exitReason: "rot", pnl: 100, r: 1, exitSignalId: "sig_" + "1".repeat(20) });
    expect(c.book.positions).toHaveLength(1);
    expect(bookStats(c.book)).toEqual({ open: 0, closed: 1, pnl: 100, r: 1 });
    // a loss at the stop: −1 R
    const l = closePosition(o.book, o.position.id, 96, "manuell", NOW + DAY)!;
    expect(l.position).toMatchObject({ pnl: -100, r: -1, exitReason: "manuell" });
  });

  it("nur Offenes lässt sich schließen – zweimal, mit unbekannter ID oder ohne Preis nicht", () => {
    const o = opened();
    const c = closePosition(o.book, o.position.id, 101, "manuell", NOW)!;
    expect(closePosition(c.book, o.position.id, 102, "manuell", NOW)).toBeNull();
    expect(closePosition(o.book, "pp_unbekannt", 101, "manuell", NOW)).toBeNull();
    expect(closePosition(o.book, o.position.id, NaN, "manuell", NOW)).toBeNull();
    expect(closePosition(o.book, o.position.id, 0, "manuell", NOW)).toBeNull();
  });

  it("der Not-Aus verhindert Neues, nie das Schließen", () => {
    const o = opened();
    const armed = { ...o.book, killSwitch: true };
    expect(closePosition(armed, o.position.id, 99, "manuell", NOW)).not.toBeNull();
    const next = sig({ branche: "Banks" });
    expect(openPosition({ ...input({ signal: next, book: armed, instrument: instrumentOf("Banks"), sim: simFor(next, { symbol: "KBE" }) }), simulationId: `sim_${"e".repeat(32)}` }).status).toBe("refused");
  });

  it("Rot schließt die offene Position der Branche – sonst passiert nichts; Grün schließt nichts", () => {
    const o = opened();
    expect(positionForRed(o.book, sig({ state: "rot" }))?.id).toBe(o.position.id);
    expect(positionForRed(o.book, sig({ state: "rot", branche: "Banks" }))).toBeNull();
    expect(positionForRed(o.book, sig({ state: "gruen" }))).toBeNull();
    expect(positionForRed(emptyBook(), sig({ state: "rot" }))).toBeNull();
    // after the exit a red signal finds nothing more to close
    const c = closePosition(o.book, o.position.id, 101, "rot", NOW)!;
    expect(positionForRed(c.book, sig({ state: "rot" }))).toBeNull();
  });
});

describe("Ablage lesen", () => {
  it("übersteht JSON; Unlesbares fällt weg, doppelte IDs auch; der Not-Aus bleibt", () => {
    const o = openPosition({ ...input(), simulationId: `sim_${"e".repeat(32)}` });
    if (o.status !== "opened") throw new Error("not opened");
    const raw = JSON.parse(JSON.stringify({ ...o.book, killSwitch: true }));
    const back = bookOfStored(raw);
    expect(back.killSwitch).toBe(true);
    expect(back.positions).toEqual(o.book.positions);
    const dirty = bookOfStored({ killSwitch: "ja", positions: [raw.positions[0], raw.positions[0], null, "x", { ...raw.positions[0], id: "kaputt" }, { ...raw.positions[0], side: "short" }, { ...raw.positions[0], tradeId: "pp_" + "0".repeat(20) }] });
    expect(dirty.killSwitch).toBe(false);
    expect(dirty.positions).toHaveLength(1);
    expect(bookOfStored(null)).toEqual(emptyBook());
    expect(bookOfStored({ positions: "nein" })).toEqual(emptyBook());
  });
});
