/// <reference lib="dom" />
/**
 * Interaction audit (Launch-Audit, Paket D1): the machinery behind `docs/audit/INTERACTION_AUDIT.csv`.
 *
 * NOT part of the regular suite (own config `playwright.audit.config.ts`, own folder): a crawl that clicks every visible
 * interactive element of a screen, one after the other, and records what the click really did –
 * URL / hash, dialog opened or closed, toast, element state (`aria-*`, `data-state`), requests that left the page, console
 * output, scroll, DOM churn above the screen's own idle noise – and puts the page back before the next one.
 *
 * What it can prove: "this element reacts" (and how). What it cannot prove: that the reaction is the RIGHT one – the CSV's
 * "Erwartung" column is derived from role, label and href, and every "dead candidate" is re-clicked once with a longer wait
 * before it is reported. Mocks (Supabase / billing / market of `tests/e2e/mocks`) stand in for every backend, so the
 * "Network" column describes the browser's side only.
 */
import type { BrowserContext, ConsoleMessage, Page, Request, Response } from "@playwright/test";
import { auditHitBoxes, HIT_SELECTOR, type HitBoxMiss } from "../e2e/hitbox";

export const INTERACTIVE =
  'a[href], button, [role="button"], [role="tab"], [role="menuitem"], [role="menuitemradio"], [role="option"], [role="switch"], [role="checkbox"], [role="radio"], [role="link"], [role="combobox"], input:not([type="hidden"]), select, textarea, summary, [tabindex]:not([tabindex="-1"]), [onclick]';

export type Region = "shell" | "main" | "footer" | "dialog";

export interface Desc {
  key: string;
  n: number;
  tag: string;
  role: string;
  type: string;
  name: string;
  testid: string;
  href: string;
  target: string;
  rel: string;
  disabled: boolean;
  region: Region;
  /** `header` / `sidebar` / `dock` / `main` / `footer` / the dialog's label */
  where: string;
  heading: string;
  rect: { x: number; y: number; w: number; h: number };
  props: string[];
  /** a form's `onSubmit` for a submit button */
  formSubmit: boolean;
  selected: boolean;
  expanded: string;
  hiddenFromAt: boolean;
  focusable: boolean;
  /** signature without digits – equal siblings (calendar days, rows) are sampled, not all clicked */
  sig: string;
}

export interface Snap {
  url: string;
  dialogs: string[];
  toast: string;
  scroll: number;
  active: string;
  mut: number;
  /** values of the form fields of the screen (a click that only prefills fields changes nothing else) */
  vals: string;
  target: { connected: boolean; state: string };
}

export interface NetEvent {
  method: string;
  url: string;
  status: number | null;
  failed?: string;
  /** content type of the answer: an `/api/v1` path that answers `text/html` is the SPA fallback = a function nobody mocked / deployed */
  ct?: string;
  step: string;
  /** a request to a host outside the test world (the sandbox cannot reach it / the page blocks it) */
  external: boolean;
}

export interface LogEvent {
  type: "console-error" | "console-warning" | "pageerror";
  text: string;
  step: string;
  at: string;
}

export interface Probe {
  status:
    | "ok"
    | "noop-active"
    | "disabled"
    | "not-clicked"
    | "covered"
    | "dead-candidate"
    | "no-effect-handler"
    | "click-error"
    | "gone"
    | "input-ok"
    | "input-dead";
  reasons: string[];
  detail?: string;
  net: string[];
  logs: string[];
  popup?: string;
  download?: string;
  ms: number;
  retried?: boolean;
  /** the element was the chosen option at the moment of the click (earlier clicks may have selected it since the inventory was taken) */
  wasSelected?: boolean;
}

export interface ElementResult {
  desc: Desc;
  probe: Probe | null;
  /** how many equal siblings this one stands for (1 = just itself) */
  represents: number;
  skipReason?: string;
}

export interface TabWalk {
  steps: number;
  reachedNames: string[];
  withoutFocusRing: string[];
  trapped: boolean;
  /** visible interactive elements of the screen that the walk never reached (fine for roving tabindex groups) */
  unreached: string[];
}

export interface ScreenReport {
  persona: string;
  viewport: number;
  screen: string;
  url: string;
  title: string;
  h1: string;
  ready: boolean;
  loadMs: number;
  overflowX: number;
  mainText: string;
  stateFlags: string[];
  net: NetEvent[];
  logs: LogEvent[];
  hits: HitBoxMiss[];
  tab: TabWalk | null;
  elements: ElementResult[];
  counts: { interactive: number; clicked: number; dead: number; covered: number; errors: number };
  screenshot?: string;
  note?: string;
}

/* ------------------------------------------------------------------------------------------------ recorder */

const TEST_HOSTS = ["127.0.0.1", "localhost", "e2e-mock.supabase.co"];
const IGNORED_LOG = [/ERR_CERT_AUTHORITY_INVALID/, /fonts\.googleapis\.com/, /fonts\.gstatic\.com/];

export class Recorder {
  step = "boot";
  net: NetEvent[] = [];
  logs: LogEvent[] = [];
  popups: string[] = [];
  downloads: string[] = [];
  private readonly base: string;

