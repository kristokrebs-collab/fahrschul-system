/** German copy of the billing UI (P10). Short, natural sentences; no anglicisms where a German word fits. */
import type { CancelReason } from "./contract";

export const BILLING = {
  offNoCloud: "In dieser Version gibt es keine Abos – alle Funktionen sind freigeschaltet.",
  closedTitle: "Zahlungen noch nicht eingerichtet",
  closedText: "Der Betreiber hat Stripe noch nicht verbunden. Bis dahin sind alle Funktionen freigeschaltet.",
  functionsMissing: "Die Server-Funktionen sind auf dieser Seite nicht eingerichtet. Bis dahin sind alle Funktionen freigeschaltet.",
  signInFirst: "Melde dich an, um ein Abo abzuschließen.",
  redirecting: "Weiter zu Stripe …",
  checkoutCanceled: "Checkout abgebrochen – es wurde nichts berechnet.",
  portalBack: "Zurück aus dem Kundenportal",
  portalBackDetail: "Dein Abo ist auf dem neuesten Stand.",
  alreadySubscribed: "Du hast schon ein Abo – im Kundenportal kannst du den Tarif wechseln.",
  loadFailed: "Abo-Daten konnten nicht geladen werden.",
  trialDays: (d: number) => `${d} Tage gratis testen`,
  trialNoCard: "ohne Karte",
} as const;

export const PLAN_CARD = {
  title: "Abo",
  freeLine: "Kostenlos – ohne Laufzeit.",
  upgrade: "Tarife ansehen",
  manage: "Abo verwalten",
  change: "Tarif wechseln",
  cancel: "Vertrag hier kündigen",
  resume: "Kündigung zurücknehmen",
  unpause: "Abo fortsetzen",
  pay: "Zahlung aktualisieren",
  trialLeft: "Tage Testphase",
  seats: (used: number, seats: number) => `${used} von ${seats} Sitzen belegt`,
  perPeriod: { month: "pro Monat", year: "pro Jahr" },
  usage: "Dein Tarif",
} as const;

export const BILLING_CARD = {
  title: "Rechnungen",
  empty: "Noch keine Rechnungen.",
  noCustomerTitle: "Noch keine Rechnungen",
  noCustomer: "Rechnungen erscheinen hier, sobald du ein Abo hast.",
  /** a seat of a team plan (Premium through the group's team, no own subscription) – never "sobald du ein Abo hast" */
  seatTitle: "Keine eigenen Rechnungen",
  seat: "Dein Tarif läuft über das Team deiner Gruppe – die Rechnungen bekommt der Inhaber.",
  open: "Ansehen",
  pdf: "PDF",
  paymentMethod: "Zahlungsmittel ändern",
  all: "Alle Rechnungen im Kundenportal",
  status: { paid: "Bezahlt", open: "Offen", void: "Storniert", uncollectible: "Uneinbringlich" } as Record<string, string>,
  note: "Rechnungen und Zahlungen verwaltet Stripe. Deine Kartendaten sehen wir nie.",
} as const;

export const REFERRAL = {
  title: "Freunde einladen",
  lead: (days: number) => `Wer über deinen Link kommt, testet ${days} statt 14 Tage.`,
  reward: (amount: string) => `Du bekommst ${amount} Guthaben, sobald die erste Zahlung eingeht.`,
  commission: (pct: number) => `Du bekommst ${pct.toLocaleString("de-DE")} % Provision auf jede Zahlung im ersten Jahr.`,
  copy: "Link kopieren",
  copied: "Kopiert",
  copyFailed: "Kopieren nicht möglich – markiere den Link von Hand.",
  signups: "Eingeladen",
  paying: "Zahlend",
  earned: "Guthaben",
  pending: "ausstehend",
  ledgerKind: { credit: "Gutschrift", commission: "Provision", reversal: "Storno" } as Record<string, string>,
  signIn: "Melde dich an, um deinen Einladungslink zu bekommen.",
} as const;

export const UPGRADE = {
  title: "Freischalten",
  inPlan: (plan: string) => `Enthalten in ${plan}`,
  gained: "Das bekommst du dazu",
  cta: (days: number) => (days > 0 ? `${days} Tage gratis testen` : "Jetzt abonnieren"),
  ctaSignIn: "Anmelden und testen",
  compare: "Alle Tarife vergleichen",
  teaserCta: "Freischalten",
  teaserLine: (plan: string) => `Ab ${plan}`,
  limitReached: "Limit erreicht",
  more: (plan: string) => `Mehr mit ${plan}`,
  closedNote: "Zahlungen sind noch nicht eingerichtet.",
} as const;

export const CANCEL = {
  title: "Abo kündigen",
  stepReason: "Schade, dass du gehst. Was ist der Grund?",
  reasonOptional: "Freiwillig – hilft uns, besser zu werden.",
  comment: "Möchtest du noch etwas sagen?",
  commentPlaceholder: "Optional",
  next: "Weiter zur Kündigung",
  stepOffer: "Bevor du gehst",
  offerPause: "1 Monat pausieren",
  offerPauseText: "Keine Zahlung, deine Daten bleiben. Danach läuft das Abo weiter.",
  offerDowngrade: "Zu Pro wechseln",
  offerDowngradeText: "Behalte das Wichtigste für weniger Geld.",
  stepConfirm: "Kündigung bestätigen",
  confirmText: (date: string) => (date ? `Dein Abo endet am ${date}. Bis dahin bleibt alles freigeschaltet.` : "Dein Abo endet zum Ende der Laufzeit."),
  confirmData: "Dein Journal bleibt erhalten – lokal und in der Cloud.",
  confirm: "Jetzt kündigen",
  viaPortal: "Lieber im Stripe-Kundenportal kündigen",
  done: "Gekündigt",
  doneText: (date: string) => (date ? `Dein Abo läuft bis ${date} und verlängert sich nicht.` : "Dein Abo verlängert sich nicht."),
  undo: "Kündigung zurücknehmen",
  close: "Fertig",
  back: "Zurück",
  paused: (date: string) => `Pausiert bis ${date}.`,
} as const;

export const CANCEL_REASON_LABEL: Readonly<Record<CancelReason, string>> = {
  too_expensive: "Zu teuer",
  missing_features: "Mir fehlt etwas",
  unused: "Nutze es kaum",
  switched_service: "Anderes Tool",
  too_complex: "Zu kompliziert",
  low_quality: "Funktioniert nicht gut",
  customer_service: "Support",
  other: "Anderer Grund",
};

export const BANNER = {
  pastDue: "Die letzte Zahlung ist fehlgeschlagen. Aktualisiere dein Zahlungsmittel, damit dein Abo weiterläuft.",
  trialEnds: (d: number) => (d <= 0 ? "Deine Testphase endet heute." : `Deine Testphase endet in ${d} ${d === 1 ? "Tag" : "Tagen"}.`),
  trialNoCard: "Hinterlege ein Zahlungsmittel, sonst endet das Abo danach.",
  paused: (date: string) => `Dein Abo ist pausiert bis ${date}.`,
  addCard: "Zahlungsmittel hinterlegen",
  dismiss: "Ausblenden",
} as const;

export const RETURN = {
  label: "Abo gestartet",
  confirming: "Zahlung wird bestätigt …",
  welcome: (plan: string) => `Willkommen bei ${plan}`,
  trialUntil: (date: string) => `Deine Testphase läuft bis ${date}.`,
  active: "Alles freigeschaltet. Viel Erfolg beim Traden.",
  slow: "Stripe braucht einen Moment. Dein Tarif erscheint gleich unter Konto.",
  go: "Los geht’s",
} as const;
