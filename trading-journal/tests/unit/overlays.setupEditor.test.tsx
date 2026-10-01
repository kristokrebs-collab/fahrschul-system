import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SetupEditor, finalizeSetup, moveItem, upsertSetup } from "@/overlays/SetupEditor";
import { bootJournal, resetJournal, useJournal } from "@/store/journalStore";
import { useUi } from "@/store/uiStore";
import { seedV0 } from "./store.fixture";

describe("SetupEditor helpers", () => {
  it("finalizeSetup trims, assigns an s_ id and drops empty checklist items", () => {
    const out = finalizeSetup({ id: "", name: "  Neu ", desc: " d ", color: "#000", account: "both", checklist: [{ id: "c1", text: " a " }, { id: "c2", text: "  " }] });
    expect(out.id.startsWith("s_")).toBe(true);
    expect(out.name).toBe("Neu");
    expect(out.desc).toBe("d");
    expect(out.checklist).toEqual([{ id: "c1", text: "a" }]);
  });
  it("upsertSetup replaces by id or appends; moveItem reorders", () => {
    const base = useJournal.getState().settings;
    const s = { id: "s_bo", name: "x", desc: "", color: "#000", account: "scalp" as const, checklist: [] };
    expect(upsertSetup({ ...base, setups: [s] }, { ...s, name: "y" }).setups.map((x) => x.name)).toEqual(["y"]);
    expect(upsertSetup({ ...base, setups: [s] }, { ...s, id: "s_new" }).setups).toHaveLength(2);
    expect(moveItem([1, 2, 3], 0, 1)).toEqual([2, 1, 3]);
    expect(moveItem([1, 2, 3], 0, -1)).toEqual([1, 2, 3]);
  });
});

describe("SetupEditor", () => {
  beforeEach(async () => {
    seedV0();
    resetJournal();
    await bootJournal({ autoBackup: false });
    useUi.setState({ toasts: [], setupEditor: { open: false, fromTrade: false } });
  });

  it("creates a new setup with a checklist item and calls saveSettings", async () => {
    const onClose = vi.fn();
    const saveSpy = vi.fn(useJournal.getState().saveSettings);
    useJournal.setState({ saveSettings: saveSpy });
    render(<SetupEditor open onClose={onClose} />);
    expect(screen.getByRole("dialog", { name: "Neue Entscheidungsgrundlage" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Bitte einen Namen angeben.");

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Mein Setup" } });
    fireEvent.click(screen.getByRole("radio", { name: "Scalp" }));
    fireEvent.click(screen.getByRole("button", { name: "+ Punkt hinzufügen" }));
    fireEvent.click(screen.getByRole("button", { name: "+ Punkt hinzufügen" }));
    fireEvent.change(screen.getByLabelText("Punkt 1"), { target: { value: "Erster Punkt" } });
    fireEvent.change(screen.getByLabelText("Punkt 2"), { target: { value: "Zweiter Punkt" } });
    fireEvent.keyDown(screen.getByRole("button", { name: "Punkt 2 verschieben" }), { key: "ArrowUp" });
    expect((screen.getByLabelText("Punkt 1") as HTMLInputElement).value).toBe("Zweiter Punkt");
    fireEvent.click(screen.getByRole("radio", { name: "Farbe #c9975b" }));

    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(1));
    const saved = saveSpy.mock.calls[0]?.[0];
    const created = saved?.setups.find((s) => s.name === "Mein Setup");
    expect(created).toMatchObject({ account: "scalp", color: "#c9975b" });
    expect(created?.id.startsWith("s_")).toBe(true);
    expect(created?.checklist.map((c) => c.text)).toEqual(["Zweiter Punkt", "Erster Punkt"]);
    expect(created?.checklist.every((c) => c.id.startsWith("c"))).toBe(true);
    await waitFor(() => expect(useJournal.getState().settings.setups).toHaveLength(2));
    expect(useUi.getState().toasts.map((t) => t.title)).toContain("Grundlage angelegt");
    expect(onClose).toHaveBeenCalled();
  });

  it("edits an existing setup from the trade editor (no morph), shows usage and deletes with confirm", async () => {
    const onClose = vi.fn();
    render(<SetupEditor open setupId="s_bo" fromTrade onClose={onClose} />);
    expect(screen.getByRole("dialog", { name: "Grundlage bearbeiten" })).toBeInTheDocument();
    expect(screen.getByText("In 1 Trades verwendet")).toBeInTheDocument();
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("4H-Breakout über 85.900");

    fireEvent.click(screen.getByRole("button", { name: "Löschen" }));
    expect(screen.getByText("1 Trades verlieren die Zuordnung.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Nein" }));
    expect(screen.queryByText("1 Trades verlieren die Zuordnung.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Löschen" }));
    fireEvent.click(screen.getByRole("button", { name: "Ja" }));
    await waitFor(() => expect(useJournal.getState().settings.setups).toHaveLength(0));
    expect(useUi.getState().toasts.map((t) => t.title)).toContain("Grundlage gelöscht");
    expect(onClose).toHaveBeenCalled();
  });

  it("a completed hold on a setup in use opens the usage warning instead of deleting", async () => {
    render(<SetupEditor open setupId="s_bo" fromTrade onClose={vi.fn()} />);
    fireEvent.pointerDown(screen.getByRole("button", { name: "Löschen" }), { button: 0 });
    await screen.findByText("1 Trades verlieren die Zuordnung.", undefined, { timeout: 4000 });
    expect(useJournal.getState().settings.setups).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Ja" }));
    await waitFor(() => expect(useJournal.getState().settings.setups).toHaveLength(0));
  });
});
