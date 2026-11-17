/** German copy of the data-takeover dialog (B1) – plain words, numbers from the preview, nothing promised that is not done. */
import { totalOf, type KindCount, type TakeoverChoice, type TakeoverPreview, type TakeoverResult, type TakeoverStep } from "../sync/takeover";
import { UNDO_WINDOW_MS } from "../sync/undo";

const n = (count: number, one: string, many: string): string => `${count.toLocaleString("de-DE")} ${count === 1 ? one : many}`;

export const records = (c: KindCount): string => {
  const parts = [c.trades ? n(c.trades, "Trade", "Trades") : "", c.hyblock ? n(c.hyblock, "Messwert", "Messwerte") : "", c.days ? n(c.days, "Tagesnotiz", "Tagesnotizen") : ""].filter(Boolean);
  return parts.length ? parts.join(" · ") : "nichts";
};

const minutes = Math.round(UNDO_WINDOW_MS / 60_000);

export const TAKEOVER = {
  title: "Daten aus diesem Browser",
  titleOther: "Journal eines anderen Kontos",
  lead: "In diesem Browser liegt schon ein Journal. Du meldest dich zum ersten Mal mit diesem Konto an – du entscheidest, was damit passiert. Vorher legen wir automatisch eine Sicherung an.",
  leadOther: "Dieses Journal gehörte zu einem anderen Konto. Es wird nie in dieses Konto hochgeladen.",
  leadEmpty: "Dein Konto ist noch leer. Soll das Journal aus diesem Browser hineinwandern?",
  tableLabel: "Was auf beiden Seiten liegt",
  here: "In diesem Browser",
  cloud: "Im Konto",
  rows: { same: "In beiden gleich", localOnly: "Nur hier", cloudOnly: "Nur im Konto", differ: "Unterschiedlich", duplicates: "Doppelte (übersprungen)" },
  radioLabel: "Was soll passieren?",
  recommended: "Empfohlen",
  later: "Später entscheiden",
  laterHint: "Bis du wählst, bleibt dein Journal nur in diesem Browser.",
  apply: { merge: "Zusammenführen", local: "Übernehmen", cloud: "Konto übernehmen", keep: "Lokal behalten" } as Record<TakeoverChoice, string>,
  options: {
    merge: { title: "Zusammenführen", text: "Alles aus beiden Teilen. Wo ein Eintrag verschieden ist, gewinnt die neuere Version. Es geht nichts verloren." },
    local: { title: "Lokale Daten übernehmen", text: "Dieses Gerät gewinnt, wo ein Eintrag verschieden ist. Was nur im Konto liegt, bleibt dort." },
    cloud: { title: "Nur Cloud", text: `Dieses Gerät übernimmt das Konto. Dein lokales Journal bleibt in der Sicherung und ${minutes} Minuten per „Rückgängig“ zurückholbar.` },
    keep: { title: "Lokal behalten", text: "Nichts wird übertragen oder geladen. Der Sync ist auf diesem Gerät aus – du kannst ihn jederzeit unter Konto → Datenschutz einschalten." },
  } as Record<TakeoverChoice, { title: string; text: string }>,
  working: { title: "Daten werden übernommen …", lead: "Das Fenster bleibt offen, bis alles übertragen ist." },
  steps: { snapshot: "Sicherung anlegen", merge: "Zusammenführen", upload: "Übertragen" } as Record<Exclude<TakeoverStep, "finish">, string>,
  progress: (done: number, total: number) => `${done.toLocaleString("de-DE")} von ${total.toLocaleString("de-DE")}`,
  done: { title: "Fertig", undo: "Rückgängig", undoHint: (left: string) => `Noch ${left} zum Rückgängigmachen.`, undoNote: "Rückgängig stellt dieses Gerät und das Konto wieder her. Einträge, die seitdem geändert wurden, landen in einer neuen Sicherung.", close: "Schließen", expired: "Das Rückgängig-Fenster ist abgelaufen. Die Sicherung findest du unter Einstellungen → Daten → Wiederherstellen." },
  error: { title: "Das hat nicht geklappt", text: "Dein Journal in diesem Browser ist unverändert. Der Sync versucht es später erneut und fragt dann noch einmal.", close: "Schließen" },
  undone: "Rückgängig gemacht. Wähle noch einmal.",
  undoDone: { title: "Übernahme rückgängig gemacht", detail: "Dein Journal ist wie vorher. Du kannst neu wählen." },
  undoFailed: "Rückgängig ging nicht. Dein Journal ist unverändert.",
  card: { undoLine: (left: string) => `Datenübernahme rückgängig machen (noch ${left})`, undo: "Rückgängig" },
} as const;

/** What the choice would do, with the preview's numbers (the line under the option). */
export function effectLine(choice: TakeoverChoice, p: TakeoverPreview): string {
  const toCloud = totalOf(p.localOnly);
  const fromCloud = totalOf(p.cloudOnly);
  const differ = totalOf(p.differ);
  switch (choice) {
    case "merge":
      return [toCloud ? `${n(toCloud, "Eintrag", "Einträge")} ins Konto` : "", fromCloud ? `${n(fromCloud, "Eintrag", "Einträge")} hierher` : "", differ ? `${n(differ, "Unterschied", "Unterschiede")}: die neuere Version gewinnt` : ""].filter(Boolean).join(" · ") || "Nichts zu übertragen";
    case "local":
      return [toCloud ? `${n(toCloud, "Eintrag", "Einträge")} ins Konto` : "", differ ? `${n(differ, "Eintrag", "Einträge")} im Konto überschrieben` : ""].filter(Boolean).join(" · ") || "Nichts zu übertragen";
    case "cloud":
      return `${n(totalOf(p.local), "lokaler Eintrag", "lokale Einträge")} werden hier ersetzt, ${n(totalOf(p.cloud), "Eintrag", "Einträge")} aus dem Konto kommen hierher`;
    case "keep":
      return `${n(totalOf(p.local), "Eintrag", "Einträge")} bleiben nur hier`;
  }
}

/** The done screen's summary. */
export function summaryLine(r: TakeoverResult): string {
  const parts = [r.pushed ? `${n(r.pushed, "Eintrag", "Einträge")} ins Konto` : "", r.pulled ? `${n(r.pulled, "Eintrag", "Einträge")} hierher` : "", r.conflicts ? `${n(r.conflicts, "Unterschied", "Unterschiede")} aufgelöst` : "", r.duplicates ? `${n(r.duplicates, "Doppelter", "Doppelte")} übersprungen` : ""].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Beide Seiten waren schon gleich.";
}

/** `m:ss` of the time left in the undo window. */
export function leftLabel(untilIso: string, now: number): string {
  const s = Math.max(0, Math.round((Date.parse(untilIso) - now) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
