import { PRICE_TAX_NOTE } from "@/legal/consentTexts";
/** German copy of the pricing page (P10). */
export const PREISE = {
  title: "Preise",
  lead: "Starte kostenlos und wechsle erst, wenn du mehr aus deinem Journal holen willst – jederzeit kündbar.",
  leadHighlight: "jederzeit kündbar",
  heroEyebrow: "Trade Journal Pro",
  heroLead: "Trade mit",
  heroSlots: ["Gefühl", "FOMO", "Zufall", "System"] as const,
  heroText: "Dein Journal zeigt dir, welche Setups wirklich Geld verdienen – und welche du streichen solltest.",
  heroAsideLabel: "Pro",
  heroHud: (days: number) =>
    days > 0
      ? `${days} Tage kostenlos testen. Danach monatlich oder jährlich, jederzeit zum Laufzeitende kündbar.`
      : "Monatlich oder jährlich, jederzeit zum Laufzeitende kündbar.",
  heroCta: () => "Pro wählen",
  plansTitle: "Tarife",
  interval: "Abrechnung",
  monthly: "Monatlich",
  yearly: "Jährlich",
  perMonth: "pro Monat",
  perSeatMonth: "pro Sitz und Monat",
  perYear: "pro Jahr",
  perSeatYear: "pro Sitz und Jahr",
  /** The big number of a yearly card is the amount DUE per year; the monthly value is only a comparison, never the price. */
  perMonthEquiv: (amount: string) => `entspricht ${amount} pro Monat`,
  yearlyNote: (months: number) => (months > 0 ? `${months} ${months === 1 ? "Monat" : "Monate"} gratis gegenüber monatlicher Zahlung` : ""),
  monthlyNote: "monatlich abgerechnet",
  /** Team: seats × price = the amount really due, shown on the card (`2 Sitze: 380 € pro Jahr`). */
  seatsTotal: (n: number, amount: string, per: string) => `${n} Sitze: ${amount} ${per}`,
  free: "0 €",
  freeNote: "für immer",
  // Paket P: "Beliebt" would claim a popularity nobody measured – the badge says what it is: our recommendation
  recommended: "Empfohlen",
  current: "Dein Tarif",
  /** the own column's pill on a phone (a 44-px column) */
  currentShort: "Du",
  ctaFree: "Kostenlos starten",
  ctaFreeSignedIn: "Im Free-Tarif",
  /** The way to the order summary – NOT the order button (that one says "Zahlungspflichtig bestellen", `BUTTON_LABELS.order`). */
  ctaOrder: "Weiter zur Bestellung",
  ctaLocked: "Noch nicht bestellbar",
  details: "Tarif im Detail",
  ctaManage: "Abo verwalten",
  ctaSwitch: "Wechseln",
  ctaSoon: "Noch nicht buchbar",
  seats: "Sitze",
  seatsLess: "Einen Sitz weniger",
  seatsMore: "Einen Sitz mehr",
  codeLabel: "Rabattcode",
  codePlaceholder: "Code eingeben",
  codeCheck: "Prüfen",
  codeRemove: "Entfernen",
  codeApplied: "Code aktiv",
  codeFirstTime: "nur für die erste Bestellung",
  codeRestricted: "gilt für ausgewählte Tarife",
  refTitle: "Du wurdest eingeladen",
  refText: (days: number) => `${days} Tage gratis testen statt 14 – der Rabatt gilt automatisch beim Abschluss.`,
  compareTitle: "Alle Funktionen im Vergleich",
  compareLead: "Die stärksten Funktionen zuerst. Free bleibt kostenlos – ohne Zeitlimit.",
  limitsGroup: "Kontingente",
  groupCount: (n: number) => (n === 1 ? "1 Zeile" : `${n} Zeilen`),
  expandAll: "Alle aufklappen",
  collapseAll: "Alle zuklappen",
  unlimited: "∞",
  included: "Enthalten",
  notIncluded: "Nicht enthalten",
  marqueeLabel: "Fakten zum Trade Journal",
  faqTitle: "Häufige Fragen",
  legalCancel: "Verträge hier kündigen",
  legalNoContract: "Es läuft gerade kein Vertrag.",
  legalNote: `${PRICE_TAX_NOTE} Zahlung und Rechnungen über Stripe. Es gelten die Dokumente des Betreibers:`,
  closedCta: "Alles freigeschaltet",
} as const;

export const FACTS: readonly string[] = [
  "Local-first – dein Journal gehört dir",
  "Export jederzeit als JSON oder CSV",
  "Kündigung direkt in der App",
  "Zahlung sicher über Stripe",
  "Keine Kartendaten bei uns",
  "2FA für dein Konto",
];

export const FAQ: readonly { q: string; a: string }[] = [
  {
    q: "Kann ich jederzeit kündigen?",
    a: "Ja. Unter Konto → Abo findest du „Vertrag hier kündigen“. Dein Abo läuft bis zum Ende der bezahlten Laufzeit und verlängert sich dann nicht mehr.",
  },
  {
    q: "Was passiert in der Testphase?",
    a: "Du kannst alles aus dem Tarif nutzen. Drei Tage vor dem Ende erinnert dich die App daran. Kündigst du in der Testphase, zahlst du nichts.",
  },
  {
    q: "Was passiert mit meinen Daten, wenn ich kündige?",
    a: "Nichts geht verloren. Dein Journal bleibt lokal und in der Cloud, nur die Pro-Funktionen sind dann wieder gesperrt.",
  },
  {
    q: "Wie funktioniert der Team-Tarif?",
    a: "Du bezahlst pro Sitz und verwaltest alles auf einer Rechnung. Jedes Mitglied mit einem Sitz bekommt alle Premium-Funktionen.",
  },
  {
    q: "Bekomme ich Rechnungen?",
    a: "Ja. Jede Zahlung erzeugt eine Rechnung, die du unter Konto → Rechnungen oder im Stripe-Kundenportal herunterladen kannst.",
  },
  {
    // Launch-Audit D1, B8: what is NOT in the price, said before the purchase
    q: "Kommen zu den Preisen noch Kosten dazu?",
    a: "Für das Journal nicht: KI-Coach, Screenshot-Import, Simulationen und Alarme sind bis zu den Kontingenten deines Tarifs enthalten, sie stehen im Vergleich oben. Was andere Anbieter berechnen, zahlst du dort selbst – etwa die Handelsgebühren deiner Börse oder einen TradingView-Tarif, falls du Alarme von dort per Webhook schicken willst.",
  },
  {
    q: "Wie erreiche ich den Support?",
    a: "Schreib an die E-Mail-Adresse im Impressum, der Link steht unten auf jeder Seite. Für Kündigung und Widerruf brauchst du keinen Login: „Verträge hier kündigen“ und „Vertrag widerrufen“ stehen ebenfalls in der Fußzeile.",
  },
  {
    q: "Wie funktionieren Einladungen?",
    a: "Unter Konto findest du deinen Einladungslink. Wer darüber startet, testet länger – und du bekommst Guthaben, sobald die erste Zahlung eingeht.",
  },
];
