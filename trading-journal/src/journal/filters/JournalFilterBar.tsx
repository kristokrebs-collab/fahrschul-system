import { useLimit, usePlan } from "@/billing/entitlements";
import { PLAN_CATALOG, upgradePlanForLimit } from "@/billing/plans";
import { openUpgrade } from "@/billing/store";
import { AnimatePresence, motion } from "motion/react";
import { useId, useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import type { TradeFilter } from "@/domain/types";
import { localDateKey } from "@/lib/dates";
import { cn } from "@/lib/cn";
import { parseNumber, toInputString } from "@/lib/parse";
import { TextMorph } from "@/motion/pulse/TextMorph";
import { MorphSelect } from "@/motion/pulse/MorphSelect";
import { Switch } from "@/motion/Switch";
import { radius, spring, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Collapse, Segmented } from "@/primitives";
import { useJournal } from "@/store/journalStore";
import { useUi, type TradeExtraFilter, type TradeSort } from "@/store/uiStore";
import { matchView, useViews } from "@/store/viewsStore";
import { clearJournalFilters, journalFilterCount, journalFilterOptions, type JournalFilterOptions } from "@/views/trades/tradesModel";

export interface JournalFilterBarProps {
  filter: TradeFilter;
  extra: TradeExtraFilter;
  sort: TradeSort;
  onExtraChange: (patch: Partial<TradeExtraFilter>) => void;
  /** Replaces the whole extra filter (clear). */
  onExtraReplace?: (next: TradeExtraFilter) => void;
  options: JournalFilterOptions;
  className?: string;
}

type RangeKey = "pnl" | "r" | "hold" | "lev";

/** `YYYY-MM-DD` of today − `days` (local). */
function daysAgo(days: number, now = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - days);
  return localDateKey(d);
}

const PERIODS: readonly { id: string; label: string; from: () => string; to?: () => string }[] = [
  { id: "7", label: "7 Tage", from: () => daysAgo(6) },
  { id: "30", label: "30 Tage", from: () => daysAgo(29) },
  { id: "month", label: "Dieser Monat", from: () => localDateKey(new Date(new Date().getFullYear(), new Date().getMonth(), 1)) },
  { id: "year", label: "Dieses Jahr", from: () => `${new Date().getFullYear()}-01-01` },
];

/**
 * Journal-v3 row of the trade filters: saved views (chips; the current view's name morphs with the pulse `TextMorph`;
 * `+ Ansicht speichern` names the current filters, × deletes), the quick `Top-Trades` (rating ≥ 4) and `≥ 2 R` picks
 * ("trade the best"), `Positionen gruppieren` and `Mehr Filter` (count badge pops) that unfolds period, pair, venue,
 * Perp / Spot, tags and the P&L / R / holding-time / leverage ranges (`Collapse`).
 */
/**
 * `JournalFilterBar` wired to the stores, as `TradeFilters` renders it on the trades page: the options come from the
 * journal's trades, the sort and the clear (`replaceTradeExtra`) from `uiStore` – so the page itself needs no change.
 */
export function JournalFilterSlot({ filter, extra, onExtraChange, className }: Pick<JournalFilterBarProps, "filter" | "extra" | "onExtraChange" | "className">) {
  const trades = useJournal((s) => s.trades);
  const options = useMemo(() => journalFilterOptions(trades), [trades]);
  const sort = useUi((s) => s.tradeSort);
  const replace = useUi((s) => s.replaceTradeExtra);
  return <JournalFilterBar filter={filter} extra={extra} sort={sort} onExtraChange={onExtraChange} onExtraReplace={replace} options={options} className={className} />;
}

