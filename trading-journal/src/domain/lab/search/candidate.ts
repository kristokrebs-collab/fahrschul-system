/**
 * Nach „bestanden“: die Regeln der Siegervariante auf die AKTUELLEN Kerzen – Signal, Einstieg, Stop, Ziel – und die Positionsgröße aus den
 * EIGENEN Risikoeinstellungen des Nutzers (`positionSize` des Risikorechners). Rein; sendet nichts, bestellt nichts.
 *
 * Wichtig für die Ehrlichkeit: die Engine des Labors entscheidet am Schluss einer geschlossenen Kerze und füllt zur Eröffnung der nächsten.
 * Ein „Signal“ gibt es deshalb nur auf der letzten geschlossenen Kerze und nur als neue Flanke (die Bedingung wird erst auf dieser Kerze
 * wahr). Gilt sie schon länger, ist der Einstieg dieses Musters vorbei – dann heißt es „kein Signal“, nicht „noch einsteigen“.
 */
import { atrSeries } from "@/domain/backtest/bars";
import { evalConds, ruleBuilder, type RuleFacts } from "@/domain/backtest/strategies/rules";
import type { LabStrategy } from "@/domain/backtest/strategies/types";
import { HIST_MS, type Bar, type BtSide } from "@/domain/backtest/types";
import { positionSize, type Sizing } from "@/domain/risk/sizing";
import { condsOf, variantText } from "./space";
import { orbDetect, orbNote, orbPrepare, ORB_BAR_MS, ORB_SESSIONS } from "./orb";
import type { AnyVariant, OrbVariant, SearchInterval, SearchVariant, StopRule } from "./types";

export type CandidateState = "long" | "short" | "none" | "stale" | "nodata";

export interface CandidateSignal {
  side: BtSide;
  /** Bezugspreis = Schluss der letzten geschlossenen Kerze; gefüllt wird zur Eröffnung der nächsten (Abweichung möglich) */
  entry: number;
  stop: number;
  target: number | null;
  /** Zeit-Stopp in Kerzen nach der Füllung */
  maxBars: number | null;
  /** Abstand zum Stop in % des Einstiegs */
  stopPct: number;
  targetR: number;
  stopAtr: number;
}

export interface CandidateReason {
  label: string;
  value: string;
  /** erfüllt / nicht erfüllt / nur zur Information */
  ok: boolean | null;
}

export interface Candidate {
  state: CandidateState;
  /** ms: Ende der letzten geschlossenen Kerze, auf der gerechnet wurde (0 ohne Kerzen) */
  asOf: number;
  lastClose: number | null;
  signal: CandidateSignal | null;
  /** seit wie vielen Kerzen die Einstiegs-Bedingung schon gilt, ohne dass es auf der letzten ein neues Signal gab; `null` = gilt nicht */
  holdsFor: number | null;
  /** ein Satz zur Lage, ehrlich auch bei „kein Signal“ */
  text: string;
  rules: string;
  family?: "trend" | "orb";
  /** Eröffnungs-Range: die Gründe einzeln (nur wenn ein Signal vorliegt) */
  reasons?: CandidateReason[];
}

const SIDE_DE: Readonly<Record<BtSide, string>> = { long: "Long", short: "Short" };

/** Wie alt die letzte geschlossene Kerze höchstens sein darf (in Kerzenlängen), damit „jetzt“ noch stimmt. */
const MAX_AGE_BARS = 2;

/**
 * Das Signal der Variante auf der letzten geschlossenen Kerze von `bars`. `nowMs` null = Demo-/Fixture-Daten: dann wird das Alter der
 * Kerzen nicht gegen die Uhr gehalten (der Aufrufer beschriftet sie als Demo).
 */
