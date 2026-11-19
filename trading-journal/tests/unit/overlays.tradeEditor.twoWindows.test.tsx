/**
 * Funktionsprüfung Runde 18 (account pass): the same trade open in two windows. Window A saved a note; window B, whose form was
 * already open, saved a reason – and A's note was gone without a word (the form wrote every field back). What another window
 * saved since the form was filled now stays for every field this form did not touch.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MotionRoot } from "@/motion/MotionRoot";
import { foreignEdits } from "@/overlays/editMerge";
import { EDITOR_MESSAGES, TradeEditor, type TradeRecord } from "@/overlays/TradeEditor";
import { useJournal } from "@/store/journalStore";
import { useUi } from "@/store/uiStore";
import { SAMPLE, settings } from "./domain.fixtures";
import { registerFlatForm } from "./editorLayout";

registerFlatForm();

const saveTrade = vi.fn<(t: TradeRecord) => Promise<void>>(async () => {});

function mount() {
  return render(
    <MotionRoot>
      <TradeEditor />
    </MotionRoot>,
  );
}

const input = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const type = (label: string, value: string) => fireEvent.change(input(label), { target: { value } });
/** Another window saved the trade: the store publishes the new record (as the `storage` event / the sync does). */
const otherWindowSaves = (patch: Record<string, unknown>) =>
  act(() => useJournal.setState({ trades: useJournal.getState().trades.map((t) => (t.id === "A" ? ({ ...t, ...patch, updatedAt: "2026-11-19T10:00:00.000Z" } as typeof t) : t)) }));

describe("foreignEdits (pure)", () => {
  const opened = { notes: "", reason: "alt", exit: 81000, tags: ["a"] };
  const form = { notes: "", reason: "alt", exit: 81000, tags: ["a"] };

  it("a field this form did not touch takes what was stored meanwhile; a field changed here wins", () => {
    const current = { ...opened, notes: "Notiz aus Fenster A", reason: "auch geändert" };
    expect(foreignEdits(opened, current, form, { ...form, reason: "Begründung aus Fenster B" })).toEqual({ notes: "Notiz aus Fenster A" });
  });

  it("nothing changed underneath (same object, or equal content): null", () => {
    expect(foreignEdits(opened, opened, form, { ...form, reason: "x" })).toBeNull();
    expect(foreignEdits(opened, { ...opened, tags: ["a"] }, form, form)).toBeNull();
  });

  it("stored values are compared with stored values: a field the form only spells differently is no edit", () => {
    // the store has no `notes` key, the form shows "" – untouched here, changed there → theirs
    const o = { reason: "alt" } as Record<string, unknown>;
    expect(foreignEdits(o, { ...o, notes: "neu" }, { reason: "alt", notes: "" }, { reason: "alt", notes: "" })).toEqual({ notes: "neu" });
  });
});

describe("TradeEditor – the same trade saved in another window while this form is open", () => {
  beforeEach(() => {
    saveTrade.mockClear();
    useJournal.setState({ trades: SAMPLE, settings: settings(), loaded: true, mode: "local", saveTrade });
    useUi.setState({ acc: "all", editor: { open: true, tradeId: "A", fromFab: false }, setupEditor: { open: false, fromTrade: false }, toasts: [] });
  });

  it("the other window's note survives this window's save of another field, and the toast says so", async () => {
    mount();
    expect(screen.getByRole("dialog", { name: "Trade bearbeiten" })).toBeInTheDocument();
    otherWindowSaves({ notes: "Notiz aus Fenster A" });
    type("Begründung", "Begründung aus Fenster B");
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(saveTrade).toHaveBeenCalledTimes(1));
    expect(saveTrade.mock.calls[0]?.[0]).toMatchObject({ id: "A", notes: "Notiz aus Fenster A", reason: "Begründung aus Fenster B" });
    expect(useUi.getState().toasts[0]).toMatchObject({ title: "Trade aktualisiert", detail: EDITOR_MESSAGES.foreignKept });
  });

  it("the other window moved the exit: the result is derived from the exit as saved, not from this form's old one", async () => {
    mount();
    const before = SAMPLE.find((t) => t.id === "A")!;
    otherWindowSaves({ exit: (before.exit ?? 0) + 500 });
    type("Begründung", "nur die Begründung");
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(saveTrade).toHaveBeenCalledTimes(1));
    const saved = saveTrade.mock.calls[0]![0];
    expect(saved.exit).toBe((before.exit ?? 0) + 500);
    expect(saved.pnl).not.toBe(before.pnl);
  });

  it("a field changed in BOTH windows: this window's explicit save wins", async () => {
    mount();
    otherWindowSaves({ reason: "aus Fenster A" });
    type("Begründung", "aus Fenster B");
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(saveTrade).toHaveBeenCalledTimes(1));
    expect(saveTrade.mock.calls[0]?.[0]).toMatchObject({ reason: "aus Fenster B" });
  });

  it("nothing saved elsewhere: the save is what it always was, without the extra line", async () => {
    mount();
    type("Begründung", "allein");
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(saveTrade).toHaveBeenCalledTimes(1));
    expect(useUi.getState().toasts[0]?.detail).toBeUndefined();
  });
});

describe("TradeEditor – a save the browser's storage refused", () => {
  beforeEach(() => {
    useJournal.setState({ trades: SAMPLE, settings: settings(), loaded: true, mode: "local", saveTrade });
    useUi.setState({ acc: "all", editor: { open: true, tradeId: "A", fromFab: false }, setupEditor: { open: false, fromTrade: false }, toasts: [] });
  });

  it("storage full: the message names the storage, not „die Verbindung“ (Runde 18), and the form stays open with the input", async () => {
    const { StorageWriteError } = await import("@/store/storage");
    saveTrade.mockReset();
    saveTrade.mockRejectedValueOnce(new StorageWriteError(Object.assign(new Error("full"), { name: "QuotaExceededError" })));
    mount();
    type("Begründung", "bleibt stehen");
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    expect(await screen.findByText(EDITOR_MESSAGES.saveFailedFull)).toBeInTheDocument();
    expect(EDITOR_MESSAGES.saveFailedFull).not.toMatch(/Verbindung/);
    expect(input("Begründung").value).toBe("bleibt stehen");
    expect(useUi.getState().toasts[0]).toMatchObject({ kind: "error", detail: "Der Speicher dieses Browsers ist voll." });
    saveTrade.mockReset();
    saveTrade.mockImplementation(async () => {});
  });
});
