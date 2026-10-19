/** German copy of the pricing page (P10). */
export const PREISE = {
  title: "Preise",
  lead: "Starte kostenlos. Upgrade, wenn dein Journal mehr können soll als du – jederzeit kündbar.",
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
  heroCta: (days: number) => (days > 0 ? "Pro testen" : "Pro holen"),
  plansTitle: "Tarife",
  interval: "Abrechnung",
  monthly: "Monatlich",
  yearly: "Jährlich",
  perMonth: "pro Monat",
  perSeatMonth: "pro Sitz und Monat",
  yearlyNote: (amount: string, months: number) =>
    months > 0 ? `${amount} jährlich · ${months} ${months === 1 ? "Monat" : "Monate"} gratis` : `${amount} jährlich`,
  monthlyNote: "monatlich abgerechnet",
  free: "0 €",
  freeNote: "für immer",
  recommended: "Beliebt",
  current: "Dein Tarif",
  /** the own column's pill on a phone (a 44-px column) */
  currentShort: "Du",
  ctaFree: "Kostenlos starten",
  ctaFreeSignedIn: "Im Free-Tarif",
  ctaTrial: (days: number) => (days > 0 ? `${days} Tage gratis testen` : "Abonnieren"),
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
  limitsGroup: "Limits",
  unlimited: "∞",
  included: "Enthalten",
  notIncluded: "Nicht enthalten",
  marqueeLabel: "Fakten zum Trade Journal",
  faqTitle: "Häufige Fragen",
  legalCancel: "Verträge hier kündigen",
  legalNoContract: "Es läuft gerade kein Vertrag.",
  legalNote: "Preise in Euro. Zahlung und Rechnungen über Stripe. Es gelten die Dokumente des Betreibers:",
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
    q: "Wie funktionieren Einladungen?",
    a: "Unter Konto findest du deinen Einladungslink. Wer darüber startet, testet länger – und du bekommst Guthaben, sobald die erste Zahlung eingeht.",
  },
];
