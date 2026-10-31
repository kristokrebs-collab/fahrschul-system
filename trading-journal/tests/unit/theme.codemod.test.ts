import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TOKEN_OF_HEX, transform } from "../../scripts/codemod-veil.mjs";

const css = readFileSync("src/styles/tokens.css", "utf8") + readFileSync("src/styles/themes.css", "utf8");

/** The FIRST declaration of a custom property (tokens.css @theme / :root, themes.css :root) = its dark value. */
function darkValue(prop: string): string | undefined {
  const m = new RegExp(`${prop.replace(/[-]/g, "\\-")}:\\s*([^;]+);`).exec(css);
  return m?.[1]?.trim().toLowerCase();
}

describe("codemod-veil", () => {
  it("maps every hex onto a token whose dark value is exactly that hex (dark stays byte-identical)", () => {
    for (const [hex, token] of Object.entries(TOKEN_OF_HEX)) {
      const v = darkValue(token);
      expect(v, `${token} for ${hex}`).toBeDefined();
      const norm = (h: string) => (h.length === 4 ? `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}` : h).toLowerCase();
      expect(norm(v!), `${token}`).toBe(norm(hex));
    }
  });

  it("rewrites arbitrary hex classes (with variants and opacity), leaves unknown ones for the report", () => {
    const src = `const a = "text-[#ff8a90] hover:bg-[#2c2c2c]/50 from-[#65b488] bg-[#7d7d7d] text-[#FF8A90]";`;
    const r = transform(src);
    expect(r.text).toBe(`const a = "text-(--color-danger-text) hover:bg-(--color-line-2)/50 from-(--color-win-soft) bg-[#7d7d7d] text-(--color-danger-text)";`);
    expect(r.changes).toHaveLength(4);
    expect(r.left).toEqual([{ kind: "class", text: "bg-[#7d7d7d]" }]);
  });

  it("reports string literals and rgb classes, counts the veils, never touches them", () => {
    const src = `<path stroke="#f2f2f2" className="bg-white/[0.06] border-white/40 shadow-[0_0_0_3px_rgb(255_255_255/0.07)]" />`;
    const r = transform(src);
    expect(r.text).toBe(src);
    expect(r.left.map((l) => l.kind).sort()).toEqual(["rgb-class", "string"]);
    expect(r.veils).toBe(2);
  });

  it("does not report rgb classes whose channels or alpha already come from a theme token", () => {
    const src = `const a = "shadow-[0_0_0_3px_rgb(var(--veil-rgb,255_255_255)/0.07)] shadow-[0_18px_40px_rgb(0_0_0/calc(0.45*var(--shade,1)))] shadow-[0_0_8px_rgb(255_77_79/0.55)]";`;
    const r = transform(src);
    expect(r.text).toBe(src);
    expect(r.left).toEqual([{ kind: "rgb-class", text: "shadow-[0_0_8px_rgb(255_77_79/0.55)]" }]);
  });
});
