import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MotionRoot } from "@/motion/MotionRoot";
import { TradeEditor, defaultForm, livePriceInput, resetForNext, toRecord, validateRecord, type TradeRecord } from "@/overlays/TradeEditor";
import { useJournal } from "@/store/journalStore";
import { useUi } from "@/store/uiStore";
import { SAMPLE, settings } from "./domain.fixtures";

const saveTrade = vi.fn<(t: TradeRecord) => Promise<void>>(async () => {});
const deleteTrade = vi.fn<(id: string) => Promise<void>>(async () => {});

function seed(editor: { open: boolean; tradeId?: string; fromFab?: boolean }) {
  saveTrade.mockClear();
  deleteTrade.mockClear();
  useJournal.setState({ trades: SAMPLE, settings: settings(), loaded: true, mode: "local", saveTrade, deleteTrade });
  useUi.setState({ acc: "all", editor: { open: editor.open, tradeId: editor.tradeId, fromFab: editor.fromFab === true }, setupEditor: { open: false, fromTrade: false }, toasts: [] });
}

function mount(props: Partial<Parameters<typeof TradeEditor>[0]> = {}) {
  return render(
    <MotionRoot>
      <TradeEditor {...props} />
    </MotionRoot>,
  );
}

const input = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const type = (label: string, value: string) => fireEvent.change(input(label), { target: { value } });

describe("TradeEditor – pure helpers", () => {
  it("defaults: leverage 4 on scalp, empty on makro, pair from settings", () => {
    const s = settings();
    expect(defaultForm(s, "scalp").d.leverage).toBe("4");
    expect(defaultForm(s, "makro").d.leverage).toBe("");
    expect(defaultForm(s, "scalp").d.pair).toBe(s.pair);
    expect(defaultForm(s, "scalp").t).toMatchObject({ side: "long", status: "closed", setups: [], conviction: null });
  });
  it("validation order matches the bundle", () => {
    const base = defaultForm(settings(), "scalp");
    expect(validateRecord(toRecord({ ...base.d, date: "" }, base.t), "")).toBe("Bitte Datum angeben.");
    expect(validateRecord(toRecord(base.d, base.t), "")).toBe("Bitte einen Einstiegspreis angeben.");
    expect(validateRecord(toRecord({ ...base.d, entry: "80.000" }, base.t), "")).toBe("Bitte Ausstieg angeben oder P&L manuell eintragen.");
    expect(validateRecord(toRecord({ ...base.d, entry: "80000", exit: "81000" }, base.t), "")).toBe("Bitte Positionsgröße angeben oder P&L manuell eintragen.");
    expect(validateRecord(toRecord({ ...base.d, entry: "80000", pnlManual: "12,5" }, base.t), "")).toBeNull();
    expect(validateRecord(toRecord({ ...base.d, entry: "80000" }, { ...base.t, status: "open" }), "")).toBeNull();
    expect(validateRecord(toRecord({ ...base.d, entry: "80000", pnlManual: "1", chart: "tradingview.com/x" }, base.t), "tradingview.com/x")).toBe("Der Chart-Link muss mit https:// beginnen.");
  });
  it("Speichern & neu reset keeps pair/account/side/leverage/timeframe and clears the rest", () => {
    const base = defaultForm(settings(), "scalp");
    const filled = { ...base.d, entry: "1", exit: "2", size: "3", timeframe: "4h", notes: "x", chart: "https://a" };
    const typed = { ...base.t, side: "short" as const, status: "open" as const, setups: ["s_ml"], checks: { "g:trigger": true }, conviction: 3 as const, emotion: "FOMO" };
    const next = resetForNext(filled, typed);
    expect(next.d).toMatchObject({ entry: "", exit: "", size: "", notes: "", chart: "", timeframe: "4h", pair: base.d.pair, leverage: "4" });
    expect(next.t).toEqual({ ...typed, status: "closed", setups: [], checks: {}, conviction: null, followedPlan: null, emotion: "" });
  });
  it("live price → input string (4 decimals below 10, else 1)", () => {
    expect(livePriceInput(85900.55)).toBe("85900,6");
    expect(livePriceInput(0.12345)).toBe("0,1235");
  });
});

