/**
 * Opening a function of the register: an action opens its sheet over the page, a place navigates and scrolls to its
 * anchor once the (lazy) page shows it – and nothing is a silent dead end: a plan the user lacks, an anchor that is not on
 * the page and a way without anchor each say so in the arrival note (A4: a note with the next step as a button, no toast).
 * What covers a target (fold, toggle, a named choice) is opened first; the person who needs a login / plan is led there and
 * brought back (`returnTo`). Opening counts as "Zuletzt benutzt" (the search's recent ids).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const entitled = vi.hoisted(() => ({ value: true }));
vi.mock("@/billing/entitlements", async (orig) => ({ ...(await orig<typeof import("@/billing/entitlements")>()), entitledNow: () => entitled.value }));

import { ANCHOR_WAIT_MS, findAnchor, openFeature } from "@/app/featureOpen";
import { featureSearchId } from "@/app/featureQuery";
import { useArrival } from "@/app/arrival";
import { useBilling } from "@/billing/store";
import { setCloudEnabledForTests } from "@/cloud/env";
import { resetCloudSession, useCloudSession } from "@/cloud/session";
import { useSearch } from "@/search/searchStore";
import { clearReturnTo, peekReturnTo } from "@/store/returnTo";
import { useUi } from "@/store/uiStore";
import { useTraining } from "@/views/ueben/trainingStore";

function layer(page: string, html: string): HTMLElement {
  const el = document.createElement("div");
  el.setAttribute("data-page", page);
  el.setAttribute("data-page-role", "current");
  el.innerHTML = html;
  document.body.appendChild(el);
  return el;
}

const note = () => useArrival.getState().current;

beforeEach(() => {
  entitled.value = true;
  useArrival.setState({ current: null });
  clearReturnTo();
  resetCloudSession();
  document.body.innerHTML = "";
  useUi.setState({ toasts: [], page: "overview" });
  useSearch.setState({ recent: [] });
  useTraining.setState({ open: false, seq: 0 });
  useBilling.setState({ upgrade: { open: false, feature: null, plan: null } });
  Element.prototype.scrollIntoView = vi.fn();
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  location.hash = "";
});

afterEach(() => {
  vi.useRealTimers();
});

describe("openFeature", () => {
  it("returns false for an unknown id and does nothing", () => {
    expect(openFeature("gibt-es-nicht")).toBe(false);
    expect(useSearch.getState().recent).toEqual([]);
    expect(useUi.getState().toasts).toEqual([]);
  });

  it("opens a sheet function over the page (Üben) and remembers it as recently used", () => {
    expect(openFeature("ueben")).toBe(true);
    expect(useTraining.getState().open).toBe(true);
    expect(useUi.getState().page).toBe("overview");
    expect(useSearch.getState().recent[0]).toBe(featureSearchId("ueben"));
  });

  it("sends a user without the plan to the upgrade sheet instead of a closed door (Üben needs the replay)", () => {
    entitled.value = false;
    openFeature("ueben");
    expect(useTraining.getState().open).toBe(false);
    expect(useBilling.getState().upgrade).toMatchObject({ open: true, feature: "replay" });
  });

  // A4: nothing here ends in a toast – the arrival note (`arrival.ts`) says where the person is and what to tap next
  it("opens the editor for the screenshot import and names the way inside it (a note, no toast)", () => {
    openFeature("screenshot-import");
    expect(useUi.getState().editor.open).toBe(true);
    expect(note()?.text).toMatch(/Aus Screenshot übernehmen/);
    expect(useUi.getState().toasts).toEqual([]);
  });

  it("navigates to the page and says how to go on when there is nothing to scroll to (Was wäre wenn)", () => {
    openFeature("was-waere-wenn");
    expect(useUi.getState().page).toBe("trades");
    expect(note()).toMatchObject({ title: "Was wäre wenn", tone: "info", page: "trades" });
    expect(note()?.text).toMatch(/Trade öffnen → Was wäre wenn/);
    expect(useUi.getState().toasts).toEqual([]);
  });

  it("opens a PAGE as a target: `page:settings` navigates, counts as recent and needs no anchor", () => {
    expect(openFeature("page:settings")).toBe(true);
    expect(useUi.getState().page).toBe("settings");
    expect(useSearch.getState().recent[0]).toBe("page:settings");
    expect(note()).toBeNull();
    expect(openFeature("page:gibt-es-nicht")).toBe(false);
  });

  it("scrolls to the anchor once the page layer shows it", async () => {
    const host = layer("risiko", '<section data-testid="risk-calc"><h2>Rechner</h2></section>');
    openFeature("positionsrechner");
    expect(useUi.getState().page).toBe("risiko");
    await vi.waitFor(() => expect(Element.prototype.scrollIntoView).toHaveBeenCalled());
    expect((Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>).mock.contexts[0]).toBe(host.firstElementChild);
    expect(useUi.getState().toasts).toEqual([]);
  });

  it("finds an anchor by card heading when it has no test id", async () => {
    layer("overview", "<div><h3> Warum handeln oder auslassen? </h3></div>");
    openFeature("warum-handeln");
    await vi.waitFor(() => expect(Element.prototype.scrollIntoView).toHaveBeenCalled());
  });

  it("says why when the card is not there (a lab card before the first run), lands on the nearest card and keeps the focus there", () => {
    vi.useFakeTimers();
    const host = layer("labor", '<h1>Labor</h1><section data-testid="labor-config"><h2>Versuch</h2></section>');
    openFeature("diagnose");
    vi.advanceTimersByTime(ANCHOR_WAIT_MS + 500);
    expect(note()).toMatchObject({ tone: "warn", page: "labor" });
    expect(note()?.title).toMatch(/Diagnose: Warum so schwach\?: noch nicht zu sehen/);
    expect(note()?.text).toMatch(/sobald ein Test fertig ist/);
    // the assistant is the way on – never a dead end
    expect(note()?.actions.map((a) => a.id)).toContain("assistant");
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    expect(document.activeElement).toBe(host.querySelector('[data-testid="labor-config"]'));
    expect(useUi.getState().toasts).toEqual([]);
  });

  it("names the plan, leads to it and notes the way back instead of waiting for a card the plan hides", () => {
    entitled.value = false;
    openFeature("diagnose");
    expect(useUi.getState().page).toBe("labor");
    expect(note()).toMatchObject({ tone: "warn" });
    expect(note()?.title).toMatch(/ab dem Tarif Premium/);
    const plan = note()!.actions.find((a) => a.id === "plan")!;
    plan.run();
    // the sheet opens on the feature, and the original task waits for the plan
    expect(useBilling.getState().upgrade).toMatchObject({ open: true, feature: "backtestLab" });
    expect(peekReturnTo()).toMatchObject({ target: { kind: "feature", id: "diagnose" }, wait: { on: "entitled", feature: "backtestLab" } });
    expect(useUi.getState().toasts).toEqual([]);
  });

  it("a function that needs an account leads to the login and notes the way back (cloud on, signed out)", () => {
    vi.useFakeTimers();
    setCloudEnabledForTests(true);
    useCloudSession.setState({ phase: "signedOut" });
    layer("community", "<h1>Community</h1>");
    openFeature("gruppen");
    vi.advanceTimersByTime(ANCHOR_WAIT_MS + 500);
    expect(note()?.title).toMatch(/dafür brauchst du ein Konto/);
    note()!.actions.find((a) => a.id === "login")!.run();
    expect(useCloudSession.getState().sheet.open).toBe(true);
    expect(peekReturnTo()).toMatchObject({ target: { kind: "feature", id: "gruppen" }, wait: { on: "signedIn" } });
    setCloudEnabledForTests(null);
  });

  it("without any cloud in this build it says so honestly instead of offering a login that cannot work", () => {
    vi.useFakeTimers();
    setCloudEnabledForTests(false);
    layer("community", "<h1>Community</h1>");
    openFeature("gruppen");
    vi.advanceTimersByTime(ANCHOR_WAIT_MS + 500);
    expect(note()?.title).toMatch(/hier nicht verfügbar/);
    expect(note()?.actions.map((a) => a.id)).toEqual(["assistant"]);
    setCloudEnabledForTests(null);
  });

  it("opens what covers the target first: a closed fold, a closed toggle – then scrolls and focuses it", async () => {
    const host = layer(
      "settings",
      `<h1>Einstellungen</h1>
       <details data-fold><summary>Mehr</summary><div data-testid="settings-data"><h2>Daten</h2></div></details>`,
    );
    const details = host.querySelector("details")!;
    expect(details.open).toBe(false);
    openFeature("backup");
    await vi.waitFor(() => expect(Element.prototype.scrollIntoView).toHaveBeenCalled());
    expect(details.open).toBe(true);
    await vi.waitFor(() => expect(document.activeElement).toBe(host.querySelector('[data-testid="settings-data"]')));
    expect(note()).toBeNull();
  });

  it("a card that only arrives after the note (a slow page) is shown then and the note is taken back", () => {
    vi.useFakeTimers();
    const host = layer("risiko", "<h1>Risiko</h1>");
    openFeature("positionsrechner");
    vi.advanceTimersByTime(ANCHOR_WAIT_MS + 500);
    expect(note()?.title).toMatch(/Positionsrechner: noch nicht zu sehen/);
    // the finder stands on the page heading meanwhile
    expect(document.activeElement).toBe(host.querySelector("h1"));
    host.insertAdjacentHTML("beforeend", '<section data-testid="risk-calc"><h2>Rechner</h2></section>');
    vi.advanceTimersByTime(300);
    expect(note()).toBeNull();
    expect(document.activeElement).toBe(host.querySelector('[data-testid="risk-calc"]'));
  });

  it("…but never against the person: a key press ends the late look (a card that appears because they started a run must not pull the page away)", () => {
    vi.useFakeTimers();
    const host = layer("risiko", "<h1>Risiko</h1>");
    openFeature("positionsrechner");
    vi.advanceTimersByTime(ANCHOR_WAIT_MS + 500);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    host.insertAdjacentHTML("beforeend", '<section data-testid="risk-calc"><h2>Rechner</h2></section>');
    vi.advanceTimersByTime(500);
    expect(note()?.title).toMatch(/noch nicht zu sehen/);
    expect(document.activeElement).toBe(host.querySelector("h1"));
  });

  it("…and leaving the page ends it as well", () => {
    vi.useFakeTimers();
    const host = layer("risiko", "<h1>Risiko</h1>");
    openFeature("positionsrechner");
    vi.advanceTimersByTime(ANCHOR_WAIT_MS + 500);
    useUi.setState({ page: "markt" });
    vi.advanceTimersByTime(100);
    host.insertAdjacentHTML("beforeend", '<section data-testid="risk-calc"><h2>Rechner</h2></section>');
    vi.advanceTimersByTime(500);
    expect(document.activeElement).not.toBe(host.querySelector('[data-testid="risk-calc"]'));
  });

  it("waits for an open dialog before it scrolls (the welcome sheet after a login): a target behind a modal is not reached", async () => {
    const host = layer("risiko", '<h1>Risiko</h1><section data-testid="risk-calc"><h2>Rechner</h2></section>');
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    document.body.appendChild(dialog);
    openFeature("positionsrechner");
    expect(useUi.getState().page).toBe("risiko");
    // the page is open, but nothing is scrolled or focused while the dialog covers it
    await new Promise((r) => setTimeout(r, 150));
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(host.querySelector('[data-testid="risk-calc"]'));
    dialog.remove();
    await vi.waitFor(() => expect(Element.prototype.scrollIntoView).toHaveBeenCalled());
    await vi.waitFor(() => expect(document.activeElement).toBe(host.querySelector('[data-testid="risk-calc"]')));
  });

  it("presses the named choice when the target exists only after it (the rule builder under 'Eigene Idee')", async () => {
    const host = layer("labor", '<h1>Labor</h1><div data-testid="labor-config"><button type="button" role="radio" aria-checked="false" data-testid="labor-strategy-custom">Eigene Idee</button></div>');
    host.querySelector('[data-testid="labor-strategy-custom"]')!.addEventListener("click", () => {
      host.querySelector('[data-testid="labor-config"]')!.insertAdjacentHTML("beforeend", '<div data-testid="labor-builder"><h3>Regeln</h3></div>');
    });
    openFeature("indikator-bausteine");
    await vi.waitFor(() => expect(host.querySelector('[data-testid="labor-builder"]')).not.toBeNull());
    await vi.waitFor(() => expect(document.activeElement).toBe(host.querySelector('[data-testid="labor-builder"]')));
    expect(note()).toBeNull();
  });

  it("can skip the recent list (a preview)", () => {
    openFeature("ueben", { remember: false });
    expect(useSearch.getState().recent).toEqual([]);
  });
});

describe("findAnchor", () => {
  it("prefers the test id, falls back to the heading start, and returns null for neither", () => {
    const host = document.createElement("div");
    host.innerHTML = '<h2>Daten und mehr</h2><div data-testid="x-card"></div>';
    expect(findAnchor(host, { testid: "x-card", heading: "Daten" })?.getAttribute("data-testid")).toBe("x-card");
    expect(findAnchor(host, { heading: "Daten" })?.tagName).toBe("H2");
    expect(findAnchor(host, { testid: "nope" })).toBeNull();
    expect(findAnchor(host, { heading: "Nope" })).toBeNull();
  });
});
