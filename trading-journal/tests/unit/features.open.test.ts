/**
 * Opening a function of the register: an action opens its sheet over the page, a place navigates and scrolls to its
 * anchor once the (lazy) page shows it – and nothing is a silent dead end: a plan the user lacks, an anchor that is not on
 * the page and a way without anchor each say so in one toast. Opening counts as "Zuletzt benutzt" (the search's recent ids).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const entitled = vi.hoisted(() => ({ value: true }));
vi.mock("@/billing/entitlements", async (orig) => ({ ...(await orig<typeof import("@/billing/entitlements")>()), entitledNow: () => entitled.value }));

import { ANCHOR_WAIT_MS, findAnchor, openFeature } from "@/app/featureOpen";
import { featureSearchId } from "@/app/featureQuery";
import { useBilling } from "@/billing/store";
import { useSearch } from "@/search/searchStore";
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

const lastToast = () => useUi.getState().toasts.at(-1);

beforeEach(() => {
  entitled.value = true;
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

  it("opens the editor for the screenshot import and names the way inside it", () => {
    openFeature("screenshot-import");
    expect(useUi.getState().editor.open).toBe(true);
    expect(lastToast()?.detail).toMatch(/Aus Screenshot übernehmen/);
  });

  it("navigates to the page and says how to go on when there is nothing to scroll to (Was wäre wenn)", () => {
    openFeature("was-waere-wenn");
    expect(useUi.getState().page).toBe("trades");
    expect(lastToast()).toMatchObject({ title: "Was wäre wenn" });
    expect(lastToast()?.detail).toMatch(/Trade öffnen → Was wäre wenn/);
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

  it("says why when the card is not there (a lab card before the first run)", () => {
    vi.useFakeTimers();
    layer("labor", '<section data-testid="labor-config"></section>');
    openFeature("diagnose");
    vi.advanceTimersByTime(ANCHOR_WAIT_MS + 500);
    expect(lastToast()).toMatchObject({ title: "Diagnose: Warum so schwach?" });
    expect(lastToast()?.detail).toMatch(/sobald ein Test fertig ist/);
  });

  it("names the plan instead of waiting for a card the plan hides", () => {
    entitled.value = false;
    openFeature("diagnose");
    expect(useUi.getState().page).toBe("labor");
    expect(lastToast()?.detail).toBe("Ab dem Tarif Premium.");
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