  constructor(
    page: Page,
    context: BrowserContext,
    private readonly preview: boolean,
    base: string,
  ) {
    this.base = new URL(base).host;
    page.on("request", (r) => this.onRequest(r));
    page.on("response", (r) => this.onResponse(r));
    page.on("requestfailed", (r) => this.onFailed(r));
    page.on("console", (m) => this.onConsole(m));
    page.on("pageerror", (e) => this.logs.push({ type: "pageerror", text: String(e).slice(0, 400), step: this.step, at: new Date().toISOString() }));
    page.on("download", (d) => this.downloads.push(d.suggestedFilename()));
    context.on("page", (p) => {
      if (p === page) return;
      // a new tab (target=_blank, window.open): count it AT ONCE (the click's observation window is short), learn where it went, close it –
      // the audit never leaves the app
      const at = this.popups.push(p.url() || "(neuer Tab)") - 1;
      void p
        .waitForLoadState("domcontentloaded", { timeout: 3000 })
        .catch(() => undefined)
        .then(() => {
          if (p.url() && p.url() !== "about:blank") this.popups[at] = p.url();
          return p.close().catch(() => undefined);
        });
    });
  }

  private external(url: string): boolean {
    try {
      const u = new URL(url);
      if (u.protocol === "data:" || u.protocol === "blob:") return false;
      return !(u.host === this.base || TEST_HOSTS.includes(u.hostname));
    } catch {
      return false;
    }
  }

  private onRequest(r: Request): void {
    const url = r.url();
    if (/\.(js|css|woff2?|png|svg|jpg|webp|ico|map)(\?|$)/.test(url) && !this.external(url)) return;
    this.net.push({ method: r.method(), url: url.slice(0, 220), status: null, step: this.step, external: this.external(url) });
  }

  private onResponse(r: Response): void {
    const url = r.url().slice(0, 220);
    for (let i = this.net.length - 1; i >= 0; i--) {
      const e = this.net[i];
      if (e && e.url === url && e.status === null && !e.failed) {
        e.status = r.status();
        e.ct = (r.headers()["content-type"] ?? "").split(";")[0];
        return;
      }
    }
  }

  private onFailed(r: Request): void {
    const url = r.url().slice(0, 220);
    for (let i = this.net.length - 1; i >= 0; i--) {
      const e = this.net[i];
      if (e && e.url === url && e.status === null && !e.failed) {
        e.failed = r.failure()?.errorText ?? "failed";
        return;
      }
    }
  }

  private onConsole(m: ConsoleMessage): void {
    if (m.type() !== "error" && m.type() !== "warning") return;
    const text = m.text();
    if (IGNORED_LOG.some((re) => re.test(text))) return;
    this.logs.push({ type: m.type() === "error" ? "console-error" : "console-warning", text: text.slice(0, 400), step: this.step, at: new Date().toISOString() });
  }

  /** requests of the page's own world (functions, mocks, Stripe) – the ones a click may reasonably cause */
  appRequestsSince(mark: number): NetEvent[] {
    return this.net.slice(mark).filter((e) => !e.external || /stripe\.com/.test(e.url)).filter((e) => /\/api\/v1\/|e2e-mock\.supabase\.co|stripe\.com|\/\?(billing|kuendigen|widerruf)/.test(e.url));
  }

  /** Is this request one the audit should count as a defect (own origin / mock answering ≥ 400, or failing without being the test's block)? */
  isDefect(e: NetEvent): boolean {
    if (e.external) return false;
    if (e.failed && /ERR_ABORTED|ERR_INTERNET_DISCONNECTED/.test(e.failed)) return false;
    return (e.status !== null && e.status >= 400) || !!e.failed;
  }

  get previewMode(): boolean {
    return this.preview;
  }
}

/* ------------------------------------------------------------------------------------------------ in-page */

export async function installProbes(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __aud: { mut: number } };
    w.__aud = { mut: 0 };
    const start = () => {
      new MutationObserver((list) => {
        w.__aud.mut += list.length;
      }).observe(document, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: ["class", "aria-expanded", "aria-pressed", "aria-selected", "aria-checked", "aria-current", "data-state", "hidden", "open", "aria-hidden", "inert", "value", "checked", "disabled", "data-active"],
      });
    };
    if (document.documentElement) start();
    else document.addEventListener("DOMContentLoaded", start, { once: true });
  });
}

