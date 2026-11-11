/**
 * What opening a search hit does (P13). Every action really goes somewhere – nothing is a dead end:
 *   - trade   → the trade detail (detached source: it opens over whatever page is shown),
 *   - setup   → the Setups page, scrolled to that card with a signal sweep (hidden by a filter → its editor),
 *   - day     → the Übersicht, the calendar opens that day,
 *   - page    → the page,
 *   - feature → a function of the register (`src/app/features.ts`): its page, scrolled to the card – or its sheet,
 *   - setting → the settings page, scrolled to the card with that title + sweep,
 *   - report  → the Berichte page on that period (only indexed once the page exists),
 *   - command → the command.
 */
import { closeCommandNav, openCommandNav } from "@/app/CommandNav";
import { revealCard, whenShown } from "@/app/reveal";
import { toggleFullscreen } from "@/app/pwa";
import { openShortcutSheet } from "@/app/shortcuts";
import { replayIntro } from "@/intro/introStore";
import { startOnboarding } from "@/onboarding/onboardingStore";
import { exportCsv, exportJson } from "@/store/backup";
import { navigate } from "@/store/router";
import { toggleTheme, useTheme } from "@/store/themeStore";
import { DEFAULT_TRADE_EXTRA, DEFAULT_TRADE_FILTER, PAGES, pushToast, useUi, type Page } from "@/store/uiStore";
import { openReport } from "@/views/berichte/berichteStore";
import { useInsightsUi } from "@/views/insights/insightsStore";
import type { CommandId, SearchAction } from "./sources";

export { revealCard, whenShown };

const isPage = (p: string): p is Page => (PAGES as readonly string[]).includes(p);

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
    case "feature":
      // the register is a lazy chunk of its own (search + page + assistant); the recent list was written by the overlay
      void import("@/app/featureOpen").then((m) => m.openFeature(a.id, { remember: false }));
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
