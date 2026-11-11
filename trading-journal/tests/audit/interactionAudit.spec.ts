/**
 * Interaction audit crawl (Launch-Audit, Paket D1). One test = one persona at one viewport; inside, every screen in turn.
 * Results go to `$PW_AUDIT_OUT/<persona>__<viewport>.json` (after every screen, so a crash loses nothing) and are merged
 * into `docs/audit/INTERACTION_AUDIT.csv` by `scripts/audit/buildAuditCsv.mjs`.
 *
 *   PW_AUDIT_OUT=/tmp/audit PW_AUDIT_LOCAL=http://127.0.0.1:4410 PW_AUDIT_CLOUD=http://127.0.0.1:4411 \
 *   PW_AUDIT_PREVIEW=https://deploy-preview-6--xxhuxabbyubzv.netlify.app \
 *   npx playwright test -c playwright.audit.config.ts
 *
 * Personas: `preview` (the hosted preview, nothing mocked: a first visitor), `local` (default build, fixture journal, market
 * mock), `local-first` (default build, EMPTY journal, onboarding allowed), `cloud-out` (cloud build against the Supabase mock,
 * signed out) and `cloud-in` (the same, signed in via the real login sheet).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test, type Browser, type Page } from "@playwright/test";
import { blockExternalNetwork, signInViaSheet } from "../e2e/cloudSignIn";
import { seed } from "../e2e/helpers";
import { mockBilling } from "../e2e/mocks/billing";
import { mockExchange } from "../e2e/mocks/exchange";
import { mockSocial } from "../e2e/mocks/social";
import { mockSupabase } from "../e2e/mocks/supabase";
import { closeOverlays, collect, crawlScreen, hitMisses, installProbes, overflowX, Recorder, tabWalk, type ElementResult, type ScreenReport } from "./auditLib";

const OUT = process.env.PW_AUDIT_OUT ?? "/tmp/audit-out";
const BASES = {
  preview: process.env.PW_AUDIT_PREVIEW ?? "https://deploy-preview-6--xxhuxabbyubzv.netlify.app",
  local: process.env.PW_AUDIT_LOCAL ?? "http://127.0.0.1:4410",
  cloud: process.env.PW_AUDIT_CLOUD ?? "http://127.0.0.1:4411",
};
const ONLY = (process.env.PW_AUDIT_ONLY ?? "").split(",").filter(Boolean);
const VIEWPORT_ONLY = (process.env.PW_AUDIT_VIEWPORTS ?? "").split(",").filter(Boolean).map(Number);
const SCREEN_ONLY = (process.env.PW_AUDIT_SCREENS ?? "").split(",").filter(Boolean);
/** A partial re-run (`PW_AUDIT_SCREENS`) writes `<persona>__<viewport>.<tag>.json`; `buildAuditCsv.mjs` lets it replace the same screens of the full run. */
const TAG = process.env.PW_AUDIT_TAG ? `.${process.env.PW_AUDIT_TAG}` : "";
const MAX_PER_SCREEN = Number(process.env.PW_AUDIT_MAX ?? 32);
const SCREEN_BUDGET_MS = Number(process.env.PW_AUDIT_BUDGET ?? 130_000);

type PersonaId = "preview" | "local" | "local-first" | "cloud-out" | "cloud-in";
interface Persona {
  id: PersonaId;
  base: string;
  /** screens that are clicked through, per viewport ("*" = all); every other screen gets the passive checks only (inventory, console, requests, overflow, hit boxes, Tab walk, screenshot) */
  click: Record<number, string[] | "*">;
  pages: boolean;
}
/** The machine is shared with other agents (load average 15+ on 4 cores): a click crawl of everything everywhere does not fit, so the core path is crawled on both ends of the viewport range and the rest is inventoried. */
const CORE = ["overview", "preise", "konto", "funktionen", "settings"];
const PERSONAS: Persona[] = [
  { id: "preview", base: BASES.preview, click: { 390: [...CORE, "overlay-menu"], 768: [], 1280: [], 1440: [...CORE, "overlay-menu"] }, pages: true },
  { id: "local", base: BASES.local, click: { 390: [...CORE, "trades", "markt", "overlay-menu", "overlay-trade-editor", "overlay-assistent", "overlay-suche"], 768: [], 1280: [], 1440: "*" }, pages: true },
  { id: "local-first", base: BASES.local, click: { 390: ["overview"], 768: [], 1280: [], 1440: ["overview"] }, pages: false },
  { id: "cloud-out", base: BASES.cloud, click: { 390: "*", 768: ["overlay-auth-login", "overlay-auth-signup"], 1280: ["overlay-auth-login", "overlay-auth-signup"], 1440: "*" }, pages: false },
  { id: "cloud-in", base: BASES.cloud, click: { 390: ["konto", "preise", "overview", "overlay-bestellung"], 768: [], 1280: [], 1440: ["konto", "preise", "overview", "community", "settings", "funktionen", "overlay-menu", "overlay-assistent", "overlay-trade-editor", "overlay-bestellung", "overlay-tarifdetail"] }, pages: true },
];
const VIEWPORTS: Array<{ w: number; h: number }> = [
  { w: 390, h: 844 },
  { w: 768, h: 1024 },
  { w: 1280, h: 800 },
  { w: 1440, h: 900 },
];

