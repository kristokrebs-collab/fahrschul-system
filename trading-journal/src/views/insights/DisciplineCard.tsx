import { useTransform, type MotionValue } from "motion/react";
import { useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent } from "react";
import { disciplineSummary, EMPTY, explainDiscipline, heatMap, RULE_HINTS, STREAK_MIN, TITLES, type DisciplineDay, type HeatCell, type RuleKey } from "@/domain/insights";
import { cn } from "@/lib/cn";
import { date as fmtDate } from "@/lib/format";
import { MotionNumber } from "@/motion/MotionNumber";
import { useReducedFx } from "@/motion/useReducedFx";
import { EmptyState } from "@/primitives/EmptyState";
import { Collapse } from "@/primitives/Expander";
import { useSeenOnce } from "@/primitives/revealValue";
import { RingGauge } from "@/primitives/RingGauge";
import { useJournal } from "@/store/journalStore";
import { Bar } from "@/views/overview/Bar";
import { useInsightsUi } from "./insightsStore";
import { InsightCard, useInsightsBase } from "./ui";

const LEVEL_BG = ["bg-white/[0.045]", "bg-white/[0.16]", "bg-white/[0.32]", "bg-white/[0.6]", "bg-fg"] as const;
const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"] as const;
const WEEKS = 26;
/** Below this heat-map width only the last 13 weeks are shown, so a cell stays tappable (≈ 22 px on a phone). */
const NARROW = "@max-[480px]/heat:hidden";
/**
 * Fat-finger radius (px) of a heat-map tap: a tap that misses every traded cell picks the nearest traded cell whose
 * centre lies within it (cells are 15–22 px, a 44 px tap area per cell would overlap the neighbours).
 */
const TAP_RADIUS = 24;

/** The traded cell (`data-key`) nearest to a tap point within `TAP_RADIUS`; one rect read per cell, at tap time only. */
function nearestTraded(host: HTMLElement, x: number, y: number): string | null {
  let best: string | null = null;
  let bestD = TAP_RADIUS * TAP_RADIUS;
  for (const el of host.querySelectorAll<HTMLElement>("[data-key]")) {
    const r = el.getBoundingClientRect();
    if (!r.width) continue; // hidden (narrow layout)
    const dx = x - (r.left + r.width / 2);
    const dy = y - (r.top + r.height / 2);
    const d = dx * dx + dy * dy;
    if (d <= bestD) {
      bestD = d;
      best = el.dataset.key ?? null;
    }
  }
  return best;
}

function RingCentre({ progress }: { progress: MotionValue<number> }) {
  const v = useTransform(progress, (p) => p * 100);
  return <MotionNumber source={v} suffix=" %" className="dot-num text-[26px] leading-none text-fg" />;
}

const cellLabel = (c: HeatCell): string => {
  const d = new Date(c.key + "T12:00");
  const head = `${WEEKDAYS[c.weekday]} ${fmtDate(d)}`;
  if (!c.day || c.day.score == null) return `${head}: keine Trades`;
  return `${head}: ${Math.round(c.day.score)} % (${c.day.met} von ${c.day.applicable} Regeln)`;
};

