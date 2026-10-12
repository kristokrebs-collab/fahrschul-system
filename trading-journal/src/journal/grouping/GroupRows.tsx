import { AnimatePresence, motion, useIsPresent } from "motion/react";
import { useId, type KeyboardEvent, type ReactNode } from "react";
import { RESULT_LABELS, RESULT_TONES } from "@/domain/defaults";
import { fillStats } from "@/domain/fills";
import type { TradeGroup } from "@/domain/grouping";
import type { EnrichedTrade, Setup } from "@/domain/types";
import { cn } from "@/lib/cn";
import { tradeTime } from "@/lib/dates";
import { colorClass, date, price, signed, time } from "@/lib/format";
import { EquityDraw } from "@/motion/fx/EquityDraw";
import { radius, spring, stagger, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Badge } from "@/primitives";
import { AutoHeight } from "@/views/trades/AutoHeight";
import { setupsOf } from "@/views/trades/tradeCells";

export type Group = TradeGroup<EnrichedTrade>;

/** Ø entry / Ø exit of a group of the same side (quantity weighted over the members' notional), `null` for hedges. */
export function groupPrices(g: Group): { entry: number | null; exit: number | null } {
  if (g.side === "hedge") return { entry: null, exit: null };
  let qe = 0;
  let ne = 0;
  let qx = 0;
  let nx = 0;
  for (const m of g.members) {
    const s = m.fills?.length ? fillStats(m.fills, m.side) : null;
    const entry = s?.avgEntry ?? m.entry;
    const qty = s?.openQty ?? (m.entry && m.size ? m.size / m.entry : m.qty ?? 0);
    if (entry && qty) {
      qe += qty;
      ne += entry * qty;
      if (m.exit && m.result !== "open") {
        qx += qty;
        nx += m.exit * qty;
      }
    }
  }
  return { entry: qe ? ne / qe : null, exit: qx ? nx / qx : null };
}

/** Result of the group by its summed P&L. */
export function groupResult(g: Group): EnrichedTrade["result"] {
  if (g.open || g.pnl == null) return "open";
  return g.pnl > 0 ? "win" : g.pnl < 0 ? "loss" : "be";
}

const RESULT_TONE = RESULT_TONES;
const RESULT_TEXT = RESULT_LABELS;

/** Cumulative P&L of the members in time order (for the group's mini curve). */
export function groupCurve(g: Group): number[] {
  const out = [0];
  let sum = 0;
  for (const m of g.members) {
    if (m.pnl == null) continue;
    sum += m.pnl;
    out.push(sum);
  }
  return out;
}

function kindLabel(g: Group): string {
  return g.kind === "hedge" ? (g.auto ? "Hedge · erkannt" : "Hedge") : g.kind === "position" ? "Position" : "Gruppe";
}

/* ------------------------------------------------------------------ table */

export interface GroupTableRowsProps {
  group: Group;
  setups: readonly Setup[];
  open: boolean;
  onToggle: () => void;
  onOpenTrade: (id: string) => void;
  index: number;
  layoutKey: string;
  /** Number of table columns (the panel spans them). */
  columns: number;
}

/**
 * One group in the trades table (grouping on): a summary row (dates, side or `Hedge`, the label chip, Ø prices, Σ P&L,
 * group R, result) that unfolds the members below it. The panel row is always mounted: its content sits in `AutoHeight`,
 * so opening springs the height from 0 and the rows below glide (`spring.layout`).
 */
