import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type InputHTMLAttributes, type KeyboardEvent, type ReactNode, type Ref } from "react";
import { springCurve } from "@/app/cssEasing";
import { cn } from "@/lib/cn";
import { spring } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Icon } from "./icons";

/**
 * `SearchField` – the one search field of the app: a soft, spatial "clay" surface of frosted glass with a clear button, a status
 * line, filter chips and – when it is given `options` – the combobox answers under it (↑ ↓ Enter Esc, screen reader). The page
 * "Funktionen", the finder of the navigation, and the trade / asset searches all use this one component; they differ in `size`,
 * `listMode` and what they pass in. Look + motion: `controls.css` (`.sf-*`); API and states: `README.md`.
 *
 *   <SearchField label="Was willst du tun?" value={q} onChange={setQ} options={hits} onSelect={open} chips={…} />
 *
 * The field is CONTROLLED and knows nothing about what is searched: the caller filters and passes `options`. Without `options` it
 * is a plain search field (role searchbox) with clear button / status / chips. With `options` (an array, possibly empty) it is an
 * ARIA 1.2 combobox: DOM focus stays in the input, `aria-activedescendant` names the active option, Enter chooses it (the first
 * when none is active), ↑ ↓ move (wrapping, consumed only while answers are shown, so a surrounding menu still gets its arrows
 * otherwise), Esc clears a typed query first (and is consumed) and bubbles when the field is empty.
 *
 * Motion (transform / opacity / filter only): the ring and the lift on focus 200 ms; each answer rises in 220 ms, 28 ms apart; the
 * selection plate glides between answers on `spring.layout`; the clear button pops on `spring.pop`. `useReducedFx` / reduced motion:
 * everything is simply there.
 */

export interface SearchOption {
  /** stable and unique within the list */
  id: string;
  label: ReactNode;
  description?: ReactNode;
  /** a third, quieter line (where it lives) */
  meta?: ReactNode;
  /** extra attributes of the option element (`data-feature`, test hooks) */
  attrs?: Record<`data-${string}`, string>;
}

export interface SearchChip {
  id: string;
  label: string;
  count?: number;
}

export interface SearchFieldProps {
  value: string;
  onChange: (value: string) => void;
  /** the accessible name (and the visible label unless `labelHidden`) */
  label: string;
  labelHidden?: boolean;
  placeholder?: string;
  /** `lg` 56 px (a page's main search), `md` 48 px (a menu), `sm` 40 px – 44 px on touch (a toolbar / list search) */
  size?: "lg" | "md" | "sm";
  /** the answers; an array makes the field a combobox, `undefined` a plain search field */
  options?: readonly SearchOption[];
  /** an answer was chosen (Enter = `"enter"`, tap / click = `"click"`) */
  onSelect?: (id: string, how: "enter" | "click") => void;
  /** `inline` pushes what is below down on a spring (default), `popover` floats over it */
  listMode?: "inline" | "popover";
  /** accessible name of the answer list */
  listLabel?: string;
  /** shown when the query has no answer (inside the answer area; the live status says it too) */
  empty?: ReactNode;
  /** the live status line (`aria-live`); default derived from `options`: "3 Treffer …" / "Kein Treffer" */
  status?: string;
  chips?: readonly SearchChip[];
  chipValue?: string;
  onChipChange?: (id: string) => void;
  chipsLabel?: string;
  clearLabel?: string;
  /** Enter without answers (a plain field) */
  onSubmit?: (value: string) => void;
  ref?: Ref<HTMLInputElement>;
  /** wrapper `data-testid` (default `search-field`); the input gets `${testId}-input`, the list `${testId}-results` */
  testId?: string;
  /** extra props of the `<input>` (`data-cmd-item`, `name`, `autoFocus` …) */
  inputProps?: Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type" | "role" | "id" | "className" | "placeholder"> & { [K in `data-${string}`]?: string };
  className?: string;
}

export const SEARCH_STRINGS = {
  clear: "Suche leeren",
  none: "Kein Treffer",
  found: (n: number) => `${n} Treffer. Mit Pfeil nach oben und unten wählen, Enter öffnet.`,
} as const;

