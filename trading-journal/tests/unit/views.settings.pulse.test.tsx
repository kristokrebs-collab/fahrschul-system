import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { onIntroCommand } from "@/intro/introStore";
import { IntroPref, INTRO_PREF_KEY, readIntroEnabled } from "@/views/settings/IntroPref";
import { BINANCE_FUTURES_SYMBOLS, SymbolField, symbolFilter } from "@/views/settings/SymbolField";

describe("SymbolField", () => {
  it("suggests bare symbols but stores the BINANCE: format; matches with or without the prefix", () => {
    expect(BINANCE_FUTURES_SYMBOLS.every((s) => s.value === `BINANCE:${s.label}`)).toBe(true);
    const eth = BINANCE_FUTURES_SYMBOLS.find((s) => s.label === "ETHUSDT")!;
    expect(symbolFilter(eth, "eth")).toBe(true);
    expect(symbolFilter(eth, "BINANCE:ETH")).toBe(true);
    expect(symbolFilter(eth, "sol")).toBe(false);
  });

  it("is a combobox on #s-symbol; choosing a suggestion writes BINANCE:<SYMBOL>", () => {
    const onChange = vi.fn();
    render(<SymbolField label="TradingView-Symbol" value="" onChange={onChange} />);
    const input = screen.getByRole("combobox", { name: "TradingView-Symbol" });
    expect(input).toHaveAttribute("id", "s-symbol");
    fireEvent.change(input, { target: { value: "sol" } });
    fireEvent.click(screen.getByRole("option", { name: "SOLUSDT" }));
    expect(onChange).toHaveBeenLastCalledWith("symbol", "BINANCE:SOLUSDT");
  });
});

describe("IntroPref", () => {
  beforeEach(() => localStorage.removeItem(INTRO_PREF_KEY));
  afterEach(() => localStorage.removeItem(INTRO_PREF_KEY));

  it("defaults on, writes off/on to tj2-ui-intro and replays the intro on demand", () => {
    expect(readIntroEnabled()).toBe(true);
    const cmds: string[] = [];
    const stop = onIntroCommand((c) => cmds.push(c));
    render(<IntroPref />);
    const sw = screen.getByRole("switch", { name: "Intro beim Start abspielen" });
    expect(sw).toHaveAttribute("aria-checked", "true");
    fireEvent.click(sw);
    expect(localStorage.getItem(INTRO_PREF_KEY)).toBe("off");
    expect(readIntroEnabled()).toBe(false);
    fireEvent.click(sw);
    expect(localStorage.getItem(INTRO_PREF_KEY)).toBe("on");
    fireEvent.click(screen.getByRole("button", { name: "Intro jetzt abspielen" }));
    expect(cmds).toEqual(["replay"]);
    stop();
  });
});