export function GroupTableRows({ group: g, setups, open, onToggle, onOpenTrade, index, layoutKey, columns }: GroupTableRowsProps) {
  const reduced = useReducedFx();
  const present = useIsPresent();
  const panelId = useId();
  const first = g.members[0]!;
  const last = g.members[g.members.length - 1]!;
  const prices = groupPrices(g);
  const result = groupResult(g);
  const setupList = [...new Map(g.members.flatMap((m) => setupsOf(m, setups)).map((s) => [s.id, s] as const)).values()];
  const delay = Math.min(index, stagger.max) * stagger.rows;
  const onKey = (e: KeyboardEvent<HTMLTableRowElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onToggle();
    }
  };
  return (
    <>
      <motion.tr
        layout="position"
        layoutDependency={layoutKey}
        initial={reduced ? false : { opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, transition: tween.exit }}
        transition={{ layout: spring.layout, opacity: { ...tween.fade, delay }, y: { ...spring.enter, delay } }}
        tabIndex={present ? 0 : -1}
        inert={!present || undefined}
        data-group-id={g.id}
        data-exiting={present ? undefined : ""}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={onToggle}
        onKeyDown={onKey}
        className="cursor-pointer border-t border-line bg-white/[0.015] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-white/40"
      >
        <td className="px-1.5 py-3 lg:px-3">
          <div className="num font-mono text-[12.5px]">{date(tradeTime(first))}</div>
          <div className="text-[11.5px] text-faint">
            {time(tradeTime(first))}
            {last !== first ? ` → ${date(tradeTime(last))}` : ""}
          </div>
        </td>
        <td className="px-1.5 py-3 lg:px-3">
          <div className={cn("text-xs font-semibold uppercase tracking-wide", g.side === "hedge" ? "text-fg" : g.side === "short" ? "text-loss" : "text-win")}>{g.side === "hedge" ? "⇅ Hedge" : g.side === "short" ? "▼ Short" : "▲ Long"}</div>
          <div className="text-[11.5px] text-faint">{g.members.length} Teile</div>
        </td>
        <td className="max-w-[130px] px-1.5 py-3 lg:max-w-[260px] lg:px-3">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-white/25 px-2 py-0.5 text-[11px] font-medium text-fg">
            <Chevron open={open} />
            {kindLabel(g)}
          </span>
          {setupList.length > 0 && <div className="mt-1 truncate text-[11px] text-faint">{setupList.map((s) => s.name).join(" · ")}</div>}
        </td>
        <td className="num px-1.5 py-3 font-mono text-[12.5px] lg:px-3">{prices.entry != null ? `Ø ${price(prices.entry)} → ${prices.exit != null ? price(prices.exit) : "offen"}` : <span className="text-faint">Long + Short</span>}</td>
        <td className="num px-1.5 py-3 text-right font-mono text-xs text-faint lg:px-3">–</td>
        <td className={cn("num px-1.5 py-3 text-right font-mono font-medium tabular-nums lg:px-3", colorClass(g.pnl))}>{signed(g.pnl)}</td>
        <td className={cn("num px-1.5 py-3 text-right font-mono tabular-nums lg:px-3", colorClass(g.r))}>{signed(g.r)}</td>
        <td className="px-1.5 py-3 lg:px-3">
          <Badge tone={RESULT_TONE[result]}>{RESULT_TEXT[result]}</Badge>
        </td>
      </motion.tr>
      <tr data-group-panel={g.id} className="border-0">
        <td colSpan={columns} className="p-0">
          <AutoHeight>
            <div id={panelId}>{open && <GroupPanel group={g} onOpenTrade={onOpenTrade} />}</div>
          </AutoHeight>
        </td>
      </tr>
    </>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <motion.svg viewBox="0 0 10 10" className="size-2.5" animate={{ rotate: open ? 90 : 0 }} transition={spring.plus} aria-hidden="true">
      <path d="M3.75 2.5 6.25 5l-2.5 2.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </motion.svg>
  );
}

const ROW_H = 44;

/**
 * Members of an unfolded group: rows rise in one after another; on the left a drawn SVG connector (stroke draws on
 * `tween.draw`, member dots pop on `spring.pop` – win green / loss red for a hedge's legs) links them; on the right the
 * group's cumulative P&L draws itself (`EquityDraw`). Each member opens its own detail.
 */
