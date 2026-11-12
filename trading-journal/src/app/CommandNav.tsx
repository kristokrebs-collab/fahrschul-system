/**
 * Full-screen command navigation (pulse-motion `immersive-full-screen-navigation`, exact timings): ⌘K / Ctrl+K or
 * the header menu button opens a black panel that wipes in from the left (800 ms, cubic-bezier(.76,0,.24,1); the
 * shell translates in, its content counter-translates, so the wipe is transform-only), then the brand block, the
 * page links with live counts, the quick actions (plus `Vollbild` / `App installieren` where the browser offers them, and
 * the install / Samsung dark-mode hints) and the hint row fade up 24 px in the pack's stagger (650 ms,
 * cubic-bezier(.22,1,.36,1)). Closing wipes the panel away to the right with its content still visible.
 *
 * Dialog behaviour: role=dialog, aria-modal, aria-label "Navigation", focus trap, Escape, scroll lock, inert page
 * (applied after the open wipe, released after the close wipe – never in the first frames of either), focus return.
 * Focus starts on the close button; arrow keys / Home / End move between the entries, 1–9 jump to a page (1–5 are the dock tabs in the dock's order, then Handelsplan, Aktien, Risiko, Analyse). Unmounted while closed, so none of its
 * texts exist in the page otherwise.
 */
import { AnimatePresence, motion, type Transition, type Variants } from "motion/react";
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode, type RefObject } from "react";
import { Burger } from "@/app/Burger";
import { GlyphFullscreen } from "@/app/DisplayActions";
import type { FeatureChip } from "@/app/featureChips";
import { NAV_GROUP_ICON, NAV_GROUPS, NAV_GROUP_LABELS, PAGE_HINT, PAGE_ICON, PAGE_LABELS, WIDE_QUERY } from "@/app/navGroups";
import { NavFinder } from "@/app/NavFinder";
import { preloadPage } from "@/app/pages";
import { DISPLAY_STRINGS, isIosSafari, isSamsungInternet, promptInstall, toggleFullscreen, useCanInstall, useFullscreen, useFullscreenSupported, useStandalone } from "@/app/pwa";
import { useLivePriceText, usePageCounts, useShellStats } from "@/app/shellStats";
import { GlyphSpark } from "@/assistant/icons";
import { openAssistant } from "@/assistant/open";
import { cloudEnabled } from "@/cloud/env";
import { ensureCloud } from "@/cloud/runtime";
import { useCloudSession } from "@/cloud/session";
import { useSyncStatus } from "@/cloud/sync/status";
import { cn } from "@/lib/cn";
import { IS_FILE_BUILD, isFileProtocol } from "@/edition";
import { useDialogBehaviour, useTouchMoveGuard } from "@/motion/a11y";
import { NoLayoutCascade } from "@/motion/NoLayoutCascade";
import { flingExit, useSwipeDismiss, type SwipeDismiss, type SwipeDismissInfo } from "@/motion/physics";
import { ease, tween } from "@/motion/tokens";
import { useMediaQuery } from "@/motion/useMediaQuery";
import { useReducedFx } from "@/motion/useReducedFx";
import { DotFigure } from "@/primitives/DotUnit";
import { Icon } from "@/primitives/icons";
import { openSearch, useSearch } from "@/search/searchStore";
import { exportCsv, exportJson } from "@/store/backup";
import { canDownload } from "@/store/download";
import { navigate } from "@/store/router";
import { toggleTheme, useTheme } from "@/store/themeStore";
import { readJson, storageKey, writeJson } from "@/store/storage";
import { LegalLinks } from "@/legal/LegalLinks";
import { NAV_ORDER, PAGES, pushToast, useUi, type Page } from "@/store/uiStore";
import { useViews } from "@/store/viewsStore";
import { create } from "zustand";

