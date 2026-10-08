import { motion } from "motion/react";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { aggregate } from "@/domain/agg";
import { conditionEffects, EMPTY, explainSignal, snapOf, strengthRows, TITLES, type ConditionEffect, type StrengthKey } from "@/domain/insights";
import { snapshotState, WHALE_TITLE, type SignalSnapshot } from "@/domain/signals";
import type { EnrichedTrade } from "@/domain/types";
import { cn } from "@/lib/cn";
import { pct0, r as fmtR, signed } from "@/lib/format";
import { HoverPill, useHoverGroup } from "@/motion/HoverPill";
import { tween } from "@/motion/tokens";
import { EmptyState } from "@/primitives/EmptyState";
import { Collapse } from "@/primitives/Expander";
import { useRevealValue } from "@/primitives/revealValue";
import { Bar, barDelay } from "@/views/overview/Bar";
import { InsightCard, TradeList, softTone, useInsightsBase } from "./ui";

function Dots({ k }: { k: StrengthKey }) {
  return (
    <span className="flex shrink-0 gap-0.5" aria-hidden="true">
      {[1, 2, 3, 4].map((d) => (
        <span key={d} className={cn("size-1.5 rounded-full", k !== "none" && d <= k ? "bg-fg" : "bg-line-2")} />
      ))}
    </span>
  );
}