/** The h1 of every page (the sidebar says "Trades", the page says "Alle Trades"). */
const PAGE_H1: Record<string, string> = {
  overview: "Übersicht",
  trades: "Alle Trades",
  plan: "Handelsplan",
  setups: "Entscheidungsgrundlagen",
  markt: "Markt",
  aktien: "Aktien",
  risiko: "Risiko",
  analyse: "Analyse",
  berichte: "Berichte",
  coach: "Coach",
  wachstum: "Wachstum",
  cockpit: "Cockpit",
  labor: "Labor",
  studio: "Strategie-Studio",
  settings: "Einstellungen",
  konto: "Konto",
  community: "Community",
  preise: "Preise",
  funktionen: "Funktionen",
};

const PAGE_ORDER = ["overview", "trades", "plan", "setups", "markt", "aktien", "risiko", "analyse", "berichte", "coach", "wachstum", "cockpit", "labor", "studio", "settings", "konto", "community", "preise", "funktionen"];

interface Screen {
  id: string;
  /** hash route, or an opener for an overlay */
  hash?: string;
  open?: (page: Page) => Promise<boolean>;
  scope: "page" | "dialog";
  /** crawl the shell (header / sidebar / dock) here as well */
  shell?: boolean;
  skip?: RegExp;
}

/** Opens the navigation overlay: the header's „Menü“ on wide screens, the dock's „Mehr“ below 768 px. */
async function openMenu(page: Page): Promise<boolean> {
  const btn = page.getByRole("button", { name: /^(Menü, Navigation öffnen|Mehr)/ }).first();
  if (!(await btn.isVisible().catch(() => false))) return false;
  await btn.click({ timeout: 4000 }).catch(() => undefined);
  await page.waitForTimeout(700);
  return page.getByRole("dialog").first().isVisible().catch(() => false);
}

function clickOpener(name: string | RegExp, opts: { testid?: string } = {}): (page: Page) => Promise<boolean> {
  return async (page) => {
    const btn = opts.testid ? page.getByTestId(opts.testid).first() : page.getByRole("button", { name }).first();
    if (!(await btn.isVisible().catch(() => false))) return false;
    await btn.click({ timeout: 4000 }).catch(() => undefined);
    await page.waitForTimeout(800);
    return page.getByRole("dialog").first().isVisible().catch(() => false);
  };
}

const OVERLAYS: Screen[] = [
  { id: "overlay-menu", scope: "dialog", open: openMenu },
  { id: "overlay-assistent", scope: "dialog", open: clickOpener(/^Assistent öffnen/, { testid: "assistant-button" }) },
  { id: "overlay-trade-editor", scope: "dialog", open: clickOpener(/^Trade eintragen$/), skip: /^(Speichern|Trade speichern)$/ },
  {
    id: "overlay-suche",
    scope: "dialog",
    open: async (page) => {
      await page.keyboard.press("Control+k").catch(() => undefined);
      await page.waitForTimeout(700);
      return page.getByRole("dialog").first().isVisible().catch(() => false);
    },
  },
  {
    id: "overlay-tastenkuerzel",
    scope: "dialog",
    open: async (page) => {
      await page.keyboard.press("?").catch(() => undefined);
      await page.waitForTimeout(700);
      return page.getByRole("dialog").first().isVisible().catch(() => false);
    },
  },
  { id: "overlay-rechtliches", scope: "dialog", open: clickOpener(/^Rechtliches: Impressum/, { testid: "sidebar-legal" }) },
];

