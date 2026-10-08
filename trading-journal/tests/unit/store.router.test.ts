import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildHash, detachShell, getScroll, installRouter, navigate, parseHash, Q_DEBOUNCE_MS, showPage } from "@/store/router";
import { DEFAULT_TRADE_FILTER, useUi } from "@/store/uiStore";
import { useJournal } from "@/store/journalStore";

const y0 = DEFAULT_TRADE_FILTER;

describe("parseHash", () => {
  const known = ["s_bo", "s_bt"];
  it.each([
    ["", { page: "overview" }],
    ["#", { page: "overview" }],
    ["#overview", { page: "overview" }],
    ["#setups", { page: "setups" }],
    ["#settings?setup=s_bo", { page: "settings" }],
    ["#nope?setup=s_bo", { page: "overview" }],
    ["#trades", { page: "trades" }],
    ["#trades?", { page: "trades" }],
    ["#trades?setup=s_bo", { page: "trades", filter: { ...y0, setup: "s_bo" } }],
    ["#trades?setup=__none", { page: "trades", filter: { ...y0, setup: "__none" } }],
    ["#trades?setup=unknown", { page: "trades", filter: { ...y0 } }],
    ["#trades?result=be&side=short&acc=makro", { page: "trades", filter: { ...y0, result: "be", side: "short", acc: "makro" } }],
    ["#trades?result=xx&side=up&acc=all", { page: "trades", filter: { ...y0 } }],
    ["#trades?q=Delta%20rot", { page: "trades", filter: { ...y0, q: "Delta rot" } }],
    ["trades?q=" + "a".repeat(300), { page: "trades", filter: { ...y0, q: "a".repeat(200) } }],
  ])("%s", (hash, expected) => {
    expect(parseHash(hash, known)).toEqual(expected);
  });

  it("accepts any setup id when no known list is given", () => {
    expect(parseHash("#trades?setup=s_zzz").filter?.setup).toBe("s_zzz");
  });
});

describe("buildHash", () => {
  it.each([
    ["overview", undefined, "#overview"],
    ["trades", undefined, "#trades"],
    ["trades", { ...y0 }, "#trades"],
    ["trades", { setup: "s_bo" }, "#trades?setup=s_bo"],
    ["trades", { setup: "s_bo", result: "win", side: "long", acc: "scalp", q: "x y" }, "#trades?setup=s_bo&result=win&side=long&acc=scalp&q=x+y"],
    ["settings", { setup: "s_bo" }, "#settings"],
  ] as const)("%s %o → %s", (page, filter, expected) => {
    expect(buildHash(page, filter)).toBe(expected);
  });

  it("round-trips through parseHash", () => {
    const f = { ...y0, setup: "__none", result: "loss" as const, q: "ä & ?" };
    expect(parseHash(buildHash("trades", f)).filter).toEqual(f);
  });
});

