import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { bootFixtureJournal, installDomPolyfills } from "./views.overview.harness";

vi.mock("@/market", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/market")>();
  const { fakeMarket } = await import("./views.overview.harness");
  return { ...actual, ...fakeMarket(actual).overrides };
});
vi.mock("@/app/overlays", () => ({
  TradeDetail: () => null,
  TradeEditor: () => null,
  SetupEditor: () => null,
  HyblockForm: () => null,
}));

import { heroTileValue } from "@/domain/explain";
import { getAccountView, getEnriched, useJournal } from "@/store/journalStore";
import { useUi } from "@/store/uiStore";
import { signed } from "@/lib/format";
import { MotionRoot } from "@/motion/MotionRoot";
import { MorphDialogProvider } from "@/motion/MorphDialog";
import { Hero } from "@/views/overview";

function renderHero() {
  return render(
    <MotionRoot>
      <MorphDialogProvider>
        <Hero />
      </MorphDialogProvider>
    </MotionRoot>,
  );
}

describe("Hero", () => {
  beforeAll(() => installDomPolyfills());
  beforeEach(async () => {
    await bootFixtureJournal();
  });

  it("shows the formatted Netto-P&L of the tj2-v0 fixture and the KPI tiles", () => {
    const { trades, settings } = useJournal.getState();
    const view = getAccountView(getEnriched(trades, settings), settings, "all");
    expect(view.g.n).toBeGreaterThan(0);
    const expected = signed(view.g.net, 2);
    renderHero();
    const hero = screen.getByTestId("hero-net");
    expect(within(hero).getByLabelText(expected)).toBeInTheDocument();
    expect(hero.textContent).toContain(expected);
    expect(hero.textContent).toContain(settings.currency);
    expect(screen.getByText(`Startkapital ${new Intl.NumberFormat("de-DE").format(view.start)} ${settings.currency}`)).toBeInTheDocument();
    for (const label of ["Trades", "Win-Rate", "Profit-Faktor", "Ø R", "Max. Drawdown"]) {
      expect(screen.getByRole("button", { name: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`) })).toHaveAttribute("aria-haspopup", "dialog");
    }
    expect(screen.getByText(`${view.g.wins} gewonnen · ${view.g.losses} verloren${view.g.be ? ` · ${view.g.be} Break-even` : ""}`)).toBeInTheDocument();
  });

  it("KPI tiles sit in an aligned grid: 2 / 3 / 4 columns, Erwartungswert spans two at xl, Serie closes the row below xl", () => {
    renderHero();
    const grid = screen.getByRole("button", { name: /^Trades/ }).closest("dl")!;
    expect(grid.className).toMatch(/\bgrid\b.*grid-cols-2.*sm:grid-cols-3.*xl:grid-cols-4/);
    const cell = (label: RegExp) => screen.getByRole("button", { name: label }).closest("dl > div")!;
    expect(cell(/^Erwartungswert/).className).toContain("xl:col-span-2");
    expect(cell(/^Serie/).className).toContain("col-span-2 sm:col-span-3 xl:col-span-1");
    expect(cell(/^Win-Rate/).className).not.toContain("col-span");
  });

  it("account Segmented drives uiStore.acc and the label", async () => {
    renderHero();
    expect(screen.getByText("Netto-P&L · Gesamt")).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("radio", { name: "Makro" }));
    });
    expect(useUi.getState().acc).toBe("makro");
    expect(screen.getByText("Netto-P&L · Makro")).toBeInTheDocument();
  });

  it("opens the Netto-P&L fact dialog from the Details + pill", async () => {
    renderHero();
    fireEvent.click(screen.getByRole("button", { name: /Details \+/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Summe aller realisierten Gewinne und Verluste/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Schließen" })).toBeInTheDocument();
  });

  it("KPI tiles expose the final value while counting up and switch values without re-mounting", async () => {
    const { trades, settings } = useJournal.getState();
    const enriched = getEnriched(trades, settings);
    renderHero();
    const tile = screen.getByRole("button", { name: /^Win-Rate/ });
    const srValue = () => tile.querySelector("dd .sr-only")?.textContent;
    expect(srValue()).toBe(heroTileValue("winRate", getAccountView(enriched, settings, "all")));
    await act(async () => {
      fireEvent.click(screen.getByRole("radio", { name: "Makro" }));
    });
    expect(screen.getByRole("button", { name: /^Win-Rate/ })).toBe(tile);
    expect(srValue()).toBe(heroTileValue("winRate", getAccountView(enriched, settings, "makro")));
  });

  it("shows shimmering placeholders until the journal is loaded", async () => {
    useJournal.setState({ loaded: false });
    renderHero();
    const hero = screen.getByTestId("hero-net");
    expect(within(hero).queryByLabelText(/^[+−]?\d/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Win-Rate/ }).querySelector("dd [aria-hidden]")).not.toBeNull();
    await act(async () => {
      useJournal.setState({ loaded: true });
    });
    const { trades, settings } = useJournal.getState();
    const view = getAccountView(getEnriched(trades, settings), settings, "all");
    expect(within(screen.getByTestId("hero-net")).getByLabelText(signed(view.g.net, 2))).toBeInTheDocument();
  });
});
