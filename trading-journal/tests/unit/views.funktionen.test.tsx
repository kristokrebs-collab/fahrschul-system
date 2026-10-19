/**
 * Page "Funktionen": the register as a grid of groups with search, status / plan filters and direct opening; "Für dich"
 * from the assistant's own counters and "Zuletzt benutzt" from the search's recent ids – each with an honest empty line.
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const open = vi.hoisted(() => vi.fn());
vi.mock("@/app/featureOpen", () => ({ openFeature: open }));

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

const cards = () => screen.queryAllByTestId("feature-card");
const search = () => screen.getByRole("searchbox", { name: "Funktionen durchsuchen" });
const groupIds = () => screen.queryAllByTestId("funktionen-group").map((g) => g.getAttribute("data-group"));

describe("Funktionen page", () => {
  beforeAll(() => {
    installDomPolyfills();
    reduceMotion();
  });
  beforeEach(() => {
    open.mockClear();
    useSearch.setState({ recent: [] });
    useJournal.setState({ settings: defaultSettings() });
  });

  it("names itself with an h1 and shows every function in the groups of a trader's day", () => {
    renderPage();
    expect(screen.getByRole("heading", { level: 1, name: "Funktionen" })).toBeInTheDocument();
    expect(screen.getByTestId("funktionen-view")).toHaveAttribute("data-count", String(FEATURE_COUNT));
    expect(cards()).toHaveLength(FEATURE_COUNT);
    expect(groupIds()).toEqual(FEATURE_GROUPS.map((g) => g.id));
    for (const g of FEATURE_GROUPS) expect(screen.getByRole("heading", { level: 2, name: g.name })).toBeInTheDocument();
    expect(screen.getByTestId("feature-results")).toHaveTextContent(`${FEATURE_COUNT} Funktionen`);
  });

  it("shows status, plan, benefit and what is missing on each card – nothing 'teilweise' without its gap", () => {
    renderPage();
    const labor = screen.getAllByTestId("feature-card").find((c) => c.getAttribute("data-feature") === "labor")!;
    expect(within(labor).getByRole("heading", { level: 3, name: "Backtest-Labor" })).toBeInTheDocument();
    expect(labor).toHaveAttribute("data-status", "fertig");
    expect(labor).toHaveAttribute("data-tier", "premium");
    expect(labor).toHaveTextContent("Ab Premium");
    expect(labor).toHaveTextContent("F16");
    const partial = screen.getAllByTestId("feature-card").filter((c) => c.getAttribute("data-status") === "teilweise");
    expect(partial.length).toBeGreaterThan(10);
    for (const c of partial) expect(c, c.getAttribute("data-feature") ?? "").toHaveTextContent("Fehlt noch");
    const alarms = screen.getAllByTestId("feature-card").find((c) => c.getAttribute("data-feature") === "alarme")!;
    expect(alarms).toHaveTextContent("nur, solange die App offen ist");
  });

  it("says honestly that 'Für dich' and 'Zuletzt benutzt' have nothing yet", () => {
    renderPage();
    const mine = screen.getByTestId("funktionen-for-you");
    expect(mine).toHaveAttribute("data-n", "0");
    expect(mine).toHaveTextContent("Noch nichts gelernt");
    expect(mine).toHaveTextContent("die Fragen selbst werden nicht gespeichert");
    const recent = screen.getByTestId("funktionen-recent");
    expect(recent).toHaveAttribute("data-n", "0");
    expect(recent).toHaveTextContent("Noch nichts geöffnet");
    expect(within(mine).queryAllByTestId("feature-quick")).toHaveLength(0);
  });

  it("'Für dich' follows the assistant's counters, 'Zuletzt benutzt' the search's recent ids", () => {
    useJournal.setState({ settings: withMemory(defaultSettings(), { ...EMPTY_MEMORY, interests: { train: 5, lab: 3 }, asked: 8 }) });
    useSearch.setState({ recent: [featureSearchId("belastungstest"), "page:coach", featureSearchId("backup")] });
    renderPage();
    const mine = within(screen.getByTestId("funktionen-for-you"));
    expect(mine.getAllByTestId("feature-quick")[0]).toHaveAttribute("data-feature", "ueben");
    expect(mine.getAllByTestId("feature-quick").map((b) => b.getAttribute("data-feature"))).toContain("labor");
    const last = within(screen.getByTestId("funktionen-recent")).getAllByTestId("feature-quick");
    expect(last.map((b) => b.getAttribute("data-feature"))).toEqual(["belastungstest", "backup"]);
    fireEvent.click(last[0]!);
    expect(open).toHaveBeenCalledWith("belastungstest");
  });

  it("opens a function from its card", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Positionsrechner öffnen" }));
    expect(open).toHaveBeenCalledWith("positionsrechner");
  });

  it("filters by search (typo-tolerant), hides the quick lists meanwhile, and Enter opens the first hit", () => {
    renderPage();
    fireEvent.change(search(), { target: { value: "belastungstst" } });
    expect(cards().map((c) => c.getAttribute("data-feature"))[0]).toBe("belastungstest");
    expect(screen.queryByTestId("funktionen-for-you")).toBeNull();
    expect(screen.queryByTestId("funktionen-recent")).toBeNull();
    expect(screen.getByTestId("feature-results")).toHaveTextContent(/von \d+ Funktionen/);
    expect(screen.getByTestId("feature-results")).toHaveTextContent("Enter öffnet den ersten Treffer");
    fireEvent.keyDown(search(), { key: "Enter" });
    expect(open).toHaveBeenCalledWith("belastungstest");
  });

  it("filters by status and by plan, exactly", () => {
    renderPage();
    fireEvent.click(screen.getByRole("radio", { name: "Teilweise" }));
    expect(cards().length).toBeGreaterThan(5);
    expect(cards().length).toBeLessThan(FEATURE_COUNT);
    expect(cards().every((c) => c.getAttribute("data-status") === "teilweise")).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: "Premium" }));
    expect(cards().length).toBeGreaterThan(2);
    expect(cards().every((c) => c.getAttribute("data-status") === "teilweise" && c.getAttribute("data-tier") === "premium")).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: "Fertig" }));
    expect(cards().every((c) => c.getAttribute("data-status") === "fertig" && c.getAttribute("data-tier") === "premium")).toBe(true);
  });

  it("says 'Nichts gefunden' and brings everything back with 'Filter zurücksetzen'", () => {
    renderPage();
    fireEvent.change(search(), { target: { value: "zzzqqq" } });
    expect(cards()).toHaveLength(0);
    expect(screen.getByText("Nichts gefunden")).toBeInTheDocument();
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Filter zurücksetzen" }));
    });
    expect(cards()).toHaveLength(FEATURE_COUNT);
    expect(search()).toHaveValue("");
  });

  it("covers every group the user asked for", () => {
    renderPage();
    const names = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    for (const n of ["Heute vorbereiten", "Beobachten & Alarme", "Einstieg prüfen", "Testen", "Auswerten & Lernen", "Daten & Import", "Community"]) expect(names).toContain(n);
    expect(FEATURE_REGISTRY.length).toBe(FEATURE_COUNT);
  });
});