export const CONFIG = {
  /** the wipe from the left (the header's menu button, from 768 px) keeps the pack's measured timing */
  wipeMs: 800,
  wipeEase: [0.76, 0, 0.24, 1],
  /**
   * Runde 10: the staggered entrance is tightened from "up to 1.8 s until the last link starts" (2.3 s for the live price) to
   * 0.6 s: the items start while the panel is still arriving (a spring-up sheet on a phone, the wipe on a wide screen), one
   * 14 ms beat per page, and each one rises 16 px in 0.46 s instead of 24 px in 0.65 s.
   */
  itemMs: 460,
  itemEase: [0.22, 1, 0.36, 1],
  lift: 16,
  /**
   * ms after the open: brand block and the finder, the page links (one beat of 14 ms per page, in the order of the groups),
   * the quick actions, the saved views, the hint row, the live price – the last one starts at 0.6 s
   */
  delays: {
    brand: 140,
    finder: 160,
    links: Array.from({ length: PAGES.length }, (_, i) => 200 + i * 14),
    actions: [180, 210, 240, 270, 300, 330, 360, 390],
    display: 400,
    views: 420,
    hints: 540,
    price: 600,
  },
  /** the phone's bottom sheet: it rises on this spring (`spring.sheet` is 320/32; this one is a touch softer and lands without a bounce) */
  sheet: { type: "spring", stiffness: 280, damping: 32 },
} as const;
/** The latest start of any item (ms): the contract of "the menu is there within 0.6 s". */
export const MENU_BUDGET_MS = 600;

export const COMMAND_NAV_ID = "command-nav";
export const COMMAND_NAV_LABEL = "Navigation";
export const COMMAND_NAV_STRINGS = {
  close: "Navigation schließen",
  brand: "Trade Journal",
  claim: "Disziplin schlägt Gefühl.",
  pages: "Seiten",
  actions: "Schnellaktionen",
  newTrade: "Trade eintragen",
  search: "Suchen",
  themeLight: "Hell",
  themeDark: "Dunkel",
  sync: "Jetzt synchronisieren",
  synced: "Synchronisiert",
  syncFailed: "Synchronisieren fehlgeschlagen",
  csv: "CSV-Export",
  backup: "Backup herunterladen",
  groups: NAV_GROUP_LABELS,
  isNew: "Neu",
  views: "Gespeicherte Ansichten",
  recentFeatures: "Zuletzt benutzte Funktionen",
  hints: "↑↓ wählen · ↵ öffnen · 1–9 Seite · Esc schließt",
} as const;

/* ------------------------------------------------------------------ open state */

interface NavState {
  open: boolean;
  /** close without waiting for the wipe (an action opens another dialog in the same commit) */
  immediate: boolean;
}
const useNav = create<NavState>(() => ({ open: false, immediate: false }));

export function openCommandNav(): void {
  useNav.setState({ open: true, immediate: false });
}
export function closeCommandNav(immediate = false): void {
  if (useNav.getState().open) useNav.setState({ open: false, immediate });
}
export function toggleCommandNav(): void {
  if (useNav.getState().open) closeCommandNav();
  else openCommandNav();
}
export function useCommandNavOpen(): boolean {
  return useNav((s) => s.open);
}

