/**
 * Accessible names (Launch-Audit D1): every visible control of every page must have one (WCAG 4.1.2). The crawl's own label
 * reader is only good enough to NAME a row of the CSV; this spec asks the same question with the full rule set (aria-label,
 * aria-labelledby, text, `<label>`, title, placeholder, alt of an image inside, value of a button) on a fresh page per route and writes
 * what is left to `$PW_AUDIT_OUT/names.json` – `scripts/audit/buildAuditCsv.mjs` turns every entry into a P2 row.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "@playwright/test";
import { seed } from "../e2e/helpers";
import { blockExternalNetwork } from "../e2e/cloudSignIn";

const OUT = process.env.PW_AUDIT_OUT ?? "/tmp/audit-out";
const LOCAL = process.env.PW_AUDIT_LOCAL ?? "http://127.0.0.1:4410";
const PAGES = ["overview", "trades", "plan", "setups", "markt", "aktien", "risiko", "analyse", "berichte", "coach", "wachstum", "cockpit", "labor", "studio", "settings", "konto", "community", "preise", "funktionen"];

interface Unnamed {
  route: string;
  viewport: number;
  tag: string;
  role: string;
  where: string;
  html: string;
}

test("Namen aller Bedienelemente (lokaler Build, Fixture-Journal)", async ({ browser }) => {
  test.setTimeout(30 * 60_000);
  const found: Unnamed[] = [];
  let checked = 0;
  for (const w of [390, 1440]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: w === 390 ? 844 : 900 }, isMobile: w === 390, hasTouch: w === 390, colorScheme: "dark", locale: "de-DE", timezoneId: "Europe/Berlin", serviceWorkers: "block" });
    const page = await ctx.newPage();
    await blockExternalNetwork(page);
    await seed(page);
    for (const route of PAGES) {
      await page.goto(`${LOCAL}/#${route}`, { waitUntil: "load" });
      await page.waitForTimeout(2500);
      await page.evaluate(async () => {
        for (let y = 0; y < Math.min(document.documentElement.scrollHeight, 8000); y += 700) {
          window.scrollTo({ top: y, behavior: "instant" });
          await new Promise((r) => setTimeout(r, 70));
        }
        window.scrollTo({ top: 0, behavior: "instant" });
      });
      await page.waitForTimeout(400);
      const res = await page.evaluate(() => {
        const out: Array<{ tag: string; role: string; where: string; html: string }> = [];
        let n = 0;
        for (const el of Array.from(document.querySelectorAll('button, [role="button"], [role="switch"], [role="radio"], [role="checkbox"], [role="tab"], [role="menuitem"], input:not([type="hidden"]), select, textarea, a[href], summary'))) {
          const r = el.getBoundingClientRect();
          if (r.width < 2 || r.height < 2) continue;
          if (el.closest('[inert], [aria-hidden="true"]')) continue;
          const cs = getComputedStyle(el);
          if (cs.visibility === "hidden" || cs.display === "none") continue;
          n++;
          const aria = el.getAttribute("aria-label");
          const by = el.getAttribute("aria-labelledby");
          const byText = by
            ? by
                .split(/\s+/)
                .map((id) => document.getElementById(id)?.textContent ?? "")
                .join(" ")
                .trim()
            : "";
          const text = ((el as HTMLElement).innerText || el.textContent || "").trim();
          const labelled = (el as HTMLInputElement).labels ? Array.from((el as HTMLInputElement).labels ?? []).map((l) => (l.textContent ?? "").trim()).join(" ") : "";
          const img = el.querySelector("img[alt], svg title")?.getAttribute("alt") ?? el.querySelector("svg title")?.textContent ?? "";
          const name = aria || byText || text || labelled || el.getAttribute("title") || el.getAttribute("placeholder") || img || ((el as HTMLInputElement).type === "submit" || (el as HTMLInputElement).type === "button" ? (el as HTMLInputElement).value : "");
          if (!name)
            out.push({
              tag: el.tagName.toLowerCase(),
              role: el.getAttribute("role") ?? "",
              where: el.closest("header") ? "header" : el.closest("aside") ? "sidebar" : el.closest("footer") ? "footer" : el.closest("main") ? "main" : "shell",
              html: el.outerHTML.replace(/\s+/g, " ").slice(0, 160),
            });
        }
        return { out, n };
      });
      checked += res.n;
      for (const u of res.out) found.push({ route: `#${route}`, viewport: w, ...u });
    }
    await ctx.close();
  }
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "names.json"), JSON.stringify({ at: new Date().toISOString(), base: LOCAL, checked, unnamed: found }, null, 1));
});
