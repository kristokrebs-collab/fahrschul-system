/**
 * German copy of the purchase flow (B4). The legally relevant sentences are NOT written here: the button labels, the consent
 * wording and the price note come from `src/legal/consentTexts.ts` / `consentRecord.ts` (one source, quoted by the drafts in
 * `docs/RECHT/`). Everything stays "Entwurf – Prüfung durch Anwalt nötig". No promises of profit, no invented numbers.
 */
import { BUTTON_LABELS, PRICE_TAX_NOTE } from "@/legal/consentTexts";
import type { BillingInterval } from "../types";

export { BUTTON_LABELS, PRICE_TAX_NOTE };

const intervalWord = (i: BillingInterval, per = false): string => (i === "month" ? (per ? "pro Monat" : "monatlich") : per ? "pro Jahr" : "jährlich");

export const ORDER = {
  title: "Deine Bestellung",
  lead: "Prüfe die Angaben. Bestellt ist erst, wenn du unten auf den Button klickst – danach geht es zu Stripe, dort zahlst du.",
  rows: {
    plan: "Tarif",
    interval: "Abrechnung",
    seats: "Sitze",
    total: "Gesamtpreis",
    first: "Erste Zahlung",
    renewal: "Verlängerung",
    cancel: "Kündigung",
    tax: "Steuer",
  },
  intervalWord,
  seatsLine: (n: number, unit: string) => `${n} ${n === 1 ? "Sitz" : "Sitze"} × ${unit}`,
  seatsLess: "Einen Sitz weniger",
  seatsMore: "Einen Sitz mehr",
  totalNote: (per: string) => `${per} – Preis des Tarifs, Endbetrag mit Steuer im nächsten Schritt`,
  /** The price AFTER the trial is named, never only "gratis". */
  trial: (days: number, date: string, amount: string, per: string) =>
    `${days} Tage kostenlos testen – heute zahlst du nichts. Am ${date} beginnt die Zahlung: ${amount} ${per}.`,
  noTrial: (amount: string, per: string) => `Heute: ${amount} ${per}. Die Zahlung erfolgt im nächsten Schritt bei Stripe.`,
  couponNote: (code: string) => `Mit Code ${code}: der Rabatt gilt, wie bei Stripe angegeben, nicht dauerhaft – danach gilt der volle Preis.`,
  /** § 312j Abs. 2 BGB: term, automatic renewal, notice – in plain words. */
  renewal: (date: string, interval: BillingInterval, amount: string) =>
    `Das Abo verlängert sich automatisch am ${date} und danach ${interval === "month" ? "jeden Monat" : "jedes Jahr"} um ${amount}, bis du kündigst.`,
  cancel: "Du kannst jederzeit kündigen – es gibt keine Kündigungsfrist. Der Vertrag endet dann zum Ende des bezahlten Zeitraums. Kündigen geht in der App unter „Verträge hier kündigen“, auch ohne Anmeldung.",
  /** Stripe Tax on: the tax is shown by Stripe before the order is completed. */
  taxOn: "Steuer wird im nächsten Schritt von Stripe berechnet.",
  /** Stripe Tax off: honest – nothing is calculated on top. */
  taxOff: "Stripe Tax ist beim Betreiber nicht eingeschaltet: Stripe berechnet im nächsten Schritt keine Steuer zusätzlich, der Betrag ist der Preis des Tarifs.",
  contains: "Das ist enthalten",
  details: "Tarif im Detail",
  payment: "Zahlung und Rechnung über Stripe. Deine Kartendaten sehen wir nie.",
  notAdvice: "Keine professionelle Finanzberatung. Kein Gewinnversprechen.",
  draft: "Die Texte dieser Bestellung sind ein Entwurf – Prüfung durch Anwalt nötig.",
  termsMissing: "Bitte bestätige zuerst die AGB.",
  immediateMissing: "Bitte bestätige den sofortigen Beginn – ohne ihn kann dein Tarif nicht freigeschaltet werden.",
  immediateLead: "Sofortiger Beginn",
  signInButton: "Anmelden und weiter",
  signInNote: "Du musst angemeldet sein. Danach kommst du genau zu dieser Bestellung zurück.",
  closedTitle: "Bestellung noch nicht möglich",
  closedStripe: "Der Betreiber hat Stripe noch nicht verbunden. Bis dahin sind alle Funktionen freigeschaltet.",
  closedLegal: "Impressum, AGB und Datenschutz des Betreibers fehlen noch – ohne sie wird nichts verkauft.",
  redirecting: "Weiter zu Stripe …",
  back: "Zurück",
  close: "Abbrechen",
  outdated: "Die Bestelltexte wurden aktualisiert. Lade die Seite neu und bestätige noch einmal.",
  failed: "Die Bestellung konnte nicht gestartet werden.",
  changed: "Diese Bestellung wurde schon mit anderen Angaben gestartet. Bitte öffne sie neu.",
} as const;

