/** German copy of the Schlüsselmarken cards (F09 / F08 / F22). Short sentences, the trader's words. */
import type { AlertStage, DeliveryOutcome, LevelStatus, PlanRole, Precedence, TriggerKind } from "@/domain/keylevels";

export const KL = {
  title: "Schlüsselmarken",
  note: "Eigene Preislevel mit Zeiteinheit und Regel. Der Status kommt aus den echten Kerzen des Marktes – nie aus einer anderen Zeiteinheit.",
  add: "Schlüsselmarke",
  addAria: "Schlüsselmarke hinzufügen",
  empty: "Noch keine eigene Schlüsselmarke.",
  emptyText: "Lege etwa „BTC unter 80.000, 4H-Schluss“ an. Die fünf festen Level aus den Einstellungen stehen schon in der Liste.",
  fixedTag: "aus Einstellungen",
  fixedHelp: "Wird in den Einstellungen unter „Live-Status · Trigger-Level“ geändert.",
  toSettings: "In Einstellungen ändern",
  symbolOff: "anderer Markt",
  marketIdle: "Der Live-Markt läuft nicht – kein Level kann bewertet werden.",
  edit: "Bearbeiten",
  duplicate: "Duplizieren",
  remove: "Löschen",
  removeAsk: "Wirklich löschen?",
  yes: "Ja",
  no: "Nein",
  history: "Verlauf",
  historyNone: "Noch keine Ereignisse.",
  precedence: "Vorrang bei Widerspruch",
  precedenceHelp: "Zeigen Marken verschiedener Zeiteinheiten in entgegengesetzte Richtungen, entscheidet diese Regel – es wird nie still eine Zeiteinheit gewählt.",
  saved: "Gespeichert",
  failed: "Speichern fehlgeschlagen",
  limit: (n: number) => `Mehr als ${n} Schlüsselmarken sind nicht möglich.`,
} as const;

export const STATUS_LABEL: Readonly<Record<LevelStatus, string>> = { waiting: "Wartet", provisional: "Vorläufig", confirmed: "Bestätigt", invalidated: "Ungültig", unknown: "Keine Daten" };
export const STATUS_GLYPH: Readonly<Record<LevelStatus, string>> = { waiting: "○", provisional: "◐", confirmed: "●", invalidated: "✕", unknown: "?" };
export const BASIS_LABEL = { intrabar: "laufende Kerze", close: "Schluss" } as const;

export const KIND_LABEL: Readonly<Record<TriggerKind, string>> = {
  touch: "Berührung",
  running: "Laufender Bruch",
  close: "Ein Schluss",
  closes: "Mehrere Schlüsse",
  buffer: "Schluss mit Puffer",
  retest: "Bestätigter Retest",
};
export const KIND_HELP: Readonly<Record<TriggerKind, string>> = {
  touch: "Zählt, sobald der Kurs das Level erreicht – auch nur mit dem Docht. Unwiderruflich.",
  running: "Meldet sofort, wenn die laufende Kerze über (unter) dem Level liegt – vorläufig. Bestätigt wird erst mit dem Kerzenschluss.",
  close: "Die Kerze muss über (unter) dem Level schließen. Das Level selbst zählt nicht.",
  closes: "Mehrere Kerzen in Folge müssen über (unter) dem Level schließen. Ein Fehlschluss setzt den Zähler zurück.",
  buffer: "Der Schluss muss um einen Abstand (in % oder ATR) über (unter) dem Level liegen – filtert knappe Ausbrüche.",
  retest: "Erst ein Schlussbruch, dann kommt der Kurs ans Level zurück und schließt wieder darüber (darunter). Erst das ist die Bestätigung.",
};
export const DIRECTION_LABEL = { above: "über dem Level", below: "unter dem Level" } as const;
export const DIRECTION_SHORT = { above: "über", below: "unter" } as const;

export const ROLE_LABEL: Readonly<Record<PlanRole, string>> = { auto: "Automatisch", long: "Long-Trigger", short: "Short-Trigger", stop: "Invalidierung", info: "Nur beobachten" };
export const ROLE_HELP = "Automatisch: über dem Level = Long-Trigger, darunter = Short-Trigger. „Invalidierung“ taucht als Stop in den Szenarien auf, „Nur beobachten“ bleibt außerhalb des Plans.";

export const PRECEDENCE_OPTIONS: readonly { v: Precedence; label: string; help: string }[] = [
  { v: "higher", label: "Höhere Zeiteinheit", help: "Die größere Zeiteinheit gewinnt (1D schlägt 1h)." },
  { v: "lower", label: "Kleinere Zeiteinheit", help: "Die kleinere Zeiteinheit gewinnt (1h schlägt 1D)." },
  { v: "priority", label: "Priorität", help: "Die Marke mit der besseren Priorität (1 = höchste) gewinnt." },
  { v: "wait", label: "Abwarten", help: "Bei Widerspruch gilt weder Long noch Short." },
];