describe("TradeEditor – sheet", () => {
  beforeEach(() => seed({ open: true }));

  it("renders `Trade eintragen` with every section and field label", () => {
    mount();
    expect(screen.getByRole("dialog", { name: "Trade eintragen" })).toBeInTheDocument();
    for (const s of ["Eckdaten", "Preise & Größe", "Entscheidungsgrundlage", "Checkliste", "Überzeugung & Disziplin", "Review"]) {
      expect(screen.getByRole("heading", { level: 3, name: new RegExp(s) })).toBeInTheDocument();
    }
    for (const l of ["Datum & Uhrzeit", "Paar", "Timeframe", "Einstieg", "Stop-Loss", "Take-Profit", "Ausstieg", "Größe (USDT)", "Hebel", "Gebühren (USDT)", "P&L manuell", "Begründung", "Learnings & Notizen", "Chart-Link (TradingView)"]) {
      expect(screen.getByLabelText(l)).toBeInTheDocument();
    }
    expect(screen.getByRole("radiogroup", { name: "Richtung" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Noch offen" })).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "Überzeugung" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+ Neue Grundlage" })).toBeInTheDocument();
    expect(input("Hebel").value).toBe("4");
    expect(screen.getByText("Regel: 4x")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Speichern & neu" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Löschen" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Live-Preis/ })).not.toBeInTheDocument();
  });

  it("validates before saving and shows the error in the footer", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Bitte einen Einstiegspreis angeben.");
    expect(saveTrade).not.toHaveBeenCalled();
  });

  it("saves with derived pnl/r, toasts `Trade gespeichert` and closes", async () => {
    mount();
    type("Einstieg", "80000");
    type("Stop-Loss", "79000");
    type("Ausstieg", "84000");
    type("Größe (USDT)", "8000");
    type("Gebühren (USDT)", "4");
    expect(within(screen.getByRole("group", { name: "Live-Vorschau" })).getByLabelText("+396,00 USDT")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(saveTrade).toHaveBeenCalledTimes(1));
    const rec = saveTrade.mock.calls[0]?.[0];
    expect(rec).toMatchObject({ entry: 80000, stop: 79000, exit: 84000, size: 8000, fees: 4, pnl: 396, side: "long", status: "closed", account: "scalp", leverage: 4 });
    expect(rec?.r).toBeCloseTo(3.96, 6);
    expect(rec).not.toHaveProperty("id");
    await waitFor(() => expect(useUi.getState().editor.open).toBe(false));
    expect(useUi.getState().toasts.map((t) => [t.kind, t.title, t.value, t.valueTone])).toEqual([["success", "Trade gespeichert", "+396,00", "win"]]);
  });

  it("`Speichern & neu` saves, keeps the sheet open, resets the form and focuses `Einstieg`", async () => {
    mount();
    type("Einstieg", "80000");
    type("Ausstieg", "81000");
    type("Größe (USDT)", "1000");
    type("Learnings & Notizen", "notiz");
    fireEvent.click(screen.getByRole("radio", { name: "▼ Short" }));
    fireEvent.click(screen.getByRole("button", { name: "Speichern & neu" }));
    await waitFor(() => expect(saveTrade).toHaveBeenCalledTimes(1));
    expect(saveTrade.mock.calls[0]?.[0].side).toBe("short");
    await waitFor(() => expect(input("Einstieg").value).toBe(""));
    expect(useUi.getState().editor.open).toBe(true);
    expect(input("Ausstieg").value).toBe("");
    expect(input("Learnings & Notizen").value).toBe("");
    expect(input("Hebel").value).toBe("4");
    expect(screen.getByRole("radio", { name: "▼ Short" })).toHaveAttribute("aria-checked", "true");
    expect(document.activeElement).toBe(input("Einstieg"));
    expect(screen.getByRole("dialog", { name: "Trade eintragen" })).toBeInTheDocument();
  });

  it("reports a failed save inline and via toast, keeps the form", async () => {
    saveTrade.mockRejectedValueOnce(new Error("quota"));
    mount();
    type("Einstieg", "80000");
    type("P&L manuell", "12,5");
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Speichern fehlgeschlagen. Prüfe die Verbindung und versuch es erneut."));
    expect(useUi.getState().editor.open).toBe(true);
    expect(input("Einstieg").value).toBe("80000");
    expect(useUi.getState().toasts.map((t) => t.title)).toContain("Speichern fehlgeschlagen");
  });

  it("leverage warning above the account rule, `Ausstieg` disabled while open", () => {
    mount();
    type("Hebel", "5");
    expect(screen.getByText("Über deiner Regel (4x)")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Makro" }));
    expect(screen.queryByText("Über deiner Regel (4x)")).not.toBeInTheDocument();
    expect(screen.getByText("Regel: 2–5x")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Noch offen" }));
    expect(input("Ausstieg")).toBeDisabled();
  });

  it("`Live-Preis übernehmen` fills entry/exit (exit disabled while open) and confirms with ✓", async () => {
    mount({ livePrice: 85900.55 });
    const buttons = screen.getAllByRole("button", { name: "Live-Preis übernehmen" });
    expect(buttons).toHaveLength(2);
    fireEvent.click(buttons[0]!);
    expect(input("Einstieg").value).toBe("85900,6");
    expect(await screen.findByText("✓ 85.900,55")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Noch offen" }));
    expect(screen.getAllByRole("button", { name: /Live-Preis|✓ / })[1]).toBeDisabled();
  });

  it("checklist toggles and setup chips update the counter", () => {
    mount();
    expect(screen.getByText("0 von 5 erfüllt")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("checkbox")[0]!);
    expect(screen.getByText("1 von 5 erfüllt")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Makro-Long Support-Zone/ }));
    expect(screen.getByText(/1 von \d+ erfüllt/).textContent).not.toBe("1 von 5 erfüllt");
    expect(screen.getByRole("button", { name: /Makro-Long Support-Zone/ })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "+ Neue Grundlage" }));
    expect(useUi.getState().setupEditor).toEqual({ open: true, setupId: undefined, fromTrade: true });
  });
});