/** Paket V: the payment window (the order paid in the app; legally relevant sentences stay in `ORDER` / `consentTexts.ts`). */
export const PAY = {
  kasse: "KASSE",
  stepsLabel: "Bestellschritte",
  steps: ["Auswahl", "Konto", "Zahlung"] as const,
  title: "Zahlungsdaten",
  sub: "Die Karte geht direkt an Stripe – wir sehen sie nie.",
  subDemo: "Demo ohne Zahlung · Testkarte 4242 4242 4242 4242",
  holder: "KARTENINHABER",
  holderPh: "Vor- und Nachname",
  number: "KARTENNUMMER",
  expiry: "GÜLTIG BIS",
  cvc: "PRÜFZIFFER",
  cvcBack: "Rückseite",
  missing: { holder: "Bitte gib den Namen auf der Karte an.", number: "Bitte gib die Kartennummer vollständig ein.", expiry: "Bitte gib das Ablaufdatum ein.", cvc: "Bitte gib die Prüfziffer ein." },
  fieldsFailed: "Die Kartenfelder von Stripe ließen sich nicht laden. Prüfe die Verbindung und öffne das Fenster neu.",
  handover: "Die Kartendaten gibst du im nächsten Schritt bei Stripe ein. Bestellt ist erst mit dem Button unten.",
  yourOrder: "DEINE BESTELLUNG",
  legalLinks: "Rechtstexte lesen",
  summaryLabel: "Deine Bestellung",
  trialRow: (days: number) => `${days} Tage Testphase`,
  firstRow: "Erste Zahlung",
  included: "inklusive",
  anytime: "jederzeit",
  taxIncl: "inkl. USt.",
  /** Paid in the app (Stripe Tax off – with it on the order hands over to Checkout): the price IS the amount. */
  taxHere: "Preise in Euro inkl. gesetzlicher Umsatzsteuer – Stripe berechnet nichts zusätzlich.",
  /** `ORDER.cancel` compact (the same facts: any time, no notice period, end of the paid period, the in-app button, no login needed). */
  cancelShort: "Du kannst jederzeit kündigen – keine Kündigungsfrist, Ende zum Schluss des bezahlten Zeitraums; in der App über „Verträge hier kündigen“, auch ohne Anmeldung.",
  taxStripe: "rechnet Stripe",
  dueToday: "Heute fällig",
  today: "heute",
  /** No trial, paid in the app: the first payment is this order. */
  noTrialHere: (amount: string, per: string) => `Heute: ${amount} ${per} – du zahlst jetzt mit deiner Karte.`,
  trustStripe: "Zahlung über Stripe (PCI-DSS)",
  trustTls: "TLS-verschlüsselt",
  cardWord: "Karte",
  authorising: "Autorisierung bei deiner Bank",
  paid: (amount: string) => `Bezahlt ${amount}`,
  paidSub: (card: string) => `${card} · der Beleg ist unterwegs`,
  trialActive: "Testphase läuft",
  trialSub: (card: string, date: string, amount: string, per: string) => `${card} · ab ${date} ${amount} ${per} · Beleg per E-Mail`,
  slowTitle: "Wir warten noch auf die Bestätigung",
  slowSub: "Stripe hat die Karte angenommen, die Bestätigung an uns fehlt noch. Dein Tarif erscheint unter Konto, sobald sie da ist.",
  done: "Fertig",
} as const;

