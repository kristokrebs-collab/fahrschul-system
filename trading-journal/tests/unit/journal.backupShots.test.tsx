/**
 * Screenshots in backups (Review F08): the plain JSON backup carries only references – Daten says so and offers
 * „Backup mit Bildern“, the import preview says what a file carries or lacks, and an import puts the pictures back.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ScreenshotRef, Trade } from "@/domain/types";
import { backupShotInfo, collectBackupShots, localShotCount, restoreShotsFromBackup } from "@/journal/screenshots/backupShots";
import { getShotBlob, putShotBlob, resetShotStoreForTests } from "@/journal/screenshots/store";
import { MotionRoot } from "@/motion/MotionRoot";
import { ImportDialog } from "@/overlays/ImportDialog";
import { mkTrade } from "./domain.fixtures";

const png = (n = 16) => new Blob([new Uint8Array(Array.from({ length: n }, (_, i) => i))], { type: "image/png" });
const withShots = (id: string, shots: ScreenshotRef[]): Trade => ({ ...mkTrade({ id, date: "2026-03-01T10:00", entry: 1, exit: 2, size: 1 }), screenshots: shots });

afterEach(() => resetShotStoreForTests());

describe("backup with pictures", () => {
  it("counts only the pictures that live in this browser; embeds them and the offline copies of cloud pictures", async () => {
    const trades = [
      withShots("a", [{ id: "1", store: "idb", key: "shot_a1" }, { id: "2", store: "url", url: "https://x" }]),
      withShots("b", [{ id: "3", store: "cloud", key: "u/3.png", cacheKey: "shot_c3" } as ScreenshotRef, { id: "4", store: "idb", key: "shot_a1" }]),
    ];
    expect(localShotCount(trades)).toBe(1);
    await putShotBlob(png(), "shot_a1");
    await putShotBlob(png(8), "shot_c3");
    const shots = await collectBackupShots(trades);
    expect(Object.keys(shots).sort()).toEqual(["shot_a1", "shot_c3"]);
    expect(shots.shot_a1!.mime).toBe("image/png");
    // round trip into a fresh store
    const text = JSON.stringify({ exportedAt: "2026-03-02", settings: {}, trades, screenshots: shots });
    resetShotStoreForTests();
    expect(await getShotBlob("shot_a1")).toBeUndefined();
    expect(backupShotInfo(text)).toEqual({ embedded: 2, missing: 0 });
    expect(await restoreShotsFromBackup(text)).toBe(2);
    const back = await getShotBlob("shot_a1");
    expect(back?.size).toBe(16);
    expect(new Uint8Array(await back!.arrayBuffer())[5]).toBe(5);
  });

  it("a plain backup with local references says what is missing; hostile keys and non-images are skipped", async () => {
    const trades = [withShots("a", [{ id: "1", store: "idb", key: "shot_a1" }])];
    expect(backupShotInfo(JSON.stringify({ trades }))).toEqual({ embedded: 0, missing: 1 });
    const bad = JSON.stringify({ trades, screenshots: { "../x": { mime: "image/png", data: "AA==" }, shot_t: { mime: "text/html", data: "AA==" } } });
    expect(await restoreShotsFromBackup(bad)).toBe(0);
  });

  it("the import preview names the missing pictures", async () => {
    const trades = [withShots("a", [{ id: "1", store: "idb", key: "shot_a1" }, { id: "2", store: "idb", key: "shot_a2" }])];
    const file = new File([JSON.stringify({ exportedAt: "2026-03-02T00:00:00.000Z", trades })], "backup.json", { type: "application/json" });
    render(
      <MotionRoot>
        <ImportDialog open onClose={() => undefined} readFile={(f) => f.text()} />
      </MotionRoot>,
    );
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(screen.getByTestId("import-shots-missing")).toHaveTextContent("2 Screenshots sind nicht enthalten"));
  });
});
