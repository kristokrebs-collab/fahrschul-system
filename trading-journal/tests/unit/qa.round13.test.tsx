/**
 * Funktionsprüfung Runde 13: the confirmed findings of the browser passes (desktop, phone, account / purchase) that are fixed in
 * markup or CSS. Each was reproduced twice in the running app before the fix and re-run against the fixed build afterwards
 * (`docs/audit/STATUS.md`, Nachtrag Runde 13); these checks keep the fixes in place.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(p, "utf8");
const noComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

describe("light mode", () => {
  it("the ink islands (intro, full-screen navigation, overview hero, dark scope) keep the DARK glass – the selected account tab of the Übersicht was light text on a white plate", () => {
    const css = noComments(read("src/styles/shell-motion.css"));
    const dark = /:root,\s*:root\[data-theme="light"\] :is\(\[data-intro-stage\], \[data-layer="Navigation \(Vollbild\)"\], :has\(> \[data-hero-backdrop\]\), \[data-theme-scope="dark"\]\) \{([^}]*)\}/.exec(css)?.[1] ?? "";
    for (const v of ["--gl-ink: 255 255 255", "--gl-face: linear-gradient(rgb(255 255 255 / 0.06)", "--gl-on:", "--gl-rim:", "--gl-in:", "--gl-tint:"]) expect(dark, v).toContain(v);
    // the same island selector as the ink tokens of themes.css
    expect(read("src/styles/themes.css")).toContain(':root[data-theme="light"] :has(> [data-hero-backdrop])');
  });
});

describe("phone layout", () => {
  it("„Trade bearbeiten“: Abbrechen and Speichern take the small phone metrics in both modes, so the footer stays one row", () => {
    const src = read("src/overlays/TradeEditor.tsx");
    expect(src).toMatch(/<Button ref=\{discardTrigger\} className=\{cn\("pointer-coarse:min-h-11", FOOT_SM\)\}/);
    expect(src).toMatch(/className=\{cn\("min-w-\[110px\] pointer-coarse:min-h-11", FOOT_SM, "max-sm:min-w-0"\)\}/);
  });

  it("Konto › Rechnungen: number and date keep their room, the date is a truncating block of its own", () => {
    const src = read("src/billing/ui/BillingCard.tsx");
    expect(src).toMatch(/<span className="min-w-\[110px\] flex-1">\s*<span className="block truncate font-mono text-fg">/);
    expect(src).toMatch(/<span className="block truncate text-\[12px\] text-faint">\{formatDay\(inv\.created\)\}<\/span>/);
  });

  it("numbers are never cut: the comparison of the reports and the coach's „Heute“ tiles wrap instead of truncating", () => {
    const cmp = read("src/views/berichte/sections.tsx");
    expect(cmp).toMatch(/<span role="cell" className="num text-right font-mono text-fg">\s*\{r\.a\}/);
    expect(cmp).toMatch(/<span role="cell" className="num text-right font-mono text-mute">\s*\{r\.b\}/);
    expect(read("src/views/coach/TodayCard.tsx")).toMatch(/<dd className=\{cn\("num font-mono text-\[14px\]", c\)\}>/);
  });

  it("Wachstum: the streak row wraps (the flame lay on the neighbouring tile at 360 px), the diary axis leaves room for its last label", () => {
    expect(read("src/views/wachstum/StreakBadge.tsx")).toMatch(/<div className="flex flex-wrap items-baseline gap-1\.5">/);
    expect(read("src/views/wachstum/DiaryCard.tsx")).toMatch(/const axis = total \+ \(wide \? 1\.5 : 2\.6\);/);
  });

  it("„Tarif im Detail“ names no file path of the repository", () => {
    const honest = /\n\s*honest: "([^"]*)"/.exec(read("src/billing/purchase/strings.ts"))?.[1] ?? "";
    expect(honest).toMatch(/Tarifvertrag der App/);
    expect(honest).not.toMatch(/docs\/|\.md\b/);
  });
});

describe("login window: errors where they belong", () => {
  const sheet = read("src/cloud/ui/AuthSheet.tsx");

  it("a wrong 2FA code puts the focus back into the code field", () => {
    const form = sheet.slice(sheet.indexOf("function MfaCodeForm"), sheet.indexOf("function MfaCodeForm") + 1400);
    expect(form).toMatch(/setCode\(""\);[\s\S]*requestAnimationFrame\(\(\) => slots\.current\?\.querySelector<HTMLInputElement>\("input:not\(\[disabled\]\)"\)\?\.focus\(\)\);/);
    expect(sheet).toMatch(/<div data-aw-row="" ref=\{slots\}>\s*<CodeSlots/);
  });

  it("registration: the password error takes the strength row's place instead of lying over it; a missing consent focuses the checkbox, which reads the message", () => {
    expect(sheet).toMatch(/\{err\?\.field !== "password" && <StrengthHint password=\{password\} top=\{B_ROWS\.hint\} \/>\}/);
    expect(sheet).toMatch(/requestAnimationFrame\(\(\) => document\.getElementById\(consentId\)\?\.focus\(\)\);/);
    expect(sheet).toMatch(/describedBy=\{consentMissing \? consentMsgId : undefined\}/);
    expect(sheet).toMatch(/<p role="alert" id=\{consentMsgId\} className="aw-msg aw-abs"/);
    expect(read("src/cloud/ui/AuthFields.tsx")).toMatch(/aria-describedby=\{invalid && !checked \? describedBy : undefined\}/);
  });

  it("a step's field with an error reserves room for its message (it lay half under the button in the new-password step)", () => {
    const css = noComments(read("src/cloud/ui/authWindow.css"));
    expect(css).toMatch(/\.aw-step \.aw-field\[data-invalid\] \{\s*margin-bottom: max\(18px, 3cqh\);\s*\}/);
  });
});
