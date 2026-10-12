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
 * Focus starts on the close button; arrow keys / Home / End move between the entries, 1–4 jump to a page. Unmounted while closed, so none of its
 * texts exist in the page otherwise.
 */
import { AnimatePresence, motion, type Transition } from "motion/react";
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { GlyphFullscreen } from "@/app/DisplayActions";
import { PAGE_ICON, PAGE_LABELS } from "@/app/Dock";
import { preloadPage } from "@/app/pages";
import { DISPLAY_STRINGS, isIosSafari, isSamsungInternet, promptInstall, toggleFullscreen, useCanInstall, useFullscreen, useFullscreenSupported, useStandalone } from "@/app/pwa";
import { useLivePriceText, usePageCounts, useShellStats } from "@/app/shellStats";
import { cloudEnabled } from "@/cloud/env";
import { ensureCloud } from "@/cloud/runtime";
import { useCloudSession } from "@/cloud/session";
import { useSyncStatus } from "@/cloud/sync/status";
import { cn } from "@/lib/cn";
import { IS_FILE_BUILD, isFileProtocol } from "@/edition";
import { useDialogBehaviour } from "@/motion/a11y";
import { NoLayoutCascade } from "@/motion/NoLayoutCascade";
import { useMediaQuery } from "@/motion/useMediaQuery";
import { useReducedFx } from "@/motion/useReducedFx";
import { Icon } from "@/primitives/icons";
import { openSearch } from "@/search/searchStore";
import { exportCsv, exportJson } from "@/store/backup";
import { canDownload } from "@/store/download";
import { navigate } from "@/store/router";
import { toggleTheme, useTheme } from "@/store/themeStore";
import { PAGES, pushToast, useUi, type Page } from "@/store/uiStore";
import { useViews } from "@/store/viewsStore";
import { create } from "zustand";

export const CONFIG = {
  wipeMs: 800,
  wipeEase: [0.76, 0, 0.24, 1],
  itemMs: 650,
  itemEase: [0.22, 1, 0.36, 1],
  lift: 24,
  /**
   * ms after the open: brand block, the page links (the pack's four, then one beat of 60 ms per further page), the quick
   * actions (pack "images" slots, then the display actions), hint row, live price
   */
  delays: {
    brand: 620,
    links: [620, 720, 820, 900, 960, 1020, 1080, 1140, 1200, 1260, 1320, 1380, 1440, 1500, 1560],
    actions: [720, 800, 880, 960, 1040, 1120, 1200, 1280],
    display: 1280,
    views: 1360,
    hints: 2250,
    price: 2300,
  },
} as const;

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
  more: "Werkzeuge & Konto",
  views: "Gespeicherte Ansichten",
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

const PAGE_HASH = Object.fromEntries(PAGES.map((p) => [p, `#${p}`])) as Record<Page, string>;
/** The pack's big links: the four original pages (digits 1–4); the feature pages follow in a compact grid. */
const PRIMARY = PAGES.slice(0, 4);
const SECONDARY = PAGES.slice(4);
/** Two-digit index of a page (`01` … `15`) – the digit shortcut of the first nine. */
const pageNo = (i: number): string => String(i + 1).padStart(2, "0");

