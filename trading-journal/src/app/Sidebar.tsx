/**
 * Sidebar from 768 px (Etappe 1a): the four groups – Erfassen, Prüfen, Auswerten, Konto & Rechtliches – with all 19 pages, the
 * primary action „Trade eintragen“ on top and a collapse button at the foot. Below 768 px the bottom bar (`Dock.tsx`) and the
 * menu behind „Mehr“ carry the same groups; the two never exist together (`useMediaQuery(WIDE_QUERY)`).
 *
 * Wide (≥ 1624 px, or when the reader pinned it open): 256 px – group titles, page names with their plain-word hint. Narrow rail
 * (768 – 1623 px by default, or when the reader closed it): 64 px – icons, names as `aria-label`. The choice is kept
 * (`uiStore.sidebar`: auto | open | closed, stored in `tj2-ui`). The rail's width never costs a page its room: `auto` collapses
 * exactly where the pages need it.
 *
 * Runde 10 – the rail "peeks": while the pointer rests on it, keyboard focus is inside it, or after a touch (the foot button, a long
 * press on a row) it opens over the page to the full 256 px – an OVERLAY, the page keeps the 64 px it reserved and does not move
 * (`useSidebarPeek`). The panel is always laid out at 256 px and clipped to the rail's 64 (`clip-path`, `shell-motion.css`); opening
 * moves three things on ONE spring written as a CSS `linear()` curve – the clip, the edge line and the cast shade (the last two are
 * transforms) – so they never disagree. The rows, the marker and the dividers are 48 px wide at rest and as wide as the panel once it
 * is open (a box is its hit area), and the labels slide and fade in one after the other, top to bottom (`--i`). Nothing is laid out
 * per frame, no JS runs per frame, no custom property is animated (an inherited one restyles the whole sidebar every frame – measured).
 * Pinned open, nothing is clipped and the group titles (44 px buttons) fold their rows on the same spring.
 *
 * Marker: one plate behind the active row glides from row to row (`spring.layout`, a transform written by `animate`, no layout
 * projection) and stretches a little while it travels; the red dot rides on it. First load: the icons draw themselves, row by
 * row from the top, stroke after stroke (`stroke-dashoffset`, once per session, `shellFx.ts`); reduced motion: all at once.
 * Each row preloads its page chunk on intent. Rows are 44 px tall and never overlap.
 */
import { animate, motion, useMotionValue, useTransform, useVelocity } from "motion/react";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import { groupOfPage, NAV_GROUPS, NAV_GROUP_ICON, PAGE_HINT, PAGE_ICON, PAGE_LABELS, WIDE_QUERY } from "@/app/navGroups";
import { NEW_TRADE_LABEL, NewTradeButton } from "@/app/NewTradeButton";
import { preloadPage } from "@/app/pages";
import { DRAW_MS, drawSeen, markDrawSeen, prepareStrokes, SB_VARS } from "@/app/shellFx";
import { useSidebarPeek } from "@/app/useSidebarPeek";
import { useIntroPhase } from "@/intro/introStore";
import { LEGAL_LABEL, legalConfig, legalShown, type LegalDoc } from "@/legal/config";
import { LegalLinks } from "@/legal/LegalLinks";
import { openLegal } from "@/legal/store";
import { cn } from "@/lib/cn";
import { spring } from "@/motion/tokens";
import { useCanHover, useMediaQuery } from "@/motion/useMediaQuery";
import { useReducedFx } from "@/motion/useReducedFx";
import { Icon } from "@/primitives/icons";
import { navigate } from "@/store/router";
import { NAV_GROUP_IDS, useUi, type NavGroupId, type Page } from "@/store/uiStore";

export const SIDEBAR_WIDTH = { wide: 256, rail: 64 } as const;
/**
 * From this width `auto` shows the wide sidebar; below it the rail. 1624 = the page column's 1320 px + its 48 px gutters + the 256 px sidebar:
 * up to there the rail leaves the pages the width they were laid out and reserved for (the Markt page grew 87 px after the first picture
 * beside the wide sidebar at 1440 px – `layout-shift.spec.ts`); whoever opens the wide sidebar below it chooses that trade-off.
 */
