/**
 * `SectionNav` – the "Inhalt" strip of a long page: one chip per section, a tap scrolls the section under the header, the
 * section in view is marked, targets are found by `data-section` / `data-testid` / `id` / the heading of their card, a chip whose
 * section is not on the page is dropped, and the strip tells the document how tall it is.
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findSection, SectionNav, SECTION_NAV_TOP, type SectionNavItem } from "@/primitives/SectionNav";

type Entry = Pick<IntersectionObserverEntry, "target" | "isIntersecting" | "boundingClientRect" | "rootBounds">;

class FakeIO {
  static all: FakeIO[] = [];
  observed = new Set<Element>();
  constructor(
    private cb: (entries: Entry[]) => void,
    public init?: IntersectionObserverInit,
  ) {
    FakeIO.all.push(this);
  }
  observe(el: Element) {
    this.observed.add(el);
  }
  disconnect() {
    this.observed.clear();
  }
  unobserve(el: Element) {
    this.observed.delete(el);
  }
  takeRecords() {
    return [];
  }
  /** `top` of each target relative to the band's top (negative = above it, already passed) */
  report(tops: Record<string, number>) {
    const entries: Entry[] = [];
    for (const el of this.observed) {
      const id = el.getAttribute("data-section") ?? el.getAttribute("data-testid") ?? el.id;
      if (id in tops) entries.push({ target: el, isIntersecting: tops[id]! >= 0 && tops[id]! < 300, boundingClientRect: { top: tops[id]! + 100 } as DOMRectReadOnly, rootBounds: { top: 100 } as DOMRectReadOnly });
    }
    act(() => this.cb(entries));
  }
}

const ITEMS: SectionNavItem[] = [
  { id: "first", label: "Erste" },
  { id: "second-card", label: "Zweite" },
  { id: "third", label: "Dritte" },
  { id: "fourth", label: "Vierte", heading: "Die vierte Karte" },
];

function Page({ items = ITEMS, skip = "" }: { items?: readonly SectionNavItem[]; skip?: string }) {
  return (
    <div data-page="test" data-page-role="current">
      <SectionNav items={items} />
      {skip !== "first" && <div data-section="first">1</div>}
      {skip !== "second" && <div data-testid="second-card">2</div>}
      <div id="third">3</div>
      <div className="rounded-2xl" data-testid="the-card">
        <h2>Die vierte Karte · Zusatz</h2>
      </div>
    </div>
  );
}

const chip = (name: string) => screen.getByRole("button", { name });

