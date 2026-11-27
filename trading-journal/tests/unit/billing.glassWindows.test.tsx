/**
 * Runde 14 – the payment window, the login window and the purchase sheets as glass, SWITCHABLE: every glass rule lives under
 * `html[data-glass="on"]` (the setting „Glas“ / „Flach“ sets the attribute; without it and with „off“ the windows look as before).
 * What a unit test can hold on to are the RULES of the material (the look itself is in the evidence sheets):
 * - the flat part of each stylesheet never mentions the attribute, the glass part has no rule without it;
 * - the blur sits on bounded floating surfaces only (never on the dim, never on the full-screen phone window);
 * - every glass surface has its solid fallbacks (`data-safe-fx`, no `backdrop-filter`, less transparency, more contrast, forced colours);
 * - the success slip belongs to the server-confirmed state alone, nothing loops or celebrates;
 * - the layout fixes that come with the glass (rows of the form, „Heute fällig“, the phone status under the card).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "../../src");
const read = (p: string): string => readFileSync(join(SRC, p), "utf8");
const ON = 'html[data-glass="on"]';
const MARK = "GLAS (zuschaltbar";
const FILES = {
  "payWindow.css": read("billing/purchase/pay/payWindow.css"),
  "authWindow.css": read("cloud/ui/authWindow.css"),
  "purchase.css": read("billing/purchase/purchase.css"),
} as const;
/** [flat part, glass part] of a stylesheet (split at the comment that opens the glass layer). */
const split = (css: string): [string, string] => {
  const at = css.lastIndexOf("/*", css.indexOf(MARK));
  return [css.slice(0, at), css.slice(at)];
};
const pay = split(FILES["payWindow.css"])[1];
const auth = split(FILES["authWindow.css"])[1];
const purchase = split(FILES["purchase.css"])[1];

/** Every rule `selector { body }` of a stylesheet (flat: at-rules give their inner rules; comments removed). */
function rules(css: string): { selector: string; body: string }[] {
  const out: { selector: string; body: string }[] = [];
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean))) out.push({ selector: m[1]!.replace(/^[\s\S]*[{}]/, "").trim().replace(/\s+/g, " "), body: m[2]! });
  return out.filter((r) => !/^(from|to|\d+%)$/.test(r.selector));
}
const rule = (css: string, selector: string) => rules(css).find((r) => r.selector === selector);
/** Selectors that switch a blur ON (a `backdrop-filter` other than `none`). */
const blurred = (css: string): string[] => rules(css).filter((r) => /(^|[\s;])backdrop-filter:\s*(?!none|\s)/.test(r.body)).map((r) => r.selector);
const FALLBACK_MEDIA = "@media (prefers-reduced-transparency: reduce), (prefers-contrast: more), (forced-colors: active)";

