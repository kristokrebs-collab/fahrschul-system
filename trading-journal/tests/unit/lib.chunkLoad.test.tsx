import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PageSkeleton } from "@/app/PageSkeleton";
import { failedStylesheetCount, isOffline, loadChunk, repairStylesheets, retryChunksNow, whenOnline } from "@/lib/chunkLoad";

let online = true;
const setOnline = (v: boolean): void => {
  online = v;
  window.dispatchEvent(new Event(v ? "online" : "offline"));
};
const flush = async (): Promise<void> => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
};

describe("loadChunk (offline-tolerant chunk loading)", () => {
  beforeEach(() => {
    online = true;
    vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    for (const l of document.head.querySelectorAll("link[data-test]")) l.remove();
  });

  it("online: loads at once", async () => {
    const load = vi.fn(() => Promise.resolve("module"));
    await expect(loadChunk(load)).resolves.toBe("module");
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("offline: does not start the download, goes on at the `online` event", async () => {
    setOnline(false);
    expect(isOffline()).toBe(true);
    const load = vi.fn(() => Promise.resolve("module"));
    const result = loadChunk(load);
    await flush();
    expect(load).not.toHaveBeenCalled();
    setOnline(true);
    await expect(result).resolves.toBe("module");
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("a failed download is tried once more and then resolves", async () => {
    const load = vi.fn().mockRejectedValueOnce(new TypeError("Failed to fetch dynamically imported module")).mockResolvedValueOnce("module");
    await expect(loadChunk(load, { backoffMs: 0 })).resolves.toBe("module");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("a download that fails twice rejects (the caller decides); no further attempts", async () => {
    const load = vi.fn(() => Promise.reject(new Error("nope")));
    await expect(loadChunk(load, { backoffMs: 0 })).rejects.toThrow("nope");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("the network goes away while the download is in flight: the retry waits for `online`", async () => {
    let n = 0;
    const load = vi.fn(async () => {
      n += 1;
      if (n === 1) {
        setOnline(false);
        throw new TypeError("Failed to fetch dynamically imported module");
      }
      return "module";
    });
    const result = loadChunk(load, { backoffMs: 0 });
    await flush();
    await flush();
    expect(load).toHaveBeenCalledTimes(1);
    setOnline(true);
    await expect(result).resolves.toBe("module");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("`Wiederholen` (retryChunksNow) lets a waiting load go ahead although the browser still says offline", async () => {
    setOnline(false);
    const load = vi.fn(() => Promise.resolve("module"));
    const result = loadChunk(load);
    await flush();
    expect(load).not.toHaveBeenCalled();
    retryChunksNow();
    await expect(result).resolves.toBe("module");
    // the override ends with the released loads: a new load waits again
    await flush();
    const again = vi.fn(() => Promise.resolve("again"));
    void loadChunk(again);
    await flush();
    expect(again).not.toHaveBeenCalled();
    setOnline(true);
  });

  it("whenOnline resolves at once while online", async () => {
    await expect(whenOnline()).resolves.toBeUndefined();
  });

  it("a stylesheet that failed is replaced by a fresh link before the retry (Vite never adds it again)", async () => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "http://localhost/assets/facts-test.css";
    link.dataset.test = "1";
    document.head.appendChild(link);
    link.dispatchEvent(new Event("error"));
    expect(failedStylesheetCount()).toBe(1);
    const repaired = repairStylesheets();
    const fresh = [...document.head.querySelectorAll<HTMLLinkElement>("link[rel=stylesheet]")].filter((l) => l.href.endsWith("facts-test.css"));
    expect(fresh).toHaveLength(1);
    expect(fresh[0]).not.toBe(link);
    fresh[0]!.dataset.test = "1";
    fresh[0]!.dispatchEvent(new Event("load"));
    await repaired;
    expect(failedStylesheetCount()).toBe(0);
  });
});

describe("PageSkeleton offline note", () => {
  beforeEach(() => {
    online = true;
    vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
  });
  afterEach(() => vi.restoreAllMocks());

  it("online: the skeleton only; offline: an honest note with Wiederholen, same block, gone when online again", async () => {
    render(<PageSkeleton page="analyse" />);
    expect(screen.queryByText(/Du bist offline/)).toBeNull();
    act(() => setOnline(false));
    expect(screen.getAllByText(/Du bist offline/).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Wiederholen" })).toBeInTheDocument();
    act(() => setOnline(true));
    expect(screen.queryByRole("button", { name: "Wiederholen" })).toBeNull();
  });
});
