/**
 * What opening a search hit does (P13). Every action really goes somewhere – nothing is a dead end:
 *   - trade   → the trade detail (detached source: it opens over whatever page is shown),
 *   - setup   → the Setups page, scrolled to that card with a signal sweep (hidden by a filter → its editor),
 *   - day     → the Übersicht, the calendar opens that day,
 *   - page    → the page,
 *   - setting → the settings page, scrolled to the card with that title + sweep,
 *   - report  → the Berichte page on that period (only indexed once the page exists),
 *   - command → the command.
 */
import { closeCommandNav, openCommandNav } from "@/app/CommandNav";
import { toggleFullscreen } from "@/app/pwa";
import { openShortcutSheet } from "@/app/shortcuts";
import { replayIntro } from "@/intro/introStore";
import { tween } from "@/motion/tokens";
import { prefersReducedMotion } from "@/motion/pulse/engine";
import { startOnboarding } from "@/onboarding/onboardingStore";
import { exportCsv, exportJson } from "@/store/backup";
import { navigate } from "@/store/router";
import { toggleTheme, useTheme } from "@/store/themeStore";
import { DEFAULT_TRADE_EXTRA, DEFAULT_TRADE_FILTER, PAGES, pushToast, useUi, type Page } from "@/store/uiStore";
import { openReport } from "@/views/berichte/berichteStore";
import { useInsightsUi } from "@/views/insights/insightsStore";
import type { CommandId, SearchAction } from "./sources";

const isPage = (p: string): p is Page => (PAGES as readonly string[]).includes(p);

/** Polls (rAF, ≤ 2.5 s) until `find` returns an element of the current page layer, then runs `then`. */
export function whenShown(page: string, find: (layer: Element) => HTMLElement | null, then: (el: HTMLElement) => void, onMiss?: () => void): void {
  if (typeof document === "undefined") return;
  const deadline = performance.now() + 2500;
  const tick = () => {
    const layer = document.querySelector(`[data-page="${page}"][data-page-role="current"]`) ?? (document.querySelector("[data-page]") ? null : document.body);
    const el = layer ? find(layer) : null;
    if (el) {
      then(el);
      return;
    }
    if (performance.now() < deadline) requestAnimationFrame(tick);
    else onMiss?.();
  };
  requestAnimationFrame(tick);
}

/** Scrolls `el` under the header and runs one signal sweep across its card (decorative, removed after). */
export function revealCard(el: HTMLElement): void {
  const reduced = prefersReducedMotion();
  el.scrollIntoView({ block: "start", behavior: reduced ? "auto" : "smooth" });
  const card = el.closest<HTMLElement>(".rounded-2xl, [class*='rounded-[']") ?? el;
  if (reduced || typeof card.animate !== "function") return;
  const sweep = document.createElement("span");
  sweep.setAttribute("aria-hidden", "true");
  Object.assign(sweep.style, {
    position: "absolute",
    inset: "0",
    zIndex: "30",
    pointerEvents: "none",
    borderRadius: "inherit",
    background: "linear-gradient(100deg, transparent 35%, color-mix(in srgb, var(--color-signal) 18%, transparent) 50%, transparent 65%)",
    transform: "translateX(-100%)",
  } satisfies Partial<CSSStyleDeclaration>);
  if (getComputedStyle(card).position === "static") card.style.position = "relative";
  card.appendChild(sweep);
  const a = sweep.animate([{ transform: "translateX(-100%)" }, { transform: "translateX(100%)" }], { duration: tween.sweep.duration * 1000, delay: 250, easing: "cubic-bezier(0.22,1,0.36,1)", fill: "forwards" });
  a.onfinish = () => sweep.remove();
  a.oncancel = () => sweep.remove();
}

const headingWith = (title: string) => (layer: Element) =>
  Array.from(layer.querySelectorAll<HTMLElement>("h2, h3")).find((h) => (h.textContent ?? "").replace(/\s+/g, " ").trim().startsWith(title)) ?? null;

function goPage(page: string): boolean {
  if (!isPage(page)) return false;
  navigate(page);
  return true;
}

function runCommand(id: CommandId): void {
  const ui = useUi.getState();
  switch (id) {
    case "new-trade":
      ui.openEditor();
      return;
    case "new-setup":
      ui.openSetupEditor();
      return;
    case "theme-toggle":
      toggleTheme();
      return;
    case "theme-light":
    case "theme-dark":
    case "theme-system":
      useTheme.getState().setPref(id === "theme-light" ? "light" : id === "theme-dark" ? "dark" : "system");
      return;
    case "shortcuts":
      openShortcutSheet();
      return;
    case "tour":
      startOnboarding();
      return;
    case "intro":
      navigate("overview");
      replayIntro();
      return;
    case "export-json":
      void exportJson().then((ok) => {
        if (!ok) pushToast({ kind: "error", title: "Export nicht möglich", detail: "Dieser Browser erlaubt hier keinen Download." });
      });
      return;
    case "export-csv":
      void exportCsv().then((ok) => {
        if (!ok) pushToast({ kind: "error", title: "Export nicht möglich", detail: "Dieser Browser erlaubt hier keinen Download." });
      });
      return;
    case "filter-top":
      ui.applyTradeView({ filter: DEFAULT_TRADE_FILTER, extra: { ...DEFAULT_TRADE_EXTRA, rMin: 2 }, sort: { k: "r", dir: -1 } });
      navigate("trades");
      return;
    case "filter-winners":
    case "filter-losers":
    case "filter-open":
      ui.applyTradeView({
        filter: { ...DEFAULT_TRADE_FILTER, result: id === "filter-winners" ? "win" : id === "filter-losers" ? "loss" : "open" },
        extra: DEFAULT_TRADE_EXTRA,
        sort: id === "filter-winners" ? { k: "pnl", dir: -1 } : id === "filter-losers" ? { k: "pnl", dir: 1 } : { k: "date", dir: -1 },
      });
      navigate("trades");
      return;
    case "filter-reset":
      ui.resetTradeFilter();
      navigate("trades");
      return;
    case "nav":
      openCommandNav();
      return;
    case "fullscreen":
      void toggleFullscreen();
      return;
  }
}

/** Runs a hit (after the overlay has closed). */
export function runSearchAction(a: SearchAction): void {
  closeCommandNav(true);
  switch (a.type) {
    case "trade":
      useUi.getState().openDetail(a.id, "insights");
      return;
    case "page":
      goPage(a.page);
      return;
    case "setup":
      navigate("setups");
      whenShown("setups", (layer) => layer.querySelector<HTMLElement>(`[data-testid="setup-card-${CSS.escape(a.id)}"]`), revealCard, () => useUi.getState().openSetupEditor({ setupId: a.id }));
      return;
    case "day":
      navigate("overview");
      useInsightsUi.getState().focusDay(a.key);
      return;
    case "setting":
      navigate("settings");
      whenShown("settings", headingWith(a.title), revealCard);
      return;
    case "report":
      if (goPage("berichte")) openReport(a.key);
      return;
    case "command":
      runCommand(a.id);
      return;
  }
}
