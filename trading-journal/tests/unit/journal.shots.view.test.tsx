/**
 * Screenshot originals in the interface (A2): the viewer says original vs. shrunk version and offers „Original ansehen“ /
 * „Original herunterladen“ (the exact bytes under the file's own name), the editor says when a picture is not saved
 * durably and offers the original as a download, and the import preview reads a „Backup mit Bildern“ ZIP.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { JsonBackup, ScreenshotRef, Trade } from "@/domain/types";
import { buildBackupZip } from "@/journal/screenshots/backupZip";
import { ShotLightbox } from "@/journal/screenshots/ShotLightbox";
import { ShotsField } from "@/journal/screenshots/ShotsField";
import { ShotThumb } from "@/journal/screenshots/ShotThumb";
import { putShotBlob, resetShotStoreForTests } from "@/journal/screenshots/store";
import { MotionRoot } from "@/motion/MotionRoot";
import { ImportDialog } from "@/overlays/ImportDialog";
import { useUi } from "@/store/uiStore";
import { mkTrade } from "./domain.fixtures";

const bytes = (n: number, seed = 1) => new Uint8Array(Array.from({ length: n }, (_, i) => (i * 31 + seed) & 0xff));
const png = (n: number, seed = 1) => {
  const u = bytes(n, seed);
  u.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(u.buffer).setUint32(16, 800);
  new DataView(u.buffer).setUint32(20, 600);
  return u;
};
const hex = async (b: Blob) => {
  const d = await crypto.subtle?.digest("SHA-256", await b.arrayBuffer());
  return d ? [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("") : "";
};

let saved: { name: string; blob: Blob }[] = [];
const created = new Map<string, Blob>();
beforeEach(() => {
  saved = [];
  created.clear();
  let n = 0;
  URL.createObjectURL = vi.fn((b: Blob | MediaSource) => {
    const u = `blob:test-${(n += 1)}`;
    created.set(u, b as Blob);
    return u;
  });
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    saved.push({ name: this.download, blob: created.get(this.href)! });
  });
  useUi.setState({ toasts: [] });
});
afterEach(() => {
  vi.restoreAllMocks();
  resetShotStoreForTests();
});

describe("viewer", () => {
  it("an original says so, shows the preview first, lays the original over it on request and downloads the exact bytes under the file's name", async () => {
    const u = png(5000);
    const key = await putShotBlob(new Blob([u as BlobPart], { type: "image/png" }), "shot_a");
    const ref: ScreenshotRef = { id: "a", store: "idb", key, mime: "image/png", w: 800, h: 600, bytes: u.length, sha256: await hex(new Blob([u as BlobPart])), original: true, originalName: "BTC 4h.png", storage: "device" };
    render(
      <MotionRoot>
        <ShotLightbox shots={[ref]} index={0} onIndex={() => undefined} onClose={() => undefined} />
      </MotionRoot>,
    );
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByTestId("shot-facts")).toHaveTextContent("Original · PNG · 800 × 600 · 5 KB");
    if (ref.sha256) expect(within(dialog).getByTestId("shot-facts")).toHaveTextContent(`SHA-256 ${ref.sha256.slice(0, 10)}`);
    expect(within(dialog).queryByTestId("shot-original-layer")).toBeNull();
    fireEvent.click(within(dialog).getByTestId("shot-view-original"));
    expect(await within(dialog).findByTestId("shot-original-layer")).toBeInTheDocument();
    expect(within(dialog).getByTestId("shot-view-original")).toHaveTextContent("Vorschau zeigen");
    fireEvent.click(within(dialog).getByTestId("shot-download-original"));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]!.name).toBe("BTC 4h.png");
    expect(new Uint8Array(await saved[0]!.blob.arrayBuffer())).toEqual(u);
    await waitFor(() => expect(useUi.getState().toasts.map((t) => t.title)).toContain("Original heruntergeladen"));
  });

  it("an older picture is a „Version (verkleinert)“: no „Original“ wording anywhere", async () => {
    const key = await putShotBlob(new Blob([png(900) as BlobPart], { type: "image/webp" }), "shot_old");
    const ref: ScreenshotRef = { id: "old", store: "idb", key, mime: "image/webp", w: 2000, h: 1000 };
    render(
      <MotionRoot>
        <ShotLightbox shots={[ref]} index={0} onIndex={() => undefined} onClose={() => undefined} />
      </MotionRoot>,
    );
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByTestId("shot-facts")).toHaveTextContent("Version (verkleinert)");
    expect(dialog).not.toHaveTextContent(/Original ansehen|Original herunterladen/);
    expect(within(dialog).getByTestId("shot-download-original")).toHaveTextContent("Version herunterladen");
  });

  it("a thumbnail marks a shrunk version and a picture that is only in memory", () => {
    const { rerender } = render(<ShotThumb shot={{ id: "x", store: "idb", key: "k" }} index={0} onOpen={() => undefined} badge />);
    expect(screen.getByRole("button", { name: "Screenshot 1 öffnen" })).toHaveTextContent("Lokal");
    expect(screen.getByRole("button", { name: "Screenshot 1 öffnen" })).toHaveTextContent("verkleinert");
    rerender(<ShotThumb shot={{ id: "x", store: "idb", key: "k", original: true, storage: "ram" }} index={0} onOpen={() => undefined} badge />);
    expect(screen.getByRole("button", { name: "Screenshot 1 öffnen" })).toHaveTextContent("Nur Sitzung");
    expect(screen.getByRole("button", { name: "Screenshot 1 öffnen" })).not.toHaveTextContent("verkleinert");
  });
});

describe("editor field without a durable store (jsdom has no IndexedDB)", () => {
  function Harness() {
    const [shots, setShots] = useState<ScreenshotRef[]>([]);
    return (
      <MotionRoot>
        <ShotsField value={shots} onChange={setShots} />
      </MotionRoot>
    );
  }

  it("says „nicht dauerhaft gespeichert“ and downloads the original unchanged", async () => {
    render(<Harness />);
    expect(screen.getByText(/Nicht dauerhaft gespeichert: Dieser Browser erlaubt keinen lokalen Bildspeicher/)).toBeInTheDocument();
    const u = png(3000, 5);
    const file = new File([u as BlobPart], "chart.png", { type: "image/png" });
    fireEvent.change(screen.getByTestId("shots-drop").querySelector('input[type="file"]')!, { target: { files: [file] } });
    const panel = await screen.findByTestId("shots-ram");
    expect(panel).toHaveTextContent("1 Bild ist nicht dauerhaft gespeichert");
    expect(screen.getByRole("button", { name: "Screenshot 1 öffnen" })).toHaveTextContent("Nur Sitzung");
    fireEvent.click(within(panel).getByTestId("shots-ram-download"));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]!.name).toBe("chart.png");
    expect(new Uint8Array(await saved[0]!.blob.arrayBuffer())).toEqual(u);
  });
});

describe("import dialog reads a ZIP", () => {
  it("previews trades and pictures of a „Backup mit Bildern“ and names what is missing", async () => {
    const u = png(4000, 9);
    await putShotBlob(new Blob([u as BlobPart], { type: "image/png" }), "shot_z1");
    const trade: Trade = { ...mkTrade({ id: "t", date: "2026-03-01T10:00", entry: 1, exit: 2, size: 1 }), screenshots: [{ id: "z1", store: "idb", key: "shot_z1", mime: "image/png", original: true }, { id: "z2", store: "idb", key: "shot_z2", mime: "image/png" }] };
    const backup = { exportedAt: "2026-03-02T00:00:00.000Z", settings: {}, trades: [trade], schemaVersion: 1 } as unknown as JsonBackup & Record<string, unknown>;
    const built = await buildBackupZip({ trades: [trade], backup });
    render(
      <MotionRoot>
        <ImportDialog open onClose={() => undefined} readFile={(f) => f.text()} />
      </MotionRoot>,
    );
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input.accept).toContain(".zip");
    fireEvent.change(input, { target: { files: [new File([built.blob], "backup.zip", { type: "application/zip" })] } });
    await waitFor(() => expect(screen.getByTestId("import-shots")).toHaveTextContent("inkl. 1 Screenshot als Original"));
    expect(screen.getByTestId("import-shots-missing")).toHaveTextContent("1 Screenshot war beim Export nicht erreichbar");
    expect(screen.getByTestId("import-preview-text")).toHaveTextContent("1 Trades");
  });

  it("a broken ZIP shows the reason instead of a preview", async () => {
    render(
      <MotionRoot>
        <ImportDialog open onClose={() => undefined} readFile={(f) => f.text()} />
      </MotionRoot>,
    );
    fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [new File(["PK\u0003\u0004 this is not really a zip archive at all"], "x.zip", { type: "application/zip" })] } });
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Import fehlgeschlagen"));
  });
});
