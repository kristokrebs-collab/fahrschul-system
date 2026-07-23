import { beforeEach, describe, expect, it } from "vitest";
import { clearCache, readCache, writeCache } from "./cache.js";

describe("offline read cache (NOT a source of truth, read-only fallback)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("stores and retrieves the last successful response", () => {
    writeCache("/appointments/mine", { appointments: [{ id: "1" }] });
    const cached = readCache<{ appointments: { id: string }[] }>("/appointments/mine");
    expect(cached?.data.appointments).toHaveLength(1);
    expect(cached?.cachedAt).toBeDefined();
  });

  it("returns null when nothing was cached yet", () => {
    expect(readCache("/nothing-here")).toBeNull();
  });

  it("clearCache only removes fahrschul cache entries, not unrelated keys", () => {
    writeCache("/a", { x: 1 });
    localStorage.setItem("unrelated-key", "keep-me");
    clearCache();
    expect(readCache("/a")).toBeNull();
    expect(localStorage.getItem("unrelated-key")).toBe("keep-me");
  });
});
