/**
 * Screenshots (Journal v3, P06): intake rules, the local blob store (memory fallback without IndexedDB, as in jsdom),
 * garbage collection, reference helpers and the drop zone of the editor section.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ScreenshotRef } from "@/domain/types";
import { IntakeError, INTAKE_MESSAGES, MAX_INPUT_BYTES, fitSize, imagesOf, isImage, prepareImage } from "@/journal/screenshots/image";
import { MAX_SHOTS, addShots, promoteToCloud, shotPlace, shotUrl } from "@/journal/screenshots/shots";
import { ShotsField } from "@/journal/screenshots/ShotsField";
import { collectShotGarbage, deleteShotBlob, getShotBlob, listShotKeys, localKeyOf, putShotBlob, referencedShotKeys, resetShotStoreForTests, shotStorage } from "@/journal/screenshots/store";
import { MotionRoot } from "@/motion/MotionRoot";
import { useUi } from "@/store/uiStore";

const png = (bytes = 8) => new Blob([new Uint8Array(bytes)], { type: "image/png" });

afterEach(() => resetShotStoreForTests());

describe("image intake", () => {
  it("images only, at most 15 MB; never upscales, keeps the ratio", async () => {
    expect(isImage(png())).toBe(true);
    expect(isImage(new Blob(["x"], { type: "text/plain" }))).toBe(false);
    await expect(prepareImage(new Blob(["x"], { type: "application/pdf" }))).rejects.toMatchObject({ problem: "type" });
    const huge = { type: "image/png", size: MAX_INPUT_BYTES + 1 } as Blob;
    await expect(prepareImage(huge)).rejects.toBeInstanceOf(IntakeError);
    expect(fitSize(4000, 1000)).toEqual({ w: 2000, h: 500 });
    expect(fitSize(800, 600)).toEqual({ w: 800, h: 600 });
    // no decoder in jsdom: a small file is kept as it is
    const small = png();
    await expect(prepareImage(small)).resolves.toEqual({ blob: small, mime: "image/png" });
  });

  it("imagesOf reads files from items or the file list", () => {
    const f = new File([new Uint8Array(2)], "a.png", { type: "image/png" });
    const items = [{ kind: "file", getAsFile: () => f }, { kind: "string", getAsFile: () => null }];
    expect(imagesOf({ items, files: [] } as unknown as DataTransfer)).toEqual([f]);
    expect(imagesOf({ items: [], files: [f] } as unknown as DataTransfer)).toEqual([f]);
    expect(imagesOf(null)).toEqual([]);
  });
});

describe("local store (memory fallback)", () => {
  it("put / get / list / delete; garbage collection keeps referenced keys", async () => {
    expect(shotStorage()).toBe("memory");
    const a = await putShotBlob(png(), "shot_a");
    await putShotBlob(png(), "shot_b");
    expect(await getShotBlob(a)).toBeInstanceOf(Blob);
    expect((await listShotKeys()).sort()).toEqual(["shot_a", "shot_b"]);
    const refs: ScreenshotRef[] = [{ id: "a", store: "idb", key: "shot_a" }, { id: "c", store: "cloud", key: "u/c.png", cacheKey: "shot_c" } as ScreenshotRef, { id: "u", store: "url", url: "https://x" }];
    expect([...referencedShotKeys([{ screenshots: refs }])]).toEqual(["shot_a", "shot_c"]);
    expect(await collectShotGarbage(referencedShotKeys([{ screenshots: refs }]))).toBe(1);
    expect(await listShotKeys()).toEqual(["shot_a"]);
    await deleteShotBlob("shot_a");
    expect(await getShotBlob("shot_a")).toBeUndefined();
  });

  it("addShots: references with time and type; refused files get a German message; at most `room`", async () => {
    const now = new Date("2026-10-01T10:00:00Z");
    const r = await addShots([new Blob(["x"], { type: "text/plain" }), png(), png()], 1, now);
    expect(r.refs).toHaveLength(1);
    expect(r.refs[0]).toMatchObject({ store: "idb", mime: "image/png", at: "2026-10-01T10:00:00.000Z" });
    expect(r.errors).toEqual([INTAKE_MESSAGES.type, `Höchstens ${MAX_SHOTS} Screenshots pro Trade.`]);
  });

  it("references: place badge, local key, URL; no cloud → stays local", async () => {
    expect(shotPlace({ id: "1", store: "idb" })).toBe("Lokal");
    expect(shotPlace({ id: "1", store: "cloud" })).toBe("Cloud");
    expect(shotPlace({ id: "1", store: "url" })).toBe("Link");
    expect(localKeyOf({ id: "1", store: "url", url: "https://x" })).toBeNull();
    expect(await shotUrl({ id: "1", store: "url", url: "https://example.com/a.png" })).toBe("https://example.com/a.png");
    const create = vi.fn(() => "blob:local-1");
    const orig = URL.createObjectURL;
    URL.createObjectURL = create;
    await putShotBlob(png(), "shot_z");
    expect(await shotUrl({ id: "z", store: "idb", key: "shot_z" })).toBe("blob:local-1");
    URL.createObjectURL = orig;
    expect(await promoteToCloud({ id: "z", store: "idb", key: "shot_z" })).toBeNull();
  });
});

describe("ShotsField", () => {
  function Harness() {
    const [shots, setShots] = useState<ScreenshotRef[]>([]);
    return (
      <MotionRoot>
        <ShotsField value={shots} onChange={setShots} />
        <output data-testid="n">{shots.length}</output>
      </MotionRoot>
    );
  }

  it("a chosen file becomes a thumbnail that can be removed; a non-image is refused with a toast", async () => {
    useUi.setState({ toasts: [] });
    render(<Harness />);
    const drop = screen.getByTestId("shots-drop");
    const file = new File([new Uint8Array(8)], "chart.png", { type: "image/png" });
    fireEvent.change(drop.querySelector('input[type="file"]')!, { target: { files: [file] } });
    await waitFor(() => expect(screen.getByTestId("n")).toHaveTextContent("1"));
    expect(screen.getByRole("button", { name: "Screenshot 1 öffnen" })).toBeInTheDocument();
    fireEvent.drop(drop, { dataTransfer: { items: [], files: [new File(["x"], "a.txt", { type: "text/plain" })], types: ["Files"] } });
    await waitFor(() => expect(useUi.getState().toasts.map((t) => [t.title, t.detail])).toEqual([["Screenshot nicht übernommen", INTAKE_MESSAGES.type]]));
    fireEvent.click(screen.getByRole("button", { name: /Screenshot 1 entfernen/ }));
    await waitFor(() => expect(screen.getByTestId("n")).toHaveTextContent("0"));
  });
});