/** Everything visible and interactive, in DOM order (runs in the page). */
export async function collect(page: Page, scope: "page" | "dialog"): Promise<Desc[]> {
  return page.evaluate(
    ({ selector, scope }) => {
      const DIALOGS = '[role="dialog"],[role="alertdialog"],[aria-modal="true"],[data-vaul-drawer]';
      const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
      const isVisible = (el: Element): boolean => {
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) return false;
        const cs = getComputedStyle(el);
        if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) < 0.02) return false;
        return true;
      };
      const visibleDialogs = (): Element[] =>
        Array.from(document.querySelectorAll(DIALOGS)).filter((d) => isVisible(d) && d.getAttribute("aria-label") !== "Intro" && !d.closest("[inert]"));
      let roots: ParentNode[] = [document];
      if (scope === "dialog") {
        const ds = visibleDialogs();
        roots = ds.length ? [ds[ds.length - 1] as Element] : [];
      }
      const label = (el: Element): string => {
        const aria = el.getAttribute("aria-label");
        if (aria) return clean(aria);
        const by = el.getAttribute("aria-labelledby");
        if (by) {
          const t = by
            .split(/\s+/)
            .map((id) => document.getElementById(id)?.textContent ?? "")
            .join(" ");
          if (clean(t)) return clean(t);
        }
        const inp = el as HTMLInputElement;
        const txt = clean((el as HTMLElement).innerText) || clean(el.textContent);
        if (txt) return txt;
        if (inp.labels && inp.labels.length) return clean(inp.labels[0]?.textContent);
        return clean(el.getAttribute("title") || el.getAttribute("placeholder") || el.querySelector("img")?.getAttribute("alt") || (el as HTMLInputElement).value || "");
      };
      const out: Desc[] = [];
      const seen = new Map<string, number>();
      const els: Element[] = [];
      for (const root of roots) for (const el of Array.from(root.querySelectorAll(selector))) if (!els.includes(el)) els.push(el);
      for (const el of els) {
        if (!isVisible(el)) continue;
        if (el.closest("[inert]")) continue;
        if (el.closest('[aria-label="Intro"]')) continue;
        const tag = el.tagName.toLowerCase();
        const role = el.getAttribute("role") ?? "";
        const type = el.getAttribute("type") ?? "";
        const name = label(el).slice(0, 80);
        const testid = el.getAttribute("data-testid") ?? "";
        const href = el.getAttribute("href") ?? "";
        const firstLine = clean(((el as HTMLElement).innerText || el.textContent || "").split("\n")[0]);
        const stableName = (el.getAttribute("aria-label") ? name : firstLine || name).replace(/[\d.,+\-−–%€$:·/]+/g, "#").slice(0, 40);
        const key = [tag, role, stableName, testid, href].join("|");
        const n = seen.get(key) ?? 0;
        seen.set(key, n + 1);
        const r = el.getBoundingClientRect();
        const dlg = el.closest(DIALOGS);
        const region: Region = dlg ? "dialog" : el.closest("main") ? "main" : el.closest("footer") ? "footer" : "shell";
        const where = dlg
          ? `Dialog ${clean(dlg.getAttribute("aria-label") || dlg.querySelector("h1,h2,h3")?.textContent)}`.slice(0, 60)
          : el.closest("header")
            ? "header"
            : el.closest("aside")
              ? "sidebar"
              : el.closest('[role="toolbar"][aria-label="Navigation"]')
                ? "dock"
                : region === "shell"
                  ? "shell"
                  : region;
        let heading = "";
        for (let p: Element | null = el; p && !heading; p = p.parentElement) {
          const h = p.querySelector(":scope > h1, :scope > h2, :scope > h3, :scope > header h2, :scope > header h3");
          if (h && h.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) heading = clean(h.textContent).slice(0, 60);
          else if (p.getAttribute("aria-labelledby")) heading = clean(document.getElementById(p.getAttribute("aria-labelledby") ?? "")?.textContent).slice(0, 60);
          if (p.tagName === "MAIN" || p.tagName === "BODY") break;
        }
        const reactKey = Object.keys(el).find((k) => k.startsWith("__reactProps$"));
        const props = reactKey ? Object.keys((el as unknown as Record<string, Record<string, unknown>>)[reactKey] ?? {}).filter((k) => /^on[A-Z]/.test(k)) : [];
        const form = (el as HTMLButtonElement).form;
        let formSubmit = false;
        if (form && (type === "submit" || (tag === "button" && type === ""))) {
          const fk = Object.keys(form).find((k) => k.startsWith("__reactProps$"));
          formSubmit = !!(fk && (form as unknown as Record<string, Record<string, unknown>>)[fk]?.onSubmit);
        }
        const selected =
          ["aria-selected", "aria-pressed", "aria-checked", "aria-current"].some((a) => el.getAttribute(a) === "true" || (a === "aria-current" && !!el.getAttribute(a) && el.getAttribute(a) !== "false")) ||
          el.getAttribute("data-checked") === "true" ||
          ["on", "checked", "active", "selected"].includes(el.getAttribute("data-state") ?? "");
        out.push({
          key,
          n,
          tag,
          role,
          type,
          name,
          testid,
          href,
          target: el.getAttribute("target") ?? "",
          rel: el.getAttribute("rel") ?? "",
          disabled: (el as HTMLButtonElement).disabled === true || el.getAttribute("aria-disabled") === "true",
          region,
          where,
          heading,
          rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
          props,
          formSubmit,
          selected,
          expanded: el.getAttribute("aria-expanded") ?? "",
          hiddenFromAt: !!el.closest('[aria-hidden="true"]'),
          focusable: (el as HTMLElement).tabIndex >= 0,
          sig: [tag, role, region, name.replace(/\d+/g, "#").slice(0, 30), testid.replace(/\d+/g, "#")].join("|"),
        });
      }
      return out;
    },
    { selector: INTERACTIVE, scope },
  );
}

