import { storageKey } from "@/store/storage";

/** German copy of the cockpit (P13). */
export const COCKPIT_STRINGS = {
  title: "Cockpit",
  lead: "Dein Dashboard aus allen Seiten. Unter „Anordnen“ hältst du eine Karte gedrückt und ziehst sie an ihren Platz.",
  arrange: "Anordnen",
  done: "Fertig",
  addWidget: "Widget hinzufügen",
  boards: "Dashboards",
  newBoard: "Neues Dashboard",
  boardName: "Name des Dashboards",
  reset: "Zurücksetzen",
  deleteBoard: "Dashboard löschen",
  deleteHold: "Halten zum Löschen",
  narrower: "Schmaler",
  wider: "Breiter",
  remove: "Entfernen",
  grid: "Widgets",
  editHint: "Gedrückt halten und ziehen – oder Leertaste, Pfeiltasten, Leertaste.",
  empty: { title: "Noch keine Widgets", text: "Stell dir dein Cockpit zusammen – die stärksten Karten zuerst.", action: "Widget hinzufügen" },
  fresh: "NEU",
  freshLabel: "Neues Widget",
  catalog: { title: "Widget hinzufügen", filter: "Widgets filtern", add: "Hinzufügen", added: "Im Cockpit", none: "Kein Widget passt." },
  span: (n: number) => `${n}/12`,
} as const;

export const COCKPIT_LEAD_FILL = { storageKey: storageKey("fill-cockpit"), highlight: "gedrückt" } as const;
