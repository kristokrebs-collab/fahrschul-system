/**
 * Verwaltungsplan (F65): wie ein Trade NACH dem Einstieg verwaltet wird – Stop auf Einstieg oder Netto-Break-even nachziehen,
 * ein Teilziel nehmen, mit Abstand hinter dem besten Kurs nachziehen –, entschieden VOR dem Einstieg und als Anweisung an dich
 * selbst. Dieselben Regeln (und Wertebereiche) wie im Backtest („Eigene Idee“: `ExitsCfg`, Engine `PositionMgmt`), damit Plan und
 * Test dasselbe meinen: ein Auslöser wird am Kerzenschluss entschieden und gilt ab der nächsten Kerze, der Stop wird nur
 * nachgezogen (nie gelockert), das Teilziel muss vor dem Ziel liegen.
 *
 * Rein: Preise, Mengen und Kosten kommen von außen. Die Beispielrechnungen („Szenarien“) sind Rechenbeispiele einzelner Wege –
 * keine Prognose und keine Aussage, welcher Weg eintritt. Gebühr je Seite und Slippage am Stop sind die Annahmen der
 * Risiko-Einstellungen (kein Maker-Rabatt, kein Funding); die App ändert nie eine echte Order, die neuen Stops setzt die Person selbst.
 */
import type { Side } from "../types";
import type { ExitsCfg } from "../lab/rules/types";
import { moneyText, numTrim, pctText, priceText, qtyText, toStep } from "./format";

export type ManageSpec = Pick<ExitsCfg, "breakEven" | "trail" | "partial">;

export const DEFAULT_MANAGE: Readonly<ManageSpec> = Object.freeze({
  breakEven: Object.freeze({ on: false, trigger: "r", value: 1, to: "entry" }),
  trail: Object.freeze({ on: false, kind: "atr", value: 2, activateR: 1 }),
  partial: Object.freeze({ on: false, atR: 1, fracPct: 50, thenBreakEven: true }),
}) as ManageSpec;

/** Allowed ranges – the same as the lab's rule builder (`sanitizeCustom`), pinned by a test. */
export const MANAGE_LIMITS = {
  breakEvenR: { min: 0.2, max: 10 },
  breakEvenPct: { min: 0.1, max: 50 },
  trailAtr: { min: 0.5, max: 10 },
  trailPct: { min: 0.2, max: 30 },
  activateR: { min: 0, max: 10 },
  partialR: { min: 0.2, max: 10 },
  partialPct: { min: 5, max: 95 },
} as const;

type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => typeof v === "object" && v !== null && !Array.isArray(v);
const clampNum = (v: unknown, lo: number, hi: number, d: number, int = false): number => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(",", ".")) : NaN;
  if (!Number.isFinite(n)) return d;
  const c = Math.max(lo, Math.min(hi, n));
  return int ? Math.round(c) : c;
};
const pick = <T extends string>(v: unknown, ok: readonly T[], d: T): T => (ok.includes(v as T) ? (v as T) : d);

/** Anything → a valid `ManageSpec` (invalid parts fall back to the defaults, values are clamped into the allowed ranges). */
export function manageSpecOf(raw: unknown): ManageSpec {
  const r: Raw = isObj(raw) ? raw : {};
  const be: Raw = isObj(r.breakEven) ? r.breakEven : {};
  const tr: Raw = isObj(r.trail) ? r.trail : {};
  const pa: Raw = isObj(r.partial) ? r.partial : {};
  const d = DEFAULT_MANAGE;
  const trigger = pick(be.trigger, ["r", "pct"] as const, d.breakEven.trigger);
  const kind = pick(tr.kind, ["atr", "pct"] as const, d.trail.kind);
  const L = MANAGE_LIMITS;
  return {
    breakEven: {
      on: be.on === true,
      trigger,
      value: trigger === "r" ? clampNum(be.value, L.breakEvenR.min, L.breakEvenR.max, d.breakEven.value) : clampNum(be.value, L.breakEvenPct.min, L.breakEvenPct.max, 2),
      to: pick(be.to, ["entry", "net"] as const, d.breakEven.to),
    },
    trail: {
      on: tr.on === true,
      kind,
      value: kind === "atr" ? clampNum(tr.value, L.trailAtr.min, L.trailAtr.max, d.trail.value) : clampNum(tr.value, L.trailPct.min, L.trailPct.max, 3),
      activateR: clampNum(tr.activateR, L.activateR.min, L.activateR.max, d.trail.activateR),
    },
    partial: {
      on: pa.on === true,
      atR: clampNum(pa.atR, L.partialR.min, L.partialR.max, d.partial.atR),
      fracPct: clampNum(pa.fracPct, L.partialPct.min, L.partialPct.max, d.partial.fracPct, true),
      thenBreakEven: pa.thenBreakEven !== false,
    },
  };
}