/** Tags the n-th element with this key so Playwright can address it; returns false when it is gone. */
async function mark(page: Page, d: Desc, scope: "page" | "dialog"): Promise<boolean> {
  return page.evaluate(
    ({ selector, key, n, scope }) => {
      document.querySelectorAll("[data-audit-target]").forEach((e) => e.removeAttribute("data-audit-target"));
      const DIALOGS = '[role="dialog"],[role="alertdialog"],[aria-modal="true"],[data-vaul-drawer]';
      const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
      const label = (el: Element): string => {
        const aria = el.getAttribute("aria-label");
        if (aria) return clean(aria);
        const by = el.getAttribute("aria-labelledby");
        if (by) {
          const t = by
            .split(/\s+/)
            .map((id) => document.getElementById(id)?.textContent ?? "")
            .join(" ");
          if (clean(t)) return clean(t);
        }
        const inp = el as HTMLInputElement;
        const txt = clean((el as HTMLElement).innerText) || clean(el.textContent);
        if (txt) return txt;
        if (inp.labels && inp.labels.length) return clean(inp.labels[0]?.textContent);
        return clean(el.getAttribute("title") || el.getAttribute("placeholder") || el.querySelector("img")?.getAttribute("alt") || (el as HTMLInputElement).value || "");
      };
      const visible = (el: Element) => {
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) return false;
        const cs = getComputedStyle(el);
        return !(cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) < 0.02);
      };
      let roots: ParentNode[] = [document];
      if (scope === "dialog") {
        const ds = Array.from(document.querySelectorAll(DIALOGS)).filter((d) => visible(d) && d.getAttribute("aria-label") !== "Intro" && !d.closest("[inert]"));
        roots = ds.length ? [ds[ds.length - 1] as Element] : [];
      }
      const all: Element[] = [];
      for (const root of roots) for (const el of Array.from(root.querySelectorAll(selector))) if (!all.includes(el)) all.push(el);
      let seen = 0;
      for (const el of all) {
        if (!visible(el) || el.closest("[inert]") || el.closest('[aria-label="Intro"]')) continue;
        const name = label(el).slice(0, 80);
        const firstLine = clean(((el as HTMLElement).innerText || el.textContent || "").split("\n")[0]);
        const stableName = (el.getAttribute("aria-label") ? name : firstLine || name).replace(/[\d.,+\-−–%€$:·/]+/g, "#").slice(0, 40);
        const k = [el.tagName.toLowerCase(), el.getAttribute("role") ?? "", stableName, el.getAttribute("data-testid") ?? "", el.getAttribute("href") ?? ""].join("|");
        if (k !== key) continue;
        if (seen++ === n) {
          el.setAttribute("data-audit-target", "1");
          return true;
        }
      }
      return false;
    },
    { selector: INTERACTIVE, key: d.key, n: d.n, scope },
  );
}

async function snap(page: Page): Promise<Snap> {
  return page.evaluate(() => {
    const DIALOGS = '[role="dialog"],[role="alertdialog"],[aria-modal="true"],[data-vaul-drawer]';
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      return r.width > 2 && r.height > 2 && getComputedStyle(el).visibility !== "hidden";
    };
    const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
    const dialogs = Array.from(document.querySelectorAll(DIALOGS))
      .filter((d) => visible(d) && d.getAttribute("aria-label") !== "Intro")
      .map((d) => clean(d.getAttribute("aria-label") || d.querySelector("h1,h2,h3")?.textContent).slice(0, 50) || "dialog");
    const toast = Array.from(document.querySelectorAll('[role="status"][aria-live="polite"], [role="alert"]'))
      .map((t) => clean(t.textContent))
      .join(" | ")
      .slice(0, 160);
    const act = document.activeElement as HTMLElement | null;
    const t = document.querySelector('[data-audit-target="1"]') as HTMLElement | null;
    const w = window as unknown as { __aud?: { mut: number } };
    const scope = Array.from(document.querySelectorAll(DIALOGS)).filter((d) => visible(d) && d.getAttribute("aria-label") !== "Intro").pop() ?? document.querySelector("main") ?? document.body;
    const vals = Array.from(scope.querySelectorAll("input, select, textarea"))
      .map((i) => `${(i as HTMLInputElement).type === "checkbox" || (i as HTMLInputElement).type === "radio" ? ((i as HTMLInputElement).checked ? "1" : "0") : ((i as HTMLInputElement).value ?? "")}`)
      .join("\u0001")
      .slice(0, 4000);
    return {
      url: location.href,
      vals,
      dialogs,
      toast,
      scroll: Math.round(window.scrollY),
      active: act && act !== document.body ? `${act.tagName.toLowerCase()}|${clean(act.getAttribute("aria-label") || act.textContent).slice(0, 30)}|${act.getAttribute("data-testid") ?? ""}` : "body",
      mut: w.__aud?.mut ?? 0,
      target: {
        connected: !!t && t.isConnected,
        state: t ? [t.getAttribute("aria-expanded"), t.getAttribute("aria-pressed"), t.getAttribute("aria-selected"), t.getAttribute("aria-checked"), t.getAttribute("data-state"), t.getAttribute("data-checked"), (t as HTMLInputElement).checked, (t as HTMLInputElement).value?.slice?.(0, 20), t.hasAttribute("open"), (t.closest("details") as HTMLDetailsElement | null)?.open ?? "", t.getAttribute("aria-current"), t.closest("[aria-hidden]") ? "h" : ""].join("/") : "",
      },
    };
  });
}

/* ------------------------------------------------------------------------------------------------ restore */

