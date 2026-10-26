/**
 * What changed between two saved states of a thesis, in plain sentences. "Jede Zielpreisänderung lässt sich auf Annahmen
 * zurückführen": the DCF value of each scenario is computed for both states and every changed assumption is listed next to it.
 * Pure; the sentences only describe, they never judge.
 */
import { levelText, money } from "@/domain/analyst/fmt";
import { n1, n2 } from "@/lib/format";
import { criterionText } from "./criteria";
import { computeScenario } from "./scenarios";
import { SCENARIO_KEYS, SCENARIO_NAMES, type Criterion, type Scenario, type ThesisSnapshot } from "./types";

const SCENARIO_FIELDS: readonly { key: keyof Omit<Scenario, "note">; label: string }[] = [
  { key: "growthStart", label: "Wachstum Jahr 1" },
  { key: "growthEnd", label: "Wachstum letztes Jahr" },
  { key: "marginEnd", label: "EBIT-Marge letztes Jahr" },
  { key: "reinvest", label: "Reinvestition" },
  { key: "wacc", label: "WACC" },
  { key: "terminalGrowth", label: "Endwachstum" },
];

const pct = (v: number | null): string => (v == null ? "leer" : levelText(v));

function listDiff(label: string, a: readonly string[], b: readonly string[]): string[] {
  const added = b.filter((x) => !a.includes(x));
  const removed = a.filter((x) => !b.includes(x));
  return [...added.map((x) => `${label} neu: ${x}`), ...removed.map((x) => `${label} entfernt: ${x}`)];
}

export function diffSnapshots(prev: ThesisSnapshot, cur: ThesisSnapshot): string[] {
  const out: string[] = [];
  if (prev.text.trim() !== cur.text.trim()) out.push("Begründung geändert.");
  if (prev.horizonYears !== cur.horizonYears) out.push(`Anlagehorizont ${prev.horizonYears} → ${cur.horizonYears} Jahre.`);
  const baseMoney = (v: number | null): string => (v == null ? "leer" : money(v, cur.base.currency));
  const b0 = prev.base;
  const b1 = cur.base;
  if (b0.revenue !== b1.revenue) out.push(`Ausgangszahlen, Umsatz: ${baseMoney(b0.revenue)} → ${baseMoney(b1.revenue)}.`);
  if (b0.ebitMargin !== b1.ebitMargin) out.push(`Ausgangszahlen, EBIT-Marge: ${pct(b0.ebitMargin)} → ${pct(b1.ebitMargin)}.`);
  if (b0.taxRate !== b1.taxRate) out.push(`Ausgangszahlen, Steuersatz: ${pct(b0.taxRate)} → ${pct(b1.taxRate)}.`);
  if (b0.netDebt !== b1.netDebt) out.push(`Ausgangszahlen, Nettoverschuldung: ${baseMoney(b0.netDebt)} → ${baseMoney(b1.netDebt)}.`);
  if (b0.shares !== b1.shares) out.push(`Ausgangszahlen, Aktien: ${b0.shares == null ? "leer" : n1(b0.shares / 1e6)} → ${b1.shares == null ? "leer" : n1(b1.shares / 1e6)} Mio.`);
  for (const k of SCENARIO_KEYS) {
    const a = prev.scenarios[k];
    const c = cur.scenarios[k];
    for (const f of SCENARIO_FIELDS) if (a[f.key] !== c[f.key]) out.push(`${SCENARIO_NAMES[k]}: ${f.label} ${pct(a[f.key])} → ${pct(c[f.key])}.`);
    if (a.note.trim() !== c.note.trim()) out.push(`${SCENARIO_NAMES[k]}: Notiz geändert.`);
    const v0 = computeScenario(prev, k).perShare;
    const v1 = computeScenario(cur, k).perShare;
    if (v0 !== v1) out.push(`${SCENARIO_NAMES[k]}: Wert je Aktie ${v0 == null ? "nicht berechenbar" : n2(v0)} → ${v1 == null ? "nicht berechenbar" : n2(v1)} ${cur.base.currency}.`);
  }
  const ct = (c: Criterion): string => criterionText(c);
  out.push(...listDiff("Bedingung", prev.criteria.map(ct), cur.criteria.map(ct)));
  out.push(...listDiff("Katalysator", prev.catalysts, cur.catalysts));
  out.push(...listDiff("Risiko", prev.risks, cur.risks));
  out.push(...listDiff("Gegenargument", prev.counter, cur.counter));
  const p0 = prev.price;
  const p1 = cur.price;
  if (p0?.value !== p1?.value || p0?.source !== p1?.source) out.push(`Eingegebener Kurs: ${p0 ? `${n2(p0.value)} (${p0.source || "ohne Quelle"})` : "keiner"} → ${p1 ? `${n2(p1.value)} (${p1.source || "ohne Quelle"})` : "keiner"}.`);
  const z0 = prev.buyZone;
  const z1 = cur.buyZone;
  if (z0?.low !== z1?.low || z0?.high !== z1?.high) out.push(`Kaufzone: ${z0 ? `${z0.low ?? "?"} – ${z0.high ?? "?"}` : "keine"} → ${z1 ? `${z1.low ?? "?"} – ${z1.high ?? "?"}` : "keine"}.`);
  return out;
}