describe("TradeEditor – edit mode", () => {
  beforeEach(() => seed({ open: true, tradeId: "A" }));

  it("prefills the existing trade and saves with its id (`Trade aktualisiert`)", async () => {
    mount();
    expect(screen.getByRole("dialog", { name: "Trade bearbeiten" })).toBeInTheDocument();
    expect(input("Einstieg").value).toBe("80000");
    expect(input("Chart-Link (TradingView)").value).toBe("https://www.tradingview.com/x/abc");
    expect(screen.queryByRole("button", { name: "Speichern & neu" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(saveTrade).toHaveBeenCalledTimes(1));
    expect(saveTrade.mock.calls[0]?.[0]).toMatchObject({ id: "A", createdAt: "2026-01-01T00:00:00.000Z" });
    expect(useUi.getState().toasts[0]?.title).toBe("Trade aktualisiert");
  });

  it("inline delete confirmation `Wirklich löschen?` → deletes, toasts `Trade gelöscht`", async () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Löschen" }));
    expect(screen.getByText("Wirklich löschen?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Nein" }));
    expect(screen.queryByText("Wirklich löschen?")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Löschen" }));
    fireEvent.click(screen.getByRole("button", { name: "Ja, löschen" }));
    await waitFor(() => expect(deleteTrade).toHaveBeenCalledWith("A"));
    await waitFor(() => expect(useUi.getState().editor.open).toBe(false));
    expect(useUi.getState().toasts.map((t) => t.title)).toContain("Trade gelöscht");
  });

  it("`Abbrechen` and Escape close without saving", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Abbrechen" }));
    expect(useUi.getState().editor.open).toBe(false);
    act(() => useUi.getState().openEditor({ tradeId: "A" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(useUi.getState().editor.open).toBe(false);
    expect(saveTrade).not.toHaveBeenCalled();
  });
});
