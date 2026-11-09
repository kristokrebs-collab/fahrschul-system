/**
 * Cockpit page (P13, `src/views/cockpit`) with stand-in widgets (the real cards have their own tests): `h1 Cockpit`,
 * the widgets of the active board in their spans, a broken widget caught by its own boundary while the rest keeps
 * running, "Anordnen" (widths, remove, rename), the catalog (add with the "NEU" entrance, filter), several boards
 * (switch, new, empty state) and the layout written through to `storageKey("cockpit")`.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MorphDialogProvider } from "@/motion/MorphDialog";
import { MotionRoot } from "@/motion/MotionRoot";

// the error boundary reports through `@/cloud/report` (P14: not the barrel)
vi.mock("@/cloud/report", async (orig) => ({ ...(await orig<typeof import("@/cloud/report")>()), reportError: vi.fn() }));

vi.mock("@/views/cockpit/builtins", async () => {
  const { registerWidget } = await import("@/views/cockpit/registry");
  const card = (title: string) =>
    function StandIn() {
      return (
        <section aria-label={title} className="card">
          <h2>{title}</h2>
        </section>
      );
    };
  function Broken(): never {
    throw new Error("kaputt");
  }
  return {
    registerBuiltinWidgets() {
      registerWidget({ id: "ov-equity", title: "Equity", component: card("Equity"), defaultSpan: 8, group: "Übersicht" });
      registerWidget({ id: "ov-winrate", title: "Win-Rate", component: card("Win-Rate"), defaultSpan: 4, group: "Übersicht" });
      registerWidget({ id: "ov-ranking", title: "Setup-Ranking", component: Broken, defaultSpan: 7, group: "Übersicht" });
      registerWidget({ id: "ana-ruin", title: "Ruin-Risiko", component: card("Ruin-Risiko"), defaultSpan: 5, group: "Analyse", description: "Monte Carlo" });
      registerWidget({ id: "risk-limits", title: "Limits", component: card("Limits"), defaultSpan: 7, group: "Risiko" });
    },
  };
});

const { CockpitView, spanRules } = await import("@/views/cockpit/CockpitView");
const { COCKPIT_KEY, defaultData, useCockpit } = await import("@/views/cockpit/cockpitStore");
const { reportError } = await import("@/cloud/report");

function renderView() {
  return render(
    <MotionRoot>
      <MorphDialogProvider>
        <CockpitView />
      </MorphDialogProvider>
    </MotionRoot>,
  );
}

const stored = () => JSON.parse(localStorage.getItem(COCKPIT_KEY)!) as ReturnType<typeof defaultData>;

describe("CockpitView", () => {
  beforeAll(() => {
    Element.prototype.scrollIntoView = vi.fn();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  beforeEach(() => {
    localStorage.removeItem(COCKPIT_KEY);
    useCockpit.setState({ ...defaultData(), editing: false, fresh: [] });
  });
  afterEach(() => {
    vi.mocked(reportError).mockClear();
  });

  it("h1 Cockpit, the registered widgets of the board in their spans; unknown ids are skipped", () => {
    renderView();
    expect(screen.getByRole("heading", { level: 1, name: "Cockpit" })).toBeInTheDocument();
    const grid = screen.getByTestId("cockpit-grid");
    const tiles = [...grid.querySelectorAll<HTMLElement>("[data-widget]")];
    // main board: ov-equity, ov-winrate, ov-ranking, in-findings (not registered here), risk-limits, …
    expect(tiles.map((t) => t.dataset.widget)).toEqual(["ov-equity", "ov-winrate", "ov-ranking", "risk-limits"]);
    expect(tiles[0]).toHaveClass("lg:col-span-8");
    expect(tiles[1]).toHaveClass("lg:col-span-4");
    expect(within(tiles[0]!).getByRole("heading", { name: "Equity" })).toBeInTheDocument();
  });

  it("a broken widget shows its own error tile (reported), the others keep running", () => {
    renderView();
    const tile = document.querySelector<HTMLElement>('[data-widget="ov-ranking"]')!;
    expect(within(tile).getByRole("alert")).toHaveTextContent("Setup-Ranking: Dieses Widget hat einen Fehler.");
    expect(within(tile).getByRole("button", { name: "Erneut versuchen" })).toBeInTheDocument();
    expect(reportError).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ source: "boundary" }));
    expect(screen.getByRole("heading", { name: "Win-Rate" })).toBeInTheDocument();
  });

  it("Anordnen: widths step along the offered spans, remove, rename – all written through", async () => {
    renderView();
    fireEvent.click(screen.getByTestId("cockpit-arrange"));
    expect(screen.getByTestId("cockpit-arrange")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("list", { name: "Widgets" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Equity: Breiter" }));
    expect(useCockpit.getState().boards[0]!.items[0]!.span).toBe(12);
    expect(screen.getByRole("button", { name: "Equity: Breiter" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Win-Rate: Schmaler" }));
    expect(useCockpit.getState().boards[0]!.items[1]!.span).toBe(4);
    fireEvent.click(screen.getByRole("button", { name: "Limits: Entfernen" }));
    expect(stored().boards[0]!.items.some((i) => i.id === "risk-limits")).toBe(false);
    const name = screen.getByRole("textbox", { name: "Name des Dashboards" });
    fireEvent.change(name, { target: { value: "Trade the best" } });
    fireEvent.keyDown(name, { key: "Enter" });
    expect(stored().boards[0]!.name).toBe("Trade the best");
    expect(screen.getByRole("radio", { name: "Trade the best" })).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("cockpit-arrange"));
    await waitFor(() => expect(screen.getByTestId("cockpit-grid")).toBeInTheDocument());
  });

  it("catalog: filter, add (marked fresh, the entrance cover over the new tile), already present is disabled", async () => {
    renderView();
    fireEvent.click(screen.getByTestId("cockpit-add"));
    const sheet = await screen.findByTestId("widget-catalog");
    expect(within(sheet).getByRole("button", { name: "Equity: Im Cockpit" })).toBeDisabled();
    fireEvent.change(within(sheet).getByRole("searchbox", { name: "Widgets filtern" }), { target: { value: "monte" } });
    expect(within(sheet).queryByRole("button", { name: /Equity/ })).toBeNull();
    fireEvent.click(within(sheet).getByRole("button", { name: "Ruin-Risiko Hinzufügen" }));
    expect(useCockpit.getState().boards[0]!.items.at(-1)).toEqual({ id: "ana-ruin", span: 5 });
    expect(useCockpit.getState().fresh).toContain("ana-ruin");
    expect(within(sheet).getByRole("button", { name: "Ruin-Risiko: Im Cockpit" })).toBeDisabled();
    fireEvent.change(within(sheet).getByRole("searchbox", { name: "Widgets filtern" }), { target: { value: "qqqq" } });
    expect(within(sheet).getByText("Kein Widget passt.")).toBeInTheDocument();
    await act(async () => {
      fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    });
    await waitFor(() => expect(screen.queryByTestId("widget-catalog")).toBeNull());
    expect(document.querySelector('[data-widget="ana-ruin"]')).not.toBeNull();
  });

  it("boards: switch, a new one starts empty in edit mode with an honest empty state", async () => {
    renderView();
    fireEvent.click(screen.getByRole("radio", { name: "Risiko" }));
    expect(useCockpit.getState().active).toBe("risk");
    expect(stored().active).toBe("risk");
    expect(document.querySelector('[data-widget="risk-limits"]')).not.toBeNull();
    expect(document.querySelector('[data-widget="ov-equity"]')).toBeNull();
    fireEvent.click(screen.getByTestId("cockpit-new-board"));
    expect(useCockpit.getState().boards).toHaveLength(3);
    expect(useCockpit.getState().editing).toBe(true);
    expect(screen.getByText("Noch keine Widgets")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Dashboard 3" })).toHaveAttribute("aria-checked", "true");
  });

  it("edit spans as scoped nth-child rules for large screens", () => {
    const css = spanRules("main", [
      { id: "a", span: 8 },
      { id: "b", span: 4 },
    ]);
    expect(css.startsWith("@media (min-width: 1024px){")).toBe(true);
    expect(css).toContain('[data-cockpit-grid="main"]>[role=list]>:nth-child(1){grid-column:span 8/span 8}');
    expect(css).toContain(":nth-child(2){grid-column:span 4/span 4}");
  });
});
