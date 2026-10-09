import { AnimatePresence, animate, motion, type AnimationPlaybackControls, type Transition } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AccountId, Setup, TradeFilter } from "@/domain/types";
import { ACCOUNT_LABELS } from "@/domain/defaults";
import { cn } from "@/lib/cn";
import { colorClass, pct0, signed } from "@/lib/format";
import type { Agg } from "@/domain/agg";
import { radius, spring, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Autocomplete, type AutocompleteItem } from "@/motion/pulse/Autocomplete";
import { MorphSelect, type MorphSelectOption } from "@/motion/pulse/MorphSelect";
import { ValueFlash } from "@/motion/ValueFlash";
import { Icon, Segmented } from "@/primitives";
import type { TradeExtraFilter } from "@/store/uiStore";
import { ANY_MISTAKE, NO_MISTAKE, NO_SETUP, STRENGTH_OPTIONS, countLabel, type SearchSuggestion } from "./tradesModel";

export interface TradeFiltersProps {
  filter: TradeFilter;
  onChange: (patch: Partial<TradeFilter>) => void;
  setups: readonly Setup[];
  /** Number of trades after filtering (count pill). */
  count: number;
  /** Aggregate of the filtered *closed* trades (`· {±net} · {winRate}` in the pill). */
  closed: Agg;
  /** Grouped search suggestions (`searchSuggestions`): setups / sides filter, emotions / words fill the search. */
  suggestions?: readonly SearchSuggestion[];
  /** Additive mistake-tag / signal-strength filter (`uiStore.tradeExtra`). */
  extra?: TradeExtraFilter;
  onExtraChange?: (patch: Partial<TradeExtraFilter>) => void;
  /** Tags of the `Fehler` select; empty → the select is not shown. */
  mistakeTags?: readonly string[];
  /** Show the `Signal-Stärke` select (the journal has stored checks, or the filter is set). */
  showStrength?: boolean;
  className?: string;
}

/** Search debounce of the bundle (`H$`). */
export const SEARCH_DEBOUNCE_MS = tween.debounce.duration * 1000;

const ACC_OPTIONS = (["all", "makro", "scalp"] as const).map((v) => ({
  v,
  label: ACCOUNT_LABELS[v],
}));
const RESULT_OPTIONS = [
  { v: "all", label: "Alle" },
  { v: "win", label: "Gewinner" },
  { v: "loss", label: "Verlierer" },
  { v: "be", label: "Break-even" },
  { v: "open", label: "Offen" },
] as const satisfies readonly { v: TradeFilter["result"]; label: string }[];
const SIDE_OPTIONS = [
  { v: "all", label: "Beide" },
  { v: "long", label: "Long" },
  { v: "short", label: "Short" },
] as const satisfies readonly { v: TradeFilter["side"]; label: string }[];

// the hairline is the debounce timer made visible: `tween.debounce` is the single source of both
const DEBOUNCE_FILL: Transition = tween.debounce;
const PILL_LAYOUT: Transition = { layout: spring.island };

/**
 * Filter bar of `Alle Trades` (bundle `H$`, Plan 6.2): search (`Trades durchsuchen`, 150 ms debounce; a pulse
 * `Autocomplete` with grouped suggestions), setup select (pulse `MorphSelect`, `Alle Grundlagen` / setups / `Ohne
 * Grundlage`), NEW (additive, shown once there is something to filter by) `Fehler-Tag` and `Signal-Stärke` selects
 * (`uiStore.tradeExtra`, session only), Segmented account / result / side and the count pill. State lives in `uiStore.tradeFilter` (the router
 * mirrors it into the URL).
 *
 * Suggestions: choosing a setup or a side is a filter shortcut (the field clears, the select / segment switches –
 * the text search cannot match those); choosing an emotion or a frequent note word searches it at once (typing keeps
 * the 150 ms debounce).
 *
 * Motion: while the debounce is pending the magnifier lights up and pops (`spring.pop`) and a hairline under the
 * field fills over exactly the debounce, restarting with every keystroke. The count pill morphs its width on
 * `spring.island` (text counter-scaled, updated synchronously) inside a reserved slot – its own line below `sm` – so a
 * new count never re-wraps the bar (TR-04); it flashes once per new count; the net figure flashes green/red by
 * direction. Reduced motion: tint only, no pop, fill or flash.
 */
