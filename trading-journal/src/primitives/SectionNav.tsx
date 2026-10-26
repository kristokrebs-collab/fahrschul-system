/**
 * `SectionNav` – the quiet "Inhalt" of a long page: one strip of chips under the page header, one chip per section, a tap
 * scrolls the section under the header and lets its title answer once (`revealSection`). It sits in the flow of the page
 * (no jump when it sticks) and sticks under the header while the page scrolls; the section in view is marked
 * (`aria-current="location"`) and its chip scrolls into the strip. Nothing here changes the page below it: the sections only need
 * a stable `data-section="<id>"` (or a `data-testid` / `id` of the same value) on the element that starts them.
 *
 *   <SectionNav items={[{ id: "setups", label: "Setups" }, …]} />
 *
 * Landmark: `nav` with the label "Inhalt dieser Seite"; the chips are buttons (a hash link would be read as a page by the
 * router). Keyboard: Tab, ←/→/Home/End inside the strip, Enter / Space. Coarse pointers: chips ≥ 44 px tall. Reduced motion:
 * jumps instead of scrolling, no pulse. While mounted it tells the document how tall it is (`--section-nav-h`), so that
 * `scroll-padding-top` (base.css) keeps every scroll target – from the nav, from "Alle Funktionen", from the search – clear of it.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { revealSection } from "@/app/reveal";
import { cn } from "@/lib/cn";
import { canObserveInView } from "@/motion/inView";
import { prefersReducedMotion } from "@/motion/pulse/engine";
import { SECTION_NAV_BOX } from "@/primitives/sectionNavBox";

export interface SectionNavItem {
  /** `data-section` of the section's first element (else its `data-testid`, else its `id`) */
  id: string;
  label: string;
  /** a card without any of those: found by the start of its heading (`h2` / `h3`) – the card around it is the target */
  heading?: string;
}

/** The header is `h-16` and sticks at the top; the strip sticks right under it. */
export const SECTION_NAV_TOP = "calc(env(safe-area-inset-top, 0px) + 64px)";
/** Height of the header (px) – the line a section has to cross to count as "the one in view" (plus the strip). */
const HEADER_PX = 64;

