/**
 * Verwaltung im Positionsrechner (F65): derselbe Verwaltungsplan wie im Handelsplan (`ManageCard`, `managePlan`), gerechnet aus den
 * Zahlen des Rechners – Richtung, Einstieg, Stop, Ziel und die Menge, die der Rechner aus dem Risiko ermittelt hat (auf den
 * Mengenschritt abgerundet). Die Wahl der Regeln liegt pro Gerät (`storageKey("calc-manage")`, eine Bequemlichkeit). Lazy: erst, wenn
 * der Rechner ein gültiges Ergebnis hat und die Karte auf der Seite steht.
 */
import { useMemo } from "react";
import { DEFAULT_LOT, inferStep, managePlan, toStep } from "@/domain/plan";
import type { RiskLimits } from "@/domain/risk";
import { ManageCard } from "@/views/plan/ManageCard";
import { useCalcManage } from "@/views/plan/manageStore";
import type { CalcModel } from "./CalculatorCard";

export default function CalcManage({ m, limits, cur, atr }: { m: CalcModel; limits: RiskLimits; cur: string; atr: number | null }) {
  const spec = useCalcManage((s) => s.spec);
  const setSpec = useCalcManage((s) => s.setSpec);
  const sizing = m.sizing;
  const result = useMemo(() => {
    if (!sizing.ok) return null;
    const target = Number.isFinite(m.target) && m.target > 0 ? m.target : null;
    const lot = DEFAULT_LOT.crypto;
    const qty = toStep(sizing.qty, lot, "floor");
    if (!(qty > 0)) return { ok: false as const, reason: `Die Menge des Rechners (${sizing.qty.toPrecision(3)}) ist kleiner als ein Mengenschritt von ${lot}.` };
    // the calculator does not know the exchange's steps: two decimals at least, finer only where the typed prices are finer
    const tick = Math.min(0.01, inferStep([m.entry, m.stop, ...(target != null ? [target] : [])], 0.01));
    return managePlan({ side: m.side, entry: m.entry, stop: m.stop, target, qty, lot, tick, feePct: limits.feePct, slippagePct: limits.slippagePct, atr, spec, currency: cur, unit: m.pair.split("/")[0] ?? "" });
  }, [sizing, m.side, m.entry, m.stop, m.target, m.pair, limits.feePct, limits.slippagePct, atr, spec, cur]);
  return (
    <ManageCard
      spec={spec}
      onChange={setSpec}
      result={result}
      waiting="Trag Einstieg und Stop ein – dann rechnet der Rechner die Menge, und hier erscheinen die Preise und Beispielrechnungen."
      testPrefix="risk"
      extraAssumptions={["Der Rechner kennt die Schritte deiner Börse nicht: Kursschritt höchstens 0,01 und Mengenschritt 0,001 (abgerundet) angenommen."]}
      className="mt-1"
    />
  );
}
