/**
 * Page "Funktionen": a large search ("Was willst du tun?"), "Zuletzt benutzt" and "Empfohlen", twelve task tiles; a tile opens its
 * group (sub headings, one row per function, the details one fold away); a row opens the function. Each list says honestly
 * when it has nothing yet.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const open = vi.hoisted(() => vi.fn());
const assistant = vi.hoisted(() => vi.fn());
vi.mock("@/app/featureOpen", () => ({ openFeature: open }));
vi.mock("@/assistant/open", () => ({ openAssistant: assistant }));

import { featureSearchId } from "@/app/featureQuery";
import { FEATURE_COUNT, FEATURE_GROUPS, FEATURE_REGISTRY } from "@/app/features";
import { EMPTY_MEMORY, withMemory } from "@/assistant/memory";
import { defaultSettings } from "@/domain/defaults";
import { MotionRoot } from "@/motion/MotionRoot";
import { useSearch } from "@/search/searchStore";
import { useJournal } from "@/store/journalStore";
import { FunktionenView } from "@/views/funktionen";
import { installDomPolyfills } from "./views.overview.harness";

function reduceMotion() {
  window.matchMedia = ((q: string) => ({ matches: q.includes("reduced-motion"), media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
}

function renderPage() {
  return render(
    <MotionRoot>
      <FunktionenView />
    </MotionRoot>,
  );
}

const tiles = () => screen.queryAllByTestId("funktionen-tile");
const rows = () => screen.queryAllByTestId("feature-row");
const search = () => screen.getByRole("searchbox", { name: "Was willst du tun?" });
const tile = (id: string) => tiles().find((t) => t.getAttribute("data-group") === id)!;
const view = () => screen.getByTestId("funktionen-view").getAttribute("data-view");

describe("Funktionen page", () => {
  beforeAll(() => {
    installDomPolyfills();
    reduceMotion();
  });
  beforeEach(() => {
    open.mockClear();
    assistant.mockClear();
    useSearch.setState({ recent: [] });
    useJournal.setState({ settings: defaultSettings() });
  });
  afterEach(() => vi.useRealTimers());

  it("names itself with an h1, asks 'Was willst du tun?' and shows the twelve tasks as tiles – no function list yet", () => {
    renderPage();
    expect(screen.getByRole("heading", { level: 1, name: "Funktionen" })).toBeInTheDocument();
    expect(screen.getByTestId("funktionen-view")).toHaveAttribute("data-count", String(FEATURE_COUNT));
    expect(view()).toBe("tiles");
    expect(tiles().map((t) => t.getAttribute("data-group"))).toEqual(FEATURE_GROUPS.map((g) => g.id));
    expect(tiles()).toHaveLength(12);
    for (const g of FEATURE_GROUPS) {
      expect(tile(g.id)).toHaveTextContent(g.name);
      expect(tile(g.id)).toHaveTextContent(g.lead);
    }
    expect(rows()).toHaveLength(0);
    expect(screen.getByRole("search")).toBeInTheDocument();
    // a sentence about the state, never a promise
    expect(screen.getByText(/Keine professionelle Finanzberatung\./)).toBeInTheDocument();
  });

  it("says on each tile how many functions it holds and whether some are only partial", () => {
    renderPage();
    for (const g of FEATURE_GROUPS) {
      const items = FEATURE_REGISTRY.filter((f) => f.group === g.id);
      const partial = items.filter((f) => f.status === "teilweise").length;
      expect(tile(g.id)).toHaveAttribute("data-n", String(items.length));
      expect(tile(g.id)).toHaveAttribute("data-partial", String(partial));
      expect(tile(g.id)).toHaveTextContent(partial ? `${partial} teilweise` : "alle fertig");
    }
  });

  it("opens a tile to its group: sub headings, one row per function, honest state per row", () => {
    renderPage();
    fireEvent.click(tile("testen"));
    expect(view()).toBe("group");
    expect(screen.getByRole("heading", { level: 2, name: "Strategie entwickeln & testen" })).toBeInTheDocument();
    const members = FEATURE_REGISTRY.filter((f) => f.group === "testen");
    expect(rows()).toHaveLength(members.length);
    expect(screen.getAllByTestId("funktionen-sub").map((s) => s.getAttribute("data-sub"))).toEqual(["Idee bauen", "Test & Ergebnis", "Härtetest", "Live prüfen & teilen"]);
    const row = rows().find((r) => r.getAttribute("data-feature") === "pine-export")!;
    expect(within(row).getByText("Aus deiner Idee ein TradingView-Skript machen")).toBeInTheDocument();
    expect(row).toHaveTextContent("Labor › Pine-Skript für TradingView");
    expect(row).toHaveAttribute("data-page", "labor");
    expect(row).toHaveAttribute("data-anchor", "labor-pine");
    // partial = said in words next to its dot
    const partial = rows().find((r) => r.getAttribute("data-feature") === "eigene-idee")!;
    expect(partial).toHaveAttribute("data-status", "teilweise");
    expect(partial).toHaveTextContent("Teilweise");
    // the tiles are gone while a group is open
    expect(tiles()).toHaveLength(0);
  });

  it("goes back to the tiles with the button and with Escape, and hands the focus back to the tile", () => {
    renderPage();
    fireEvent.click(tile("risiko"));
    expect(view()).toBe("group");
    fireEvent.click(screen.getByRole("button", { name: "Zurück zu allen Aufgaben" }));
    expect(view()).toBe("tiles");
    expect(document.activeElement).toBe(tile("risiko"));
    fireEvent.click(tile("daten"));
    fireEvent.keyDown(screen.getByTestId("funktionen-group-view"), { key: "Escape" });
    expect(view()).toBe("tiles");
  });

  it("opens a function from its row, and from a 'Siehe auch' link in the details", () => {
    renderPage();
    fireEvent.click(tile("pruefen"));
    fireEvent.click(screen.getByRole("button", { name: "Positionsrechner öffnen" }));
    expect(open).toHaveBeenCalledWith("positionsrechner");
    expect(view()).toBe("tiles");
    fireEvent.click(tile("heute"));
    fireEvent.click(screen.getByRole("button", { name: "Details zu Tagesplan" }));
    const panel = screen.getByTestId("feature-detail-panel");
    expect(panel).toHaveTextContent("Vier Szenarien");
    const see = within(panel).getByRole("button", { name: /Schlüsselmarken/ });
    expect(see).toHaveAttribute("data-see", "schluesselmarken");
    fireEvent.click(see);
    expect(open).toHaveBeenCalledWith("schluesselmarken");
  });

  it("shows in the details what is missing, what a function needs and what plan it asks for", async () => {
    renderPage();
    fireEvent.click(tile("testen"));
    fireEvent.click(screen.getByRole("button", { name: "Details zu Eigene Idee (Regelbaukasten)" }));
    const panel = screen.getByTestId("feature-detail-panel");
    expect(panel).toHaveTextContent("Fehlt noch");
    expect(panel).toHaveTextContent("Kein Freitext- oder Diktat-Entwurf");
    expect(panel).toHaveTextContent("Premium");
    expect(rows().find((r) => r.getAttribute("data-feature") === "eigene-idee")).toHaveTextContent("Premium");
    fireEvent.click(screen.getByRole("button", { name: "Details zu Eigene Idee (Regelbaukasten)" }));
    await waitFor(() => expect(screen.queryByTestId("feature-detail-panel")).toBeNull());
  });

  it("finds by what you want to do, hides the tiles meanwhile, and Enter opens the first hit", () => {
    renderPage();
    fireEvent.change(search(), { target: { value: "warum verliere ich" } });
    expect(view()).toBe("search");
    expect(tiles()).toHaveLength(0);
    expect(rows().map((r) => r.getAttribute("data-feature")).slice(0, 3)).toContain("leaks-edges");
    expect(screen.getByTestId("feature-results")).toHaveTextContent(/Treffer/);
    expect(screen.getByTestId("feature-results")).toHaveTextContent("Enter öffnet den ersten Treffer");
    // the row names the group it lives in
    expect(rows()[0]).toHaveTextContent("Aus Fehlern lernen");
    const first = rows()[0]!.getAttribute("data-feature")!;
    fireEvent.keyDown(search(), { key: "Enter" });
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(first);
  });

  it("forgives typos, clears with Escape and with the button", () => {
    renderPage();
    fireEvent.change(search(), { target: { value: "belastungstst" } });
    expect(rows()[0]).toHaveAttribute("data-feature", "belastungstest");
    fireEvent.keyDown(search(), { key: "Escape" });
    expect(search()).toHaveValue("");
    expect(view()).toBe("tiles");
    fireEvent.change(search(), { target: { value: "Backup" } });
    fireEvent.click(screen.getByRole("button", { name: "Suche leeren" }));
    expect(search()).toHaveValue("");
    expect(view()).toBe("tiles");
  });

  it("says 'nichts' honestly and offers the assistant", () => {
    renderPage();
    fireEvent.change(search(), { target: { value: "zzzqqq" } });
    expect(rows()).toHaveLength(0);
    expect(screen.getByText("Dazu steht nichts in der Liste")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Assistenten fragen" }));
    expect(assistant).toHaveBeenCalledTimes(1);
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Zurück zu den Aufgaben" }));
    });
    expect(view()).toBe("tiles");
  });

  it("'Zuletzt benutzt' is absent without history and lists the search's recent functions with it", () => {
    const { unmount } = renderPage();
    expect(screen.queryByTestId("funktionen-recent")).toBeNull();
    unmount();
    useSearch.setState({ recent: [featureSearchId("belastungstest"), "page:coach", featureSearchId("backup")] });
    renderPage();
    const recent = within(screen.getByTestId("funktionen-recent")).getAllByTestId("feature-quick");
    expect(recent.map((b) => b.getAttribute("data-feature"))).toEqual(["belastungstest", "backup"]);
    fireEvent.click(within(recent[0]!).getByTestId("feature-open"));
    expect(open).toHaveBeenCalledWith("belastungstest");
  });

  it("'Empfohlen' is never empty: the assistant's counters first, the new next, the starting points last", () => {
    renderPage();
    const picks = within(screen.getByTestId("funktionen-picks")).getAllByTestId("feature-quick");
    expect(picks.length).toBeGreaterThanOrEqual(3);
    expect(picks.length).toBeLessThanOrEqual(4);
    expect(within(screen.getByTestId("funktionen-picks")).getByRole("heading", { level: 2, name: "Empfohlen" })).toBeInTheDocument();
  });

  it("puts what the assistant's counters point at first in 'Empfohlen'", () => {
    useJournal.setState({ settings: withMemory(defaultSettings(), { ...EMPTY_MEMORY, interests: { train: 5 }, asked: 8 }) });
    renderPage();
    const picks = within(screen.getByTestId("funktionen-picks")).getAllByTestId("feature-quick");
    expect(picks[0]).toHaveAttribute("data-feature", "ueben");
    expect(picks[0]).toHaveTextContent("Für dich");
  });

  it("marks a function of the last release as new – and only in that window", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-24T12:00:00Z"));
    const first = renderPage();
    fireEvent.click(tile("testen"));
    expect(rows().find((r) => r.getAttribute("data-feature") === "pine-export")).toHaveTextContent("Neu");
    first.unmount();
    vi.setSystemTime(new Date("2027-03-01T12:00:00Z"));
    renderPage();
    fireEvent.click(tile("testen"));
    expect(rows().find((r) => r.getAttribute("data-feature") === "pine-export")).not.toHaveTextContent("Neu");
  });
});
