import type { TradeFilter } from "@/domain/types";
import { useJournal } from "./journalStore";
import { DEFAULT_TRADE_FILTER, PAGES, useUi, type Page } from "./uiStore";

export { PAGES, PAGE_KEYS, DEFAULT_TRADE_FILTER } from "./uiStore";
export type { Page } from "./uiStore";

export interface Route {
  page: Page;
  /** Only present for `#trades?…` deep links (parsed query, defaults filled in). */
  filter?: TradeFilter;
}

const RESULTS = new Set<TradeFilter["result"]>(["all", "win", "loss", "open", "be"]);
const SIDES = new Set<TradeFilter["side"]>(["all", "long", "short"]);
const ACCS = new Set<TradeFilter["acc"]>(["all", "makro", "scalp"]);
export const Q_MAX = 200;
export const Q_DEBOUNCE_MS = 150;

function isPage(v: string): v is Page {
  return (PAGES as readonly string[]).includes(v);
}

/**
 * Hash grammar `#{page}[?{query}]` (Plan 1.4). Unknown page → `overview` and the query is dropped.
 * Query is read only for `trades`; every invalid value falls back to its `y0` default individually.
 * `knownSetupIds`: unknown setup ids → `all` (omit to accept any id).
 */
export function parseHash(hash: string, knownSetupIds?: readonly string[]): Route {
  const h = hash.startsWith("#") ? hash.slice(1) : hash;
  const [pageRaw = "", queryRaw = ""] = h.split("?");
  if (!isPage(pageRaw)) return { page: "overview" };
  if (pageRaw !== "trades") return { page: pageRaw };
  if (!queryRaw) return { page: "trades" };

  const p = new URLSearchParams(queryRaw);
  const filter: TradeFilter = { ...DEFAULT_TRADE_FILTER };
  const setup = p.get("setup");
  if (setup === "all" || setup === "__none") filter.setup = setup;
  else if (setup && (!knownSetupIds || knownSetupIds.includes(setup))) filter.setup = setup;
  const result = p.get("result");
  if (result && RESULTS.has(result as TradeFilter["result"])) filter.result = result as TradeFilter["result"];
  const side = p.get("side");
  if (side && SIDES.has(side as TradeFilter["side"])) filter.side = side as TradeFilter["side"];
  const acc = p.get("acc");
  if (acc && ACCS.has(acc as TradeFilter["acc"])) filter.acc = acc as TradeFilter["acc"];
  const q = p.get("q");
  if (q) filter.q = q.slice(0, Q_MAX);
  return { page: "trades", filter };
}

/** Builds `#page` or `#trades?…` with non-default filter values only (sort never goes into the URL). */
export function buildHash(page: Page, filter?: Partial<TradeFilter>): string {
  if (page !== "trades" || !filter) return `#${page}`;
  const p = new URLSearchParams();
  const f = { ...DEFAULT_TRADE_FILTER, ...filter };
  if (f.setup !== DEFAULT_TRADE_FILTER.setup) p.set("setup", f.setup);
  if (f.result !== DEFAULT_TRADE_FILTER.result) p.set("result", f.result);
  if (f.side !== DEFAULT_TRADE_FILTER.side) p.set("side", f.side);
  if (f.acc !== DEFAULT_TRADE_FILTER.acc) p.set("acc", f.acc);
  if (f.q) p.set("q", f.q.slice(0, Q_MAX));
  const query = p.toString();
  return query ? `#trades?${query}` : "#trades";
}

/* ------------------------------------------------------------ scroll memory */

const scroll: Partial<Record<Page, number>> = {};
const visited = new Set<Page>();

export function getScroll(page: Page): number | undefined {
  return scroll[page];
}

function rememberScroll(page: Page): void {
  if (typeof window === "undefined") return;
  scroll[page] = window.scrollY;
}

/**
 * Restores the remembered position of `page` (after mount, in `requestAnimationFrame`);
 * first visit or `forceTop` → top 0 with `behavior:"auto"` (page switch already animates).
 */
