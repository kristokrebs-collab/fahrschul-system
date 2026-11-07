/**
 * "Siehe auch" between functions that belong together but sit on different pages (Handelsplan ↔ Zeitmaschine ↔ Verwaltung,
 * Squeeze ↔ Datenarchiv, Aktien ↔ Handelsplan, Bericht ↔ Beleg …). One quiet row of at most three links under a card, never a
 * list of everything: only where the next step is really needed. The pages place `<SeeAlso at="plan.exit" />` (`FeatureLinks.tsx`);
 * the links open the register entry (`featureOpen.ts`: page, scroll to the card, sweep once).
 *
 * This table is plain data and imports nothing of the register (it stays out of the first load). `tests/unit/seeAlso.test.ts`
 * holds it to the register: every target exists, is in the register's own "Siehe auch" of the host (or the other way round),
 * every key is placed on a page, and no row is longer than three links.
 */
export interface SeeAlsoLink {
  /** register id (`src/app/features.ts`) */
  id: string;
  /** short, in the words of the card ("Handelsplan", not "Handelsplan: Einstieg") */
  label: string;
}

export interface SeeAlsoRow {
  /** the register function whose card carries the row (its own `see` or the target's must name the other) */
  from: string;
  links: readonly SeeAlsoLink[];
}

export const SEE_ALSO = {
  // Handelsplan: find candidates first, then manage the position after the entry
  "plan.page": { from: "handelsplan-einstieg", links: [{ id: "beste-setups", label: "Beste Setups (Krypto)" }, { id: "aktien-scanner", label: "Aktien-Scanner" }] },
  "plan.exit": { from: "verwaltung-planen", links: [{ id: "positionsverwaltung", label: "Verwaltung testen" }, { id: "verwaltung-vergleich", label: "Verwaltung vergleichen" }] },
  // Aktien: plan the trade, or look at the crypto scanner
  "aktien.page": { from: "aktien-scanner", links: [{ id: "handelsplan-einstieg", label: "Handelsplan" }, { id: "scanner", label: "Chancen-Scanner (Krypto)" }] },
  // Markt: the day, then the single trade (the squeeze card already points to its archive where it is empty)
  "markt.plan": { from: "tagesplan", links: [{ id: "handelsplan-einstieg", label: "Handelsplan für einen Trade" }] },
  // Einstellungen: what the archive is for
  "settings.archive": { from: "datenarchiv", links: [{ id: "squeeze-beobachtung", label: "Squeeze-Beobachtung" }] },
  // Risiko: from the quick size to the whole plan
  "risiko.calc": { from: "positionsrechner", links: [{ id: "handelsplan-groesse", label: "Handelsplan" }] },
  // Labor: the plan that is played through is built step by step in the Handelsplan
  "labor.zeitmaschine": { from: "zeitmaschine", links: [{ id: "handelsplan-einstieg", label: "Handelsplan" }] },
  "labor.manage": { from: "verwaltung-vergleich", links: [{ id: "verwaltung-planen", label: "Verwaltung planen (Handelsplan)" }] },
  // Berichte, Analyse, Community: the report and its proof; costs and the book; sharing a playbook
  "berichte.export": { from: "export", links: [{ id: "ergebnisbeleg", label: "Ergebnisbeleg (Community)" }, { id: "backup", label: "Backup" }] },
  "analyse.costs": { from: "analyse-kosten", links: [{ id: "transaktionsbuch", label: "Transaktionsbuch" }] },
  "community.shares": { from: "teilen", links: [{ id: "playbook-austausch", label: "Playbook (Labor)" }] },
} as const satisfies Record<string, SeeAlsoRow>;

export type SeeAlsoKey = keyof typeof SEE_ALSO;