/** Pure: ⌘K (macOS) / Ctrl+K anywhere – no Shift/Alt, so browser shortcuts with those stay untouched. */
export function isCommandNavShortcut(e: Pick<globalThis.KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">): boolean {
  return (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k";
}

/** Pure: next focus index for a roving key (wraps), `null` for keys the list does not handle. */
export function rovingIndex(key: string, current: number, count: number): number | null {
  if (count <= 0) return null;
  switch (key) {
    case "ArrowDown":
      return current < 0 ? 0 : (current + 1) % count;
    case "ArrowUp":
      return current < 0 ? count - 1 : (current - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ panel */

const WIPE: Transition = { duration: CONFIG.wipeMs / 1000, ease: CONFIG.wipeEase as unknown as [number, number, number, number] };

function itemMotion(delayMs: number, reduced: boolean) {
  if (reduced) return { initial: false as const, animate: { opacity: 1 } };
  return {
    initial: { opacity: 0, transform: `translateY(${CONFIG.lift}px)` },
    animate: { opacity: 1, transform: "translateY(0px)" },
    transition: { duration: CONFIG.itemMs / 1000, ease: CONFIG.itemEase as unknown as [number, number, number, number], delay: delayMs / 1000 },
  };
}

function Item({ delay, reduced, className, children }: { delay: number; reduced: boolean; className?: string; children: ReactNode }) {
  return (
    <motion.div {...itemMotion(delay, reduced)} className={className}>
      {children}
    </motion.div>
  );
}

/**
 * Deep links into the function register: the functions opened last (the search's recent list, `feature:<id>`). The register is a
 * lazy chunk – it is fetched only when there is something recent to name, and never for the first paint.
 */
function useRecentFeatures(): FeatureChip[] {
  const recent = useSearch((s) => s.recent);
  const key = recent.filter((id) => id.startsWith("feature:")).join("|");
  const [chips, setChips] = useState<{ key: string; list: FeatureChip[] }>({ key: "", list: [] });
  useEffect(() => {
    if (!key) return;
    let alive = true;
    void import("@/app/featureChips").then((m) => alive && setChips({ key, list: m.recentChips(key.split("|")) }));
    return () => {
      alive = false;
    };
  }, [key]);
  return key && chips.key === key ? chips.list : [];
}

const PAGE_HASH = Object.fromEntries(PAGES.map((p) => [p, `#${p}`])) as Record<Page, string>;
/**
 * All 19 pages in four groups by what you are doing (Erfassen, Prüfen, Auswerten, Konto & Rechtliches – `@/app/navGroups`, order
 * `NAV_GROUP_PAGES`), each with its plain-word hint. The digits 1–9 still jump to the first nine of `PAGES` (the keys never moved).
 */
export { NAV_GROUPS };
/** Pages that came with the last release: a small "Neu" next to the name until the page has been opened once (this browser only). */
export const NEW_PAGES: readonly Page[] = ["plan", "aktien", "studio"];
const VISITED_KEY = storageKey("visited-pages");

/** The pages of `NEW_PAGES` opened so far (blocked or damaged storage reads as "none": the tags then stay). */
export function readVisitedPages(): Page[] {
  const v = readJson<unknown>(VISITED_KEY, []);
  return Array.isArray(v) ? v.filter((p): p is Page => typeof p === "string" && (NEW_PAGES as readonly string[]).includes(p)) : [];
}

/** Remembers that `page` was opened; only the pages of `NEW_PAGES` are kept. Returns true when something was written. */
export function markPageVisited(page: Page): boolean {
  if (!(NEW_PAGES as readonly string[]).includes(page)) return false;
  const seen = readVisitedPages();
  if (seen.includes(page)) return false;
  return writeJson(VISITED_KEY, [...seen, page]);
}

/** The digit of a page (`1` … `9`) – only the first nine of `PAGES` have one. */
const pageDigit = (p: Page): string | null => {
  const i = PAGES.indexOf(p);
  return i >= 0 && i < 9 ? String(i + 1) : null;
};

/* ------------------------------------------------------------------ frames: the wipe (from 768 px) and the phone's sheet */

interface FrameProps {
  dialogRef: RefObject<HTMLDivElement | null>;
  onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => void;
  reduced: boolean;
  /** the panel has arrived (focus isolation settles, the sheet's swipe switches on) */
  onOpened: () => void;
  swipe: SwipeDismiss;
  columnRef: RefObject<HTMLDivElement | null>;
  children?: ReactNode;
}

const dialogProps = { id: COMMAND_NAV_ID, role: "dialog", "aria-modal": true, "aria-label": COMMAND_NAV_LABEL, tabIndex: -1, "data-layer": "Navigation (Vollbild)" } as const;

/** From 768 px: the black panel wipes in from the left (its content counter-translates, so the wipe is transform-only). */
function WipeFrame({ dialogRef, onKeyDown, reduced, onOpened, children }: FrameProps) {
  return (
    <motion.div
      ref={dialogRef}
      {...dialogProps}
      onKeyDown={onKeyDown}
      className="fixed inset-0 z-[75] overflow-hidden bg-black outline-none"
      initial={reduced ? false : { transform: "translateX(-100%)" }}
      animate={{ transform: "translateX(0%)" }}
      exit={reduced ? { opacity: 0, transition: { duration: 0 } } : { transform: "translateX(100%)", transition: WIPE }}
      transition={WIPE}
      onAnimationComplete={onOpened}
    >
      <motion.div
        className="absolute inset-0 overflow-y-auto overscroll-contain"
        initial={reduced ? false : { transform: "translateX(100%)" }}
        animate={{ transform: "translateX(0%)" }}
        exit={reduced ? undefined : { transform: "translateX(-100%)", transition: WIPE }}
        transition={WIPE}
      >
        {children}
      </motion.div>
    </motion.div>
  );
}

type Flung = SwipeDismissInfo | null | undefined;
/** Swiped away: the column flies out on the release velocity; the panel inside stays where it is. Closed otherwise: the panel sinks. */
const SHEET_COLUMN: Variants = { gone: (f: Flung) => (f ? flingExit(f, { distance: f.size + 40 }) : {}) };
const SHEET_PANEL: Variants = { gone: (f: Flung) => (f ? {} : { y: "100%", transition: { duration: 0.34, ease: ease.ios } }) };
const SHEET_STILL: Variants = { gone: { opacity: 0, transition: { duration: 0 } } };

/**
 * Below 768 px: a bottom sheet. The dimmed page stays visible above it (a 10 px strip), the panel rises on a soft spring, the head
 * (brand, close button, a grabber) is the handle: a pull down follows the finger 1:1 and a flick closes it on the release velocity
 * (`useSwipeDismiss`, the same physics as the editor sheet); a tap on the dim strip closes it too.
 */
function SheetFrame({ dialogRef, onKeyDown, reduced, onOpened, swipe, columnRef, children }: FrameProps) {
  return (
    <div
      ref={dialogRef}
      {...dialogProps}
      onKeyDown={onKeyDown}
      className="fixed inset-0 z-[75] outline-none"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) closeCommandNav();
      }}
    >
      <motion.div aria-hidden="true" className="pointer-events-none absolute inset-0" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: tween.exit }} transition={tween.fade}>
        <motion.div className="absolute inset-0 bg-ink-950/75" style={{ opacity: swipe.dim }} />
      </motion.div>
      <motion.div ref={columnRef} className="absolute inset-x-0 bottom-0 top-[calc(env(safe-area-inset-top,0px)+10px)]" style={swipe.style} variants={SHEET_COLUMN} exit="gone">
        <motion.div
          className="relative size-full overflow-hidden rounded-t-3xl border border-b-0 border-line-2 bg-black"
          initial={reduced ? false : { y: "100%" }}
          animate={{ y: 0 }}
          transition={reduced ? { duration: 0 } : CONFIG.sheet}
          variants={reduced ? SHEET_STILL : SHEET_PANEL}
          exit="gone"
          onAnimationComplete={onOpened}
        >
          <div className="absolute inset-0 overflow-y-auto overscroll-contain">{children}</div>
        </motion.div>
      </motion.div>
    </div>
  );
}