export function JournalFilterBar({ filter, extra, sort, onExtraChange, onExtraReplace, options, className }: JournalFilterBarProps) {
  const reduced = useReducedFx();
  const id = useId();
  const views = useViews((s) => s.views);
  const saveView = useViews((s) => s.saveView);
  const deleteView = useViews((s) => s.deleteView);
  const applyView = useViews((s) => s.applyView);
  // plan limit `savedViews` (P10 / P14; unlimited without payments): at the limit the button offers the next plan
  const viewLimit = useLimit("savedViews");
  const plan = usePlan();
  const atLimit = views.length >= viewLimit;
  const [open, setOpen] = useState(() => journalFilterCount(extra) > 0);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const current = useMemo(() => matchView(views, { filter, extra, sort }), [views, filter, extra, sort]);
  const count = journalFilterCount(extra);
  const viewLabel = current ? current.name : views.length ? "Eigene Auswahl" : "Alle Trades";
  const top = extra.ratingMin === 4;
  const big = extra.rMin === 2 && extra.rMax == null;

  const commitName = () => {
    const v = name.trim();
    setNaming(false);
    setName("");
    if (v) saveView(v);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commitName();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setNaming(false);
      setName("");
    }
  };

  return (
    <div className={cn("grid basis-full gap-2.5", className)} data-testid="journal-filters">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex min-w-0 items-center gap-2 text-[12px] text-mute">
          <span className="label">Ansicht</span>
          <span className="min-w-[7.5rem] font-medium text-fg" aria-hidden="true">
            {/* the gooey morph engine only mounts once there is something to switch between */}
            {reduced || views.length === 0 ? viewLabel : <TextMorph text={viewLabel} morphMs={560} />}
          </span>
          <span className="sr-only" data-testid="view-name">
            {viewLabel}
          </span>
        </span>
        <span className="h-4 w-px bg-line-2" aria-hidden="true" />
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Gespeicherte Ansichten">
          <AnimatePresence initial={false}>
            {views.map((v) => {
              const on = current?.id === v.id;
              return (
                <motion.span
                  key={v.id}
                  layout="position"
                  className={cn("inline-flex items-center overflow-hidden border text-[12px] transition-colors", on ? "border-white/60 bg-white/[0.1] text-fg" : "border-line-2 text-mute hover:text-fg")}
                  style={{ borderRadius: radius.pill }}
                  initial={reduced ? false : { opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8, transition: tween.exit }}
                  transition={{ scale: spring.pop, opacity: tween.fade, layout: spring.layout }}
                >
                  <button type="button" aria-pressed={on} onClick={() => applyView(v.id)} className="px-3 py-1 pointer-coarse:min-h-11">
                    {v.name}
                  </button>
                  {on && (
                    <button type="button" aria-label={`Ansicht „${v.name}“ löschen`} onClick={() => deleteView(v.id)} className="border-l border-white/20 px-2 py-1 text-faint hover:text-loss pointer-coarse:min-h-11">
                      ×
                    </button>
                  )}
                </motion.span>
              );
            })}
          </AnimatePresence>
          {naming ? (
            <input
              autoFocus
              aria-label="Name der Ansicht"
              placeholder="Name, z. B. Breakouts London"
              value={name}
              maxLength={40}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={onKey}
              onBlur={commitName}
              className="h-8 w-52 rounded-full border border-white/30 bg-transparent px-3 text-[12px] text-fg outline-none placeholder:text-faint pointer-coarse:h-11"
            />
          ) : (
            !current && (
              <button
                type="button"
                onClick={() => (atLimit ? openUpgrade(null, upgradePlanForLimit("savedViews", plan.plan, views.length)) : setNaming(true))}
                className="rounded-full border border-dashed border-line-2 px-3 py-1 text-[12px] text-mute transition-colors hover:border-white/40 hover:text-fg pointer-coarse:min-h-11"
                data-limit={atLimit ? "full" : undefined}
              >
                {atLimit ? `+ Ansicht speichern · mehr mit ${PLAN_CATALOG[upgradePlanForLimit("savedViews", plan.plan, views.length)].name}` : "+ Ansicht speichern"}
              </button>
            )
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {options.rating && (
          <QuickChip on={top} onClick={() => onExtraChange({ ratingMin: top ? null : 4 })}>
            ★ Top-Trades
          </QuickChip>
        )}
        <QuickChip on={big} onClick={() => onExtraChange(big ? { rMin: null } : { rMin: 2, rMax: null })}>
          ≥ 2 R
        </QuickChip>
        <label className="inline-flex items-center gap-2 text-[12px] text-mute">
          <Switch size="sm" checked={extra.group === true} onCheckedChange={(group) => onExtraChange({ group })} aria-label="Positionen gruppieren" />
          <span aria-hidden="true">Gruppieren</span>
        </label>
        <span className="flex-1" />
        <button
          type="button"
          aria-expanded={open}
          aria-controls={`${id}-more`}
          onClick={() => setOpen((o) => !o)}
          className={cn("inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[12px] transition-colors pointer-coarse:min-h-11", open || count ? "border-white/40 text-fg" : "border-line-2 text-mute hover:text-fg")}
        >
          Mehr Filter
          <AnimatePresence initial={false} mode="popLayout">
            {count > 0 && (
              <motion.span key={count} className="grid min-w-5 place-items-center rounded-full bg-fg px-1 font-mono text-[10.5px] font-semibold text-ink-950" initial={reduced ? false : { scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ opacity: 0, transition: tween.exit }} transition={{ scale: spring.pop, opacity: tween.fade }}>
                {count}
              </motion.span>
            )}
          </AnimatePresence>
          <motion.svg viewBox="0 0 10 10" className="size-2.5" animate={{ rotate: open ? 180 : 0 }} transition={spring.plus} aria-hidden="true">
            <path d="M2.5 3.75 5 6.25l2.5-2.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </motion.svg>
        </button>
      </div>

      <Collapse open={open} id={`${id}-more`}>
        <div className="grid gap-3 rounded-2xl border border-line bg-ink-950/40 p-3 sm:grid-cols-2 lg:grid-cols-3">
          <Group label="Zeitraum">
            <div className="grid grid-cols-2 gap-2">
              <DateInput label="Von" value={extra.from ?? ""} onChange={(from) => onExtraChange({ from: from || undefined })} />
              <DateInput label="Bis" value={extra.to ?? ""} onChange={(to) => onExtraChange({ to: to || undefined })} />
            </div>
            <div className="flex flex-wrap gap-1">
              {PERIODS.map((p) => {
                const from = p.from();
                const on = extra.from === from && !extra.to;
                return (
                  <QuickChip key={p.id} small on={on} onClick={() => onExtraChange(on ? { from: undefined, to: undefined } : { from, to: undefined })}>
                    {p.label}
                  </QuickChip>
                );
              })}
            </div>
          </Group>
          {options.pairs.length > 1 && (
            <Group label="Paar">
              <MorphSelect aria-label="Paar" value={extra.pair ?? ""} onChange={(pair) => onExtraChange({ pair: pair || undefined })} options={[{ value: "", label: "Alle Paare" }, ...options.pairs.map((p) => ({ value: p, label: p }))]} />
            </Group>
          )}
          {options.exchanges.length > 0 && (
            <Group label="Börse">
              <MorphSelect aria-label="Börse" value={extra.exchange ?? ""} onChange={(exchange) => onExtraChange({ exchange: exchange || undefined })} options={[{ value: "", label: "Alle Börsen" }, ...options.exchanges.map((x) => ({ value: x, label: x }))]} />
            </Group>
          )}
          {options.exchangeAccounts.length > 0 && (
            <Group label="Börsenkonto">
              <MorphSelect
                aria-label="Börsenkonto"
                value={extra.exchangeAccount ?? ""}
                onChange={(exchangeAccount) => onExtraChange({ exchangeAccount: exchangeAccount || undefined })}
                options={[{ value: "", label: "Alle Konten" }, ...options.exchangeAccounts.map((x) => ({ value: x, label: x }))]}
              />
            </Group>
          )}
          {options.spot && (
            <Group label="Markt">
              <Segmented<"all" | "perp" | "spot">
                aria-label="Markt filtern"
                size="sm"
                value={extra.market ?? "all"}
                onChange={(m) => onExtraChange({ market: m === "all" ? undefined : m })}
                options={[
                  { v: "all", label: "Alle" },
                  { v: "perp", label: "Perp" },
                  { v: "spot", label: "Spot" },
                ]}
              />
            </Group>
          )}
          {options.tags.length > 0 && (
            <Group label="Tags (alle)">
              <div className="flex flex-wrap gap-1">
                {options.tags.slice(0, 16).map((tag) => {
                  const on = (extra.tags ?? []).includes(tag);
                  return (
                    <QuickChip key={tag} small on={on} onClick={() => onExtraChange({ tags: on ? (extra.tags ?? []).filter((x) => x !== tag) : [...(extra.tags ?? []), tag] })}>
                      #{tag}
                    </QuickChip>
                  );
                })}
              </div>
            </Group>
          )}
          <RangeGroup label="P&L" k="pnl" extra={extra} onChange={onExtraChange} />
          <RangeGroup label="R-Multiple" k="r" extra={extra} onChange={onExtraChange} />
          {options.hold && <RangeGroup label="Haltedauer (Min)" k="hold" extra={extra} onChange={onExtraChange} />}
          {options.leverage && <RangeGroup label="Hebel" k="lev" extra={extra} onChange={onExtraChange} />}
          <div className="flex items-end justify-end sm:col-span-2 lg:col-span-3">
            <button
              type="button"
              disabled={count === 0}
              onClick={() => (onExtraReplace ? onExtraReplace(clearJournalFilters(extra)) : onExtraChange(clearPatch()))}
              className="rounded-full border border-line-2 px-3 py-1 text-[12px] text-mute transition-colors hover:text-fg disabled:opacity-40 pointer-coarse:min-h-11"
            >
              Diese Filter leeren
            </button>
          </div>
        </div>
      </Collapse>
    </div>
  );
}

/** Patch that unsets every v3 filter (for hosts without `onExtraReplace`). */
function clearPatch(): Partial<TradeExtraFilter> {
  return { from: undefined, to: undefined, pair: undefined, exchange: undefined, market: undefined, tags: undefined, pnlMin: null, pnlMax: null, rMin: null, rMax: null, holdMin: null, holdMax: null, levMin: null, levMax: null, ratingMin: null };
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid content-start gap-1.5">
      <span className="label">{label}</span>
      {children}
    </div>
  );
}