export const DETAIL = {
  title: "Tarif im Detail",
  benefit: "Das bringt dir der Tarif",
  included: "Das ist enthalten",
  limits: "Grenzen",
  limitsLead: "Diese Mengen gelten im Tarif – pro Sitz beim Team-Tarif.",
  unlocks: "Das wird nach dem Kauf freigeschaltet",
  unlocksLead: (n: number) => `${n} ${n === 1 ? "Funktion" : "Funktionen"} der App kommen dazu oder werden vollständig.`,
  partial: "Nur zum Teil",
  partialLead: "Hier fehlt dem Tarif noch ein Teil – der steht in einem höheren Tarif:",
  none: "Dieser Tarif schaltet gegenüber Free nichts Zusätzliches frei.",
  more: (n: number) => `und ${n} weitere`,
  order: "Weiter zur Bestellung",
  compare: "Alle Tarife vergleichen",
  unlimited: "unbegrenzt",
  perDay: "pro Tag",
  perMonth: "pro Monat",
  honest: "Alles hier steht so im Tarifvertrag der App, derselben Quelle wie der Vergleich auf der Preisseite. Zahlen, die dort nicht stehen, gibt es nicht.",
} as const;

export const RESULT = {
  label: "Bestellung",
  check: "Status prüfen",
  checking: "Prüfe …",
  toKonto: "Zum Konto",
  retry: "Bestellung wieder öffnen",
  pay: "Zahlung abschließen",
  close: "Schließen",
  waited: (s: number) => `Wartezeit: ${s} s`,
} as const;

export const MANAGE = {
  title: "Abo verwalten",
  lead: "Alles an deinem Vertrag an einem Ort.",
  plan: "Tarif",
  interval: "Abrechnung",
  seats: "Sitze",
  price: "Preis",
  next: "Nächste Zahlung",
  ends: "Endet am",
  status: "Status",
  portal: "Zahlungsmittel & Rechnungen im Stripe-Portal",
  invoices: "Rechnungen ansehen",
  switchInterval: (to: BillingInterval) => (to === "year" ? "Auf jährlich wechseln" : "Auf monatlich wechseln"),
  switchNote: "Den Wechsel führt das Stripe-Kundenportal durch (Stripe rechnet den Rest der Laufzeit um). Er gilt erst, wenn Stripe ihn bestätigt.",
  seatsBtn: "Sitze ändern",
  cancelLead: "Kündigen",
  cancel: BUTTON_LABELS.cancel,
  withdrawLead: "Widerruf",
  withdraw: BUTTON_LABELS.withdraw,
  withdrawNote: "Verbraucher können in den ersten 14 Tagen nach Vertragsschluss widerrufen.",
  tier: "Dein Tarif wurde geändert.",
  none: "Du hast kein laufendes Abo.",
} as const;

