/**
 * Konto-Pflicht (`src/cloud/gate.ts`): the pure routing of the entry gate – signed out / signed in, a login being restored, the 2FA step,
 * the public routes (share view, `#preise` read only) and the entry view of a first vs. a returning visitor.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { gateApplies, gateEntryView, gateOf, gateViewOf, KNOWN_KEY, knownVisitor, LANDING_PAGE, markKnownVisitor, PUBLIC_PAGES, type GateInput } from "@/cloud/gate";
import { setCloudEnabledForTests } from "@/cloud/env";
import { PAGES } from "@/store/uiStore";

const base: GateInput = { enabled: true, phase: "signedOut", needsMfa: false, restoring: false, share: false, page: "overview" };
const at = (patch: Partial<GateInput>) => gateOf({ ...base, ...patch });

beforeEach(() => localStorage.clear());
afterEach(() => {
  localStorage.clear();
  setCloudEnabledForTests(null);
});

describe("gateOf", () => {
  it("without the cloud nothing changes (local / dev / default e2e build): off in every state", () => {
    for (const phase of ["off", "idle", "loading", "signedOut", "signedIn"] as const) expect(at({ enabled: false, phase })).toBe("off");
    expect(at({ enabled: false, page: "konto" })).toBe("off");
  });

  it("signed out: the gate in front of every page but the public pricing page", () => {
    for (const page of PAGES) expect(at({ page }), page).toBe(PUBLIC_PAGES.includes(page) ? "pricing" : "gate");
    expect(PUBLIC_PAGES).toEqual(["preise"]);
    // an idle phase without anything to restore is signed out at once (no splash for a first visit)
    expect(at({ phase: "idle" })).toBe("gate");
  });

  it("a first visit of the start page gets the landing page; a deep link and a returning browser get the gate (Launch-Audit B3)", () => {
    expect(LANDING_PAGE).toBe("overview");
    for (const page of PAGES) expect(at({ page, known: false }), page).toBe(PUBLIC_PAGES.includes(page) ? "pricing" : page === LANDING_PAGE ? "landing" : "gate");
    // a browser that had a session is not sold the product again – on every page the gate („Anmelden“)
    for (const page of PAGES) expect(at({ page, known: true }), page).toBe(PUBLIC_PAGES.includes(page) ? "pricing" : "gate");
    // the landing page never stands in front of a session, a login being read, the 2FA step or the share view
    expect(at({ known: false, phase: "signedIn" })).toBe("open");
    expect(at({ known: false, phase: "signedIn", needsMfa: true })).toBe("gate");
    expect(at({ known: false, phase: "loading" })).toBe("pending");
    expect(at({ known: false, phase: "idle", restoring: true })).toBe("pending");
    expect(at({ known: false, share: true })).toBe("open");
    expect(at({ known: false, enabled: false })).toBe("off");
    // an idle phase with nothing to restore is a first visit at once (no splash)
    expect(at({ known: false, phase: "idle" })).toBe("landing");
  });

  it("signed in: the app on every page", () => {
    for (const page of PAGES) expect(at({ phase: "signedIn", page }), page).toBe("open");
  });

  it("2FA code missing: still the gate (the code step), also on the pricing page", () => {
    expect(at({ phase: "signedIn", needsMfa: true })).toBe("gate");
    expect(at({ phase: "signedIn", needsMfa: true, page: "preise" })).toBe("gate");
  });

  it("a stored login or an e-mail link being read: a quiet splash, never a flash of the gate", () => {
    expect(at({ phase: "idle", restoring: true })).toBe("pending");
    expect(at({ phase: "loading" })).toBe("pending");
    expect(at({ phase: "loading", restoring: true, page: "preise" })).toBe("pending");
  });

  it("the share view is public in every phase", () => {
    for (const phase of ["idle", "loading", "signedOut", "signedIn"] as const) expect(at({ phase, share: true, restoring: true })).toBe("open");
  });
});

describe("entry view: first visit vs. returning", () => {
  it("first visit opens on „Konto erstellen“, a browser that had a session on „Anmelden“", () => {
    expect(knownVisitor()).toBe(false);
    expect(gateEntryView()).toBe("signup");
    markKnownVisitor();
    expect(localStorage.getItem(KNOWN_KEY)).toBe("1");
    expect(knownVisitor()).toBe(true);
    expect(gateEntryView()).toBe("signin");
  });

  it("a stored (maybe expired) session counts as returning", () => {
    localStorage.setItem("tj2-sb-auth", "{}");
    expect(knownVisitor()).toBe(true);
    expect(gateEntryView()).toBe("signin");
  });

  it("the gate window keeps the step the person is on and falls back to the entry view otherwise", () => {
    const closed = { open: false, view: "signin" as const };
    expect(gateViewOf(closed, false, false)).toBe("signup");
    expect(gateViewOf(closed, false, true)).toBe("signin");
    for (const v of ["signin", "magic", "signup", "reset", "sent"] as const) expect(gateViewOf({ open: true, view: v }, false, false)).toBe(v);
    // a view of a session (after a sign-out the account panel may still be the sheet's view) → the entry view
    for (const v of ["account", "welcome", "newPassword"] as const) expect(gateViewOf({ open: true, view: v }, false, true)).toBe("signin");
    // the missing 2FA code wins
    expect(gateViewOf({ open: true, view: "signin" }, true, true)).toBe("mfa");
    expect(gateViewOf(closed, true, false)).toBe("mfa");
  });
});

describe("gateApplies", () => {
  it("follows the cloud of the build (the personal web edition)", () => {
    setCloudEnabledForTests(false);
    expect(gateApplies()).toBe(false);
    setCloudEnabledForTests(true);
    expect(gateApplies()).toBe(true);
  });
});