describe("SectionNav", () => {
  beforeEach(() => {
    FakeIO.all = [];
    vi.stubGlobal("IntersectionObserver", FakeIO);
    Element.prototype.scrollIntoView = vi.fn();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    document.documentElement.style.removeProperty("--section-nav-h");
  });

  it("is a navigation landmark with one chip per section, sticking right under the header", () => {
    render(<Page />);
    const nav = screen.getByRole("navigation", { name: "Inhalt dieser Seite" });
    expect(within(nav).getAllByRole("button").map((b) => b.textContent)).toEqual(["Erste", "Zweite", "Dritte", "Vierte"]);
    expect(nav.style.top.replace(/\s/g, "")).toContain("64px"); // the header is h-16 (jsdom reorders the calc)
    expect(SECTION_NAV_TOP).toContain("64px");
    expect(nav.className).toContain("sticky");
    // nothing else of the page is touched: no attribute is written onto the sections
    expect(document.querySelector("[data-section=first]")!.getAttributeNames()).toEqual(["data-section"]);
  });

  it("shows nothing for fewer than two sections", () => {
    const { container } = render(<Page items={[ITEMS[0]!]} />);
    expect(container.querySelector("nav")).toBeNull();
  });

  it("finds a section by data-section, data-testid, id, and by the heading of its card", () => {
    render(<Page />);
    const layer = document.querySelector("[data-page]")!;
    expect(findSection(layer, "first")?.textContent).toBe("1");
    expect(findSection(layer, "second-card")?.textContent).toBe("2");
    expect(findSection(layer, "third")?.textContent).toBe("3");
    expect(findSection(layer, "fourth", "Die vierte Karte")?.getAttribute("data-testid")).toBe("the-card");
    expect(findSection(layer, "nope")).toBeNull();
    expect(findSection(layer, "nope", "Gibt es nicht")).toBeNull();
  });

  it("scrolls the section under the header when a chip is tapped", () => {
    render(<Page />);
    fireEvent.click(chip("Dritte"), { detail: 1 });
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ block: "start" }));
    const target = (Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>).mock.contexts[0] as HTMLElement;
    expect(target.id).toBe("third");
    fireEvent.click(chip("Vierte"), { detail: 1 });
    const card = (Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>).mock.contexts[1] as HTMLElement;
    expect(card.getAttribute("data-testid")).toBe("the-card");
  });

  it("moves reading focus into the section only for the keyboard", () => {
    render(<Page />);
    fireEvent.click(chip("Erste"), { detail: 1 });
    expect(document.activeElement).not.toBe(document.querySelector("[data-section=first]"));
    fireEvent.click(chip("Erste"), { detail: 0 });
    const target = document.querySelector<HTMLElement>("[data-section=first]")!;
    expect(target.getAttribute("tabindex")).toBe("-1");
    expect(document.activeElement).toBe(target);
  });

  it("marks the section in view: the last one whose start has passed the line under the strip", () => {
    render(<Page />);
    const io = FakeIO.all.at(-1)!;
    expect(chip("Erste")).toHaveAttribute("aria-current", "location");
    // first is above the line, second inside the band, third and fourth still below it
    io.report({ first: -400, "second-card": 40, third: 900, "the-card": 1400 });
    expect(chip("Zweite")).toHaveAttribute("aria-current", "location");
    expect(chip("Erste")).not.toHaveAttribute("aria-current");
    // scrolled further: the third passed
    io.report({ third: -10 });
    expect(chip("Dritte")).toHaveAttribute("aria-current", "location");
    // and back up: the third is below the band again
    io.report({ third: 500 });
    expect(chip("Zweite")).toHaveAttribute("aria-current", "location");
    expect(screen.getAllByRole("button").filter((b) => b.hasAttribute("aria-current"))).toHaveLength(1);
  });

  it("observes with a band that starts under the header and the strip", () => {
    render(<Page />);
    const io = FakeIO.all.at(-1)!;
    expect(io.init?.rootMargin).toMatch(/^-\d+px 0px -55% 0px$/);
    expect(io.observed.size).toBe(4);
  });

  it("drops the chip of a section that is not on the page after a few seconds, instead of pointing nowhere", () => {
    vi.useFakeTimers();
    render(<Page skip="second" />);
    expect(screen.getAllByRole("button")).toHaveLength(4);
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["Erste", "Dritte", "Vierte"]);
  });

  it("tells the document how tall it is while it is on the page, and takes that back when it leaves", () => {
    const { unmount } = render(<Page />);
    expect(document.documentElement.style.getPropertyValue("--section-nav-h")).toMatch(/^\d+px$/);
    unmount();
    expect(document.documentElement.style.getPropertyValue("--section-nav-h")).toBe("");
  });

  it("an old page's strip leaving (the page slides out while the new one slides in) never wipes the new strip's height", () => {
    const old = render(<Page />);
    const fresh = render(<Page />);
    expect(document.documentElement.style.getPropertyValue("--section-nav-h")).toMatch(/^\d+px$/);
    old.unmount();
    expect(document.documentElement.style.getPropertyValue("--section-nav-h")).toMatch(/^\d+px$/);
    fresh.unmount();
    expect(document.documentElement.style.getPropertyValue("--section-nav-h")).toBe("");
  });

  it("moves along the strip with the arrow keys, Home and End", () => {
    render(<Page />);
    chip("Erste").focus();
    fireEvent.keyDown(chip("Erste"), { key: "ArrowRight" });
    expect(chip("Zweite")).toHaveFocus();
    fireEvent.keyDown(chip("Zweite"), { key: "End" });
    expect(chip("Vierte")).toHaveFocus();
    fireEvent.keyDown(chip("Vierte"), { key: "ArrowRight" });
    expect(chip("Erste")).toHaveFocus();
    fireEvent.keyDown(chip("Erste"), { key: "ArrowLeft" });
    expect(chip("Vierte")).toHaveFocus();
  });

  it("never slides the strip under a chip that is being pressed (the tap would be lost), and does again after the release", () => {
    const scrollTo = vi.fn();
    const had = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollTo");
    Object.defineProperty(HTMLElement.prototype, "scrollTo", { value: scrollTo, configurable: true, writable: true });
    try {
      render(<Page />);
      const io = FakeIO.all.at(-1)!;
      fireEvent.pointerDown(chip("Dritte"));
      io.report({ first: -400, "second-card": -200, third: 40 }); // the page moves on while the finger is down
      expect(chip("Dritte")).toHaveAttribute("aria-current", "location");
      expect(scrollTo).not.toHaveBeenCalled();
      fireEvent(window, new Event("pointerup"));
      io.report({ third: -400, "the-card": 40 });
      expect(chip("Vierte")).toHaveAttribute("aria-current", "location");
      expect(scrollTo).toHaveBeenCalledTimes(1);
    } finally {
      if (had) Object.defineProperty(HTMLElement.prototype, "scrollTo", had);
      else delete (HTMLElement.prototype as { scrollTo?: unknown }).scrollTo;
    }
  });

  it("works without an IntersectionObserver (the first section stays marked, nothing breaks)", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    render(<Page />);
    expect(chip("Erste")).toHaveAttribute("aria-current", "location");
    fireEvent.click(chip("Zweite"), { detail: 1 });
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });
});
