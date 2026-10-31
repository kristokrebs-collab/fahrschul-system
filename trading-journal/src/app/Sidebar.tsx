/**
 * Sidebar from 768 px (Etappe 1a): the four groups – Erfassen, Prüfen, Auswerten, Konto & Rechtliches – with all 19 pages, the
 * primary action „Trade eintragen“ on top and a collapse button at the foot. Below 768 px the bottom bar (`Dock.tsx`) and the
 * menu behind „Mehr“ carry the same groups; the two never exist together (`useMediaQuery(WIDE_QUERY)`).
 *
 * Wide (≥ 1280 px, or when the reader opened it): 256 px – group titles, page names with their plain-word hint. Narrow rail
 * (768 – 1279 px by default, or when the reader closed it): 64 px – icons, names in a tooltip and as `aria-label`. The choice is kept
 * (`uiStore.sidebar`: auto | open | closed, stored in `tj2-ui`). The rail's width never costs a page its room: `auto` collapses
 * exactly where the pages need it.
 *
 * Motion: a single marker (`spring.layout`) glides from row to row – a transform written by `animate`, no layout projection; the
 * labels fade in on expanding (`spring.smooth`). Switching width itself is one layout change (no per-frame reflow of the page); reduced
 * motion: everything at once. Each row preloads its page chunk on intent. Rows are 44 px tall and never overlap.
 */
import { animate, motion, useMotionValue } from "motion/react";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, type MouseEvent } from "react";
import { groupOfPage, NAV_GROUPS, NAV_GROUP_ICON, PAGE_HINT, PAGE_ICON, PAGE_LABELS, WIDE_QUERY } from "@/app/navGroups";
import { NEW_TRADE_LABEL, NewTradeButton } from "@/app/NewTradeButton";
import { preloadPage } from "@/app/pages";
import { LEGAL_LABEL, legalConfig, legalShown, type LegalDoc } from "@/legal/config";
import { LegalLinks } from "@/legal/LegalLinks";
import { openLegal } from "@/legal/store";
import { cn } from "@/lib/cn";
import { spring } from "@/motion/tokens";
import { useMediaQuery } from "@/motion/useMediaQuery";
import { useReducedFx } from "@/motion/useReducedFx";
import { Icon } from "@/primitives/icons";
import { Tooltip } from "@/primitives/Tooltip";
import { navigate } from "@/store/router";
import { NAV_GROUP_IDS, useUi, type NavGroupId, type Page } from "@/store/uiStore";

export const SIDEBAR_WIDTH = { wide: 256, rail: 64 } as const;
/** From this width `auto` shows the wide sidebar; below it the rail. */
export const SIDEBAR_AUTO_QUERY = "(min-width: 1280px)";
export const SIDEBAR_LABEL = "Hauptnavigation";
export const SIDEBAR_STRINGS = { collapse: "Seitenleiste einklappen", expand: "Seitenleiste ausklappen", legal: "Rechtliches" } as const;

/** Below this screen height the wide sidebar folds every group but the current one until the reader chooses (19 rows of 44 px do not fit). */
export const SIDEBAR_SHORT_QUERY = "(max-height: 1299px)";

/** Pure: the folded groups. An explicit choice wins; otherwise a short screen folds all but the current group and „Konto & Rechtliches“ (Einstellungen stay one tap away). */
export function closedGroups(stored: readonly NavGroupId[] | null, short: boolean, current: NavGroupId): readonly NavGroupId[] {
  if (stored) return stored;
  return short ? NAV_GROUP_IDS.filter((g) => g !== current && g !== "konto") : [];
}

/** Pure: is the sidebar wide? `open` / `closed` are the reader's choice; `auto` follows the screen width. */
export function sidebarExpanded(pref: "auto" | "open" | "closed", autoWide: boolean): boolean {
  return pref === "open" || (pref === "auto" && autoWide);
}

