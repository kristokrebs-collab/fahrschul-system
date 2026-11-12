/**
 * Voraussetzungen je Signal (F25): the conditions that had to hold, as a list, taken from what the raising code really had at
 * that moment – the stored snapshot of the Einstiegs-Check (rungs, RSI, zone, candle close, the graded parts, the falling-knife
 * filter, the Lage gate), the graded reasons of a Box setup, the rule of a key level. Pure. `met: null` = keine Daten (never
 * counted as fulfilled, never as failed). Nothing is added that the source did not say.
 */
import type { KeyLevel, LevelEvaluation } from "../keylevels/types";
import { knifeItemLabel } from "../signals/knife";
import type { SignalSnapshot } from "../signals/snapshot";
import { PREREQ_MAX, type SignalPrereq } from "./archive";

const PART_LABEL = (id: string, long: boolean): string =>
  id === "traders" ? "Top-Trader-Kombi erfüllt" : id === "div" ? "RSI-Divergenz oder Trendlinienbruch" : long ? "Unterstützung in Reichweite, Platz bis zum Ziel" : "Widerstand in Reichweite, Platz bis zum Ziel";

/** The conditions of an Einstiegs-Check signal from its snapshot. */
export function entryPrereq(s: SignalSnapshot): SignalPrereq[] {
  const long = s.side === "long";
  const out: SignalPrereq[] = [];
  const ladder = s.ladder ?? s.tfs.map((t) => t.tf);
  for (const tf of ladder) {
    const row = s.tfs.find((t) => t.tf === tf);
    out.push({ id: `tf:${tf}`, label: `${tf}: ${long ? "Long" : "Short"}-Signal (WaveTrend) bestätigt die Treppe`, met: row ? (row.ok ?? row.kind !== null) : null });
  }
  if (s.required != null) out.push({ id: "tiers", label: `Mindestens ${s.required} Zeiteinheiten in Folge (${s.tiers} von ${ladder.length})`, met: s.tiers >= s.required });
  out.push({ id: "rsi", label: long ? "RSI nahe am überverkauften Bereich" : "RSI nahe am überkauften Bereich", met: s.rsiOk });
  out.push({ id: "zone", label: `${long ? "Preis im Discount" : "Preis im Premium"}${s.zoneTf ? ` (${s.zoneTf})` : ""}`, met: s.zoneOk });
  if (s.state) out.push({ id: "closed", label: "Signalkerze geschlossen (nicht nur im Lauf)", met: s.state === "confirmed" || s.state === "strong" ? true : s.state === "provisional" ? false : null });
  for (const p of s.parts ?? []) out.push({ id: `part:${p.id}`, label: PART_LABEL(p.id, long), met: p.data ? p.ok : null });
  // the older single condition, when the grading did not carry it as a part
  if (s.whale !== undefined && !(s.parts ?? []).some((p) => p.id === "traders")) out.push({ id: "whale", label: long ? "Top-Trader kaufen · Retail rot" : "Top-Trader verkaufen · Retail grün", met: s.whale ? s.whale.ok : null });
  for (const k of s.knife?.items ?? []) out.push({ id: `knife:${k.id}`, label: `Filter gegen fallendes Messer: ${knifeItemLabel(k.id, s.side)}`, met: k.met });
  if (s.lage && s.lage.on !== false && s.lage.counts !== undefined) out.push({ id: "lage", label: "Lage-Ampel lässt den Einstieg zu", met: s.lage.counts });
  return out.slice(0, PREREQ_MAX);
}

/** The graded reasons of a Box setup. */
export function boxPrereq(reasons: ReadonlyArray<{ text: string; ok: boolean }>): SignalPrereq[] {
  return reasons.slice(0, PREREQ_MAX).map((r, i) => ({ id: `r${i}`, label: r.text, met: r.ok }));
}

const de = (v: number): string => v.toLocaleString("de-DE", { maximumFractionDigits: 4 });

/** The conditions of a key-level stage (`confirm` / `retest`) as they stood when it fired. */
export function keyPrereq(level: Pick<KeyLevel, "kind" | "direction" | "closes" | "distance" | "tf" | "invalidation">, stage: "confirm" | "retest", ev: Pick<LevelEvaluation, "basis" | "retest" | "broke">): SignalPrereq[] {
  const up = level.direction === "above";
  const beyond = up ? "über" : "unter";
  const dist = level.distance.mode === "atr" ? `${de(level.distance.value)} × ATR` : `${de(level.distance.value)} %`;
  const out: SignalPrereq[] = [];
  switch (level.kind) {
    case "touch":
      out.push({ id: "rule", label: "Der Preis berührt die Marke", met: true });
      break;
    case "running":
      out.push({ id: "rule", label: `Laufender Bruch ${beyond} der Marke (die Kerze ist noch offen)`, met: true });
      break;
    case "close":
      out.push({ id: "rule", label: `Eine ${level.tf}-Kerze schließt ${beyond} der Marke`, met: true });
      break;
    case "closes":
      out.push({ id: "rule", label: `${level.closes} ${level.tf}-Schlüsse in Folge ${beyond} der Marke`, met: true });
      break;
    case "buffer":
      out.push({ id: "rule", label: `Schluss mindestens ${dist} ${beyond} der Marke`, met: true });
      break;
    case "retest":
      out.push({ id: "break", label: `Bruch per Schluss ${beyond} der Marke`, met: ev.broke });
      out.push({ id: "retest", label: `Retest der Marke bis auf ${dist}, danach hält sie`, met: stage === "retest" ? ev.retest === "done" : false });
      break;
  }
  out.push({ id: "basis", label: "Auf dem Kerzenschluss bestätigt (nicht nur im Lauf)", met: ev.basis === "close" ? true : ev.basis === "intrabar" ? false : null });
  if (level.invalidation != null) out.push({ id: "invalid", label: `Ungültigkeitsmarke ${de(level.invalidation)} nicht verletzt`, met: true });
  return out;
}
