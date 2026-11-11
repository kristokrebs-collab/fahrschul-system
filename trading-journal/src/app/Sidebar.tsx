/**
 * Sidebar from 768 px (Etappe 1a): the four groups – Erfassen, Prüfen, Auswerten, Konto & Rechtliches – with all 19 pages, the
 * primary action „Trade eintragen“ and the search on top, the night-mode switch, the user card and the pin at the foot. Below 768 px the
 * floating bar (`Dock.tsx`) and the menu behind „Mehr“ carry the same groups; the two never exist together (`useMediaQuery(WIDE_QUERY)`).
 *
 * Runde 11 – COMPACT on every desktop width (it used to open by itself from 1,624 px): a narrow glass rail of 64 px – icons, names as
 * `aria-label` – that opens over the page to the full 256 px panel, and „Anheften“ (the pin at the foot) as the reader's choice to keep the
 * panel open and let the page make room. The choice is kept (`uiStore.sidebar`: `open` = pinned; `auto` = compact; the old `closed` is read as
 * `auto`). Pinned or not, the page never loses room it was laid out with unless the reader pins.
 *
 * The rail "peeks": while the pointer rests on it, keyboard focus is inside it, or after a touch (the foot button, a long press on a row, a tap
 * on the search) it opens over the page – an OVERLAY, the page keeps the 64 px it reserved and does not move (`useSidebarPeek`). The panel is
 * always laid out at 256 px and clipped to the rail's 64 (`clip-path`, `shell-motion.css`); opening moves three things on ONE spring written
 * as a CSS `linear()` curve – the clip, the edge line and the cast shade (the last two are transforms) – so they never disagree. The rows, the
 * marker, the search and the dividers are 48 px wide at rest and as wide as the panel once it is open (a box is its hit area), and the labels
 * slide and fade in one after the other, top to bottom (`--i`). Nothing is laid out per frame, no JS runs per frame, no custom property is
 * animated (an inherited one restyles the whole sidebar every frame – measured). Pinned open, nothing is clipped and the group titles (44 px
 * buttons) fold their rows on the same spring; the sections of Einstellungen then show as nested entries under their row.
 *
 * Material: frosted glass from the existing tokens (`ink-900` at 90 %, blur only while the panel is open – at rest nothing moves under the rail), solid
 * where `backdrop-filter` is missing or the safe-effects flag is set. The plan's motion profile (`html[data-motion-tier]`, `motion/tier.ts`) deepens it.
 *
 * Marker: one plate behind the active row glides from row to row (`spring.layout`, a transform written by `animate`, no layout
 * projection) and stretches a little while it travels; the red dot rides on it; Premium and Team plans get one border-beam lap on it whenever the
 * panel opens. First load (Runde 12): the rows wave in from the top, row by row (80 ms apart, 420 ms each, 14 px, a touch of blur, opacity) and the icons
 * draw themselves STRICTLY one after the other (`stroke-dashoffset`, `sidebarSequence` in `shellFx.ts`) – once per page load, only once the
 * intro's stage has lifted (it used to run under the stage, unseen), never on hover, a route change or a re-render; reduced motion: all at once.
 * Keys: ↑ ↓ Home End move between rows, Esc closes the peek. Each row preloads its page chunk on intent. Rows are 44 px tall and never overlap.
 */