function Panel({ reduced, onFling }: { reduced: boolean; onFling: (info: SwipeDismissInfo) => void }) {
  const open = useNav((s) => s.open);
  const immediate = useNav((s) => s.immediate);
  const page = useUi((s) => s.page);
  const openEditor = useUi((s) => s.openEditor);
  const stats = useShellStats();
  const counts = usePageCounts(stats);
  const price = useLivePriceText();
  const theme = useTheme((s) => s.resolved);
  const views = useViews((s) => s.views);
  const recentFeatures = useRecentFeatures();
  // read when the panel opens: a page opened meanwhile loses its "Neu" the next time
  const [visited] = useState(readVisitedPages);
  const signedIn = useCloudSession((s) => s.phase === "signedIn");
  const syncOn = useSyncStatus((s) => s.phase !== "off");
  const ref = useRef<HTMLDivElement>(null);
  const [opened, setOpened] = useState(reduced);
  // below 768 px the menu is a bottom sheet (it rises, the dimmed page stays above it, a pull on its head closes it); from there the wipe
  const sheet = !useMediaQuery(WIDE_QUERY, false);
  const columnRef = useRef<HTMLDivElement>(null);
  const swipe = useSwipeDismiss({
    enabled: open && sheet && opened,
    open,
    target: columnRef,
    onDismiss: (info) => {
      onFling(info);
      closeCommandNav();
    },
  });
  const touchGuard = useTouchMoveGuard(swipe.isDragging);
  // the close button starts as the burger and turns into the cross once the panel is on its way (set a frame after the mount, so it animates)
  const [cross, setCross] = useState(reduced);
  useEffect(() => {
    const id = requestAnimationFrame(() => setCross(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // focus lands on the close button (visible from the first frame; the entries fade in later), arrows move into the list
  const settled = open ? opened : immediate;
  useDialogBehaviour(ref, open, () => closeCommandNav(), { settled });

  const go = (p: Page) => {
    navigate(p);
    closeCommandNav();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>("[data-cmd-item]") ?? []);
    const at = items.indexOf(document.activeElement as HTMLElement);
    // in the finder's field Home / End move the caret and the digits are text – only the arrows leave it
    const typing = e.target instanceof HTMLInputElement;
    const next = typing && e.key !== "ArrowDown" && e.key !== "ArrowUp" ? null : rovingIndex(e.key, at, items.length);
    if (next !== null) {
      e.preventDefault();
      items[next]?.focus();
      return;
    }
    if (typing) return;
    const digit = Number(e.key);
    const target = Number.isInteger(digit) && digit >= 1 && digit <= PAGES.length && !e.metaKey && !e.ctrlKey ? PAGES[digit - 1] : undefined;
    if (target) {
      e.preventDefault();
      go(target);
    }
  };

  const downloads = canDownload();
  // display (grey-bar fix): fullscreen toggle and install prompt – shown only where the browser offers them
  const fsSupported = useFullscreenSupported();
  const fullscreen = useFullscreen();
  const installable = useCanInstall();
  const standalone = useStandalone();
  // the install hint only where installing makes sense: a touch device, served over http(s) (a file has no manifest)
  const coarse = useMediaQuery("(pointer: coarse)", false);
  const hintInstall = coarse && !installable && !standalone && !IS_FILE_BUILD && !isFileProtocol();
  const display: { key: string; label: string; icon: ReactNode; pressed?: boolean; run: () => void }[] = [
    ...(fsSupported
      ? [{ key: "fullscreen", label: fullscreen ? DISPLAY_STRINGS.fullscreenExit : DISPLAY_STRINGS.fullscreen, pressed: fullscreen, icon: <GlyphFullscreen exit={fullscreen} />, run: () => void toggleFullscreen() }]
      : []),
    ...(installable && !standalone ? [{ key: "install", label: DISPLAY_STRINGS.install, icon: <GlyphInstall />, run: () => void promptInstall() }] : []),
  ];
  const displayHints = [
    ...(hintInstall ? [isIosSafari() ? DISPLAY_STRINGS.installHintIos : DISPLAY_STRINGS.installHint] : []),
    ...(isSamsungInternet() ? [DISPLAY_STRINGS.samsungDark] : []),
  ];
  const actions: { key: string; label: string; icon: ReactNode; accent?: boolean; pressed?: boolean; run: (e: MouseEvent<HTMLButtonElement>) => void }[] = [
    {
      key: "new",
      label: COMMAND_NAV_STRINGS.newTrade,
      accent: true,
      icon: <Icon name="plus" />,
      run: () => {
        closeCommandNav(true);
        openEditor();
      },
    },
    {
      key: "assistant",
      label: "Assistent öffnen",
      icon: <GlyphSpark />,
      run: () => {
        closeCommandNav(true);
        openAssistant();
      },
    },
    {
      key: "search",
      label: COMMAND_NAV_STRINGS.search,
      icon: <Icon name="search" />,
      run: () => {
        closeCommandNav(true);
        openSearch();
      },
    },
    {
      key: "theme",
      label: theme === "light" ? COMMAND_NAV_STRINGS.themeDark : COMMAND_NAV_STRINGS.themeLight,
      icon: <GlyphTheme light={theme === "light"} />,
      // the reveal grows from the pressed button (P13 theme transition)
      run: (e) => {
        const r = e.currentTarget.getBoundingClientRect();
        toggleTheme({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
      },
    },
    ...(cloudEnabled() && signedIn && syncOn
      ? [
          {
            key: "sync",
            label: COMMAND_NAV_STRINGS.sync,
            icon: <GlyphSync />,
            run: () => {
              void ensureCloud()
                .then((m) => m.syncNow())
                .then((ok) => pushToast(ok ? { kind: "success", title: COMMAND_NAV_STRINGS.synced } : { kind: "error", title: COMMAND_NAV_STRINGS.syncFailed }))
                .catch(() => pushToast({ kind: "error", title: COMMAND_NAV_STRINGS.syncFailed }));
            },
          },
        ]
      : []),
    ...(downloads
      ? [
          { key: "csv", label: COMMAND_NAV_STRINGS.csv, icon: <GlyphArrowDown />, run: () => void exportCsv() },
          { key: "json", label: COMMAND_NAV_STRINGS.backup, icon: <GlyphArrowDown />, run: () => void exportJson() },
        ]
      : []),
    ...display,
  ];

  const frame: FrameProps = { dialogRef: ref, onKeyDown, reduced, onOpened: () => setOpened(true), swipe, columnRef };
  const Frame = sheet ? SheetFrame : WipeFrame;
  return (
    <Frame {...frame}>
      <div className={cn("mx-auto flex min-h-full max-w-[1320px] flex-col px-4 pb-[calc(24px+env(safe-area-inset-bottom,0px))] sm:px-6", !sheet && "pt-[env(safe-area-inset-top,0px)]")}>
        {/* on a phone the head is the sheet's handle: a pull on it closes the menu (a grabber shows it) */}
        <div ref={sheet ? touchGuard : undefined} data-sheet-handle={sheet ? "" : undefined} className="relative flex h-16 shrink-0 items-center justify-between gap-4" {...(sheet ? swipe.handle : null)}>
          {sheet && <span aria-hidden="true" className="pointer-events-none absolute left-1/2 top-2 h-[5px] w-9 -translate-x-1/2 rounded-full bg-white/15" />}
          <Item delay={CONFIG.delays.brand} reduced={reduced} className="min-w-0">
            <p className="truncate font-mono text-[12px] font-semibold uppercase tracking-[0.2em] text-fg">{COMMAND_NAV_STRINGS.brand}</p>
            <p className="truncate text-[13px] text-mute">{COMMAND_NAV_STRINGS.claim}</p>
          </Item>
          <button
            type="button"
            onClick={() => closeCommandNav()}
            aria-label={COMMAND_NAV_STRINGS.close}
            className="tap grid shrink-0 place-items-center rounded-xl border border-line-2 text-mute transition-colors duration-200 hover:border-white/40 hover:text-fg"
          >
            {/* the header's burger, in the same place: it turns into the cross as the menu arrives and back as it leaves */}
            <Burger open={open && cross} />
          </button>
        </div>

        {/* minmax(0,1fr): the longest page name may never widen the column past the screen (390: it overflowed 24 px) */}
        <div className="grid flex-1 grid-cols-[minmax(0,1fr)] content-center gap-10 py-8 xl:grid-cols-[minmax(0,1fr)_minmax(0,360px)] xl:gap-16">
          <div className="grid min-w-0 content-start gap-7">
            <Item delay={CONFIG.delays.finder} reduced={reduced}>
              <NavFinder
                onOpen={(id) => {
                  closeCommandNav(true);
                  void import("@/app/featureOpen").then((m) => m.openFeature(id));
                }}
                onAll={() => go("funktionen")}
                onAsk={() => {
                  closeCommandNav(true);
                  openAssistant();
                }}
              />
            </Item>
            <nav aria-label={COMMAND_NAV_STRINGS.pages} className="grid gap-7">
              {/* the 19 pages in four groups, each page with its plain-word hint and live count – preloading its chunk on intent */}
              {NAV_GROUPS.map((g) => (
                <div key={g.id} role="group" aria-label={g.label} className="grid gap-2.5" data-testid="cmd-group" data-group={g.id}>
                  <Item delay={CONFIG.delays.links[NAV_ORDER.indexOf(g.pages[0]!)] ?? 960} reduced={reduced}>
                    <p className="flex items-baseline gap-3">
                      <span aria-hidden="true" className="inline-flex items-center gap-2 font-mono text-[10.5px] font-semibold uppercase tracking-[0.16em] text-faint">
                        <span className="size-3.5 text-mute [&>svg]:size-full">
                          <Icon name={NAV_GROUP_ICON[g.id]} />
                        </span>
                        {g.label}
                      </span>
                      <span aria-hidden="true" className="min-w-0 truncate text-[12px] text-faint max-sm:hidden">
                        {g.hint}
                      </span>
                    </p>
                  </Item>
                  <ul className="cmdnav-links grid grid-cols-[repeat(auto-fill,minmax(min(100%,236px),1fr))] gap-2">
                    {g.pages.map((p) => {
                      const fresh = NEW_PAGES.includes(p) && !visited.includes(p);
                      const digit = pageDigit(p);
                      return (
                        <li key={p} className="min-w-0">
                          <Item delay={CONFIG.delays.links[NAV_ORDER.indexOf(p)] ?? 1560} reduced={reduced} className="h-full">
                            <a
                              href={PAGE_HASH[p]}
                              data-cmd-item=""
                              aria-current={page === p ? "page" : undefined}
                              onClick={(e) => {
                                e.preventDefault();
                                go(p);
                              }}
                              onPointerEnter={() => preloadPage(p)}
                              onFocus={() => preloadPage(p)}
                              onPointerDown={() => preloadPage(p)}
                              className="cmdnav-link group/link relative flex h-full min-h-14 items-center gap-3 rounded-xl border border-line-2 bg-ink-900 px-3 py-2.5 text-fg outline-none transition-[opacity,border-color] duration-[250ms] hover:border-white/30 focus-visible:border-white/60"
                            >
                              <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-lg border border-line-2 text-mute group-hover/link:text-fg [&>svg]:size-[18px]">
                                <Icon name={PAGE_ICON[p]} />
                              </span>
                              <span className="grid min-w-0 flex-1">
                                <span className="flex min-w-0 items-center gap-1.5">
                                  <span className="truncate text-[15px] font-medium leading-tight">{PAGE_LABELS[p]}</span>
                                  {fresh && (
                                    <span data-testid="cmd-new" className="shrink-0 rounded-full border border-line-2 px-1.5 font-mono text-[9.5px] uppercase leading-[14px] tracking-[0.1em] text-mute">
                                      {COMMAND_NAV_STRINGS.isNew}
                                    </span>
                                  )}
                                </span>
                                <span data-testid="cmd-hint" className="truncate text-[12px] leading-snug text-mute">
                                  {PAGE_HINT[p]}
                                </span>
                              </span>
                              <span className="grid shrink-0 justify-items-end gap-0.5 self-start">
                                {digit && (
                                  <span aria-hidden="true" className="font-mono text-[10px] text-faint">
                                    {digit}
                                  </span>
                                )}
                                <span className={cn("dot-num max-w-[11ch] truncate text-[11px]", counts[p].tone ?? "text-mute")}>
                                  <DotFigure text={counts[p].text} />
                                </span>
                              </span>
                              {page === p && <span aria-hidden="true" className="absolute right-2 bottom-2 size-1.5 rounded-full bg-signal" />}
                            </a>
                          </Item>
                        </li>
                      );
                    })}
                  </ul>
                  {g.id === "konto" && (
                    <Item delay={CONFIG.delays.links[NAV_ORDER.length - 1] ?? 1800} reduced={reduced}>
                      <LegalLinks roomy className="-mx-2.5" />
                    </Item>
                  )}
                </div>
              ))}
            </nav>
          </div>

          <section aria-label={COMMAND_NAV_STRINGS.actions} className="grid content-start gap-3">
            {actions.map((a, i) => (
              <Item key={a.key} delay={CONFIG.delays.actions[i] ?? 880} reduced={reduced}>
                <button
                  type="button"
                  data-cmd-item=""
                  onClick={(e) => a.run(e)}
                  aria-pressed={a.pressed}
                  className="group/action flex w-full items-center gap-4 rounded-2xl border border-line-2 bg-ink-900 px-4 py-4 text-left outline-none transition-colors duration-200 hover:border-white/30 focus-visible:border-white/60"
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "grid size-10 shrink-0 place-items-center rounded-full [&>svg]:size-4",
                      a.accent ? "bg-gradient-to-br from-(--color-fab-from) to-signal text-ink-950" : "border border-line-2 text-mute group-hover/action:text-fg",
                    )}
                  >
                    {a.icon}
                  </span>
                  <span className="text-[15px] font-medium text-fg">{a.label}</span>
                </button>
              </Item>
            ))}
            {views.length > 0 && (
              <Item delay={CONFIG.delays.views} reduced={reduced}>
                <div role="group" aria-label={COMMAND_NAV_STRINGS.views} className="grid gap-2 px-1 pt-1">
                  <span className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.16em] text-faint">{COMMAND_NAV_STRINGS.views}</span>
                  <div className="flex flex-wrap gap-1.5">
                    {views.slice(0, 8).map((v) => (
                      <button
                        key={v.id}
                        type="button"
                        data-cmd-item=""
                        onClick={() => {
                          useViews.getState().applyView(v.id);
                          go("trades");
                        }}
                        className="max-w-full truncate rounded-full border border-line-2 px-3 py-1.5 text-[12.5px] text-fg outline-none transition-colors duration-200 hover:border-white/30 focus-visible:border-white/60 pointer-coarse:min-h-11"
                      >
                        {v.name}
                      </button>
                    ))}
                  </div>
                </div>
              </Item>
            )}
            {recentFeatures.length > 0 && (
              <Item delay={CONFIG.delays.views} reduced={reduced}>
                <div role="group" aria-label={COMMAND_NAV_STRINGS.recentFeatures} className="grid gap-2 px-1 pt-1" data-testid="cmd-recent-features">
                  <span className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.16em] text-faint">{COMMAND_NAV_STRINGS.recentFeatures}</span>
                  <div className="flex flex-wrap gap-1.5">
                    {recentFeatures.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        data-cmd-item=""
                        data-feature={c.id}
                        onClick={() => {
                          closeCommandNav(true);
                          void import("@/app/featureOpen").then((m) => m.openFeature(c.id));
                        }}
                        className="max-w-full truncate rounded-full border border-line-2 px-3 py-1.5 text-[12.5px] text-fg outline-none transition-colors duration-200 hover:border-white/30 focus-visible:border-white/60 pointer-coarse:min-h-11"
                      >
                        {c.name}
                      </button>
                    ))}
                  </div>
                </div>
              </Item>
            )}
            {displayHints.length > 0 && (
              <Item delay={CONFIG.delays.display} reduced={reduced}>
                <div aria-label={DISPLAY_STRINGS.section} role="note" className="grid gap-2 px-1 pt-1 text-[12.5px] leading-relaxed text-mute">
                  {displayHints.map((h) => (
                    <p key={h}>{h}</p>
                  ))}
                </div>
              </Item>
            )}
          </section>
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-line pt-4 font-mono text-[11px] text-faint">
          <Item delay={CONFIG.delays.hints} reduced={reduced} className="max-sm:hidden">
            <span aria-hidden="true">{COMMAND_NAV_STRINGS.hints}</span>
          </Item>
          <Item delay={CONFIG.delays.price} reduced={reduced}>
            {/* decorative live price (never announced) */}
            <span aria-hidden="true" className="num">
              BTC <motion.span className="text-mute">{price}</motion.span>
            </span>
          </Item>
        </div>
      </div>
    </Frame>
  );
}

