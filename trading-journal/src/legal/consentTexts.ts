/**
 * Wordings the draft texts (`docs/RECHT/`) quote and the purchase flow, the cancel flow and the partner links need.
 * ALL OF THEM ARE DRAFTS – „Entwurf – Prüfung durch Anwalt nötig“: they are proposals, not a statement that anything is
 * compliant. Pure data (no React), so the Netlify functions and the purchase package may import it. Wiring them into
 * the purchase flow is NOT done here (that package owns the files); `docs/RECHT-CHECKLISTE.md` lists the open points.
 * `tests/unit/legal.drafts.test.ts` checks that the drafts quote these texts verbatim.
 */

/** Over every in-app draft (unless `VITE_LEGAL_DRAFTS_REVIEWED=true`). */
export const DRAFT_NOTICE = {
  title: "Entwurf – Prüfung durch Anwalt nötig",
  text: "Das ist eine Vorlage, keine Rechtsberatung, und sie ist nicht anwaltlich geprüft. Gelb markierte Stellen muss der Betreiber ausfüllen.",
} as const;

/** The separate checkbox before the order (not pre-ticked, not part of the AGB box): § 356 BGB, Wertersatz § 357a BGB. */
export const IMMEDIATE_START_CONSENT =
  "Ich verlange ausdrücklich, dass der Anbieter vor Ablauf der Widerrufsfrist mit der Bereitstellung meines Tarifs beginnt. Mir ist bekannt, dass ich bei einem Widerruf für die bis dahin erbrachten Leistungen einen angemessenen Betrag zahlen muss und dass mein Widerrufsrecht erlischt, sobald der Anbieter die Leistung vollständig erbracht hat.";

/** The label of a partner link, right at the link and before the click (§ 5a Abs. 4 UWG, § 6 DDG). Off by default. */
export const PARTNER_LINK_LABEL = "Werbung · Partnerlink – wir erhalten ggf. eine Provision, für dich ändert sich nichts.";

/** Labels the law names (proposals; § 312j Abs. 3, § 312k Abs. 2, § 356a BGB). */
export const BUTTON_LABELS = {
  /** § 312j Abs. 3 BGB: „zahlungspflichtig bestellen“ or an equally clear wording – for the last step of the order. */
  order: "Zahlungspflichtig abonnieren",
  orderTrial: "Testphase starten – danach zahlungspflichtig",
  /** § 312k Abs. 2 BGB: the cancel button and the confirmation button. */
  cancel: "Verträge hier kündigen",
  cancelConfirm: "Jetzt kündigen",
  /** § 356a BGB (since 19 June 2026): the withdrawal button and its confirmation. */
  withdraw: "Vertrag widerrufen",
  withdrawConfirm: "Widerruf bestätigen",
} as const;

/** Next to every price shown to consumers (PAngV): the total price includes VAT; the checkout shows the final amount. */
export const PRICE_TAX_NOTE = "Preise in Euro, für Verbraucher inklusive gesetzlicher Umsatzsteuer. Steuer und Endbetrag zeigt der Bezahlschritt vor dem Abschluss.";

/** The one sentence of the risk notice that is also shown short (the full text is „Hinweise“ in the legal sheet). */
export const RISK_SHORT = "Handel mit Hebelprodukten kann zum Totalverlust führen. Simulationen sind keine Prognose. Keine professionelle Finanzberatung.";