import { animate, motion, useMotionValue, useTransform, useVelocity } from "motion/react";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent } from "react";
import { NEW_PAGES, readVisitedPages } from "@/app/CommandNav";
import { groupOfPage, NAV_GROUPS, NAV_GROUP_ICON, PAGE_HINT, PAGE_ICON, PAGE_LABELS, WIDE_QUERY } from "@/app/navGroups";
import { NEW_TRADE_LABEL, NewTradeButton } from "@/app/NewTradeButton";
import { preloadPage } from "@/app/pages";
import { applySidebarSequence, markSequenceSeen, prepareStrokes, SB_VARS, SEQ_WAIT_MAX_MS, sequenceSeen, useTabVisible } from "@/app/shellFx";
import { FootButton, NightRow, ROW_TAIL, SettingsEntries, showSettingsEntries, SidebarSearch, SIDEBAR_PART_STRINGS, UserCard } from "@/app/SidebarParts";
import { useSidebarPeek } from "@/app/useSidebarPeek";
import { introCoversApp } from "@/intro/introBoot";
import { useIntroPhase } from "@/intro/introStore";
import { LEGAL_LABEL, legalConfig, legalShown, type LegalDoc } from "@/legal/config";
import { LegalLinks } from "@/legal/LegalLinks";
import { openLegal } from "@/legal/store";
import { cn } from "@/lib/cn";
import { spring } from "@/motion/tokens";
import { useMotionTier } from "@/motion/tier";
import { useCanHover, useMediaQuery } from "@/motion/useMediaQuery";
import { useReducedFx } from "@/motion/useReducedFx";
import { BorderBeam } from "@/primitives/BorderBeam";
import { Icon } from "@/primitives/icons";
import { useJournal } from "@/store/journalStore";
import { navigate } from "@/store/router";
import { NAV_GROUP_IDS, useUi, type NavGroupId, type Page } from "@/store/uiStore";

export const SIDEBAR_WIDTH = { wide: 256, rail: 64 } as const;
export const SIDEBAR_LABEL = "Hauptnavigation";
export const SIDEBAR_STRINGS = { unpin: "Seitenleiste lösen", pin: "Seitenleiste anheften", legal: "Rechtliches", unpinWord: "Lösen", pinWord: "Anheften" } as const;

/** Below this screen height the wide sidebar folds every group but the current one until the reader chooses (19 rows of 44 px do not fit). */
export const SIDEBAR_SHORT_QUERY = "(max-height: 1299px)";
/**
 * So low (a phone held sideways, 844 × 390) that the fixed head and foot leave the page list no room: measured 22 px for 19 pages
 * (Funktionsprüfung Runde 13). There the whole sidebar scrolls as one column instead of the list between head and foot.
 */
export const SIDEBAR_TINY_QUERY = "(max-height: 560px)";

/** The groups a short screen folds by default: the long list of evaluation pages and the account group – Erfassen (Trades …) and Prüfen (Übersicht, Markt …) stay open. */
const FOLD_WHEN_SHORT: readonly NavGroupId[] = ["auswerten", "konto"];

/**
 * A row's top inside `box`, whatever sits in between: `offsetTop` is measured from the nearest ancestor that is a containing block, and
 * while the first-load wave runs every `li` of the list is one (its entrance animates a transform) – the row then reports 0, the marker
 * was parked at the top of the list and stayed there until the next page change (seen on every reload: the plate sat above „Trades“,
 * far above „Berichte“). Walking the `offsetParent` chain up to the box gives the row's resting place; transforms do not count in it.
 */
export function offsetTopWithin(el: HTMLElement, box: HTMLElement | null): number {
  let top = 0;
  for (let n: HTMLElement | null = el; n && n !== box; n = n.offsetParent as HTMLElement | null) top += n.offsetTop;
  return top;
}

/** Pure: the folded groups. An explicit choice wins; otherwise a short screen folds Auswerten and Konto & Rechtliches unless one of them holds the current page. */
export function closedGroups(stored: readonly NavGroupId[] | null, short: boolean, current: NavGroupId): readonly NavGroupId[] {
  if (stored) return stored;
  return short ? NAV_GROUP_IDS.filter((g) => g !== current && FOLD_WHEN_SHORT.includes(g)) : [];
}

/** Pure: is the sidebar pinned open (and the page makes room for it)? Only the reader's `open`; `auto` – and the old `closed` – are the compact rail. */
export function sidebarExpanded(pref: "auto" | "open" | "closed"): boolean {
  return pref === "open";
}

