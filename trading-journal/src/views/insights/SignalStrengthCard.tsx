import { motion } from "motion/react";
import { useMemo, useRef, useState } from "react";
import { conditionEffects, EMPTY, explainSignal, snapOf, strengthRows, TITLES, type StrengthKey } from "@/domain/insights";
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

/**
 * `Ergebnis nach Signal-Stärke` (other journal `insights.tsx:13-59`) plus the effect of each entry condition: rows
 * Stärke 4…0 and "Ohne Check" (n, win rate, P&L bar, Ø R; a row unfolds its trades), then "Wirkung der Bedingungen"
 * – win rate with vs without each condition among the trades that carry a check.
 */
export function SignalStrengthCard() {
  const { view, cur } = useInsightsBase();
  const res = useMemo(() => strengthRows(view.closed), [view.closed]);
  const effects = useMemo(() => conditionEffects(view.closed), [view.closed]);
  const hover = useHoverGroup<string>();
  const [open, setOpen] = useState<string | null>(null);
  const max = Math.max(1, ...res.rows.map((r) => Math.abs(r.g.net)));
  const cols = "grid grid-cols-[minmax(0,1fr)_28px_40px_auto] items-center gap-2 sm:grid-cols-[minmax(0,1.3fr)_36px_48px_minmax(96px,1fr)_52px] sm:gap-3";

  return (
    <InsightCard
      title={TITLES.signal}
      explain={() => explainSignal(res, effects)}
      note={res.withCheck ? `${res.withCheck} Trades mit Check` : undefined}
      data-testid="insights-signal"
    >
      {!res.withCheck ? (
        <EmptyState title={EMPTY.signal.title} text={EMPTY.signal.text} />
      ) : (
        <div className="grid gap-5">
          <div>
            <div className={cn(cols, "label px-2 pb-2 !text-faint")} aria-hidden="true">
              <span>Stärke</span>
              <span className="text-right">n</span>
              <span className="text-right">Win</span>
              <span className="text-right">P&L</span>
              <span className="hidden text-right sm:block">Ø R</span>
            </div>
            <ul className="grid" onMouseLeave={hover.clear}>
              {res.rows.map((r, i) => {
                const id = String(r.key);
                const on = open === id;
                return (
                  <li key={id} className="relative border-t border-line" {...hover.bind(id)}>
                    <HoverPill show={hover.hovered === id} group="signal-strength" className="inset-y-0.5" />
                    <button type="button" aria-expanded={on} aria-controls={`strength-${id}`} onClick={() => setOpen(on ? null : id)} className={cn(cols, "relative z-10 min-h-11 w-full px-2 py-2 text-left text-[13px]")}>
                      <span className="flex min-w-0 items-center gap-2">
                        <Dots k={r.key} />
                        <span className="truncate">{r.label}</span>
                      </span>
                      <span className="num text-right font-mono text-mute">{r.g.n}</span>
                      <span className="num text-right font-mono">{pct0(r.g.winRate)}</span>
                      <span className="flex min-w-0 items-center justify-end gap-2">
                        <span className="hidden min-w-0 flex-1 sm:block">
                          <Bar value={Math.abs(r.g.net) / max} index={i} fill={r.g.net >= 0 ? "bg-win/70" : "bg-loss/70"} />
                        </span>
                        <span className={cn("num shrink-0 font-mono", softTone(r.g.net))}>{signed(r.g.net, 0)}</span>
                      </span>
                      <span className={cn("num hidden text-right font-mono sm:block", softTone(r.g.avgR))}>{r.g.avgR == null ? "–" : fmtR(r.g.avgR).replace(" R", "")}</span>
                    </button>
                    <Collapse open={on} id={`strength-${id}`}>
                      <div className="pb-2">
                        <TradeList trades={r.trades} group={`strength-${id}`} extra={(t) => {
                          const s = snapOf(t);
                          return s ? `Score ${s.score} · ${s.tiers} TF` : "ohne Check";
                        }} />
                      </div>
                    </Collapse>
                  </li>
                );
              })}
            </ul>
          </div>
          {effects.length > 0 && (
            <div className="grid gap-2">
              <span className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-mute">Wirkung der Bedingungen</span>
              <ul className="grid gap-2.5">
                {effects.map((e, i) => (
                  <li key={e.key} className="grid gap-1">
                    <span className="flex items-baseline justify-between gap-3 text-[12.5px]">
                      <span className="min-w-0 truncate text-fg">{e.label}</span>
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