function Row({ page, current, expanded, onGo }: { page: Page; current: boolean; expanded: boolean; onGo: (p: Page, e: MouseEvent<HTMLAnchorElement>) => void }) {
  const label = PAGE_LABELS[page];
  const link = (
    <a
      href={`#${page}`}
      data-nav-page={page}
      aria-current={current ? "page" : undefined}
      aria-label={expanded ? undefined : label}
      onClick={(e) => onGo(page, e)}
      onPointerEnter={() => preloadPage(page)}
      onFocus={() => preloadPage(page)}
      onPointerDown={() => preloadPage(page)}
      className={cn(
        "group/row relative flex h-11 items-center rounded-xl text-fg outline-none transition-colors duration-200 hover:bg-white/[0.05] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-white",
        expanded ? "gap-3 px-2.5" : "justify-center",
        current ? "text-fg" : "text-mute hover:text-fg",
      )}
    >
      <span aria-hidden="true" className={cn("relative grid size-7 shrink-0 place-items-center [&>svg]:size-[18px]", current && "text-fg")}>
        <Icon name={PAGE_ICON[page]} />
      </span>
      {expanded && (
        <motion.span className="grid min-w-0 flex-1" initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={spring.smooth}>
          <span className={cn("truncate text-[13.5px] leading-tight", current ? "font-semibold text-fg" : "font-medium")}>{label}</span>
          <span className="truncate text-[11px] leading-tight text-mute">{PAGE_HINT[page]}</span>
        </motion.span>
      )}
      {current && expanded && <span aria-hidden="true" className="relative size-1.5 shrink-0 rounded-full bg-signal" />}
      {current && !expanded && <span aria-hidden="true" className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-signal" />}
    </a>
  );
  // the rail has no room for words: the name (and what it is for) in a tooltip, on hover and focus
  return expanded ? (
    link
  ) : (
    <Tooltip
      side="right"
      sideOffset={10}
      content={
        <span className="grid gap-0.5">
          <span className="text-[12.5px] font-medium text-fg">{label}</span>
          <span className="text-[11.5px] text-mute">{PAGE_HINT[page]}</span>
        </span>
      }
    >
      {link}
    </Tooltip>
  );
}

function LegalRow({ expanded }: { expanded: boolean }) {
  if (!legalShown()) return null;
  const docs: LegalDoc[] = ["impressum", "datenschutz", "agb"];
  if (legalConfig().urls.widerruf) docs.push("widerruf");
  if (!expanded) {
    return (
      <Tooltip side="right" sideOffset={10} content={<span className="text-[12.5px] text-fg">{docs.map((d) => LEGAL_LABEL[d]).join(" · ")}</span>}>
        <button
          type="button"
          aria-label={`${SIDEBAR_STRINGS.legal}: ${LEGAL_LABEL.impressum}`}
          data-testid="sidebar-legal"
          onClick={() => openLegal("impressum")}
          className="grid h-11 w-full place-items-center rounded-xl text-mute outline-none transition-colors duration-200 hover:bg-white/[0.05] hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-white [&>svg]:size-[18px]"
        >
          <Icon name="doc" />
        </button>
      </Tooltip>
    );
  }
  return <LegalLinks roomy className="-mx-1" />;
}

function SidebarPanel() {
  const page = useUi((s) => s.page);
  const pref = useUi((s) => s.sidebar);
  const setPref = useUi((s) => s.setPref);
  const autoWide = useMediaQuery(SIDEBAR_AUTO_QUERY, false);
  const short = useMediaQuery(SIDEBAR_SHORT_QUERY, false);
  const storedClosed = useUi((s) => s.sidebarClosed);
  const expanded = sidebarExpanded(pref, autoWide);
  const currentGroup = groupOfPage(page);
  const closed = closedGroups(storedClosed, short, currentGroup);
  // the rail has no group titles: every row is there
  const groupOpen = (g: NavGroupId) => !expanded || !closed.includes(g);
  const currentOpen = groupOpen(currentGroup);
  const reduced = useReducedFx();
  const id = useId();
  const nav = useRef<HTMLElement>(null);
  const y = useMotionValue(0);
  const markerOpacity = useMotionValue(1);
  const shown = useRef(false);
  const lastExpanded = useRef(expanded);

  // the page column leaves room for the sidebar: the footer (outside the flex row) reads it
  useLayoutEffect(() => {
    document.documentElement.style.setProperty("--sidebar-w", `${expanded ? SIDEBAR_WIDTH.wide : SIDEBAR_WIDTH.rail}px`);
    return () => {
      document.documentElement.style.removeProperty("--sidebar-w");
    };
  }, [expanded]);

  // the marker glides to the active row; a width change or the first paint places it without travelling
  useLayoutEffect(() => {
    const el = nav.current?.querySelector<HTMLElement>(`[data-nav-page="${page}"]`);
    if (!el) {
      shown.current = false;
      return;
    }
    markerOpacity.set(currentOpen ? 1 : 0);
    const top = el.offsetTop;
    const jump = !shown.current || reduced || lastExpanded.current !== expanded;
    shown.current = true;
    lastExpanded.current = expanded;
    if (jump) {
      y.jump(top);
      return;
    }
    const c = animate(y, top, spring.layout);
    return () => c.stop();
  }, [page, expanded, reduced, y, markerOpacity, currentOpen]);

  // the sidebar scrolls on a short screen: the page you are on is always in view
  useLayoutEffect(() => {
    const el = nav.current?.querySelector<HTMLElement>(`[data-nav-page="${page}"]`);
    if (el && currentOpen) el.scrollIntoView?.({ block: "nearest", behavior: "instant" });
  }, [page, currentOpen]);

  // a group folds / unfolds (its rows grow and shrink over 0.3 s) or the font changes the rows: the marker stays on its row
  useEffect(() => {
    const box = nav.current;
    if (!box || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      const el = box.querySelector<HTMLElement>(`[data-nav-page="${page}"]`);
      if (el) y.jump(el.offsetTop);
    });
    for (const child of Array.from(box.children)) if (child !== box.querySelector("[data-sidebar-marker]")) ro.observe(child);
    return () => ro.disconnect();
  }, [page, y]);

  // a page that lives in a folded group opens it (a link, a key, the search): you never land on a hidden row
  useEffect(() => {
    const stored = useUi.getState().sidebarClosed;
    if (stored?.includes(currentGroup)) useUi.getState().setPref("sidebarClosed", stored.filter((g) => g !== currentGroup));
  }, [currentGroup]);

  const toggleGroup = (g: NavGroupId) => {
    const next = groupOpen(g) ? [...closed.filter((x) => x !== g), g] : closed.filter((x) => x !== g);
    setPref("sidebarClosed", next);
  };

  // legal links that appear late (config) or a font that changes the rows: keep the marker on its row
  useEffect(() => {
    const onResize = () => {
      const el = nav.current?.querySelector<HTMLElement>(`[data-nav-page="${page}"]`);
      if (el) y.jump(el.offsetTop);
    };
    window.addEventListener("resize", onResize, { passive: true });
    return () => window.removeEventListener("resize", onResize);
  }, [page, y]);

  const onGo = useCallback(
    (p: Page, e: MouseEvent<HTMLAnchorElement>) => {
      // a new tab / window keeps the plain link
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      // the page you are on again: back to its top (as the bottom bar's active tab)
      if (p === useUi.getState().page) window.scrollTo({ top: 0, behavior: reduced ? "instant" : "smooth" });
      navigate(p);
    },
    [reduced],
  );

  const toggle = expanded ? SIDEBAR_STRINGS.collapse : SIDEBAR_STRINGS.expand;
  return (
    <aside
      data-layer="Seitenleiste"
      data-expanded={expanded ? "" : undefined}
      aria-label={SIDEBAR_LABEL}
      className="sticky top-[calc(4rem+env(safe-area-inset-top,0px))] z-30 flex h-[calc(100dvh-4rem-env(safe-area-inset-top,0px))] shrink-0 flex-col self-start border-r border-line bg-ink-900"
      style={{ width: expanded ? SIDEBAR_WIDTH.wide : SIDEBAR_WIDTH.rail }}
    >
      <div className={cn("shrink-0 pt-4", expanded ? "px-3" : "px-2")}>
        {expanded ? (
          <NewTradeButton wrapClassName="flex w-full" className="min-h-tap w-full justify-center" />
        ) : (
          <div className="flex justify-center">
            <NewTradeButton className="!size-11 !justify-center !p-0" labelClassName="sr-only" />
          </div>
        )}
      </div>
      <nav ref={nav} id={id} aria-label={SIDEBAR_LABEL} className={cn("relative min-h-0 flex-1 overflow-y-auto overscroll-contain pb-3 pt-3", expanded ? "px-3" : "px-2")}>
        {/* the marker: one rounded plate behind the active row, travelling on `spring.layout` (transform only) */}
        <motion.span aria-hidden="true" data-sidebar-marker="" className={cn("pointer-events-none absolute top-0 h-11 rounded-xl bg-white/[0.07]", expanded ? "inset-x-3" : "inset-x-2")} style={{ y, opacity: markerOpacity }} />
        {NAV_GROUPS.map((g, i) => (
          <div key={g.id} role="group" aria-label={g.label} data-testid="sidebar-group" data-group={g.id} className={cn(i > 0 && "mt-3")}>
            {expanded ? (
              <button
                type="button"
                onClick={() => toggleGroup(g.id)}
                aria-expanded={groupOpen(g.id)}
                aria-controls={`${id}-${g.id}`}
                data-testid="sidebar-group-toggle"
                className="group/gt flex min-h-tap w-full items-center gap-2 rounded-xl px-2.5 text-left font-mono text-[10.5px] font-semibold uppercase tracking-[0.16em] text-mute outline-none transition-colors duration-200 hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-white"
              >
                <span aria-hidden="true" className="size-3.5 text-mute [&>svg]:size-full">
                  <Icon name={NAV_GROUP_ICON[g.id]} />
                </span>
                <span className="min-w-0 flex-1 truncate">{g.label}</span>
                <span aria-hidden="true" className={cn("size-3.5 shrink-0 transition-transform duration-300 ease-out [&>svg]:size-full", groupOpen(g.id) ? "-rotate-90" : "rotate-180")}>
                  <Icon name="chevron-left" />
                </span>
              </button>
            ) : (
              i > 0 && <hr aria-hidden="true" className="mx-3 mb-2 border-line-2" />
            )}
            {/* a folded group keeps its rows in the DOM (inert, 0 high) so the marker and the page reach them without a remount */}
            <div id={`${id}-${g.id}`} inert={!groupOpen(g.id)} className={cn("grid transition-[grid-template-rows] duration-300 [transition-timing-function:cubic-bezier(.22,1,.36,1)]", groupOpen(g.id) ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}>
              <ul className="grid min-h-0 gap-0.5 overflow-hidden">
                {g.pages.map((p) => (
                  <li key={p}>
                    <Row page={p} current={page === p} expanded={expanded} onGo={onGo} />
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ))}
      </nav>
      <div className={cn("shrink-0 border-t border-line py-2", expanded ? "px-3" : "px-2")}>
        <LegalRow expanded={expanded} />
        <button
          type="button"
          onClick={() => setPref("sidebar", expanded ? "closed" : "open")}
          aria-label={toggle}
          aria-expanded={expanded}
          aria-controls={id}
          data-testid="sidebar-toggle"
          className={cn(
            "group/toggle flex h-11 w-full items-center rounded-xl text-mute outline-none transition-colors duration-200 hover:bg-white/[0.05] hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-white",
            expanded ? "gap-3 px-2.5" : "justify-center",
          )}
        >
          <span aria-hidden="true" className={cn("grid size-7 shrink-0 place-items-center transition-transform duration-300 ease-out [&>svg]:size-[18px]", !expanded && "rotate-180")}>
            <Icon name="chevron-left" />
          </span>
          {expanded && (
            <span aria-hidden="true" className="truncate text-[12.5px] font-medium">
              Einklappen
            </span>
          )}
        </button>
      </div>
    </aside>
  );
}

/** The sidebar, from 768 px; nothing below. The hook order never changes: the panel is a component of its own. */
export function Sidebar() {
  const wide = useMediaQuery(WIDE_QUERY, false);
  return wide ? <SidebarPanel /> : null;
}

export { NEW_TRADE_LABEL };