function QuickChip({ on, onClick, children, small }: { on: boolean; onClick: () => void; children: ReactNode; small?: boolean }) {
  const reduced = useReducedFx();
  return (
    <motion.button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      whileTap={reduced ? undefined : { scale: 0.95 }}
      transition={spring.press}
      className={cn(
        "rounded-full border transition-colors duration-200 pointer-coarse:min-h-11",
        small ? "px-2.5 py-0.5 text-[11.5px]" : "px-3 py-1 text-[12px]",
        on ? "border-white/60 bg-white/[0.1] text-fg" : "border-line-2 text-mute hover:border-white/30 hover:text-fg",
      )}
    >
      {children}
    </motion.button>
  );
}

function DateInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <input
      type="date"
      aria-label={`Zeitraum ${label.toLowerCase()}`}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-9 w-full min-w-0 rounded-xl border border-line bg-ink-950/70 px-2.5 font-mono text-[12px] text-fg outline-none focus:border-white/40 pointer-coarse:h-11 [color-scheme:dark]"
    />
  );
}

const RANGE: Record<RangeKey, { min: keyof TradeExtraFilter; max: keyof TradeExtraFilter }> = {
  pnl: { min: "pnlMin", max: "pnlMax" },
  r: { min: "rMin", max: "rMax" },
  hold: { min: "holdMin", max: "holdMax" },
  lev: { min: "levMin", max: "levMax" },
};

