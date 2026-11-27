/**
 * The rules in words – one sentence per setup, built from the thresholds that are set right now. The page shows them next
 * to the inputs, so what the scanner does is always readable and the numbers in the sentence ARE the numbers it uses.
 */
import { pctText, numText } from "./text";
import type { MarketKind, ScanParams, SetupId } from "./types";

export function describeRule(setup: SetupId, p: ScanParams, kind: MarketKind, interval: string): string {
  if (setup === "orb") {
    const o = p.orb;
    const open = kind === "stock" ? "der Handelssitzung (New York, 9:30)" : "des UTC-Tages (00:00 UTC)";
    const sides = o.sides === "long" ? "Long: über dem Spannenhoch" : o.sides === "short" ? "Short: unter dem Spannentief" : "Long über dem Spannenhoch, Short unter dem Spannentief";
    const dist = o.minBreak > 0 ? ` (mindestens ${pctText(o.minBreak, 2, false)} Abstand)` : "";
    const until = o.latestMinutes == null ? "bis zum Ende der Sitzung" : `höchstens ${o.latestMinutes} Minuten nach der Eröffnung`;
    const still = o.stillBeyond ? ", und die letzte vollständige Kerze liegt noch jenseits der Spanne" : "";
    const vol = o.minRelVolume > 0 ? `, mit mindestens dem ${numText(o.minRelVolume, 1)}-fachen Volumen der Spannen-Kerzen` : "";
    return `Die ersten ${o.orMinutes} Minuten ${open} bilden die Spanne (höchstes Hoch, tiefstes Tief, ${interval}-Kerzen). Treffer: ${sides} – die erste vollständige Kerze, die dort schließt${dist}, ${until}${still}${vol}.`;
  }
  if (setup === "flag") {
    const f = p.flag;
    return `Flagge: Der Schlusskurs ist in den ${f.poleBars} Kerzen vor der Fahne um mehr als ${pctText(f.poleMinGain, 1, false)} gestiegen, und die letzten ${f.flagBars} Schlusskurse liegen in einer Spanne (höchster minus tiefster, geteilt durch den letzten) unter ${pctText(f.flagMaxRange, 1, false)}. Nur vollständige ${interval}-Kerzen.`;
  }
  const r = p.rsi;
  return r.requireBounce
    ? `RSI-Erholung: Der RSI(${r.length}, Wilder) lag auf der Kerze davor unter ${numText(r.level, 0)}, und die letzte vollständige ${interval}-Kerze schloss höher als die davor.`
    : `Überverkauft: Der RSI(${r.length}, Wilder) liegt auf der letzten vollständigen ${interval}-Kerze unter ${numText(r.level, 0)}.`;
}

export function describePrefilter(p: ScanParams, kind: MarketKind, intraday: boolean): string {
  const bits: string[] = [];
  if (p.pre.minPrice > 0) bits.push(`Schlusskurs mindestens ${numText(p.pre.minPrice, 2)}`);
  if (p.pre.minVolume > 0) bits.push(intraday ? `Volumen der Sitzung bisher mindestens ${new Intl.NumberFormat("de-DE").format(p.pre.minVolume)}` : `Volumen der letzten Tageskerze mindestens ${new Intl.NumberFormat("de-DE").format(p.pre.minVolume)}`);
  if (kind === "stock" && p.pre.normalStatusOnly) bits.push("Nasdaq-Finanzstatus normal");
  if (!intraday) bits.push(`mindestens ${p.pre.minBars} Kerzen, die letzte nicht älter als ${p.pre.maxAgeDays} Tage`);
  return bits.length ? `Vorfilter: ${bits.join(" · ")}.` : "Vorfilter: aus.";
}
