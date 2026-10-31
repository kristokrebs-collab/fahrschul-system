/**
 * Journal-v3 sections of the trade editor (P06): `openEditor({ draft })`, fills fixing Einstieg / Größe / Ausstieg,
 * tags / rating / psyche saved, a legacy trade edited without touching v3 fields gaining no key, the leverage rule.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LEVERAGE_RULE, LEVERAGE_WARNING } from "@/domain/defaults";
import type { Trade } from "@/domain/types";
import { JOURNAL_KEYS, openRemainderMessage, originRecord, statusAfterFills, type FillRow } from "@/journal/editor/form";
import { MotionRoot } from "@/motion/MotionRoot";
import { TradeEditor, formFromDraft, draftExtras, type TradeRecord } from "@/overlays/TradeEditor";
import { useJournal } from "@/store/journalStore";
import { useUi } from "@/store/uiStore";
import { SAMPLE, settings } from "./domain.fixtures";
import { registerFlatForm } from "./editorLayout";

// the older specs test every field's data path: all fields stay on screen (the short form has its own specs)
registerFlatForm();

const saveTrade = vi.fn<(t: TradeRecord) => Promise<void>>(async () => {});

function seed(editor: Partial<ReturnType<typeof useUi.getState>["editor"]>) {
  saveTrade.mockClear();
  useJournal.setState({ trades: SAMPLE, settings: settings(), loaded: true, mode: "local", saveTrade });
  useUi.setState({ acc: "all", editor: { open: true, fromFab: false, ...editor }, setupEditor: { open: false, fromTrade: false }, toasts: [] });
}

const mount = () =>
  render(
    <MotionRoot>
      <TradeEditor />
    </MotionRoot>,
  );
const input = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const type = (label: string, value: string) => fireEvent.change(input(label), { target: { value } });
const saved = () => saveTrade.mock.calls[0]![0] as Trade;

describe("draft helpers", () => {
  it("formFromDraft fills the bundle fields and the v3 part; draftExtras keeps the keys the form does not edit", () => {
    const draft = { pair: "ETH/USDT", side: "short" as const, entry: 2500, stop: 2550, date: "2026-10-01T10:00:00", tags: ["Signal"], origin: { kind: "bot" as const, botId: "b1" }, positionId: "p1" };
    const f = formFromDraft(settings(), "scalp", draft);
    expect(f.d).toMatchObject({ pair: "ETH/USDT", entry: "2500", stop: "2550", date: "2026-10-01T10:00" });
    expect(f.t.side).toBe("short");
    expect(f.t.j?.tags).toEqual(["Signal"]);
    // the origin now goes through the form's „Herkunft“ (review F14) – a bot draft opens with „Bot · b1“
    expect(f.t.j).toMatchObject({ botOn: true, bot: "b1", originSrc: { kind: "bot", botId: "b1" } });
    expect(draftExtras(draft)).toEqual({ positionId: "p1" });
  });
});

describe("TradeEditor – Journal v3", () => {
  beforeEach(() => seed({}));

  it("shows the new sections", () => {
    mount();
    for (const s of ["Ausführung", "Psyche", "Screenshots"]) expect(screen.getByRole("heading", { level: 4, name: new RegExp(`^${s}`) })).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "Bewertung" })).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "Stress" })).toBeInTheDocument();
    expect(screen.getByTestId("shots-drop")).toBeInTheDocument();
  });

  it("a draft opens pre-filled; its extra keys (origin, positionId) are saved with the trade", async () => {
    seed({ draft: { pair: "ETH/USDT", side: "short", entry: 2500, stop: 2550, tags: ["Signal"], origin: { kind: "bot", botId: "b1" }, positionId: "p1" }, draftSeq: 1 });
    mount();
    expect(input("Paar").value).toBe("ETH/USDT");
    expect(input("Einstieg").value).toBe("2500");
    expect(screen.getByRole("button", { name: "Tag „Signal“ entfernen" })).toBeInTheDocument();
    type("Ausstieg", "2400");
    type("Größe (USDT)", "1000");
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(saveTrade).toHaveBeenCalledTimes(1));
    expect(saved()).toMatchObject({ pair: "ETH/USDT", side: "short", entry: 2500, tags: ["Signal"], origin: { kind: "bot", botId: "b1" }, positionId: "p1" });
  });

  it("fills fix Einstieg / Größe / Ausstieg (disabled, Ø); tags, rating and psyche are saved", { timeout: 20_000 }, async () => {
    mount();
    type("Stop-Loss", "83000");
    fireEvent.click(screen.getByRole("button", { name: "+ Einstieg" }));
    type("Fill 1 Preis", "84000");
    type("Fill 1 Menge", "0,1");
    fireEvent.click(screen.getByRole("button", { name: "+ Nachkauf" }));
    type("Fill 2 Preis", "83600");
    type("Fill 2 Menge", "0,1");
    fireEvent.click(screen.getByRole("button", { name: "+ Teil-Exit" }));
    type("Fill 3 Preis", "85000");
    type("Fill 3 Menge", "0,2");
    expect(input("Einstieg").value).toBe("83800");
    expect(input("Einstieg")).toBeDisabled();
    expect(input("Ausstieg").value).toBe("85000");
    expect(input("Größe (USDT)").value).toBe("16760");
    fireEvent.change(screen.getByLabelText("Neuer Tag"), { target: { value: "Range-Low" } });
    fireEvent.keyDown(screen.getByLabelText("Neuer Tag"), { key: "Enter" });
    fireEvent.click(screen.getByRole("radio", { name: "4 von 5 · Stark" }));
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Stress" })).getByRole("radio", { name: /^2/ }));
    fireEvent.click(within(screen.getByRole("group", { name: "Verhalten" })).getByRole("button", { name: "Tilt" }));
    fireEvent.click(screen.getByRole("button", { name: "Ziel erreicht" }));
    expect(input("Exit-Grund").value).toBe(""); // a chosen chip is not repeated in the text field
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(saveTrade).toHaveBeenCalledTimes(1));
    const t = saved();
    expect(t).toMatchObject({ entry: 83800, exit: 85000, size: 16760, qty: 0.2, tags: ["Range-Low"], rating: 4, psych: { stress: 2, flags: ["tilt"], exitReason: "Ziel erreicht" } });
    expect(t.fills?.map((f) => f.kind)).toEqual(["entry", "add", "exit"]);
    expect(t.pnl).toBeCloseTo(240, 6);
  });

  it("a partial exit switches the status to „Noch offen“ and saves; forced „Geschlossen“ names what is open (F4)", async () => {
    mount();
    fireEvent.click(screen.getByRole("radio", { name: "▼ Short" }));
    type("Stop-Loss", "85500");
    fireEvent.click(screen.getByRole("button", { name: "+ Einstieg" }));
    type("Fill 1 Preis", "84000");
    type("Fill 1 Menge", "0,2");
    fireEvent.click(screen.getByRole("button", { name: "+ Teil-Exit" }));
    type("Fill 2 Preis", "83000");
    type("Fill 2 Menge", "0,1");
    expect(screen.getByRole("radio", { name: "Noch offen" })).toHaveAttribute("aria-checked", "true");
    // the trader insists on „Geschlossen“: the message says what is open and how to go on
    fireEvent.click(screen.getByRole("radio", { name: "Geschlossen" }));
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    expect(screen.getByRole("alert")).toHaveTextContent("0,1 noch offen – Status „Noch offen“ wählen oder den Rest-Exit eintragen.");
    expect(saveTrade).not.toHaveBeenCalled();
    // the rest exit closes the position: saved as closed with the Ø exit
    fireEvent.click(screen.getByRole("button", { name: "+ Teil-Exit" }));
    type("Fill 3 Preis", "82000");
    type("Fill 3 Menge", "0,1");
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(saveTrade).toHaveBeenCalledTimes(1));
    expect(saved()).toMatchObject({ side: "short", status: "closed", entry: 84000, exit: 82500 });
  });

  it("a partial exit alone saves as an open trade", async () => {
    mount();
    fireEvent.click(screen.getByRole("radio", { name: "▼ Short" }));
    type("Stop-Loss", "85500");
    fireEvent.click(screen.getByRole("button", { name: "+ Einstieg" }));
    type("Fill 1 Preis", "84000");
    type("Fill 1 Menge", "0,2");
    fireEvent.click(screen.getByRole("button", { name: "+ Teil-Exit" }));
    type("Fill 2 Preis", "83000");
    type("Fill 2 Menge", "0,1");
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(saveTrade).toHaveBeenCalledTimes(1));
    expect(saved()).toMatchObject({ status: "open", exit: null });
    expect(saved().fills?.map((f) => f.kind)).toEqual(["entry", "partial"]);
  });

  it("statusAfterFills: open remainder → open, flat again → back, a typed exit or the trader's open stays (F4)", () => {
    const row = (id: string, side: "open" | "close", price: string, qty: string): FillRow => ({ id, at: "", side, price, qty, fee: "" });
    const partial = [row("a", "open", "84000", "0,2"), row("b", "close", "83000", "0,1")];
    const flat = [...partial, row("c", "close", "82000", "0,1")];
    const ctx = { side: "short" as const, status: "closed" as const, exit: "", pnlManual: "", autoOpened: false };
    expect(statusAfterFills(partial, ctx)).toEqual({ status: "open", autoOpened: true });
    expect(statusAfterFills(flat, { ...ctx, status: "open", autoOpened: true })).toEqual({ status: "closed", autoOpened: false });
    expect(statusAfterFills(flat, { ...ctx, status: "open", autoOpened: false })).toEqual({ status: "open", autoOpened: false });
    expect(statusAfterFills(partial, { ...ctx, exit: "83500" })).toEqual({ status: "closed", autoOpened: false });
    expect(statusAfterFills(partial, { ...ctx, pnlManual: "50" }).status).toBe("closed");
    expect(statusAfterFills([], ctx).status).toBe("closed");
    expect(openRemainderMessage(0.1)).toBe("0,1 noch offen – Status „Noch offen“ wählen oder den Rest-Exit eintragen.");
  });

  it("Herkunft: a hand-entered trade marked as a bot is saved with origin bot + name; cleared again it is manual (F14)", async () => {
    mount();
    type("Einstieg", "80000");
    type("Ausstieg", "81000");
    type("Größe (USDT)", "1000");
    expect(screen.queryByLabelText("Bot-Name")).toBeNull();
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Herkunft" })).getByRole("radio", { name: "Bot" }));
    type("Bot-Name", "  Grid BTC ");
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(saveTrade).toHaveBeenCalledTimes(1));
    expect(saved().origin).toEqual({ kind: "bot", botId: "Grid BTC" });
  });

  it("Herkunft of a synced trade is shown, never rewritten by the form (F14)", async () => {
    const synced = { ...SAMPLE[0]!, id: "SYNC", origin: { kind: "api" as const }, syncSource: "bitunix" };
    useJournal.setState({ trades: [...SAMPLE, synced] });
    seed({ tradeId: "SYNC" });
    useJournal.setState({ trades: [...SAMPLE, synced] });
    mount();
    expect(screen.getByTestId("origin-fixed")).toHaveTextContent("Börsen-Sync");
    expect(screen.queryByRole("radiogroup", { name: "Herkunft" })).toBeNull();
    type("Learnings & Notizen", "geprüft");
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(saveTrade).toHaveBeenCalledTimes(1));
    expect(saved().origin).toEqual({ kind: "api" });
  });

  it("originRecord: bot with / without name, manual kept, none stays none, imports untouched", () => {
    const base = { botOn: false, bot: "", originSrc: null };
    expect(originRecord(base)).toBeUndefined();
    expect(originRecord({ ...base, botOn: true })).toEqual({ kind: "bot" });
    expect(originRecord({ ...base, botOn: true, bot: "x".repeat(50) })).toEqual({ kind: "bot", botId: "x".repeat(40) });
    expect(originRecord({ ...base, originSrc: { kind: "manual" } })).toEqual({ kind: "manual" });
    expect(originRecord({ ...base, originSrc: { kind: "bot", botId: "old" } })).toBeUndefined(); // switched back to Manuell
    expect(originRecord({ botOn: true, bot: "", originSrc: { kind: "csv" } })).toEqual({ kind: "csv" });
  });

  it("an incomplete fill blocks saving with its message", () => {
    mount();
    type("Einstieg", "80000");
    type("Ausstieg", "81000");
    type("Größe (USDT)", "1000");
    fireEvent.click(screen.getByRole("button", { name: "+ Einstieg" }));
    type("Fill 1 Preis", "84000");
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Ein Fill ist unvollständig: Preis und Menge angeben.");
    expect(saveTrade).not.toHaveBeenCalled();
  });

  it("editing a legacy trade without touching the v3 fields writes no v3 key", async () => {
    seed({ tradeId: "A" });
    mount();
    type("Learnings & Notizen", "nur Notiz");
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(saveTrade).toHaveBeenCalledTimes(1));
    const t = saved() as unknown as Record<string, unknown>;
    expect(t.notes).toBe("nur Notiz");
    for (const k of JOURNAL_KEYS) expect(k in t).toBe(false);
  });

  it("the leverage warning follows the edition's rule (`ED.LEVERAGE_RULE`)", () => {
    mount();
    type("Hebel", String(LEVERAGE_RULE.scalp));
    expect(screen.queryByText(LEVERAGE_WARNING.scalp)).toBeNull();
    type("Hebel", String(LEVERAGE_RULE.scalp + 1));
    expect(screen.getByText(LEVERAGE_WARNING.scalp)).toBeInTheDocument();
  });
});