describe("glass is a layer that can be switched off", () => {
  it.each(Object.entries(FILES))("%s: the flat part never asks for the attribute, every glass rule does (each selector of it)", (_name, css) => {
    const [flat, glass] = split(css);
    expect(css).toContain(MARK);
    expect(flat).not.toContain("data-glass");
    const all = rules(glass);
    expect(all.length).toBeGreaterThan(4);
    const loose = all.flatMap((r) => r.selector.split(/,\s*(?![^()]*\))/)).filter((s) => !s.trim().startsWith('html[data-glass="on"]'));
    expect(loose).toEqual([]);
  });

  it("the window's markup is the same in both looks: no glass class in it, the glass rows are a second variable beside the measured ones", () => {
    const tsx = read("billing/purchase/PayWindow.tsx");
    expect(tsx).toContain('className="pw-close"');
    expect(read("cloud/ui/AuthWindow.tsx")).toContain('className="aw-close"');
    expect(tsx).toMatch(/const ROWS = \{ title: 13\.3, sub: 18\.5, holderLabel: 23\.9, holder: 26\.9, numberLabel: 39\.2, number: 42\.4, pairLabel: 54\.7, pair: 57\.8 \}/);
    // the flat rule reads the measured row, the glass rule the closer one
    expect(rule(split(FILES["payWindow.css"])[0], ".pw-abs")!.body).toMatch(/top:\s*calc\(var\(--pw-top\) \* 1cqh/);
    expect(rule(pay, `${ON} .pw-abs`)!.body).toMatch(/top:\s*calc\(var\(--pw-top-g, var\(--pw-top\)\) \* 1cqh/);
  });
});

describe("glass: where the blur may sit", () => {
  it("payment window: the window body in landscape and the small close pill; the dim, the phone window and every inner part have none", () => {
    expect(blurred(pay)).toEqual([`${ON} .pw-win[data-orient="landscape"]`, `${ON} .pw-close`]);
    const off = rules(pay).filter((r) => /backdrop-filter:\s*none/.test(r.body)).map((r) => r.selector).join(" | ");
    expect(off).toContain(`${ON} .pw-win[data-orient="portrait"]`);
    expect(off).toContain('html[data-glass="on"][data-safe-fx] .pw-win');
    expect(off).toContain(`${ON} .pw-frame[data-orient="portrait"] .pw-close`);
    expect(rules(pay).some((r) => r.selector.includes(".pw-dim"))).toBe(false);
  });

  it("login window: the glass frame around the card and the close pill; the card and the band have none", () => {
    expect(blurred(auth)).toEqual([`${ON} .aw-frame::before`, `${ON} .aw-close`]);
    const off = rules(auth).filter((r) => /backdrop-filter:\s*none/.test(r.body)).map((r) => r.selector).join(" | ");
    expect(off).toContain('html[data-glass="on"][data-safe-fx] .aw-frame::before');
    // the Konto-Pflicht page has nothing behind the card to blur
    expect(off).toContain(`${ON} .aw-overlay[data-gate] .aw-frame::before`);
  });

  it("purchase sheets and plan cards: their two surfaces", () => {
    expect(blurred(purchase)).toEqual([`${ON} .pay-glass`, `${ON} .pay-sheet.pay-sheet`]);
  });
});

describe("glass: solid fallbacks (also if the app did not switch the attribute off)", () => {
  it.each([
    ["payWindow.css", pay],
    ["authWindow.css", auth],
    ["purchase.css", purchase],
  ])("%s answers no-backdrop-filter, data-safe-fx, less transparency, more contrast and forced colours", (_name, css) => {
    expect(css).toContain("@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)))");
    expect(css).toContain('html[data-glass="on"][data-safe-fx]');
    expect(css).toContain(FALLBACK_MEDIA);
    const block = css.slice(css.indexOf(FALLBACK_MEDIA));
    expect(block.slice(0, block.indexOf("\n}\n"))).toMatch(/backdrop-filter:\s*none/);
  });

  it("the payment window's glass is solid wherever it has no blur (`--gw-thin: 0%`)", () => {
    const solid = rules(pay).filter((r) => /--gw-thin:\s*0%/.test(r.body)).map((r) => r.selector).join(" | ");
    for (const s of ["[data-safe-fx] .pw-win", '.pw-win[data-orient="portrait"]', ".pw-win.pw-win"]) expect(solid).toContain(s);
  });
});

describe("the paid state and the motion stay quiet", () => {
  it("the success slip exists only in the server-confirmed state and only fades in", () => {
    const slip = rules(pay).filter((r) => r.selector.includes(".pw-status") && r.selector.includes("::before"));
    expect(slip.length).toBeGreaterThan(0);
    for (const r of slip) expect(r.selector).toContain('[data-state="confirmed"]');
    expect(slip[0]!.body).toContain("var(--color-win)");
    const frames = pay.slice(pay.indexOf("@keyframes pw-slip"));
    expect(frames.slice(0, frames.indexOf("\n}\n"))).toMatch(/from\s*\{\s*opacity:\s*0;\s*\}/);
  });

  it("no endless CSS animation, no confetti in the two windows", () => {
    for (const css of [FILES["payWindow.css"], FILES["authWindow.css"]]) {
      const code = css.replace(/\/\*[\s\S]*?\*\//g, "");
      expect(code).not.toMatch(/infinite/);
      expect(code.toLowerCase()).not.toMatch(/confetti|konfetti/);
    }
    // only the slip's fade is a CSS animation in the payment window (everything else is Web Animations from payMotion.ts)
    expect(FILES["payWindow.css"].match(/@keyframes\s+[\w-]+/g)).toEqual(["@keyframes pw-slip"]);
    expect(FILES["authWindow.css"]).not.toMatch(/@keyframes/);
  });
});

describe("layout fixes that come with the glass", () => {
  it("„Heute fällig“ sticks to the foot of the summary (it was below the fold with a trial or seats); static on the phone, where the window scrolls", () => {
    const total = rule(pay, `${ON} .pw-total`)!;
    expect(total.body).toMatch(/position:\s*sticky/);
    expect(total.body).toMatch(/bottom:\s*0/);
    // an opaque foot: the rows run under it
    expect(total.body).toMatch(/background:\s*var\(--color-ink-850\)/);
    expect(rule(pay, `${ON} .pw-win[data-orient="portrait"] .pw-total`)!.body).toMatch(/position:\s*static/);
  });

  it("the glass rows: label, box (7.2 %), room for the field's own message (≥ 2.3 %), next label – and the footer starts under the last box", () => {
    const tsx = read("billing/purchase/PayWindow.tsx");
    const m = /const ROWS_GLASS[^=]*= \{([^}]+)\}/.exec(tsx)!;
    const rows = Object.fromEntries(m[1]!.split(",").map((kv) => kv.split(":").map((x) => x.trim())).map(([k, v]) => [k, Number(v)])) as Record<string, number>;
    const BOX = 7.2;
    expect(rows.numberLabel! - (rows.holder! + BOX)).toBeGreaterThanOrEqual(2.3 - 1e-9);
    expect(rows.pairLabel! - (rows.number! + BOX)).toBeGreaterThanOrEqual(2.3 - 1e-9);
    for (const [label, box] of [["holderLabel", "holder"], ["numberLabel", "number"], ["pairLabel", "pair"]] as const) expect(rows[box]! - rows[label]!).toBeCloseTo(3, 5);
    const flowTop = Number(/top:\s*calc\(([\d.]+)cqh/.exec(rule(pay, `${ON} .pw-flow`)!.body)![1]);
    expect(flowTop - (rows.pair! + BOX)).toBeGreaterThanOrEqual(2.3 - 1e-9);
    expect(flowTop).toBeLessThanOrEqual(61);
  });

  it("the phone status sits under the lifted card, not at a fixed distance from the bottom (the tick lay on the card)", () => {
    const st = rule(pay, `${ON} .pw-win[data-orient="portrait"] .pw-status`)!;
    expect(st.body).toMatch(/top:\s*calc\(48\.8% \+/);
    expect(st.body).toMatch(/bottom:\s*auto/);
  });

  it("both close buttons are glass pills from the shell's tokens, drawn in the theme's ink", () => {
    for (const [css, sel] of [[pay, `${ON} .pw-close`], [auth, `${ON} .aw-close`]] as const) {
      const body = rule(css, sel)!.body;
      expect(body).toMatch(/color:\s*var\(--color-fg\)/);
      expect(body).toContain("var(--gl-tint)");
      expect(body).toContain("var(--gl-blur)");
    }
  });
});
