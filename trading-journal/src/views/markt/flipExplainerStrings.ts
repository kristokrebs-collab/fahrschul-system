/**
 * German copy of the "Was ist ein Flip?" explainer on top of the Top-Trader card (Markt page). Fixed wording:
 *  - the actors are always "Top-Trader (oberste 20 % nach Einsatz, Binance)" – never the word for on-chain big holders and never
 *    a data vendor's name (another source, another cohort); `tests/unit/views.markt.flipExplainer.test.ts` greps every string;
 *  - the classification is a hint, never a forecast and never advice; nothing here says what the price WILL do.
 */
export const FLIP_WHO = "Top-Trader (oberste 20 % nach Einsatz, Binance)";

export const FLIP = {
  title: "Was ist ein Flip?",
  lead: `Ein Flip ist der Moment, in dem die ${FLIP_WHO} von netto Long auf netto Short kippen – oder zurück: Ihr Netto (Long minus Short) kreuzt die Nulllinie.`,
  realBadge: "Echte Daten",
  schemaBadge: "Schema, keine Daten",
  schemaTitle: "So sieht ein Flip aus",
  schemaNote: "Eine Skizze zum Verstehen – die Kurven sind erfunden und zeigen keinen Markt.",
  legendLong: "+ netto Long (Fläche über der Nulllinie)",
  legendShort: "− netto Short (schraffiert, unter der Nulllinie)",
  legendPrice: "Preislinie (eigene Skala)",
  zoneLong: "+ netto Long",
  zoneShort: "− netto Short",
  loading: "Die echten Daten werden geladen …",
  gapLabel: "keine Daten",
  steps: [
    { n: 1, title: "Top-Trader netto long", text: "Mehr Long als Short: die Fläche liegt über der Nulllinie (+)." },
    { n: 2, title: "Positionierung kippt", text: "Das Netto kreuzt die Nulllinie – dieser Moment ist der Flip." },
    { n: 3, title: "Netto short", text: "Fläche unter der Nulllinie (−): ein mögliches Warnsignal, das Risiko für Rückgänge kann steigen." },
  ],
  hint: "Einordnung: Ein Flip ins Netto-Short wird oft als Vorsichtszeichen gelesen – wenn die größten Konten mehrheitlich auf fallende Kurse setzen, kann das Risiko für Rückgänge steigen. Das ist eine Lesart, keine Prognose und keine Anlageempfehlung; die Karte prüft nicht, was der Kurs danach tat.",
  howTitle: "Wie lese ich das?",
  how: [
    { id: "net", term: "Netto", text: "Long-Anteil minus Short-Anteil, in Prozentpunkten (Pkt.). Beispiel: 55 % Long und 45 % Short sind +10 Pkt." },
    { id: "zero", term: "Nulllinie", text: "Bei 0 sind Long und Short gleich groß. Darüber (+, grün) überwiegt Long, darunter (−, rot und schraffiert) überwiegt Short." },
    { id: "flip", term: "Flip", text: "Das Netto kreuzt die Nulllinie und bleibt danach auf der neuen Seite. Eine Zone von ±1 Pkt. um die Null gilt als ausgeglichen – Zittern um die Null ist kein Flip." },
    { id: "limits", term: "Grenzen", text: "Gezählt werden nur die obersten 20 % der Binance-Konten nach Einsatz – eine Börse, nicht der ganze Markt. Die Statistik kommt mit Verzug (die Messzeit steht unter der Grafik), Lücken im Verlauf bleiben Lücken. Die Preislinie hat ihre eigene Skala. Kein Kursziel, keine Prognose, keine Anlageempfehlung." },
  ],
  alarmButton: "Bei Flip benachrichtigen",
  alarmOpens: "Öffnet Einstellungen › Alarme. Den Alarm „Top-Trader-Umschlag“ schaltest du dort selbst ein – hier wird nichts aktiviert.",
} as const;

/** Every string the explainer can show, for the wording test. */
export function flipStringsFlat(): string[] {
  const out: string[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === "string") out.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(FLIP);
  out.push(FLIP_WHO);
  return out;
}
