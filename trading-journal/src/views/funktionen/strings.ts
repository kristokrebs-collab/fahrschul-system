/** German copy of the page "Funktionen" (the register's own texts live in `src/app/features.ts`). */
import type { FeatureStatus, PlanTier } from "@/app/features";
import type { PickReason } from "@/app/featureQuery";

export const FUNKTIONEN = {
  title: "Funktionen",
  lead: "Sag, was du tun willst – wir zeigen dir, wo es steht. Alles, was die App kann, nach Aufgabe geordnet, mit ehrlichem Stand.",
  highlight: "wo es steht",
  unit: (n: number) => (n === 1 ? "Funktion" : "Funktionen"),
  search: {
    label: "Was willst du tun?",
    placeholder: "z. B. Strategie testen, Wochenbericht, Risiko berechnen",
    hint: "Enter öffnet den ersten Treffer.",
    clear: "Suche leeren",
  },
  results: {
    some: (n: number) => (n === 1 ? "1 Treffer" : `${n} Treffer`),
    weak: (n: number) => (n === 1 ? "Nichts passt genau – 1 Vorschlag" : `Nichts passt genau – ${n} Vorschläge`),
    more: (n: number) => `Die ersten ${n} von ${n + 1} und mehr – schreib genauer, um enger zu suchen.`,
  },
  tiles: {
    title: "Aufgaben",
    note: "Wähle, was du tun willst.",
    count: (n: number) => (n === 1 ? "1 Funktion" : `${n} Funktionen`),
    partial: (k: number) => (k === 1 ? "1 teilweise" : `${k} teilweise`),
    allDone: "alle fertig",
    open: (name: string) => `${name}: Funktionen anzeigen`,
  },
  group: {
    back: "Alle Aufgaben",
    backLabel: "Zurück zu allen Aufgaben",
  },
  status: {
    fertig: "Fertig",
    teilweise: "Teilweise",
  } satisfies Record<FeatureStatus, string>,
  statusTitle: {
    fertig: "Die Funktion tut, was der Satz sagt.",
    teilweise: "Ein Teil fehlt – die Details sagen, welcher.",
  } satisfies Record<FeatureStatus, string>,
  tier: {
    frei: "Frei",
    pro: "Ab Pro",
    premium: "Ab Premium",
    team: "Ab Team",
  } satisfies Record<PlanTier, string>,
  locked: "nicht in deinem Tarif",
  isNew: "Neu",
  tag: {
    "fuer-dich": "Für dich",
    neu: "Neu",
    tipp: "Empfohlen",
  } satisfies Record<PickReason, string>,
  open: (name: string) => `${name} öffnen`,
  details: (name: string) => `Details zu ${name}`,
  detailsOpen: "Mehr",
  detailsClose: "Weniger",
  benefit: "Was es tut",
  way: "So geht’s",
  missing: "Fehlt noch",
  limit: "Zu wissen",
  needs: "Voraussetzung",
  device: "Gerät",
  see: "Siehe auch",
  fids: "Bauplan",
  where: "Zu finden",
  recent: {
    title: "Zuletzt benutzt",
    note: "Über diese Seite, die Suche oder den Assistenten geöffnet – nur in diesem Browser.",
  },
  picks: {
    title: "Empfohlen",
    note: "Passend zu deinen Fragen, neu dazugekommen und zum Einstieg.",
  },
  empty: {
    title: "Dazu steht nichts in der Liste",
    text: "Anders schreiben hilft meist: ein Wort der Aufgabe („testen“, „Bericht“, „Risiko“) genügt. Oder frag den Assistenten – er kennt die Liste.",
    reset: "Zurück zu den Aufgaben",
    assistant: "Assistenten fragen",
  },
  stand: "Stand der Funktionen nach dem Code, nicht nach dem Wunsch: „Teilweise“ nennt, was noch fehlt. Keine professionelle Finanzberatung.",
} as const;
