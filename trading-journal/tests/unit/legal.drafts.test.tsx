/**
 * Rechtsentwürfe (docs/RECHT): the app never shows invented operator data or text that looks final. Every missing
 * `VITE_LEGAL_*` is a MARKED placeholder, every `{{TODO: …}}` stays one, links are https or same-site only, and the
 * list of variables is the same everywhere (config, .env.example, env.d.ts, SETUP.md, the drafts).
 */
import { render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { LEGAL_ENV_VARS, LEGAL_PAGES, legalConfigOf, safeLegalUrl } from "@/legal/config";
import { BUTTON_LABELS, IMMEDIATE_START_CONSENT, PARTNER_LINK_LABEL, PRICE_TAX_NOTE, RISK_SHORT } from "@/legal/consentTexts";
import { LegalMarkdown, legalValue, parseLegalMarkdown, renderInline } from "@/legal/markdown";
import { loadLegalSource, LEGAL_SOURCES } from "@/legal/texts";

const root = process.cwd();
const read = (rel: string): string => readFileSync(resolve(root, rel), "utf8");
const DOCS = ["impressum", "datenschutz", "agb", "widerruf", "risikohinweis", "preisangaben", "partnerlinks", "marken"] as const;
const doc = (name: (typeof DOCS)[number]): string => read(`docs/RECHT/${name}.md`);
/** The lines the app shows (notes for the lawyer are dropped). */
const visible = (name: (typeof DOCS)[number]): string => doc(name).split("\n").filter((l) => !l.startsWith("> **[ANWALT]**")).join("\n");
const DATA_VARS = LEGAL_ENV_VARS.filter((v) => !v.endsWith("_URL") && v !== "VITE_LEGAL_DRAFTS_REVIEWED");

const FULL = legalConfigOf(Object.fromEntries(LEGAL_ENV_VARS.map((v) => [v, v.endsWith("_URL") ? "https://example.com/x" : v === "VITE_LEGAL_DRAFTS_REVIEWED" ? "true" : `Wert ${v}`])));
const EMPTY = legalConfigOf({});

describe("variables", () => {
  it("one list: config, .env.example, env.d.ts, SETUP.md and the drafts name the same VITE_LEGAL_* variables", () => {
    const names = (text: string): string[] => [...new Set(text.match(/VITE_LEGAL_[A-Z_]+/g) ?? [])].sort();
    const all = [...LEGAL_ENV_VARS].sort();
    expect(names(read(".env.example"))).toEqual(all);
    expect(names(read("src/env.d.ts"))).toEqual(all);
    expect(names(read("SETUP.md"))).toEqual(all);
    for (const d of DOCS) for (const n of names(doc(d))) expect(all, `${d}.md names ${n}`).toContain(n);
  });

  it("every variable fills a field when set and stays empty when not (no default text)", () => {
    for (const v of DATA_VARS) expect(legalValue(v, FULL), v).toBe(`Wert ${v}`);
    for (const v of DATA_VARS) expect(legalValue(v, EMPTY), v).toBeNull();
    expect(EMPTY.draftsReviewed).toBe(false);
    expect(FULL.draftsReviewed).toBe(true);
    expect(legalConfigOf({ VITE_LEGAL_DRAFTS_REVIEWED: "yes" }).draftsReviewed).toBe(false);
    expect(Object.values(EMPTY.urls).every((u) => u === null)).toBe(true);
  });
});

describe("placeholders", () => {
  it("without operator data every datum is a marked placeholder naming the variable; every TODO is one – nothing unmarked", () => {
    for (const d of DOCS) {
      const src = visible(d);
      const { container } = render(<LegalMarkdown source={src} config={EMPTY} />);
      const text = container.textContent ?? "";
      expect(text, d).not.toContain("{{");
      expect(text, d).not.toContain("[ANWALT]");
      const fields = container.querySelectorAll('[data-testid="legal-field"]');
      const used = (src.match(/\{\{VITE_LEGAL_[A-Z_]+\}\}/g) ?? []).length;
      expect(fields.length, `${d} fields`).toBe(used);
      for (const f of Array.from(fields)) expect(f.textContent).toMatch(/^\[Platzhalter: VITE_LEGAL_[A-Z_]+\]$/);
      const todos = container.querySelectorAll('[data-testid="legal-todo"]');
      expect(todos.length, `${d} todos`).toBe((src.match(/\{\{TODO:/g) ?? []).length);
      for (const t of Array.from(todos)) expect(t.textContent).toMatch(/^\[Platzhalter: .+\]$/);
    }
  });

  it("with operator data the values appear and no field placeholder is left; TODOs are never filled automatically", () => {
    for (const d of DOCS) {
      const { container } = render(<LegalMarkdown source={doc(d)} config={FULL} />);
      expect(container.querySelectorAll('[data-testid="legal-field"]'), d).toHaveLength(0);
      expect(container.querySelectorAll('[data-testid="legal-todo"]').length, d).toBe((visible(d).match(/\{\{TODO:/g) ?? []).length);
    }
    const { container } = render(<LegalMarkdown source={doc("impressum")} config={FULL} />);
    for (const v of DATA_VARS) expect(container.textContent, v).toContain(`Wert ${v}`);
  });

  it("the Impressum template covers every Impressum field (DDG § 5) the config knows", () => {
    const src = doc("impressum");
    for (const v of DATA_VARS) expect(src, v).toContain(`{{${v}}}`);
  });

  it("an unknown {{…}} token is a marked placeholder, never rendered as a value", () => {
    const { container } = render(<p>{renderInline("a {{VITE_LEGAL_NOPE}} b", FULL)}</p>);
    expect(container.querySelector('[data-testid="legal-field"]')?.textContent).toBe("[Platzhalter: VITE_LEGAL_NOPE]");
  });
});

describe("links", () => {
  it("only https or same-site links become anchors; javascript:, http: and protocol-relative links stay plain text", () => {
    const src = ["[ok](https://example.com/a)", "[site](/agb.html)", "[js](javascript:alert(1))", "[plain](http://example.com)", "[rel](//evil.example/x)", "[data](data:text/html,x)"].join(" ");
    const { container } = render(<p>{renderInline(src, EMPTY)}</p>);
    const hrefs = Array.from(container.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(["https://example.com/a", "/agb.html"]);
    expect(container.querySelector('a[href^="https"]')?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(container.textContent).toContain("js");
    expect(safeLegalUrl("javascript:alert(1)")).toBeNull();
    expect(safeLegalUrl("//evil.example/x")).toBeNull();
  });

  it("the drafts themselves link nowhere unsafe", () => {
    for (const d of DOCS) {
      const { container } = render(<LegalMarkdown source={doc(d)} config={FULL} />);
      for (const a of Array.from(container.querySelectorAll("a"))) {
        const href = a.getAttribute("href") ?? "";
        expect(safeLegalUrl(href) ?? (href.startsWith("?rechtliches=") ? href : null), `${d}: ${href}`).not.toBeNull();
      }
    }
  });

  it("operator text is escaped, never markup", () => {
    const evil = legalConfigOf({ VITE_LEGAL_OPERATOR: '<img src=x onerror="alert(1)">' });
    const { container } = render(<LegalMarkdown source="**Anbieter:** {{VITE_LEGAL_OPERATOR}}" config={evil} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("<img");
  });
});

describe("drafts", () => {
  it("the parser drops the notes for the lawyer and keeps quotes, lists and headings", () => {
    const blocks = parseLegalMarkdown("> **[ANWALT]** nur für den Anwalt\n\n## Titel\n\n- eins\n- zwei\n\n> Zitat\n\nText **fett**");
    expect(blocks.map((b) => b.kind)).toEqual(["h2", "ul", "quote", "p"]);
  });

  it("the pages: five, each with a source; Hinweise is four files in one", async () => {
    expect([...LEGAL_PAGES]).toEqual(["impressum", "datenschutz", "agb", "widerruf", "hinweise"]);
    expect(LEGAL_SOURCES.hinweise).toHaveLength(4);
    const h = await loadLegalSource("hinweise");
    for (const title of ["## Risikohinweis", "## Preisangaben und Steuern", "## Partnerlinks und Werbung", "## Marken und Drittanbieter"]) expect(h).toContain(title);
    expect(await loadLegalSource("datenschutz")).toBe(doc("datenschutz"));
  });

  it("the wordings in code are the wordings in the drafts (one source of truth, checked verbatim)", () => {
    expect(doc("widerruf")).toContain(IMMEDIATE_START_CONSENT);
    expect(doc("widerruf")).toContain(`„${BUTTON_LABELS.withdraw}“`);
    expect(doc("widerruf")).toContain(`„${BUTTON_LABELS.withdrawConfirm}“`);
    expect(doc("agb")).toContain(`„${BUTTON_LABELS.cancel}“`);
    expect(doc("partnerlinks")).toContain(PARTNER_LINK_LABEL);
    expect(doc("preisangaben")).toContain(PRICE_TAX_NOTE);
    expect(doc("risikohinweis")).toContain(RISK_SHORT);
    expect(BUTTON_LABELS.order).toMatch(/zahlungspflichtig/i);
    expect(BUTTON_LABELS.orderTrial).toMatch(/zahlungspflichtig/i);
  });

  it("no draft claims compliance", () => {
    for (const d of DOCS) expect(doc(d), d).not.toMatch(/rechtssicher|rechtskonform|dsgvo-konform|abmahnsicher|garantiert rechtlich/i);
    for (const d of DOCS.filter((x) => x !== "impressum")) expect(doc(d), d).toMatch(/\[ANWALT\]/);
  });

  it("the risk notice says what it has to: leverage, simulation ≠ forecast, top traders ≠ whales, no advice", () => {
    const r = doc("risikohinweis");
    expect(r).toMatch(/Hebelprodukt/);
    expect(r).toMatch(/Simulation ist keine Prognose/);
    expect(r).toMatch(/Top-Trader sind keine Wale/);
    expect(r).toMatch(/Keine professionelle Finanzberatung\./);
    expect(r).toMatch(/keine Anlageberatung, keine Anlageempfehlung/);
  });

  it("the partner link notice states that partner links are off by default and nothing is invented", () => {
    expect(doc("partnerlinks")).toMatch(/keine\*\* Partnerlinks, solange der Betreiber keine eigenen Partner-IDs/);
  });

  it("the brand notice names TradingView and Binance as trademarks of their owners and denies a partnership", () => {
    const m = doc("marken");
    expect(m).toMatch(/TradingView, Binance/);
    expect(m).toMatch(/Marken oder Firmennamen ihrer jeweiligen Inhaber/);
    expect(m).toMatch(/keine Partnerschaft/);
  });
});