/** Signed in: the order summary ("Deine Bestellung") and the tariff detail – found through the pricing page like a person would. */
function purchaseOverlays(): Screen[] {
  const viaPricing = (testid: string) => async (page: Page): Promise<boolean> => {
    await page.evaluate(() => {
      window.location.hash = "preise";
    });
    await page.locator("main h1:visible", { hasText: "Preise" }).first().waitFor({ state: "visible", timeout: 20_000 }).catch(() => undefined);
    await page.waitForTimeout(1500);
    const btn = page.getByTestId(testid).first();
    if (!(await btn.isVisible().catch(() => false))) return false;
    await btn.scrollIntoViewIfNeeded().catch(() => undefined);
    await btn.click({ timeout: 4000 }).catch(() => undefined);
    await page.waitForTimeout(1500);
    return page.getByRole("dialog").first().isVisible().catch(() => false);
  };
  return [
    { id: "overlay-bestellung", scope: "dialog", open: viaPricing("cta-premium") },
    { id: "overlay-tarifdetail", scope: "dialog", open: viaPricing("details-premium") },
  ];
}

function authOverlays(): Screen[] {
  const pill = async (page: Page): Promise<boolean> => {
    const p = page.locator('[data-cloud-pill="signin"]').first();
    if (!(await p.isVisible().catch(() => false))) return false;
    await p.click({ timeout: 4000 }).catch(() => undefined);
    await page.waitForTimeout(1200);
    return page.getByRole("dialog", { name: /Anmelden|Konto erstellen|Registrieren/ }).first().isVisible().catch(() => false);
  };
  return [
    { id: "overlay-auth-login", scope: "dialog", open: pill },
    {
      id: "overlay-auth-signup",
      scope: "dialog",
      open: async (page) => {
        if (!(await pill(page))) return false;
        const d = page.getByRole("dialog").first();
        const reg = d.getByRole("radio", { name: "Neu hier" }).first();
        const link = d.getByRole("button", { name: /Registrieren|Konto erstellen|Neu hier/ }).first();
        if (await reg.isVisible().catch(() => false)) await reg.click().catch(() => undefined);
        else if (await link.isVisible().catch(() => false)) await link.click().catch(() => undefined);
        await page.waitForTimeout(800);
        return true;
      },
    },
  ];
}

async function setup(browser: Browser, p: Persona, vp: { w: number; h: number }) {
  const mobile = vp.w <= 430;
  const ctx = await browser.newContext({
    viewport: { width: vp.w, height: vp.h },
    deviceScaleFactor: 1,
    isMobile: mobile,
    hasTouch: mobile,
    colorScheme: "dark",
    locale: "de-DE",
    timezoneId: "Europe/Berlin",
    acceptDownloads: true,
    serviceWorkers: "block",
    // Reduced Motion (the app honours it: `useReducedFx`): pages without running animations answer the crawl in a fraction of the time and every
    // element holds still when it is clicked. The motion paths themselves are the E2E suite's business (motion-global.spec.ts), not this audit's.
    reducedMotion: "reduce",
  });
  const page = await ctx.newPage();
  await installProbes(page);
  const rec = new Recorder(page, ctx, p.id === "preview", p.base);
  if (p.id === "preview") {
    // a real first visitor, minus the intro film (`tj2-intro` is its once-per-session marker; the journey spec films the intro itself)
    await page.addInitScript(() => {
      try {
        sessionStorage.setItem("tj2-intro", "1");
      } catch {
        /* a foreign-origin frame (the Netlify drawer) denies storage – not the app's business */
      }
    });
    // Netlify injects its deploy-preview drawer (`/.netlify/scripts/cdp` → an iframe of app.netlify.com) that the app's own CSP
    // (`frame-src 'none'`) turns into a blank white 780×48 bar at the bottom of every screen: it covers and eats taps there. That is a
    // finding of its own (STATUS.md); here the script is not loaded, so it does not turn every footer / dock click of the crawl into a
    // "covered" false alarm (the drawer sets `display: block !important` inline, a style rule cannot hide it).
    await page.route("**/.netlify/scripts/cdp", (route) => route.abort());
    return { ctx, page, rec };
  }
  await blockExternalNetwork(page);
  if (p.id === "cloud-out" || p.id === "cloud-in") {
    const sb = await mockSupabase(page);
    await mockBilling(page, {});
    await mockSocial(page);
    await mockExchange(page, sb, {});
    await seed(page, p.id === "cloud-in" ? {} : { empty: true });
  } else if (p.id === "local-first") await seed(page, { empty: true, firstRun: true });
  else await seed(page);
  return { ctx, page, rec };
}

async function settle(page: Page): Promise<void> {
  // lazy cards mount while scrolling (content-visibility): walk down and back so the whole page is in the DOM
  await page.evaluate(async () => {
    const h = document.documentElement.scrollHeight;
    for (let y = 0; y < Math.min(h, 6000); y += Math.round(window.innerHeight * 0.8)) {
      window.scrollTo({ top: y, behavior: "instant" });
      await new Promise((r) => setTimeout(r, 90));
    }
    window.scrollTo({ top: 0, behavior: "instant" });
  });
  await page.waitForTimeout(400);
}

