import { useEffect, useRef, useState } from "react";
import type { AccountId, Setup, TradeFilter } from "@/domain/types";
import { ACCOUNT_LABELS } from "@/domain/defaults";
import { cn } from "@/lib/cn";
import { colorClass, pct0, signed } from "@/lib/format";
import type { Agg } from "@/domain/agg";
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
export const SEARCH_DEBOUNCE_MS = 150;

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

/**
 * Filter bar of `Alle Trades` (bundle `H$`, Plan 6.2): search (`Trades durchsuchen`, 150 ms debounce),
 * setup select (`Alle Grundlagen` / setups / `Ohne Grundlage`), Segmented account / result / side and the count pill.
 * State lives in `uiStore.tradeFilter` (the router mirrors it into the URL).
 */
export function TradeFilters({ filter, onChange, setups, count, closed, className }: TradeFiltersProps) {
  const [q, setQ] = useState(filter.q);
  const lastSent = useRef(filter.q);

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
      <label className="relative min-w-[200px] flex-1 sm:max-w-[280px]">
        <span className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-faint [&>svg]:size-full" aria-hidden="true">
          <Icon name="search" />
        </span>
        <Input type="search" className="pl-9" placeholder="Notizen, Begründung …" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Trades durchsuchen" />
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
      <span className="ml-auto rounded-full border border-line px-3 py-1 text-xs text-mute" data-testid="trade-count">
        {countLabel(count)}
        {closed.n ? (
          <>
            {" · "}
            <span className={colorClass(closed.net)}>{signed(closed.net, 0)}</span>
            {" · "}
            {pct0(closed.winRate)}
          </>
        ) : null}
      </span>
    </div>
  );
}
