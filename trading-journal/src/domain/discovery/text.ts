/**
 * Words of the Muster-Entdecker (German): a pattern in plain language, the counts, the reasons. Pure functions of the numbers
 * the miner produced – nothing is written that the numbers do not say, and every sentence keeps its sample size.
 */
import { FEATURES } from "./features";
import type { CellStats, Cond, DiscoveryCounts, DiscoveryResult, Finding, Reason, Tier } from "./types";

export const TIER_LABEL: Readonly<Record<Tier, string>> = { confirmed: "bestätigt", hint: "Hinweis", rejected: "verworfen (Zufall)" };

/** Printed under every analysis and every finding. */
export const DISCLAIMER = "Beobachtung, keine Ursache; kein Versprechen für die Zukunft. Keine professionelle Finanzberatung.";

const dec = (v: number, d: number): string => v.toFixed(d).replace(".", ",").replace("-", "−");

/** A threshold of a feature as written in the text. */
export function valueText(c: Extract<Cond, { k: "num" }>, v: number): string {
  const d = FEATURES[c.f];
  const n = dec(v, d.digits);
  return d.unit === "" ? n : d.unit === "×" ? `${n}×` : d.unit === "%" ? `${n} %` : `${n} ${d.unit}`;
}

const STREAK_TEXT: Readonly<Record<string, string>> = { "0": "kein Verlust unmittelbar davor", "1": "1 Verlust unmittelbar davor", "2": "2 Verluste in Folge davor", "3 oder mehr": "3 oder mehr Verluste in Folge davor" };

/** One condition: "RSI(14) ab 55", "Session London", "kein Verlust unmittelbar davor". */
export function condText(c: Cond): string {
  const d = FEATURES[c.f];
  if (c.k === "cat") {
    switch (c.f) {
      case "lossStreak":
        return STREAK_TEXT[c.v] ?? `${c.v} Verluste davor`;
      case "setup":
        return `Setup „${c.v}“`;
      case "emotion":
        return `Emotion ${c.v}`;
      case "side":
        return `Richtung ${c.v}`;
      case "session":
        return `Session ${c.v}`;
      case "weekday":
        return `Wochentag ${c.v}`;
      case "dayPart":
        return `Tageszeit ${c.v}`;
      default:
        return `${d.label} ${c.v}`;
    }
  }
  if (c.lo != null && c.hi != null) return `${d.label} zwischen ${dec(c.lo, d.digits)} und ${valueText(c, c.hi)}`;
  if (c.lo != null) return `${d.label} ab ${valueText(c, c.lo)}`;
  if (c.hi != null) return `${d.label} unter ${valueText(c, c.hi)}`;
  return d.label;
}

export const condsText = (conds: readonly Cond[]): string => conds.map(condText).join(" UND ");

const pc = (v: number | null): string => (v == null ? "–" : `${Math.round(v * 100)} %`);
export const rText = (v: number | null, d = 2): string => (v == null ? "–" : `${v > 0 ? "+" : ""}${dec(v, d)} R`);
export const pctText = pc;

/** "Wenn … : 71 % Treffer statt 48 % (n=64, bestätigt)". */
export function findingSentence(f: Finding): string {
  const a = f.all;
  const head = `Wenn ${condsText(f.conds)}`;
  const rate = a.winRate == null ? "keine Trefferquote" : `${f.side === "loss" ? "nur " : ""}${pc(a.winRate)} Treffer statt ${pc(a.baseWinRate)}`;
  return `${head}: ${rate} (n=${a.n}, ${TIER_LABEL[f.tier]})`;
}

/** The count line: "Ich habe 412 Zusammenhänge geprüft, 3 halten stand." */
export function countsSentence(c: DiscoveryCounts): string {
  const tested = `Ich habe ${c.tested.toLocaleString("de-DE")} ${c.tested === 1 ? "Zusammenhang" : "Zusammenhänge"} geprüft`;
  const stand = c.confirmed === 0 ? "keiner hält stand" : c.confirmed === 1 ? "1 hält stand" : `${c.confirmed} halten stand`;
  return `${tested}, ${stand}.`;
}

/** The breakdown: bestätigt · Hinweis · verworfen (Zufall) – the rejected ones count too. */
export function breakdownText(c: DiscoveryCounts): string {
  const parts = [`${c.confirmed} bestätigt`, `${c.hint} ${c.hint === 1 ? "Hinweis" : "Hinweise"}`, `${c.rejected.toLocaleString("de-DE")} verworfen (Zufall)`];
  if (c.redundant > 0) parts.push(`${c.redundant} schon durch Einzelmerkmale erklärt`);
  return parts.join(" · ");
}

export const REASON_TEXT: Readonly<Record<Reason, string>> = {
  chance: "Nach Abzug der vielen Tests ist der Unterschied mit Zufall vereinbar.",
  flipped: "Im Bestätigungsteil zeigt das Muster in die Gegenrichtung.",
  confirmSmall: "Im Bestätigungsteil gibt es zu wenige Trades mit diesem Muster, um es zu prüfen.",
  confirmWeak: "Im Bestätigungsteil ist der Unterschied nicht klar genug.",
  unstable: "Das Vorzeichen ist nicht in mindestens 3 von 4 Zeitabschnitten gleich.",
  gate: "Das Merkmal zeigt als Ganzes keinen Zusammenhang (Permutationstest).",
  untested: "Es gab mehr Kandidaten, als die Bestätigung prüft – dieses wurde nicht geprüft.",
};

/** "Ø R +0,42 R statt −0,05 R" etc. for one part of the data. */
export function partText(s: CellStats | null): string {
  if (!s || s.n === 0) return "keine Trades";
  return `n=${s.n} · Treffer ${pc(s.winRate)} (Basis ${pc(s.baseWinRate)}) · Ø R ${rText(s.avgR)} (Basis ${rText(s.baseAvgR)})`;
}

/** Plain explanation why there is nothing to show (not enough trades, no features). */
export function emptyText(r: DiscoveryResult): string {
  return r.note ?? "Keine Befunde.";
}
