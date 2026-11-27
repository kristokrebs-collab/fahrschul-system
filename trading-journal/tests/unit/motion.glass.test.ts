/**
 * Runde 14 – the glass switch (`@/motion/glass`): the stored choice, its default and tolerance, the effective state under the system
 * conditions, the attribute contract `html[data-glass]`, the mirror for the boot, and the shared pane family in shell-motion.css
 * (every glass rule under `html[data-glass="on"]`, the flat classes untouched in the markup).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeSettings } from "@/domain/normalize";
import { GLASS_ATTR, GLASS_BLOCK_QUERIES, GLASS_KEY, applyGlass, bootGlass, effectiveGlass, glassBlocked, glassOfSettings, isGlass, onGlassChange, parseGlass, readGlassPref, withGlass } from "@/motion/glass";
import { SAFE_FX_ATTR } from "@/motion/safeFx";

const css = readFileSync(resolve(process.cwd(), "src/styles/shell-motion.css"), "utf8");
const src = (p: string) => readFileSync(resolve(process.cwd(), "src", p), "utf8");

afterEach(() => {
  document.documentElement.removeAttribute(SAFE_FX_ATTR);
  document.documentElement.removeAttribute(GLASS_ATTR);
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("Glas-Schalter: Wahl und Vorgabe", () => {
  it("only an explicit „off“ switches the glass off – absent, damaged and unknown values read as „on“", () => {
    expect(parseGlass("off")).toBe("off");
    for (const v of ["on", undefined, null, "", "OFF", 0, false, {}, "flat"]) expect(parseGlass(v)).toBe("on");
  });

  it("settings without the key (data from before the switch) mean „on“; the key survives normalising, so sync, backup and import carry it", () => {
    expect(glassOfSettings(normalizeSettings(null))).toBe("on");
    expect(glassOfSettings(normalizeSettings({ glass: "off" }))).toBe("off");
    expect(normalizeSettings({ glass: "off", currency: "EUR" }).glass).toBe("off");
    expect(glassOfSettings(normalizeSettings({ glass: "kaputt" }))).toBe("on");
    const s = normalizeSettings(null);
    const off = withGlass(s, "off");
    expect(off.glass).toBe("off");
    expect(off.setups).toBe(s.setups);
    expect(s.glass).toBeUndefined();
    expect(withGlass(off, "on").glass).toBe("on");
  });

  it("blocked wins over the choice", () => {
    expect(effectiveGlass("on", false)).toBe("on");
    expect(effectiveGlass("on", true)).toBe("off");
    expect(effectiveGlass("off", false)).toBe("off");
    expect(effectiveGlass("off", true)).toBe("off");
  });
});

describe("Glas-Schalter: Attribut und Rückfälle", () => {
  it("writes html[data-glass], mirrors the choice for the next boot and tells listeners only on a change", () => {
    const seen = vi.fn();
    const stop = onGlassChange(seen);
    expect(applyGlass("on")).toBe("on");
    expect(document.documentElement.getAttribute(GLASS_ATTR)).toBe("on");
    expect(isGlass()).toBe(true);
    expect(localStorage.getItem(GLASS_KEY)).toBe("on");
    expect(applyGlass("off")).toBe("off");
    expect(isGlass()).toBe(false);
    expect(readGlassPref()).toBe("off");
    applyGlass("off");
    expect(seen).toHaveBeenCalledTimes(2);
    stop();
  });

  it("boot reads the mirrored choice (default „on“) without rewriting it", () => {
    expect(bootGlass()).toBe("on");
    expect(localStorage.getItem(GLASS_KEY)).toBeNull();
    localStorage.setItem(GLASS_KEY, "off");
    expect(bootGlass()).toBe("off");
    expect(document.documentElement.getAttribute(GLASS_ATTR)).toBe("off");
  });

  it("the safe effects (Samsung Internet) switch it off without touching the choice – and back on when they go", () => {
    applyGlass("on");
    document.documentElement.setAttribute(SAFE_FX_ATTR, "");
    expect(glassBlocked()).toBe(true);
    expect(applyGlass(undefined, false)).toBe("off");
    expect(readGlassPref()).toBe("on");
    document.documentElement.removeAttribute(SAFE_FX_ATTR);
    expect(applyGlass(undefined, false)).toBe("on");
  });

  it.each(GLASS_BLOCK_QUERIES)("%s switches it off", (query) => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q === query, addEventListener: () => {}, removeEventListener: () => {} }));
    expect(glassBlocked()).toBe(true);
    expect(applyGlass("on")).toBe("off");
    expect(readGlassPref()).toBe("on");
  });

  it("a browser without backdrop-filter gets the flat look", () => {
    vi.stubGlobal("CSS", { supports: () => false });
    expect(glassBlocked()).toBe(true);
    vi.stubGlobal("CSS", { supports: (p: string) => p === "-webkit-backdrop-filter" });
    expect(glassBlocked()).toBe(false);
  });
});

describe("Glas-Fenster: ein Baustein, nur unter html[data-glass=on]", () => {
  it("every rule of the pane family is written under the switch", () => {
    for (const cls of [".glass-panel", ".glass-bar", ".glass-chip"]) {
      const uses = css.match(new RegExp(`^[^\\n{}/]*\\${cls}\\b[^\\n{}]*\\{`, "gm")) ?? [];
      expect(uses.length, cls).toBeGreaterThan(0);
      for (const sel of uses) expect(sel, sel).toContain('html[data-glass="on"]');
    }
    // a backdrop filter of the family never stands outside the switch
    expect(css).not.toMatch(/^\.glass-(panel|bar)/m);
  });

  it("the pane is milk glass: blur 18–28 px with saturation, a tint that keeps text readable, the lens only on the small variant", () => {
    const blur = /--gp-blur: blur\((\d+)px\) saturate\(([\d.]+)\);/.exec(css);
    expect(Number(blur?.[1])).toBeGreaterThanOrEqual(18);
    expect(Number(blur?.[1])).toBeLessThanOrEqual(28);
    expect(Number(blur?.[2])).toBeGreaterThanOrEqual(1.4);
    expect(css).toMatch(/html\[data-glass="on"\]\[data-lg\] \[data-gp="sm"\] \{\s*--gp-blur: url\(#lgd\)/);
    const tints = [...css.matchAll(/--gp-tint: rgb\([\d ]+ \/ ([\d.]+)\);/g)].map((m) => Number(m[1]));
    expect(tints.length).toBeGreaterThanOrEqual(3);
    for (const a of tints) expect(a).toBeGreaterThanOrEqual(0.78);
  });

  it("„off“ takes the glass of Runde 13 back: no lens, no bead, an opaque message", () => {
    expect(css).toMatch(/html\[data-glass="off"\] :is\(\.lg, \.gl-float\) \{[^}]*backdrop-filter: none/);
    expect(css).toMatch(/html\[data-glass="off"\] \.gl-bead \{\s*background-image: none/);
    expect(css).toMatch(/html\[data-glass="off"\] \{\s*--gl-rim: linear-gradient\(rgb\(255 255 255 \/ 0\.2\)/);
  });

  it("every unfolding window uses the one pane and keeps its flat classes", () => {
    const panes: [string, RegExp][] = [
      ["motion/Sheet.tsx", /"glass-panel [^"]*border border-line-2 bg-ink-850/],
      ["motion/MorphDialog.tsx", /className="glass-panel [^"]*from-ink-750 to-ink-800/],
      ["overlays/TradeDetail.tsx", /glass-panel [^"]*from-ink-750 to-ink-850/],
      ["search/GlobalSearch.tsx", /className="glass-panel [^"]*bg-ink-850/],
      ["app/CommandNav.tsx", /className="glass-panel fixed inset-0 [^"]*bg-black/],
      ["app/CommandNav.tsx", /className="glass-panel relative size-full [^"]*bg-black/],
      ["motion/pulse/MorphSelect.tsx", /data-gp="sm"\s+className="glass-panel fixed [^"]*bg-ink-850/],
      ["motion/pulse/Autocomplete.tsx", /data-gp="sm"\s+className=\{cn\("glass-panel fixed [^"]*bg-ink-850/],
      ["primitives/SearchField.tsx", /"sf-panel glass-panel"/],
      ["ui/alert-dialog.tsx", /glass-panel [^"]*bg-background/],
      ["ui/popover.tsx", /glass-panel [^"]*bg-popover/],
      ["ui/select.tsx", /glass-panel [^"]*bg-popover/],
      ["ui/dropdown-menu.tsx", /glass-panel [^"]*bg-popover/],
    ];
    for (const [file, re] of panes) expect(src(file), file).toMatch(re);
  });
});