/**
 * Sun and moon, both always there: switching turns one away (a quarter turn, shrinking, fading) while the other turns in from the
 * other side on the menu's ease – a button that answers the press at once, while the theme's circle grows from this very spot
 * (`themeTransition.ts`). Transform and opacity only; reduced motion: `base.css` makes it instant.
 */
function GlyphTheme({ light }: { light: boolean }) {
  const turn = "absolute inset-0 size-full transition-[scale,rotate,opacity] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]";
  return (
    <span className="relative block size-4">
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={cn(turn, light && "scale-50 rotate-90 opacity-0")}>
        <circle cx="8" cy="8" r="3" />
        <path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1" />
      </svg>
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={cn(turn, !light && "scale-50 -rotate-90 opacity-0")}>
        <path d="M13.5 9.5A5.5 5.5 0 0 1 6.5 2.5a5.5 5.5 0 1 0 7 7z" />
      </svg>
    </span>
  );
}

function GlyphSync() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M13 6.5A5 5 0 0 0 4 4.5L2.5 6M3 9.5a5 5 0 0 0 9 2l1.5-1.5M2.5 2.5V6H6M13.5 13.5V10H10" />
    </svg>
  );
}

function GlyphInstall() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="1.5" width="8" height="13" rx="2" />
      <path d="M8 4.5v5M6 7.5 8 9.5 10 7.5M7 12.5h2" />
    </svg>
  );
}

