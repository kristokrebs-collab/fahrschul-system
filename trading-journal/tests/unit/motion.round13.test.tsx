/**
 * Runde 13 (motion review, measured in the running app): entrances that build up one after another and exits that leave deliberately.
 * These tests pin the contracts; the frame-by-frame measurements are in `docs/ANIMATIONEN-MATRIX.md` („Runde 13“).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { tween } from "@/motion/tokens";

const read = (p: string) => readFileSync(p, "utf8");
const noComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

describe("tween.exitSurface", () => {
  it("is longer than the small exit, shorter than an entrance, and eases IN (accelerates out) – never linear", () => {
    expect(tween.exitSurface.duration).toBeGreaterThan(tween.exit.duration);
    expect(tween.exitSurface.duration).toBeLessThan(tween.fade.duration);
    expect(tween.exitSurface.duration).toBeLessThan(tween.page.duration);
    const [x1, y1, x2, y2] = tween.exitSurface.ease;
    expect(y1).toBe(0); // starts slowly …
    expect(x1).toBeGreaterThan(0);
    expect([x2, y2]).toEqual([1, 1]); // … and is at full speed when it is gone
  });
});

describe("payment window", () => {
  const tsx = read("src/billing/purchase/PayWindow.tsx");
  const css = noComments(read("src/billing/purchase/pay/payWindow.css"));

  it("leaves on tween.exitSurface BEFORE the order closes; reduced motion and missing WAAPI close at once", () => {
    const close = tsx.slice(tsx.indexOf("const close = () => {"), tsx.indexOf("useDialogBehaviour(dialogRef, open, close)"));
    expect(close).toMatch(/if \(reduced \|\| !el \|\| typeof el\.animate !== "function"\) \{\s*closeOrder\(\);\s*return;/);
    expect(close).toMatch(/tween\.exitSurface\.duration \* 1000/);
    expect(close).toMatch(/el\.animate\(\[\{ opacity: 1 \}, \{ opacity: 0 \}\], timing\)\.finished\.then\(done, done\)/);
    // a second Escape / click while it leaves does nothing
    expect(close).toMatch(/\|\| leaving\.current\) return;/);
    // an order in flight is still never closed
    expect(close).toMatch(/if \(inFlight \|\| form\.phase === "confirming"/);
  });

  it("arrives: dim and frame fade in, then head, card, summary and form rise 45 ms apart – opacity / transform, nothing left on the elements", () => {
    expect(css).toMatch(/\.pw-dim \{\s*animation: pw-in-fade 0\.2s ease-out backwards;/);
    expect(css).toMatch(/\.pw-frame \{\s*animation: pw-in-frame 0\.2s cubic-bezier\(0\.22, 1, 0\.36, 1\) backwards;/);
    const delay = (sel: string) => Number(new RegExp(`\\n\\.${sel} \\{\\s*animation-delay: (\\d+)ms;`).exec(css)?.[1]);
    const order = ["pw-head", "pw-cardbox", "pw-summary", "pw-form"].map(delay);
    expect(order).toEqual([70, 115, 160, 205]);
    for (const name of ["pw-in-fade", "pw-in-frame", "pw-in-rise"]) {
      const body = new RegExp(`@keyframes ${name} \\{([\\s\\S]*?)\\n\\}`).exec(css)?.[1] ?? "";
      expect(body, name).toMatch(/opacity: 0;/);
      expect(body.replace(/opacity|transform/g, ""), name).not.toMatch(/\b[a-z-]+\s*:\s*[^;]+;[\s\S]*\b(height|width|top|left|filter)\b/);
    }
    // `backwards` only: after the run the stage (card lift, flip) finds its elements untouched
    expect(css).not.toMatch(/animation: pw-in-[a-z]+ [^;]*\b(forwards|both)\b/);
  });
});

describe("setups, search", () => {
  it("the setup cards cascade in on page entry (no `initial={false}` on their presence), the „Neue“ tile closes the cascade", () => {
    const src = read("src/views/setups/SetupsView.tsx");
    expect(src).toMatch(/<AnimatePresence mode="popLayout">/);
    expect(src).not.toMatch(/<AnimatePresence mode="popLayout" initial=\{false\}>/);
    expect(src).toMatch(/opacity: \{ \.\.\.tween\.fade, delay: reduced \? 0 : Math\.min\(ranked\.length, stagger\.max\) \* stagger\.cards \}/);
  });

  it("the global search leaves as a surface (lifts away on tween.exitSurface); reduced motion: at once", () => {
    const src = read("src/search/GlobalSearch.tsx");
    expect(src).toMatch(/exit=\{reduced \? \{ opacity: 0, transition: \{ duration: 0 \} \} : \{ opacity: 0, y: -8, scale: 0\.985, transition: tween\.exitSurface \}\}/);
  });
});