export function TradeFilters({ filter, onChange, setups, count, closed, suggestions, extra, onExtraChange, mistakeTags, showStrength, className }: TradeFiltersProps) {
  const reduced = useReducedFx();
  const [q, setQ] = useState(filter.q);
  const lastSent = useRef(filter.q);
  const pending = q !== filter.q;

  // Store → local (reset, deep link, `Filter zurücksetzen`).
  useEffect(() => {
    if (filter.q !== lastSent.current) {
      lastSent.current = filter.q;
      setQ(filter.q);
    }
  }, [filter.q]);

  // Local → store, debounced.
  useEffect(() => {
    if (q === lastSent.current) return;
    const t = setTimeout(() => {
      lastSent.current = q;
      onChange({ q });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [q, onChange]);

  const setupOptions = useMemo<MorphSelectOption[]>(
    () => [{ value: "all", label: "Alle Grundlagen" }, ...setups.map((s) => ({ value: s.id, label: s.name })), { value: NO_SETUP, label: "Ohne Grundlage" }],
    [setups],
  );
  const mistakeOptions = useMemo<MorphSelectOption[]>(
    () => [{ value: "all", label: "Alle Fehler-Tags" }, { value: NO_MISTAKE, label: "Ohne Fehler" }, { value: ANY_MISTAKE, label: "Mit Fehlern" }, ...(mistakeTags ?? []).map((m) => ({ value: m, label: m }))],
    [mistakeTags],
  );
  const items = useMemo<AutocompleteItem[]>(
    () =>
      (suggestions ?? []).map(({ value, label, group }) => ({
        value,
        label,
        group,
      })),
    [suggestions],
  );
  const choose = useCallback(
    (item: AutocompleteItem) => {
      const s = suggestions?.find((x) => x.value === item.value);
      if (!s) return;
      if (s.kind === "setup" || s.kind === "side") {
        // a filter shortcut: the field clears (no debounce left pending) and the select / segment takes over
        lastSent.current = "";
        setQ("");
        onChange(s.kind === "setup" ? { q: "", setup: s.target } : { q: "", side: s.target as TradeFilter["side"] });
        return;
      }
      lastSent.current = s.label;
      setQ(s.label);
      onChange({ q: s.label });
    },
    [suggestions, onChange],
  );

  return (
    <div className={cn("mb-4 flex flex-wrap items-center gap-2.5", className)}>
      <label className="relative min-w-[200px] flex-1 sm:max-w-[280px]" data-pending={pending || undefined}>
        <motion.span
          className="pointer-events-none absolute left-3 top-1/2 z-[1] grid size-3.5 -translate-y-1/2 [&_svg]:size-full"
          aria-hidden="true"
          initial={false}
          animate={{ scale: pending && !reduced ? 1.18 : 1 }}
          transition={spring.pop}
        >
          <span className="col-start-1 row-start-1 text-faint">
            <Icon name="search" />
          </span>
          <motion.span className="col-start-1 row-start-1 text-fg" initial={false} animate={{ opacity: pending ? 1 : 0 }} transition={tween.crossfade}>
            <Icon name="search" />
          </motion.span>
        </motion.span>
        <Autocomplete type="search" inputClassName="pl-9" placeholder="Notizen, Begründung …" value={q} onChange={setQ} suggestions={items} onSelect={choose} emptyText="Keine Vorschläge" aria-label="Trades durchsuchen" />
        <AnimatePresence>
          {pending && !reduced && (
            <motion.span
              key={q}
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-3 bottom-0 z-[1] h-px origin-left bg-gradient-to-r from-white/10 via-white/60 to-white/90"
              initial={{ scaleX: 0 }}
              animate={{ scaleX: 1 }}
              exit={{ opacity: 0, transition: tween.exit }}
              transition={DEBOUNCE_FILL}
            />
          )}
        </AnimatePresence>
      </label>
      <div className="w-[min(100%,272px)] min-w-[190px]">
        <MorphSelect aria-label="Entscheidungsgrundlage" value={filter.setup} onChange={(setup) => onChange({ setup })} options={setupOptions} />
      </div>
      {extra && onExtraChange && (mistakeTags?.length ?? 0) > 0 && (
        <div className="w-[min(100%,210px)] min-w-[170px]">
          <MorphSelect aria-label="Fehler-Tag" value={extra.mistake} onChange={(mistake) => onExtraChange({ mistake })} options={mistakeOptions} />
        </div>
      )}
      {extra && onExtraChange && showStrength && (
        <div className="w-[min(100%,230px)] min-w-[170px]">
          <MorphSelect<TradeExtraFilter["strength"]> aria-label="Signal-Stärke" value={extra.strength} onChange={(strength) => onExtraChange({ strength })} options={STRENGTH_OPTIONS} />
        </div>
      )}
      <Segmented<"all" | AccountId> aria-label="Konto" size="sm" value={filter.acc} onChange={(acc) => onChange({ acc })} options={ACC_OPTIONS} />
      {/* wraps on a phone: a coarse-pointer row gap keeps the ±10 px tap bands of both rows apart */}
      <Segmented aria-label="Ergebnis" size="sm" className="pointer-coarse:gap-y-5" value={filter.result} onChange={(result) => onChange({ result })} options={RESULT_OPTIONS} />
      <Segmented aria-label="Richtung" size="sm" value={filter.side} onChange={(side) => onChange({ side })} options={SIDE_OPTIONS} />
      <CountPill count={count} closed={closed} reduced={reduced} />
    </div>
  );
}

/**
 * `{n} Trades · {±net} · {winRate}`. The text is plain and synchronous (tests read it right after a filter click);
 * only the box morphs (`layout` + counter-scaled content) and a pre-rendered wash flashes on a new count.
 */
function CountPill({ count, closed, reduced }: { count: number; closed: Agg; reduced: boolean }) {
  const wash = useRef<HTMLSpanElement>(null);
  const seen = useRef(count);
  const text = closed.n ? `${countLabel(count)} · ${signed(closed.net, 0)} · ${pct0(closed.winRate)}` : countLabel(count);

  useEffect(() => {
    if (seen.current === count) return;
    seen.current = count;
    const el = wash.current;
    if (reduced || !el) return;
    const controls: AnimationPlaybackControls = animate(el, { opacity: [1, 0] }, tween.flash);
    return () => controls.complete();
  }, [count, reduced]);

  // the slot reserves the pill's line (own row below `sm`, a fixed minimum from `sm`): the pill grows and shrinks
  // inside it, right-aligned, so a new count never re-wraps the bar or moves anything else
  return (
    <span className="flex basis-full justify-end sm:ml-auto sm:basis-auto sm:min-w-[232px]">
      <motion.span
        layout
        layoutDependency={text}
        transition={PILL_LAYOUT}
        style={{ borderRadius: radius.pill }}
        className="relative inline-flex overflow-hidden rounded-full border border-line px-3 py-1 text-xs text-mute"
        data-testid="trade-count"
      >
        <span ref={wash} aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-[inherit] bg-white/[0.07] opacity-0 ring-1 ring-inset ring-white/25" />
        <motion.span layout="position" layoutDependency={text} transition={PILL_LAYOUT} className="relative whitespace-nowrap">
          {countLabel(count)}
          {closed.n ? (
            <>
              {" · "}
              <ValueFlash value={closed.net} enabled={!reduced} className="align-baseline">
                <span className={colorClass(closed.net)}>{signed(closed.net, 0)}</span>
              </ValueFlash>
              {" · "}
              {pct0(closed.winRate)}
            </>
          ) : null}
        </motion.span>
      </motion.span>
    </span>
  );
}
