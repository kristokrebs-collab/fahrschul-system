import { motion } from "motion/react";
import { useMemo, useRef, useState, type PointerEvent } from "react";
import { bucketSummary, byHour, bySession, byWeekday, EMPTY, explainTime, TITLES, type TimeBucket } from "@/domain/insights";
import { cn } from "@/lib/cn";
import { pct0, signed } from "@/lib/format";
import { spring, stagger } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { EmptyState } from "@/primitives/EmptyState";
import { useSeenOnce } from "@/primitives/revealValue";
import { Segmented } from "@/primitives/Segmented";
import { InsightCard, SEG_TOUCH, Stat, softTone, useInsightsBase } from "./ui";

type Tab = "weekday" | "session" | "hour";
const TABS = [
  { v: "weekday" as const, label: "Wochentag" },
  { v: "session" as const, label: "Session" },
  { v: "hour" as const, label: "Stunde" },
];
const CHART_H = 132;

/**
 * Net P&L columns around a zero line (positive up in green, negative down in red), one per bucket; they grow from
 * the zero line on first view (`scaleY`, staggered) and on every tab switch; an empty bucket keeps a faint dot on the zero
 * line and every label carries the bucket's trade count. The whole chart is a scrubber on touch:
 * pressing or sliding anywhere selects the nearest column (one rect read per press).
 */
