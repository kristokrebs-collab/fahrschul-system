/**
 * Die Navigation in Worten (Etappe 1a): vier Gruppen nach dem, was man gerade tut, und zu jeder Seite ein Anfänger-Wort
 * („Deine Einträge“ statt nur „Trades“). Gelesen von der Seitenleiste (md+), dem Menü hinter „Mehr“ (Befehlsnavigation), dem
 * Tooltip der schmalen Leiste und dem Funktionsfinder. Die Reihenfolge und die Zuordnung stehen in `@/store/uiStore`
 * (`NAV_GROUP_PAGES`); hier nur Texte – ein Modul der Erstladung, ohne Abhängigkeit zu Seiten oder zum Register.
 *
 * Warum diese Zuordnung (ein Satz je Gruppe, die Begründung ausführlicher in `src/app/README.md`):
 *   - Erfassen: Dinge, die man VOR und BEIM Handeln festhält – Trades, Handelsplan, Entscheidungsgrundlagen (die Regeln).
 *   - Prüfen: den Stand ansehen und gegenprüfen – Übersicht, Markt, Aktien, Risiko.
 *   - Auswerten: NACH dem Handeln lernen und Ideen testen – Analyse, Berichte, Coach, Wachstum, Cockpit, Labor, Strategie-Studio.
 *   - Konto & Rechtliches: alles um dich und die App – Einstellungen, Konto, Community, Preise, Funktionen, Impressum.
 */
import type { IconName } from "@/primitives/icons";
import { NAV_GROUP_IDS, NAV_GROUP_PAGES, type NavGroupId, type Page } from "@/store/uiStore";

/** The primary action's name (bottom bar centre, sidebar, header, editor title). */
export const FAB_LABEL = "Trade eintragen";
/** Page names (Bundle `Dhe` + the feature pages, P14). */
export const PAGE_LABELS: Record<Page, string> = {
  overview: "Übersicht",
  trades: "Trades",
  setups: "Entscheidungsgrundlagen",
  settings: "Einstellungen",
  markt: "Markt",
  analyse: "Analyse",
  risiko: "Risiko",
  coach: "Coach",
  berichte: "Berichte",
  labor: "Labor",
  wachstum: "Wachstum",
  community: "Community",
  cockpit: "Cockpit",
  konto: "Konto",
  preise: "Preise",
  funktionen: "Funktionen",
  studio: "Strategie-Studio",
  plan: "Handelsplan",
  aktien: "Aktien",
};
export const PAGE_ICON: Record<Page, IconName> = {
  overview: "grid",
  trades: "list",
  setups: "target",
  settings: "sliders",
  markt: "candles",
  analyse: "chart",
  risiko: "shield",
  coach: "coach",
  berichte: "report",
  labor: "flask",
  wachstum: "sprout",
  community: "users",
  cockpit: "gauge",
  konto: "user",
  preise: "tag",
  funktionen: "compass",
  studio: "pen",
  plan: "route",
  aktien: "stocks",
};


/** Wide screens (md): the sidebar is the navigation. Below it the bottom bar („Übersicht, Trades, + Trade, Markt, Mehr“) is. The two never exist together. */
export const WIDE_QUERY = "(min-width: 768px)";

export const NAV_GROUP_LABELS: Record<NavGroupId, string> = {
  erfassen: "Erfassen",
  pruefen: "Prüfen",
  auswerten: "Auswerten",
  konto: "Konto & Rechtliches",
};

/** Eine Zeile in einfachen Worten: wofür die Gruppe da ist. */
export const NAV_GROUP_HINTS: Record<NavGroupId, string> = {
  erfassen: "Trades eintragen und vorbereiten",
  pruefen: "Lage und Markt ansehen, Risiko prüfen",
  auswerten: "Aus deinen Trades lernen, Ideen testen",
  konto: "App, Konto, Hilfe und Impressum",
};

/** Das Anfänger-Wort zu jeder Seite: was man dort TUT oder sieht, in drei bis vier Worten. */
export const PAGE_HINT: Record<Page, string> = {
  trades: "Deine Einträge",
  plan: "Vor dem Trade planen",
  setups: "Deine Regeln",
  overview: "Heute im Blick",
  markt: "Kurse und Signale",
  aktien: "Aktien-Scanner und News",
  risiko: "Wie viel einsetzen?",
  analyse: "Was funktioniert?",
  berichte: "Woche und Monat",
  coach: "Rückmeldung zu dir",
  wachstum: "Disziplin und Routinen",
  cockpit: "Dein eigenes Dashboard",
  labor: "Strategien testen",
  studio: "Strategie in Worten",
  settings: "App einstellen",
  konto: "Login und Sync",
  community: "Gruppen und Rangliste",
  preise: "Pläne und Preise",
  funktionen: "Alles, was die App kann",
};

/** Die Gruppe einer Seite (jede Seite steht in genau einer). */
export function groupOfPage(page: Page): NavGroupId {
  return NAV_GROUP_IDS.find((g) => NAV_GROUP_PAGES[g].includes(page)) ?? "pruefen";
}

/** Die Gruppen mit ihren Seiten, in der Reihenfolge der Navigation. */
export const NAV_GROUPS: readonly { id: NavGroupId; label: string; hint: string; pages: readonly Page[] }[] = NAV_GROUP_IDS.map((id) => ({
  id,
  label: NAV_GROUP_LABELS[id],
  hint: NAV_GROUP_HINTS[id],
  pages: NAV_GROUP_PAGES[id],
}));

/** Symbol der Gruppe (Titel der schmalen Leiste). */
export const NAV_GROUP_ICON: Record<NavGroupId, IconName> = {
  erfassen: "pen",
  pruefen: "candles",
  auswerten: "chart",
  konto: "user",
};