/** Spring curves as CSS `linear()` for the plate and the clear button (computed once; the engine is the one the motion layer uses). */
const CURVES = (() => {
  const glide = springCurve({ stiffness: spring.layout.stiffness, damping: spring.layout.damping });
  const pop = springCurve({ stiffness: spring.pop.stiffness, damping: spring.pop.damping, mass: spring.pop.mass });
  return { "--sf-ms": `${glide.ms}ms`, "--sf-ease": glide.easing, "--sf-pop-ms": `${pop.ms}ms`, "--sf-pop": pop.easing } as CSSProperties;
})();

/** The answers stay in the folding box this long after the field was emptied (ms): a little longer than its 240 ms. */
const FOLD_MS = 300;

export function SearchField({
  value,
  onChange,
  label,
  labelHidden,
  placeholder,
  size = "md",
  options,
  onSelect,
  listMode = "inline",
  listLabel,
  empty,
  status,
  chips,
  chipValue,
  onChipChange,
  chipsLabel = "Filter",
  clearLabel = SEARCH_STRINGS.clear,
  onSubmit,
  ref,
  testId = "search-field",
  inputProps,
  className,
}: SearchFieldProps) {
  const uid = useId();
  const inputId = `${uid}-in`;
  const listId = `${uid}-list`;
  const optId = (id: string): string => `${uid}-o-${id}`;
  const reduced = useReducedFx();
  const query = value.trim();
  const combo = options !== undefined;
  const live = options ?? [];
  const open = combo && query.length > 0;
  const [active, setActiveState] = useState({ key: "", i: 0 });
  const input = useRef<HTMLInputElement | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const plate = useRef<HTMLSpanElement>(null);
  const [ready, setReady] = useState(false);

  // while the box folds shut it keeps the last answers (state from props; cleared by the timer)
  const [kept, setKept] = useState<readonly SearchOption[]>(live);
  if (open && live !== kept && live.length > 0) setKept(live);
  useEffect(() => {
    if (open) return;
    const t = setTimeout(() => setKept([]), FOLD_MS);
    return () => clearTimeout(t);
  }, [open]);
  const shown = open ? live : kept;
  const idsKey = shown.map((o) => o.id).join("|");

  // a new list starts at its first answer (the one Enter opens): the choice belongs to the list it was made in
  const at = Math.max(0, Math.min(active.key === idsKey ? active.i : 0, shown.length - 1));
  const setActive = (i: number): void => setActiveState({ key: idsKey, i });

  // the plate sits behind the active answer; it measures it (one read per key press / list change) and glides there
  useLayoutEffect(() => {
    const el = wrap.current?.querySelector<HTMLElement>(`[role="option"][data-i="${at}"]`);
    const p = plate.current;
    if (el && p) {
      p.style.height = `${el.offsetHeight}px`;
      p.style.transform = `translateY(${el.offsetTop}px)`;
    }
    // first placement: it appears there, afterwards it glides
    const raf = el && !ready ? requestAnimationFrame(() => setReady(true)) : 0;
    return () => cancelAnimationFrame(raf);
  }, [at, idsKey, ready, open]);
  useEffect(() => {
    const list = wrap.current;
    if (!list || typeof ResizeObserver !== "function") return;
    const ro = new ResizeObserver(() => {
      const el = list.querySelector<HTMLElement>(`[role="option"][data-i="${at}"]`);
      const p = plate.current;
      if (el && p) {
        p.style.height = `${el.offsetHeight}px`;
        p.style.transform = `translateY(${el.offsetTop}px)`;
      }
    });
    ro.observe(list);
    return () => ro.disconnect();
  }, [at, idsKey]);

  const setInput = useCallback(
    (el: HTMLInputElement | null) => {
      input.current = el;
      if (typeof ref === "function") ref(el);
      else if (ref) ref.current = el;
    },
    [ref],
  );

  const move = (to: number): void => {
    setActive(to);
    wrap.current?.querySelector<HTMLElement>(`[role="option"][data-i="${to}"]`)?.scrollIntoView({ block: "nearest" });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    inputProps?.onKeyDown?.(e);
    if (e.defaultPrevented || e.nativeEvent.isComposing) return;
    const answers = open && live.length > 0;
    if ((e.key === "ArrowDown" || e.key === "ArrowUp") && answers) {
      e.preventDefault();
      // consumed: a surrounding menu keeps its own arrows for when there are no answers
      e.stopPropagation();
      const n = live.length;
      move(e.key === "ArrowDown" ? (at + 1) % n : (at - 1 + n) % n);
    } else if (e.key === "Enter" && query) {
      e.preventDefault();
      if (answers) {
        const chosen = live[at] ?? live[0];
        if (chosen) onSelect?.(chosen.id, "enter");
      } else onSubmit?.(value);
    } else if (e.key === "Escape" && value) {
      // the first Escape clears the field; only the next one reaches a dialog around it
      e.preventDefault();
      e.stopPropagation();
      onChange("");
    }
  };

  const status_ = useMemo(() => {
    if (status !== undefined) return status;
    if (!combo || !query) return "";
    return live.length ? SEARCH_STRINGS.found(live.length) : SEARCH_STRINGS.none;
  }, [status, combo, query, live.length]);
  const showStatus = combo || status !== undefined;

  const panel = combo ? (
    <div className="sf-panel" data-mode={listMode} data-open={open ? "" : undefined} data-testid={`${testId}-panel`}>
      <div className="sf-panel-in" inert={!open} aria-hidden={!open || undefined}>
        {shown.length > 0 ? (
          <div className="sf-wrap" ref={wrap}>
            <span ref={plate} aria-hidden="true" className="sf-plate" data-ready={ready && !reduced ? "" : undefined} />
            <ul id={listId} role="listbox" aria-label={listLabel ?? label} className="sf-list" data-testid={`${testId}-results`}>
              {shown.map((o, i) => (
                <li
                  key={o.id}
                  id={optId(o.id)}
                  role="option"
                  aria-selected={i === at}
                  data-i={i}
                  className="sf-opt"
                  style={{ "--i": Math.min(i, 6) } as CSSProperties}
                  onPointerMove={(e) => e.pointerType !== "touch" && i !== at && setActive(i)}
                  onClick={() => onSelect?.(o.id, "click")}
                  {...o.attrs}
                >
                  <span className="truncate text-[14.5px] font-medium text-fg">{o.label}</span>
                  {o.description && <span className="truncate text-[12px] text-mute">{o.description}</span>}
                  {o.meta && <span className="truncate font-mono text-[11px] text-mute">{o.meta}</span>}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          open && empty && <div data-testid={`${testId}-empty`}>{empty}</div>
        )}
      </div>
    </div>
  ) : null;

  return (
    <div className={cn("sf", className)} data-size={size} data-has-value={value ? "" : undefined} data-reduced={reduced ? "" : undefined} data-testid={testId} style={CURVES}>
      <label htmlFor={inputId} className={labelHidden ? "sr-only" : "text-[15px] font-medium text-fg"}>
        {label}
      </label>
      <div className="sf-anchor">
        <div className="sf-box">
          <span aria-hidden="true" className="sf-icon">
            <Icon name="search" />
          </span>
          <input
            {...inputProps}
            ref={setInput}
            id={inputId}
            type="search"
            className="sf-input"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="search"
            data-testid={`${testId}-input`}
            {...(combo
              ? {
                  role: "combobox",
                  "aria-autocomplete": "list" as const,
                  "aria-expanded": open && shown.length > 0,
                  "aria-controls": listId,
                  "aria-activedescendant": open && shown[at] ? optId(shown[at].id) : undefined,
                }
              : null)}
          />
          <button
            type="button"
            className="sf-clear"
            aria-label={clearLabel}
            tabIndex={value ? 0 : -1}
            aria-hidden={value ? undefined : true}
            data-testid={`${testId}-clear`}
            onClick={() => {
              onChange("");
              input.current?.focus();
            }}
          >
            <Icon name="x" />
          </button>
          <span aria-hidden="true" className="sf-ring" />
        </div>
        {listMode === "popover" && panel}
      </div>
      {chips && chips.length > 0 && (
        <div role="group" aria-label={chipsLabel} className="sf-chips" data-testid={`${testId}-chips`}>
          {chips.map((c) => (
            <button key={c.id} type="button" className="sf-chip" aria-pressed={chipValue === c.id} data-chip={c.id} onClick={() => onChipChange?.(c.id)}>
              {c.label}
              {c.count !== undefined && <small>{c.count}</small>}
            </button>
          ))}
        </div>
      )}
      {showStatus && (
        <p className="sf-status" aria-live="polite" aria-atomic="true" data-testid={`${testId}-status`}>
          {status_}
        </p>
      )}
      {listMode !== "popover" && panel}
    </div>
  );
}
