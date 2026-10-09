import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { bootJournal, resetJournal, useJournal } from "@/store/journalStore";
import { useUi } from "@/store/uiStore";
import { SetupsView } from "@/views/setups";
import { NO_RULES_TEXT, SetupCard, TRADES_BUTTON_LABEL } from "@/views/setups/SetupCard";
import { seedV0 } from "./store.fixture";

async function bootLocal() {
  resetJournal();
  await bootJournal({ autoBackup: false });
}

describe("SetupCard", () => {
  it("renders colour dot, name, account badge, checklist, stats and the bar", async () => {
    const stats = {
      setup: { id: "s_x", name: "Test-Setup", account: "makro" as const, color: "#6f9dc9", desc: "", checklist: [{ id: "c1", text: "Punkt eins" }] },
      n: 4,
      wins: 3,
      losses: 1,
      be: 0,
      net: 396,
      gw: 0,
      gl: 0,
      fees: 0,
      winRate: 0.75,
      pf: 3,
      avgWin: 0,
      avgLoss: 0,
      beWinRate: null,
      payoff: null,
      avgR: 1.25,
      rN: 4,
      r2: null,
      bestR: null,
      worstR: null,
      exp: null,
      best: null,
      worst: null,
      moveWin: null,
      moveLoss: null,
      moveExp: null,
      moveN: 0,
      id: "s_x",
    };
    const onEdit = vi.fn();
    const onTrades = vi.fn();
    render(<SetupCard stats={stats as never} index={0} onEdit={onEdit} onTrades={onTrades} />);
    const card = screen.getByTestId("setup-card-s_x");
    expect(card.style.borderRadius).toBe("16px");
    // morph source: an empty surface carries the layout id; notch frame + disc are present
    expect(card.querySelector('[data-active], .pn-frame')).not.toBeNull();
    expect(within(card).getByRole("heading", { level: 3 })).toHaveTextContent("Test-Setup");
    expect(within(card).getByText("Makro")).toBeInTheDocument();
    expect(within(card).getByText(NO_RULES_TEXT)).toBeInTheDocument();
    expect(within(card).getByText("Punkt eins")).toBeInTheDocument();
    expect(within(card).getByLabelText("4")).toBeInTheDocument(); // Trades
    expect(within(card).getByLabelText("75 %")).toBeInTheDocument(); // Win-Rate
    expect(within(card).getByLabelText("+396")).toBeInTheDocument(); // P&L
    expect(within(card).getByLabelText("+1,25")).toBeInTheDocument(); // Ø R
    expect(within(card).getByRole("img", { name: "Win-Rate 75 %" })).toBeInTheDocument();
    fireEvent.click(within(card).getByRole("button", { name: "Bearbeiten" }));
    // OV-07: the contents fade out first, the editor opens once they are gone
    expect(onEdit).not.toHaveBeenCalled();
    await waitFor(() => expect(onEdit).toHaveBeenCalledWith("s_x"));
    fireEvent.click(within(card).getByRole("button", { name: TRADES_BUTTON_LABEL }));
    expect(onTrades).toHaveBeenCalledWith("s_x");
  });
});

describe("SetupsView", () => {
  beforeEach(async () => {
    seedV0();
    await bootLocal();
    useUi.setState({ page: "setups", tradeFilter: { q: "", setup: "all", result: "all", side: "all", acc: "all" } });
    window.scrollTo = vi.fn() as never;
  });

  it("renders every setup with its stats, the new tile and the Grundregeln block", () => {
    render(<SetupsView />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Entscheidungsgrundlagen");
    const card = screen.getByTestId("setup-card-s_bo");
    expect(within(card).getByLabelText("1")).toBeInTheDocument(); // one closed trade uses s_bo
    expect(within(card).getByLabelText("100 %")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Neue Entscheidungsgrundlage" })).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Grundregeln" })).toHaveTextContent("Trigger ausgelöst, nicht geraten");
  });

  it("navigates to the trades tab with the setup filter", () => {
    render(<SetupsView />);
    const card = screen.getByTestId("setup-card-s_bo");
    fireEvent.click(within(card).getByRole("button", { name: TRADES_BUTTON_LABEL }));
    expect(useUi.getState().page).toBe("trades");
    expect(useUi.getState().tradeFilter.setup).toBe("s_bo");
    expect(location.hash).toBe("#trades?setup=s_bo");
  });

  it("opens the setup editor via the store and hides cards by account filter", async () => {
    const s = useJournal.getState().settings;
    // the v0 fixture setup has no account (→ "both"); make it scalp-only and add a makro setup
    await useJournal.getState().saveSettings({
      ...s,
      setups: [{ ...(s.setups[0] as (typeof s.setups)[number]), account: "scalp" }, { id: "s_m", name: "Makro-Setup", account: "makro", color: "#46a6a0", desc: "", checklist: [] }],
    });
    render(<SetupsView />);
    expect(screen.getByTestId("setup-card-s_m")).toBeInTheDocument();
    fireEvent.click(within(screen.getByTestId("setup-card-s_bo")).getByRole("button", { name: "Bearbeiten" }));
    await waitFor(() => expect(useUi.getState().setupEditor).toEqual({ open: true, setupId: "s_bo", fromTrade: false }));
    // the card whose surface became the sheet keeps its slot but is inert and hidden from AT
    await waitFor(() => expect(screen.getByTestId("setup-card-s_bo").querySelector("[inert]")).not.toBeNull());
    fireEvent.click(screen.getByRole("radio", { name: "Makro" }));
    await waitFor(() => expect(screen.queryByTestId("setup-card-s_bo")).toBeNull()); // popLayout exit
    expect(screen.getByTestId("setup-card-s_m")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Gesamt" }));
    expect(screen.getByTestId("setup-card-s_bo")).toBeInTheDocument();
  });
});
