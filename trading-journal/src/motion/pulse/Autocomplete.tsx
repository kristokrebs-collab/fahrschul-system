import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type InputHTMLAttributes, type KeyboardEvent, type Ref } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";
import { prefersReducedMotion } from "@/motion/pulse/engine";
import { useReducedFx } from "@/motion/useReducedFx";
import { Input } from "@/primitives/Input";

/**
 * pulse-motion `autocomplete` (measured): the suggestion panel pops in with a short fade + scale (.92 → 1,
 * origin top centre, 90 ms fast-start ease-out) and leaves with the counter move (80 ms ease-in); switching
 * between results and the empty state is instant (no morph), no spring, no stagger.
 */
export const CONFIG = {
  inMs: 90,
  inEase: "cubic-bezier(.2,.8,.2,1)",
  outMs: 80,
  outEase: "cubic-bezier(.4,0,1,1)",
  scaleFrom: 0.92,
  gap: 6, // pack: panel 47 px below a 41 px field
  edge: 8,
  pad: 7,
  rowH: 39,
  emptyH: 43,
  groupH: 26,
  maxResults: 8,
  minBelow: 140,
  /** Nothing palette (pack: #1f1f1f panel, faint white halo). */
  panelShadow: "0 10px 40px rgb(255 255 255 / 0.04), 0 16px 36px rgb(0 0 0 / 0.5)",
  zIndex: 75,
} as const;

export interface AutocompleteItem {
  value: string;
  label: string;
  group?: string;
}

export interface AutocompleteProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "onSelect" | "className" | "role"> {
  value: string;
  onChange: (value: string) => void;
  suggestions: readonly (string | AutocompleteItem)[];
  /** A suggestion was chosen (the field already shows its label via `onChange`). */
  onSelect?: (item: AutocompleteItem) => void;
  /** Default: case- and diacritics-insensitive substring match on the label. */
  filter?: (item: AutocompleteItem, query: string) => boolean;
  maxResults?: number;
  emptyText?: string;
  /** Classes for the `<input>` (the app's `inputClass` is already applied). */
  inputClassName?: string;
  /** Classes for the input's wrapper (width / grid placement). */
  wrapperClassName?: string;
  ref?: Ref<HTMLInputElement>;
}

/** Lower-case, diacritics stripped – keeps a per-char map back into the original string. */
function foldMap(s: string): { text: string; map: number[] } {
  let text = "";
  const map: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const f = s[i]!.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
    for (let k = 0; k < f.length; k++) {
      text += f[k];
      map.push(i);
    }
  }
  return { text, map };
}

export const foldText = (s: string) => foldMap(s).text;

/** [start, end) of the first case/diacritics-insensitive occurrence of `query` in `label`, or null. */
export function matchRange(label: string, query: string): [number, number] | null {
  const q = foldText(query.trim());
  if (!q) return null;
  const { text, map } = foldMap(label);
  const at = text.indexOf(q);
  if (at < 0) return null;
  const start = map[at]!;
  const end = map[at + q.length - 1]! + 1;
  return [start, end];
}

export const defaultFilter = (item: AutocompleteItem, query: string) => matchRange(item.label, query) !== null;

const toItem = (s: string | AutocompleteItem): AutocompleteItem => (typeof s === "string" ? { value: s, label: s } : s);

interface Geo {
  left: number;
  width: number;
  top?: number;
  bottom?: number;
  maxH: number;
  up: boolean;
}

function place(r: DOMRect, vw: number, vh: number): Geo {
  const C = CONFIG;
  const below = vh - r.bottom - C.gap - C.edge;
  const above = r.top - C.gap - C.edge;
  const up = below < C.minBelow && above > below;
  const width = Math.min(r.width, vw - C.edge * 2);
  const left = Math.min(Math.max(r.left, C.edge), vw - C.edge - width);
  const maxH = Math.min(C.pad * 2 + C.maxResults * C.rowH + 2, Math.max(C.emptyH + 2, up ? above : below));
  return up ? { left, width, bottom: vh - r.top + C.gap, maxH, up } : { left, width, top: r.bottom + C.gap, maxH, up };
}

