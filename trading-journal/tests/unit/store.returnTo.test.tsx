/**
 * `returnTo` (A4): back to the task after a login / plan / connection. The grammar is a whitelist (no free URL: no open redirect),
 * a pending return expires, the router reads `?returnTo=` on every page and takes it out of the address, and `ReturnHost` opens the
 * original target exactly once when the awaited condition comes true.
 */
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const open = vi.hoisted(() => vi.fn());
vi.mock("@/app/featureOpen", () => ({ openFeature: open }));
const entitled = vi.hoisted(() => ({ value: false }));
vi.mock("@/billing/entitlements", async (orig) => ({ ...(await orig<typeof import("@/billing/entitlements")>()), entitledNow: () => entitled.value }));

import { ReturnHost, waitMet } from "@/app/ReturnHost";
import { useBilling } from "@/billing/store";
import { resetCloudSession, useCloudSession } from "@/cloud/session";
import { useExchange } from "@/exchanges/store";
import { RETURN_TTL_MS, clearReturnTo, formatReturnParam, parseReturnParam, peekReturnTo, returnHash, setReturnTo } from "@/store/returnTo";
import { buildHash, installRouter, parseHash } from "@/store/router";
import { useUi } from "@/store/uiStore";

beforeEach(() => {
  clearReturnTo();
  resetCloudSession();
  entitled.value = false;
  open.mockClear();
  try {
    sessionStorage.clear();
  } catch {
    /* ignore */
  }
});
afterEach(() => vi.useRealTimers());

describe("grammar", () => {
  it("accepts a function id and a known page, nothing else", () => {
    expect(parseReturnParam("feature:backup")).toEqual({ kind: "feature", id: "backup" });
    expect(parseReturnParam("feature:tradingview-webhook")).toEqual({ kind: "feature", id: "tradingview-webhook" });
    expect(parseReturnParam("page:settings")).toEqual({ kind: "page", page: "settings" });
    for (const bad of ["", "settings", "page:gibt-es-nicht", "feature:", "feature:Backup", "feature:a b", "https://evil.example/", "//evil.example", "javascript:alert(1)", "page:settings/../../x", "feature:" + "a".repeat(80), null, undefined]) {
      expect(parseReturnParam(bad as string | null | undefined), String(bad)).toBeNull();
    }
  });

  it("round-trips and builds the hash of a login page that comes back", () => {
    const t = { kind: "feature", id: "backup" } as const;
    expect(parseReturnParam(formatReturnParam(t))).toEqual(t);
    expect(returnHash("konto", t)).toBe("#konto?returnTo=feature:backup");
  });
});

describe("pending return", () => {
  it("is kept for this tab, expires after the time to live, and is cleared by the first read after it", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-06T10:00:00Z"));
    setReturnTo({ kind: "feature", id: "gruppen" }, { on: "signedIn" }, "Gruppen");
    expect(peekReturnTo()).toMatchObject({ target: { kind: "feature", id: "gruppen" }, wait: { on: "signedIn" }, label: "Gruppen" });
    expect(JSON.parse(sessionStorage.getItem("tj2-return-to")!)).toMatchObject({ target: { id: "gruppen" } });
    vi.setSystemTime(Date.now() + RETURN_TTL_MS + 1000);
    expect(peekReturnTo()).toBeNull();
    expect(sessionStorage.getItem("tj2-return-to")).toBeNull();
  });

  it("a forged sessionStorage entry (free URL, unknown wait) is ignored", async () => {
    sessionStorage.setItem("tj2-return-to", JSON.stringify({ target: { kind: "url", href: "https://evil.example" }, wait: { on: "signedIn" }, label: "", at: Date.now() }));
    vi.resetModules();
    const fresh = await import("@/store/returnTo");
    expect(fresh.useReturnTo.getState().pending).toBeNull();
    sessionStorage.setItem("tj2-return-to", JSON.stringify({ target: { kind: "page", page: "konto" }, wait: { on: "whenever" }, label: "", at: Date.now() }));
    vi.resetModules();
    expect((await import("@/store/returnTo")).useReturnTo.getState().pending).toBeNull();
  });
});