export const SIDEBAR_AUTO_QUERY = "(min-width: 1624px)";
export const SIDEBAR_LABEL = "Hauptnavigation";
export const SIDEBAR_STRINGS = { collapse: "Seitenleiste einklappen", expand: "Seitenleiste ausklappen", legal: "Rechtliches", fold: "Einklappen", unfold: "Ausklappen" } as const;

/** Below this screen height the wide sidebar folds every group but the current one until the reader chooses (19 rows of 44 px do not fit). */
export const SIDEBAR_SHORT_QUERY = "(max-height: 1299px)";

/** The groups a short screen folds by default: the long list of evaluation pages and the account group – Erfassen (Trades …) and Prüfen (Übersicht, Markt …) stay open. */
const FOLD_WHEN_SHORT: readonly NavGroupId[] = ["auswerten", "konto"];

/** Pure: the folded groups. An explicit choice wins; otherwise a short screen folds Auswerten and Konto & Rechtliches unless one of them holds the current page. */
export function closedGroups(stored: readonly NavGroupId[] | null, short: boolean, current: NavGroupId): readonly NavGroupId[] {
  if (stored) return stored;
  return short ? NAV_GROUP_IDS.filter((g) => g !== current && FOLD_WHEN_SHORT.includes(g)) : [];
}

/** Pure: is the sidebar wide? `open` / `closed` are the reader's choice; `auto` follows the screen width. */
export function sidebarExpanded(pref: "auto" | "open" | "closed", autoWide: boolean): boolean {
  return pref === "open" || (pref === "auto" && autoWide);
}

const ROW_TAIL = "outline-none transition-colors duration-200 hover:bg-white/[0.05] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-white";

function Row({ page, current, expanded, onGo }: { page: Page; current: boolean; expanded: boolean; onGo: (p: Page, e: MouseEvent<HTMLAnchorElement>) => void }) {
  const label = PAGE_LABELS[page];
  return (
    <a
      href={`#${page}`}
      data-nav-page={page}
      aria-current={current ? "page" : undefined}
      // the rail has no room for words: the name is the accessible name (the words are there, clipped, for the peek)
      aria-label={expanded ? undefined : label}
      onClick={(e) => onGo(page, e)}
      onPointerEnter={() => preloadPage(page)}
      onFocus={() => preloadPage(page)}
      onPointerDown={() => preloadPage(page)}
      className={cn("sb-row group/row relative flex h-11 items-center gap-3 rounded-xl px-2.5 text-fg", ROW_TAIL, current ? "text-fg" : "text-mute hover:text-fg")}
    >
      <span aria-hidden="true" className="sb-ico relative grid size-7 shrink-0 place-items-center [&>svg]:size-[18px]">
        <Icon name={PAGE_ICON[page]} />
      </span>
      <span className="sb-lbl grid min-w-0 flex-1">
        <span className={cn("truncate text-[13.5px] leading-tight", current ? "font-semibold text-fg" : "font-medium")}>{label}</span>
        <span className="truncate text-[11px] leading-tight text-mute">{PAGE_HINT[page]}</span>
      </span>
    </a>
  );
}

/** A foot button of the rail (Rechtliches, Ein-/Ausklappen): the icon stays where the rail's icons are, the word comes with the peek. */
function FootButton({ index, icon, word, ...props }: { index: number; icon: ReactNode; word: string } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" {...props} className={cn("sb-row flex h-11 items-center gap-3 rounded-xl px-2.5 text-mute hover:text-fg", ROW_TAIL, props.className)}>
      {icon}
      <span aria-hidden="true" className="sb-lbl truncate text-[12.5px] font-medium" style={{ "--i": index } as CSSProperties}>
        {word}
      </span>
    </button>
  );
}