function Highlight({ label, query }: { label: string; query: string }) {
  const m = matchRange(label, query);
  if (!m) return <>{label}</>;
  return (
    <>
      {label.slice(0, m[0])}
      <mark className="bg-transparent font-medium text-fg">{label.slice(m[0], m[1])}</mark>
      {label.slice(m[1])}
    </>
  );
}

/**
 * WAI-ARIA combobox (list autocomplete) on the app's `Input`: typing opens the suggestion panel (fixed layer under
 * the field, flips above when there is no room), matches are highlighted, the empty state reads "Keine Treffer".
 * Keyboard: ArrowDown opens / moves, ArrowUp moves, Enter chooses, Esc closes (without closing a surrounding
 * sheet), Tab / blur close. Focus never leaves the field (`aria-activedescendant`).
 */
export function Autocomplete({
  value,
  onChange,
  suggestions,
  onSelect,
  filter = defaultFilter,
  maxResults = CONFIG.maxResults,
  emptyText = "Keine Treffer",
  inputClassName,
  wrapperClassName,
  ref,
  id,
  onKeyDown,
  onBlur,
  "aria-describedby": describedBy,
  ...rest
}: AutocompleteProps) {
  const reduced = useReducedFx();
  const uid = useId();
  const baseId = id ?? `ac-${uid}`;
  const listId = `${baseId}-list`;
  const emptyId = `${baseId}-empty`;
  const optId = (i: number) => `${baseId}-opt-${i}`;

  const inputRef = useRef<HTMLInputElement | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const exitRef = useRef<Animation | null>(null);
  const [open, setOpen] = useState(false);
  const [present, setPresent] = useState(false);
  const [geo, setGeo] = useState<Geo | null>(null);
  const [active, setActive] = useState(-1);
  const [query, setQuery] = useState("");

  const setInput = useCallback(
    (el: HTMLInputElement | null) => {
      inputRef.current = el;
      if (typeof ref === "function") ref(el);
      else if (ref) ref.current = el;
    },
    [ref],
  );

  const items = useMemo(() => suggestions.map(toItem), [suggestions]);
  const results = useMemo(() => (query.trim() ? items.filter((it) => filter(it, query)) : items).slice(0, maxResults), [items, filter, query, maxResults]);
  // group header only where the group changes
  const headers = useMemo(() => results.map((it, i) => (it.group && it.group !== results[i - 1]?.group ? it.group : null)), [results]);

  const show = useCallback((q: string) => {
    const el = inputRef.current;
    if (!el) return;
    exitRef.current?.cancel();
    exitRef.current = null;
    setGeo(place(el.getBoundingClientRect(), window.innerWidth, window.innerHeight));
    setQuery(q);
    setActive(-1);
    setOpen(true);
    setPresent(true);
  }, []);

  const hide = useCallback(() => {
    setOpen(false);
    setActive(-1);
    const el = panelRef.current;
    if (!el || reduced || prefersReducedMotion() || typeof el.animate !== "function") setPresent(false);
  }, [reduced]);

  // pop in on the open edge (WAAPI on transform/opacity: compositor, no forced reflow)
  useLayoutEffect(() => {
    if (!open || !present) return;
    const el = panelRef.current;
    if (!el || reduced || prefersReducedMotion() || typeof el.animate !== "function") return;
    el.animate([{ opacity: 0, transform: `scale(${CONFIG.scaleFrom})` }, { opacity: 1, transform: "scale(1)" }], { duration: CONFIG.inMs, easing: CONFIG.inEase });
  }, [open, present, reduced]);

  // counter move on close, then unmount
  useLayoutEffect(() => {
    if (open || !present) return;
    const el = panelRef.current;
    if (!el || reduced || prefersReducedMotion() || typeof el.animate !== "function") return;
    const a = el.animate([{ opacity: 1, transform: "scale(1)" }, { opacity: 0, transform: `scale(${CONFIG.scaleFrom})` }], { duration: CONFIG.outMs, easing: CONFIG.outEase, fill: "forwards" });
    exitRef.current = a;
    a.onfinish = () => {
      if (exitRef.current === a) {
        exitRef.current = null;
        setPresent(false);
      }
    };
  }, [open, present, reduced]);

  // the panel was placed from one measurement: outside scroll / resize closes it
  useEffect(() => {
    if (!open) return;
    const onScroll = (e: Event) => {
      if (e.target instanceof Node && panelRef.current?.contains(e.target)) return;
      hide();
    };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", hide);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", hide);
    };
  }, [open, hide]);

  const choose = (it: AutocompleteItem) => {
    onChange(it.label);
    onSelect?.(it);
    hide();
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    onKeyDown?.(e);
    if (e.defaultPrevented) return;
    const n = results.length;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      // a field that already holds a full suggestion (e.g. the chosen symbol) lists everything
      if (!open) show(items.some((it) => foldText(it.label) === foldText(value)) ? "" : value);
      else if (n) setActive((a) => (a + 1) % n);
    } else if (e.key === "ArrowUp") {
      if (!open) return;
      e.preventDefault();
      if (n) setActive((a) => (a <= 0 ? n - 1 : a - 1));
    } else if (e.key === "Enter") {
      const it = open && active >= 0 ? results[active] : undefined;
      if (it) {
        e.preventDefault();
        choose(it);
      }
    } else if (e.key === "Escape") {
      if (!open) return;
      e.preventDefault();
      e.stopPropagation(); // a surrounding sheet/dialog must stay open
      hide();
    } else if (e.key === "Tab") {
      if (open) hide();
    }
  };

  const expanded = open && present;
  const empty = expanded && results.length === 0;
  const describe = [describedBy, empty ? emptyId : null].filter(Boolean).join(" ") || undefined;

  return (
    <>
      <Input
        {...rest}
        ref={setInput}
        id={id}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={expanded}
        aria-controls={expanded ? listId : undefined}
        aria-activedescendant={expanded && active >= 0 ? optId(active) : undefined}
        aria-describedby={describe}
        autoComplete="off"
        spellCheck={false}
        value={value}
        className={inputClassName}
        wrapperClassName={wrapperClassName}
        onChange={(e) => {
          const v = e.target.value;
          onChange(v);
          if (v.length === 0) hide();
          else if (!open) show(v);
          else {
            setQuery(v);
            setActive(-1);
          }
        }}
        onKeyDown={onKey}
        onBlur={(e) => {
          onBlur?.(e);
          hide();
        }}
      />
      {present &&
        geo &&
        createPortal(
          <div
            ref={panelRef}
            data-pulse-autocomplete=""
            data-placement={geo.up ? "top" : "bottom"}
            data-state={open ? "open" : "closed"}
            onMouseDown={(e) => e.preventDefault()}
            className={cn("fixed overflow-y-auto overscroll-contain rounded-xl border border-line-2 bg-ink-850 text-fg", !open && "pointer-events-none")}
            style={{
              left: geo.left,
              width: geo.width,
              top: geo.top,
              bottom: geo.bottom,
              maxHeight: geo.maxH,
              zIndex: CONFIG.zIndex,
              boxShadow: CONFIG.panelShadow,
              transformOrigin: geo.up ? "50% 100%" : "50% 0",
              contain: "layout paint",
            }}
          >
            <div id={listId} role="listbox" aria-label={rest["aria-label"]} hidden={results.length === 0} style={{ padding: CONFIG.pad }}>
              {results.map((it, i) => {
                const header = headers[i];
                return (
                  <div key={`${it.group ?? ""}:${it.value}`} role="presentation">
                    {header && (
                      <div role="presentation" className="flex items-end px-3 pb-1 font-mono text-[10px] uppercase tracking-[0.08em] text-faint" style={{ height: CONFIG.groupH }}>
                        {header}
                      </div>
                    )}
                    <div
                      id={optId(i)}
                      role="option"
                      aria-selected={i === active}
                      onClick={() => choose(it)}
                      onPointerMove={(e) => {
                        if (e.pointerType === "mouse" && i !== active) setActive(i);
                      }}
                      className="flex cursor-pointer select-none items-center truncate rounded-lg px-3 text-[13.5px] text-mute aria-selected:bg-ink-700"
                      style={{ height: CONFIG.rowH }}
                    >
                      <span className="min-w-0 truncate">
                        <Highlight label={it.label} query={query} />
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
            {results.length === 0 && (
              <div id={emptyId} className="grid place-items-center text-[13.5px] text-mute" style={{ height: CONFIG.emptyH }}>
                {emptyText}
              </div>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