export function restoreScroll(page: Page, forceTop = false): void {
  if (typeof window === "undefined") return;
  const top = forceTop || !visited.has(page) ? 0 : (scroll[page] ?? 0);
  visited.add(page);
  const run = () => window.scrollTo({ top, behavior: "auto" });
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(run);
  else run();
}

/* -------------------------------------------------------------- navigation */

function knownSetupIds(): string[] {
  return useJournal.getState().settings.setups.map((s) => s.id);
}

function replaceHash(hash: string): void {
  if (typeof history === "undefined" || typeof location === "undefined") return;
  if (location.hash === hash) return;
  try {
    history.replaceState(null, "", hash);
  } catch {
    /* ignore */
  }
}

function pushHash(hash: string): void {
  if (typeof history === "undefined" || typeof location === "undefined") return;
  if (location.hash === hash) return;
  try {
    history.pushState(null, "", hash);
  } catch {
    /* ignore */
  }
}

let applying = false;

/** Applies a parsed route to the UI store: the URL query wins over `uiStore.tradeFilter`. */
function applyRoute(route: Route): void {
  const ui = useUi.getState();
  const prev = ui.page;
  applying = true;
  try {
    if (route.filter) ui.setTradeFilter(route.filter);
    if (prev !== route.page) {
      rememberScroll(prev);
      ui.setPage(route.page);
    }
  } finally {
    applying = false;
  }
  restoreScroll(route.page, Boolean(route.filter));
}

/**
 * Tab switch (`history.pushState`, back button changes the tab). With `query` the filter is set
 * AND the URL carries it (`Alle Trades mit dieser Grundlage →`). Leaving `trades` keeps the filter in
 * the store; the target hash has no query.
 */
export function navigate(page: Page, query?: Partial<TradeFilter>): void {
  const ui = useUi.getState();
  const prev = ui.page;
  if (page === "trades" && query) ui.setTradeFilter(query);
  const hash = buildHash(page, page === "trades" ? useUi.getState().tradeFilter : undefined);
  if (prev !== page) {
    rememberScroll(prev);
    ui.setPage(page);
    pushHash(hash);
    restoreScroll(page, Boolean(query));
  } else {
    replaceHash(hash);
    if (query) restoreScroll(page, true);
  }
}

/** Current route from `location.hash` (validated against the known setups). */
export function currentRoute(): Route {
  return parseHash(typeof location === "undefined" ? "" : location.hash, knownSetupIds());
}

/**
 * Installs the hash router: initial parse (query wins over the store), `hashchange` listener
 * (back/forward), and a store subscription that mirrors filter changes on the trades page into the
 * URL via `replaceState` (`q` debounced 150 ms, no history entry). Returns an uninstall function.
 */
export function installRouter(): () => void {
  if (typeof window === "undefined") return () => {};

  applyRoute(currentRoute());
  replaceHash(buildHash(useUi.getState().page, useUi.getState().page === "trades" ? useUi.getState().tradeFilter : undefined));

  const onHashChange = () => applyRoute(currentRoute());
  window.addEventListener("hashchange", onHashChange);

  let qTimer: ReturnType<typeof setTimeout> | null = null;
  const unsubscribe = useUi.subscribe((state, prev) => {
    if (applying || state.page !== "trades" || state.tradeFilter === prev.tradeFilter) return;
    const a = state.tradeFilter;
    const b = prev.tradeFilter;
    const onlyQ = a.setup === b.setup && a.result === b.result && a.side === b.side && a.acc === b.acc;
    const write = () => replaceHash(buildHash("trades", useUi.getState().tradeFilter));
    if (qTimer) clearTimeout(qTimer);
    if (onlyQ) qTimer = setTimeout(write, Q_DEBOUNCE_MS);
    else write();
  });

  return () => {
    window.removeEventListener("hashchange", onHashChange);
    unsubscribe();
    if (qTimer) clearTimeout(qTimer);
  };
}
