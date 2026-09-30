import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildHash, installRouter, navigate, parseHash, Q_DEBOUNCE_MS } from "@/store/router";
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
