/** German copy of the Chartfälle (F47): calm sentences, the rules of the game said out loud. */
import type { CaseDirection, CaseInterval } from "./contract";

export const DIRECTION_LABEL: Readonly<Record<CaseDirection, string>> = { up: "Steigt", down: "Fällt", flat: "Seitwärts" };
export const INTERVAL_LABEL: Readonly<Record<CaseInterval, string>> = { "15m": "15 Min", "1h": "1 Std", "4h": "4 Std", "1d": "1 Tag" };

export const CASES = {
  title: "Chartfälle",
  lead: "Dieselbe Kursstrecke für alle: erst die Hypothese festhalten, dann den Verlauf sehen.",
  new: "Neuer Fall",
  mentorOnly: "In Mentor-Gruppen stellen Mentoren die Fälle.",
  emptyTitle: "Noch kein Chartfall",
  empty: "Ein Fall zeigt eine Kursstrecke bis zu einer Kerze. Jede:r hält vorab fest, wohin es geht – die anderen sehen es erst, wenn der Fall geschlossen ist.",

  // card
  by: (name: string) => `von ${name}`,
  you: "Du",
  anchor: (when: string) => `bis ${when}`,
  question: (n: number, size: string) => `Wo steht der Kurs nach ${n} Kerzen (${size})?`,
  open: (until: string) => `offen bis ${until}`,
  closedBadge: "geschlossen",
  hypotheses: (n: number) => `${n} ${n === 1 ? "Hypothese" : "Hypothesen"}`,
  hiddenUntilClosed: "Die Texte der anderen bleiben verdeckt, bis der Fall geschlossen ist.",
  loading: "Lade Kerzen …",
  reload: "Erneut laden",
  loadErrors: {
    blocked: "Die Kerzen sind gerade nicht erreichbar (Börse blockiert oder offline).",
    rate: "Die Börse bremst gerade – bitte gleich noch einmal.",
    symbol: "Dieses Symbol kennt die Börse nicht.",
    failed: "Die Kerzen ließen sich nicht laden.",
    none: "Für diese Strecke liefert die Börse keine Kerzen.",
  },
  chartLabel: (pair: string, size: string, n: number, when: string, last: string) => `${pair}, ${size}-Kerzen, ${n} Kerzen bis ${when}, letzter Schlusskurs ${last}`,
  anchorMark: "Ankerkerze",
  refMark: "Ankerkurs",
  zone: "Seitwärts-Zone",
  futureHidden: "Der Verlauf ist verdeckt, bis du deine Hypothese festgehalten hast.",

  // form
  formTitle: "Deine Hypothese",
  direction: "Wohin geht der Kurs?",
  confidence: "Wie sicher bist du?",
  reason: "Warum?",
  reasonPlaceholder: "Ein, zwei Sätze – was siehst du im Chart?",
  reasonShort: "Mindestens 10 Zeichen.",
  commit: "Hypothese festhalten",
  commitHint: "Sie wird mit der Serverzeit gespeichert und lässt sich nicht mehr ändern oder löschen.",
  committed: "Hypothese festgehalten",
  mine: "Deine Hypothese",
  stored: (when: string) => `festgehalten ${when}`,

  // result
  resultTitle: "Der Verlauf",
  pending: (when: string) => `Der Verlauf ist erst nach ${when} vollständig – dann steht hier das Ergebnis.`,
  unavailable: {
    noAnchor: "Die Ankerkerze fehlt in den Daten der Börse.",
    noAtr: "Zu wenige Kerzen davor für die Breite der Seitwärts-Zone.",
    gap: "Die letzte Kerze der Strecke fehlt in den Daten der Börse – ein Ergebnis wird nicht geschätzt.",
  },
  outcome: (move: string, n: number, band: string, dir: string) => `Der Kurs lag nach ${n} Kerzen bei ${move} zum Ankerkurs (Seitwärts-Zone ±${band}) – also: ${dir}.`,
  way: (up: string, down: string) => `Auf dem Weg: höchstens ${up}, tiefstens ${down}.`,
  hit: "trifft zu",
  miss: "trifft nicht zu",
  hitNote: (dir: string, conf: number, verdict: string) => `Deine Hypothese: ${dir} (${conf} %) – ${verdict}.`,
  convention: "Seitwärts heißt: der Schlusskurs liegt innerhalb von ½ × der üblichen Kerzenspanne (ATR 14) × √Kerzen um den Ankerkurs. Eine Festlegung, damit die Frage beantwortbar ist – keine Aussage über den Markt.",
  oneCase: "Ein einzelner Fall zeigt nichts über Können; erst viele Fälle tun es.",

  // others
  others: "Die Hypothesen der Gruppe",
  tally: (t: { n: number; up: number; down: number; flat: number }) => `${t.n} ${t.n === 1 ? "Hypothese" : "Hypothesen"}: ${t.up} steigt · ${t.down} fällt · ${t.flat} seitwärts`,
  hitRate: (hits: number, n: number, pct: number | null) => (pct == null ? `${hits} von ${n} trafen zu – zu wenig für eine Quote.` : `${hits} von ${n} trafen zu (${pct} %) – eine kleine Gruppe, keine Wertung.`),
  delay0: "vor der nächsten Kerze",
  delayN: (n: number) => `${n} ${n === 1 ? "Kerze" : "Kerzen"} nach dem Anker`,
  delayNote: "Hypothesen, die erst nach weiteren Kerzen abgegeben wurden, hatten schon einen Teil des Verlaufs vor sich.",
  nobody: "Niemand hat eine Hypothese abgegeben.",

  // actions
  close: "Jetzt schließen",
  closeHint: "Danach sehen alle, was alle geschrieben haben – neue Hypothesen gehen nicht mehr.",
  closed: "Fall geschlossen",
  delete: "Löschen",
  deleteAsk: "Chartfall löschen?",
  deleted: "Chartfall gelöscht",
  report: "Melden",

  // new-case sheet
  sheetTitle: "Neuer Chartfall",
  sheetLead: "Eine Kursstrecke der Börse (öffentliche Daten – nichts aus deinem Journal). Alle sehen die Kerzen bis zur Ankerkerze.",
  pair: "Symbol",
  pairPlaceholder: "BTCUSDT",
  size: "Kerzengröße",
  when: "Letzte sichtbare Kerze",
  whenReplay: "Rückblick",
  whenNow: "Gerade geschlossen",
  whenHint: {
    replay: "Der Verlauf liegt schon vor – für alle gleich, auf Vertrauensbasis: Wer ihn vorher woanders gesehen hat, hält seine Hypothese nicht blind fest.",
    now: "Der Verlauf kommt erst noch. Das Ergebnis steht fest, sobald die Strecke vorbei ist.",
  },
  whenAt: "Ankerkerze (deine Zeit)",
  candleOf: (size: string) => `${size}-Kerze`,
  notClosed: "Diese Kerze ist noch nicht geschlossen – wähle eine frühere oder „Gerade geschlossen“.",
  horizon: "Frage nach",
  horizonUnit: (n: number) => `${n} Kerzen`,
  openFor: "Hypothesen offen für",
  openOptions: [
    { v: "1", label: "1 Std" },
    { v: "6", label: "6 Std" },
    { v: "24", label: "24 Std" },
    { v: "72", label: "3 Tage" },
  ] as const,
  questionLabel: "Frage an die Gruppe (optional)",
  questionPlaceholder: "z. B. Hält die Box nach oben?",
  preview: "So sehen es alle",
  previewNone: "Gib ein Symbol ein und wähle eine Kerze – die Vorschau lädt die Kerzen.",
  post: "Chartfall stellen",
  posted: "Chartfall gestellt",
  never: "Nur öffentliche Kerzen und deine Frage. Dein Journal, deine Trades und deine Konten bleiben außen vor.",
  noGroup: "Wähle zuerst eine Gruppe.",
} as const;