export function GroupPanel({ group: g, onOpenTrade }: { group: Group; onOpenTrade: (id: string) => void }) {
  const reduced = useReducedFx();
  const curve = groupCurve(g);
  const h = g.members.length * ROW_H;
  return (
    <div className="grid gap-3 px-2 pb-3 pt-1 md:grid-cols-[minmax(0,1fr)_220px]">
      <div className="relative grid grid-cols-[22px_minmax(0,1fr)] gap-x-2">
        <svg aria-hidden="true" width="22" height={h} viewBox={`0 0 22 ${h}`} className="row-span-full overflow-visible">
          <motion.path
            d={`M11 ${ROW_H / 2} V ${h - ROW_H / 2}`}
            fill="none"
            stroke="rgb(255 255 255 / 0.35)"
            strokeWidth="1.5"
            strokeDasharray={g.kind === "hedge" ? "0" : "3 3"}
            initial={reduced ? false : { pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={reduced ? { duration: 0 } : tween.draw}
          />
          {g.members.map((m, i) => (
            <motion.circle
              key={m.id}
              cx={11}
              cy={i * ROW_H + ROW_H / 2}
              r={4.5}
              className={g.kind === "hedge" ? (m.side === "short" ? "fill-loss" : "fill-win") : "fill-fg"}
              stroke="var(--color-ink-850)"
              strokeWidth={2}
              initial={reduced ? false : { scale: 0 }}
              animate={{ scale: 1 }}
              style={{ transformBox: "fill-box", transformOrigin: "center" }}
              transition={reduced ? { duration: 0 } : { ...spring.pop, delay: Math.min(i, stagger.max) * stagger.lead }}
            />
          ))}
        </svg>
        <ul className="grid" aria-label={`Trades der ${g.kind === "hedge" ? "Hedge-Gruppe" : "Gruppe"}`}>
          <AnimatePresence initial={!reduced}>
            {g.members.map((m, i) => (
              <motion.li key={m.id} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ opacity: { ...tween.fade, delay: Math.min(i, stagger.max) * stagger.rows }, x: { ...spring.enter, delay: Math.min(i, stagger.max) * stagger.rows } }}>
                <MemberButton t={m} onOpen={() => onOpenTrade(m.id)} />
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      </div>
      {curve.length > 2 && (
        <div className="grid content-start gap-1">
          <span className="label">Verlauf der Gruppe</span>
          <EquityDraw values={curve} height={Math.max(72, Math.min(h, 120))} baseline={0} label={`Kumulierte P&L der Gruppe: ${signed(curve[curve.length - 1] ?? 0)}`} />
        </div>
      )}
    </div>
  );
}

function MemberButton({ t, onOpen }: { t: EnrichedTrade; onOpen: () => void }) {
  const d = tradeTime(t);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
      data-group-member={t.id}
      className="grid h-11 w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-xl px-2 text-left text-[12px] transition-colors hover:bg-white/[0.04] focus-visible:bg-white/[0.06] focus-visible:outline-none"
      style={{ borderRadius: radius.hover }}
    >
      <span className={cn("w-16 font-mono text-[11px] font-semibold uppercase", t.side === "short" ? "text-loss" : "text-win")}>{t.side === "short" ? "▼ Short" : "▲ Long"}</span>
      <span className="min-w-0 truncate text-mute">
        {date(d)} {time(d)} · <span className="font-mono text-fg/85">{price(t.entry)}</span> → <span className="font-mono text-fg/85">{t.result === "open" ? "offen" : price(t.exit)}</span>
      </span>
      <span className={cn("num font-mono tabular-nums", colorClass(t.pnl))}>{signed(t.pnl)}</span>
    </button>
  );
}

/* ------------------------------------------------------------------ cards */

/** Mobile card of a group: the summary as a button, the members unfold below (`AutoHeight`). */
export function GroupCard({ group: g, open, onToggle, onOpenTrade, children }: { group: Group; open: boolean; onToggle: () => void; onOpenTrade: (id: string) => void; children?: ReactNode }) {
  const panelId = useId();
  const result = groupResult(g);
  const first = g.members[0]!;
  return (
    <div className="rounded-2xl border border-line bg-white/[0.015]" style={{ borderRadius: radius.card }} data-group-id={g.id}>
      <button type="button" aria-expanded={open} aria-controls={panelId} onClick={onToggle} className="grid w-full gap-2 px-4 py-3 text-left">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className={cn("text-xs font-semibold uppercase tracking-wide", g.side === "hedge" ? "text-fg" : g.side === "short" ? "text-loss" : "text-win")}>{g.side === "hedge" ? "⇅ Hedge" : g.side === "short" ? "▼ Short" : "▲ Long"}</div>
            <div className="text-[11.5px] text-faint">
              {g.members.length} Teile · {date(tradeTime(first))} {time(tradeTime(first))}
            </div>
          </div>
          <div className="grid justify-items-end gap-1">
            <span className={cn("num font-mono text-[14px] font-medium tabular-nums", colorClass(g.pnl))}>{signed(g.pnl)}</span>
            <Badge tone={RESULT_TONE[result]}>{RESULT_TEXT[result]}</Badge>
          </div>
        </div>
        <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-white/25 px-2 py-0.5 text-[11px] font-medium text-fg">
          <Chevron open={open} />
          {kindLabel(g)}
        </span>
      </button>
      <AutoHeight>
        <div id={panelId}>{open && <GroupPanel group={g} onOpenTrade={onOpenTrade} />}</div>
      </AutoHeight>
      {children}
    </div>
  );
}