describe("router", () => {
  it("reads returnTo on any page and takes it out of the query the page sees", () => {
    expect(parseHash("#konto?returnTo=feature:backup")).toEqual({ page: "konto", returnTo: { kind: "feature", id: "backup" } });
    expect(parseHash("#analyse?dim=session&returnTo=page:settings")).toEqual({ page: "analyse", query: "dim=session", returnTo: { kind: "page", page: "settings" } });
    expect(parseHash("#trades?result=win&returnTo=feature:backup")).toMatchObject({ page: "trades", filter: { result: "win" }, returnTo: { kind: "feature", id: "backup" } });
  });

  it("an invalid returnTo is dropped silently – the page still opens", () => {
    expect(parseHash("#konto?returnTo=https://evil.example/")).toEqual({ page: "konto" });
    expect(parseHash("#konto?returnTo=page:nope")).toEqual({ page: "konto" });
  });

  it("buildHash never writes a returnTo (the task is no part of an address)", () => {
    expect(buildHash("konto")).toBe("#konto");
  });

  it("installing the router with a returnTo link notes the task and cleans the address", () => {
    location.hash = "#konto?returnTo=feature:backup";
    const off = installRouter();
    expect(useUi.getState().page).toBe("konto");
    expect(peekReturnTo()).toMatchObject({ target: { kind: "feature", id: "backup" }, wait: { on: "signedIn" } });
    expect(location.hash).toBe("#konto");
    off();
    location.hash = "";
  });
});

describe("waitMet", () => {
  const base = { signedIn: false, entitled: () => false, connected: false };
  it("answers each kind of wait from what it is given", () => {
    expect(waitMet({ on: "signedIn" }, base)).toBe(false);
    expect(waitMet({ on: "signedIn" }, { ...base, signedIn: true })).toBe(true);
    expect(waitMet({ on: "entitled", feature: "backtestLab" }, { ...base, entitled: (f) => f === "backtestLab" })).toBe(true);
    expect(waitMet({ on: "entitled", feature: "coach" }, { ...base, entitled: (f) => f === "backtestLab" })).toBe(false);
    expect(waitMet({ on: "connected" }, { ...base, connected: true })).toBe(true);
  });
});

describe("ReturnHost", () => {
  it("does nothing while the condition is open, opens the original task exactly once when the login is done", async () => {
    setReturnTo({ kind: "feature", id: "gruppen" }, { on: "signedIn" }, "Gruppen");
    render(<ReturnHost />);
    await act(async () => {});
    expect(open).not.toHaveBeenCalled();
    expect(peekReturnTo()).not.toBeNull();
    await act(async () => {
      useCloudSession.setState({ phase: "signedIn" });
    });
    await vi.waitFor(() => expect(open).toHaveBeenCalledWith("gruppen", { remember: false }));
    expect(open).toHaveBeenCalledTimes(1);
    expect(peekReturnTo()).toBeNull();
    // a second change of the session does not fire it again
    await act(async () => {
      useCloudSession.setState({ phase: "signedOut" });
      useCloudSession.setState({ phase: "signedIn" });
    });
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("waits for a login that still needs the second factor", async () => {
    setReturnTo({ kind: "page", page: "konto" }, { on: "signedIn" });
    render(<ReturnHost />);
    await act(async () => {
      useCloudSession.setState({ phase: "signedIn", needsMfa: true });
    });
    expect(open).not.toHaveBeenCalled();
    await act(async () => {
      useCloudSession.setState({ needsMfa: false });
    });
    await vi.waitFor(() => expect(open).toHaveBeenCalledWith("page:konto", { remember: false }));
  });

  it("brings the person back after the plan includes the feature, and after an exchange is connected", async () => {
    setReturnTo({ kind: "feature", id: "diagnose" }, { on: "entitled", feature: "backtestLab" }, "Diagnose");
    render(<ReturnHost />);
    await act(async () => {});
    expect(open).not.toHaveBeenCalled();
    entitled.value = true;
    // a plan change re-renders the host through the billing store
    await act(async () => {
      useBilling.setState({ cached: { plan: "premium", userId: "u1", at: Date.now() } as never, account: { plan: "premium" } as never });
    });
    await vi.waitFor(() => expect(open).toHaveBeenCalledWith("diagnose", { remember: false }));

    open.mockClear();
    setReturnTo({ kind: "feature", id: "boerse-sync" }, { on: "connected" });
    await act(async () => {
      useExchange.setState({ status: { configured: true, connections: [{ id: "c1", status: "active" }] } as never });
    });
    await vi.waitFor(() => expect(open).toHaveBeenCalledWith("boerse-sync", { remember: false }));
  });

  it("a stale return is dropped, never acted on", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-06T10:00:00Z"));
    setReturnTo({ kind: "feature", id: "gruppen" }, { on: "signedIn" });
    vi.setSystemTime(Date.now() + RETURN_TTL_MS + 5000);
    render(<ReturnHost />);
    await act(async () => {
      useCloudSession.setState({ phase: "signedIn" });
    });
    expect(open).not.toHaveBeenCalled();
    expect(peekReturnTo()).toBeNull();
  });
});
