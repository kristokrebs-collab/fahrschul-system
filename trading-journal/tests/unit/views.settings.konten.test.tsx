import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { bootJournal, resetJournal, useJournal } from "@/store/journalStore";
import { useUi } from "@/store/uiStore";
import { SettingsView } from "@/views/settings";
import { draftToSettings, settingsToDraft } from "@/views/settings/draft";
import { describeError, describeRows, testConfigFromDraft, unwrapRows } from "@/views/settings/HyblockConnectorCard";
import { seedV0 } from "./store.fixture";

describe("settings draft", () => {
  it("round-trips the defaults and applies the fallbacks", () => {
    const s = useJournal.getState().settings;
    const d = settingsToDraft(s);
    expect(d.winRate).toBe("62,15");
    expect(d.avgLoss).toBe("-9,31");
    expect(d.makro).toBe("20000");
    const res = draftToSettings({ ...d, pair: "  ", symbol: "", hbCoin: "", hbTf: "", label: " " }, s);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.settings.backtest.winRate).toBeCloseTo(0.6215, 6);
      expect(res.settings.backtest.avgLoss).toBeCloseTo(-0.0931, 6);
      expect(res.settings.pair).toBe("BTC/USDT");
      expect(res.settings.market.symbol).toBe("BINANCE:BTCUSDT");
      expect(res.settings.hyblock.coin).toBe("BTC");
      expect(res.settings.hyblock.timeframe).toBe("1h");
      expect(res.settings.backtest.label).toBe("Backtest");
      expect(res.settings.setups).toBe(s.setups);
    }
    const bad = draftToSettings({ ...d, zoneHigh: "abc" }, s);
    expect(bad).toEqual({ ok: false, error: "numeric", field: "zoneHigh" });
  });

  it("hyblock test helpers follow the bundle output format", () => {
    expect(unwrapRows({ data: { result: [{ a: 1 }] } })).toEqual([{ a: 1 }]);
    expect(unwrapRows({ x: 1 })).toEqual([{ x: 1 }]);
    expect(describeRows("ep", [{ a: 1, b: "0123456789abcdefXYZ" }])).toBe("ep: 1 Werte · Felder: a=1, b=0123456789abcdef");
    expect(describeError("ep", { code: "server_not_connected" })).toBe("ep: Connector „Hyblock“ nicht verbunden");
    expect(describeError("ep", { code: "tool_error", message: "boom" })).toBe("ep: boom");
    expect(describeError("ep", { code: "weird" })).toBe("ep: weird");
    const d = settingsToDraft(useJournal.getState().settings);
    expect(testConfigFromDraft({ ...d, hbDelta: "", hbExchange: "" })).toEqual({ endpoints: ["topTraderAccountsLongShort"], params: { coin: "BTC", timeframe: "1h", limit: 3 } });
  });
});

describe("SettingsView · Konten", () => {
  beforeEach(async () => {
    seedV0();
    resetJournal();
    await bootJournal({ autoBackup: false });
    useUi.setState({ toasts: [] });
  });

  it("saves the account capital with de-DE parsing and toasts", async () => {
    render(<SettingsView />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Einstellungen");
    const makro = screen.getByLabelText("Startkapital Makro") as HTMLInputElement;
    expect(makro.value).toBe("20000");
    expect(makro).toHaveAttribute("inputmode", "decimal");
    fireEvent.change(makro, { target: { value: "25.000,5" } });
    fireEvent.change(screen.getByLabelText("Währung"), { target: { value: "EUR" } });
    fireEvent.change(screen.getByLabelText("Journal-Start"), { target: { value: "2026-01-15" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Speichern" })[0] as HTMLElement);
    await waitFor(() => expect(useJournal.getState().settings.capital.makro).toBe(25000.5));
    expect(useJournal.getState().settings.currency).toBe("EUR");
    expect(useJournal.getState().settings.startDate).toBe("2026-01-15");
    expect(useUi.getState().toasts.map((t) => t.title)).toContain("Einstellungen gespeichert");
  });

  it("refuses to save with an unparsable number", async () => {
    render(<SettingsView />);
    fireEvent.change(screen.getByLabelText("Startkapital Scalp"), { target: { value: "abc" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Speichern" })[0] as HTMLElement);
    await waitFor(() => expect(useUi.getState().toasts.map((t) => t.title)).toContain("Bitte alle Zahlenfelder ausfüllen"));
    expect(useJournal.getState().settings.capital.scalp).toBe(5000);
  });

  it("runs the injected Hyblock test and shows the lines", async () => {
    const onTest = vi.fn(async () => ["topTraderAccountsLongShort: 3 Werte · Felder: longPercentage=58.4"]);
    render(<SettingsView onTestHyblock={onTest} />);
    fireEvent.click(screen.getByRole("button", { name: "Verbindung testen" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("3 Werte"));
    expect(onTest).toHaveBeenCalledWith({ endpoints: ["topTraderAccountsLongShort", "whaleRetailDelta"], params: { coin: "BTC", exchange: "binance_perp_stable", timeframe: "1h", limit: 3 } });
    expect(screen.getByText("Nur dieser Browser")).toBeInTheDocument();
    expect(screen.getByText("2 Trades gespeichert · 1 Grundlagen · 1 Grundregeln")).toBeInTheDocument();
  });
});
