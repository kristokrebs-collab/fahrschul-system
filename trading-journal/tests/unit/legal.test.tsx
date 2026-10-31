/**
 * Rechtliches (Review F07): typed operator config from VITE_LEGAL_*, clearly marked placeholders for anything missing,
 * links in footer / Konto / Preise, deep link `?rechtliches=<doc>`, consent before every Stripe checkout.
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { impressumComplete, legalComplete, legalConfigOf, legalDocOfUrl, missingLegal, safeLegalUrl, setLegalConfigForTests } from "@/legal/config";
import { LegalHost } from "@/legal/LegalHost";
import { LegalLinks } from "@/legal/LegalLinks";
import { closeLegal, openLegal, useLegal } from "@/legal/store";
import { MotionRoot } from "@/motion/MotionRoot";

const FULL = legalConfigOf({
  VITE_LEGAL_OPERATOR: "Beispiel Trading UG (haftungsbeschränkt)",
  VITE_LEGAL_ADDRESS: "Beispielweg 1 | 10115 Berlin",
  VITE_LEGAL_EMAIL: "kontakt@example.com",
  VITE_LEGAL_VAT_ID: "DE000000000",
  VITE_LEGAL_DATENSCHUTZ_URL: "https://example.com/datenschutz",
  VITE_LEGAL_AGB_URL: "/agb.html",
});

afterEach(() => {
  setLegalConfigForTests(null);
  act(() => closeLegal());
  useLegal.setState({ loaded: false });
});

describe("config", () => {
  it("reads the operator data, keeps only https / same-site links, says what is missing", () => {
    expect(FULL.address).toEqual(["Beispielweg 1", "10115 Berlin"]);
    expect(FULL.urls).toMatchObject({ datenschutz: "https://example.com/datenschutz", agb: "/agb.html", impressum: null, widerruf: null });
    expect(impressumComplete(FULL) && legalComplete(FULL)).toBe(true);
    expect(safeLegalUrl("javascript:alert(1)")).toBeNull();
    expect(safeLegalUrl("http://example.com")).toBeNull();
    expect(safeLegalUrl("//evil.example/x")).toBeNull();
    const empty = legalConfigOf({});
    expect(legalComplete(empty)).toBe(false);
    expect(missingLegal(empty)).toEqual(["VITE_LEGAL_OPERATOR", "VITE_LEGAL_ADDRESS", "VITE_LEGAL_EMAIL", "VITE_LEGAL_DATENSCHUTZ_URL", "VITE_LEGAL_AGB_URL"]);
    // an own Impressum page replaces the three fields
    expect(missingLegal(legalConfigOf({ VITE_LEGAL_IMPRESSUM_URL: "https://example.com/impressum" }))).toEqual(["VITE_LEGAL_DATENSCHUTZ_URL", "VITE_LEGAL_AGB_URL"]);
    expect(legalDocOfUrl("https://journal.example/?rechtliches=agb#preise")).toBe("agb");
    expect(legalDocOfUrl("https://journal.example/?rechtliches=foo")).toBeNull();
  });
});

describe("sheet", () => {
  it("without operator data: every field is a marked placeholder naming the variable – never invented text", async () => {
    setLegalConfigForTests(legalConfigOf({}));
    render(
      <MotionRoot>
        <LegalLinks />
        <LegalHost />
      </MotionRoot>,
    );
    fireEvent.click(screen.getByTestId("legal-impressum"));
    const sheet = await screen.findByTestId("legal-sheet");
    expect(sheet).toHaveAttribute("data-doc", "impressum");
    const ph = within(sheet).getAllByTestId("legal-placeholder");
    expect(ph).toHaveLength(3);
    expect(ph[0]).toHaveTextContent("Platzhalter");
    expect(ph[0]).toHaveTextContent("VITE_LEGAL_OPERATOR");
    act(() => openLegal("agb"));
    expect(await screen.findByText(/VITE_LEGAL_AGB_URL/)).toBeInTheDocument();
  });

  it("with operator data: the Impressum lists it, the documents link to the operator's pages", async () => {
    setLegalConfigForTests(FULL);
    render(
      <MotionRoot>
        <LegalLinks />
        <LegalHost />
      </MotionRoot>,
    );
    expect(screen.getByTestId("legal-datenschutz")).toHaveAttribute("href", "https://example.com/datenschutz");
    expect(screen.getByTestId("legal-datenschutz")).toHaveAttribute("target", "_blank");
    expect(screen.queryByTestId("legal-widerruf")).toBeNull();
    fireEvent.click(screen.getByTestId("legal-impressum"));
    const sheet = await screen.findByTestId("legal-sheet");
    expect(within(sheet).queryByTestId("legal-placeholder")).toBeNull();
    expect(sheet).toHaveTextContent("Beispiel Trading UG (haftungsbeschränkt)");
    expect(sheet).toHaveTextContent("10115 Berlin");
    expect(sheet).toHaveTextContent("DE000000000");
    // the Widerruf lives in the AGB when the operator has no page of its own
    act(() => openLegal("widerruf"));
    expect(await screen.findByText(/steht die Widerrufsbelehrung in den AGB/)).toBeInTheDocument();
  });

  it("the deep link ?rechtliches=impressum opens the sheet and leaves the hash route alone", async () => {
    setLegalConfigForTests(FULL);
    window.history.replaceState(null, "", "/?rechtliches=impressum#preise");
    render(
      <MotionRoot>
        <LegalHost />
      </MotionRoot>,
    );
    expect(await screen.findByTestId("legal-sheet")).toHaveAttribute("data-doc", "impressum");
    expect(window.location.search).toBe("");
    expect(window.location.hash).toBe("#preise");
    window.history.replaceState(null, "", "/");
  });
});