function GlyphArrowDown() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 2.5v8M4.5 7 8 10.5 11.5 7M3 13.5h10" />
    </svg>
  );
}

/**
 * Host: the global ⌘K / Ctrl+K shortcut (ignored while another modal dialog is open) and the animated panel. Render
 * it before the app overlays, so a quick action's close runs before the next dialog takes focus.
 */
export function CommandNav() {
  const open = useNav((s) => s.open);
  const reduced = useReducedFx();
  const current = useUi((s) => s.page);
  // a swipe that closed the phone's sheet: the exit flies on the release velocity (cleared once the sheet is gone)
  const [flung, setFlung] = useState<SwipeDismissInfo | null>(null);

  // a page of the last release loses its "Neu" tag once it has been opened (by any way: dock, search, link, assistant)
  useEffect(() => {
    markPageVisited(current);
  }, [current]);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (!isCommandNavShortcut(e)) return;
      const other = document.querySelector(`[role="dialog"][aria-modal="true"]:not(#${COMMAND_NAV_ID})`);
      if (other) return;
      e.preventDefault();
      toggleCommandNav();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // a page that unmounts the host (tests) must not leave the store open
  useEffect(() => () => useNav.setState({ open: false, immediate: false }), []);

  // a fixed overlay: its exit never moves a sibling, so no app-wide re-render once it has left
  return (
    <NoLayoutCascade>
      <AnimatePresence custom={flung} onExitComplete={() => setFlung(null)}>
        {open && <Panel key="nav" reduced={reduced} onFling={setFlung} />}
      </AnimatePresence>
    </NoLayoutCascade>
  );
}
