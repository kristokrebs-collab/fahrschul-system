/**
 * Journey probes (Launch-Audit, Paket D1, order section 2): what a FIRST VISITOR really meets, step by step, in the cloud build
 * against the Supabase / billing mocks – not a pass/fail suite but a recorder. Every step writes one observation
 * (`ok` / `lücke` + what was seen) to `$PW_AUDIT_OUT/journeys.json`; STATUS.md quotes it.
 *
 * Journey 1: not signed in → pricing page → „Premium“ / yearly → registration → e-mail confirmation → back to the ORDER.
 * Journey 2: „Kostenlos starten“ → registration → first sign-in → first-run state (onboarding / demo-or-own-data question).
 * Journey 3: forgot password, existing account, wrong password. Journey 4: legal links and what covers them on a phone.
 * Everything mocked is marked as such: the real mail delivery, the real confirmation link and the real Supabase limits are BLOCKED.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, type Browser, type Page } from "@playwright/test";
import { blockExternalNetwork, expectNotInert } from "../e2e/cloudSignIn";
import { seed } from "../e2e/helpers";
import { mockBilling } from "../e2e/mocks/billing";
import { mockSupabase } from "../e2e/mocks/supabase";

const OUT = process.env.PW_AUDIT_OUT ?? "/tmp/audit-out";
const CLOUD = process.env.PW_AUDIT_CLOUD ?? "http://127.0.0.1:4411";
const LOCAL = process.env.PW_AUDIT_LOCAL ?? "http://127.0.0.1:4410";
const PREVIEW = process.env.PW_AUDIT_PREVIEW ?? "https://deploy-preview-6--xxhuxabbyubzv.netlify.app";

interface Obs {
  journey: string;
  step: string;
  viewport: number;
  result: "ok" | "lücke" | "info";
  note: string;
  shot?: string;
}
const observations: Obs[] = [];

function flush(): void {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "journeys.json"), JSON.stringify({ at: new Date().toISOString(), observations }, null, 1));
}

async function context(browser: Browser, w: number) {
  const mobile = w <= 430;
  const ctx = await browser.newContext({ viewport: { width: w, height: mobile ? 844 : 900 }, isMobile: mobile, hasTouch: mobile, colorScheme: "dark", locale: "de-DE", timezoneId: "Europe/Berlin", serviceWorkers: "block" });
  return ctx;
}

function recorder(journey: string, w: number, page: () => Page) {
  const shotDir = join(OUT, "shots", "journeys");
  mkdirSync(shotDir, { recursive: true });
  return async (step: string, fn: () => Promise<{ result: Obs["result"]; note: string } | void>, shot?: string): Promise<void> => {
    let res: { result: Obs["result"]; note: string } | void;
    try {
      res = await fn();
    } catch (e) {
      res = { result: "lücke", note: `Schritt nicht ausführbar: ${String((e as Error).message ?? e).split("\n")[0]?.slice(0, 220)}` };
    }
    let file: string | undefined;
    if (shot) {
      file = `${journey}-${w}-${shot}.jpg`;
      await page().screenshot({ path: join(shotDir, file), type: "jpeg", quality: 55, animations: "disabled" }).catch(() => undefined);
    }
    observations.push({ journey, step, viewport: w, result: res ? res.result : "ok", note: res ? res.note : "", shot: file });
    flush();
  };
}

const sheetOf = (page: Page) => page.getByRole("dialog").last();

async function dialogsText(page: Page): Promise<string> {
  return page
    .evaluate(() =>
      Array.from(document.querySelectorAll('[role="dialog"]'))
        .filter((d) => d.getAttribute("aria-label") !== "Intro" && (d as HTMLElement).getBoundingClientRect().width > 4)
        .map((d) => `[${d.getAttribute("aria-label") ?? ""}] ${((d as HTMLElement).innerText ?? "").replace(/\s+/g, " ").slice(0, 360)}`)
        .join(" || "),
    )
    .catch(() => "");
}

for (const w of [1440, 390]) {
  test(`Journey 1+2+3: Erstbesucher gegen den Cloud-Build @${w}`, async ({ browser }) => {
    test.setTimeout(20 * 60_000);
    const ctx = await context(browser, w);
    const page = await ctx.newPage();
    const step = recorder("J1", w, () => page);
    await blockExternalNetwork(page);
    const sb = await mockSupabase(page, { signupConfirm: true });
    await mockBilling(page, {});
    await seed(page, { empty: true, firstRun: true });
    const base = CLOUD;

    await step(
      "Landing: was sieht der Erstbesucher auf /?",
      async () => {
        await page.goto(`${base}/`, { waitUntil: "load" });
        await page.waitForTimeout(4500);
        const info = await page.evaluate(() => ({
          h1: Array.from(document.querySelectorAll("h1")).filter((h) => (h as HTMLElement).offsetWidth > 0).map((h) => h.textContent),
          pill: !!document.querySelector('[data-cloud-pill="signin"]'),
          pillText: (document.querySelector('[data-cloud-pill="signin"]') as HTMLElement | null)?.innerText ?? "",
          badge: document.querySelector('[data-testid="local-badge"]')?.textContent ?? "",
          emptyState: document.body.innerText.match(/Dein Journal ist noch leer[^\n]*/)?.[0] ?? "",
          marketing: /Kostenlos starten|Premium auswählen|Preise/.test(document.body.innerText),
        }));
        return {
          result: "info",
          note: `Der erste Bildschirm ist die App selbst (Übersicht, h1 ${JSON.stringify(info.h1)}), keine Landing-Seite. Anmelden-Pill: ${info.pill ? `ja („${info.pillText.replace(/\s+/g, " ").trim()}“)` : "nein"}. Leerzustand: „${info.emptyState}“. Werbetext/CTA „Kostenlos starten“ oder „Premium auswählen“ auf der Startseite: ${info.marketing ? "ja" : "nein"} (nur über Seitenleiste „Preise“).`,
        };
      },
      "01-erster-bildschirm",
    );

    await step(
      "Preise erreichbar: Seitenleiste / Menü",
      async () => {
        await page.evaluate(() => {
          window.location.hash = "preise";
        });
        await page.locator("main h1:visible", { hasText: "Preise" }).first().waitFor({ state: "visible", timeout: 20_000 });
        await page.waitForTimeout(2500);
        const labels = await page.evaluate(() => Array.from(document.querySelectorAll('[data-testid^="cta-"], [data-testid="hero-cta"], [data-testid^="note-"], [data-testid^="details-"]')).map((e) => `${e.getAttribute("data-testid")}=„${(e as HTMLElement).innerText.trim()}“`));
        return { result: "info", note: `CTA-Beschriftungen der Karten (abgemeldet): ${labels.join("; ")}` };
      },
      "02-preise",
    );

    await step("Preise: Monat↔Jahr, Jahres-Betrag sichtbar", async () => {
      await page.getByRole("radio", { name: /Jährlich/ }).first().click();
      await page.waitForTimeout(1200);
      const t = await page.getByTestId("price-premium").innerText();
      const team = await page.getByTestId("price-team").innerText();
      const okYear = /240/.test(t.replace(/\s+/g, " "));
      return { result: okYear ? "ok" : "lücke", note: `Premium/Jahr: „${t.replace(/\s+/g, " ")}“ · Team/Jahr: „${team.replace(/\s+/g, " ").slice(0, 160)}“` };
    });

    await step(
      "Premium/Jahr wählen → Registrierung: wird die Wahl gezeigt und gemerkt?",
      async () => {
        await page.getByTestId("cta-premium").click();
        await page.waitForTimeout(1600);
        const text = await dialogsText(page);
        const ret = await page.evaluate(() => sessionStorage.getItem("tj2-return-to"));
        const mentionsChoice = /Premium/.test(text) && /(Jahr|jährlich|240)/i.test(text);
        return {
          result: mentionsChoice ? "ok" : "lücke",
          note: `Dialog: ${text.slice(0, 300)}. Gemerkt in sessionStorage: ${ret ?? "nichts"}. Die Registrierung nennt die gewählte Bestellung: ${mentionsChoice ? "ja" : "NEIN (kein Hinweis auf Tarif/Intervall im Registrierformular)"}.`,
        };
      },
      "03-registrierung-nach-premium",
    );

    await step("Registrierung: Pflichtfelder, Passwort anzeigen, Stärke, Fehler am Feld", async () => {
      const sheet = sheetOf(page);
      await expectNotInert(sheet.getByLabel("E-Mail"), 25_000);
      const show = await sheet.getByRole("button", { name: /Passwort anzeigen/ }).count();
      await sheet.getByLabel("E-Mail").fill("keine-mail");
      await sheet.getByLabel("Passwort", { exact: true }).fill("abc");
      await sheet.getByRole("button", { name: "Konto erstellen", exact: true }).click();
      await page.waitForTimeout(900);
      const t = await dialogsText(page);
      const kept = await sheet.getByLabel("E-Mail").inputValue();
      return { result: show > 0 && kept === "keine-mail" ? "ok" : "lücke", note: `Passwort-Sichtbarkeit: ${show ? "Schalter vorhanden" : "fehlt"}. Eingabe bleibt nach Fehler: ${kept === "keine-mail" ? "ja" : "nein"}. Rückmeldung: ${t.slice(0, 260)}` };
    });

    await step(
      "Registrierung abschicken (E-Mail-Bestätigung nötig, Mock)",
      async () => {
        const sheet = sheetOf(page);
        await sheet.getByLabel("E-Mail").fill("neu@example.com");
        await sheet.getByLabel("Passwort", { exact: true }).fill("richtig-geheim-42");
        const repeat = sheet.getByLabel("Passwort wiederholen");
        if (await repeat.count()) await repeat.fill("richtig-geheim-42");
        const boxes = sheet.getByRole("checkbox");
        for (let i = 0; i < (await boxes.count()); i++) await boxes.nth(i).check().catch(() => undefined);
        await sheet.getByRole("button", { name: "Konto erstellen", exact: true }).click();
        await page.waitForTimeout(2200);
        const t = await dialogsText(page);
        const resend = await sheet.getByRole("button", { name: /Erneut senden/ }).first().innerText().catch(() => "");
        const created = sb.users.some((u) => u.email === "neu@example.com");
        return { result: created && /Postfach|Bestätige/.test(t) ? "ok" : "lücke", note: `Konto im Mock angelegt: ${created}. Zustand: ${t.slice(0, 280)}. Erneut-senden-Knopf: „${resend}“ (Zähler zählt herunter; echtes Rate-Limit nur serverseitig = BLOCKED).` };
      },
      "04-bestaetigung-gesendet",
    );

    await step("Bestätigungslink in NEUEM Tab öffnen: bleibt die Tarifwahl erhalten?", async () => {
      const before = await page.evaluate(() => sessionStorage.getItem("tj2-return-to"));
      const p2 = await ctx.newPage();
      await blockExternalNetwork(p2);
      await mockSupabase(p2, { signupConfirm: true });
      await mockBilling(p2, {});
      await p2.goto(`${base}/`, { waitUntil: "load" });
      await p2.waitForTimeout(2500);
      const after = await p2.evaluate(() => ({ session: sessionStorage.getItem("tj2-return-to"), local: Object.keys(localStorage).filter((k) => /order|return|plan|checkout/i.test(k)) }));
      await p2.close();
      return {
        result: after.session ? "ok" : "lücke",
        note: `Tab 1 (Registrierung) hält sessionStorage[tj2-return-to] = ${before ?? "–"}. Im neuen Tab (so öffnet sich der Link aus der Bestätigungsmail) ist er: ${after.session ?? "LEER – die vorgewählte Bestellung geht verloren"}. localStorage-Schlüssel zur Bestellung: ${after.local.join(",") || "keine"}. Die App erwartet den Link „in diesem Browser“, aber der Merker lebt nur im Tab und höchstens 30 Minuten (src/store/returnTo.ts, RETURN_TTL_MS).`,
      };
    });

    await step("Konto existiert schon: Registrieren mit bekannter E-Mail", async () => {
      await page.keyboard.press("Escape");
      await page.waitForTimeout(500);
      await page.evaluate(() => {
        window.location.hash = "preise";
      });
      await page.waitForTimeout(800);
      await page.getByTestId("cta-premium").click();
      await page.waitForTimeout(1500);
      const sheet = sheetOf(page);
      await expectNotInert(sheet.getByLabel("E-Mail"), 25_000);
      await sheet.getByLabel("E-Mail").fill("trader@example.com");
      await sheet.getByLabel("Passwort", { exact: true }).fill("richtig-geheim-42");
      const repeat = sheet.getByLabel("Passwort wiederholen");
      if (await repeat.count()) await repeat.fill("richtig-geheim-42");
      const boxes = sheet.getByRole("checkbox");
      for (let i = 0; i < (await boxes.count()); i++) await boxes.nth(i).check().catch(() => undefined);
      await sheet.getByRole("button", { name: "Konto erstellen", exact: true }).click();
      await page.waitForTimeout(2200);
      const t = await dialogsText(page);
      return { result: "info", note: `Rückmeldung bei bekannter E-Mail (Mock-Verhalten des Supabase-Nachbaus, kein Beweis für das echte Verhalten): ${t.slice(0, 300)}` };
    }, "05-bekannte-email");

    await step("Anmelden mit bestehendem Konto aus der Bestellung heraus: kommt die Bestellung zurück?", async () => {
      const sheet = sheetOf(page);
      // reopen the order intent fresh: close, pick Premium again
      await page.keyboard.press("Escape");
      await page.waitForTimeout(500);
      await page.evaluate(() => {
        window.location.hash = "preise";
      });
      await page.waitForTimeout(600);
      await page.getByTestId("cta-premium").click();
      await page.waitForTimeout(1500);
      const s2 = sheetOf(page);
      await expectNotInert(s2.getByLabel("E-Mail"), 25_000);
      const mode = s2.getByRole("radio", { name: "Passwort", exact: true });
      if (await mode.count()) await mode.click();
      await s2.getByLabel("E-Mail").fill("trader@example.com");
      await s2.getByLabel("Passwort", { exact: true }).fill("richtig-geheim-42");
      await s2.getByRole("button", { name: "Anmelden", exact: true }).click();
      await page.waitForTimeout(4500);
      const welcome = await dialogsText(page);
      const go = page.getByRole("button", { name: "Los geht’s" });
      if (await go.count()) await go.click();
      await page.waitForTimeout(3000);
      const order = await page.getByTestId("order-terms").count();
      const text = await dialogsText(page);
      void sheet;
      return { result: order > 0 ? "ok" : "lücke", note: `Nach dem Login zuerst: ${welcome.slice(0, 120)}; nach „Los geht’s“: ${text.slice(0, 300)}. Bestellübersicht (Premium, Jahr, 240 €) kommt von selbst zurück: ${order > 0 ? "ja, erst nach dem Willkommen-Dialog" : "nein"}.` };
    }, "06-nach-login-bestellung");

    await step("Bestellübersicht per Tastatur (UI-07): Tab bleibt im Dialog, Escape schließt, Fokus kehrt zurück", async () => {
      const dlg = page.getByRole("dialog").last();
      if (!(await dlg.count())) return { result: "lücke", note: "keine Bestellübersicht offen" };
      const seen: string[] = [];
      let outside = 0;
      for (let i = 0; i < 18; i++) {
        await page.keyboard.press("Tab");
        const r = await page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null;
          const d = Array.from(document.querySelectorAll('[role="dialog"]')).filter((x) => x.getAttribute("aria-label") !== "Intro" && (x as HTMLElement).offsetWidth > 4).pop();
          return { name: (el?.getAttribute("aria-label") || el?.innerText || el?.tagName || "").replace(/\s+/g, " ").trim().slice(0, 40), inside: !!(d && el && d.contains(el)) };
        });
        seen.push(r.name);
        if (!r.inside) outside++;
      }
      await page.keyboard.press("Escape");
      await page.waitForTimeout(900);
      const closed = (await page.getByRole("dialog").count()) === 0;
      const back = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.getAttribute("data-testid") ?? document.activeElement?.tagName ?? "");
      return { result: outside === 0 && closed ? "ok" : "lücke", note: `18 Tab-Schritte, davon außerhalb des Dialogs: ${outside}; Reihenfolge: ${seen.slice(0, 10).join(" › ")}; Escape schließt: ${closed}; Fokus danach auf: ${back}` };
    }, "07-bestellung-tastatur");

    await step("Kauf abbrechen → freier Bereich weiter nutzbar", async () => {
      await page.keyboard.press("Escape");
      await page.waitForTimeout(800);
      const dialogs = await dialogsText(page);
      const plan = await page.evaluate(() => document.body.innerText.match(/Im Free-Tarif|Dein Tarif[^\n]*|Aktueller Tarif[^\n]*/)?.[0] ?? "");
      return { result: dialogs.trim() === "" ? "ok" : "info", note: `Offene Dialoge nach Escape: ${dialogs || "keine"}; Tarif-Hinweis auf der Seite: ${plan || "–"}` };
    });

    await ctx.close();
  });

  test(`Journey 2 (Kostenlos starten) + 3 (Passwort vergessen) @${w}`, async ({ browser }) => {
    test.setTimeout(15 * 60_000);
    const ctx = await context(browser, w);
    const page = await ctx.newPage();
    const step = recorder("J2", w, () => page);
    await blockExternalNetwork(page);
    const sb = await mockSupabase(page, { signupConfirm: false });
    await mockBilling(page, {});
    await seed(page, { empty: true, firstRun: true });
    await page.goto(`${CLOUD}/#preise`, { waitUntil: "load" });
    await page.locator("main h1:visible", { hasText: "Preise" }).first().waitFor({ state: "visible", timeout: 25_000 });
    await page.waitForTimeout(2500);

    await step(
      "„Kostenlos starten“ öffnet die Registrierung",
      async () => {
        await page.getByTestId("cta-free").click();
        await page.waitForTimeout(1500);
        const t = await dialogsText(page);
        return { result: /Konto erstellen|Neu hier/.test(t) ? "ok" : "lücke", note: `Dialog: ${t.slice(0, 280)}` };
      },
      "10-kostenlos-starten",
    );

    await step(
      "Registrierung ohne Bestätigungspflicht (Mock) → Willkommen → erster Zustand",
      async () => {
        const sheet = sheetOf(page);
        await expectNotInert(sheet.getByLabel("E-Mail"), 25_000);
        await sheet.getByLabel("E-Mail").fill("gratis@example.com");
        await sheet.getByLabel("Passwort", { exact: true }).fill("richtig-geheim-42");
        const repeat = sheet.getByLabel("Passwort wiederholen");
        if (await repeat.count()) await repeat.fill("richtig-geheim-42");
        const boxes = sheet.getByRole("checkbox");
        for (let i = 0; i < (await boxes.count()); i++) await boxes.nth(i).check().catch(() => undefined);
        await sheet.getByRole("button", { name: "Konto erstellen", exact: true }).click();
        await page.waitForTimeout(4500);
        const t = await dialogsText(page);
        const created = sb.users.some((u) => u.email === "gratis@example.com");
        return { result: created ? "ok" : "lücke", note: `Konto im Mock: ${created}. Danach: ${t.slice(0, 320)}` };
      },
      "11-willkommen",
    );

    await step(
      "Nach dem Willkommen: Mini-Onboarding / Demo-oder-eigene-Daten-Wahl?",
      async () => {
        const close = page.getByRole("button", { name: "Los geht’s" });
        if (await close.count()) await close.click();
        await page.waitForTimeout(2500);
        await page.evaluate(() => {
          window.location.hash = "overview";
        });
        await page.waitForTimeout(1800);
        const info = await page.evaluate(() => {
          const txt = document.body.innerText;
          return {
            dialogs: Array.from(document.querySelectorAll('[role="dialog"]')).filter((d) => d.getAttribute("aria-label") !== "Intro" && (d as HTMLElement).offsetWidth > 4).map((d) => d.getAttribute("aria-label")),
            empty: /Dein Journal ist noch leer/.test(txt),
            demo: /Demo/.test(txt),
            tour: /Einführung/.test(txt),
            firstTradeBtn: /Ersten Trade eintragen/.test(txt),
          };
        });
        return {
          result: "lücke",
          note: `Sichtbar nach dem ersten Login: Dialoge ${JSON.stringify(info.dialogs)}; Leerzustand „Dein Journal ist noch leer“ mit „Ersten Trade eintragen“: ${info.empty && info.firstTradeBtn ? "ja" : "nein"}; Hinweis auf Demo/Einführung nur als Fußzeile des Leerzustands: ${info.demo || info.tour ? "ja" : "nein"}. Es gibt keine Auswahl „Demo oder eigene Daten“, keinen Wizard (Konto › Daten › Verbindung › erster Trade) und keinen gespeicherten Fortschritt – die Einführung (6 Schritte) startet nur auf Wunsch (Einstellungen › Einführung & Hilfe).`,
        };
      },
      "12-erster-zustand",
    );

    // ---- Journey 3: forgot password (fresh context state: sign out first)
    await step(
      "Passwort vergessen: Dialog und Bestätigungszustand",
      async () => {
        await page.evaluate(() => {
          window.location.hash = "konto";
        });
        await page.waitForTimeout(1500);
        const out = page.getByRole("button", { name: /Abmelden/ }).first();
        if (await out.count()) await out.click({ timeout: 4000 }).catch(() => undefined);
        await page.waitForTimeout(2000);
        const pill = page.locator('[data-cloud-pill="signin"]').first();
        await pill.click({ timeout: 8000 }).catch(() => undefined);
        await page.waitForTimeout(1500);
        const sheet = sheetOf(page);
        const forgot = sheet.getByRole("button", { name: /Passwort vergessen/ });
        if (!(await forgot.count())) return { result: "lücke", note: `Knopf „Passwort vergessen?“ nicht gefunden: ${(await dialogsText(page)).slice(0, 200)}` };
        await forgot.click();
        await page.waitForTimeout(900);
        await sheet.getByLabel("E-Mail").fill("unbekannt@example.com");
        await sheet.getByRole("button", { name: /Link senden/ }).click();
        await page.waitForTimeout(1800);
        const unknown = await dialogsText(page);
        return { result: "info", note: `Antwort für eine UNBEKANNTE Adresse (Mock): ${unknown.slice(0, 300)}. Vergleich mit bekannter Adresse folgt; echte Keine-Enumeration-Garantie liegt bei Supabase = BLOCKED.` };
      },
      "13-passwort-vergessen",
    );

    await step("Falsches Passwort: Fehlertext, Eingabe bleibt", async () => {
      await page.keyboard.press("Escape");
      await page.waitForTimeout(600);
      const pill = page.locator('[data-cloud-pill="signin"]').first();
      await pill.click({ timeout: 8000 });
      await page.waitForTimeout(1500);
      const sheet = sheetOf(page);
      await expectNotInert(sheet.getByLabel("E-Mail"), 25_000);
      await sheet.getByLabel("E-Mail").fill("gratis@example.com");
      await sheet.getByLabel("Passwort", { exact: true }).fill("falsches-passwort-1");
      await sheet.getByRole("button", { name: "Anmelden", exact: true }).click();
      await page.waitForTimeout(1800);
      const t = await dialogsText(page);
      const kept = await sheet.getByLabel("E-Mail").inputValue();
      return { result: kept === "gratis@example.com" ? "ok" : "lücke", note: `Fehlermeldung: ${t.slice(0, 260)}; E-Mail bleibt im Feld: ${kept === "gratis@example.com"}. Rate-Limit nach mehreren Versuchen: serverseitig bei Supabase (BLOCKED).` };
    });
    await ctx.close();
  });
}

