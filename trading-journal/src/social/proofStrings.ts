/** German copy of the Ergebnisbeleg (F57): the builder sheet and the public page. Calm sentences, numbers from the list. */
import type { OriginKind } from "./metrics";

export const PROOF = {
  // entry point (Community › Deine Links)
  create: "Ergebnisbeleg erstellen",
  createHint: "Eine Seite mit der vollständigen Historie eines Zeitraums – freiwillig, ohne Euro-Beträge, jederzeit zurückziehbar.",

  // builder sheet
  sheetTitle: "Ergebnisbeleg",
  lead: "Die Seite zeigt jeden geschlossenen Trade des Zeitraums, in R, mit Kosten und Herkunft der Datensätze. Alle Zahlen darauf rechnet der Leser aus dieser Liste.",
  strategy: "Strategie",
  strategyPlaceholder: "z. B. Breakout 4h",
  strategyHint: "Dein Name dafür. Er steht als deine Angabe auf der Seite.",
  basis: "Womit wurde gehandelt?",
  basisHint: "Das kann die App nicht prüfen – es steht als deine Angabe auf der Seite.",
  period: "Zeitraum",
  from: "Von",
  to: "Bis",
  presets: [
    { v: "30", label: "30 Tage" },
    { v: "90", label: "90 Tage" },
    { v: "180", label: "180 Tage" },
    { v: "365", label: "1 Jahr" },
    { v: "all", label: "Alles" },
  ] as const,
  scope: "Welche Trades?",
  scopeAll: "Alle",
  scopeSetup: "Eine Grundlage",
  scopeHint: "Bei „Eine Grundlage“ steht auf der Seite, wie viele Trades der Zeitraum insgesamt hat – Auswahl und Rest sind sichtbar.",
  pickSetup: "Grundlage",
  prev: "Fortschreibung von",
  prevNone: "Neuer Beleg",
  prevHint: "Wer beide Seiten liest, sieht, ob seit der früheren Fassung ein Trade fehlt.",
  preview: "Das steht auf der Seite",
  never: "Nie dabei: Euro-Beträge, Kontogröße, Börse, Märkte, Uhrzeiten, Notizen, dein Name.",
  consent: "Mit dem Link darf jede Person, die ihn hat, diese Liste sehen. Du kannst ihn jederzeit zurückziehen.",
  expiry: "Gültig",
  createLink: "Beleg-Link erstellen",
  copy: "Link kopieren",
  rows: {
    trades: "Trades in der Liste",
    scored: "davon mit R",
    sum: "Summe",
    drawdown: "Drawdown",
    costs: "Kosten bekannt",
    origin: "Daten",
  },
  needsCloud: "Ein Beleg-Link braucht ein Konto in der Cloud.",
  needsLogin: "Für einen Link bitte anmelden.",
  errors: {
    strategy: "Gib deiner Strategie einen Namen.",
    range: "Der Zeitraum ist nicht gültig (höchstens 400 Tage, Beginn vor Ende).",
    empty: "In diesem Zeitraum gibt es keine geschlossenen Trades – die Liste wäre leer.",
    tooMany: (n: number, max: number) => `Der Zeitraum hat ${n} Trades; ein Beleg fasst höchstens ${max}. Wähle einen kürzeren Zeitraum – es wird nie still gekürzt.`,
  },
  noTrades: "Noch keine geschlossenen Trades im Journal.",
  linkTitle: (strategy: string, n: number) => `Beleg · ${strategy} · ${n} ${n === 1 ? "Trade" : "Trades"}`,
} as const;

export const BASIS_FULL = { live: "Echtgeld", demo: "Demo- / Papierkonto", sim: "Nachgestellt" } as const;

/** Where the records came from, one phrase per class (the page counts them). */
export const ORIGIN_PHRASE: Readonly<Record<OriginKind, string>> = {
  api: "über die lesende Börsen-Schnittstelle",
  csv: "per Datei-Import (CSV)",
  manual: "von Hand eingetragen",
  auto: "von einem Bot oder per Webhook",
};

