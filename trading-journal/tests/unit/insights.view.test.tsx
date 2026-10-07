import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { initialMonth, monthTitle, TITLES } from "@/domain/insights";
import { MotionRoot } from "@/motion/MotionRoot";
import { getAccountView, getEnriched, useJournal } from "@/store/journalStore";
import { useUi } from "@/store/uiStore";
import { InsightsSection } from "@/views/insights";
import { PREVIEW_TITLE } from "@/views/insights/InsightsSection";
import { useInsightsUi } from "@/views/insights/insightsStore";
import { bootFixtureJournal, installDomPolyfills } from "./views.overview.harness";

function view() {
  const { trades, settings } = useJournal.getState();
  return getAccountView(getEnriched(trades, settings), settings, useUi.getState().acc);
}

function renderSection() {
  return render(
    <MotionRoot>
      <div className="grid lg:grid-cols-12">
        <InsightsSection />
      </div>
    </MotionRoot>,
  );
}

describe("InsightsSection", () => {
  beforeAll(() => installDomPolyfills());
  beforeEach(async () => {
    await bootFixtureJournal();
    useInsightsUi.setState({ focus: null, unit: "money" });
  });

  it("renders the Auswertung with every card", () => {
    renderSection();
    expect(screen.getByRole("heading", { name: "Auswertung" })).toBeInTheDocument();
    for (const t of Object.values(TITLES)) expect(screen.getAllByText(t).length).toBeGreaterThan(0);
    for (const id of ["recap", "findings", "calendar", "edge", "discipline", "mistakes", "signal", "time", "r", "drawdown", "winloss"]) expect(screen.getByTestId(`insights-${id}`)).toBeInTheDocument();
  });

  it("the account switch is the Hero's (uiStore.acc)", async () => {
    renderSection();
    const group = screen.getByRole("radiogroup", { name: "Konto der Auswertung" });
    await act(async () => {
      fireEvent.click(within(group).getByRole("radio", { name: "Makro" }));
    });
    expect(useUi.getState().acc).toBe("makro");
  });

  it("calendar starts on the newest trade's month; a day opens the day view and its note saves itself", async () => {
    renderSection();
    const cal = screen.getByTestId("insights-calendar");
    const start = initialMonth(view().closed);
    expect(within(cal).getAllByText(monthTitle(start)).length).toBeGreaterThan(0);
    const day = within(cal)
      .getAllByRole("button")
      .find((b) => b.dataset.day && /Trade/.test(b.getAttribute("aria-label") ?? ""))!;
    const key = day.dataset.day!;
    await act(async () => {
      fireEvent.click(day);
    });
    const panel = await screen.findByTestId("calendar-day");
    const note = within(panel).getByLabelText("Tagesnotiz");
    await act(async () => {
      fireEvent.change(note, { target: { value: "Plan gehalten" } });
    });
    // leaving the field saves at once (no typing pause needed)
    await act(async () => {
      fireEvent.blur(note);
    });
    await waitFor(() => expect(useJournal.getState().days[key]?.note).toBe("Plan gehalten"));
    // a trade row opens the detail without a foreign morph source
    const row = within(panel).queryAllByRole("button").find((b) => b.dataset.tradeId);
    if (row) {
      await act(async () => {
        fireEvent.click(row);
      });
      expect(useUi.getState().detail.source).toBe("marker");
    }
    await act(async () => {
      fireEvent.click(within(panel).getByRole("button", { name: "Zurück zum Monat" }));
    });
    // the grid is interactive again at once (the panel's exit itself needs real layout, see the Playwright check)
    await waitFor(() => expect(cal.querySelector("[inert]")).toBeNull());
    expect(within(cal).getAllByRole("button").some((b) => b.dataset.day === key)).toBe(true);
  });

  it("another card can open a day in the calendar", async () => {
    renderSection();
    const key = view().closed.at(-1)!.date.slice(0, 10);
    await act(async () => {
      useInsightsUi.getState().focusDay(key);
    });
    expect(await screen.findByTestId("calendar-day")).toBeInTheDocument();
  });

  it("closing the day view mid-typing never drops the note", async () => {
    renderSection();
    const cal = screen.getByTestId("insights-calendar");
    const day = within(cal)
      .getAllByRole("button")
      .find((b) => b.dataset.day)!;
    const key = day.dataset.day!;
    await act(async () => {
      fireEvent.click(day);
    });
    const panel = await screen.findByTestId("calendar-day");
    await act(async () => {
      fireEvent.change(within(panel).getByLabelText("Tagesnotiz"), { target: { value: "halb getippt" } });
    });
    await act(async () => {
      fireEvent.keyDown(panel, { key: "Escape" });
    });
    await waitFor(() => expect(useJournal.getState().days[key]?.note).toBe("halb getippt"));
  });

  it("an account without trades shows one preview card next to the calendar", async () => {
    useJournal.setState({ trades: [] });
    renderSection();
    expect(screen.getByText(PREVIEW_TITLE)).toBeInTheDocument();
    expect(screen.getByTestId("insights-calendar")).toBeInTheDocument();
    expect(screen.queryByTestId("insights-edge")).toBeNull();
  });
});
