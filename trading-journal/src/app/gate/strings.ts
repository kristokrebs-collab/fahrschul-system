/** German copy of the entry gate (Konto-Pflicht, `src/cloud/gate.ts`). */
export const GATE = {
  word: "Trade Journal",
  lead: "Kostenlos starten – ein Konto, dein Journal auf allen Geräten.",
  signup: "Konto erstellen",
  pricingLink: "Preise ansehen",
  moreLabel: "Mehr",
  /** Shown when this browser already holds a local journal: nothing is lost, the first sign-in asks what to do with it. */
  localNote: "Dein Journal in diesem Browser bleibt erhalten. Nach der Anmeldung entscheidest du, ob es ins Konto übernommen wird.",
} as const;

/**
 * German copy of the landing page (`Landing.tsx`, Launch-Audit B3): what a first visit of the start page reads before any form. Only
 * statements the product keeps: no user counts, no promised results – the sample panel is labelled as a sample.
 */
export const LANDING = {
  eyebrow: "Trading-Journal",
  /** two lines, the second in the accent (the cut of the login window's band) */
  title: ["Hör auf zu raten.", "Fang an zu messen."] as const,
  lead: "Das Trade Journal zeigt dir, welche Setups Geld verdienen, welche Regeln du brichst – und was dich das kostet.",
  start: "Kostenlos starten",
  compare: "Tarife vergleichen",
  signin: "Anmelden",
  promise: "Free bleibt kostenlos, ohne Zeitlimit. Keine Karte nötig.",
  sample: {
    label: "Beispielansicht",
    title: "Letzte Trades",
    curve: "Beispiel: Ergebnis in R über fünf Trades, am Ende im Plus",
    rows: [
      { pair: "BTCUSDT", side: "Long", setup: "A+ Setup", r: 2.1 },
      { pair: "ETHUSDT", side: "Short", setup: "Ohne Plan", r: -1 },
      { pair: "SOLUSDT", side: "Long", setup: "A+ Setup", r: 1.8 },
      { pair: "BTCUSDT", side: "Short", setup: "FOMO", r: -1.3 },
      { pair: "ETHUSDT", side: "Long", setup: "A+ Setup", r: 2.5 },
    ] as const,
    verdictLabel: "Was das Journal daraus liest",
    verdict: [
      { name: "A+ Setup", r: 6.4 },
      { name: "Ohne Plan / FOMO", r: -2.3 },
    ] as const,
  },
  stepsTitle: "So arbeitest du damit",
  steps: [
    { no: "01", title: "Eintragen", text: "Jeder Trade landet im Journal: von Hand, per CSV-Import oder über die Anbindung deiner Börse." },
    { no: "02", title: "Auswerten", text: "Setups, Regeln, Tageszeiten: Du siehst schwarz auf weiß, was funktioniert und was dich Geld kostet." },
    { no: "03", title: "Dranbleiben", text: "Tagesplan, Berichte und Coach halten dich bei deinen eigenen Regeln – auch nach einem Verlust." },
  ] as const,
  plansEyebrow: "Tarife",
  plansTitle: "Wähle, womit du startest",
  plansLead: "Starte kostenlos und wechsle erst, wenn du mehr aus deinem Journal holen willst – jederzeit kündbar.",
  endTitle: "Der nächste Trade ist der erste Eintrag.",
  endText: "Konto anlegen, Trade eintragen, fertig. Dein Journal läuft auf allen Geräten.",
} as const;

/** `+2,1 R` / `−1,0 R` (German decimal comma, a real minus sign). */
export function formatR(r: number): string {
  return `${r < 0 ? "−" : "+"}${Math.abs(r).toFixed(1).replace(".", ",")} R`;
}