export const PROOF_PAGE = {
  title: "Ergebnisbeleg",
  lead: "Die vollständige Liste eines Zeitraums, in R und ohne Euro-Beträge – eine Selbstangabe.",
  kicker: "Selbstangabe · nicht geprüft",
  stand: (d: string) => `Stand ${d}`,
  period: (a: string, b: string) => `Zeitraum ${a} – ${b}`,
  basisLabel: "Art der Ergebnisse",
  strategy: "Strategie",

  facts: "Kennzahlen",
  trades: "Trades",
  tradesSub: (scored: number, noR: number) => (noR ? `${scored} mit R · ${noR} ohne R` : `${scored} mit R`),
  sum: "Summe",
  expectancy: "Ø pro Trade",
  winRate: "Trefferquote",
  winRateSub: (w: number, l: number, f: number) => `${w} Gewinn · ${l} Verlust${f ? ` · ${f} ±0` : ""}`,
  drawdown: "Drawdown",
  drawdownSub: "größter Rückgang der R-Summe",
  streak: "Längste Verlustserie",
  streakSub: "Trades in Folge",
  best: "Bester Trade",
  worst: "Schlechtester Trade",
  withoutBest: "Summe ohne den besten Trade",
  profitFactor: "Gewinnfaktor",
  sample: (n: number, min: number) => `Nur ${n} Trades mit R – unter ${min} sagt jede Kennzahl wenig. Sie beschreibt diese Liste, sagt aber nichts über die Zukunft.`,

  curve: "R-Kurve",
  curveLabel: (n: number, sum: string, dd: string) => `Laufende R-Summe über ${n} Trades, am Ende ${sum}, größter Rückgang ${dd}.`,
  curveEmpty: "Keine Trades mit R – keine Kurve.",
  drawdownMark: "größter Rückgang",

  complete: "Vollständigkeit",
  completeAll: (n: number) => `Alle ${n} geschlossenen Trades des Zeitraums sind in der Liste – Gewinne, Verluste und Trades ohne R.`,
  completeOnly: (name: string, n: number, all: number) => `Auswahl: nur die Grundlage „${name}“ – ${n} von ${all} geschlossenen Trades des Zeitraums. Die übrigen ${all - n} stehen nicht in dieser Liste.`,
  open: (n: number) => (n === 0 ? "Zum Stand war keine Position offen." : `Zum Stand ${n === 1 ? "war 1 Position" : `waren ${n} Positionen`} noch offen – sie stehen erst nach dem Schließen in einem Beleg.`),
  later: "Trades nach dem Stand fehlen in dieser Fassung. Eine neuere Fassung kann existieren; diese Seite weiß davon nichts.",

  origin: "Herkunft der Datensätze",
  originLine: (k: number, n: number, phrase: string) => `${k} von ${n} ${phrase}`,
  originLevel: {
    api: "Überwiegend über die Börsen-Schnittstelle gelesen: Das belegt, woher die Datensätze stammen – nicht, dass es alle Konten oder das gesamte Vermögen der Person sind.",
    csv: "Überwiegend aus einer Datei importiert: Die Datei stammt von der Person selbst.",
    manual: "Überwiegend von Hand eingetragen: Das ist die Angabe der Person selbst.",
    auto: "Überwiegend von einem Bot oder per Webhook erfasst.",
    mixed: "Gemischte Herkunft: Kein Weg der Erfassung macht 80 % der Trades aus.",
  },

  costs: "Kosten",
  costsKnown: (known: number, n: number) => `Gebühren und Funding sind für ${known} von ${n} Trades erfasst.`,
  costsSum: (sum: string, avg: string) => `Zusammen ${sum}, im Schnitt ${avg} je Trade – in R, bereits in den R-Werten enthalten.`,
  costsUnknown: (u: number) => `Bei ${u} ${u === 1 ? "Trade" : "Trades"} sind die Kosten nicht bekannt (Gewinn von Hand eingetragen oder ohne Gebührenangabe). Ob sie dort in R enthalten sind, weiß die App nicht.`,
  costsNone: "Für keinen Trade sind Kosten erfasst.",

  history: "Alle Trades",
  historyHint: "Vollständig und in zeitlicher Reihenfolge – so wie sie das Journal zum Stand enthielt.",
  col: { n: "Nr.", day: "Tag", r: "R", cost: "Kosten (R)", origin: "Herkunft" },
  noR: "kein R",
  unknown: "–",
  historyLabel: "Liste aller Trades des Belegs",

  prevTitle: "Fortschreibung",
  prevLoading: "Frühere Fassung wird geprüft …",
  prevGone: "Die frühere Fassung ist nicht mehr abrufbar (zurückgezogen oder abgelaufen). Ob seither etwas fehlt, lässt sich nicht prüfen.",
  prevIntact: (kept: number, added: number, when: string) => `Alle ${kept} Trades der früheren Fassung vom ${when} sind enthalten${added ? `; ${added} ${added === 1 ? "ist" : "sind"} neu dazugekommen` : ""}.`,
  prevMissing: (n: number, when: string) => `${n} ${n === 1 ? "Trade" : "Trades"} der früheren Fassung vom ${when} ${n === 1 ? "fehlt" : "fehlen"} in dieser Fassung.`,
  prevMissingRow: (day: string, r: string) => `${day} · ${r}`,
  prevOutside: (n: number) => `${n} ${n === 1 ? "Trade" : "Trades"} liegen vor dem Beginn dieses Zeitraums.`,
  prevEndsEarlier: "Dieser Zeitraum endet früher als der der früheren Fassung.",
  prevNarrowed: "Die frühere Fassung zeigte alle Trades, diese nur eine Grundlage.",
  prevOpen: "Frühere Fassung ansehen",

  limits: "Was dieser Beleg nicht zeigt",
  limitsList: [
    "Er ist die Selbstangabe der Person. Weder die App noch ein Dritter hat ihn geprüft.",
    "Er sagt nichts über Kontogröße, Hebel, Einzahlungen oder weitere Konten – die Werte sind in R, nicht in Euro oder Prozent des Kontos.",
    "Ein Beleg ist ein Stand. Wer nur einen günstigen Zeitraum veröffentlicht, zeigt weniger, als passiert ist – der Zeitraum steht deshalb oben.",
    "Vergangene Ergebnisse sind keine Prognose.",
  ] as const,
  report: "Melden",
  openApp: "Zum eigenen Journal",
  views: (n: number) => `${n}× angesehen`,
  until: (d: string) => `gültig bis ${d}`,
  loadingPrev: "Lade …",
} as const;
