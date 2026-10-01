import { AnimatePresence, animate, motion, type AnimationPlaybackControls, type Transition } from "motion/react";
import { useEffect, useRef, useState } from "react";
import type { AccountId, Setup, TradeFilter } from "@/domain/types";
import { ACCOUNT_LABELS } from "@/domain/defaults";
import { cn } from "@/lib/cn";
import { colorClass, pct0, signed } from "@/lib/format";
import type { Agg } from "@/domain/agg";
import { radius, spring, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { ValueFlash } from "@/motion/ValueFlash";
import { Icon, Input, Segmented, inputClass } from "@/primitives";
import { NO_SETUP, countLabel } from "./tradesModel";

export interface TradeFiltersProps {
  filter: TradeFilter;
  onChange: (patch: Partial<TradeFilter>) => void;
  setups: readonly Setup[];
  /** Number of trades after filtering (count pill). */
  count: number;
  /** Aggregate of the filtered *closed* trades (`· {±net} · {winRate}` in the pill). */
  closed: Agg;
  className?: string;
}

/** Search debounce of the bundle (`H$`). */
export const SEARCH_DEBOUNCE_MS = tween.debounce.duration * 1000;

const ACC_OPTIONS = (["all", "makro", "scalp"] as const).map((v) => ({ v, label: ACCOUNT_LABELS[v] }));
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
 * Filter bar of `Alle Trades` (bundle `H$`, Plan 6.2): search (`Trades durchsuchen`, 150 ms debounce),
 * setup select (`Alle Grundlagen` / setups / `Ohne Grundlage`), Segmented account / result / side and the count pill.
 * State lives in `uiStore.tradeFilter` (the router mirrors it into the URL).
 *
 * Motion: while the debounce is pending the magnifier lights up and pops (`spring.pop`) and a hairline under the
 * field fills over exactly the debounce, restarting with every keystroke. The count pill morphs its width on
 * `spring.island` (text counter-scaled, updated synchronously) and flashes once per new count; the net figure
 * flashes green/red by direction. Reduced motion: tint only, no pop, fill or flash.
 */
export function TradeFilters({ filter, onChange, setups, count, closed, className }: TradeFiltersProps) {
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
        <Input type="search" className="pl-9" placeholder="Notizen, Begründung …" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Trades durchsuchen" />
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
      <select className={cn(inputClass, "w-auto min-w-[190px]")} value={filter.setup} onChange={(e) => onChange({ setup: e.target.value })} aria-label="Entscheidungsgrundlage">
        <option value="all">Alle Grundlagen</option>
        {setups.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
        <option value={NO_SETUP}>Ohne Grundlage</option>
      </select>
      <Segmented<"all" | AccountId> aria-label="Konto" size="sm" value={filter.acc} onChange={(acc) => onChange({ acc })} options={ACC_OPTIONS} />
      <Segmented aria-label="Ergebnis" size="sm" value={filter.result} onChange={(result) => onChange({ result })} options={RESULT_OPTIONS} />
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

  return (
    <motion.span
      layout
      layoutDependency={text}
      transition={PILL_LAYOUT}
      style={{ borderRadius: radius.pill }}
      className="relative ml-auto inline-flex rounded-full border border-line px-3 py-1 text-xs text-mute"
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
  );
}
