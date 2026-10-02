/**
 * Full-screen command navigation (pulse-motion `immersive-full-screen-navigation`, exact timings): ⌘K / Ctrl+K or
 * the header menu button opens a black panel that wipes in from the left (800 ms, cubic-bezier(.76,0,.24,1); the
 * shell translates in, its content counter-translates, so the wipe is transform-only), then the brand block, the
 * page links with live counts, the quick actions and the hint row fade up 24 px in the pack's stagger (650 ms,
 * cubic-bezier(.22,1,.36,1)). Closing wipes the panel away to the right with its content still visible.
 *
 * Dialog behaviour: role=dialog, aria-modal, aria-label "Navigation", focus trap, Escape, scroll lock, inert page
 * (applied after the open wipe, released after the close wipe – never in the first frames of either), focus return.
 * Focus starts on the close button; arrow keys / Home / End move between the entries, 1–4 jump to a page. Unmounted while closed, so none of its
 * texts exist in the page otherwise.
 */
import { AnimatePresence, motion, type Transition } from "motion/react";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { PAGE_LABELS } from "@/app/Dock";
import { shellStatTexts, useLivePriceText, useShellStats } from "@/app/shellStats";
import { cn } from "@/lib/cn";
import { useDialogBehaviour } from "@/motion/a11y";
import { useReducedFx } from "@/motion/useReducedFx";
import { Icon } from "@/primitives/icons";
import { exportCsv, exportJson } from "@/store/backup";
import { canDownload } from "@/store/download";
import { navigate } from "@/store/router";
import { PAGES, useUi, type Page } from "@/store/uiStore";
import { create } from "zustand";

export const CONFIG = {
  wipeMs: 800,
  wipeEase: [0.76, 0, 0.24, 1],
  itemMs: 650,
  itemEase: [0.22, 1, 0.36, 1],
  lift: 24,
  /** ms after the open: brand block, the four links, the quick actions (pack "images" slots), hint row, live price */
  delays: { brand: 620, links: [620, 720, 820, 900], actions: [720, 800, 880], hints: 2250, price: 2300 },
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
  csv: "CSV-Export",
  backup: "Backup herunterladen",
  hints: "↑↓ wählen · ↵ öffnen · Esc schließt",
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

const PAGE_HASH: Record<Page, string> = { overview: "#overview", trades: "#trades", setups: "#setups", settings: "#settings" };

function Panel({ reduced }: { reduced: boolean }) {
  const open = useNav((s) => s.open);
  const immediate = useNav((s) => s.immediate);
  const page = useUi((s) => s.page);
  const openEditor = useUi((s) => s.openEditor);
  const stats = useShellStats();
  const texts = shellStatTexts(stats);
  const price = useLivePriceText();
  const ref = useRef<HTMLDivElement>(null);
  const [opened, setOpened] = useState(reduced);

  // focus lands on the close button (visible from the first frame; the entries fade in later), arrows move into the list
  const settled = open ? opened : immediate;
  useDialogBehaviour(ref, open, () => closeCommandNav(), { settled });

  const counts: Record<Page, { text: string; tone?: string }> = {
    overview: { text: texts.net, tone: stats.net > 0 ? "text-win" : stats.net < 0 ? "text-loss" : "text-mute" },
    trades: { text: texts.trades },
    setups: { text: texts.setups },
    settings: { text: texts.rules },
  };

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
  const actions: { key: string; label: string; icon: ReactNode; accent?: boolean; run: () => void }[] = [
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
    ...(downloads
      ? [
          { key: "csv", label: COMMAND_NAV_STRINGS.csv, icon: <GlyphArrowDown />, run: () => void exportCsv() },
          { key: "json", label: COMMAND_NAV_STRINGS.backup, icon: <GlyphArrowDown />, run: () => void exportJson() },
        ]
      : []),
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
              className="grid size-9 shrink-0 place-items-center rounded-xl border border-line-2 text-mute transition-colors duration-200 hover:border-white/40 hover:text-fg [&>svg]:size-4"
            >
              <Icon name="x" />
            </button>
          </div>

          <div className="grid flex-1 content-center gap-10 py-8 xl:grid-cols-[minmax(0,1fr)_minmax(0,360px)] xl:gap-16">
            <nav aria-label={COMMAND_NAV_STRINGS.pages}>
              <ul className="cmdnav-links grid">
                {PAGES.map((p, i) => (
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
                        className="cmdnav-link group/link inline-flex max-w-full items-baseline gap-3 rounded-lg py-1.5 text-fg outline-none transition-opacity duration-[250ms] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white sm:gap-5"
                      >
                        <span aria-hidden="true" className="w-6 shrink-0 font-mono text-[11px] text-faint sm:w-8">
                          0{i + 1}
                        </span>
                        <span className="min-w-0 break-words text-[clamp(26px,4.6vw,64px)] font-normal leading-[1.08] tracking-[-0.02em]">{PAGE_LABELS[p]}</span>
                        <span className={cn("dot-num shrink-0 self-start pt-[0.5em] text-[12px] sm:text-[14px]", counts[p].tone ?? "text-mute")}>{counts[p].text}</span>
                        {page === p && <span aria-hidden="true" className="size-1.5 shrink-0 self-center rounded-full bg-signal" />}
                      </a>
                    </Item>
                  </li>
                ))}
              </ul>
            </nav>

            <section aria-label={COMMAND_NAV_STRINGS.actions} className="grid content-start gap-3">
              {actions.map((a, i) => (
                <Item key={a.key} delay={CONFIG.delays.actions[i] ?? 880} reduced={reduced}>
                  <button
                    type="button"
                    data-cmd-item=""
                    onClick={a.run}
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

  return <AnimatePresence>{open && <Panel key="nav" reduced={reduced} />}</AnimatePresence>;
}