function Columns({ buckets, selected, onSelect }: { buckets: readonly TimeBucket[]; selected: string | null; onSelect: (k: string) => void }) {
  const reduced = useReducedFx();
  const root = useRef<HTMLDivElement>(null);
  const seen = useSeenOnce(root);
  const rect = useRef<DOMRect | null>(null);
  const maxPos = Math.max(0, ...buckets.map((b) => b.g.net));
  const maxNeg = Math.max(0, ...buckets.map((b) => -b.g.net));
  const span = maxPos + maxNeg || 1;
  const zero = maxPos / span; // fraction from the top
  const pick = (clientX: number) => {
    const r = rect.current;
    if (!r || !buckets.length) return;
    const i = Math.max(0, Math.min(buckets.length - 1, Math.floor(((clientX - r.left) / r.width) * buckets.length)));
    const b = buckets[i];
    if (b && b.key !== selected) onSelect(b.key);
  };
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse") return;
    rect.current = e.currentTarget.getBoundingClientRect();
    pick(e.clientX);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse" || !rect.current || e.buttons === 0) return;
    pick(e.clientX);
  };
  return (
    <div ref={root} className="@container/time grid gap-1.5" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={() => (rect.current = null)} onPointerCancel={() => (rect.current = null)} style={{ touchAction: "pan-y" }}>
      <div className="relative grid gap-1" style={{ height: CHART_H, gridTemplateColumns: `repeat(${buckets.length}, minmax(0, 1fr))` }}>
        <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 h-px bg-line-2" style={{ top: `${zero * 100}%` }} />
        {buckets.map((b, i) => {
          const h = Math.abs(b.g.net) / span;
          const on = selected === b.key;
          const pos = b.g.net >= 0;
          return (
            <button
              key={b.key}
              type="button"
              aria-pressed={on}
              aria-label={`${b.label}${b.sub ? ` (${b.sub})` : ""}: ${b.g.n} Trades, ${b.g.n ? `${signed(b.g.net, 0)}, Win-Rate ${pct0(b.g.winRate)}` : "keine"}`}
              onClick={() => onSelect(b.key)}
              className={cn("relative h-full rounded-md transition-colors", on ? "bg-white/[0.06]" : "[@media(hover:hover)]:hover:bg-white/[0.03]")}
            >
              {b.g.n === 0 && (
                // an empty bucket still shows where it is: a faint dot on the zero line (sparse journals)
                <span aria-hidden="true" className="absolute left-1/2 size-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-faint" style={{ top: `${zero * 100}%` }} />
              )}
              {b.g.n > 0 && (
                <motion.span
                  aria-hidden="true"
                  className={cn("absolute inset-x-[18%] rounded-[3px]", pos ? "bg-win/75" : "bg-loss/75", on && (pos ? "bg-win" : "bg-loss"))}
                  style={{ top: pos ? `${(zero - h) * 100}%` : `${zero * 100}%`, height: `${Math.max(h * 100, 0.8)}%`, originY: pos ? 1 : 0 }}
                  initial={reduced ? false : { scaleY: 0 }}
                  animate={{ scaleY: seen || reduced ? 1 : 0 }}
                  transition={{ ...spring.enter, delay: reduced ? 0 : Math.min(i, stagger.max) * stagger.reveal }}
                />
              )}
            </button>
          );
        })}
      </div>
      <div className="grid gap-1 text-center" style={{ gridTemplateColumns: `repeat(${buckets.length}, minmax(0, 1fr))` }} aria-hidden="true">
        {buckets.map((b) => (
          <span key={b.key} className={cn("grid truncate text-[10px]", selected === b.key ? "text-fg" : "text-faint")}>
            <span className="truncate">
              <span className="@max-[440px]/time:hidden">{b.label}</span>
              <span className="hidden @max-[440px]/time:inline">{b.short}</span>
            </span>
            <span className="num font-mono text-[9.5px] text-faint">{b.g.n ? `${b.g.n} T` : "–"}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * `Zeit & Session` (Tradezella Day & Time report for 24/7 crypto): Wochentag | Session (UTC) | Stunde (2 h blocks),
 * net P&L columns, a detail line for the picked column, and best / worst / busiest / best win rate (n ≥ 3).
 */
export function TimeCard() {
  const { view, cur } = useInsightsBase();
  const [tab, setTab] = useState<Tab>("session");
  const buckets = useMemo(() => (tab === "weekday" ? byWeekday(view.closed) : tab === "session" ? bySession(view.closed) : byHour(view.closed)), [tab, view.closed]);
  const sum = useMemo(() => bucketSummary(buckets), [buckets]);
  const [selected, setSelected] = useState<string | null>(null);
  const sel = buckets.find((b) => b.key === selected) ?? sum.busiest ?? null;
  const name = (b: TimeBucket | null) => (b ? (tab === "hour" ? `${b.sub}` : b.label) : "–");

  return (
    <InsightCard
      title={TITLES.time}
      explain={explainTime}
      action={<Segmented<Tab> size="sm" aria-label="Zeit-Dimension" options={TABS} value={tab} onChange={(t) => {
        setTab(t);
        setSelected(null);
      }} className={SEG_TOUCH} />}
      data-testid="insights-time"
    >
      {!view.closed.length ? (
        <EmptyState title={EMPTY.trades.title} text={EMPTY.trades.text} />
      ) : (
        <div className="grid gap-4">
          <Columns key={tab} buckets={buckets} selected={sel?.key ?? null} onSelect={setSelected} />
          <div className="min-h-[38px] rounded-xl border border-line bg-ink-950/50 px-3 py-2 text-[12.5px]">
            {sel ? (
              <span className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                <span className="font-semibold text-fg">
                  {tab === "hour" ? sel.sub : sel.label}
                  {tab === "session" && sel.sub ? <span className="font-normal text-faint"> · {sel.sub}</span> : null}
                </span>
                <span className="num font-mono text-mute">{sel.g.n} Trades</span>
                {sel.g.n > 0 && (
                  <>
                    <span className="num font-mono text-mute">{pct0(sel.g.winRate)} Win-Rate</span>
                    <span className={cn("num font-mono", softTone(sel.g.net))}>
                      {signed(sel.g.net, 0)} {cur}
                    </span>
                  </>
                )}
              </span>
            ) : (
              <span className="text-faint">Tippe eine Säule an.</span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Beste" value={name(sum.best)} sub={sum.best ? `${signed(sum.best.g.net, 0)} ${cur}` : "ab 3 Trades"} tone={sum.best ? "text-win" : "text-faint"} />
            <Stat label="Schlechteste" value={name(sum.worst)} sub={sum.worst ? `${signed(sum.worst.g.net, 0)} ${cur}` : "–"} tone={sum.worst ? "text-loss" : "text-faint"} />
            <Stat label="Aktivste" value={name(sum.busiest)} sub={sum.busiest ? `${sum.busiest.g.n} Trades` : "–"} />
            <Stat label="Beste Win-Rate" value={name(sum.bestWin)} sub={sum.bestWin ? pct0(sum.bestWin.g.winRate) : "ab 3 Trades"} />
          </div>
        </div>
      )}
    </InsightCard>
  );
}