for (const w of [390, 1440]) {
  test(`Journey 4: Rechtstexte, Fußzeile, Sticky-Leisten @${w}`, async ({ browser }) => {
    test.setTimeout(10 * 60_000);
    const targets: Array<{ name: string; url: string; mocked: boolean }> = [
      { name: "vorschau", url: PREVIEW, mocked: false },
      { name: "lokal", url: LOCAL, mocked: true },
      { name: "cloud", url: CLOUD, mocked: true },
    ];
    for (const t of targets) {
      const ctx = await context(browser, w);
      const page = await ctx.newPage();
      const step = recorder(`J4-${t.name}`, w, () => page);
      if (t.mocked) {
        await blockExternalNetwork(page);
        if (t.name === "cloud") {
          await mockSupabase(page, {});
          await mockBilling(page, {});
        }
        await seed(page, { empty: true });
      } else
        await page.addInitScript(() => {
          try {
            sessionStorage.setItem("tj2-intro", "1");
          } catch {
            /* a foreign-origin frame denies storage */
          }
        });
      for (const route of ["overview", "preise", "konto"]) {
        await step(`${route}: Rechtliches am Seitenende erreichbar (nicht verdeckt)`, async () => {
          await page.goto(`${t.url}/#${route}`, { waitUntil: "load" });
          await page.locator("main h1:visible").first().waitFor({ state: "visible", timeout: 25_000 }).catch(() => undefined);
          await page.waitForTimeout(2500);
          await page.evaluate(async () => {
            for (let y = 0; y < document.documentElement.scrollHeight; y += 700) {
              window.scrollTo({ top: y, behavior: "instant" });
              await new Promise((r) => setTimeout(r, 60));
            }
            window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" });
          });
          await page.waitForTimeout(1500);
          const info = await page.evaluate(() => {
            const links = Array.from(document.querySelectorAll('footer a[data-testid^="legal-"], footer a[data-testid^="contract-link"], footer nav[aria-label="Rechtliches"] a, main a[data-testid^="legal-"]')) as HTMLElement[];
            return links.map((a) => {
              const r = a.getBoundingClientRect();
              const hit = r.width > 0 ? document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) : null;
              return { text: a.innerText.trim(), href: a.getAttribute("href"), inView: r.top >= 0 && r.bottom <= innerHeight, covered: !!hit && hit !== a && !a.contains(hit), by: hit ? `${hit.tagName.toLowerCase()}${hit.getAttribute("data-testid") ? "[" + hit.getAttribute("data-testid") + "]" : ""}${hit.getAttribute("aria-label") ? `(${hit.getAttribute("aria-label")})` : ""}` : "" };
            });
          });
          const covered = info.filter((l) => l.covered);
          return {
            result: info.length && !covered.length ? "ok" : "lücke",
            note: `Rechtliche Links am Ende: ${info.map((l) => `${l.text} → ${l.href}${l.covered ? ` VERDECKT von ${l.by}` : ""}`).join(" · ") || "KEINE gefunden (legalShown() false oder Fußzeile fehlt)"}`,
          };
        }, `${route}-ende`);
      }
      await step("Impressum öffnen: Inhalt", async () => {
        await page.goto(`${t.url}/?rechtliches=impressum`, { waitUntil: "load" });
        await page.waitForTimeout(4000);
        const text = await dialogsText(page);
        return { result: text ? "info" : "lücke", note: `Direktlink /?rechtliches=impressum zeigt: ${text.slice(0, 380) || "keinen Dialog"}` };
      }, "impressum");
      await ctx.close();
    }
  });
}

