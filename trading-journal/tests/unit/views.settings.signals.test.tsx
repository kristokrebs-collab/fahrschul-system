import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SIGNAL_CFG } from "@/domain/signals";
import type { Settings } from "@/domain/types";
import { bootJournal, resetJournal, useJournal } from "@/store/journalStore";
import { useUi } from "@/store/uiStore";
import { SettingsView } from "@/views/settings";
import { changedKeys, defaultSignalDraft, draftToSettings, mistakesFromRows, parseLadder, settingsToDraft } from "@/views/settings/draft";
import { mistakeUsage, orphanTags } from "@/views/settings/MistakesCard";
import { STORAGE_STRINGS } from "@/views/settings/StorageCard";
import { seedV0 } from "./store.fixture";

const perm = vi.hoisted(() => ({ next: "granted" as "granted" | "denied" | "default" | "unsupported", asked: 0 }));
vi.mock("@/market", async (orig) => ({
  ...(await orig<typeof import("@/market")>()),
  signalNotifyPermission: () => "default",
  requestSignalNotifyPermission: async () => {
    perm.asked++;
    return perm.next;
  },
}));

const base = (): Settings => useJournal.getState().settings;

describe("settings draft · Einstiegs-Check, Fehler-Tags, Grenzen", () => {
  it("shows the other journal's defaults when settings.signals is absent", () => {
    const d = settingsToDraft({ ...base(), signals: undefined });
    expect(d.sgLadder).toBe(DEFAULT_SIGNAL_CFG.ladder.join(","));
    expect([d.sgReq, d.sgLook, d.sgRsiOs, d.sgRsiOb, d.sgRsiNear, d.sgWtOs, d.sgWtOb, d.sgZoneTf, d.sgSwing, d.sgCh, d.sgAvg, d.sgSig]).toEqual(["2", "3", "30", "70", "10", "-53", "53", "1h", "50", "9", "21", "2"]);
    expect(d.sgNotify).toBe("");
    expect(d.sgNotifyMin).toBe("1");
    expect([d.dlTrade, d.dlDay, d.dlMakro, d.dlScalp]).toEqual(["2", "4", "2", "5"]);
  });

  it("an untouched draft writes signals / mistakes / discipline back unchanged (absent stays absent)", () => {
    const s = { ...base() };
    delete s.signals;
    const res = draftToSettings(settingsToDraft(s), s);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect("signals" in res.settings).toBe(false);
    expect("discipline" in res.settings).toBe(false);
    expect(res.settings.mistakes).toBe(s.mistakes);
  });

  it("a changed check value merges over the stored object (unknown keys of either app survive), clamped like the engine", () => {
    const s = { ...base(), signals: { foo: "bar", ladder: ["4h", "30m"], required: 2, wtSource: "hlc3", revRange: 30 } };
    const d = settingsToDraft(s);
    expect(d.sgLadder).toBe("30m,4h"); // sorted like the engine sees it
    const res = draftToSettings({ ...d, sgRsiOs: "35", sgReq: "9", sgSwing: "5", sgNotify: "on", sgNotifyMin: "3" }, s);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const sig = res.settings.signals as Record<string, unknown>;
    expect(sig).toMatchObject({ foo: "bar", wtSource: "hlc3", revRange: 30, ladder: ["30m", "4h"], rsiOs: 35, required: 2, swingLookback: 20, notify: true, notifyMinStrength: 3, zoneTf: "1h" });
  });

  it("refuses an empty number or an empty ladder with the field to reveal", () => {
    const s = base();
    const d = settingsToDraft(s);
    expect(draftToSettings({ ...d, sgRsiOb: "" }, s)).toEqual({ ok: false, error: "numeric", field: "sgRsiOb" });
    expect(draftToSettings({ ...d, sgLadder: "" }, s)).toEqual({ ok: false, error: "numeric", field: "sgLadder" });
    expect(draftToSettings({ ...d, dlMakro: "0" }, s)).toEqual({ ok: false, error: "numeric", field: "dlMakro" });
  });

  it("keeps unknown market / hyblock / backtest keys (e.g. market.sourceSymbol from a mapped TradingView symbol)", () => {
    const s = { ...base(), market: { ...base().market, sourceSymbol: "BITSTAMP:BTCUSD" } } as Settings;
    const res = draftToSettings({ ...settingsToDraft(s), makro: "123" }, s);
    expect(res.ok && (res.settings.market as unknown as Record<string, unknown>).sourceSymbol).toBe("BITSTAMP:BTCUSD");
  });

  it("mistake rows: trimmed, empty dropped, duplicates merged; discipline in % → fractions", () => {
    expect(mistakesFromRows([{ id: "a", text: " A " }, { id: "b", text: "" }, { id: "c", text: "A" }, { id: "d", text: "B" }])).toEqual(["A", "B"]);
    const s = base();
    const res = draftToSettings({ ...settingsToDraft(s), mistakes: [{ id: "x", text: "Neu" }], dlTrade: "1,5", dlDay: "3", dlMakro: "1", dlScalp: "4" }, s);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.settings.mistakes).toEqual(["Neu"]);
    expect((res.settings as Settings & { discipline: unknown }).discipline).toEqual({ maxLossTradePct: 0.015, maxLossDayPct: 0.03, maxTrades: { makro: 1, scalp: 4 } });
  });

  it("changedKeys: ladder order-insensitive, mistakes by saved meaning; defaults keep the notification choice", () => {
    const saved = settingsToDraft(base());
    expect(changedKeys({ ...saved, sgLadder: "4h,1h,45m,30m" }, saved).size).toBe(0);
    expect(changedKeys({ ...saved, mistakes: [...saved.mistakes, { id: "n", text: "  " }] }, saved).size).toBe(0);
    expect(changedKeys({ ...saved, mistakes: saved.mistakes.slice(1) }, saved)).toEqual(new Set(["mistakes"]));
    expect(parseLadder("1D, 30m,x,30m")).toEqual(["30m", "1D"]);
    expect(defaultSignalDraft({ sgNotify: "on", sgNotifyMin: "4" })).toMatchObject({ sgLadder: "30m,45m,1h,4h", sgNotify: "on", sgNotifyMin: "4" });
  });

  it("mistake usage / tags only on trades", () => {
    const usage = mistakeUsage([{ mistakes: ["A", " A ", "B"] }, { mistakes: ["B"] }, {}]);
    expect([...usage]).toEqual([
      ["A", 1],
      ["B", 2],
    ]);
    expect(orphanTags(usage, [{ id: "1", text: "A" }])).toEqual([{ tag: "B", n: 2 }]);
  });
});