export async function closeOverlays(page: Page, startUrl: string, keep = 0): Promise<void> {
  for (let i = 0; i < 4; i++) {
    const s = await snap(page).catch(() => null);
    if (!s) return;
    if (s.dialogs.length <= keep) break;
    await page.keyboard.press("Escape").catch(() => undefined);
    await page.waitForTimeout(280);
    const again = await snap(page).catch(() => null);
    if (again && again.dialogs.length <= keep) break;
    // a close button of the topmost dialog
    const close = page.locator('[role="dialog"] button[aria-label*="chließen" i], [role="dialog"] button[aria-label*="close" i], [role="dialog"] button:has-text("Schließen"), [role="dialog"] button:has-text("Abbrechen")').last();
    if (await close.isVisible().catch(() => false)) await close.click({ timeout: 1500 }).catch(() => undefined);
    await page.waitForTimeout(280);
  }
  const s = await snap(page).catch(() => null);
  if (s && s.url !== startUrl) {
    const u = new URL(startUrl);
    const cur = new URL(s.url);
    if (u.origin === cur.origin && u.pathname === cur.pathname && u.search === cur.search) {
      await page.evaluate((h) => {
        window.location.hash = h;
      }, u.hash).catch(() => undefined);
    } else {
      await page.goto(startUrl, { waitUntil: "load" }).catch(() => undefined);
    }
    await page.waitForTimeout(350);
  }
}

/* ------------------------------------------------------------------------------------------------ probing */

const SKIP_CLICK: Array<{ re: RegExp; why: string }> = [
  { re: /^(Trade speichern|Speichern|Eintragen|Trade eintragen und|Änderungen speichern)$/i, why: "Speichern/Eintragen: nicht geklickt (Auftrag: Trade-Eintrag nur ansehen, nichts schreiben)" },
  { re: /Zahlungspflichtig bestellen/i, why: "Bestell-Knopf: nicht geklickt (Zahlung läuft nur gegen Fake-Stripe, eigene Spec kaufstrecke)" },
];
const LAST: RegExp = /^(Abmelden|Ausloggen|Logout)/i;

/**
 * A click like a person's: Playwright's own actionability (visible, stable, not covered) first. Two things a person would not
 * trip over are retried once – a hover state left by the previous click (the pointer parked on the sidebar rail keeps its
 * peek open over the page) and an element that never holds still (a pulsing badge) although the point is free.
 */
async function robustClick(page: Page, loc: ReturnType<Page["locator"]>, timeout: number): Promise<void> {
  try {
    await loc.click({ timeout });
    return;
  } catch (e) {
    const msg = String((e as Error).message ?? e);
    if (/intercepts pointer events/.test(msg)) {
      const vp = page.viewportSize() ?? { width: 800, height: 600 };
      await page.mouse.move(Math.round(vp.width / 2), Math.round(vp.height / 2));
      await page.waitForTimeout(600);
      await loc.click({ timeout: 2500 });
      return;
    }
    if (/Timeout/.test(msg) && !/intercepts pointer events/.test(msg)) {
      const free = await loc
        .evaluate((el) => {
          const r = el.getBoundingClientRect();
          const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          return !!hit && (hit === el || el.contains(hit));
        })
        .catch(() => false);
      if (free) {
        await loc.click({ force: true, timeout: 2000 });
        return;
      }
    }
    throw e;
  }
}

