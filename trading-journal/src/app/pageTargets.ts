/**
 * Pages as search targets (A4): the finder does not only know FUNCTIONS (`features.ts`), it knows the 19 PAGES as well, so
 * "Einstellungen" leads to the page Einstellungen and not only to the card "Box-Einstellungen & Box-Alarme". A page is
 * scored by the very same scorer as a function (`scoreFeature`): each page becomes a synthetic register entry with the id
 * `page:<page>`, its label as name, the plain-word hint as task and the everyday words people say for it as intents.
 *
 * The words here are page-level words ("Anmelden", "Tarife", "Optionen"); what somebody does ON a page ("Wochenbericht",
 * "Positionsgröße") stays with the functions – so a function never loses its place to its own page.
 *
 * Pure: no store, no DOM. Lives in the lazy search chunk next to `featureQuery.ts` (the first load does not import it).
 */
import { PAGE_HINT, PAGE_LABELS } from "@/app/navGroups";
import type { FeatureEntry, FeatureGroupId } from "@/app/features";
import { PAGES, type Page } from "@/store/uiStore";

/** Id prefix of a page target (`page:settings`); a function id never contains a colon. */
export const PAGE_TARGET_PREFIX = "page:";
export const pageTargetId = (page: Page): string => `${PAGE_TARGET_PREFIX}${page}`;
export const isPageTargetId = (id: string): boolean => id.startsWith(PAGE_TARGET_PREFIX);
/** The page of a `page:<page>` id, or `null` for anything else (including an unknown page). */
export function pageOfTargetId(id: string): Page | null {
  if (!isPageTargetId(id)) return null;
  const p = id.slice(PAGE_TARGET_PREFIX.length);
  return (PAGES as readonly string[]).includes(p) ? (p as Page) : null;
}

/** The words people say for a page, in their own language (page level only). */
export const PAGE_WORDS: Record<Page, readonly string[]> = {
  overview: ["start", "startseite", "home", "dashboard", "heute im blick", "hauptseite", "zur übersicht", "zurück zum start"],
  trades: ["meine trades", "alle trades", "einträge", "meine einträge", "trade liste", "journal", "historie", "was habe ich gehandelt"],
  setups: ["meine regeln", "regeln", "setups", "strategien", "grundlagen", "playbook", "entscheidungen"],
  settings: ["optionen", "konfiguration", "einstellen", "einstellung", "app einstellen", "anpassen", "einstellungen öffnen", "app anpassen", "voreinstellungen"],
  markt: ["kurse", "live kurse", "marktseite", "signale", "wie steht der markt", "chart ansehen"],
  analyse: ["statistik", "kennzahlen ansehen", "was funktioniert", "meine zahlen", "auswertungsseite"],
  risiko: ["risikoseite", "limits", "risk", "risiko prüfen"],
  coach: ["rückmeldung", "feedback", "tipps", "hilfe vom coach", "was kann ich besser machen"],
  berichte: ["report", "berichte lesen", "berichte ansehen", "woche und monat", "rückblick"],
  labor: ["strategien testen", "backtests", "testlabor", "ideen testen", "versuche"],
  wachstum: ["disziplin", "routinen", "fortschritt", "besser werden", "gewohnheiten und ziele"],
  community: ["gruppen", "andere trader", "austausch", "rangliste", "mit anderen"],
  cockpit: ["eigenes dashboard", "widgets", "meine ansicht", "dashboard bauen", "übersicht anpassen"],
  konto: ["anmelden", "melde mich an", "wie melde ich mich an", "einloggen", "login", "registrieren", "mein konto", "profil", "abmelden", "passwort", "cloud", "synchronisieren", "geräte verbinden"],
  preise: ["tarife", "was kostet", "kosten", "abo", "abonnement", "pläne", "upgrade", "bezahlen", "kaufen", "pro", "premium"],
  funktionen: ["alle funktionen", "was kann die app", "hilfe", "index", "verzeichnis", "wo finde ich", "übersicht der funktionen"],
  studio: ["strategie schreiben", "strategie in worten", "regeln aus text", "strategie-studio"],
  plan: ["trade planen", "plan erstellen", "handelsplan", "vor dem trade", "ausstieg planen"],
  aktien: ["aktien", "aktien suchen", "aktienmarkt", "nachrichten zu aktien", "aktien scanner", "börse aktien"],
};

/** Page → the group id a synthetic entry carries (the register type needs one; the scorer ignores it for pages). */
const GROUP: Record<Page, FeatureGroupId> = {
  overview: "heute",
  trades: "daten",
  setups: "risiko",
  settings: "konto",
  markt: "heute",
  analyse: "auswerten",
  risiko: "risiko",
  coach: "lernen",
  berichte: "auswerten",
  labor: "testen",
  wachstum: "wachsen",
  community: "community",
  cockpit: "auswerten",
  konto: "konto",
  preise: "konto",
  funktionen: "konto",
  studio: "testen",
  plan: "planen",
  aktien: "aktien",
};

let cache: FeatureEntry[] | null = null;

/** The 19 pages as synthetic register entries (stable objects: the scorer caches its word list per entry). */
export function pageTargets(): readonly FeatureEntry[] {
  cache ??= PAGES.map(
    (page): FeatureEntry => ({
      id: pageTargetId(page),
      fids: [],
      name: PAGE_LABELS[page],
      task: PAGE_HINT[page],
      benefit: PAGE_HINT[page],
      group: GROUP[page],
      page,
      keywords: [],
      intents: PAGE_WORDS[page],
      status: "fertig",
    }),
  );
  return cache;
}