export const CONTRACT = {
  cancel: {
    title: BUTTON_LABELS.cancel,
    lead: "Du brauchst kein Konto-Login. Gib die E-Mail-Adresse deines Kontos an – wir schicken dir einen Bestätigungslink.",
    next: "Weiter zur Bestätigung",
    confirmTitle: "Kündigung bestätigen",
    confirmLead: (email: string) => `Du kündigst deinen Vertrag mit der Adresse ${email}. Der Vertrag endet zum Ende des bezahlten Zeitraums.`,
    confirm: BUTTON_LABELS.cancelConfirm,
    doneTitle: "Kündigung eingegangen",
    afterLink: "Zuletzt: Öffne den Link in der E-Mail, die wir dir geschickt haben – erst dann wird die Kündigung ausgeführt.",
    afterDirect: "Deine Kündigung ist ausgeführt.",
    linkTitle: "Kündigung bestätigen",
    linkLead: "Zuletzt: Bestätige deine Kündigung mit einem Klick.",
    linkDone: "Dein Vertrag ist gekündigt.",
    linkEnds: (date: string) => `Er endet am ${date}. Bis dahin bleibt alles freigeschaltet, danach verlängert er sich nicht.`,
    linkNone: "Zu diesem Link gibt es keinen laufenden Vertrag mehr.",
    offerLead: "Möchtest du uns sagen, warum? (freiwillig, ändert nichts an deiner Kündigung)",
  },
  withdraw: {
    title: BUTTON_LABELS.withdraw,
    lead: "Du kannst ohne Konto-Login widerrufen. Gib die E-Mail-Adresse deines Kontos an, deinen Namen und – wenn du magst – eine Angabe zum Vertrag.",
    next: "Weiter zur Bestätigung",
    confirmTitle: "Widerruf bestätigen",
    confirmLead: (email: string) => `Du widerrufst deinen Vertrag mit der Adresse ${email}. Der bezahlte Tarif endet mit der Bestätigung.`,
    confirm: BUTTON_LABELS.withdrawConfirm,
    doneTitle: "Widerruf eingegangen",
    afterLink: "Zuletzt: Öffne den Link in der E-Mail, die wir dir geschickt haben – erst dann wird der Widerruf ausgeführt.",
    afterDirect: "Dein Widerruf ist ausgeführt.",
    linkTitle: "Widerruf bestätigen",
    linkLead: "Zuletzt: Bestätige deinen Widerruf mit einem Klick.",
    linkDone: "Dein Vertrag ist widerrufen.",
    linkEnds: () => "Der bezahlte Tarif ist beendet. Zur Erstattung melden wir uns getrennt.",
    linkNone: "Zu diesem Link gibt es keinen laufenden Vertrag mehr.",
    late: "Die Widerrufsfrist von 14 Tagen ist abgelaufen. Der Vertrag besteht weiter – du kannst ihn kündigen.",
    offerLead: "",
  },
  email: "E-Mail-Adresse deines Kontos",
  name: "Dein Name",
  contractHint: "Angabe zum Vertrag (optional, z. B. Tarif und Bestelldatum)",
  invalidEmail: "Bitte gib eine gültige E-Mail-Adresse an.",
  nameMissing: "Bitte gib deinen Namen an.",
  back: "Zurück",
  receivedAt: (stamp: string) => `Eingegangen am ${stamp}.`,
  mailSent: "Wenn zu dieser Adresse ein Vertrag besteht, haben wir eine E-Mail mit dem Bestätigungslink geschickt. Sie ist auch deine Bestätigung auf einem dauerhaften Datenträger.",
  mailSentDirect: "Wir haben dir die Bestätigung per E-Mail geschickt.",
  mailOff: "Der Betreiber hat den E-Mail-Versand noch nicht eingerichtet: Deine Erklärung ist gespeichert, aber wir können dir keinen Bestätigungslink und keine Bestätigungs-Mail schicken. Bitte melde dich beim Betreiber (Kontakt im Impressum).",
  expired: "Der Link ist abgelaufen (24 Stunden). Erkläre bitte noch einmal.",
  unknown: "Dieser Link ist ungültig oder schon benutzt.",
  failed: "Das hat gerade nicht geklappt. Bitte versuche es gleich noch einmal.",
  draft: "Entwurf – Prüfung durch Anwalt nötig.",
  close: "Schließen",
  footer: "Verträge kündigen",
  footerWithdraw: "Vertrag widerrufen",
  loading: "Einen Moment …",
  confirming: "Wird ausgeführt …",
} as const;

export const TIER_NOTE = "Dein Tarif hat sich geändert.";
