/**
 * Cloud screenshots leave Storage with the trade (Review PRIV-01): removed pictures, deleted trades and uploads of an
 * editor closed without saving are freed – but only objects of the own folder that no trade of the loaded journal
 * references any more, and also after a downgrade (no `screenshotsCloud` entitlement).
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScreenshotRef, Trade } from "@/domain/types";

const removed: string[][] = [];
const uploaded: string[] = [];
vi.mock("@/cloud", async (orig) => ({
  ...(await orig<typeof import("@/cloud")>()),
  ensureCloud: async () => ({
    getClient: () => ({
      storage: { from: () => ({ remove: async (p: string[]) => (removed.push(p), { error: null }), upload: async (p: string) => (uploaded.push(p), { error: null }) }) },
    }),
  }),
}));
// default: a Free plan after a downgrade – no new cloud uploads, but deleting the own pictures must still work
let entitled = false;
vi.mock("@/billing/entitlements", async (orig) => ({ ...(await orig<typeof import("@/billing/entitlements")>()), entitledNow: () => entitled }));

const { setCloudEnabledForTests } = await import("@/cloud/env");
const { resetCloudSession, useCloudSession } = await import("@/cloud/session");
const { useJournal } = await import("@/store/journalStore");
const { cloudShotOwner, deleteCloudShot } = await import("@/journal/screenshots/cloud");
const { cloudPathsOf, deleteTradeWithShots, releaseCloudShots, removedCloudPaths } = await import("@/journal/screenshots/release");
const { ShotsField } = await import("@/journal/screenshots/ShotsField");
const { resetShotStoreForTests } = await import("@/journal/screenshots/store");

const UID = "11111111-1111-4111-8111-111111111111";
const cloud = (id: string): ScreenshotRef => ({ id, store: "cloud", key: `${UID}/${id}.png`, cacheKey: `shot_${id}` }) as ScreenshotRef;
const trade = (id: string, shots: ScreenshotRef[]) => ({ id, screenshots: shots }) as unknown as Trade;

beforeEach(() => {
  removed.length = 0;
  uploaded.length = 0;
  entitled = false;
  setCloudEnabledForTests(true);
  useCloudSession.setState({ phase: "signedIn", user: { id: UID, email: "t@example.com", aal: "aal1", mfaEnrolled: false }, needsMfa: false });
  useJournal.setState({ loaded: true, trades: [trade("t1", [cloud("a"), { id: "l", store: "idb", key: "shot_l" }])] });
});
afterEach(() => {
  resetShotStoreForTests();
  setCloudEnabledForTests(null);
  resetCloudSession();
  useJournal.setState({ loaded: false, trades: [] });
});

describe("cloud screenshot release (PRIV-01)", () => {
  it("paths of a trade and the ones a save removed", () => {
    expect(cloudPathsOf(trade("x", [cloud("a"), { id: "u", store: "url", url: "https://x" }]))).toEqual([`${UID}/a.png`]);
    expect(removedCloudPaths(trade("x", [cloud("a"), cloud("b")]), trade("x", [cloud("b")]))).toEqual([`${UID}/a.png`]);
    expect(removedCloudPaths(trade("x", [cloud("a")]), null)).toEqual([`${UID}/a.png`]);
  });

  it("deletes only objects no trade references; works without the plan feature; never another folder", async () => {
    expect(cloudShotOwner()).toBeNull();
    expect(await releaseCloudShots([`${UID}/a.png`, `${UID}/b.png`])).toBe(1);
    expect(removed).toEqual([[`${UID}/b.png`]]);
    expect(await deleteCloudShot("22222222-2222-4222-8222-222222222222/x.png")).toBe(false);
    expect(removed).toHaveLength(1);
  });

  it("nothing before the journal is loaded or while signed out", async () => {
    useJournal.setState({ loaded: false });
    expect(await releaseCloudShots([`${UID}/b.png`])).toBe(0);
    useJournal.setState({ loaded: true });
    useCloudSession.setState({ phase: "signedOut", user: null });
    expect(await releaseCloudShots([`${UID}/b.png`])).toBe(0);
    expect(removed).toEqual([]);
  });

  it("deleting a trade frees its pictures after the trade is gone; a picture another trade holds stays", async () => {
    const t2 = trade("t2", [cloud("a"), cloud("c")]);
    useJournal.setState({ trades: [useJournal.getState().trades[0]!, t2] });
    const remove = vi.fn(async (id: string) => useJournal.setState({ trades: useJournal.getState().trades.filter((t) => t.id !== id) }));
    await deleteTradeWithShots(remove, t2);
    await vi.waitFor(() => expect(removed).toEqual([[`${UID}/c.png`]]));
    expect(remove).toHaveBeenCalledWith("t2");
  });

  it("an editor closed without saving frees the uploads of its session; a saved one keeps them", async () => {
    entitled = true;
    function Harness() {
      const [shots, setShots] = useState<ScreenshotRef[]>([]);
      return createElement("div", null, createElement(ShotsField, { value: shots, onChange: setShots }), createElement("output", { "data-testid": "kinds" }, shots.map((s) => s.store).join(",")));
    }
    const pick = () => fireEvent.change(screen.getByTestId("shots-drop").querySelector('input[type="file"]')!, { target: { files: [new File([new Uint8Array(8)], "c.png", { type: "image/png" })] } });
    // 1) closed without saving → the object leaves the cloud
    const first = render(createElement(Harness));
    pick();
    await waitFor(() => expect(screen.getByTestId("kinds")).toHaveTextContent("cloud"));
    expect(uploaded).toHaveLength(1);
    act(() => first.unmount());
    await vi.waitFor(() => expect(removed).toEqual([[uploaded[0]]]));
    // 2) the saved trade references the upload → it stays
    removed.length = 0;
    const second = render(createElement(Harness));
    pick();
    await waitFor(() => expect(uploaded).toHaveLength(2));
    useJournal.setState({ trades: [...useJournal.getState().trades, trade("t9", [{ id: "x", store: "cloud", key: uploaded[1] } as ScreenshotRef])] });
    act(() => second.unmount());
    await new Promise((r) => setTimeout(r, 20));
    expect(removed).toEqual([]);
  });
});