describe("SettingsView · new cards", () => {
  beforeEach(async () => {
    seedV0();
    resetJournal();
    await bootJournal({ autoBackup: false });
    useUi.setState({ toasts: [] });
    perm.asked = 0;
  });

  it("ladder toggle + Speichern writes settings.signals; the last rung cannot be switched off", async () => {
    render(<SettingsView />);
    const card = screen.getByTestId("settings-signal-card");
    const tf2h = within(card).getByRole("button", { name: "Stufe 2h" });
    expect(tf2h).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(tf2h);
    expect(tf2h).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Ungespeicherte Änderungen")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Speichern" })[0]!);
    await waitFor(() => expect((useJournal.getState().settings.signals as { ladder: string[] }).ladder).toEqual(["30m", "45m", "1h", "2h", "4h"]));
    // switch everything off but one rung
    for (const tf of ["45m", "1h", "2h", "4h"]) fireEvent.click(within(card).getByRole("button", { name: `Stufe ${tf}` }));
    const last = within(card).getByRole("button", { name: "Stufe 30m" });
    fireEvent.click(last);
    expect(last).toHaveAttribute("aria-pressed", "true");
    expect(last).toHaveAttribute("aria-disabled", "true");
  });

  it("the notification switch asks the browser in the click and only turns on when granted", async () => {
    render(<SettingsView />);
    const sw = screen.getByRole("switch", { name: "Systembenachrichtigung" });
    perm.next = "denied";
    fireEvent.click(sw);
    await waitFor(() => expect(perm.asked).toBe(1));
    await waitFor(() => expect(screen.getByText(/Im Browser blockiert/)).toBeInTheDocument());
    expect(sw).toHaveAttribute("aria-checked", "false");
    perm.next = "granted";
    fireEvent.click(sw);
    await waitFor(() => expect(sw).toHaveAttribute("aria-checked", "true"));
    fireEvent.click(screen.getAllByRole("button", { name: "Speichern" })[0]!);
    await waitFor(() => expect((useJournal.getState().settings.signals as { notify?: boolean })?.notify).toBe(true));
  });

  it("renaming a mistake tag keeps the old tag on the trades and offers it back", async () => {
    // a trade carrying a tag that is about to be renamed
    const t = useJournal.getState().trades[0]!;
    await useJournal.getState().saveTrade({ ...t, mistakes: ["Kein Stop"] });
    render(<SettingsView />);
    const card = screen.getByTestId("settings-mistakes-card");
    const inputs = within(card).getAllByRole("textbox");
    const idx = inputs.findIndex((i) => (i as HTMLInputElement).value === "Kein Stop");
    expect(idx).toBeGreaterThanOrEqual(0);
    fireEvent.change(inputs[idx]!, { target: { value: "Ohne Stop" } });
    const orphans = within(card).getByTestId("mistake-orphans");
    expect(within(orphans).getByRole("button", { name: "„Kein Stop“ wieder in die Liste aufnehmen" })).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Speichern" })[0]!);
    await waitFor(() => expect(useJournal.getState().settings.mistakes).toContain("Ohne Stop"));
    expect(useJournal.getState().settings.mistakes).not.toContain("Kein Stop");
    expect(useJournal.getState().trades.find((x) => x.id === t.id)?.mistakes).toEqual(["Kein Stop"]); // trades untouched
  });

  it("Version & Speicher names the edition, the namespace and the no-storage path", () => {
    const { unmount } = render(<SettingsView />);
    const card = screen.getByTestId("settings-storage-card");
    expect(card).toHaveTextContent(STORAGE_STRINGS.personal);
    expect(card).toHaveTextContent("tj2-*");
    expect(within(card).queryByTestId("settings-no-storage")).toBeNull();
    unmount();
    useJournal.setState({ mode: "local", storage: "unavailable" });
    render(<SettingsView />);
    const c2 = screen.getByTestId("settings-storage-card");
    expect(within(c2).getByTestId("settings-no-storage")).toHaveTextContent("Speichern nicht möglich.");
    expect(c2).toHaveTextContent(STORAGE_STRINGS.none);
  });
});
