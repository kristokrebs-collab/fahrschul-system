/**
 * Zwanzig Alltagsfragen an den Finder (A4): so fragt jemand, der den Namen der Funktion nicht kennt. Jede Frage nennt den Treffer, der
 * ganz oben stehen muss (`first`, Id des Registers oder `page:<seite>`), und – für den E2E-Test – wo man danach landet.
 * Gelesen von `tests/unit/features.everyday.test.ts` (nur die Rangfolge) und `tests/e2e/funktionsfinder.spec.ts` (mit echten Klicks).
 */
export interface EverydayQuestion {
  /** die Frage, wie sie getippt wird */
  q: string;
  /** Id des ersten Treffers: Register-Id oder `page:<seite>` */
  first: string;
  /** Seite, auf der man landet (Hash) */
  page?: string;
  /** `data-testid` des Ziels … */
  testid?: string;
  /** … oder Anfang der Kartenüberschrift */
  heading?: string;
  /** ein Dialog (Name), der aufgehen muss, statt eines Abschnitts */
  dialog?: string;
  /** die Karte gibt es hier nicht: der Hinweis (Fundort-Hinweis) sagt das, mit diesem Text */
  note?: RegExp;
}

export const EVERYDAY_QUESTIONS: readonly EverydayQuestion[] = [
  { q: "Wie viel soll ich einsetzen", first: "positionsrechner", page: "risiko", testid: "risk-calc" },
  { q: "Warum verliere ich so oft", first: "leaks-edges", page: "coach", testid: "coach-edges" },
  { q: "Daten sichern", first: "backup", page: "settings", testid: "settings-data" },
  { q: "Einstellungen", first: "page:settings", page: "settings" },
  { q: "Wo ändere ich mein Startkapital", first: "konten-kapital", page: "settings", heading: "Konten" },
  { q: "Was kostet das", first: "page:preise", page: "preise" },
  { q: "Wie melde ich mich an", first: "page:konto", page: "konto" },
  { q: "Wochenbericht lesen", first: "berichte", page: "berichte", testid: "berichte-view" },
  { q: "Wann sind wichtige Termine", first: "ereigniskalender", page: "markt", testid: "termine-card" },
  { q: "Trade aus Screenshot", first: "screenshot-ocr", dialog: "Screenshot importieren" },
  { q: "Wie schlecht kann es laufen", first: "monte-carlo", page: "analyse", testid: "ana-mc" },
  { q: "Ziele setzen", first: "ziele", page: "wachstum", testid: "growth-goals" },
  { q: "Ich will meine Strategie testen", first: "strategie-studio", page: "studio", testid: "studio-editor" },
  { q: "Daten herunterladen", first: "backup", page: "settings", testid: "settings-data" },
  { q: "Was habe ich verpasst", first: "verpasste-chancen", page: "coach", testid: "missed-card" },
  { q: "Tägliche Verlustgrenze", first: "verlustlimits", page: "risiko", testid: "risk-limits" },
  { q: "Neuigkeiten zu Aktien", first: "aktien-news", page: "aktien", testid: "aktien-news" },
  { q: "Tastatur Kürzel", first: "tastenkuerzel", dialog: "Tastenkürzel" },
  { q: "Dunkles Design", first: "darstellung", page: "settings", heading: "Darstellung" },
  // die Karte gibt es nur mit Konto – in diesem Build ohne Cloud sagt der Hinweis das, statt eines Toasts
  { q: "Gruppe beitreten", first: "gruppen", page: "community", note: /hier nicht verfügbar/ },
];