/** Is at least one rule switched on? */
export const manageActive = (m: ManageSpec): boolean => m.breakEven.on || m.trail.on || m.partial.on;

/** Same meaning (for "did the plan change")? */
export const manageEqual = (a: ManageSpec, b: ManageSpec): boolean => JSON.stringify(manageSpecOf(a)) === JSON.stringify(manageSpecOf(b));

export interface ManageInput {
  side: Side;
  entry: number;
  stop: number;
  /** the plan's target; `null` = none (the target scenarios are left out) */
  target: number | null;
  qty: number;
  /** quantity step and price step */
  lot: number;
  tick: number;
  /** fee per side and slippage on a stop fill, fractions of the price (the risk settings) */
  feePct: number;
  slippagePct: number;
  /** ATR(14) at the entry, `null` = unknown */
  atr: number | null;
  spec: ManageSpec;
  currency: string;
  /** base asset for the words ("BTC"); empty = "Einheiten" */
  unit?: string;
}

export interface ManageStep {
  id: "breakEven" | "partial" | "trail";
  title: string;
  /** the condition, in words with the price */
  when: string;
  /** what happens then */
  then: string;
  /** the price that arms the rule (`null` = none) */
  trigger: number | null;
  /** the stop in force after this step (`null` = unchanged / not a stop move) */
  stopAfter: number | null;
  /** the rule can never act before the target */
  never: boolean;
}

export interface ManageScenario {
  id: "stop" | "target" | "breakEven" | "partialStop" | "partialTarget" | "trail";
  label: string;
  detail: string;
  /** result after fees and slippage (quote currency) */
  pnl: number;
  /** pnl ÷ (quantity × distance to the original stop), like the backtest's R */
  r: number;
}

export interface ManageNote {
  key: string;
  level: "warn" | "info";
  text: string;
}

export interface ManageLine {
  label: string;
  text: string;
}

export interface ManagePlan {
  ok: true;
  active: boolean;
  steps: ManageStep[];
  scenarios: ManageScenario[];
  notes: ManageNote[];
  /** the plan in plain lines (ticket, copy): the rule's name and one sentence */
  lines: ManageLine[];
  /** what the plan assumed (fees …) */
  assumptions: string[];
  /** the partial fill (quantity sold / left), `null` without a usable partial */
  partial: { qty: number; rest: number; price: number } | null;
  /** price of the first rule that arms (for an alarm), `null` without a rule that can act */
  firstTrigger: number | null;
  /** the currency of the scenarios' money */
  currency: string;
}

export type ManageResult = ManagePlan | { ok: false; reason: string };

const fin = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

/** Break-even price at which the REST of the position closes with a total result of zero (fees and slippage included). */
export function netBreakEvenPrice(o: { side: Side; entry: number; qtyOpen: number; entryFee: number; booked: number; feePct: number; slippagePct: number }): number {
  const need = (o.entryFee - o.booked) / o.qtyOpen;
  return o.side === "long" ? (o.entry + need) / (1 - o.feePct - o.slippagePct) : (o.entry - need) / (1 + o.feePct + o.slippagePct);
}

/**
 * The management plan of one trade. `ok: false` only for input the plan cannot work with (no stop, no quantity); a rule that
 * can never act or is dropped (partial beyond the target, a quantity below one step) is a note, not a refusal.
 */
