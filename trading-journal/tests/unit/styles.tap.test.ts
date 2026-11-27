/**
 * The 44 px tap size has ONE source: `--spacing-tap` (tokens.css, `@theme static`). `touch-hit*` and `.tap*` (base.css) read it;
 * no second literal `44px` may creep back into the tap rules, and Tailwind gets `min-h-tap` / `size-tap` from the same token.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = (f: string) => readFileSync(join(__dirname, "../../src/styles", f), "utf8");

describe("tap size token", () => {
  it("is defined once, statically, as 44 px", () => {
    const tokens = css("tokens.css");
    expect(tokens).toMatch(/@theme static\s*\{\s*--spacing-tap:\s*44px;\s*\}/);
    expect(tokens.match(/--spacing-tap:/g)).toHaveLength(1);
  });

  it("every tap rule in base.css reads the token, none repeats the number", () => {
    const base = css("base.css");
    expect(base).not.toMatch(/\b44px\b/);
    const uses = base.match(/var\(--spacing-tap\)/g) ?? [];
    // touch-hit (2), touch-hit-links (2), touch-hit-y (1), tap (2), tap-y (1)
    expect(uses.length).toBeGreaterThanOrEqual(8);
    expect(base).toMatch(/\.tap\s*\{[^}]*min-height:\s*var\(--spacing-tap\)[^}]*min-width:\s*var\(--spacing-tap\)/);
  });
});
