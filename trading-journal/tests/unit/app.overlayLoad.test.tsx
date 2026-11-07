import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// the three overlay chunks and the three deferred tabs as light stubs – what is tested is WHEN they load, not what they draw
const loads = vi.hoisted(() => ({ editor: 0, trades: 0, settings: 0, setups: 0 }));
vi.mock("@/overlays/TradeEditor", () => {
  loads.editor += 1;
  return { TradeEditor: () => <div data-testid="editor-stub" /> };
});
vi.mock("@/overlays/TradeDetail", () => ({ TradeDetail: () => <div data-testid="detail-stub" /> }));
vi.mock("@/overlays/SetupEditor", () => ({ SetupEditor: () => <div data-testid="setup-stub" /> }));
vi.mock("@/views/trades/TradesView", () => {
  loads.trades += 1;
  return { TradesView: () => <div data-testid="trades-stub" /> };
});
vi.mock("@/views/setups/SetupsView", () => {
  loads.setups += 1;
  return { SetupsView: () => <div data-testid="setups-stub" /> };
});
vi.mock("@/app/SettingsPage", () => {
  loads.settings += 1;
  return { SettingsPage: () => <div data-testid="settings-stub" /> };
});
// the downloads go through `loadChunk` (waits for the network, retries once): here a download can be made to fail
const chunk = vi.hoisted(() => ({ fail: 0 }));
vi.mock("@/lib/chunkLoad", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/chunkLoad")>();
  return {
    ...actual,
    loadChunk: <T,>(load: () => Promise<T>): Promise<T> => {
      if (chunk.fail > 0) {
        chunk.fail -= 1;
        return Promise.reject(new TypeError("Failed to fetch dynamically imported module"));
      }
      return actual.loadChunk(load);
    },
  };
});
// the overview is a static export of `pages.ts`; its weight is irrelevant here
vi.mock("@/views/overview", () => ({ OverviewView: () => null }));

import { ArmedOverlay } from "@/app/ArmedOverlay";
import { TradeEditor } from "@/app/overlays";
import { armOverlay, isOverlayArmed, openEditorWarm, preloadOverlay, resetOverlayArming } from "@/app/overlayLoad";
import { DEFERRED_TABS, LAZY_PAGES, preloadPage } from "@/app/pages";
import { useUi } from "@/store/uiStore";

describe("overlay loading (Budget-Schnitt)", () => {
  beforeEach(() => {
    resetOverlayArming();
    useUi.setState({ editor: { open: false, fromFab: false } });
  });
  afterEach(() => resetOverlayArming());

  it("an overlay that is neither armed nor open is not mounted – and mounts once its chunk was preloaded", async () => {
    render(
      <ArmedOverlay id="editor" open={false}>
        <TradeEditor />
      </ArmedOverlay>,
    );
    expect(screen.queryByTestId("editor-stub")).toBeNull();
    expect(isOverlayArmed("editor")).toBe(false);
    await act(async () => {
      await preloadOverlay("editor");
    });
    expect(isOverlayArmed("editor")).toBe(true);
    expect(await screen.findByTestId("editor-stub")).toBeInTheDocument();
  });

  it("an overlay whose state opens before the idle preload mounts at once and stays mounted after it closes (exit animation)", async () => {
    const { rerender } = render(
      <ArmedOverlay id="editor" open={false}>
        <TradeEditor />
      </ArmedOverlay>,
    );
    expect(screen.queryByTestId("editor-stub")).toBeNull();
    rerender(
      <ArmedOverlay id="editor" open>
        <TradeEditor />
      </ArmedOverlay>,
    );
    expect(await screen.findByTestId("editor-stub")).toBeInTheDocument();
    expect(isOverlayArmed("editor")).toBe(true);
    rerender(
      <ArmedOverlay id="editor" open={false}>
        <TradeEditor />
      </ArmedOverlay>,
    );
    expect(screen.getByTestId("editor-stub")).toBeInTheDocument();
  });

  it("openEditorWarm: warm chunk opens the editor in the same call, a missing one only after it arrived", async () => {
    armOverlay("editor");
    openEditorWarm({ fromFab: true });
    expect(useUi.getState().editor.open).toBe(true);
    expect(useUi.getState().editor.fromFab).toBe(true);
    useUi.setState({ editor: { open: false, fromFab: false } });

    resetOverlayArming();
    openEditorWarm();
    // cold: the tap is answered as soon as the chunk is there, never before (the sheet mounts in the commit that opens it)
    expect(useUi.getState().editor.open).toBe(false);
    await act(async () => {
      await preloadOverlay("editor");
    });
    expect(useUi.getState().editor.open).toBe(true);
    expect(isOverlayArmed("editor")).toBe(true);
  });

  it("once the chunk has arrived an overlay renders in the same commit that mounts it (no lazy suspension: the dock disc morph needs it)", async () => {
    await act(async () => {
      await preloadOverlay("editor");
    });
    render(
      <ArmedOverlay id="editor" open>
        <TradeEditor />
      </ArmedOverlay>,
    );
    // `getBy`, not `findBy`: it is in the tree after the first synchronous render
    expect(screen.getByTestId("editor-stub")).toBeInTheDocument();
  });

  it("a failed chunk download is swallowed by the preload (no unhandled rejection), leaves the overlay unarmed and is fetched again later", async () => {
    chunk.fail = 1;
    await act(async () => {
      await preloadOverlay("setup");
    });
    expect(isOverlayArmed("setup")).toBe(false);
    await act(async () => {
      await preloadOverlay("setup");
    });
    expect(isOverlayArmed("setup")).toBe(true);
  });

  it("the tabs that left the first load are chunks of their own: not feature pages, fetched once on intent", async () => {
    expect(DEFERRED_TABS).toEqual(["trades", "setups", "settings"]);
    for (const tab of DEFERRED_TABS) expect(LAZY_PAGES).not.toContain(tab);
    expect(loads.trades + loads.setups + loads.settings).toBe(0);
    preloadPage("overview");
    expect(loads.trades).toBe(0);
    preloadPage("trades");
    preloadPage("trades");
    await act(async () => {
      await Promise.resolve();
    });
    expect(loads.trades).toBe(1);
    expect(loads.settings).toBe(0);
    preloadPage("settings");
    preloadPage("setups");
    await act(async () => {
      await Promise.resolve();
    });
    expect(loads.settings).toBe(1);
    expect(loads.setups).toBe(1);
  });
});