function save(file: string, data: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(data));
}

for (const persona of PERSONAS) {
  if (ONLY.length && !ONLY.includes(persona.id)) continue;
  for (const vp of VIEWPORTS) {
    if (VIEWPORT_ONLY.length && !VIEWPORT_ONLY.includes(vp.w)) continue;
    test(`${persona.id} @${vp.w}`, async ({ browser }) => {
      test.setTimeout(55 * 60_000);
      const { ctx, page, rec } = await setup(browser, persona, vp);
      const reports: ScreenReport[] = [];
      const file = join(OUT, `${persona.id}__${vp.w}${TAG}.json`);
      const clickSet = persona.click[vp.w] ?? [];
      let shellDone = false;
      const startUrl = (hash: string) => `${persona.base}/#${hash}`;

      // ---- screens of this persona
      const screens: Screen[] = [];
      if (persona.pages) for (const h of PAGE_ORDER) screens.push({ id: h, hash: h, scope: "page" });
      else {
        screens.push({ id: "overview", hash: "overview", scope: "page" });
        if (persona.id === "cloud-out") for (const h of ["preise", "konto"]) screens.push({ id: h, hash: h, scope: "page" });
      }
      if (persona.id !== "local-first") screens.push(...OVERLAYS);
      if (persona.id === "cloud-out") screens.push(...authOverlays());
      if (persona.id === "cloud-in") screens.push(...purchaseOverlays());

      let first = true;
      for (const s of screens) {
        if (SCREEN_ONLY.length && !SCREEN_ONLY.includes(s.id)) continue;
        const t0 = Date.now();
        rec.step = `load:${s.id}`;
        const netMark = rec.net.length;
        const logMark = rec.logs.length;
        const report: ScreenReport = {
          persona: persona.id,
          viewport: vp.w,
          screen: s.id,
          url: "",
          title: "",
          h1: "",
          ready: false,
          loadMs: 0,
          overflowX: 0,
          mainText: "",
          stateFlags: [],
          net: [],
          logs: [],
          hits: [],
          tab: null,
          elements: [],
          counts: { interactive: 0, clicked: 0, dead: 0, covered: 0, errors: 0 },
        };
        try {
          // ---- get there
          if (s.hash !== undefined) {
            if (first) {
              await page.goto(startUrl(s.hash), { waitUntil: "load", timeout: 45_000 });
              first = false;
              if (persona.id === "cloud-in") {
                await signInViaSheet(page, { synced: true });
                await page.waitForTimeout(500);
              }
            } else {
              await closeOverlays(page, page.url());
              await page.evaluate((h) => {
                window.location.hash = h;
              }, s.hash);
            }
            // the outgoing page stays in the DOM while the new one slides in (and the hash change is handled a tick later): ready = exactly
            // ONE visible h1, it is the page asked for, and no skeleton
            const want = PAGE_H1[s.hash] ?? s.hash;
            report.ready = await page
              .waitForFunction(
                (expected) => {
                  const hs = Array.from(document.querySelectorAll("main h1")).filter((h) => (h as HTMLElement).getBoundingClientRect().width > 0 && getComputedStyle(h).visibility !== "hidden");
                  return hs.length === 1 && (hs[0]?.textContent ?? "").trim().startsWith(expected) && !document.querySelector("[data-page-skeleton]");
                },
                want,
                { timeout: 25_000, polling: 250 },
              )
              .then(() => true, () => false);
            report.h1 = report.ready ? ((await page.locator("main h1:visible").first().innerText().catch(() => "")) ?? "").slice(0, 80) : "";
            await page.waitForTimeout(1200);
            await settle(page);
          } else if (s.open) {
            if (first) {
              await page.goto(startUrl("overview"), { waitUntil: "load", timeout: 45_000 });
              first = false;
              if (persona.id === "cloud-in") await signInViaSheet(page, { synced: true });
              await page.waitForTimeout(1500);
            } else {
              await closeOverlays(page, page.url());
              await page.evaluate(() => {
                window.location.hash = "overview";
              });
              await page.waitForTimeout(500);
            }
            report.ready = await s.open(page);
            report.h1 = report.ready ? ((await page.getByRole("dialog").first().getAttribute("aria-label").catch(() => "")) ?? "") : "";
            if (!report.ready) report.note = "Overlay ließ sich nicht öffnen (Opener fand kein sichtbares Element oder der Dialog erschien nicht)";
          }
          report.loadMs = Date.now() - t0;
          report.url = page.url();
          report.title = await page.title();
          report.mainText = ((await page.locator(s.scope === "dialog" ? '[role="dialog"]' : "main").last().innerText({ timeout: 2000 }).catch(() => "")) ?? "").replace(/\s+/g, " ").slice(0, 220);
          const flags = await page.evaluate(() => {
            const f: string[] = [];
            if (document.querySelector("[data-page-skeleton]")) f.push("skeleton-bleibt");
            if (document.querySelector("[data-offline-note]")) f.push("offline-hinweis");
            const t = document.body.innerText;
            if (document.querySelector("[data-error-boundary], [role=\"alert\"]") && /Erneut versuchen|Neu laden/.test(t)) f.push("fehlerrahmen");
            return f;
          });
          report.stateFlags = flags;
          report.overflowX = await overflowX(page);
          // passive checks while the screen is quiet
          if (vp.w <= 430 && report.ready) report.hits = await hitMisses(page, s.scope);
          const clickThis = report.ready && (clickSet === "*" || clickSet.includes(s.id));
          if (clickThis && s.scope === "page") report.tab = await tabWalk(page, 40);
          // a screenshot (jpeg, small)
          const shotPath = join(OUT, "shots", persona.id, String(vp.w), `${s.id}.jpg`);
          mkdirSync(dirname(shotPath), { recursive: true });
          await page.screenshot({ path: shotPath, type: "jpeg", quality: 55, animations: "disabled" }).catch(() => undefined);
          report.screenshot = `${persona.id}/${vp.w}/${s.id}.jpg`;
          // ---- click through
          if (clickThis) {
            await closeOverlays(page, page.url()).catch(() => undefined);
            if (s.scope === "dialog") {
              // the tab walk / probes above may have closed the dialog: open again
              const stillOpen = await page.getByRole("dialog").first().isVisible().catch(() => false);
              if (!stillOpen && s.open) await s.open(page);
            }
            const crawlUrl = page.url();
            const shellElements: ElementResult[] = [];
            if (!shellDone && s.scope === "page") {
              // header, sidebar and dock are on every page: crawled ONCE per persona and viewport, with a budget of their own
              rec.step = "shell";
              const sh = await crawlScreen(page, rec, crawlUrl, { scope: "page", max: 60, onlyShell: true, skipShell: false, budgetMs: 240_000, wait: 500 });
              shellElements.push(...sh.elements);
              await closeOverlays(page, crawlUrl).catch(() => undefined);
            }
            const res = await crawlScreen(page, rec, crawlUrl, {
              scope: s.scope,
              max: MAX_PER_SCREEN,
              skipShell: true,
              budgetMs: SCREEN_BUDGET_MS,
              wait: 500,
              skip: s.skip,
              reopen: s.open ? () => s.open!(page) : undefined,
            });
            report.elements = [...shellElements, ...res.elements];
            report.counts.interactive = res.interactive;
            shellDone = shellDone || s.scope === "page";
          } else if (report.ready) {
            const all = await collect(page, s.scope);
            report.counts.interactive = all.length;
            report.elements = all.map((d) => ({ desc: d, probe: null, represents: 1, skipReason: "nur erfasst (nicht angeklickt auf diesem Viewport)" }));
          }
          report.counts.clicked = report.elements.filter((e) => e.probe && e.probe.status !== "not-clicked" && e.probe.status !== "disabled").length;
          report.counts.dead = report.elements.filter((e) => e.probe?.status === "dead-candidate" || e.probe?.status === "no-effect-handler" || e.probe?.status === "input-dead").length;
          report.counts.covered = report.elements.filter((e) => e.probe?.status === "covered").length;
          report.counts.errors = report.elements.filter((e) => e.probe?.status === "click-error").length;
        } catch (e) {
          report.note = `Abbruch: ${String((e as Error).message ?? e).split("\n")[0]?.slice(0, 200)}`;
          await page.goto(startUrl("overview"), { waitUntil: "load" }).catch(() => undefined);
        }
        // the load phase's own requests and logs (the clicks keep theirs inside the element results)
        report.net = rec.net.slice(netMark).filter((n) => n.step.startsWith("load:") || rec.isDefect(n));
        report.logs = rec.logs.slice(logMark).filter((l) => l.step.startsWith("load:"));
        reports.push(report);
        save(file, { recheck: TAG !== "", persona: persona.id, viewport: vp.w, base: persona.base, at: new Date().toISOString(), reports, popups: rec.popups, downloads: rec.downloads, allLogs: rec.logs, allNet: rec.net.filter((n) => rec.isDefect(n) || n.external) });
      }
      await ctx.close();
    });
  }
}
