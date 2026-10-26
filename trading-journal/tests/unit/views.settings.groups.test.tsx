/**
 * Feinschliff Runde 8 – the settings page in five groups (`SettingsGroup`): every card sits inside a group, the group
 * heads are `h2`s that never START with a card heading (the section strip and the function register find a card by the
 * start of its heading), the cards of the register's anchors are still there, and the small print of the archive / screenshot
 * import is folded into `MoreInfo` but stays in the DOM (readers and the specs read it closed).
 */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { bootJournal, resetJournal } from "@/store/journalStore";
import { useUi } from "@/store/uiStore";
import { MoreInfo } from "@/views/settings/MoreInfo";
import { SettingsView } from "@/views/settings";
import { seedV0 } from "./store.fixture";

const GROUPS = ["s-grundlagen", "s-maerkte", "s-regeln-gruppe", "s-sichern", "s-aussehen"];
/** headings of the cards the register points to (`anchor.heading` of `src/app/features.ts`) */
const CARD_HEADINGS = ["Konten", "Backtest-Referenz", "Chart-Level", "Live-Daten", "Einstiegs-Check", "Lage-Ampel", "Hyblock-Connector", "Daten", "Fehler-Tags", "Grundregeln", "Disziplin-Grenzen", "Darstellung", "Einführung & Hilfe", "Weitere Einstellungen", "Version & Speicher"];

describe("SettingsView groups", () => {
  beforeEach(async () => {
    seedV0();
    resetJournal();
    await bootJournal({ autoBackup: false });
    useUi.setState({ toasts: [] });
  });

  it("five groups in a fixed order, each with a title and a lead, and every card inside one", () => {
    const { container } = render(<SettingsView />);
    const groups = Array.from(container.querySelectorAll<HTMLElement>("section[data-section]"));
    expect(groups.map((g) => g.dataset.section)).toEqual(GROUPS);
    for (const g of groups) {
      const h = g.querySelector("h2");
      expect(h?.id).toBeTruthy();
      expect(g.getAttribute("aria-labelledby")).toBe(h?.id);
      // the lead sits under the title
      expect(h?.closest("div.grid")?.querySelector("p")?.textContent?.length).toBeGreaterThan(10);
    }
    // every heading of the register is inside a group, and no group title starts with one of them
    const titles = groups.map((g) => g.querySelector("h2")!.textContent!.trim());
    for (const t of titles) for (const c of CARD_HEADINGS) expect(t.startsWith(c), `${t} starts with ${c}`).toBe(false);
    const heads = Array.from(container.querySelectorAll<HTMLElement>("h2, h3"));
    for (const c of CARD_HEADINGS) {
      const h = heads.find((x) => (x.textContent ?? "").replace(/\s+/g, " ").trim().startsWith(c));
      expect(h, `heading ${c}`).toBeTruthy();
      expect(h!.closest("section[data-section]"), `${c} in a group`).not.toBeNull();
    }
  });

  it("the cards stay in the form (one save button group, one `form`)", () => {
    const { container } = render(<SettingsView />);
    const form = container.querySelector("form");
    expect(form).not.toBeNull();
    expect(form!.querySelectorAll("section[data-section]")).toHaveLength(GROUPS.length);
  });
});

describe("MoreInfo", () => {
  it("folds its text away but keeps it in the document", () => {
    const { container } = render(
      <MoreInfo summary="Mehr dazu">
        <p>Das Kleingedruckte.</p>
      </MoreInfo>,
    );
    const details = container.querySelector("details")!;
    expect(details.open).toBe(false);
    expect(screen.getByText("Mehr dazu").closest("summary")).not.toBeNull();
    expect(screen.getByText("Das Kleingedruckte.")).toBeInTheDocument();
    details.open = true;
    expect(details.open).toBe(true);
  });
});