function trendCandidate(bars: readonly Bar[], interval: SearchInterval, v: SearchVariant, nowMs: number | null, rule?: StopRule): Candidate {
  const rules = variantText(v, rule);
  const n = bars.length;
  if (n < 2) return { state: "nodata", asOf: 0, lastClose: null, signal: null, holdsFor: null, text: "Keine Kerzen – es gibt nichts zu prüfen.", rules };
  const secLen = HIST_MS[interval] / 1000;
  const last = bars[n - 1]!;
  const asOf = (last.t + secLen) * 1000;
  if (nowMs != null && nowMs - asOf > MAX_AGE_BARS * HIST_MS[interval]) {
    return { state: "stale", asOf, lastClose: last.c, signal: null, holdsFor: null, text: "Die neueste Kerze ist nicht mehr aktuell – ohne frische Kerzen gibt es keine Aussage. Lade die Kerzen neu.", rules };
  }
  const hit = evalConds(bars, condsOf(v));
  const atr = atrSeries(bars);
  const strat = ruleBuilder as unknown as LabStrategy<RuleFacts, unknown>;
  const prep = { interval, bars, atr, start: 0, facts: { hit, side: v.side } as RuleFacts };
  const s = strat.build(prep, { targetR: v.targetR, stopAtr: v.stopAtr, maxBars: v.maxBars }).signalAt(n - 1);
  if (s) {
    const dir = s.side === "long" ? 1 : -1;
    return {
      state: s.side,
      asOf,
      lastClose: last.c,
      signal: { side: s.side, entry: last.c, stop: s.stop, target: s.target, maxBars: s.maxBars, stopPct: (Math.abs(last.c - s.stop) / last.c) * 100, targetR: v.targetR, stopAtr: v.stopAtr },
      holdsFor: 0,
      text: `${SIDE_DE[s.side]}-Signal auf der letzten geschlossenen Kerze. Die Regeln steigen zur Eröffnung der nächsten Kerze ein; der Stop liegt ${v.stopAtr} × ATR ${dir === 1 ? "darunter" : "darüber"}.`,
      rules,
    };
  }
  let holds = 0;
  if (hit[n - 1]) {
    holds = 1;
    while (n - 1 - holds >= 0 && hit[n - 1 - holds]) holds++;
  }
  return {
    state: "none",
    asOf,
    lastClose: last.c,
    signal: null,
    holdsFor: holds > 0 ? holds : null,
    text:
      holds > 0
        ? `Heute kein Signal – warte. Die Bedingung gilt seit ${holds} Kerzen; der Einstieg dieses Musters war auf der Kerze, auf der sie neu wahr wurde. Die Regeln steigen nicht nachträglich ein.`
        : "Heute kein Signal – warte. Die Bedingung der Variante ist auf der letzten geschlossenen Kerze nicht erfüllt.",
    rules,
  };
}

const nf1 = (x: number): string => x.toFixed(1).replace(".", ",");
const hhmm = (ms: number): string => {
  const d = new Date(ms);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
};

/**
 * Eröffnungs-Range: ein Signal gibt es nur, wenn HEUTE (UTC-Tag der letzten geschlossenen Kerze) die Range steht, der erste Schluss außerhalb
 * ihr zuletzt gelungen ist (die letzte geschlossene Kerze) und die Filter der Variante (Volumen, Trend) erfüllt sind. Kam das Signal früher am Tag,
 * ist der Einstieg (Eröffnung der Folgekerze) vorbei – dann steht es da, aber ohne Einstieg, und es wird nicht nachgestiegen.
 */
