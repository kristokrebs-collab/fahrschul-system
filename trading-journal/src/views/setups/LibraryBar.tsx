/**
 * Library bar of the Setups page (P07, additive above the grid): free-text search over names, rules, criteria and tags,
 * facet chips (strategy tags, markets, timeframes – only those the library uses), "Mit Trades", and the entry to the
 * comparison sheet. It only HIDES cards (like the existing account switch): stats, sort and the grid stay as they are.
 */
import { chipClass } from "@/primitives/chip";
import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";
import { isFilterActive, type LibraryFilter } from "@/domain/strategy";
import { cn } from "@/lib/cn";
import { spring, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Button } from "@/primitives/Button";
import { Icon } from "@/primitives/icons";
import { Input } from "@/primitives/Input";

export const LIBRARY_STRINGS = {
  search: "Bibliothek durchsuchen",
  searchPlaceholder: "Suchen: Name, Regel, Tag …",
  withTrades: "Mit Trades",
  reset: "Filter zurücksetzen",
  compare: "Vergleichen",
  none: "Keine Grundlage passt zu diesem Filter.",
} as const;

export interface LibraryBarProps {
  filter: LibraryFilter;
  onChange: (f: LibraryFilter) => void;
  facets: { tags: string[]; markets: string[]; tfs: string[] };
  onCompare: () => void;
  /** setups with trades (the comparison needs two) */
  comparable: number;
}

export function LibraryBar({ filter, onChange, facets, onCompare, comparable }: LibraryBarProps) {
  const active = isFilterActive(filter);
  const toggle = (list: readonly string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  return (
    <div className="grid gap-2.5" data-testid="setup-library">
      <div className="flex flex-wrap items-center gap-2">
        <span className="relative grid min-w-0 flex-1 basis-[14rem]">
          <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-3 z-[1] grid place-items-center text-faint [&>svg]:size-3.5">
            <Icon name="search" />
          </span>
          <Input value={filter.q} onChange={(e) => onChange({ ...filter, q: e.target.value })} placeholder={LIBRARY_STRINGS.searchPlaceholder} aria-label={LIBRARY_STRINGS.search} className="pl-9 text-[13px]" autoComplete="off" type="search" />
        </span>
        <Chip on={filter.withTrades} onClick={() => onChange({ ...filter, withTrades: !filter.withTrades })}>
          {LIBRARY_STRINGS.withTrades}
        </Chip>
        <Button size="sm" onClick={onCompare} disabled={comparable < 2} data-testid="setup-compare-open">
          {LIBRARY_STRINGS.compare}
        </Button>
      </div>
      {(facets.tags.length > 0 || facets.markets.length > 0 || facets.tfs.length > 0 || active) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {facets.tags.map((t) => (
            <Chip key={`t-${t}`} on={filter.tags.includes(t)} onClick={() => onChange({ ...filter, tags: toggle(filter.tags, t) })}>
              # {t}
            </Chip>
          ))}
          {facets.markets.map((m) => (
            <Chip key={`m-${m}`} on={filter.market === m} onClick={() => onChange({ ...filter, market: filter.market === m ? null : m })} mono>
              {m}
            </Chip>
          ))}
          {facets.tfs.map((tf) => (
            <Chip key={`f-${tf}`} on={filter.tf === tf} onClick={() => onChange({ ...filter, tf: filter.tf === tf ? null : tf })} mono>
              {tf}
            </Chip>
          ))}
          <AnimatePresence initial={false}>
            {active && (
              <motion.span key="reset" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9, transition: tween.exit }} transition={spring.pop}>
                <button type="button" onClick={() => onChange({ q: "", tags: [], market: null, tf: null, withTrades: false })} className="min-h-8 rounded-full px-2.5 text-[11.5px] text-mute underline-offset-2 hover:text-fg hover:underline pointer-coarse:min-h-11">
                  {LIBRARY_STRINGS.reset}
                </button>
              </motion.span>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

function Chip({ on, onClick, children, mono }: { on: boolean; onClick: () => void; children: ReactNode; mono?: boolean }) {
  const reduced = useReducedFx();
  return (
    <motion.button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      whileTap={reduced ? undefined : { scale: 0.94 }}
      transition={spring.press}
      className={chipClass(on, { className: cn("py-1 font-normal", mono && "font-mono text-[11.5px]") })}
    >
      {children}
    </motion.button>
  );
}
