/**
 * Journal v3 filters of `Alle Trades` (P06): the v3 ranges / tags / period, saved views (`tj2-views`), the
 * `Top-Trades` quick filter and the grouping switch in the real `TradesView`.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import type { Trade } from "@/domain/types";
import { MotionRoot } from "@/motion/MotionRoot";
import { useJournal } from "@/store/journalStore";
import { DEFAULT_TRADE_EXTRA, DEFAULT_TRADE_FILTER, DEFAULT_TRADE_SORT, useUi, type TradeExtraFilter } from "@/store/uiStore";
import { MAX_VIEWS, VIEWS_KEY, matchView, parseExtra, parseView, reloadViews, useViews } from "@/store/viewsStore";
import { TradesView } from "@/views/trades";
import { clearJournalFilters, filterExtra, journalFilterCount, journalFilterOptions, listKey, matchJournal } from "@/views/trades/tradesModel";
import { mkTrade, settings } from "./domain.fixtures";

const T1 = mkTrade({ id: "T1", date: "2026-10-01T10:00", exitDate: "2026-10-01T12:30", pair: "BTC/USDT", entry: 100, stop: 99, exit: 102, size: 1000, leverage: 5, exchange: "Bitunix", tags: ["London", "Breakout"], rating: 5, market: "perp" });
const T2 = mkTrade({ id: "T2", date: "2026-10-03T09:00", exitDate: "2026-10-04T09:00", pair: "ETHUSDT", entry: 100, stop: 98, exit: 99, size: 1000, leverage: 2, exchange: "bitunix", tags: ["london"], rating: 2, market: "spot" });
const T3 = mkTrade({ id: "T3", date: "2026-10-05T09:00", pair: "BTCUSDT.P", entry: 100, stop: 99, exit: 101, size: 1000 });
// an automatic hedge: long and short on the same pair, overlapping
const H1 = mkTrade({ id: "H1", date: "2026-10-06T10:00", exitDate: "2026-10-06T16:00", pair: "SOL/USDT", side: "long", entry: 100, stop: 99, exit: 98, size: 1000, rating: 4 });
const H2 = mkTrade({ id: "H2", date: "2026-10-06T11:00", exitDate: "2026-10-06T14:00", pair: "SOL/USDT", side: "short", entry: 100, stop: 101, exit: 99, size: 1000 });
const TRADES: Trade[] = [T1, T2, T3, H1, H2];

const ex = (p: Partial<TradeExtraFilter>): TradeExtraFilter => ({ ...DEFAULT_TRADE_EXTRA, ...p });
const ids = (list: readonly { id: string }[]) => list.map((t) => t.id);
const withPnl = (t: Trade, pnl: number, r: number) => ({ ...t, pnl, r });

describe("matchJournal / journalFilterCount / options", () => {
  const rows = [withPnl(T1, 20, 2), withPnl(T2, -10, -0.5), withPnl(T3, 10, 1)];

  it("period by local entry day (inclusive), pair by normalised key, exchange case-insensitive, market (absent = perp)", () => {
    expect(ids(filterExtra(rows, ex({ from: "2026-10-03", to: "2026-10-03" })))).toEqual(["T2"]);
    expect(ids(filterExtra(rows, ex({ pair: "BTCUSDT" })))).toEqual(["T1", "T3"]);
    expect(ids(filterExtra(rows, ex({ exchange: "BITUNIX" })))).toEqual(["T1", "T2"]);
    expect(ids(filterExtra(rows, ex({ market: "perp" })))).toEqual(["T1", "T3"]);
    expect(ids(filterExtra(rows, ex({ market: "spot" })))).toEqual(["T2"]);
  });

  it("tags: every chosen tag (case-insensitive); ranges inclusive, a missing value fails an active range", () => {
    expect(ids(filterExtra(rows, ex({ tags: ["LONDON"] })))).toEqual(["T1", "T2"]);
    expect(ids(filterExtra(rows, ex({ tags: ["london", "breakout"] })))).toEqual(["T1"]);
    expect(ids(filterExtra(rows, ex({ pnlMin: 10 })))).toEqual(["T1", "T3"]);
    expect(ids(filterExtra(rows, ex({ rMin: -1, rMax: 1 })))).toEqual(["T2", "T3"]);
    expect(ids(filterExtra(rows, ex({ holdMin: 60, holdMax: 180 })))).toEqual(["T1"]); // 150 min; T3 has no exit time
    expect(ids(filterExtra(rows, ex({ levMin: 3 })))).toEqual(["T1"]);
    expect(ids(filterExtra(rows, ex({ ratingMin: 4 })))).toEqual(["T1"]);
    expect(matchJournal({ pnl: null }, ex({ pnlMax: 5 }))).toBe(false);
  });

  it("count = active groups; clearing keeps mistake / strength / grouping; listKey reacts only when set", () => {
    expect(journalFilterCount(ex({ from: "2026-01-01", to: "2026-02-01", pnlMin: 1, pnlMax: 2, tags: ["a"], ratingMin: 4 }))).toBe(4);
    expect(clearJournalFilters(ex({ mistake: "x", pair: "BTCUSDT", group: true, rMin: 1 }))).toEqual({ mistake: "x", strength: "all", group: true });
    expect(listKey(DEFAULT_TRADE_FILTER, DEFAULT_TRADE_SORT, ex({}))).toBe(listKey(DEFAULT_TRADE_FILTER, DEFAULT_TRADE_SORT));
    expect(listKey(DEFAULT_TRADE_FILTER, DEFAULT_TRADE_SORT, ex({ tags: ["a"] }))).not.toBe(listKey(DEFAULT_TRADE_FILTER, DEFAULT_TRADE_SORT));
    expect(filterExtra(rows, DEFAULT_TRADE_EXTRA)).toBe(rows);
  });

  it("exchange account: filter case-insensitive, offered only when the journal has accounts, counted, kept in a view (F15)", () => {
    const a = { ...withPnl(T1, 20, 2), exchangeAccount: "Haupt" };
    const b = { ...withPnl(T2, -10, -0.5), exchangeAccount: "Sub-Konto 2" };
    const c = withPnl(T3, 10, 1);
    expect(ids(filterExtra([a, b, c], ex({ exchangeAccount: "haupt" })))).toEqual(["T1"]);
    expect(ids(filterExtra([a, b, c], ex({ exchangeAccount: "Sub-Konto 2" })))).toEqual(["T2"]);
    expect(journalFilterOptions([a, b, c, { ...c, id: "T4", exchangeAccount: " haupt " }]).exchangeAccounts).toEqual(["Haupt", "Sub-Konto 2"]);
    expect(journalFilterOptions(TRADES).exchangeAccounts).toEqual([]);
    expect(journalFilterCount(ex({ exchangeAccount: "Haupt" }))).toBe(1);
    expect(parseExtra({ mistake: "all", strength: "all", exchangeAccount: "Haupt" })).toMatchObject({ exchangeAccount: "Haupt" });
  });

  it("options list only what the journal has (tags by use)", () => {
    const o = journalFilterOptions(TRADES);
    expect(o.pairs).toEqual(["BTCUSDT", "ETHUSDT", "SOLUSDT"]);
    expect(o.exchanges).toEqual(["bitunix"]);
    expect(o.tags).toEqual(["Breakout", "london", "London"]);
    expect(o).toMatchObject({ spot: true, hold: true, leverage: true, rating: true });
    expect(journalFilterOptions([mkTrade({ id: "x", date: "2026-01-01T10:00" })])).toMatchObject({ spot: false, hold: false, leverage: false, rating: false, tags: [] });
  });
});

describe("viewsStore", () => {
  beforeEach(() => {
    localStorage.removeItem(VIEWS_KEY);
    reloadViews();
    useUi.setState({ tradeFilter: DEFAULT_TRADE_FILTER, tradeExtra: DEFAULT_TRADE_EXTRA, tradeSort: DEFAULT_TRADE_SORT });
  });

  it("parses tolerant: junk dropped, unknown keys removed, missing ones defaulted", () => {
    expect(parseView(null)).toBeNull();
    expect(parseView({ id: "a", name: "  " })).toBeNull();
    const v = parseView({ id: "a", name: " Beste ", filter: { result: "nope", side: "short", foo: 1 }, extra: { ratingMin: 4, tags: ["x", 3, ""], group: true, evil: "<script>" }, sort: { k: "pnl", dir: 1 } });
    expect(v).toMatchObject({ id: "a", name: "Beste", filter: { result: "all", side: "short", acc: "all", q: "", setup: "all" }, sort: { k: "pnl", dir: 1 } });
    expect(v?.extra).toEqual({ mistake: "all", strength: "all", ratingMin: 4, tags: ["x"], group: true });
    expect(parseExtra({ pnlMin: "3", rMin: Number.NaN, market: "futures" })).toEqual(DEFAULT_TRADE_EXTRA);
  });

  it("save (same name replaces), match, apply into uiStore, persist, delete; at most MAX_VIEWS", () => {
    useUi.setState({ tradeExtra: ex({ ratingMin: 4 }), tradeSort: { k: "r", dir: -1 } });
    const v = useViews.getState().saveView("Beste")!;
    expect(JSON.parse(localStorage.getItem(VIEWS_KEY)!)).toHaveLength(1);
    const again = useViews.getState().saveView("beste", { filter: DEFAULT_TRADE_FILTER, extra: ex({ ratingMin: 5 }), sort: DEFAULT_TRADE_SORT })!;
    expect(again.id).toBe(v.id);
    expect(useViews.getState().views).toHaveLength(1);
    expect(matchView(useViews.getState().views, { filter: DEFAULT_TRADE_FILTER, extra: ex({ ratingMin: 5, tags: [] }), sort: DEFAULT_TRADE_SORT })?.id).toBe(v.id);
    expect(matchView(useViews.getState().views, { filter: DEFAULT_TRADE_FILTER, extra: ex({}), sort: DEFAULT_TRADE_SORT })).toBeNull();
    expect(useViews.getState().applyView(v.id)).toBe(true);
    expect(useUi.getState().tradeExtra.ratingMin).toBe(5);
    expect(useViews.getState().applyView("missing")).toBe(false);
    reloadViews();
    expect(useViews.getState().views.map((x) => x.name)).toEqual(["beste"]);
    useViews.getState().deleteView(v.id);
    expect(useViews.getState().views).toEqual([]);
    for (let i = 0; i < MAX_VIEWS + 3; i++) useViews.getState().saveView(`V${i}`);
    expect(useViews.getState().views).toHaveLength(MAX_VIEWS);
    expect(useViews.getState().views[0]!.name).toBe("V3");
    expect(useViews.getState().saveView("   ")).toBeNull();
  });
});

describe("TradesView – journal filter bar", () => {
  beforeEach(() => {
    sessionStorage.setItem("tj2-fill-trades", "1");
    localStorage.removeItem(VIEWS_KEY);
    reloadViews();
    useJournal.setState({ trades: TRADES, settings: settings(), loaded: true, mode: "local" });
    useUi.setState({ tradeFilter: DEFAULT_TRADE_FILTER, tradeExtra: DEFAULT_TRADE_EXTRA, tradeSort: DEFAULT_TRADE_SORT, detail: { id: null, source: null }, editor: { open: false, fromFab: false }, transitioning: false, toasts: [] });
  });

  const rowIds = () => Array.from(document.querySelectorAll<HTMLElement>("tbody tr[data-trade-id]:not([data-exiting])")).map((tr) => tr.dataset.tradeId);
  const mount = () =>
    render(
      <MotionRoot>
        <TradesView />
      </MotionRoot>,
    );

  it("Top-Trades keeps rating ≥ 4; a saved view shows its name and is pressed", async () => {
    mount();
    const bar = screen.getByTestId("journal-filters");
    expect(within(bar).getByTestId("view-name")).toHaveTextContent("Alle Trades");
    fireEvent.click(within(bar).getByRole("button", { name: "★ Top-Trades" }));
    expect(useUi.getState().tradeExtra.ratingMin).toBe(4);
    await waitFor(() => expect(rowIds().sort()).toEqual(["H1", "T1"]));
    fireEvent.click(within(bar).getByRole("button", { name: "+ Ansicht speichern" }));
    const input = within(bar).getByLabelText("Name der Ansicht");
    fireEvent.change(input, { target: { value: "Beste" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(within(bar).getByRole("button", { name: "Beste" })).toHaveAttribute("aria-pressed", "true");
    expect(within(bar).getByTestId("view-name")).toHaveTextContent("Beste");
    // leaving the view: the label says so, a click re-applies it
    fireEvent.click(within(bar).getByRole("button", { name: "★ Top-Trades" }));
    expect(within(bar).getByTestId("view-name")).toHaveTextContent("Eigene Auswahl");
    fireEvent.click(within(bar).getByRole("button", { name: "Beste" }));
    expect(useUi.getState().tradeExtra.ratingMin).toBe(4);
  });

  it("`Mehr Filter` shows the count; tags filter; `Diese Filter leeren` clears only the v3 part", async () => {
    mount();
    const bar = screen.getByTestId("journal-filters");
    fireEvent.click(within(bar).getByRole("button", { name: /Mehr Filter/ }));
    fireEvent.click(within(bar).getByRole("button", { name: "#Breakout" }));
    expect(useUi.getState().tradeExtra.tags).toEqual(["Breakout"]);
    await waitFor(() => expect(rowIds()).toEqual(["T1"]));
    expect(within(bar).getByRole("button", { name: /Mehr Filter/ })).toHaveTextContent("1");
    fireEvent.click(within(bar).getByRole("button", { name: "Diese Filter leeren" }));
    expect(useUi.getState().tradeExtra).toEqual(DEFAULT_TRADE_EXTRA);
  });

  it("`Mehr Filter` offers „Börsenkonto“ once trades carry one (F15)", async () => {
    useJournal.setState({ trades: [{ ...T1, exchangeAccount: "Haupt" }, { ...T2, exchangeAccount: "Sub-Konto 2" }, T3, H1, H2] });
    mount();
    const bar = screen.getByTestId("journal-filters");
    fireEvent.click(within(bar).getByRole("button", { name: /Mehr Filter/ }));
    expect(within(bar).getByText("Börsenkonto")).toBeInTheDocument();
    useUi.setState({ tradeExtra: { ...DEFAULT_TRADE_EXTRA, exchangeAccount: "Sub-Konto 2" } });
    await waitFor(() => expect(rowIds()).toEqual(["T2"]));
  });

  it("grouping folds the automatic hedge into one row that unfolds its legs", async () => {
    mount();
    fireEvent.click(screen.getByRole("switch", { name: "Positionen gruppieren" }));
    expect(useUi.getState().tradeExtra.group).toBe(true);
    const group = await waitFor(() => {
      const el = document.querySelector<HTMLElement>('[data-group-id^="hedge:"]');
      expect(el).not.toBeNull();
      return el!;
    });
    expect(group).toHaveTextContent("Hedge");
    expect(rowIds()).not.toContain("H1");
    fireEvent.click(group);
    await waitFor(() => expect(document.querySelector('[data-group-member="H2"]')).not.toBeNull());
  });
});
