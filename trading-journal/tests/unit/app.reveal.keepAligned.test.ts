/**
 * `keepAligned` (reveal.ts): brings a revealed target back to its line while the page above it still grows – and follows a target that is
 * REPLACED meanwhile (a placeholder swapped for the real card): the new element with the same `data-testid` (or heading) takes over, for a
 * bounded time, never in a loop.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { keepAligned } from "@/app/reveal";

function layer(html: string): HTMLElement {
  const el = document.createElement("div");
  el.setAttribute("data-page", "settings");
  el.setAttribute("data-page-role", "current");
  el.innerHTML = html;
  document.body.appendChild(el);
  return el;
}

/** An element whose box starts `top` px below the viewport's top. */
function at(el: Element | null, top: number): HTMLElement {
  vi.spyOn(el as HTMLElement, "getBoundingClientRect").mockReturnValue({ top, bottom: top + 100, left: 0, right: 100, width: 100, height: 100, x: 0, y: top, toJSON: () => ({}) } as DOMRect);
  return el as HTMLElement;
}

let scrollBy: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = "";
  scrollBy = vi.fn();
  window.scrollBy = scrollBy as unknown as typeof window.scrollBy;
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("keepAligned", () => {
  it("brings a target that sits lower than its line back to it at the fixed moments", () => {
    const host = layer('<section data-testid="card"></section>');
    keepAligned(at(host.firstElementChild, 300));
    vi.advanceTimersByTime(900);
    expect(scrollBy).toHaveBeenCalledWith({ top: 300, behavior: "instant" });
  });

  it("leaves a target that is within the tolerance alone", () => {
    const host = layer('<section data-testid="card"></section>');
    keepAligned(at(host.firstElementChild, 10));
    vi.advanceTimersByTime(3000);
    expect(scrollBy).not.toHaveBeenCalled();
  });

  it("follows a target that was REPLACED (placeholder → real card, same test id): the new element is aligned", () => {
    const host = layer('<section data-testid="card" data-placeholder></section>');
    keepAligned(at(host.firstElementChild, 300));
    // the real card takes the place of the placeholder before the first moment
    vi.advanceTimersByTime(300);
    host.innerHTML = '<section data-testid="card" data-real></section>';
    at(host.firstElementChild, 420);
    vi.advanceTimersByTime(600);
    expect(scrollBy).toHaveBeenCalledWith({ top: 420, behavior: "instant" });
  });

  it("follows a replaced heading by its text", () => {
    const host = layer("<h2> Daten und mehr </h2>");
    keepAligned(at(host.firstElementChild, 200));
    host.innerHTML = "<h2>Daten und mehr</h2>";
    at(host.firstElementChild, 350);
    vi.advanceTimersByTime(900);
    expect(scrollBy).toHaveBeenCalledWith({ top: 350, behavior: "instant" });
  });

  it("keeps looking for the real card within the grace time: a card that comes at 1 s is aligned at the next moment", () => {
    const host = layer('<section data-testid="card"></section>');
    keepAligned(at(host.firstElementChild, 300));
    host.innerHTML = "";
    vi.advanceTimersByTime(900); // first moment (0.8 s): nothing there yet, no scroll, still waiting
    expect(scrollBy).not.toHaveBeenCalled();
    host.innerHTML = '<section data-testid="card"></section>';
    at(host.firstElementChild, 500);
    vi.advanceTimersByTime(800); // second moment (1.6 s)
    expect(scrollBy).toHaveBeenCalledWith({ top: 500, behavior: "instant" });
  });

  it("ends – without a loop – when the real card never comes: no scroll, no timer left", () => {
    const host = layer('<section data-testid="card"></section>');
    keepAligned(at(host.firstElementChild, 300));
    host.innerHTML = "";
    vi.advanceTimersByTime(5000);
    expect(scrollBy).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("an element with neither test id nor heading cannot be found again: a vanished one ends the alignment at once", () => {
    const host = layer("<div><p>x</p></div>");
    const el = at(host.firstElementChild, 300);
    keepAligned(el);
    el.remove();
    vi.advanceTimersByTime(900);
    expect(scrollBy).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a key press ends it at once (never against the person)", () => {
    const host = layer('<section data-testid="card"></section>');
    keepAligned(at(host.firstElementChild, 300));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    vi.advanceTimersByTime(3000);
    expect(scrollBy).not.toHaveBeenCalled();
  });
});