/** One reaction summary, shared by the first click and the retry. */
async function clickOnce(page: Page, rec: Recorder, d: Desc, scope: "page" | "dialog", wait: number, baseline: number): Promise<Probe> {
  const t0 = Date.now();
  const found = await mark(page, d, scope);
  if (!found) return { status: "gone", reasons: [], net: [], logs: [], ms: 0, detail: "Element nach vorherigen Klicks nicht mehr auffindbar" };
  const loc = page.locator('[data-audit-target="1"]').first();
  // The audit's own scrolling to the element is NOT a reaction of the element: scroll first, let the page settle, only then take the
  // "before" picture (otherwise every control below the fold would "react" with a scroll – and a dead one would pass).
  if (d.tag !== "select" && d.type !== "file") {
    // the middle of the screen: out of the way of the sticky header, the section strip and the dock, so Playwright has nothing left to scroll
    await page
      .evaluate(() => {
        const t = document.querySelector('[data-audit-target="1"]');
        if (!t) return;
        for (let n: Element | null = t; n && n !== document.body; n = n.parentElement) {
          const pos = getComputedStyle(n).position;
          if (pos === "fixed" || pos === "sticky") return;
        }
        t.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
      })
      .catch(() => undefined);
    await page.waitForTimeout(250);
  }
  const before = await snap(page);
  const wasSelected = await page
    .evaluate(() => {
      const t = document.querySelector('[data-audit-target="1"]');
      if (!t) return false;
      return ["aria-selected", "aria-pressed", "aria-checked"].some((a) => t.getAttribute(a) === "true") || (!!t.getAttribute("aria-current") && t.getAttribute("aria-current") !== "false") || t.getAttribute("data-checked") === "true" || ["on", "checked", "active", "selected"].includes(t.getAttribute("data-state") ?? "");
    })
    .catch(() => false);
  const netMark = rec.net.length;
  const logMark = rec.logs.length;
  const popMark = rec.popups.length;
  const dlMark = rec.downloads.length;
  const reasons: string[] = [];
  let clickError = "";
  let isInput = false;
  let toastText = "";
  try {
    if (d.tag === "select") {
      isInput = true;
      const opts = await loc.evaluate((s: HTMLSelectElement) => Array.from(s.options).map((o) => o.value));
      const cur = await loc.inputValue();
      const next = opts.find((o) => o !== cur);
      if (next === undefined) throw new Error("select hat nur eine Option");
      await loc.selectOption(next, { timeout: 3000 });
      await page.waitForTimeout(wait);
      await loc.selectOption(cur, { timeout: 3000 }).catch(() => undefined);
    } else if ((d.tag === "input" && !["checkbox", "radio", "button", "submit", "range", "file", "color"].includes(d.type)) || d.tag === "textarea") {
      isInput = true;
      await loc.click({ timeout: 3000 });
      const old = await loc.inputValue().catch(() => "");
      if (d.type === "number" || d.type === "date" || d.type === "time") {
        await page.keyboard.press("ArrowUp").catch(() => undefined);
      } else {
        await page.keyboard.type("a", { delay: 10 });
      }
      await page.waitForTimeout(wait);
      const now = await loc.inputValue().catch(() => old);
      if (now === old) reasons.push("eingabe-ohne-wirkung");
      else reasons.push("eingabe");
      await loc.fill(old).catch(() => undefined);
      await page.keyboard.press("Escape").catch(() => undefined);
    } else if (d.type === "file") {
      throw new Error("Dateiauswahl: nicht geklickt");
    } else {
      await robustClick(page, loc, 3500);
      await page.waitForTimeout(wait);
    }
  } catch (e) {
    // eslint-disable-next-line no-control-regex
    clickError = String((e as Error).message ?? e).replace(/\u001b\[[0-9;]*m/g, "").split("\n").map((l) => l.trim().replace(/<[^<>]*>/g, "<el>")).filter(Boolean).slice(0, 14).join(" ").slice(0, 700);
  }
  let after: Snap | null = null;
  try {
    after = await snap(page);
  } catch {
    reasons.push("seite-neu-geladen");
  }
  const net = rec.appRequestsSince(netMark);
  const logs = rec.logs.slice(logMark).map((l) => `${l.type}: ${l.text}`);
  const popup = rec.popups.length > popMark ? rec.popups[rec.popups.length - 1] : undefined;
  const download = rec.downloads.length > dlMark ? rec.downloads[rec.downloads.length - 1] : undefined;
  const ms = Date.now() - t0;
  if (clickError) {
    const covered = /intercepts pointer events|not receive pointer events|outside of the viewport|not visible|element is not stable/i.test(clickError);
    return { status: covered ? "covered" : "click-error", reasons, detail: clickError, net: net.map(netLine), logs, ms };
  }
  if (after) {
    if (after.url !== before.url) reasons.push("url");
    if (after.dialogs.join("|") !== before.dialogs.join("|")) reasons.push(after.dialogs.length > before.dialogs.length ? "dialog-auf" : "dialog-zu/gewechselt");
    if (after.toast !== before.toast) {
      reasons.push("toast");
      toastText = after.toast;
    }
    if (after.target.state !== before.target.state || after.target.connected !== before.target.connected) reasons.push("zustand");
    if (after.vals !== before.vals) reasons.push("feldwerte");
    if (Math.abs(after.scroll - before.scroll) > 8) reasons.push("scroll");
    if (isInput && after.active !== before.active) reasons.push("fokus");
    if (after.mut - before.mut > baseline * 1.6 + 4) reasons.push("dom");
  }
  if (net.length) reasons.push("netz");
  // a request to a market feed (Binance / Bybit / OKX: mocked or blocked in the audit world) started by the click is a reaction too
  if (rec.net.slice(netMark).some((e) => e.external)) reasons.push("netz-extern");
  if (popup !== undefined) reasons.push("neuer-tab");
  if (download !== undefined) reasons.push("download");
  if (isInput) return { status: reasons.includes("eingabe") || reasons.includes("zustand") ? "input-ok" : "input-dead", reasons, net: net.map(netLine), logs, ms, popup, download };
  return { wasSelected, status: reasons.length ? "ok" : "dead-candidate", reasons, net: net.map(netLine), logs, ms, popup, download, detail: toastText ? `Toast: ${toastText}` : after && after.url !== before.url ? `→ ${after.url.replace(/^https?:\/\/[^/]+/, "")}` : undefined };
}

const netLine = (e: NetEvent): string => `${e.method} ${e.url} → ${e.status ?? e.failed ?? "?"}${e.ct === "text/html" && /\/api\/v1\//.test(e.url) ? " (HTML-Fallback: Funktion nicht gemockt/deployt)" : ""}`;

export interface CrawlOptions {
  scope: "page" | "dialog";
  max: number;
  /** skip the shell (header / sidebar / dock): it is crawled once per persona and viewport, on the first screen */
  skipShell: boolean;
  /** crawl ONLY the shell (the one-off crawl of header, sidebar and dock, with a budget of its own) */
  onlyShell?: boolean;
  /** milliseconds the whole crawl of this screen may take */
  budgetMs: number;
  wait: number;
  /** names (RegExp source) of elements that are not clicked in this screen */
  skip?: RegExp;
  /** puts an overlay screen back after a click closed it (the dialog scope would otherwise end after the first link) */
  reopen?: () => Promise<boolean>;
}

/** Idle DOM churn per `wait` window (live tickers, marquees): what a click's mutations are compared against. */
export async function idleChurn(page: Page, wait: number): Promise<number> {
  const a = await snap(page);
  await page.waitForTimeout(wait);
  const b = await snap(page);
  return Math.max(0, b.mut - a.mut);
}

export async function crawlScreen(page: Page, rec: Recorder, startUrl: string, o: CrawlOptions): Promise<{ elements: ElementResult[]; interactive: number }> {
  const all = await collect(page, o.scope);
  const list = o.onlyShell ? all.filter((d) => d.region === "shell") : o.skipShell ? all.filter((d) => d.region !== "shell") : all;
  // sample equal siblings: first, middle, last of a group of more than three
  const groups = new Map<string, Desc[]>();
  for (const d of list) groups.set(d.sig, [...(groups.get(d.sig) ?? []), d]);
  const chosen = new Map<Desc, number>();
  for (const g of groups.values()) {
    if (g.length <= 3) g.forEach((d) => chosen.set(d, 1));
    else {
      const pick = [g[0], g[Math.floor(g.length / 2)], g[g.length - 1]] as Desc[];
      pick.forEach((d, i) => chosen.set(d, i === 0 ? g.length - 2 : 1));
    }
  }
  const order = list.filter((d) => chosen.has(d));
  // the last one (logout) goes last
  order.sort((a, b) => Number(LAST.test(a.name)) - Number(LAST.test(b.name)));
  const crawlT0 = Date.now();
  const baseline = await idleChurn(page, o.wait);
  const deadline = Date.now() + o.budgetMs;
  const keep = o.scope === "dialog" ? (await snap(page)).dialogs.length : 0;
  const initialKeys = new Set(list.map((d) => d.key));
  const resetOverlay = async (): Promise<void> => {
    await closeOverlays(page, startUrl, 0);
    if (o.reopen) await o.reopen();
  };
  /** puts the screen back: nested overlays closed, URL restored, the overlay reopened when a click closed or reshaped it */
  const restore = async (): Promise<void> => {
    await closeOverlays(page, startUrl, keep);
    if (o.scope === "dialog" && o.reopen) {
      const n = (await snap(page).catch(() => null))?.dialogs.length ?? 0;
      if (n < keep) await o.reopen();
    }
    // did the click reshape the screen (a settings view inside the dialog, a tab that swaps the page body)? then start it afresh
    const now = await collect(page, o.scope).catch(() => []);
    const kept = now.filter((d) => initialKeys.has(d.key)).length;
    if (initialKeys.size > 4 && kept < initialKeys.size * 0.7) {
      if (o.scope === "dialog" && o.reopen) await resetOverlay();
      else if (o.scope === "page") {
        await page.reload({ waitUntil: "load" }).catch(() => undefined);
        await page.waitForTimeout(1500);
      }
    }
  };
  const results: ElementResult[] = [];
  let count = 0;
  for (const d of order) {
    const represents = chosen.get(d) ?? 1;
    if (count >= o.max || Date.now() > deadline) {
      results.push({ desc: d, probe: null, represents, skipReason: count >= o.max ? "über der Obergrenze je Bildschirm" : "Zeitbudget des Bildschirms erschöpft" });
      continue;
    }
    if (d.disabled) {
      results.push({ desc: d, probe: { status: "disabled", reasons: [], net: [], logs: [], ms: 0 }, represents });
      continue;
    }
    const skip = SKIP_CLICK.find((s) => s.re.test(d.name)) ?? (o.skip && o.skip.test(d.name) ? { why: "für diesen Bildschirm ausgenommen" } : undefined);
    if (skip) {
      results.push({ desc: d, probe: { status: "not-clicked", reasons: [], net: [], logs: [], ms: 0, detail: skip.why }, represents, skipReason: skip.why });
      continue;
    }
    count++;
    rec.step = `${d.where}:${d.name.slice(0, 30)}`;
    let probe = await clickOnce(page, rec, d, o.scope, o.wait, baseline);
    if (probe.status === "dead-candidate") {
      // second chance: longer wait, after the page settled – a click right after a re-render can lose its handler for a frame
      await restore();
      probe = { ...(await clickOnce(page, rec, d, o.scope, o.wait * 2.5, baseline)), retried: true };
      if (probe.status === "dead-candidate" && (d.selected || probe.wasSelected)) probe = { ...probe, status: "noop-active", detail: "bereits aktiv (aria-selected / pressed / current): kein Effekt erwartet" };
      // a React click handler exists but nothing showed: a no-op on purpose (empty field, same choice, data not loaded) is possible – a human decides.
      // No handler at all and no effect is the real dead element.
      else if (probe.status === "dead-candidate" && (d.props.some((x) => /^on(Click|PointerDown|PointerUp|MouseDown|MouseUp|TouchStart)$/.test(x)) || d.formSubmit)) probe = { ...probe, status: "no-effect-handler", detail: "Handler vorhanden (React-Prop), aber kein sichtbarer Effekt: Leerlauf bei leerem Zustand / gleicher Auswahl möglich, manuell prüfen" };
    }
    if ((probe.status === "click-error" || probe.status === "covered" || probe.status === "gone") && !probe.retried) {
      // a click that fails right after other clicks may fail because the page is still settling (a morph, a slide, a pulse): one more
      // try on a fresh load of the screen. Only what fails there too is reported as a defect.
      if (o.scope === "dialog" && o.reopen) {
        await closeOverlays(page, startUrl, 0);
        await page.goto(startUrl, { waitUntil: "load" }).catch(() => undefined);
        await page.waitForTimeout(2200);
        await o.reopen();
      } else {
        await page.goto(startUrl, { waitUntil: "load" }).catch(() => undefined);
        await page.waitForTimeout(2200);
        await page.evaluate(async () => {
          for (let y = 0; y < Math.min(document.documentElement.scrollHeight, 6000); y += Math.round(window.innerHeight * 0.8)) {
            window.scrollTo({ top: y, behavior: "instant" });
            await new Promise((r) => setTimeout(r, 90));
          }
          window.scrollTo({ top: 0, behavior: "instant" });
        });
        await page.waitForTimeout(300);
      }
      probe = { ...(await clickOnce(page, rec, d, o.scope, o.wait * 2, baseline)), retried: true };
    }
    results.push({ desc: d, probe, represents });
    await restore();
    if (process.env.PW_AUDIT_DEBUG) {
      const sn = await snap(page).catch(() => null);
      console.log(`[audit] +${Math.round((Date.now() - crawlT0) / 1000)}s ${d.where} | ${d.name.slice(0, 40)} → ${probe.status} ${probe.reasons.join(",")} | dialogs after restore: ${sn?.dialogs.length} keep=${keep} url=${sn?.url.slice(-30)}`);
    }
    if (probe.status === "gone" || probe.status === "click-error" || probe.status === "covered") {
      // the screen may have shifted under us: settle
      await page.waitForTimeout(150);
    }
  }
  return { elements: results, interactive: all.length };
}

/* ------------------------------------------------------------------------------------------------ passive checks */

export async function overflowX(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - Math.min(window.innerWidth, document.documentElement.clientWidth));
}

