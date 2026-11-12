import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HyblockForm } from "@/overlays/HyblockForm";
import { SETUP_EDITOR_STRINGS, SetupEditor, sameForm } from "@/overlays/SetupEditor";
import { bootJournal, resetJournal, useJournal } from "@/store/journalStore";
import { useUi } from "@/store/uiStore";
import { seedV0 } from "./store.fixture";

describe("SetupEditor · unsaved input is never discarded silently", () => {
  beforeEach(async () => {
    seedV0();
    resetJournal();
    await bootJournal({ autoBackup: false });
    useUi.setState({ toasts: [], setupEditor: { open: false, fromTrade: false } });
  });

  it("sameForm compares the saved meaning (trim, empty checklist rows ignored)", () => {
    const f = { id: "s", name: "A", desc: "", color: "#000", account: "both" as const, checklist: [{ id: "c1", text: "x" }] };
    expect(sameForm(f, { ...f, name: " A ", checklist: [...f.checklist, { id: "c2", text: " " }] })).toBe(true);
    expect(sameForm(f, { ...f, account: "scalp" })).toBe(false);
  });

  it("Abbrechen and Escape close an untouched editor at once", () => {
    const onClose = vi.fn();
    render(<SetupEditor open setupId="s_bo" fromTrade onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: SETUP_EDITOR_STRINGS.cancel }));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("setup-discard-confirm")).toBeNull();
  });

  it("with edits, Abbrechen asks first: Weiter bearbeiten keeps the input, Verwerfen closes", () => {
    const onClose = vi.fn();
    render(<SetupEditor open onClose={onClose} />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Halb fertig" } });
    fireEvent.click(screen.getByRole("button", { name: SETUP_EDITOR_STRINGS.cancel }));
    expect(onClose).not.toHaveBeenCalled();
    const ask = screen.getByTestId("setup-discard-confirm");
    expect(ask).toHaveTextContent(SETUP_EDITOR_STRINGS.discardAsk);
    fireEvent.click(within(ask).getByRole("button", { name: SETUP_EDITOR_STRINGS.keep }));
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Halb fertig");
    fireEvent.click(screen.getByRole("button", { name: SETUP_EDITOR_STRINGS.cancel }));
    fireEvent.click(within(screen.getByTestId("setup-discard-confirm")).getByRole("button", { name: SETUP_EDITOR_STRINGS.discard }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(useJournal.getState().settings.setups.some((s) => s.name === "Halb fertig")).toBe(false);
  });

  it("the Multi-TF Signal setup explains that the check ticks its items", () => {
    render(<SetupEditor open setupId="s_mtf" fromTrade onClose={() => {}} />);
    expect(screen.getByText(/Der Einstiegs-Check hakt diese Punkte beim Eintragen automatisch ab/)).toBeInTheDocument();
  });
});

describe("HyblockForm · Abbrechen with typed values asks first", () => {
  it("closes at once when untouched, asks after an edit", () => {
    const onClose = vi.fn();
    const { unmount } = render(<HyblockForm last={null} onClose={onClose} onSave={async () => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Abbrechen" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    unmount();
    render(<HyblockForm last={null} onClose={onClose} onSave={async () => {}} />);
    fireEvent.change(screen.getByLabelText("Whale-vs-Retail-Delta"), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "Abbrechen" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    const ask = screen.getByTestId("hyblock-discard-confirm");
    fireEvent.click(within(ask).getByRole("button", { name: "Weiter bearbeiten" }));
    expect((screen.getByLabelText("Whale-vs-Retail-Delta") as HTMLInputElement).value).toBe("12");
    fireEvent.click(screen.getByRole("button", { name: "Abbrechen" }));
    fireEvent.click(within(screen.getByTestId("hyblock-discard-confirm")).getByRole("button", { name: "Verwerfen" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