export function managePlan(i: ManageInput): ManageResult {
  const { side, entry, stop, qty, lot, tick, feePct, slippagePct } = i;
  const long = side === "long";
  const dir = long ? 1 : -1;
  if (!fin(entry) || !(entry > 0) || !fin(stop) || !(stop > 0)) return { ok: false, reason: "Einstieg und Stop fehlen." };
  if (long ? stop >= entry : stop <= entry) return { ok: false, reason: `Der Stop liegt auf der falschen Seite des Einstiegs (bei ${long ? "Long" : "Short"} gehört er ${long ? "darunter" : "darüber"}).` };
  if (!fin(qty) || !(qty > 0) || !(lot > 0) || !(tick > 0)) return { ok: false, reason: "Die Menge oder die Schritte fehlen." };
  const spec = manageSpecOf(i.spec);
  const fee = fin(feePct) && feePct > 0 ? feePct : 0;
  const slip = fin(slippagePct) && slippagePct > 0 ? slippagePct : 0;
  const risk = Math.abs(entry - stop);
  const target = i.target != null && fin(i.target) && (long ? i.target > entry : i.target < entry) ? i.target : null;
  const unit = i.unit?.trim() || "Einheiten";
  const P = (x: number): string => priceText(x, tick);
  const Q = (x: number): string => qtyText(x, lot);
  const M = (x: number): string => `${x > 0 ? "+" : x < 0 ? "−" : ""}${moneyText(Math.abs(x))} ${i.currency}`;
  const rAt = (r: number): number => entry + dir * r * risk;
  /** a price the trader waits for: rounded to the tick, away from the entry */
  const far = (x: number): number => toStep(x, tick, "nearest-away", dir);
  /** a stop level behind the price: rounded away from it (long: down, short: up) – never tighter than computed */
  const stopSide = (x: number): number => toStep(x, tick, long ? "floor" : "ceil");
  /** a break-even level: rounded the safe way (long: up, short: down) – a result of zero stays at least zero */
  const beSide = (x: number): number => toStep(x, tick, long ? "ceil" : "floor");
  const entryFee = fee * entry * qty;
  /** is `a` further in the profit direction than `b`? */
  const beats = (a: number, b: number): boolean => dir * (a - b) > 1e-12;
  /** can the price get there before the target takes the trade out? */
  const beforeTarget = (px: number): boolean => target == null || beats(target, px);

  const notes: ManageNote[] = [];
  const steps: ManageStep[] = [];
  const lines: ManageLine[] = [];
  /** the stop moves that happen at a price: [trigger, new level] – used to find the stop in force further out */
  const moves: [number, number][] = [];
  const stopAt = (px: number): number => {
    let s = stop;
    for (const [trig, lvl] of [...moves].sort((a, b) => dir * (a[0] - b[0]))) if (!beats(trig, px) && beats(lvl, s)) s = lvl;
    return s;
  };
  const triggers: number[] = [];

  // ── break-even
  const be = spec.breakEven;
  let beTrigger: number | null = null;
  let beLevel: number | null = null;
  let beOn = false;
  if (be.on) {
    const raw = be.trigger === "r" ? rAt(be.value) : entry * (1 + (dir * be.value) / 100);
    beTrigger = far(raw);
    const lvl = beSide(be.to === "net" ? netBreakEvenPrice({ side, entry, qtyOpen: qty, entryFee, booked: 0, feePct: fee, slippagePct: slip }) : entry);
    beLevel = lvl;
    const never = !beforeTarget(beTrigger);
    beOn = !never;
    const how = be.trigger === "r" ? `+${numTrim(be.value, 2)} R` : `+${numTrim(be.value, 2)} %`;
    const stopText =
      be.to === "net"
        ? `${P(lvl)} (Netto-Break-even: deckt Gebühren und Slippage, ${numTrim((Math.abs(lvl - entry) / entry) * 100, 3)} % vom Einstieg)`
        : `${P(lvl)} (Einstiegspreis – die Gebühren bleiben dann als kleiner Verlust)`;
    steps.push({
      id: "breakEven",
      title: "Break-even",
      when: `Wenn der Kurs ${P(beTrigger)} erreicht hat (${how}), entschieden am Kerzenschluss`,
      then: `Stop von ${P(stop)} auf ${stopText}, wirksam ab der nächsten Kerze`,
      trigger: beTrigger,
      stopAfter: never ? null : lvl,
      never,
    });
    lines.push({ label: "Break-even", text: `ab ${P(beTrigger)} (${how}) Stop auf ${P(lvl)}${be.to === "net" ? " (Netto-Break-even)" : " (Einstieg)"}` });
    if (never) notes.push({ key: "be-never", level: "warn", text: `Der Auslöser ${P(beTrigger)} liegt nicht vor dem Ziel ${P(target!)}: der Kurs trifft das Ziel, bevor Break-even greift – die Regel kommt nie zum Einsatz.` });
    else {
      moves.push([beTrigger, lvl]);
      triggers.push(beTrigger);
    }
  }

  // ── partial take-profit
  const pa = spec.partial;
  let partial: ManagePlan["partial"] = null;
  let stopAfterPartial: number | null = null;
  if (pa.on) {
    const price = far(rAt(pa.atR));
    const q1 = toStep(qty * (pa.fracPct / 100), lot, "floor");
    const rest = toStep(qty - q1, lot, "floor");
    const head = `Wenn der Kurs ${P(price)} erreicht hat (+${numTrim(pa.atR, 2)} R)`;
    if (!beforeTarget(price)) {
      notes.push({ key: "partial-late", level: "warn", text: `Das Teilziel ${P(price)} liegt nicht vor dem Ziel ${P(target!)}: es könnte nie vor dem Ziel greifen. Das Labor verwirft es dann ebenfalls – lege es näher an den Einstieg.` });
      steps.push({ id: "partial", title: "Teilziel", when: head, then: "Wird nicht ausgeführt (liegt nicht vor dem Ziel)", trigger: price, stopAfter: null, never: true });
    } else if (!(q1 >= lot - 1e-12) || !(rest >= lot - 1e-12)) {
      notes.push({ key: "partial-qty", level: "warn", text: `${pa.fracPct} % von ${Q(qty)} ${unit} sind ${Q(qty * (pa.fracPct / 100))}: bei einem Mengenschritt von ${Q(lot)} bleibt keine sinnvolle Teilmenge (oder kein Rest). Das Teilziel entfällt.` });
      steps.push({ id: "partial", title: "Teilziel", when: head, then: "Entfällt: die Menge ist zu klein, um sie zu teilen", trigger: price, stopAfter: null, never: true });
    } else {
      partial = { qty: q1, rest, price };
      triggers.push(price);
      const booked = dir * (price - entry) * q1 - fee * price * q1;
      const stopNow = stopAt(price);
      if (pa.thenBreakEven) {
        const lvl = beSide(be.on && be.to === "net" ? netBreakEvenPrice({ side, entry, qtyOpen: rest, entryFee, booked, feePct: fee, slippagePct: slip }) : entry);
        stopAfterPartial = beats(lvl, stopNow) ? lvl : stopNow;
        moves.push([price, stopAfterPartial]);
      } else stopAfterPartial = stopNow;
      steps.push({
        id: "partial",
        title: "Teilziel",
        when: head,
        then: `${Q(q1)} ${unit} (${pa.fracPct} %) mit Limit-Order verkaufen = ${M(booked)} nach Gebühren; ${Q(rest)} ${unit} laufen weiter${
          pa.thenBreakEven ? `, Stop auf ${P(stopAfterPartial)}${be.on && be.to === "net" ? " (Netto-Break-even mit dem Teilgewinn)" : " (Einstieg)"}` : `, Stop bleibt bei ${P(stopAfterPartial)}`
        }`,
        trigger: price,
        stopAfter: pa.thenBreakEven ? stopAfterPartial : null,
        never: false,
      });
      lines.push({ label: "Teilziel", text: `${pa.fracPct} % (${Q(q1)} ${unit}) bei ${P(price)} (+${numTrim(pa.atR, 2)} R)${pa.thenBreakEven ? `, danach Stop auf ${P(stopAfterPartial)}` : ""}` });
    }
  }

  // ── trailing stop
  const tr = spec.trail;
  let trailFrom = 0;
  let trailFirst: number | null = null;
  let trailEffective = false;
  if (tr.on) {
    trailFrom = tr.activateR > 0 ? far(rAt(tr.activateR)) : entry;
    const dist = tr.kind === "atr" ? (i.atr != null && i.atr > 0 ? tr.value * i.atr : null) : trailFrom * (tr.value / 100);
    const kindText = tr.kind === "atr" ? `${numTrim(tr.value, 2)} × ATR` : `${numTrim(tr.value, 2)} %`;
    const head = `Ab Kurs ${P(trailFrom)}${tr.activateR > 0 ? ` (+${numTrim(tr.activateR, 2)} R)` : " (ab der ersten Kerze)"}`;
    if (dist == null) {
      notes.push({ key: "trail-atr", level: "warn", text: "Für den ATR-Abstand fehlt die ATR (zu wenige geschlossene Kerzen). Wähle Prozent oder warte auf mehr Kerzen." });
      steps.push({ id: "trail", title: "Trailing-Stop", when: head, then: `Stop folgt ${kindText} hinter dem besten Kurs – ohne ATR nicht berechenbar`, trigger: trailFrom, stopAfter: null, never: false });
    } else {
      const first = stopSide(trailFrom - dir * dist);
      const stopNow = stopAt(trailFrom);
      trailEffective = beats(first, stopNow);
      trailFirst = first;
      const never = !beforeTarget(trailFrom);
      steps.push({
        id: "trail",
        title: "Trailing-Stop",
        when: head,
        then: `Stop folgt ${kindText}${tr.kind === "atr" ? ` (${P(dist)})` : ""} hinter dem besten Kurs, nur in Gewinnrichtung; erster Stop ${
          trailEffective ? P(first) : `${P(first)} – hinter dem Stop, der schon gilt (${P(stopNow)}), ändert noch nichts`
        }`,
        trigger: trailFrom,
        stopAfter: trailEffective ? first : null,
        never,
      });
      lines.push({ label: "Trailing", text: `${kindText} hinter dem besten Kurs ab ${P(trailFrom)}${tr.activateR > 0 ? ` (+${numTrim(tr.activateR, 2)} R)` : ""}` });
      if (never) notes.push({ key: "trail-never", level: "warn", text: `Der Trailing-Start ${P(trailFrom)} liegt nicht vor dem Ziel ${P(target!)}: das Ziel kommt zuerst.` });
      else {
        triggers.push(trailFrom);
        if (!trailEffective) {
          // the best price from which the trailing stop sits beyond the stop in force
          const useful = tr.kind === "atr" ? stopNow + dir * dist : stopNow / (1 - dir * (tr.value / 100));
          notes.push({ key: "trail-late", level: "info", text: `Beim Start liegt der Trailing-Stop (${P(first)}) hinter dem Stop, der schon gilt (${P(stopNow)}). Er ändert etwas, sobald der beste Kurs ${long ? "über" : "unter"} ${P(far(useful))} liegt.` });
        }
      }
      if (tr.kind === "atr" && dist > risk * 1.0001) notes.push({ key: "trail-wide", level: "info", text: `Der Abstand ${P(dist)} ist größer als dein Anfangsrisiko ${P(risk)}: das Nachziehen sichert erst Gewinn, wenn der Kurs weit gelaufen ist.` });
    }
  }

  // ── what the money does along some paths (examples, not forecasts)
  const settle = (fills: { px: number; q: number; kind: "limit" | "stop" }[]): { pnl: number; r: number } => {
    let gross = 0;
    let costs = entryFee;
    for (const f of fills) {
      gross += dir * (f.px - entry) * f.q;
      costs += fee * f.px * f.q + (f.kind === "stop" ? slip * f.px * f.q : 0);
    }
    const pnl = gross - costs;
    return { pnl, r: pnl / (qty * risk) };
  };
  const scenarios: ManageScenario[] = [];
  const add = (id: ManageScenario["id"], label: string, detail: string, fills: Parameters<typeof settle>[0]): void => {
    const s = settle(fills);
    scenarios.push({ id, label, detail, pnl: s.pnl, r: s.r });
  };
  const active = manageActive(spec);
  if (active) {
    add("stop", "Der erste Stop wird ausgelöst", `Alles bei ${P(stop)} (ohne Verwaltung)`, [{ px: stop, q: qty, kind: "stop" }]);
    if (target != null) add("target", "Das Ziel wird erreicht", `Alles bei ${P(target)} (ohne Verwaltung)`, [{ px: target, q: qty, kind: "limit" }]);
    if (beOn && beLevel != null && beTrigger != null) add("breakEven", "Break-even greift, der Kurs läuft zurück", `Alles bei ${P(beLevel)} nach dem Auslöser ${P(beTrigger)}`, [{ px: beLevel, q: qty, kind: "stop" }]);
    if (partial && stopAfterPartial != null) {
      add("partialStop", "Teilziel erreicht, der Rest läuft zurück", `${Q(partial.qty)} bei ${P(partial.price)}, ${Q(partial.rest)} bei ${P(stopAfterPartial)}`, [
        { px: partial.price, q: partial.qty, kind: "limit" },
        { px: stopAfterPartial, q: partial.rest, kind: "stop" },
      ]);
      if (target != null) {
        add("partialTarget", "Teilziel und Ziel werden erreicht", `${Q(partial.qty)} bei ${P(partial.price)}, ${Q(partial.rest)} bei ${P(target)}`, [
          { px: partial.price, q: partial.qty, kind: "limit" },
          { px: target, q: partial.rest, kind: "limit" },
        ]);
      }
    }
    if (trailEffective && trailFirst != null && beforeTarget(trailFrom)) {
      add("trail", "Der Kurs erreicht den Trailing-Start und dreht um", `Alles bei ${P(trailFirst)} (Start ${P(trailFrom)})`, [{ px: trailFirst, q: qty, kind: "stop" }]);
    }
  }

  const assumptions = [
    `Gebühr ${pctText(fee, 3)} je Seite und Slippage ${pctText(slip, 3)} an Stop-Füllungen (aus den Risiko-Einstellungen); kein Maker-Rabatt, kein Funding.`,
    `R ist hier das Ergebnis geteilt durch ${Q(qty)} ${unit} × ${P(risk)} (Menge × Abstand zum ersten Stop) – wie im Backtest.`,
  ];
  notes.push(
    { key: "rule", level: "info", text: "Ein Auslöser wird am Schluss einer Kerze entschieden und gilt ab der nächsten. Der Stop wird nur nachgezogen, nie gelockert." },
    { key: "same-candle", level: "info", text: "Berührt dieselbe Kerze den Auslöser und den Stop, gilt der Stop zuerst (vorsichtige Annahme – die Reihenfolge innerhalb einer Kerze kennt die App nicht)." },
    { key: "gap", level: "info", text: "Eine Kurslücke oder ein schneller Markt kann einen Stop schlechter füllen als geplant." },
    { key: "manual", level: "info", text: "Die App ändert keine echte Order und sendet nichts: neue Stops und Teilverkäufe setzt du selbst, wenn du sie willst." },
  );
  const firstTrigger = triggers.length ? triggers.reduce((a, b) => (beats(a, b) ? b : a)) : null;
  return { ok: true, active, steps, scenarios, notes, lines, assumptions, partial, firstTrigger, currency: i.currency };
}

/** A short German sentence for a spec ("Break-even ab +1 R auf den Einstieg · Teilziel 50 % bei +1,5 R · Trailing 2 × ATR ab +1 R"), `null` when nothing is on. */
export function manageSummary(m: ManageSpec): string | null {
  const parts: string[] = [];
  if (m.breakEven.on) parts.push(`Break-even ab +${numTrim(m.breakEven.value, 2)} ${m.breakEven.trigger === "r" ? "R" : "%"} auf ${m.breakEven.to === "net" ? "Netto-Break-even" : "den Einstieg"}`);
  if (m.partial.on) parts.push(`Teilziel ${m.partial.fracPct} % bei +${numTrim(m.partial.atR, 2)} R${m.partial.thenBreakEven ? ", danach Break-even" : ""}`);
  if (m.trail.on) parts.push(`Trailing ${numTrim(m.trail.value, 2)} ${m.trail.kind === "atr" ? "× ATR" : "%"}${m.trail.activateR > 0 ? ` ab +${numTrim(m.trail.activateR, 2)} R` : ""}`);
  return parts.length ? parts.join(" · ") : null;
}