function HeatMap({ cols, selected, onSelect, onOpen }: { cols: HeatCell[][]; selected: string | null; onSelect: (key: string) => void; onOpen: (key: string) => void }) {
  const reduced = useReducedFx();
  const root = useRef<HTMLDivElement>(null);
  const seen = useSeenOnce(root);
  const flat = cols.flat();
  const traded = flat.filter((c) => c.day && c.day.score != null);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" && selected) {
      e.preventDefault();
      onOpen(selected);
      return;
    }
    const dir = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!dir || !traded.length) return;
    e.preventDefault();
    const i = traded.findIndex((c) => c.key === selected);
    const next = traded[i < 0 ? traded.length - 1 : Math.max(0, Math.min(traded.length - 1, i + dir))];
    if (next) onSelect(next.key);
  };
  // one handler for the whole map: an exact hit on a traded cell wins, a near miss snaps to the nearest traded cell
  const keyAt = (e: MouseEvent<HTMLDivElement>): string | null => {
    const own = (e.target as HTMLElement).closest<HTMLElement>("[data-key]");
    if (own) return own.dataset.key ?? null;
    return root.current ? nearestTraded(root.current, e.clientX, e.clientY) : null;
  };
  return (
    <div className="@container/heat grid min-w-0 gap-1.5">
      <div className="flex gap-1.5">
        <div className="grid shrink-0 grid-rows-7 gap-[2px] pt-px text-[9px] leading-none text-faint" aria-hidden="true">
          {WEEKDAYS.map((w, i) => (
            <span key={w} className={cn("flex items-center", i % 2 === 1 && "invisible")}>
              {w}
            </span>
          ))}
        </div>
        <div
          ref={root}
          role="listbox"
          tabIndex={0}
          aria-label="Disziplin der letzten Wochen, Pfeiltasten wählen einen Handelstag, Enter öffnet ihn im Kalender"
          aria-activedescendant={selected ? `heat-${selected}` : undefined}
          onKeyDown={onKeyDown}
          onClick={(e) => {
            const key = keyAt(e);
            if (key) onSelect(key);
          }}
          onDoubleClick={(e) => {
            const key = keyAt(e);
            if (key) onOpen(key);
          }}
          className="grid min-w-0 flex-1 touch-manipulation grid-flow-col grid-rows-7 gap-[2px] rounded-sm outline-offset-4 [--heat-cols:26] @max-[480px]/heat:[--heat-cols:13]"
          style={{ gridTemplateColumns: `repeat(var(--heat-cols), minmax(0, 1fr))` } as CSSProperties}
        >
          {cols.map((col, ci) =>
            col.map((c) => {
              const has = !!c.day && c.day.score != null;
              const on = selected === c.key;
              return (
                <div
                  key={c.key}
                  id={`heat-${c.key}`}
                  role="option"
                  aria-selected={on}
                  aria-label={cellLabel(c)}
                  data-key={has ? c.key : undefined}
                  className={cn(
                    "aspect-square min-h-0 rounded-[2px] transition-opacity duration-300",
                    ci < WEEKS / 2 && NARROW,
                    c.inFuture ? "bg-transparent" : LEVEL_BG[c.level],
                    has && "cursor-pointer",
                    on && "outline outline-2 outline-offset-1 outline-signal",
                    seen || reduced ? "opacity-100" : "opacity-0",
                  )}
                  style={reduced ? undefined : { transitionDelay: `${ci * 8}ms` }}
                />
              );
            }),
          )}
        </div>
      </div>
      <div className="flex items-center justify-end gap-1 text-[9.5px] text-faint" aria-hidden="true">
        <span>weniger</span>
        {LEVEL_BG.slice(1).map((bg) => (
          <span key={bg} className={cn("size-2.5 rounded-[2px]", bg)} />
        ))}
        <span>mehr Regeln erfüllt</span>
      </div>
    </div>
  );
}

const mark = (ok: boolean | null) => (ok === true ? { t: "✓", c: "text-win" } : ok === false ? { t: "✕", c: "text-loss" } : { t: "–", c: "text-faint" });

/**
 * `Disziplin` (Tradezella progress tracker, fully automatic): score ring of the selected traded day (default: the
 * last one), streak of days ≥ 80 %, 26-week heat map (13 on phones; tap / arrows pick a day, double tap / Enter
 * opens it in the calendar), and every rule with its result that day and its 30-day rate.
 */