/** What a row can carry besides its name: the count of entries on Trades (honest: the journal's own number) and the „Neu“ tag of a page of the last release. */
interface RowBadge {
  count?: number;
  fresh?: boolean;
}

function Row({ page, current, expanded, open, badge, onGo }: { page: Page; current: boolean; expanded: boolean; open: boolean; badge: RowBadge; onGo: (p: Page, e: MouseEvent<HTMLAnchorElement>) => void }) {
  const label = PAGE_LABELS[page];
  return (
    <a
      href={`#${page}`}
      data-nav-page={page}
      aria-current={current ? "page" : undefined}
      // the rail has no room for words: the name is the accessible name (the words are there, clipped, for the peek) and, as long as the
      // names are not open, the tooltip (a dismissed peek, a pointer that never opened it) – open, the words say it and a tooltip would double them
      aria-label={expanded ? undefined : label}
      title={open ? undefined : label}
      aria-description={badge.fresh ? SIDEBAR_PART_STRINGS.fresh : badge.count !== undefined ? `${badge.count} Einträge` : undefined}
      onClick={(e) => onGo(page, e)}
      onPointerEnter={() => preloadPage(page)}
      onFocus={() => preloadPage(page)}
      onPointerDown={() => preloadPage(page)}
      className={cn("sb-row group/row relative flex h-11 items-center gap-3 rounded-xl px-2.5 text-fg", ROW_TAIL, current ? "text-fg" : "text-mute hover:text-fg")}
    >
      <span aria-hidden="true" className="sb-ico relative grid size-7 shrink-0 place-items-center [&>svg]:size-[18px]">
        <Icon name={PAGE_ICON[page]} />
        {/* the rail's tag: a red dot on the icon; the open panel says „Neu“ in words instead */}
        {badge.fresh && <span className="absolute right-0 top-0.5 size-1.5 rounded-full bg-signal group-data-[open]/sb:hidden" />}
      </span>
      <span className="sb-lbl grid min-w-0 flex-1">
        <span className={cn("truncate text-[13.5px] leading-tight", current ? "font-semibold text-fg" : "font-medium")}>{label}</span>
        <span className="truncate text-[11px] leading-tight text-mute">{PAGE_HINT[page]}</span>
      </span>
      {badge.fresh && (
        <span aria-hidden="true" className="sb-tag shrink-0 rounded-full bg-signal px-1.5 text-[10px] font-semibold uppercase leading-4 tracking-[0.06em] text-(--color-on-fill)">
          {SIDEBAR_PART_STRINGS.fresh}
        </span>
      )}
      {badge.count !== undefined && (
        <span aria-hidden="true" className="sb-tag shrink-0 rounded-full border border-line-2 bg-white/[0.05] px-1.5 font-mono text-[10.5px] leading-[18px] text-mute">
          {badge.count > 999 ? "999+" : badge.count}
        </span>
      )}
    </a>
  );
}