/** What the very first seconds look like on the hosted preview (the intro film included), at the four audit viewports. */
for (const w of [390, 768, 1280, 1440]) {
  test(`Journey 0: erste Sekunden der Vorschau @${w}`, async ({ browser }) => {
    test.setTimeout(3 * 60_000);
    const ctx = await context(browser, w);
    const page = await ctx.newPage();
    const step = recorder("J0", w, () => page);
    const t0 = Date.now();
    await page.goto(`${PREVIEW}/`, { waitUntil: "commit" });
    await step("0,6 s nach dem Start", async () => {
      await page.waitForTimeout(600);
      return { result: "info", note: `Dialog „Intro“ sichtbar: ${await page.locator('[aria-label="Intro"]').count()}` };
    }, "00-0s6");
    await step("2,5 s", async () => {
      await page.waitForTimeout(1900);
      return { result: "info", note: `Intro noch da: ${await page.locator('[aria-label="Intro"]').isVisible().catch(() => false)}` };
    }, "01-2s5");
    await step("Intro vorbei, bedienbar?", async () => {
      const ready = await page
        .getByRole("button", { name: /Trade eintragen/ })
        .first()
        .waitFor({ state: "visible", timeout: 30_000 })
        .then(() => true, () => false);
      const intro = await page.locator('[aria-label="Intro"]').isVisible().catch(() => false);
      return { result: ready && !intro ? "ok" : "lücke", note: `Erste Bedienelemente sichtbar nach ${((Date.now() - t0) / 1000).toFixed(1)} s (Sandbox, geteilte CPU); Intro noch sichtbar: ${intro}` };
    }, "02-bedienbar");
    await step("Intro nur einmal je Sitzung?", async () => {
      await page.reload({ waitUntil: "load" });
      await page.waitForTimeout(1500);
      const again = await page.locator('[aria-label="Intro"]').isVisible().catch(() => false);
      return { result: again ? "lücke" : "ok", note: `Zweiter Aufruf in derselben Sitzung zeigt das Intro: ${again}` };
    });
    await ctx.close();
  });
}
