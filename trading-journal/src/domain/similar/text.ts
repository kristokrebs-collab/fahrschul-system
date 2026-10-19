/** German wording of the result (F19, pure). Observations with numbers – never a forecast, never a recommendation. */
import { FEATURES, MIN_HITS, type Outcome, type Share, type SimUnit, type SimilarResult, type SimilarSummary } from "./types";

const de = (x: number, d: number): string => Math.abs(x).toFixed(d).replace(".", ",");
const sign = (x: number): string => (x > 0 ? "+" : x < 0 ? "−" : "");

/** `+1,2 R` / `−0,8 %` (signed) – 1 R is one ATR of the hit's candle. */
export function moveText(v: number, unit: SimUnit, signedValue = true): string {
  const d = unit === "r" ? 1 : 2;
  const body = `${de(v, d)} ${unit === "r" ? "R" : "%"}`;
  // a value that rounds to zero carries no sign
  return signedValue ? `${sign(Number(Math.abs(v).toFixed(d)) === 0 ? 0 : v)}${body}` : body;
}

export const pctText = (x: number): string => `${Math.round(x * 100)} %`;
export const rangeText = (s: Share): string => `${Math.round(s.lo * 100)}–${Math.round(s.hi * 100)} %`;

export const NOT_A_FORECAST = "Ähnlichkeit ist keine Prognose: Die Fundstellen beschreiben, wie es nach ähnlich aussehenden Kerzen war – nicht, wie es jetzt weitergeht.";
export const MULTIPLE_TESTING =
  "Je mehr Merkmale du in die Ähnlichkeit steckst und je öfter du Zeiteinheit, Horizont oder Merkmale wechselst, desto eher findest du zufällig ein Muster, das nur in diesen Daten so aussieht (Mehrfachtest). Ein auffälliges Ergebnis ist ein Anlass zum Prüfen, kein Beleg.";
export const OVERLAP_NOTE = "Die Vergleichsbasis nimmt jede Kerze des Zeitraums, ihre Verläufe überlappen sich und sind deshalb stark voneinander abhängig.";

export const horizonText = (h: number): string => `${h} Kerze${h === 1 ? "" : "n"}`;

/** Why there is no distribution (null when there is one). */
export function fewText(r: SimilarResult): string | null {
  switch (r.status) {
    case "ok":
      return null;
    case "noFeatures":
      return r.dropped.length ? "Kein Merkmal ist für diese Zeiteinheit und Kerzenzahl verwendbar." : "Es ist kein Merkmal gewählt.";
    case "noCandles":
      return `Zu wenig Kerzen: ${r.bars} geschlossene Kerzen geladen, für diese Auswahl braucht es mindestens ${r.need}.`;
    case "few":
      return `Zu wenig Daten: ${r.hits.length} ${r.hits.length === 1 ? "Fundstelle" : "Fundstellen"} unter ${r.candidates} vergleichbaren Kerzen. Ab ${MIN_HITS} Fundstellen zeige ich eine Verteilung – darunter wäre jede Quote Zufall. Du kannst die Fundstellen unten trotzdem einzeln ansehen.`;
  }
}

/** „In 14 von 24 ähnlichen Situationen lag der Kurs nach 12 Kerzen höher (58 %, Spanne 41–73 %).“ */
export function headline(s: SimilarSummary, horizon: number): string {
  const word = s.expectation === "down" ? "tiefer" : "höher";
  const share = s.expectation === "down" ? s.down : s.up;
  if (!s.expectation) return `${s.n} ähnliche Situationen: nach ${horizonText(horizon)} gleich oft höher (${s.up.k}) und tiefer (${s.down.k}).`;
  return `In ${share.k} von ${s.n} ähnlichen Situationen lag der Kurs nach ${horizonText(horizon)} ${word} (${pctText(share.share)}, Spanne ${rangeText(share)}).`;
}

/** What the hit set says compared with the period as a whole. */
export function baselineText(s: SimilarSummary, r: SimilarResult): string | null {
  const b = r.baseline;
  if (!b) return null;
  const mine = pctText(s.up.share);
  const all = pctText(b.up.share);
  const overlaps = s.up.lo <= b.up.share && b.up.share <= s.up.hi;
  return `Im ganzen Zeitraum lag der Kurs nach ${horizonText(r.cfg.horizon)} in ${all} aller ${b.n} Fälle höher; bei den ähnlichen sind es ${mine}. ${overlaps ? "Der Unterschied liegt innerhalb der Unsicherheit der Stichprobe." : "Der Unterschied liegt außerhalb der Unsicherheit der Stichprobe – bei dieser Datenmenge und Zahl getesteter Varianten trotzdem kein Beleg."}`;
}

export function outcomeText(o: Outcome, unit: SimUnit): string {
  const dir = o.dir === "up" ? "höher" : o.dir === "down" ? "tiefer" : "unverändert";
  return `${dir} ${moveText(o.change, unit)} · max. ${moveText(o.up, unit)} / ${moveText(-o.down, unit)}`;
}

export function firstTouchText(o: Outcome, unit: SimUnit): string {
  const one = unit === "r" ? "1 R" : "1 %";
  switch (o.first) {
    case "up":
      return `+${one} nach ${horizonText(o.firstBars ?? 0)} zuerst`;
    case "down":
      return `−${one} nach ${horizonText(o.firstBars ?? 0)} zuerst`;
    case "both":
      return `±${one} in derselben Kerze – Reihenfolge unbekannt`;
    case "none":
      return `±${one} nicht erreicht`;
  }
}

/** The names of the features that make up the description. */
export const featureNames = (ids: readonly (keyof typeof FEATURES)[]): string => ids.map((i) => FEATURES[i].label).join(", ");

/** The hint the card shows next to the hits: what „ähnlich“ means here. */
export function similarityText(r: SimilarResult): string {
  return `Ähnlich heißt: die letzte geschlossene Kerze wird durch ${r.features.length} Merkmal${r.features.length === 1 ? "" : "e"} beschrieben (${featureNames(r.features)}). Als Fundstelle zählt, was nach Abstand am nächsten liegt (höchstens ${de(r.cfg.maxDistance, 1)}), mit mindestens ${horizonText(r.cfg.minGap)} Abstand zwischen zwei Fundstellen.`;
}
