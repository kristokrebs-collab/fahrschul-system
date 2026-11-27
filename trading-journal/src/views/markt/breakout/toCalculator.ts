/**
 * „In den Rechner übernehmen“: belegt im Positionsgrößen-Rechner der Risiko-Seite Paar, Richtung, Einstieg (letzter geschlossener
 * Kurs) und Stop (andere Seite der Spanne; liegt die schon auf der falschen Seite: 1,5 ATR) vor und öffnet die Stelle. Nur eine
 * Vorbelegung im Speicher des Tabs – nichts wird gehandelt, gespeichert oder ins Journal geschrieben; das Ziel bleibt leer.
 */
import { calcPrefill, type BreakoutRead } from "@/domain/breakout";
import { toInput, useRiskUi } from "@/views/risiko/riskStore";
import { BREAKOUT } from "./strings";

/** `false` when there is nothing to hand over (no breakout). */
export function toCalculator(read: BreakoutRead): boolean {
  const p = calcPrefill(read);
  if (!p) return false;
  const entry = toInput(p.entry);
  const stop = toInput(p.stop);
  const ui = useRiskUi.getState();
  ui.setCalc({ pair: p.pair, side: p.side, entry, stop, target: "" }, true);
  ui.setPrefillNote(`${BREAKOUT.prefillSource} ${p.pair} · ${p.side === "long" ? "Long" : "Short"} · Einstieg ${entry} (letzter Schluss) · Stop ${stop} (${BREAKOUT.stopFrom[p.stopFrom]}). Prüfe beide Werte.`);
  void import("@/app/featureOpen").then((m) => m.openFeature("positionsrechner"));
  return true;
}