function orbCandidate(bars: readonly Bar[], v: OrbVariant, nowMs: number | null, rule?: StopRule): Candidate {
  const rules = variantText(v, rule);
  const n = bars.length;
  const base = { family: "orb" as const, rules, signal: null, holdsFor: null };
  if (n < 2) return { ...base, state: "nodata", asOf: 0, lastClose: null, text: "Keine Kerzen – es gibt nichts zu prüfen." };
  const last = bars[n - 1]!;
  const asOf = last.t * 1000 + ORB_BAR_MS;
  if (nowMs != null && nowMs - asOf > 2 * ORB_BAR_MS) return { ...base, state: "stale", asOf, lastClose: last.c, text: "Die neueste Kerze ist nicht mehr aktuell – ohne frische Kerzen gibt es keine Aussage. Lade die Kerzen neu." };
  const prep = orbPrepare(bars);
  const day = Math.floor((last.t * 1000) / 86_400_000);
  const S = ORB_SESSIONS[v.session];
  const weekday = new Date(day * 86_400_000).getUTCDay();
  const d = weekday > 0 && weekday < 6 ? orbDetect(prep, day, v.session, v.rangeMin) : null;
  if (!d) {
    const openMs = day * 86_400_000 + S.open;
    const why = weekday === 0 || weekday === 6 ? "Am Wochenende gibt es keine Sitzung." : last.t * 1000 < openMs ? `Die Sitzung ${S.name} beginnt um ${hhmm(openMs)} UTC.` : `Die Range der ersten ${v.rangeMin} Minuten ist noch nicht abgeschlossen oder die Kerzen fehlen.`;
    return { ...base, state: "none", asOf, lastClose: last.c, text: `Heute kein Signal – warte. ${why}` };
  }
  if (!d.signal) {
    const over = d.iEnd < n - 1 || n - 1 > d.iRangeEnd + 36;
    return { ...base, state: "none", asOf, lastClose: last.c, text: `Heute kein Signal – warte. ${over ? "Das Fenster von 3 Stunden nach der Range ist vorbei." : "Noch kein Schluss außerhalb der Range."}` };
  }
  const { j, dir, time } = d.signal;
  const vf = d.volFactor ?? 0;
  const tr = d.trendOk === true;
  const note = orbNote(vf, tr, v.volThr);
  const reasons: CandidateReason[] = [
    { label: "Ausbruch", value: `${dir > 0 ? "über dem Hoch" : "unter dem Tief"} der Range, ${hhmm(time)} UTC`, ok: true },
    { label: "Volumen", value: `${nf1(vf)}× des Schnitts der 20 Kerzen davor (Schwelle ${nf1(v.volThr)}×)`, ok: vf >= v.volThr },
    { label: "Trend", value: tr ? "Kurs auf der passenden Seite der EMA 50: ja" : "Kurs auf der passenden Seite der EMA 50: nein", ok: tr },
    { label: "Note", value: note, ok: null },
  ];
  const passes = vf >= v.volThr && (!v.trend || tr);
  if (!passes) return { ...base, state: "none", asOf, lastClose: last.c, reasons, text: `Heute kein Signal für diese Variante – warte. Die Ausbruchskerze erfüllt ihre Filter nicht (Volumen ${nf1(vf)}×${v.trend && !tr ? ", Trend passt nicht" : ""}).` };
  if (j < n - 1) return { ...base, state: "none", asOf, lastClose: last.c, reasons, text: `Heute kein Einstieg mehr – warte. Das Signal kam um ${hhmm(time)} UTC; der Einstieg war zur Eröffnung der Folgekerze. Die Regeln steigen nicht nachträglich ein.` };
  const entry = last.c;
  const stop = v.stop === "range" ? (dir > 0 ? d.low : d.high) : v.stop === "mid" ? (d.high + d.low) / 2 : entry - dir * 1.5 * prep.atr[j]!;
  const risk = (entry - stop) * dir;
  if (!(risk > 0)) return { ...base, state: "none", asOf, lastClose: last.c, reasons, text: "Heute kein Signal – warte. Der Stop läge auf der falschen Seite des Schlusskurses." };
  const side: BtSide = dir > 0 ? "long" : "short";
  return {
    ...base,
    state: side,
    asOf,
    lastClose: last.c,
    reasons,
    signal: { side, entry, stop, target: entry + dir * v.targetR * risk, maxBars: null, stopPct: (risk / entry) * 100, targetR: v.targetR, stopAtr: 0 },
    text: `${SIDE_DE[side]}-Signal auf der letzten geschlossenen 5-Minuten-Kerze (Note ${note}). Einstieg zur Eröffnung der nächsten Kerze; Zeit-Stopp am Ende der Sitzung (${hhmm(day * 86_400_000 + S.end)} UTC).`,
  };
}

/** Das Signal der Variante auf den aktuellen Kerzen (Familie nach `v.family`; ORB braucht 5-Minuten-Kerzen); `rule` = die Stop-Führung des Siegers (nur für den Regeltext). */
export function candidateOf(bars: readonly Bar[], interval: SearchInterval | "5m", v: AnyVariant, nowMs: number | null, rule?: StopRule): Candidate {
  return v.family === "orb" ? orbCandidate(bars, v, nowMs, rule) : { ...trendCandidate(bars, interval as SearchInterval, v, nowMs, rule), family: "trend" };
}

/** Die eigenen Risikoeinstellungen des Nutzers; `null` = nicht festgelegt (dann gibt die Karte keine Größe aus). */
export interface OwnRisk {
  capital: number | null;
  /** Anteil des Kontos (0,01 = 1 %), nur wenn der Nutzer ihn selbst gespeichert hat */
  riskPct: number | null;
  feePct: number;
  slippagePct: number;
  maxLeverage: number | null;
}

export type CandidateSizing = { kind: "ok"; sizing: Sizing } | { kind: "needRisk" } | { kind: "needCapital" } | { kind: "error" };

/** Positionsgröße über den vorhandenen Risikorechner – nie mit einem Standardwert als Ersatz. */
export function sizeCandidate(sig: CandidateSignal, risk: OwnRisk): CandidateSizing {
  if (risk.riskPct == null) return { kind: "needRisk" };
  if (risk.capital == null || !(risk.capital > 0)) return { kind: "needCapital" };
  const r = positionSize({ capital: risk.capital, riskPct: risk.riskPct, entry: sig.entry, stop: sig.stop, side: sig.side, feePct: risk.feePct, slippagePct: risk.slippagePct, maxLeverage: risk.maxLeverage });
  return r.ok ? { kind: "ok", sizing: r } : { kind: "error" };
}