/** Two number fields (von / bis); a field commits on change (empty = open end). */
function RangeGroup({ label, k, extra, onChange }: { label: string; k: RangeKey; extra: TradeExtraFilter; onChange: (p: Partial<TradeExtraFilter>) => void }) {
  const { min, max } = RANGE[k];
  return (
    <Group label={label}>
      <div className="grid grid-cols-2 gap-2">
        <NumberInput label={`${label} von`} value={extra[min] as number | null | undefined} onChange={(v) => onChange({ [min]: v } as Partial<TradeExtraFilter>)} placeholder="von" />
        <NumberInput label={`${label} bis`} value={extra[max] as number | null | undefined} onChange={(v) => onChange({ [max]: v } as Partial<TradeExtraFilter>)} placeholder="bis" />
      </div>
    </Group>
  );
}

function NumberInput({ label, value, onChange, placeholder }: { label: string; value: number | null | undefined; onChange: (v: number | null) => void; placeholder: string }) {
  const [text, setText] = useState(toInputString(value ?? null));
  const [seen, setSeen] = useState(value ?? null);
  // store → field (cleared, view applied): adjusted during render when the stored value moved away from the text
  if ((value ?? null) !== seen) {
    setSeen(value ?? null);
    if ((value ?? null) !== parseNumber(text)) setText(toInputString(value ?? null));
  }
  return (
    <input
      inputMode="decimal"
      aria-label={label}
      placeholder={placeholder}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const v = parseNumber(e.target.value);
        if (e.target.value.trim() === "" || v != null) onChange(e.target.value.trim() === "" ? null : v);
      }}
      className="h-9 w-full min-w-0 rounded-xl border border-line bg-ink-950/70 px-2.5 font-mono text-[12px] text-fg outline-none placeholder:text-faint focus:border-white/40 pointer-coarse:h-11"
    />
  );
}
