/**
 * Runde 17 (motion review, measured in the running app – `docs/ANIMATIONEN-MATRIX.md`, „Runde 17“): a crawl clicked ≈ 1 000 controls on
 * all 19 pages (1440 and 390 px) and recorded every surface that appeared or left without any movement. What was left were small pieces
 * that appear IN PLACE after an action. These tests pin the building block and the places it is used.
 */
import { readFileSync } from "node:fs";
import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Arrive, ARRIVE_RISE, ARRIVE_S } from "@/motion/Arrive";
import { useMotionPref } from "@/motion/profile";

const read = (p: string) => readFileSync(p, "utf8");

interface Run {
  el: Element;
  frames: Keyframe[];
  opts: KeyframeAnimationOptions;
  cancel: ReturnType<typeof vi.fn>;
}

/** Gives every element a recording `animate` (jsdom has none) for the length of a test. */
function recordAnimations(): Run[] {
  const runs: Run[] = [];
  (Element.prototype as unknown as { animate: unknown }).animate = function (this: Element, frames: Keyframe[], opts: KeyframeAnimationOptions) {
    const run: Run = { el: this, frames, opts, cancel: vi.fn() };
    runs.push(run);
    return { cancel: run.cancel, play() {}, finished: Promise.resolve(), currentTime: 0 };
  };
  return runs;
}

afterEach(() => {
  delete (Element.prototype as unknown as { animate?: unknown }).animate;
  useMotionPref.getState().setMode("system");
});

describe("Arrive: a piece that appears in place rises in once", () => {
  it("one native run on the piece itself (no wrapper): opacity and a short rise, shorter than a card's entrance", () => {
    const runs = recordAnimations();
    const { getByTestId } = render(
      <Arrive as="p" data-testid="piece" className="x">
        Text
      </Arrive>,
    );
    const piece = getByTestId("piece");
    expect(piece.tagName).toBe("P");
    expect(piece.className).toBe("x");
    expect(runs).toHaveLength(1);
    expect(runs[0].el).toBe(piece);
    expect(runs[0].frames).toEqual([
      { opacity: 0, transform: `translateY(${ARRIVE_RISE}px)` },
      { opacity: 1, transform: "none" },
    ]);
    // `backwards`: hidden only until its first frame – afterwards the piece shows its own style, nothing can stay invisible
    expect(runs[0].opts).toMatchObject({ duration: ARRIVE_S * 1000, delay: 0, fill: "backwards" });
    expect(ARRIVE_S).toBeLessThan(0.42);
  });

  it("`play={false}` mounts without an entrance, and a later change of the prop never starts one on a piece that stands", () => {
    const runs = recordAnimations();
    const { rerender } = render(<Arrive play={false}>a</Arrive>);
    rerender(<Arrive play>a</Arrive>);
    expect(runs).toHaveLength(0);
  });

  it("a new `key` replays it for new content; unmounting cancels what still runs", () => {
    const runs = recordAnimations();
    const { rerender, unmount } = render(<Arrive key="a">a</Arrive>);
    rerender(<Arrive key="b">b</Arrive>);
    expect(runs).toHaveLength(2);
    expect(runs[0].cancel).toHaveBeenCalledTimes(1);
    unmount();
    expect(runs[1].cancel).toHaveBeenCalledTimes(1);
  });

  it("reduced motion: the piece is simply there", () => {
    const runs = recordAnimations();
    useMotionPref.getState().setMode("reduced");
    const { getByText } = render(<Arrive>da</Arrive>);
    expect(getByText("da")).toBeTruthy();
    expect(runs).toHaveLength(0);
  });

  it("without Web Animations (jsdom, old engines) nothing breaks and the piece is there", () => {
    const { getByText } = render(<Arrive>da</Arrive>);
    expect(getByText("da")).toBeTruthy();
  });
});

describe("the places the crawl found", () => {
  it("Markt › Chart spiegeln: the RSI option row under the switch arrives", () => {
    expect(read("src/views/biasTest/MirrorPanel.tsx")).toMatch(/<Arrive className="grid gap-1" data-testid="bias-rsi-option">/);
  });

  it("Coach: a lesson that replaces another rises in – the one the card arrived with does not play twice", () => {
    const src = read("src/views/coach/HeroCard.tsx");
    expect(src).toMatch(/const \[arrivedWith\] = useState\(lessonKey\);/);
    expect(src).toMatch(/<Arrive as="p" key=\{lessonKey\} play=\{lessonKey !== arrivedWith\}/);
  });

  it("Entscheidungsgrundlagen: the facet row only plays when it appears later, never with the page", () => {
    const src = read("src/views/setups/LibraryBar.tsx");
    expect(src).toMatch(/const \[rowFromStart\] = useState\(hasRow\);/);
    expect(src).toMatch(/<Arrive play=\{!rowFromStart\}/);
  });

  it("Alle Trades › „+ Ansicht speichern“: the name field grows in like a saved view's chip; reduced motion: at once", () => {
    const src = read("src/journal/filters/JournalFilterBar.tsx");
    expect(src).toMatch(/<motion\.input\s+initial=\{reduced \? false : \{ opacity: 0, scale: 0\.92 \}\}/);
  });

  it("Konto › Server-Backups: the inline question grows in like the same question in Einstellungen › Daten", () => {
    const konto = read("src/cloud/ui/AccountDataCard.tsx");
    const settings = read("src/views/settings/DataCard.tsx");
    const entrance = /initial=\{reduced \? false : \{ opacity: 0, scale: 0\.96 \}\}/;
    expect(konto).toMatch(entrance);
    expect(settings).toMatch(entrance);
  });
});