const esc = (s: string): string => (typeof CSS !== "undefined" && CSS.escape ? CSS.escape(s) : s.replace(/"/g, '\\"'));

/** The element that starts section `id` inside `root` (the page layer): `data-section`, else `data-testid`, else `id`, else the card of the heading. */
export function findSection(root: ParentNode, id: string, heading?: string): HTMLElement | null {
  const direct =
    root.querySelector<HTMLElement>(`[data-section="${esc(id)}"]`) ?? root.querySelector<HTMLElement>(`[data-testid="${esc(id)}"]`) ?? root.querySelector<HTMLElement>(`[id="${esc(id)}"]`);
  if (direct || !heading) return direct;
  const h = Array.from(root.querySelectorAll<HTMLElement>("h2, h3")).find((x) => (x.textContent ?? "").replace(/\s+/g, " ").trim().startsWith(heading));
  return h ? (h.closest<HTMLElement>(".rounded-2xl") ?? h) : null;
}

/**
 * `findSection` for many ids against one DOM state: the `data-section` markers (the usual case) are read in ONE pass and the
 * heading list at most once, instead of three selector scans (and a heading scan) per id on every look – on a long page that
 * was the single most expensive thing the strip did while the page was being mounted (Feinschliff 2026-10).
 */
export function sectionFinder(root: ParentNode): (id: string, heading?: string) => HTMLElement | null {
  let marked: Map<string, HTMLElement> | undefined;
  let headings: HTMLElement[] | undefined;
  return (id, heading) => {
    if (!marked) {
      marked = new Map();
      for (const el of Array.from(root.querySelectorAll<HTMLElement>("[data-section]"))) {
        const key = el.getAttribute("data-section");
        if (key && !marked.has(key)) marked.set(key, el);
      }
    }
    const direct = marked.get(id) ?? root.querySelector<HTMLElement>(`[data-testid="${esc(id)}"]`) ?? root.querySelector<HTMLElement>(`[id="${esc(id)}"]`);
    if (direct || !heading) return direct;
    headings ??= Array.from(root.querySelectorAll<HTMLElement>("h2, h3"));
    const h = headings.find((x) => (x.textContent ?? "").replace(/\s+/g, " ").trim().startsWith(heading));
    return h ? (h.closest<HTMLElement>(".rounded-2xl") ?? h) : null;
  };
}

const NONE: ReadonlySet<string> = new Set();

/** The strip that currently tells the document its height (see the effect in `SectionNav`). */
let heightOwner: symbol | null = null;

/** The page layer the strip belongs to (so another kept-alive page with the same ids is never the target). */
const layerOf = (el: Element | null): ParentNode => el?.closest("[data-page]") ?? document;

/**
 * Which section is "in view": the last one whose start has passed the line under the header and the strip. `missing`: the
 * sections that are not on the page after a few seconds of looking (a card behind a plan gate, a lazy part that failed) – their
 * chips are dropped instead of pointing nowhere.
 */
function useActiveSection(items: readonly SectionNavItem[], nav: RefObject<HTMLElement | null>): { active: string | undefined; missing: ReadonlySet<string> } {
  const [seen, setSeen] = useState<string | undefined>();
  const [lostFor, setLostFor] = useState<{ key: string; ids: ReadonlySet<string> }>({ key: "", ids: NONE });
  // the effect depends on the sections, not on the identity of the array the page builds each render
  const key = JSON.stringify(items.map((i) => [i.id, i.heading ?? ""]));
  useEffect(() => {
    const pairs = JSON.parse(key) as [string, string][];
    const ids = pairs.map(([id]) => id);
    const headingOf = new Map(pairs.map(([id, h]) => [id, h || undefined] as const));
    if (!ids.length) return;
    const root = layerOf(nav.current);
    const passed = new Map<string, boolean>();
    const idOf = new Map<Element, string>();
    const compute = (): void => {
      // the observer reports only crossings of the band: a jump over it (back to the top, down to the end) leaves sections marked as
      // passed that are not. Where the page has a layout (a zero-height box means none), read the truth from the boxes.
      for (const [el, id] of idOf) {
        const r = el.getBoundingClientRect();
        if (r.height > 0) passed.set(id, r.top < window.innerHeight * 0.45);
      }
      let last: string | undefined;
      for (const id of ids) if (passed.get(id)) last = id;
      setSeen(last ?? ids[0]);
    };
    // the band: from just under the strip down to 45 % of the viewport – a section counts once its start is in it or above it
    const line = HEADER_PX + (nav.current?.offsetHeight ?? 48) + 8;
    const onEntries: IntersectionObserverCallback = (entries) => {
      for (const e of entries) {
        const id = idOf.get(e.target);
        if (!id) continue;
        passed.set(id, e.isIntersecting || e.boundingClientRect.top < (e.rootBounds?.top ?? line));
      }
      compute();
    };
    const io = canObserveInView() ? new IntersectionObserver(onEntries, { rootMargin: `-${line}px 0px -55% 0px`, threshold: 0 }) : null;
    const seen = new Set<Element>();
    const lost = new Set<string>();
    const found = new Set<string>();
    const attach = (): boolean => {
      lost.clear();
      // sections already attached are not looked for again; one finder (one DOM pass) per look
      const find = sectionFinder(root);
      for (const id of ids) {
        if (found.has(id)) continue;
        const el = find(id, headingOf.get(id));
        if (!el) {
          lost.add(id);
          continue;
        }
        found.add(id);
        if (seen.has(el)) continue;
        seen.add(el);
        idOf.set(el, id);
        io?.observe(el);
      }
      return lost.size === 0;
    };
    // sections of lazy cards appear a moment later: look again for a few seconds, then drop what is not there
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = (): void => {
      if (attach()) return;
      if (++tries > 12) {
        setLostFor({ key, ids: new Set(lost) });
        return;
      }
      timer = setTimeout(poll, 250);
    };
    poll();
    return () => {
      if (timer) clearTimeout(timer);
      io?.disconnect();
    };
  }, [key, nav]);
  // what is shown follows the sections of THIS render: a section that left is never "active", a missing one belongs to its own list
  const active = seen && items.some((i) => i.id === seen) ? seen : items[0]?.id;
  return { active, missing: lostFor.key === key ? lostFor.ids : NONE };
}

export function SectionNav({ items, label = "Inhalt", className }: { items: readonly SectionNavItem[]; label?: string; className?: string }) {
  const nav = useRef<HTMLElement>(null);
  const strip = useRef<HTMLUListElement>(null);
  const { active, missing } = useActiveSection(items, nav);
  const shown = items.filter((i) => !missing.has(i.id));
  const first = useRef(true);

  // the document learns how tall the strip is: scroll targets stay clear of it (base.css `scroll-padding-top`). While a page
  // slides out, its strip is still mounted next to the new page's: the last strip to mount owns the value, and only the owner
  // takes it back (an old page unmounting must not wipe the new one's)
  useLayoutEffect(() => {
    const el = nav.current;
    if (!el) return;
    const token = Symbol("section-nav");
    heightOwner = token;
    const set = (): void => {
      if (heightOwner === token) document.documentElement.style.setProperty("--section-nav-h", `${el.offsetHeight}px`);
    };
    // With a ResizeObserver the first value arrives with its first report (after the page's first layout, before paint):
    // reading `offsetHeight` here would force that layout inside the commit and, with the write that follows, lay the whole
    // page out a second time for the layout effects of the cards after the strip. Without one (jsdom) read at once.
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(set) : null;
    if (ro) ro.observe(el);
    else set();
    return () => {
      ro?.disconnect();
      if (heightOwner === token) {
        heightOwner = null;
        document.documentElement.style.removeProperty("--section-nav-h");
      }
    };
  }, []);

  // the chip of the section in view slides into the strip (the strip only, never the page) – but never under a finger or a
  // pointer that is pressing a chip right now: the chip would move away between press and release and the tap would be lost
  const pressed = useRef(false);
  const centre = useCallback((): void => {
    const list = strip.current;
    const chip = list?.querySelector<HTMLElement>('[aria-current="location"]');
    if (!list || !chip) return;
    const left = chip.offsetLeft - (list.clientWidth - chip.offsetWidth) / 2;
    list.scrollTo?.({ left: Math.max(0, left), behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }, []);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (!pressed.current) centre();
  }, [active, centre]);
  const onPress = (): void => {
    pressed.current = true;
    const release = (): void => {
      pressed.current = false;
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
    };
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
  };

  const go = useCallback((item: SectionNavItem, byKeyboard: boolean) => {
    const el = findSection(layerOf(nav.current), item.id, item.heading);
    if (!el) return;
    revealSection(el);
    if (byKeyboard) {
      // reading order follows: the next Tab lands inside the section
      if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "-1");
      el.focus({ preventScroll: true });
    }
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLUListElement>): void => {
    const chips = Array.from(e.currentTarget.querySelectorAll<HTMLElement>("button"));
    const at = chips.indexOf(document.activeElement as HTMLElement);
    const next = e.key === "ArrowRight" ? at + 1 : e.key === "ArrowLeft" ? at - 1 : e.key === "Home" ? 0 : e.key === "End" ? chips.length - 1 : null;
    if (next === null || !chips.length) return;
    e.preventDefault();
    chips[(next + chips.length) % chips.length]?.focus();
  };

  if (shown.length < 2) return null;
  return (
    <nav
      ref={nav}
      aria-label="Inhalt dieser Seite"
      data-testid="section-nav"
      style={{ top: SECTION_NAV_TOP }}
      className={cn("sticky z-30 -mx-4 bg-ink-900 px-4 sm:-mx-6 sm:px-6", SECTION_NAV_BOX, className)}
    >
      <div className="flex items-center gap-3 border-b border-line py-2">
        <span className="label shrink-0 !text-mute">{label}</span>
        <ul ref={strip} onKeyDown={onKeyDown} onPointerDown={onPress} className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto overscroll-x-contain py-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {shown.map((it) => {
            const on = it.id === active;
            return (
              <li key={it.id} className="shrink-0">
                <button
                  type="button"
                  onClick={(e) => go(it, e.detail === 0)}
                  aria-current={on ? "location" : undefined}
                  data-section-chip={it.id}
                  className={cn(
                    "inline-flex min-h-8 items-center justify-center whitespace-nowrap rounded-full border px-3 text-[12.5px] transition-colors duration-200 pointer-coarse:min-h-11 pointer-coarse:min-w-11",
                    on ? "border-white/40 bg-white/[0.07] text-fg" : "border-line-2 text-mute hover:border-white/30 hover:text-fg",
                  )}
                >
                  {it.label}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
