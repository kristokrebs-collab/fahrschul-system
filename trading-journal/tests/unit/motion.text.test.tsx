import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetInViewObserverForTests } from "@/motion/inView";
import { REVEAL_FROM, Reveal, RevealGroup, RevealItem, revealDelay } from "@/motion/Reveal";
import { TextRoll, MORPH_MAX_CHARS, RAPID_SWAP_MS, morphGlyphs } from "@/motion/TextRoll";
import { SCRAMBLE_CHARSET, TextScramble, scrambleDuration, scrambleText } from "@/motion/TextScramble";
import { TextShimmer } from "@/motion/TextShimmer";
import { stagger } from "@/motion/tokens";

const fx = vi.hoisted(() => ({ reduced: false }));
vi.mock("@/motion/useReducedFx", () => ({ useReducedFx: () => fx.reduced }));

afterEach(() => {
  fx.reduced = false;
});

describe("TextRoll", () => {
  it("keys glyphs by character + occurrence so shared letters keep their identity", () => {
    expect(morphGlyphs("Speichern").map((g) => g.key)).toEqual(["S-0", "p-0", "e-0", "i-0", "c-0", "h-0", "e-1", "r-0", "n-0"]);
    expect(morphGlyphs("Live · 5s").map((g) => g.ch).join("")).toBe("Live · 5s");
  });

  it("keeps textContent and the accessible name exactly the current label, synchronously", () => {
    const { container, rerender } = render(
      <button type="button">
        <TextRoll text="Speichern" />
      </button>,
    );
    expect(screen.getByRole("button", { name: "Speichern" })).toBeInTheDocument();
    expect(container.textContent).toBe("Speichern");
    rerender(
      <button type="button">
        <TextRoll text="Gespeichert" />
      </button>,
    );
    // exiting letters may still be animating out, but they carry no text nodes
    expect(container.textContent).toBe("Gespeichert");
    expect(screen.getAllByText("Gespeichert")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Gespeichert" })).toBeInTheDocument();
    const visual = container.querySelector("[aria-hidden='true']") as HTMLElement;
    expect(Array.from(visual.querySelectorAll("[data-ch]:not([data-exiting])")).map((n) => n.getAttribute("data-ch")).join("")).toBe("Gespeichert");
  });

  it("rolls whole labels in roll mode, for long labels and (as a crossfade) under reduced motion", () => {
    const { container, rerender } = render(<TextRoll text="LIVE" mode="roll" />);
    expect(container.querySelector("[data-text='LIVE']")).not.toBeNull();
    const long = "x".repeat(MORPH_MAX_CHARS + 1);
    rerender(<TextRoll text={long} />);
    expect(container.querySelector("[data-ch]")).toBeNull();
    expect(container.querySelector(`[data-text='${long}']`)).not.toBeNull();
    fx.reduced = true;
    rerender(<TextRoll text="OFFLINE" />);
    expect(container.querySelector("[data-text='OFFLINE']")).not.toBeNull();
    expect(container.textContent).toBe("OFFLINE");
  });
});

describe("TextRoll rapid swaps", () => {
  it("a swap within RAPID_SWAP_MS replaces the roll in flight: never stacked labels; a slow swap still rolls", () => {
    let now = 1000;
    const clock = vi.spyOn(performance, "now").mockImplementation(() => now);
    try {
      const { container, rerender } = render(<TextRoll text="84" mode="roll" />);
      const labels = () => Array.from(container.querySelectorAll("[data-text]")).map((n) => n.getAttribute("data-text"));
      now += 1000;
      rerender(<TextRoll text="85" mode="roll" />);
      // a normal swap rolls: the old label leaves while the new one comes in
      expect(labels()).toEqual(expect.arrayContaining(["84", "85"]));
      now += RAPID_SWAP_MS / 2;
      rerender(<TextRoll text="86" mode="roll" />);
      now += RAPID_SWAP_MS / 2;
      rerender(<TextRoll text="87" mode="roll" />);
      // rapid: only the newest label, nothing rolling out
      expect(labels()).toEqual(["87"]);
      expect(container.querySelector(".tabular-nums")).not.toBeNull();
    } finally {
      clock.mockRestore();
    }
  });
});

describe("TextScramble", () => {
  const rand = () => 0;

  it("locks characters left to right and keeps whitespace", () => {
    expect(scrambleText("BTC USDT", 0, rand)).toBe("000 0000");
    expect(scrambleText("BTC USDT", 1, rand)).toBe("BTC USDT");
    expect(scrambleText("ABCD", 0.5, rand)).toBe("AB00");
    expect(scrambleText("ABCD", 0.5, () => 0.999, "#")).toBe("AB##");
    expect(scrambleText("", 0.5, rand)).toBe("");
    expect(scrambleText("A", 2, rand)).toBe("A");
    expect(Array.from(SCRAMBLE_CHARSET).length).toBeGreaterThan(10);
  });

  it("scales the duration with the label and clamps it", () => {
    expect(scrambleDuration(1)).toBe(0.35);
    expect(scrambleDuration(10)).toBeCloseTo(0.25 + 10 * stagger.letters);
    expect(scrambleDuration(100)).toBe(0.8);
  });

  it("decodes through an aria-hidden overlay while the real text keeps textContent and name", async () => {
    const { container } = render(<TextScramble text="Übersicht" as="h2" duration={0.12} />);
    const heading = screen.getByRole("heading", { name: "Übersicht" });
    expect(heading.textContent).toBe("Übersicht");
    const [real, overlay] = Array.from(heading.children) as HTMLElement[];
    expect(overlay).toHaveAttribute("aria-hidden", "true");
    expect(real?.style.opacity).toBe("0");
    expect(overlay?.getAttribute("data-t")).toHaveLength("Übersicht".length);
    await waitFor(() => expect(real?.style.opacity).toBe(""));
    expect(overlay?.getAttribute("data-t")).toBe("");
    expect(container.textContent).toBe("Übersicht");
  });

  it("can skip the mount decode, decodes on change and never under reduced motion", async () => {
    const { rerender } = render(<TextScramble text="BTCUSDT" scrambleOnMount={false} duration={0.1} />);
    const real = screen.getByText("BTCUSDT");
    expect(real.style.opacity).toBe("");
    rerender(<TextScramble text="ETHUSDT" scrambleOnMount={false} duration={0.1} />);
    expect(screen.getByText("ETHUSDT").style.opacity).toBe("0");
    await waitFor(() => expect(screen.getByText("ETHUSDT").style.opacity).toBe(""));

    fx.reduced = true;
    rerender(<TextScramble text="SOLUSDT" scrambleOnMount={false} duration={0.1} />);
    expect(screen.getByText("SOLUSDT").style.opacity).toBe("");
  });
});

describe("TextShimmer", () => {
  it("keeps textContent unchanged and clips the band to the glyphs", () => {
    render(<TextShimmer>Verbinde …</TextShimmer>);
    const el = screen.getByText("Verbinde …");
    expect(el.textContent).toBe("Verbinde …");
    expect(el.style.backgroundClip).toBe("text");
    expect(el.style.color).toBe("transparent");
    expect(el).toHaveAttribute("data-shimmer");
  });

  it("is static under reduced motion or when inactive", () => {
    const { rerender } = render(<TextShimmer active={false}>Lade Kerzen …</TextShimmer>);
    const el = screen.getByText("Lade Kerzen …");
    expect(el.style.backgroundClip).toBe("");
    expect(el).not.toHaveAttribute("data-shimmer");
    fx.reduced = true;
    rerender(<TextShimmer>Lade Kerzen …</TextShimmer>);
    expect(el.style.backgroundClip).toBe("");
  });
});

/* ------------------------------------------------------------------ Reveal */

class MockIO {
  static all: MockIO[] = [];
  readonly els = new Set<Element>();
  constructor(
    readonly cb: IntersectionObserverCallback,
    readonly options?: IntersectionObserverInit,
  ) {
    MockIO.all.push(this);
  }
  observe(el: Element) {
    this.els.add(el);
  }
  unobserve(el: Element) {
    this.els.delete(el);
  }
  disconnect() {
    this.els.clear();
  }
  takeRecords() {
    return [];
  }
}

function intersect(el: Element, isIntersecting = true) {
  for (const io of MockIO.all.filter((o) => o.els.has(el))) {
    io.cb([{ target: el, isIntersecting, intersectionRatio: isIntersecting ? 1 : 0 } as unknown as IntersectionObserverEntry], io as unknown as IntersectionObserver);
  }
}

describe("Reveal", () => {
  it("caps the stagger delay", () => {
    expect(revealDelay(0)).toBe(0);
    expect(revealDelay(2)).toBeCloseTo(2 * stagger.reveal);
    expect(revealDelay(500)).toBeCloseTo(stagger.max * stagger.reveal);
    expect(revealDelay(-3, 0.1)).toBeCloseTo(0.1);
  });

  it("renders content statically without IntersectionObserver (jsdom/SSR)", () => {
    render(
      <Reveal as="section" index={3} data-testid="r">
        <h2>Karte</h2>
      </Reveal>,
    );
    const el = screen.getByTestId("r");
    expect(el.tagName).toBe("SECTION");
    expect(el.style.opacity).toBe("");
    expect(el.style.filter).toBe("");
  });

  describe("with IntersectionObserver", () => {
    beforeEach(() => {
      vi.stubGlobal("IntersectionObserver", MockIO);
      resetInViewObserverForTests();
    });
    afterEach(() => {
      vi.unstubAllGlobals();
      resetInViewObserverForTests();
    });

    it("blur-fades in once and ends at transform:none / filter:none", async () => {
      render(
        <Reveal data-testid="r">
          <h2>Karte</h2>
        </Reveal>,
      );
      const el = screen.getByTestId("r");
      expect(el.style.opacity).toBe(String(REVEAL_FROM.opacity));
      expect(el.style.filter).toBe(REVEAL_FROM.filter);
      expect(el.style.transform).toContain("translateY(14px)");
      act(() => intersect(el));
      await waitFor(
        () => {
          expect(el.style.opacity).toBe("1");
          expect(el.style.filter).toBe("none");
          expect(["", "none"]).toContain(el.style.transform);
        },
        { timeout: 3000 },
      );
    });

    it("uses initial={false} under reduced motion: never hidden", () => {
      fx.reduced = true;
      render(
        <Reveal data-testid="r">
          <button type="button">Details +</button>
        </Reveal>,
      );
      const el = screen.getByTestId("r");
      expect(el.style.opacity).toBe("");
      expect(el.style.filter).toBe("");
    });

    it("RevealGroup staggers its items in and still reveals items mounted later", async () => {
      const { rerender } = render(
        <RevealGroup as="ul" data-testid="g">
          <RevealItem as="li">A</RevealItem>
          <RevealItem as="li">B</RevealItem>
        </RevealGroup>,
      );
      const items = () => Array.from(screen.getByTestId("g").children) as HTMLElement[];
      expect(items().map((i) => i.style.opacity)).toEqual(["0", "0"]);
      act(() => intersect(screen.getByTestId("g")));
      await waitFor(() => expect(items().map((i) => i.style.opacity)).toEqual(["1", "1"]), { timeout: 3000 });
      rerender(
        <RevealGroup as="ul" data-testid="g">
          <RevealItem as="li">A</RevealItem>
          <RevealItem as="li">B</RevealItem>
          <RevealItem as="li">C</RevealItem>
        </RevealGroup>,
      );
      await waitFor(() => expect(items()[2]?.style.opacity).toBe("1"), { timeout: 3000 });
      await waitFor(() => expect(items().every((i) => i.style.filter === "none")).toBe(true), { timeout: 3000 });
    });

    it("RevealGroup renders statically under reduced motion", () => {
      fx.reduced = true;
      render(
        <RevealGroup data-testid="g">
          <RevealItem>A</RevealItem>
        </RevealGroup>,
      );
      const item = screen.getByTestId("g").firstElementChild as HTMLElement;
      expect(item.style.opacity).toBe("");
    });
  });
});