export const EDITOR = {
  titleNew: "Neue Schlüsselmarke",
  titleEdit: "Schlüsselmarke bearbeiten",
  name: "Name",
  namePlaceholder: "z. B. BTC unter 80.000 schließen",
  price: "Preis",
  pricePlaceholder: "z. B. 80.000",
  priceHelp: "Komma oder Punkt. Erkannt als:",
  priceBad: "Bitte einen Preis über 0 eingeben.",
  symbol: "Markt",
  tf: "Zeiteinheit",
  tfHelp: "Nur Zeiteinheiten, die der Markt-Feed wirklich liefert. Eine andere wird nie still eingesetzt.",
  tfBad: "Diese Zeiteinheit ist gerade nicht verfügbar.",
  direction: "Richtung",
  kind: "Regel",
  closes: "Anzahl Schlüsse",
  distance: "Abstand",
  distanceBuffer: "Puffer über (unter) dem Level",
  distanceRetest: "Retest-Toleranz am Level",
  distanceUnit: "Einheit",
  invalidation: "Invalidierung (optional)",
  invalidationHelp: "Ein Schluss jenseits dieses Preises macht die Marke ungültig.",
  priority: "Priorität",
  priorityHelp: "1 = höchste. Zählt bei „Priorität“ als Vorrang.",
  role: "Rolle im Tagesplan",
  note: "Notiz",
  alerts: "Alarm für diese Marke",
  alertsHelp: "Meldungen nur, solange die App geöffnet ist.",
  stages: "Stufen",
  mode: "Wiederholung",
  once: "Einmalig",
  recurring: "Wiederkehrend",
  onceHelp: "Jede Stufe höchstens einmal – bis du die Marke erneut scharf stellst.",
  recurringHelp: "Nach einer Ungültigkeit oder wenn der Kurs sich wieder entfernt hat, beginnt ein neuer Durchlauf.",
  save: "Speichern",
  cancel: "Abbrechen",
} as const;

export const STAGE_HELP: Readonly<Record<AlertStage, string>> = {
  prepare: "Kurs ist nahe am Trigger (oder die laufende Kerze liegt schon darüber).",
  confirm: "Die Regel ist erfüllt.",
  retest: "Der Kurs kam ans Level zurück und hielt.",
  invalid: "Die Marke ist wieder ungültig.",
};

export const PLAN = {
  title: "Tagesplan",
  note: "Range, Long, Short oder Abwarten – aus deinen Schlüsselmarken statt aus festen Leveln.",
  trigger: "Auslöser",
  invalidation: "Ungültig bei",
  changes: "Was den Plan ändert",
  active: "aktiv",
  armed: "vorläufig",
  blocked: "überstimmt",
  toast: "Meldung bei Planwechsel",
  toastHelp: "Ein Hinweis, wenn der Plan zwischen Range, Long und Short wechselt – nicht bei fehlenden Daten, nicht dreimal pro Minute.",
  precedenceIs: "Vorrang:",
} as const;

export const ALERTS = {
  title: "Alarme & Zustellprotokoll",
  note: "Mehrstufige, ruhige Meldungen für deine Schlüsselmarken: Vorbereitung, Bestätigung, Retest, Ungültigkeit.",
  honest: "Diese Alarme laufen im Browser nur, solange diese App in einem Browser-Tab geöffnet ist (der Tab darf im Hintergrund liegen). Ist die App geschlossen, kommt hier nichts an. Mit Konto und Tarif Pro kannst du unten zusätzlich den E-Mail-Alarm einschalten: Ein Server prüft dann alle 5 Minuten weiter und schreibt dir.",
  channels: "Kanäle",
  toast: "Hinweis in der App (Toast)",
  toastHelp: "Die Insel oben, wie bei den Signalen.",
  system: "System-Mitteilung",
  systemHelp: "Zusätzlich, wenn der Tab im Hintergrund ist und der Browser es erlaubt.",
  systemDenied: "Der Browser hat System-Mitteilungen nicht erlaubt.",
  systemUnsupported: "Dieser Browser kennt keine System-Mitteilungen.",
  hours: "Aktive Zeiten",
  hoursHelp: "Außerhalb dieser Zeit wird nichts gesendet (es steht im Protokoll). Geräte-Uhrzeit.",
  from: "Von",
  to: "Bis",
  prepare: "Vorbereitung ab Abstand",
  prepareHelp: "So nahe am Trigger beginnt die Stufe „Vorbereitung“.",
  cooldown: "Sperre je Marke und Stufe",
  cooldownHelp: "Dieselbe Meldung nicht noch einmal innerhalb dieser Zeit.",
  cooldownOpt: (min: number) => (min === 0 ? "Aus" : min < 60 ? `${min} Min` : `${min / 60} Std`),
  log: "Zustellprotokoll",
  logNote: "Was gesendet oder zurückgehalten wurde – nur in diesem Browser, die letzten 200.",
  logEmpty: "Noch nichts gesendet.",
  logClear: "Protokoll leeren",
  logCleared: "Protokoll geleert",
  source: { key: "Schlüsselmarke", signal: "Einstiegs-Check", box: "Box-Alarm" },
  channelWord: { toast: "Toast", system: "System" },
  noChannel: "kein Kanal",
} as const;

export const OUTCOME_TONE: Readonly<Record<DeliveryOutcome, "win" | "mute" | "warn">> = { sent: "win", duplicate: "mute", hours: "warn", channels: "warn" };