function Panel({ reduced }: { reduced: boolean }) {
  const open = useNav((s) => s.open);
  const immediate = useNav((s) => s.immediate);
  const page = useUi((s) => s.page);
  const openEditor = useUi((s) => s.openEditor);
  const stats = useShellStats();
  const counts = usePageCounts(stats);
  const price = useLivePriceText();
  const theme = useTheme((s) => s.resolved);
  const views = useViews((s) => s.views);
  const signedIn = useCloudSession((s) => s.phase === "signedIn");
  const syncOn = useSyncStatus((s) => s.phase !== "off");
  const ref = useRef<HTMLDivElement>(null);
  const [opened, setOpened] = useState(reduced);

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
    const next = rovingIndex(e.key, at, items.length);
    if (next !== null) {
      e.preventDefault();
      items[next]?.focus();
      return;
    }
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

  return (
    <motion.div
      ref={ref}
      id={COMMAND_NAV_ID}
      role="dialog"
      aria-modal="true"
      aria-label={COMMAND_NAV_LABEL}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className="fixed inset-0 z-[75] overflow-hidden bg-black outline-none"
      data-layer="Navigation (Vollbild)"
      initial={reduced ? false : { transform: "translateX(-100%)" }}
      animate={{ transform: "translateX(0%)" }}
      exit={reduced ? { opacity: 0, transition: { duration: 0 } } : { transform: "translateX(100%)", transition: WIPE }}
      transition={WIPE}
      onAnimationComplete={() => setOpened(true)}
    >
      <motion.div
        className="absolute inset-0 overflow-y-auto overscroll-contain"
        initial={reduced ? false : { transform: "translateX(100%)" }}
        animate={{ transform: "translateX(0%)" }}
        exit={reduced ? undefined : { transform: "translateX(-100%)", transition: WIPE }}
        transition={WIPE}
      >
        <div className="mx-auto flex min-h-full max-w-[1320px] flex-col px-4 pb-[calc(24px+env(safe-area-inset-bottom,0px))] pt-[env(safe-area-inset-top,0px)] sm:px-6">
          <div className="flex h-16 shrink-0 items-center justify-between gap-4">
            <Item delay={CONFIG.delays.brand} reduced={reduced} className="min-w-0">
              <p className="truncate font-mono text-[12px] font-semibold uppercase tracking-[0.2em] text-fg">{COMMAND_NAV_STRINGS.brand}</p>
              <p className="truncate text-[13px] text-mute">{COMMAND_NAV_STRINGS.claim}</p>
            </Item>
            <button
              type="button"
              onClick={() => closeCommandNav()}
              aria-label={COMMAND_NAV_STRINGS.close}
              className="touch-hit grid size-9 shrink-0 place-items-center rounded-xl border border-line-2 text-mute transition-colors duration-200 hover:border-white/40 hover:text-fg [&>svg]:size-4"
            >
              <Icon name="x" />
            </button>
          </div>

          {/* minmax(0,1fr): the longest page name may never widen the column past the screen (390: it overflowed 24 px) */}
          <div className="grid flex-1 grid-cols-[minmax(0,1fr)] content-center gap-10 py-8 xl:grid-cols-[minmax(0,1fr)_minmax(0,360px)] xl:gap-16">
            <nav aria-label={COMMAND_NAV_STRINGS.pages} className="grid gap-7">
              <ul className="cmdnav-links grid">
                {PRIMARY.map((p, i) => (
                  <li key={p}>
                    <Item delay={CONFIG.delays.links[i] ?? 900} reduced={reduced}>
                      <a
                        href={PAGE_HASH[p]}
                        data-cmd-item=""
                        aria-current={page === p ? "page" : undefined}
                        onClick={(e) => {
                          e.preventDefault();
                          go(p);
                        }}
                        className="cmdnav-link group/link inline-flex max-w-full items-baseline gap-3 rounded-lg py-1.5 text-fg outline-none max-sm:pointer-coarse:py-2.5 transition-opacity duration-[250ms] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white sm:gap-5"
                      >
                        <span aria-hidden="true" className="w-6 shrink-0 font-mono text-[11px] text-faint sm:w-8">
                          {pageNo(i)}
                        </span>
                        <span className="min-w-0 break-words text-[clamp(22px,4.6vw,56px)] font-normal leading-[1.08] tracking-[-0.02em]">{PAGE_LABELS[p]}</span>
                        <span className={cn("dot-num shrink-0 self-start pt-[0.5em] text-[12px] sm:text-[14px]", counts[p].tone ?? "text-mute")}>{counts[p].text}</span>
                        {page === p && <span aria-hidden="true" className="size-1.5 shrink-0 self-center rounded-full bg-signal" />}
                      </a>
                    </Item>
                  </li>
                ))}
              </ul>
              {/* the feature pages: a compact grid (icon, name, live count, digit) – preloading their chunk on intent */}
              <div className="grid gap-2.5">
                <Item delay={CONFIG.delays.links[PRIMARY.length] ?? 960} reduced={reduced}>
                  <p className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.16em] text-faint">{COMMAND_NAV_STRINGS.more}</p>
                </Item>
                <ul className="cmdnav-links grid grid-cols-[repeat(auto-fill,minmax(min(100%,168px),1fr))] gap-2">
                  {SECONDARY.map((p, k) => {
                    const i = PRIMARY.length + k;
                    return (
                      <li key={p} className="min-w-0">
                        <Item delay={CONFIG.delays.links[i] ?? 1560} reduced={reduced} className="h-full">
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
                            className="cmdnav-link group/link relative flex h-full min-h-12 items-center gap-3 rounded-xl border border-line-2 bg-ink-900 px-3 py-2.5 text-fg outline-none transition-[opacity,border-color] duration-[250ms] hover:border-white/30 focus-visible:border-white/60"
                          >
                            <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-lg border border-line-2 text-mute group-hover/link:text-fg [&>svg]:size-4">
                              <Icon name={PAGE_ICON[p]} />
                            </span>
                            <span className="grid min-w-0 flex-1">
                              <span className="truncate text-[15px] font-medium leading-tight">{PAGE_LABELS[p]}</span>
                              <span className={cn("dot-num truncate text-[11.5px]", counts[p].tone ?? "text-mute")}>{counts[p].text}</span>
                            </span>
                            <span aria-hidden="true" className="shrink-0 self-start font-mono text-[10px] text-faint">
                              {pageNo(i)}
                            </span>
                            {page === p && <span aria-hidden="true" className="absolute right-2 bottom-2 size-1.5 rounded-full bg-signal" />}
                          </a>
                        </Item>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </nav>

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
                        a.accent ? "bg-gradient-to-br from-[#ff3b47] to-signal text-ink-950" : "border border-line-2 text-mute group-hover/action:text-fg",
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
      </motion.div>
    </motion.div>
  );
}

function GlyphTheme({ light }: { light: boolean }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {light ? (
        <path d="M13.5 9.5A5.5 5.5 0 0 1 6.5 2.5a5.5 5.5 0 1 0 7 7z" />
      ) : (
        <>
          <circle cx="8" cy="8" r="3" />
          <path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1" />
        </>
      )}
    </svg>
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
      <AnimatePresence>{open && <Panel key="nav" reduced={reduced} />}</AnimatePresence>
    </NoLayoutCascade>
  );
}
