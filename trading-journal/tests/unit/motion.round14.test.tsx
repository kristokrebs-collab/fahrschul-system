/**
 * Runde 14 (motion review, measured in the running app – `docs/ANIMATIONEN-MATRIX.md`, „Runde 14“): the places that still arrived as one
 * block or swapped in one frame now build up one after another. These tests pin the contracts; order and presence were measured in the
 * browser.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { lazy, useState, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PageSuspense } from "@/app/PageSuspense";
import { setGatePreload, warmGate } from "@/cloud/gate";
import { RichContext } from "@/motion/rich";
import { stagedIn } from "@/motion/stagedIn";
import { stagger } from "@/motion/tokens";
import { EmptyState } from "@/primitives/EmptyState";
import { CloseRitual } from "@/views/berichte/CloseRitual";

const read = (p: string) => readFileSync(p, "utf8");
const noComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

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
  setGatePreload(null);
});

describe("stagedIn", () => {
  it("one run per piece, each a step later: opacity and a short rise, ease-out, hidden only while it waits (`backwards`)", () => {
    const runs = recordAnimations();
    const pieces = [1, 2, 3].map(() => document.createElement("div"));
    stagedIn(pieces, { delay: 0.1, step: 0.05, rise: 6, duration: 0.3 });
    expect(runs.map((r) => r.el)).toEqual(pieces);
    expect(runs.map((r) => Math.round(Number(r.opts.delay)))).toEqual([100, 150, 200]);
    for (const r of runs) {
      expect(r.frames).toEqual([
        { opacity: 0, transform: "translateY(6px)" },
        { opacity: 1, transform: "none" },
      ]);
      expect(r.opts).toMatchObject({ duration: 300, fill: "backwards", easing: "cubic-bezier(0.22, 1, 0.36, 1)" });
    }
  });

  it("a long list never takes seconds: pieces beyond the cap arrive with the last staged one; empty slots are skipped without a gap", () => {
    const runs = recordAnimations();
    stagedIn([null, ...Array.from({ length: stagger.max + 4 }, () => document.createElement("div")), undefined], { step: 0.04 });
    const delays = runs.map((r) => Math.round(Number(r.opts.delay)));
    expect(delays.slice(0, 3)).toEqual([0, 40, 80]);
    expect(Math.max(...delays)).toBe(stagger.max * 40);
    expect(runs).toHaveLength(stagger.max + 4);
  });

  it("a piece without a box (`display: contents`) lets its first child stand in; the returned function cancels what runs", () => {
    const runs = recordAnimations();
    const wrap = document.createElement("span");
    wrap.style.display = "contents";
    const inner = document.createElement("button");
    wrap.append(inner);
    document.body.append(wrap);
    const stop = stagedIn([wrap]);
    expect(runs.map((r) => r.el)).toEqual([inner]);
    stop();
    expect(runs[0]!.cancel).toHaveBeenCalledTimes(1);
    wrap.remove();
  });

  it("without Web Animations nothing happens and nothing is hidden", () => {
    const el = document.createElement("div");
    expect(() => stagedIn([el])()).not.toThrow();
    expect(el.getAttribute("style")).toBeNull();
  });
});

describe("a page that arrives after its skeleton", () => {
  const page = (resolve: { fn: ((m: { default: () => ReactNode }) => void) | null }) =>
    lazy(
      () =>
        new Promise<{ default: () => ReactNode }>((ok) => {
          resolve.fn = ok;
        }),
    );

  it("the skeleton was on screen → the page brightens in once (opacity from 0.35, `tween.fade`), on the page's own root", async () => {
    const runs = recordAnimations();
    const gate: { fn: ((m: { default: () => ReactNode }) => void) | null } = { fn: null };
    const View = page(gate);
    render(
      <PageSuspense page="analyse">
        <View />
      </PageSuspense>,
    );
    expect(document.querySelector('[data-page-skeleton="analyse"]')).not.toBeNull();
    await act(async () => {
      gate.fn?.({ default: () => <div data-testid="the-page">Analyse</div> });
      await Promise.resolve();
    });
    const root = await screen.findByTestId("the-page");
    expect(document.querySelector("[data-page-skeleton]")).toBeNull();
    const landing = runs.filter((r) => r.el === root);
    expect(landing).toHaveLength(1);
    expect(landing[0]!.frames).toEqual([{ opacity: 0.35 }, { opacity: 1 }]);
    expect(landing[0]!.opts).toMatchObject({ duration: 200, fill: "none" });
    // the marker that finds the page's root takes no room
    expect(document.querySelector("[data-page-landed]")).toHaveAttribute("hidden");
  });

  it("a page whose chunk is there at once never showed a skeleton and gets no extra fade (the page change itself is untouched)", () => {
    const runs = recordAnimations();
    render(
      <PageSuspense page="trades">
        <div data-testid="at-once">Trades</div>
      </PageSuspense>,
    );
    expect(runs.filter((r) => r.el === screen.getByTestId("at-once"))).toHaveLength(0);
  });
});

describe("empty state", () => {
  it("rich pages: picture, title, text and the action arrive one after the other, a beat after their card", () => {
    const runs = recordAnimations();
    render(
      <RichContext.Provider value={true}>
        <EmptyState title="Noch keine Trades" text="Trag deinen ersten Trade ein." line={false} action={<button type="button">Ersten Trade eintragen</button>} />
      </RichContext.Provider>,
    );
    const body = document.querySelector("[data-empty-body]")!;
    const staged = runs.filter((r) => r.frames.length === 2 && (r.frames[0] as Keyframe).transform === "translateY(8px)");
    expect(staged).toHaveLength(body.children.length);
    const delays = staged.map((r) => Math.round(Number(r.opts.delay)));
    expect(delays[0]).toBe(Math.round(stagger.lead * 1000));
    expect(delays).toEqual([...delays].sort((a, b) => a - b));
    expect(new Set(delays).size).toBe(delays.length);
    // the action's wrapper has no box in the browser (`display: contents`): there the button itself moves (jsdom knows no stylesheet,
    // so here the wrapper is taken – `stagedIn`'s own test covers the stand-in)
    const button = screen.getByRole("button", { name: "Ersten Trade eintragen" });
    expect([button, button.parentElement]).toContain(staged.at(-1)!.el);
  });

  it("the overview and the cockpit (not rich) keep the plain block – nothing is staged there", () => {
    const runs = recordAnimations();
    render(<EmptyState title="Dein Journal ist noch leer" line={false} />);
    expect(runs.filter((r) => (r.frames[0] as Keyframe | undefined)?.transform === "translateY(8px)")).toHaveLength(0);
  });
});

describe("the closing ritual", () => {
  const dots = [{ key: "2026-11-11", short: "Mi", state: "done" as const, label: "Mittwoch 11.11.: Rückblick gemacht" }];
  const action = { label: "Heute abschließen", hint: "Ein Tipp genügt.", done: "Heute abgeschlossen" };

  it("the word follows the check right after the tap (`fr-said` + `data-fresh`); a day merely shown as closed plays nothing", () => {
    function Ritual({ start }: { start: boolean }) {
      const [closed, setClosed] = useState(start);
      return <CloseRitual testid="t" items={null} dots={dots} dotsText="" closed={closed} ring busy={false} action={action} onClose={() => setClosed(true)} />;
    }
    // shown as closed from the start: the word is there, without the fresh mark
    const shown = render(<Ritual start />);
    expect(screen.getByText("Heute abgeschlossen")).toHaveClass("fr-said");
    expect(screen.getByText("Heute abgeschlossen")).not.toHaveAttribute("data-fresh");
    shown.unmount();
    // tapped (the store closes the day in the same event): the word carries the mark
    render(<Ritual start={false} />);
    expect(screen.getByText("Heute abschließen")).not.toHaveAttribute("data-fresh");
    fireEvent.click(screen.getByTestId("t-done"));
    expect(screen.getByText("Heute abgeschlossen")).toHaveAttribute("data-fresh");
  });

  it("the sequence is CSS in the lazy frost sheet: word after the stroke began, the way back after the word; opacity and transform only", () => {
    const css = noComments(read("src/views/berichte/frost.css"));
    expect(css).toMatch(/\.fr-said\[data-fresh\] \{\s*animation: fr-said 0\.38s cubic-bezier\(0\.22, 1, 0\.36, 1\) 0\.28s backwards;/);
    expect(css).toMatch(/\.fr-ritual:has\(\.fr-check\[data-fresh\]\) \+ div > button \{\s*animation: fr-said 0\.38s cubic-bezier\(0\.22, 1, 0\.36, 1\) 0\.6s backwards;/);
    const body = /@keyframes fr-said \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
    expect(body).toMatch(/opacity: 0;/);
    expect(body.replace(/opacity|transform/g, "")).not.toMatch(/\b(height|width|top|left|filter)\b/);
  });
});

describe("native <details> on rich pages", () => {
  it("what it reveals fades in (0.2 s, 4 px), `Fold` is left out, nothing is held after the run, and reduced motion gets none of it", () => {
    const css = noComments(read("src/motion/rich/rich.css"));
    const block = /@media \(prefers-reduced-motion: no-preference\) \{\s*\[data-rich\] details\[open\]:not\(\.group\\\/fold\) > :not\(summary\) \{\s*animation: rich-det-in 0\.2s cubic-bezier\(0, 0, 0\.58, 1\) backwards;\s*\}\s*\}/;
    expect(css).toMatch(block);
    const body = /@keyframes rich-det-in \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
    expect(body).toMatch(/opacity: 0;/);
    expect(body).toMatch(/transform: translateY\(-4px\);/);
  });
});

describe("signing out", () => {
  it("warms the gate's chunk before the app leaves (no blank screen in between); never in the way when nothing is registered or it throws", () => {
    expect(() => warmGate()).not.toThrow();
    const load = vi.fn();
    setGatePreload(load);
    warmGate();
    expect(load).toHaveBeenCalledTimes(1);
    setGatePreload(() => {
      throw new Error("offline");
    });
    expect(() => warmGate()).not.toThrow();
    // the sign-out of THIS device asks for it, revoking other sessions does not (the app stays)
    const client = read("src/cloud/client.ts");
    expect(client).toMatch(/export async function signOutScope\([^)]*\)[^{]*\{\s*(\/\/[^\n]*\n\s*)*if \(scope !== "others"\) warmGate\(\);/);
    expect(read("src/App.tsx")).toMatch(/setGatePreload\(\(\) => void loadEntryGate\(\)\.catch\(\(\) => undefined\)\);/);
  });
});

describe("press answers", () => {
  it("tiles, archive rows and section chips give under a press like every other control (they only changed colour on hover)", () => {
    expect(read("src/views/funktionen/GroupTile.tsx")).toMatch(/usePressable\(\{ scale: pressScale\.surface \}\)/);
    expect(read("src/views/berichte/ArchiveCard.tsx")).toMatch(/usePressable\(\{ scale: pressScale\.surface \}\)/);
    const nav = read("src/primitives/SectionNav.tsx");
    expect(nav).toMatch(/const CHIP_TAP = \{ scale: pressScale\.label \};/);
    expect(nav).toMatch(/<motion\.button\s+whileTap=\{CHIP_TAP\}\s+transition=\{spring\.press\}/);
    // the chips build up by moving the BUTTONS, never their `li` (the plate reads a chip's offsetLeft)
    expect(nav).toMatch(/stagedIn\(strip\.current\.querySelectorAll\("\[data-section-chip\]"\)/);
  });
});
