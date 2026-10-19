/** German copy of the page "Funktionen" (the register's own texts live in `src/app/features.ts`). */
import type { FeatureStatus, PlanTier } from "@/app/features";

export const FUNKTIONEN = {
  title: "Funktionen",
  lead: "Alles, was die App kann – nach Aufgabe geordnet, mit ehrlichem Stand. Suchen, filtern, direkt öffnen.",
  highlight: "direkt öffnen",
  unit: (n: number) => (n === 1 ? "Funktion" : "Funktionen"),
  search: {
    label: "Funktionen durchsuchen",
    placeholder: "Suchen: Labor, Alarm, Import, Backup …",
    hint: "Enter öffnet den ersten Treffer.",
  },
  filters: {
    status: "Stand",
    tier: "Tarif",
    all: "Alle",
  },
  status: {
    fertig: "Fertig",
    teilweise: "Teilweise",
  } satisfies Record<FeatureStatus, string>,
  statusTitle: {
    fertig: "Die Funktion tut, was der Satz sagt.",
    teilweise: "Ein Teil fehlt – die Karte sagt, welcher.",
  } satisfies Record<FeatureStatus, string>,
  tier: {
    frei: "Frei",
    pro: "Ab Pro",
    premium: "Ab Premium",
    team: "Ab Team",
  } satisfies Record<PlanTier, string>,
  tierFilter: {
    frei: "Frei",
    pro: "Pro",
    premium: "Premium",
    team: "Team",
  } satisfies Record<PlanTier, string>,
  locked: "nicht in deinem Tarif",
  open: "Öffnen",
  openLabel: (name: string) => `${name} öffnen`,
  way: "So geht’s",
  missing: "Fehlt noch",
  limit: "Zu wissen",
  needs: "Voraussetzung",
  device: "Gerät",
  fids: "Bauplan",
  results: (n: number, total: number) => (n === total ? `${total} Funktionen` : `${n} von ${total} Funktionen`),
  empty: {
    title: "Nichts gefunden",
    text: "Anders schreiben, weniger Wörter oder einen Filter lösen – die Suche verzeiht Tippfehler.",
    reset: "Filter zurücksetzen",
  },
  forYou: {
    title: "Für dich",
    note: "Nach dem, was du den Assistenten fragst.",
    empty:
      "Noch nichts gelernt. Sobald du dem Assistenten Fragen stellst – zum Labor, zu deinem Einstieg, zu deinen Fehlern –, stehen hier die passenden Funktionen. Gezählt wird nur, wie oft du nach einem Thema fragst; die Fragen selbst werden nicht gespeichert.",
  },
  recent: {
    title: "Zuletzt benutzt",
    note: "Über diese Seite, die Suche oder den Assistenten geöffnet.",
    empty: "Noch nichts geöffnet. Was du hier, in der Suche oder über den Assistenten öffnest, merkt sich dieser Browser – es wird nichts gesendet.",
  },
  stand: "Stand der Funktionen nach dem Code, nicht nach dem Wunsch: „Teilweise“ nennt, was noch fehlt.",
} as const;