/** Centred ± bar: the condition's win-rate effect (±50 pp fill one half); grows out of the centre on first view. */
function EffectBar({ d, index }: { d: number | null; index: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const w = d == null ? 0 : Math.min(1, Math.abs(d) / 0.5);
  const fill = useRevealValue(ref, w, { transition: tween.bar, delay: barDelay(index) });
  return (
    <span ref={ref} className="relative block h-1.5 overflow-hidden rounded-full bg-white/[0.04]" aria-hidden="true">
      <span className="absolute inset-y-0 left-1/2 z-10 w-px bg-line-2" />
      {d != null && (
        <motion.span
          className={cn("absolute inset-y-0 w-1/2", d >= 0 ? "left-1/2 bg-win/70" : "right-1/2 bg-loss/70")}
          style={{ originX: d >= 0 ? 0 : 1, scaleX: fill }}
        />
      )}
    </span>
  );
}

/** Effect row of "Top-Trader kaufen · Retail rot" (ours): the condition is stored per snapshot side. */
export type WhaleEffect = Omit<ConditionEffect, "key"> & { key: "whale"; /** trades with a check but no top-trader data (old / other source) */ noData: number };

/**
 * Win rate with vs without "Top-Trader kaufen · Retail rot" among the closed trades whose snapshot carries a reading;
 * snapshots without data (`whale: null`, older than ~30 days) or from before the condition are left out, never counted
 * as "not met". `null` when no trade has a reading.
 */
export function whaleEffect(closed: readonly EnrichedTrade[]): WhaleEffect | null {
  const met: EnrichedTrade[] = [];
  const missed: EnrichedTrade[] = [];
  let noData = 0;
  for (const t of closed) {
    const s = snapOf(t);
    if (!s) continue;
    if (!s.whale) {
      noData++;
      continue;
    }
    (s.whale.ok ? met : missed).push(t);
  }
  if (!met.length && !missed.length) return null;
  const a = aggregate(met);
  const b = aggregate(missed);
  const both = a.n > 0 && b.n > 0;
  return {
    key: "whale",
    label: `${WHALE_TITLE.long} (Short: verkaufen · grün)`,
    met: a,
    missed: b,
    dWin: both ? (a.winRate ?? 0) - (b.winRate ?? 0) : null,
    dR: a.avgR != null && b.avgR != null ? a.avgR - b.avgR : null,
    dExp: both ? (a.exp ?? 0) - (b.exp ?? 0) : null,
    noData,
  };
}

// ------------------------------------------------------------------ v2: candle-close state + graded parts

/** Candle-close state of the stored entry (decision 6); `unknown` = a snapshot from before the rule. */
export type StateKey = "strong" | "confirmed" | "provisional" | "none" | "unknown";
const STATE_ORDER: readonly StateKey[] = ["strong", "confirmed", "provisional", "none", "unknown"];
export const STATE_ROW_LABEL: Readonly<Record<StateKey, string>> = {
  strong: "Stark bestätigt",
  confirmed: "Bestätigt",
  provisional: "Vorläufig (Kerze offen)",
  none: "Kein Einstieg",
  unknown: "Ohne Status",
};

export interface StateRow {
  key: StateKey;
  label: string;
  g: ReturnType<typeof aggregate>;
  trades: EnrichedTrade[];
}

/**
 * Closed trades with a check grouped by the candle-close state of their stored entry: stark bestätigt · bestätigt ·
 * vorläufig (the base candle was still forming when the trade was entered) · kein Einstieg · ohne Status (older
 * snapshots). `[]` when no snapshot carries a state yet (the section stays hidden).
 */
export function stateRows(closed: readonly EnrichedTrade[]): StateRow[] {
  const by = new Map<StateKey, EnrichedTrade[]>();
  let any = false;
  for (const t of closed) {
    const s = snapOf(t);
    if (!s) continue;
    const st = snapshotState(s);
    if (st) any = true;
    const k: StateKey = st ?? "unknown";
    const arr = by.get(k);
    if (arr) arr.push(t);
    else by.set(k, [t]);
  }
  if (!any) return [];
  return STATE_ORDER.filter((k) => by.has(k)).map((k) => ({ key: k, label: STATE_ROW_LABEL[k], g: aggregate(by.get(k)!), trades: by.get(k)! }));
}

/** Effect row of a graded part (or one of its items) of the v2 snapshots. */
export type PartEffect = Omit<ConditionEffect, "key"> & {
  key: string;
  /** trades whose check had the part but no data for it */
  noData: number;
  /** an item of the row above (indented) */
  sub?: boolean;
};

/** What each part effect reads from a stored snapshot: `true` / `false` = held / not, `null` = keine Daten, `undefined` = not stored. */
const PART_EFFECTS: ReadonlyArray<{ key: string; label: string; sub?: boolean; read: (s: SignalSnapshot) => boolean | null | undefined }> = [
  { key: "traders", label: "Top-Trader-Kombi erfüllt", read: (s) => part(s, "traders", (p) => p.ok) },
  { key: "traders-pos", label: "Top-Trader Positionen", sub: true, read: (s) => item(s, "traders", "pos") },
  { key: "traders-acc", label: "Top-Trader Konten", sub: true, read: (s) => item(s, "traders", "acc") },
  { key: "traders-retail", label: "Retail gegenläufig (rot / grün)", sub: true, read: (s) => item(s, "traders", "retail") },
  { key: "div", label: "Divergenz (regulär, bestätigt)", read: (s) => part(s, "div", (p) => p.ok) },
  { key: "sr", label: "Support / Widerstand + Platz", read: (s) => part(s, "sr", (p) => p.ok) },
];

function part(s: SignalSnapshot, id: string, ok: (p: NonNullable<SignalSnapshot["parts"]>[number]) => boolean): boolean | null | undefined {
  const p = s.parts?.find((x) => x.id === id);
  if (!p) return undefined;
  return p.data ? ok(p) : null;
}

function item(s: SignalSnapshot, id: string, itemId: string): boolean | null | undefined {
  const p = s.parts?.find((x) => x.id === id);
  if (!p) return undefined;
  const it = p.items.find((i) => i.id === itemId);
  return p.data && it ? it.met : null;
}

/**
 * Win rate with vs without each graded part (Top-Trader-Kombi and its items, Divergenz, Support / Widerstand) among the
 * closed trades whose snapshot stored it with data; snapshots without the part are left out, "keine Daten" is counted
 * separately – never as "not met". Parts no trade has data for are omitted.
 */
export function partEffects(closed: readonly EnrichedTrade[]): PartEffect[] {
  const snaps = closed.map((t) => ({ t, s: snapOf(t) })).filter((x): x is { t: EnrichedTrade; s: SignalSnapshot } => x.s !== null && !!x.s.parts?.length);
  if (!snaps.length) return [];
  const out: PartEffect[] = [];
  for (const def of PART_EFFECTS) {
    const met: EnrichedTrade[] = [];
    const missed: EnrichedTrade[] = [];
    let noData = 0;
    for (const { t, s } of snaps) {
      const v = def.read(s);
      if (v === undefined) continue;
      if (v === null) noData++;
      else (v ? met : missed).push(t);
    }
    if (!met.length && !missed.length) continue;
    const a = aggregate(met);
    const b = aggregate(missed);
    const both = a.n > 0 && b.n > 0;
    out.push({
      key: def.key,
      label: def.label,
      met: a,
      missed: b,
      dWin: both ? (a.winRate ?? 0) - (b.winRate ?? 0) : null,
      dR: a.avgR != null && b.avgR != null ? a.avgR - b.avgR : null,
      dExp: both ? (a.exp ?? 0) - (b.exp ?? 0) : null,
      noData,
      ...(def.sub ? { sub: true } : {}),
    });
  }
  return out;
}

/** Key glyph of a candle-close state (neutral ink, as the chart legend). */
function StateGlyph({ k }: { k: StateKey }) {
  if (k === "none" || k === "unknown") return <span aria-hidden="true" className="h-px w-2.5 shrink-0 bg-line-2" />;
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className="shrink-0">
      {k === "provisional" ? <circle cx="6" cy="6" r="3" fill="none" stroke="#9b9b9b" strokeWidth="1.25" /> : <circle cx="6" cy="6" r="3.25" fill="#d9d9d9" />}
      {k === "strong" && <circle cx="6" cy="6" r="5.4" fill="none" stroke="#d9d9d9" strokeOpacity="0.5" strokeWidth="1" />}
    </svg>
  );
}

