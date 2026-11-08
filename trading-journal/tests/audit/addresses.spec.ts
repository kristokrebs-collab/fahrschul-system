/**
 * Journey 5 (Launch-Audit, Paket D1): odd addresses. Unknown hash, broken share link, legal / contract deep links, query routes –
 * no redirect loop, no blank screen, no uncaught error. Recorder only (`$PW_AUDIT_OUT/addresses.json`), cloud build against the mocks.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "@playwright/test";
import { blockExternalNetwork } from "../e2e/cloudSignIn";
import { seed } from "../e2e/helpers";
import { mockBilling } from "../e2e/mocks/billing";
import { mockSupabase } from "../e2e/mocks/supabase";

const OUT = process.env.PW_AUDIT_OUT ?? "/tmp/audit-out";
const CLOUD = process.env.PW_AUDIT_CLOUD ?? "http://127.0.0.1:4411";

const CASES = [
  "/#unbekannt",
  "/#share/ungueltig-token",
  "/?rechtliches=gibtsnicht",
  "/?rechtliches=datenschutz",
  "/?kuendigen",
  "/?widerruf",
  "/#konto?returnTo=page:preise",
  "/#konto?returnTo=http://evil.example",
  "/#trades?result=win&side=long&q=%3Cscript%3E",
  "/#analyse?dim=session",
  "/#berichte?p=2026-W41",
  "/#community?invite=ABC123",
  "/gibtsnicht",
  "/dashboard.html",
  // the e-mail link of an expired confirmation: Supabase answers with the error in the query (PKCE) or – as its verify endpoint does – in the fragment
  "/?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired",
  "/#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired",
];

test("Journey 5: Randfälle der Adresse (Cloud-Build, Mock)", async ({ browser }) => {
  test.setTimeout(8 * 60_000);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark", locale: "de-DE", timezoneId: "Europe/Berlin", serviceWorkers: "block" });
  const page = await ctx.newPage();
  await blockExternalNetwork(page);
  await mockSupabase(page, {});
  await mockBilling(page, {});
  await seed(page, { empty: true });
  let navs = 0;
  page.on("framenavigated", (f) => {
    if (f === page.mainFrame()) navs++;
  });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
  const out: Array<{ address: string; result: "ok" | "lücke"; note: string }> = [];
  for (const c of CASES) {
    navs = 0;
    errors.length = 0;
    let note: string;
    let result: "ok" | "lücke" = "ok";
    try {
      await page.goto(`${CLOUD}${c}`, { waitUntil: "load" });
      await page.waitForTimeout(3500);
      const info = await page.evaluate(() => ({
        url: location.pathname + location.search + location.hash,
        h1: Array.from(document.querySelectorAll("h1"))
          .filter((h) => (h as HTMLElement).offsetWidth > 0)
          .map((h) => h.textContent?.trim())
          .join("|"),
        dialogs: Array.from(document.querySelectorAll('[role="dialog"]'))
          .filter((d) => d.getAttribute("aria-label") !== "Intro" && (d as HTMLElement).offsetWidth > 4)
          .map((d) => d.getAttribute("aria-label") ?? "")
          .join("|"),
        text: document.body.innerText.replace(/\s+/g, " ").slice(0, 140),
        toast: Array.from(document.querySelectorAll('[role="status"][aria-live="polite"], [role="alert"]'))
          .map((t) => (t.textContent ?? "").trim())
          .join(" | ")
          .slice(0, 160),
      }));
      const blank = !info.h1 && !info.dialogs && info.text.length < 20;
      if (blank || navs > 3 || errors.length) result = "lücke";
      note = `→ ${info.url}; h1 „${info.h1}“; Dialog „${info.dialogs}“; Navigationen ${navs}; Fehler ${errors.join(" / ") || "keine"}; Hinweis (Toast/Alert): „${info.toast}“; Text: ${info.text}`;
    } catch (e) {
      result = "lücke";
      note = `nicht ladbar: ${String((e as Error).message).split("\n")[0]}`;
    }
    out.push({ address: c, result, note });
  }
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "addresses.json"), JSON.stringify({ at: new Date().toISOString(), out }, null, 1));
  await ctx.close();
});
