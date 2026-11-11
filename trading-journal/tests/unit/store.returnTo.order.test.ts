/**
 * Paket B: the ORDER note (plan · interval · seats) survives the confirmation mail. The link in the mail opens a NEW tab whose
 * `sessionStorage` is empty – so an order note is mirrored in `localStorage` (nothing secret: it opens the order SUMMARY, nothing is
 * ordered by itself), lives an hour, is used once across tabs, and "Ohne Kauf weiter" drops it. Other targets stay per tab.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

async function freshTab() {
  // a new tab: the module state is new, `sessionStorage` is empty, `localStorage` is shared
  vi.resetModules();
  sessionStorage.clear();
  return import("@/store/returnTo");
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.useRealTimers();
});

describe("order note across tabs", () => {
  it("is written to this tab AND the shared storage, and a new tab (empty sessionStorage) reads it", async () => {
    const a = await freshTab();
    a.setReturnTo({ kind: "order", order: "premium.year.1" }, { on: "signedIn" }, "Bestellung");
    expect(sessionStorage.getItem("tj2-return-to")).toContain("premium.year.1");
    expect(localStorage.getItem("tj2-return-to-order")).toContain("premium.year.1");
    const b = await freshTab(); // the mail link opened this tab
    expect(b.peekReturnTo()).toMatchObject({ target: { kind: "order", order: "premium.year.1" }, wait: { on: "signedIn" } });
  });

  it("team with its seats comes back exactly (order:team.month.4)", async () => {
    const a = await freshTab();
    a.setReturnTo({ kind: "order", order: "team.month.4" }, { on: "signedIn" });
    const b = await freshTab();
    expect(b.peekReturnTo()?.target).toEqual({ kind: "order", order: "team.month.4" });
  });

  it("a feature note is NOT shared: it stays in its tab (as before)", async () => {
    const a = await freshTab();
    a.setReturnTo({ kind: "feature", id: "backup" }, { on: "signedIn" });
    expect(localStorage.getItem("tj2-return-to-order")).toBeNull();
    const b = await freshTab();
    expect(b.peekReturnTo()).toBeNull();
  });

  it("lives an hour for an order (a confirmation mail is answered later), half an hour for the rest", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-08T10:00:00Z"));
    const a = await freshTab();
    expect(a.ORDER_RETURN_TTL_MS).toBe(60 * 60_000);
    expect(a.RETURN_TTL_MS).toBe(30 * 60_000);
    a.setReturnTo({ kind: "order", order: "pro.year.1" }, { on: "signedIn" });
    vi.setSystemTime(Date.now() + 45 * 60_000);
    expect(a.peekReturnTo()).not.toBeNull(); // 45 min: still there
    vi.setSystemTime(Date.now() + 20 * 60_000);
    expect(a.peekReturnTo()).toBeNull(); // 65 min: gone, and gone from the shared storage too
    expect(localStorage.getItem("tj2-return-to-order")).toBeNull();
  });

  it("is used once across tabs: when one tab consumed it, the other does not open the order a second time", async () => {
    const a = await freshTab();
    a.setReturnTo({ kind: "order", order: "premium.year.1" }, { on: "signedIn" });
    // tab B (a new tab: no sessionStorage of its own) adopts the note from the shared storage …
    const b = await freshTab();
    expect(b.peekReturnTo()).not.toBeNull();
    // … tab A consumes it (the first to act clears both copies); B must not open the order a second time
    localStorage.removeItem("tj2-return-to-order");
    expect(b.peekReturnTo()).toBeNull();
  });

  it("a reloaded tab whose note was used elsewhere in the meantime starts without it", async () => {
    const a = await freshTab();
    a.setReturnTo({ kind: "order", order: "premium.year.1" }, { on: "signedIn" });
    localStorage.removeItem("tj2-return-to-order"); // used in another tab
    vi.resetModules(); // reload: sessionStorage survives a reload, the module state does not
    const again = await import("@/store/returnTo");
    expect(again.peekReturnTo()).toBeNull();
    expect(sessionStorage.getItem("tj2-return-to")).toBeNull();
  });

  it("'Ohne Kauf weiter' (clearReturnTo) removes both copies", async () => {
    const a = await freshTab();
    a.setReturnTo({ kind: "order", order: "pro.month.1" }, { on: "signedIn" });
    a.clearReturnTo();
    expect(sessionStorage.getItem("tj2-return-to")).toBeNull();
    expect(localStorage.getItem("tj2-return-to-order")).toBeNull();
    expect(a.peekReturnTo()).toBeNull();
  });

  it("a hand-edited shared note is sanitized like any other (an unknown plan, a free plan, a free string are dropped)", async () => {
    for (const bad of ["enterprise.year.1", "free.year.1", "pro.week.1", "https://evil.example/", "pro.year.999"]) {
      localStorage.clear();
      localStorage.setItem("tj2-return-to-order", JSON.stringify({ target: { kind: "order", order: bad }, wait: { on: "signedIn" }, label: "x", at: Date.now() }));
      const t = await freshTab();
      expect(t.peekReturnTo(), bad).toBeNull();
    }
  });
});