describe("navigate / installRouter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    history.replaceState(null, "", "#overview");
    useUi.setState({ page: "overview", tradeFilter: y0 });
    useJournal.setState({ settings: { ...useJournal.getState().settings, setups: [{ id: "s_bo", name: "x", account: "both", color: "#fff", desc: "", checklist: [] }] } });
  });

  it("initial parse: URL query wins over the store", () => {
    useUi.setState({ tradeFilter: { ...y0, result: "win" } });
    history.replaceState(null, "", "#trades?setup=s_bo");
    const uninstall = installRouter();
    expect(useUi.getState().page).toBe("trades");
    expect(useUi.getState().tradeFilter).toEqual({ ...y0, setup: "s_bo" });
    uninstall();
  });

  it("tab switch pushes history, filter changes replace (q debounced)", () => {
    const push = vi.spyOn(history, "pushState");
    const replace = vi.spyOn(history, "replaceState");
    const uninstall = installRouter();
    push.mockClear();
    replace.mockClear();

    navigate("trades", { setup: "s_bo" });
    expect(useUi.getState().page).toBe("trades");
    expect(useUi.getState().tradeFilter.setup).toBe("s_bo");
    expect(push).toHaveBeenCalledTimes(1);
    expect(location.hash).toBe("#trades?setup=s_bo");

    useUi.getState().setTradeFilter({ result: "win" });
    expect(location.hash).toBe("#trades?setup=s_bo&result=win");
    expect(push).toHaveBeenCalledTimes(1);

    useUi.getState().setTradeFilter({ q: "de" });
    expect(location.hash).toBe("#trades?setup=s_bo&result=win");
    useUi.getState().setTradeFilter({ q: "delta" });
    vi.advanceTimersByTime(Q_DEBOUNCE_MS + 1);
    expect(location.hash).toBe("#trades?setup=s_bo&result=win&q=delta");

    navigate("settings");
    expect(location.hash).toBe("#settings"); // no query on other tabs
    expect(useUi.getState().tradeFilter.setup).toBe("s_bo"); // filter survives
    expect(push).toHaveBeenCalledTimes(2);

    navigate("settings"); // same tab → no history entry
    expect(push).toHaveBeenCalledTimes(2);
    uninstall();
    push.mockRestore();
    replace.mockRestore();
  });

  it("hashchange (back button) switches the tab and applies the query", () => {
    const uninstall = installRouter();
    history.replaceState(null, "", "#trades?result=loss");
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    expect(useUi.getState().page).toBe("trades");
    expect(useUi.getState().tradeFilter.result).toBe("loss");
    history.replaceState(null, "", "#setups");
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    expect(useUi.getState().page).toBe("setups");
    uninstall();
  });
});

describe("scroll handoff to the shell", () => {
  const setScrollY = (y: number) => Object.defineProperty(window, "scrollY", { value: y, configurable: true });
  let scrollTo: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useRealTimers();
    history.replaceState(null, "", "#overview");
    useUi.setState({ page: "overview", tradeFilter: y0 });
    setScrollY(0);
    scrollTo = vi.spyOn(window, "scrollTo").mockImplementation((opts?: ScrollToOptions | number) => {
      if (typeof opts === "object" && typeof opts.top === "number") setScrollY(opts.top);
    });
  });
  afterEach(() => {
    detachShell();
    scrollTo.mockRestore();
    setScrollY(0);
  });

  it("parks the restore until the shell shows the page, then returns the distance scrolled", () => {
    showPage("overview");
    setScrollY(500);
    navigate("trades", { setup: "s_bo" });
    expect(useUi.getState().page).toBe("trades");
    expect(scrollTo).not.toHaveBeenCalled();
    expect(getScroll("overview")).toBe(500);
    expect(showPage("trades")).toBe(-500);
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "instant" });
    // a second commit of the same page does not scroll again
    expect(showPage("trades")).toBe(0);
    expect(scrollTo).toHaveBeenCalledTimes(1);
  });

  it("a page that never reached the screen keeps no scroll position; the last restore wins", () => {
    showPage("overview");
    const before = getScroll("trades");
    setScrollY(320);
    navigate("trades");
    navigate("settings"); // before the deferred trades render committed
    expect(getScroll("trades")).toBe(before);
    expect(showPage("trades")).toBe(0);
    expect(showPage("settings")).toBe(-320);
  });

  it("skips the restore without a layout read when the window already stands where the page goes", () => {
    showPage("overview");
    const uninstall = installRouter();
    try {
      setScrollY(0);
      navigate("trades"); // first visit → top 0, the window is at 0
      let reads = 0;
      Object.defineProperty(window, "scrollY", {
        configurable: true,
        get: () => {
          reads++;
          return 0;
        },
      });
      expect(showPage("trades")).toBe(0);
      expect(reads).toBe(0);
      expect(scrollTo).not.toHaveBeenCalled();

      // a scroll after the switch voids the shortcut: the restore runs (and measures) as before
      setScrollY(0);
      navigate("overview");
      setScrollY(40);
      window.dispatchEvent(new Event("scroll"));
      expect(showPage("overview")).toBe(-40);
      expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "instant" });
    } finally {
      uninstall();
    }
  });

  it("without a shell the restore runs in the next animation frame", async () => {
    setScrollY(200);
    navigate("setups");
    expect(scrollTo).not.toHaveBeenCalled();
    await new Promise((r) => requestAnimationFrame(() => r(undefined)));
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "instant" });
  });
});