export function DisciplineCard() {
  const { view, settings } = useInsightsBase();
  const notes = useJournal((s) => s.days);
  const focusDay = useInsightsUi((s) => s.focusDay);
  const [today] = useState(() => new Date());
  const sum = useMemo(() => disciplineSummary({ list: view.list, settings, notes }, today), [view.list, settings, notes, today]);
  const cols = useMemo(() => heatMap(sum.days, today, WEEKS), [sum.days, today]);
  const [pick, setPick] = useState<string | null>(null);
  const [openRule, setOpenRule] = useState<RuleKey | null>(null);
  const byKey = useMemo(() => new Map(sum.days.map((d) => [d.key, d])), [sum.days]);
  const day: DisciplineDay | null = (pick ? byKey.get(pick) : null) ?? sum.last;
  const score = day?.score ?? null;

  return (
    <InsightCard title={TITLES.discipline} explain={() => explainDiscipline(sum)} note="automatisch geprüft – nichts abhaken" data-testid="insights-discipline">
      {!sum.last ? (
        <EmptyState title={EMPTY.discipline.title} text={EMPTY.discipline.text} />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[auto_minmax(0,1.25fr)_minmax(0,1fr)] lg:items-start">
          <div className="flex items-center gap-4 lg:flex-col lg:items-center">
            <RingGauge value={score == null ? null : score / 100} size={116} stroke={8} aria-label={`Tagesscore ${score == null ? "–" : Math.round(score)} %`}>
              {(p) => (
                <div className="grid justify-items-center gap-0.5">
                  <RingCentre progress={p} />
                  <span className="text-[10px] uppercase tracking-[0.12em] text-faint">Score</span>
                </div>
              )}
            </RingGauge>
            <div className="grid gap-1.5 text-[12.5px] lg:justify-items-center lg:text-center">
              <span className="font-semibold text-fg">{day && day.key === sum.last?.key && sum.lastIsToday ? "Heute" : day ? fmtDate(day.date) : "–"}</span>
              <span className="text-mute">
                Serie: <span className="num font-mono text-fg">{sum.streak}</span> {sum.streak === 1 ? "Tag" : "Tage"} ≥ {STREAK_MIN} %
              </span>
              <span className="text-mute">
                Ø {sum.window} Tage: <span className="num font-mono text-fg">{sum.avg == null ? "–" : `${Math.round(sum.avg)} %`}</span>
              </span>
              {day && (
                <button type="button" onClick={() => focusDay(day.key)} className="touch-hit w-fit text-[12px] font-medium text-fg underline decoration-line-2 underline-offset-4 hover:decoration-fg">
                  Im Kalender öffnen
                </button>
              )}
            </div>
          </div>
          <HeatMap cols={cols} selected={day?.key ?? null} onSelect={setPick} onOpen={focusDay} />
          <ul className="grid">
            {sum.rates.map((r, i) => {
              const res = day?.rules.find((x) => x.key === r.key)?.ok ?? null;
              const m = mark(res);
              const on = openRule === r.key;
              return (
                <li key={r.key} className={cn(i > 0 && "border-t border-line")}>
                  <button type="button" aria-expanded={on} aria-controls={`rule-${r.key}`} onClick={() => setOpenRule(on ? null : r.key)} className="grid min-h-11 w-full grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-2 px-1 py-1.5 text-left text-[12.5px]">
                    <span className={cn("text-center font-semibold", m.c)}>
                      <span aria-hidden="true">{m.t}</span>
                      <span className="sr-only">{res === true ? "erfüllt" : res === false ? "verletzt" : "nicht anwendbar"}</span>
                    </span>
                    <span className="grid min-w-0 gap-1">
                      <span className={cn("truncate", r.rate == null ? "text-faint" : "text-fg")}>{r.label}</span>
                      {r.rate != null && <Bar value={r.rate} index={i} className="h-1" fill={r.rate >= 0.8 ? "bg-win" : r.rate >= 0.5 ? "bg-fg" : "bg-loss"} />}
                    </span>
                    <span className="num shrink-0 font-mono text-[11.5px] text-mute">{r.rate == null ? "–" : `${Math.round(r.rate * 100)} %`}</span>
                  </button>
                  <Collapse open={on} id={`rule-${r.key}`}>
                    <p className="pb-2 pl-7 pr-1 text-[11.5px] leading-snug text-faint">{RULE_HINTS[r.key]}</p>
                  </Collapse>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </InsightCard>
  );
}
