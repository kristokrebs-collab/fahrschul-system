import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ImportDialog } from "@/overlays/ImportDialog";
import { bootJournal, resetJournal, useJournal } from "@/store/journalStore";
import { useUi } from "@/store/uiStore";
import { seedV0 } from "./store.fixture";

function backupText(): string {
  const s = useJournal.getState();
  const t0 = s.trades[0];
  if (!t0) throw new Error("fixture");
  return JSON.stringify({
    exportedAt: "2026-09-29T12:00:00.000Z",
    settings: s.settings,
    trades: [{ ...t0, id: "t_imported", notes: "imported" }],
    hyblock: [],
    schemaVersion: 1,
  });
}

describe("ImportDialog", () => {
  beforeEach(async () => {
    seedV0();
    resetJournal();
    await bootJournal({ autoBackup: false });
    useUi.setState({ toasts: [] });
  });

  it("previews the file and merges it into the journal", async () => {
    const onClose = vi.fn();
    const text = backupText();
    render(<ImportDialog open onClose={onClose} readFile={async () => text} />);
    expect(screen.getByRole("dialog", { name: "Backup importieren" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Importieren" })).toBeDisabled();

    const file = new File([text], "trade-journal-2026-09-29.json", { type: "application/json" });
    fireEvent.change(screen.getByLabelText("Backup-Datei"), { target: { files: [file] } });
    await waitFor(() => expect(screen.getByTestId("import-preview-text")).toHaveTextContent("1 Trades, 2 Grundlagen, 0 Ablesungen · exportiert am 29.09.26"));
    expect(screen.getByText("Datei: trade-journal-2026-09-29.json")).toBeInTheDocument();

    expect(screen.getByRole("radio", { name: "Zusammenführen" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("button", { name: "Importieren" }));
    await waitFor(() => expect(useJournal.getState().trades).toHaveLength(3));
    expect(useJournal.getState().trades.find((t) => t.id === "t_imported")?.notes).toBe("imported");
    expect(useUi.getState().toasts.map((t) => t.title)).toContain("Backup importiert");
    expect(onClose).toHaveBeenCalled();
    expect(Object.keys(localStorage).some((k) => k.startsWith("tj2-backup-import-"))).toBe(true);
  });

  it("asks before replacing and shows parse errors inline", async () => {
    const onClose = vi.fn();
    const { rerender } = render(<ImportDialog open onClose={onClose} readFile={async () => "{"} />);
    fireEvent.change(screen.getByLabelText("Backup-Datei"), { target: { files: [new File(["{"], "x.json")] } });
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Import fehlgeschlagen: Kein gültiges JSON"));

    const text = backupText();
    rerender(<ImportDialog open onClose={onClose} readFile={async () => text} />);
    fireEvent.change(screen.getByLabelText("Backup-Datei"), { target: { files: [new File([text], "y.json")] } });
    await waitFor(() => expect(screen.getByTestId("import-preview")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("radio", { name: "Ersetzen" }));
    fireEvent.click(screen.getByRole("button", { name: "Importieren" }));
    expect(screen.getByText("Alles ersetzen?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Nein" }));
    expect(screen.queryByText("Alles ersetzen?")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Importieren" }));
    fireEvent.click(screen.getByRole("button", { name: "Ja" }));
    await waitFor(() => expect(useJournal.getState().trades).toHaveLength(1));
    expect(useJournal.getState().trades[0]?.id).toBe("t_imported");
  });
});