function LegalRow({ expanded, open, index }: { expanded: boolean; open: boolean; index: number }) {
  if (!legalShown()) return null;
  const docs: LegalDoc[] = ["impressum", "datenschutz", "agb"];
  if (legalConfig().urls.widerruf) docs.push("widerruf");
  if (!expanded) {
    return (
      <FootButton
        index={index}
        open={open}
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
  return <LegalLinks roomy extended={false} className="-mx-1" />;
}

function SidebarPanel() {
  const page = useUi((s) => s.page);
  const pref = useUi((s) => s.sidebar);
  const setPref = useUi((s) => s.setPref);
  const short = useMediaQuery(SIDEBAR_SHORT_QUERY, false);
  const tiny = useMediaQuery(SIDEBAR_TINY_QUERY, false);
  const canHover = useCanHover();
  const storedClosed = useUi((s) => s.sidebarClosed);
  const expanded = sidebarExpanded(pref);
  const tier = useMotionTier();
  const tradeCount = useJournal((st) => st.trades.length);
  // pages of the last release carry „Neu“ until they were opened once; the page you are on is not new to you
  const fresh = useMemo(() => {
    const seen = readVisitedPages();
    return new Set(NEW_PAGES.filter((p) => !seen.includes(p) && p !== page));
  }, [page]);
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

  // first load (Runde 12): the rows wave in from the top and the glyphs draw one after the other – once per page load, never under reduced
  // motion, and not before anyone can see it: while the intro's stage covers the app (or is about to – the first render comes before the stage
  // starts) and while the tab is hidden it waits. It used to start at mount, played under the stage and was used up.
  const phase = useIntroPhase();
  const visible = useTabVisible();
  const covered = introCoversApp(phase);
  const [drawState, setDraw] = useState<"wait" | "run" | null>(() => (reduced || sequenceSeen() ? null : "wait"));
  // waiting is derived, not stored: it runs from the moment the app is in view
  const draw = drawState === "wait" && !covered && visible ? "run" : drawState;
  const seqMs = useRef(0);
  useLayoutEffect(() => {
    if (!draw) return;
    prepareStrokes(frame.current);
    if (draw === "run") seqMs.current = applySidebarSequence(frame.current);
  }, [draw]);
  useEffect(() => {
    if (draw !== "run") return;
    markSequenceSeen();
    const t = setTimeout(() => setDraw(null), seqMs.current + 150);
    return () => clearTimeout(t);
  }, [draw]);
  // nothing stays invisible: should the wait never end although the tab is seen (a stage that does not lift), the rows simply show
  useEffect(() => {
    if (draw !== "wait" || !visible) return;
    const t = setTimeout(() => setDraw(null), SEQ_WAIT_MAX_MS);
    return () => clearTimeout(t);
  }, [draw, visible]);

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
    const top = offsetTopWithin(el, nav.current);
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

  // the sidebar scrolls on a short screen: the page you are on is always in view – also while its group is still unfolding (the box grows on the spring:
  // the resize observer below looks again until `keepInView` is over)
  const keepInView = useRef(0);
  // with the nested sections showing (pinned, on Einstellungen) the row goes to the top so its sections follow it into view
  const rowAt: ScrollLogicalPosition = showSettingsEntries(page, expanded) ? "start" : "nearest";
  useLayoutEffect(() => {
    const el = nav.current?.querySelector<HTMLElement>(`[data-nav-page="${page}"]`);
    keepInView.current = performance.now() + 900;
    if (el && currentOpen) el.scrollIntoView?.({ block: rowAt, behavior: "instant" });
  }, [page, currentOpen, rowAt]);

  // a group folds / unfolds (its rows grow and shrink with the spring) or the font changes the rows: the marker stays on its row
  useEffect(() => {
    const box = nav.current;
    if (!box || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      const el = box.querySelector<HTMLElement>(`[data-nav-page="${page}"]`);
      if (el) y.jump(offsetTopWithin(el, box));
      if (el && performance.now() < keepInView.current) el.scrollIntoView?.({ block: rowAt, behavior: "instant" });
    });
    for (const child of Array.from(box.children)) if (child !== box.querySelector("[data-sidebar-marker]")) ro.observe(child);
    return () => ro.disconnect();
  }, [page, y, rowAt]);

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
      if (el) y.jump(offsetTopWithin(el, nav.current));
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

  // the pin at the foot: keeps the panel open (the page makes room) / lets go. On a touch screen (no hover to peek with) the first tap on the
  // rail opens the names over the page, the next one pins it
  const onToggle = () => {
    if (expanded) setPref("sidebar", "auto");
    else if (!canHover && !peek.open) peek.hold();
    else setPref("sidebar", "open");
  };
  const toggle = expanded ? SIDEBAR_STRINGS.unpin : SIDEBAR_STRINGS.pin;

  // ↑ ↓ Home End move between the rows, the group titles and the nested entries (Tab still walks them all; the search keeps its own arrows)
  const onNavKey = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") return;
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>("a[data-nav-page], [data-testid='sidebar-group-toggle'], [data-sub]")).filter((el) => !el.closest("[inert]"));
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (at < 0 || items.length === 0) return;
    e.preventDefault();
    const to = e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : Math.max(0, Math.min(items.length - 1, at + (e.key === "ArrowDown" ? 1 : -1)));
    items[to]?.focus();
  };
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
        className="sb group/sb pointer-events-none sticky top-[calc(4rem+env(safe-area-inset-top,0px))] z-30 h-[calc(100dvh-4rem-env(safe-area-inset-top,0px))] w-64 data-[open]:z-[46]"
      >
        <aside
          data-layer="Seitenleiste"
          data-expanded={expanded ? "" : undefined}
          data-open={open ? "" : undefined}
          aria-label={SIDEBAR_LABEL}
          data-tiny={tiny ? "" : undefined}
          className={cn("sb-aside pointer-events-auto absolute inset-0 flex flex-col", tiny && "overflow-y-auto overscroll-contain")}
          {...peek.bind}
        >
          <div className={cn("shrink-0 pb-1 pt-4", expanded ? "px-3" : "pl-2.5")}>
            {expanded ? <NewTradeButton wrapClassName="flex w-full" className="min-h-tap w-full justify-center" /> : <NewTradeButton className="!size-11 !justify-center !p-0" labelClassName="sr-only" />}
          </div>
          <div className="shrink-0 px-2 pb-1">
            <SidebarSearch />
          </div>
          <nav ref={nav} id={id} aria-label={SIDEBAR_LABEL} onKeyDown={onNavKey} className={cn("relative px-2 pb-3", tiny ? "shrink-0" : "min-h-0 flex-1 overflow-y-auto overscroll-contain", expanded ? "pt-3" : "pt-2.5")}>
            {/* the marker: one rounded plate behind the active row, travelling on `spring.layout` (transform only); the dot rides on it */}
            <motion.span aria-hidden="true" data-sidebar-marker="" className="sb-mark glass-on pointer-events-none absolute left-2 top-0 h-11 rounded-xl" style={{ y, opacity: markerOpacity, scaleY: stretch }}>
              <span className="sb-dot absolute right-2.5 top-[19px] size-1.5 rounded-full bg-signal" />
              {/* Premium and Team: one border-beam lap on the plate each time the panel opens (the plan's motion profile, `motion/tier.ts`) */}
              {(tier === "premium" || tier === "team") && !reduced && <BorderBeam size={60} borderWidth={1} fire={open ? "open" : 0} />}
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
                      <span className="sb-lbl absolute -left-0.5 top-1/2 -translate-y-1/2 whitespace-nowrap font-mono text-[10px] font-semibold uppercase leading-3 tracking-[0.16em] text-mute">{g.label}</span>
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
                          <Row page={p} current={page === p} expanded={expanded} open={open} badge={{ fresh: fresh.has(p) || undefined, count: p === "trades" && tradeCount > 0 ? tradeCount : undefined }} onGo={onGo} />
                          {p === "settings" && <SettingsEntries visible={showSettingsEntries(page, expanded)} />}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              );
            })}
          </nav>
          <div className="shrink-0 border-t border-line px-2 py-2">
            <LegalRow expanded={expanded} open={open} index={rows} />
            <NightRow index={rows + 1} open={open} />
            <UserCard index={rows + 2} current={page === "konto"} open={open} />
            <FootButton
              index={rows + 3}
              open={open}
              word={expanded ? SIDEBAR_STRINGS.unpinWord : SIDEBAR_STRINGS.pinWord}
              icon={
                <span aria-hidden="true" className={cn("grid size-7 shrink-0 place-items-center transition-[rotate,opacity] duration-300 ease-out [&>svg]:size-[18px]", expanded ? "rotate-0 text-fg" : "-rotate-45")}>
                  <Icon name="pin" />
                </span>
              }
              onClick={onToggle}
              aria-label={toggle}
              aria-pressed={expanded}
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