export async function hitMisses(page: Page, scope: "page" | "dialog"): Promise<HitBoxMiss[]> {
  const root = scope === "dialog" ? '[role="dialog"]:last-of-type' : undefined;
  try {
    return await page.evaluate(auditHitBoxes, { selector: HIT_SELECTOR, root, min: 44 });
  } catch {
    return [];
  }
}

/** Keyboard walk: Tab through the screen, note names, whether the focused element shows a ring, and whether focus got trapped. */
export async function tabWalk(page: Page, max: number): Promise<TabWalk> {
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur?.();
    window.scrollTo({ top: 0, behavior: "instant" });
  });
  const style = (): Promise<{ id: string; sig: string; name: string }> =>
    page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return { id: "body", sig: "", name: "body" };
      const cs = getComputedStyle(el);
      const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
      const name = clean(el.getAttribute("aria-label") || el.innerText || el.getAttribute("placeholder") || el.getAttribute("title")).slice(0, 40) || el.tagName.toLowerCase();
      el.setAttribute("data-audit-tab", "1");
      const ring = `${cs.outlineStyle}/${cs.outlineWidth}/${cs.outlineColor}/${cs.boxShadow}/${cs.borderColor}/${cs.backgroundColor}/${cs.textDecorationLine}`;
      return { id: `${el.tagName.toLowerCase()}|${name}|${Math.round(el.getBoundingClientRect().x)}|${Math.round(el.getBoundingClientRect().y)}`, sig: ring, name };
    });
  const blurred = (): Promise<string> =>
    page.evaluate(() => {
      const el = document.querySelector('[data-audit-tab="1"]') as HTMLElement | null;
      if (!el) return "";
      el.removeAttribute("data-audit-tab");
      const cs = getComputedStyle(el);
      return `${cs.outlineStyle}/${cs.outlineWidth}/${cs.outlineColor}/${cs.boxShadow}/${cs.borderColor}/${cs.backgroundColor}/${cs.textDecorationLine}`;
    });
  const reached: string[] = [];
  const noRing: string[] = [];
  const seen = new Set<string>();
  let trapped = false;
  let streak = 0;
  for (let i = 0; i < max; i++) {
    await page.keyboard.press("Tab");
    const cur = await style();
    if (cur.id === "body") break;
    if (seen.has(cur.id)) {
      // focus came back to an element it already visited: a wrap-around (end of the page) or a trap – a trap shows as the same
      // two or three elements over and over before the walk saw a dozen different ones
      streak++;
      if (streak >= 3 && seen.size < 12) trapped = true;
      if (streak >= 3 || trapped) break;
      continue;
    }
    streak = 0;
    seen.add(cur.id);
    reached.push(cur.name);
    // the look of the element without focus: blur it and compare (Chromium continues from the blurred element's position)
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
    const off = await blurred();
    if (off && off === cur.sig) noRing.push(cur.name);
  }
  return { steps: reached.length, reachedNames: reached, withoutFocusRing: noRing, trapped, unreached: [] };
}