function LegalRow({ expanded, index }: { expanded: boolean; index: number }) {
  if (!legalShown()) return null;
  const docs: LegalDoc[] = ["impressum", "datenschutz", "agb"];
  if (legalConfig().urls.widerruf) docs.push("widerruf");
  if (!expanded) {
    return (
      <FootButton
        index={index}
        word={SIDEBAR_STRINGS.legal}
        icon={
          <span aria-hidden="true" className="grid size-7 shrink-0 place-items-center [&>svg]:size-[18px]">
            <Icon name="doc" />
          </span>
        }
        aria-label={`${SIDEBAR_STRINGS.legal}: ${LEGAL_LABEL.impressum}`}
        title={docs.map((d) => LEGAL_LABEL[d]).join(" · ")}
        data-testid="sidebar-legal"
        onClick={() => openLegal("impressum")}
      />
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
  const canHover = useCanHover();
  const storedClosed = useUi((s) => s.sidebarClosed);
  const expanded = sidebarExpanded(pref, autoWide);
  const currentGroup = groupOfPage(page);
  const closed = closedGroups(storedClosed, short, currentGroup);
  // the rail has no group titles: every row is there
  const groupOpen = (g: NavGroupId) => !expanded || !closed.includes(g);
  const currentOpen = groupOpen(currentGroup);
  const reduced = useReducedFx();
  const id = useId();
  const frame = useRef<HTMLDivElement>(null);
  const nav = useRef<HTMLElement>(null);
  const y = useMotionValue(0);
  const markerOpacity = useMotionValue(1);
  // the marker stretches a little in the direction it travels, then settles (a transform, derived from the glide)
  const stretch = useTransform(useVelocity(y), (v) => 1 + Math.min(0.14, Math.abs(v) / 12000));
  const shown = useRef(false);
  const lastExpanded = useRef(expanded);

  const peek = useSidebarPeek(!expanded, canHover, page);
  const open = expanded || peek.open;

  // first load: the icons draw themselves once per session (after the intro's stage, never under reduced motion)
  const phase = useIntroPhase();
  const [drawState, setDraw] = useState<"wait" | "run" | null>(() => (reduced || drawSeen() ? null : phase === "stage" ? "wait" : "run"));
  // waiting for the intro's stage to lift is derived, not stored: the draw runs from the moment the stage is gone
  const draw = drawState === "wait" && phase !== "stage" ? "run" : drawState;
  useLayoutEffect(() => {
    if (draw) prepareStrokes(frame.current);
  }, [draw]);
  useEffect(() => {
    if (draw !== "run") return;
    markDrawSeen();
    const t = setTimeout(() => setDraw(null), DRAW_MS);
    return () => clearTimeout(t);
  }, [draw]);

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

  // a group folds / unfolds (its rows grow and shrink with the spring) or the font changes the rows: the marker stays on its row
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

  const { takeLongPress } = peek;
  const onGo = useCallback(
    (p: Page, e: MouseEvent<HTMLAnchorElement>) => {
      // a new tab / window keeps the plain link
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      // a long press opened the names: the lifted finger does not also open the page
      if (takeLongPress()) return;
      // the page you are on again: back to its top (as the bottom bar's active tab)
      if (p === useUi.getState().page) window.scrollTo({ top: 0, behavior: reduced ? "instant" : "smooth" });
      navigate(p);
    },
    [reduced, takeLongPress],
  );

  // the foot button: pins the sidebar open / closed. On a touch screen (no hover to peek with) the first tap on the rail opens the
  // names over the page, the next one pins it
  const onToggle = () => {
    if (expanded) setPref("sidebar", "closed");
    else if (!canHover && !peek.open) peek.hold();
    else setPref("sidebar", "open");
  };
  const toggle = expanded ? SIDEBAR_STRINGS.collapse : SIDEBAR_STRINGS.expand;
  const rows = NAV_GROUPS.reduce((n, g) => n + g.pages.length, 0);
  let rowIndex = 0;
  return (
    <div data-sidebar-slot="" className="relative shrink-0" style={{ width: expanded ? SIDEBAR_WIDTH.wide : SIDEBAR_WIDTH.rail }}>
      {/* the frame is always 256 px wide and never takes a pointer: what shows (and what answers) is the clipped aside; the edge line and
          the cast shade ride outside the clip, on the same spring */}
      <div
        ref={frame}
        data-open={open ? "" : undefined}
        data-peek={peek.open ? "" : undefined}
        data-draw={draw ?? undefined}
        style={SB_VARS}
        className="sb pointer-events-none sticky top-[calc(4rem+env(safe-area-inset-top,0px))] z-30 h-[calc(100dvh-4rem-env(safe-area-inset-top,0px))] w-64 data-[open]:z-[46]"
      >
        <aside
          data-layer="Seitenleiste"
          data-expanded={expanded ? "" : undefined}
          data-open={open ? "" : undefined}
          aria-label={SIDEBAR_LABEL}
          className="sb-aside pointer-events-auto absolute inset-0 flex flex-col bg-ink-900"
          {...peek.bind}
        >
          <div className={cn("shrink-0 pb-1 pt-4", expanded ? "px-3" : "pl-2.5")}>
            {expanded ? <NewTradeButton wrapClassName="flex w-full" className="min-h-tap w-full justify-center" /> : <NewTradeButton className="!size-11 !justify-center !p-0" labelClassName="sr-only" />}
          </div>
          <nav ref={nav} id={id} aria-label={SIDEBAR_LABEL} className={cn("relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-3", expanded ? "pt-3" : "pt-0")}>
            {/* the marker: one rounded plate behind the active row, travelling on `spring.layout` (transform only); the dot rides on it */}
            <motion.span aria-hidden="true" data-sidebar-marker="" className="sb-mark pointer-events-none absolute left-2 top-0 h-11 rounded-xl bg-white/[0.07]" style={{ y, opacity: markerOpacity, scaleY: stretch }}>
              <span className="sb-dot absolute right-2.5 top-[19px] size-1.5 rounded-full bg-signal" />
            </motion.span>
            {NAV_GROUPS.map((g, i) => {
              const first = rowIndex;
              const groupRows = g.pages.map((p) => ({ p, index: rowIndex++ }));
              return (
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
                      <span
                        aria-hidden="true"
                        className={cn("size-3.5 shrink-0 transition-transform [transition-duration:var(--sb-ms)] [transition-timing-function:var(--sb-ease)] [&>svg]:size-full", groupOpen(g.id) ? "-rotate-90" : "rotate-180")}
                      >
                        <Icon name="chevron-left" />
                      </span>
                    </button>
                  ) : (
                    // the rail's divider; with the peek the group's name sits on it (a passive label – the group has its aria-label)
                    <div aria-hidden="true" className={cn("relative mx-3 h-px", i === 0 ? "my-1.5" : "mb-2")} style={{ "--i": first } as CSSProperties}>
                      <span className={cn("sb-line absolute inset-y-0 left-0 bg-line-2", i === 0 && "opacity-0")} />
                      <span className="sb-lbl absolute -left-0.5 top-1/2 -translate-y-1/2 whitespace-nowrap bg-ink-900 pr-2 font-mono text-[10px] font-semibold uppercase leading-3 tracking-[0.16em] text-mute">{g.label}</span>
                    </div>
                  )}
                  {/* a folded group keeps its rows in the DOM (inert, 0 high) so the marker and the page reach them without a remount */}
                  <div
                    id={`${id}-${g.id}`}
                    inert={!groupOpen(g.id)}
                    data-fold={groupOpen(g.id) ? "open" : "closed"}
                    className={cn("grid transition-[grid-template-rows] [transition-duration:var(--sb-ms)] [transition-timing-function:var(--sb-ease)]", groupOpen(g.id) ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}
                  >
                    <ul className="sb-rows grid min-h-0 gap-0.5 overflow-hidden">
                      {groupRows.map(({ p, index }, j) => (
                        <li key={p} style={{ "--i": index, "--j": j } as CSSProperties}>
                          <Row page={p} current={page === p} expanded={expanded} onGo={onGo} />
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              );
            })}
          </nav>
          <div className="shrink-0 border-t border-line px-2 py-2">
            <LegalRow expanded={expanded} index={rows} />
            <FootButton
              index={rows + 1}
              word={expanded ? SIDEBAR_STRINGS.fold : SIDEBAR_STRINGS.unfold}
              icon={
                <span aria-hidden="true" className={cn("grid size-7 shrink-0 place-items-center transition-transform duration-300 ease-out [&>svg]:size-[18px]", !expanded && "rotate-180")}>
                  <Icon name="chevron-left" />
                </span>
              }
              onClick={onToggle}
              aria-label={toggle}
              aria-expanded={expanded}
              aria-controls={id}
              data-testid="sidebar-toggle"
            />
          </div>
        </aside>
        <span aria-hidden="true" className="sb-edge pointer-events-none absolute inset-y-0 left-0 w-px bg-line" />
        <span aria-hidden="true" className="sb-shade pointer-events-none absolute inset-y-0 left-0 w-7" />
      </div>
    </div>
  );
}

/** The sidebar, from 768 px; nothing below. The hook order never changes: the panel is a component of its own. */
export function Sidebar() {
  const wide = useMediaQuery(WIDE_QUERY, false);
  return wide ? <SidebarPanel /> : null;
}

export { NEW_TRADE_LABEL };