const TABLE_COLS = "grid grid-cols-[minmax(0,1fr)_28px_40px_auto] items-center gap-2 sm:grid-cols-[minmax(0,1.3fr)_36px_48px_minmax(96px,1fr)_52px] sm:gap-3";

interface GroupRow {
  id: string;
  label: string;
  g: ReturnType<typeof aggregate>;
  trades: EnrichedTrade[];
  glyph: ReactNode;
}

/**
 * One grouped results table (`Stärke` / `Kerzenschluss`): n, win rate, P&L bar, Ø R; a row unfolds its trades. Shared
 * hover pill and open row per table.
 */
function GroupTable({ head, rows, group, pill, barOffset = 0 }: { head: string; rows: readonly GroupRow[]; group: string; pill: string; barOffset?: number }) {
  const hover = useHoverGroup<string>();
  const [open, setOpen] = useState<string | null>(null);
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.g.net)));
  return (
    <div>
      <div className={cn(TABLE_COLS, "label px-2 pb-2 !text-faint")} aria-hidden="true">
        <span>{head}</span>
        <span className="text-right">n</span>
        <span className="text-right">Win</span>
        <span className="text-right">P&L</span>
        <span className="hidden text-right sm:block">Ø R</span>
      </div>
      <ul className="grid" onMouseLeave={hover.clear}>
        {rows.map((r, i) => {
          const on = open === r.id;
          const domId = `${group}-${r.id}`;
          return (
            <li key={r.id} className="relative border-t border-line" {...hover.bind(r.id)} data-row={r.id}>
              <HoverPill show={hover.hovered === r.id} group={pill} className="inset-y-0.5" />
              <button type="button" aria-expanded={on} aria-controls={domId} onClick={() => setOpen(on ? null : r.id)} className={cn(TABLE_COLS, "relative z-10 min-h-11 w-full px-2 py-2 text-left text-[13px]")}>
                <span className="flex min-w-0 items-center gap-2">
                  {r.glyph}
                  <span className="truncate">{r.label}</span>
                </span>
                <span className="num text-right font-mono text-mute">{r.g.n}</span>
                <span className="num text-right font-mono">{pct0(r.g.winRate)}</span>
                <span className="flex min-w-0 items-center justify-end gap-2">
                  <span className="hidden min-w-0 flex-1 sm:block">
                    <Bar value={Math.abs(r.g.net) / max} index={i + barOffset} fill={r.g.net >= 0 ? "bg-win/70" : "bg-loss/70"} />
                  </span>
                  <span className={cn("num shrink-0 font-mono", softTone(r.g.net))}>{signed(r.g.net, 0)}</span>
                </span>
                <span className={cn("num hidden text-right font-mono sm:block", softTone(r.g.avgR))}>{r.g.avgR == null ? "–" : fmtR(r.g.avgR).replace(" R", "")}</span>
              </button>
              <Collapse open={on} id={domId}>
                <div className="pb-2">
                  <TradeList
                    trades={r.trades}
                    group={domId}
                    extra={(t) => {
                      const s = snapOf(t);
                      return s ? `Score ${s.score} · ${s.tiers} TF` : "ohne Check";
                    }}
                  />
                </div>
              </Collapse>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * `Ergebnis nach Signal-Stärke` (other journal `insights.tsx:13-59`) plus the effect of each entry condition: rows
 * Stärke 4…0 and "Ohne Check" (n, win rate, P&L bar, Ø R; a row unfolds its trades); with v2 snapshots the same table
 * by candle-close state (stark bestätigt · bestätigt · vorläufig · kein Einstieg · ohne Status, `stateRows`); then
 * "Wirkung der Bedingungen" – win rate with vs without each condition among the trades that carry a check, plus
 * "Top-Trader kaufen · Retail rot" among the trades whose check has top-trader data (`whaleEffect`) and the graded
 * parts of v2 snapshots (`partEffects`: Top-Trader-Kombi + its items, Divergenz, Support / Widerstand); "keine Daten"
 * trades are listed, never counted.
 */
export function SignalStrengthCard() {
  const { view, cur } = useInsightsBase();
  const res = useMemo(() => strengthRows(view.closed), [view.closed]);
  const effects = useMemo(() => conditionEffects(view.closed), [view.closed]);
  const whale = useMemo(() => whaleEffect(view.closed), [view.closed]);
  const states = useMemo(() => stateRows(view.closed), [view.closed]);
  const parts = useMemo(() => partEffects(view.closed), [view.closed]);
  const rows: (ConditionEffect | WhaleEffect | PartEffect)[] = [...effects, ...(whale ? [whale] : []), ...parts];
  const strengthGroup: GroupRow[] = res.rows.map((r) => ({ id: String(r.key), label: r.label, g: r.g, trades: r.trades, glyph: <Dots k={r.key} /> }));
  const stateGroup: GroupRow[] = states.map((r) => ({ id: r.key, label: r.label, g: r.g, trades: r.trades, glyph: <StateGlyph k={r.key} /> }));

  return (
    <InsightCard
      title={TITLES.signal}
      explain={() => explainSignal(res, effects, [...(whale ? [whale] : []), ...parts])}
      note={res.withCheck ? `${res.withCheck} Trades mit Check` : undefined}
      data-testid="insights-signal"
    >
      {!res.withCheck ? (
        <EmptyState title={EMPTY.signal.title} text={EMPTY.signal.text} />
      ) : (
        <div className="grid gap-5">
          <GroupTable head="Stärke" rows={strengthGroup} group="strength" pill="signal-strength" />
          {stateGroup.length > 0 && (
            <div data-testid="insights-signal-state">
              <GroupTable head="Kerzenschluss" rows={stateGroup} group="signal-state" pill="signal-state" barOffset={strengthGroup.length} />
            </div>
          )}
          {rows.length > 0 && (
            <div className="grid gap-2">
              <span className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-mute">Wirkung der Bedingungen</span>
              <ul className="grid gap-2.5">
                {rows.map((e, i) => (
                  <li
                    key={e.key}
                    className={cn("grid gap-1", "sub" in e && e.sub && "border-l border-line pl-3")}
                    data-testid={e.key === "whale" ? "insights-signal-whale" : "noData" in e ? `insights-signal-part-${e.key}` : undefined}
                  >
                    <span className="flex items-baseline justify-between gap-3 text-[12.5px]">
                      <span className={cn("min-w-0 truncate", "sub" in e && e.sub ? "text-mute" : "text-fg")}>{e.label}</span>
                      <span className={cn("num shrink-0 font-mono text-[12px]", softTone(e.dWin))}>{e.dWin == null ? "–" : `${signed(e.dWin * 100, 0)} pp`}</span>
                    </span>
                    <EffectBar d={e.dWin} index={i} />
                    <span className="num flex flex-wrap gap-x-3 text-[11px] text-faint">
                      <span className="whitespace-nowrap">
                        mit {e.met.n} · {pct0(e.met.winRate)}
                      </span>
                      <span className="whitespace-nowrap">
                        ohne {e.missed.n} · {pct0(e.missed.winRate)}
                      </span>
                      {e.dExp != null && (
                        <span className={cn("whitespace-nowrap", softTone(e.dExp))}>
                          Ø {signed(e.dExp, 0)} {cur} je Trade
                        </span>
                      )}
                      {"noData" in e && e.noData > 0 && <span className="whitespace-nowrap">keine Daten {e.noData}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </InsightCard>
  );
}
