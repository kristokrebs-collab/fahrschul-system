import { useTransform, type MotionValue } from "motion/react";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent } from "react";
import { disciplineSummary, EMPTY, explainDiscipline, heatMap, RULE_HINTS, STREAK_MIN, TITLES, type DisciplineDay, type HeatCell, type RuleKey } from "@/domain/insights";
import { cn } from "@/lib/cn";
import { localDateKey } from "@/lib/dates";
import { date as fmtDate } from "@/lib/format";
import { MotionNumber } from "@/motion/MotionNumber";
import { useReducedFx } from "@/motion/useReducedFx";
import { EmptyState } from "@/primitives/EmptyState";
import { Collapse } from "@/primitives/Expander";
import { useSeenOnce } from "@/primitives/revealValue";
import { RingGauge } from "@/primitives/RingGauge";
import { useJournal } from "@/store/journalStore";
import { Bar } from "@/views/overview/Bar";
import { brokenLine, dayMarks, heatWeeks, HEAT, lastTradingDays, monthLabels, RULE_SHORT, scoreTone, scoreTrend, weakestRule, type TrendPoint, type WeakRule } from "./disciplineView";
import { useInsightsUi } from "./insightsStore";
import { InsightCard, useInsightsBase } from "./ui";

/**
 * Opaque cell colours (no white-alpha: Samsung Internet's dark filter turns translucent white into translucent black,
 * which made the empty days vanish on the user's tablet). Index = heat level (1 < 50 % · 2 < 75 % · 3 < 100 % · 4 = 100 %).
 */
const LEVEL_BG = ["bg-[#2c2c2c]", "bg-[#4a4a4a]", "bg-[#7d7d7d]", "bg-[#b5b5b5]", "bg-fg"] as const;
const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"] as const;
/**
 * Fat-finger radius (px) of a heat-map tap: a tap that misses every traded cell picks the nearest traded cell whose
 * centre lies within it (cells are 14–17 px, a 44 px tap area per cell would overlap the neighbours).
 */
const TAP_RADIUS = 24;
/** Section label inside the card (mono caps, like the card titles but quieter). */
const SUB = "text-[10.5px] font-semibold uppercase tracking-[0.12em] text-mute";

const TONE_DOT: Record<ReturnType<typeof scoreTone>, string> = { strong: "bg-fg", mid: "bg-[#8a8a8a]", weak: "bg-signal", none: "bg-transparent" };
const TONE_TEXT: Record<ReturnType<typeof scoreTone>, string> = { strong: "text-fg", mid: "text-mute", weak: "text-signal", none: "text-faint" };

/** The traded cell (`data-key`) nearest to a tap point within `TAP_RADIUS`; one rect read per cell, at tap time only. */
function nearestTraded(host: HTMLElement, x: number, y: number): string | null {
  let best: string | null = null;
  let bestD = TAP_RADIUS * TAP_RADIUS;
  for (const el of host.querySelectorAll<HTMLElement>("[data-key]")) {
    const r = el.getBoundingClientRect();
    if (!r.width) continue;
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

const dayHead = (d: Date, weekday: number): string => `${WEEKDAYS[weekday]} ${fmtDate(d)}`;
const weekdayOf = (d: Date): number => (d.getDay() + 6) % 7;

const cellLabel = (c: HeatCell, today: boolean): string => {
  const head = `${dayHead(new Date(c.key + "T12:00"), c.weekday)}${today ? " (heute)" : ""}`;
  if (!c.day || c.day.score == null) return `${head}: keine Trades`;
  return `${head}: ${Math.round(c.day.score)} % (${c.day.met} von ${c.day.applicable} Regeln)`;
};

/** Week columns that fit the measured width (ResizeObserver; re-renders only when the count changes). */
function useHeatWeeks(ref: React.RefObject<HTMLElement | null>): number {
  const [weeks, setWeeks] = useState<number>(HEAT.fallbackWeeks);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      if (w > 0) setWeeks(heatWeeks(w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return weeks;
}

/**
 * Heat map: one column per week (as many as fit the column, oldest left), Mo…So rows. Every past day is drawn – a faint
 * dot on a day without trades, a filled square on a traded day (opaque grey ramp → white = every rule met), today
 * framed, month names above. Tap / arrows pick a traded day, double tap / Enter opens it in the calendar.
 */
function HeatMap({ days, today, selected, onSelect, onOpen }: { days: readonly DisciplineDay[]; today: Date; selected: string | null; onSelect: (key: string) => void; onOpen: (key: string) => void }) {
  const reduced = useReducedFx();
  const measureRef = useRef<HTMLDivElement>(null);
  const weeks = useHeatWeeks(measureRef);
  const cols = useMemo(() => heatMap(days, today, weeks), [days, today, weeks]);
  const months = useMemo(() => monthLabels(cols), [cols]);
  const root = useRef<HTMLDivElement>(null);
  const seen = useSeenOnce(root);
  const traded = cols.flat().filter((c) => c.day && c.day.score != null);
  const todayKey = localDateKey(today);
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
  const grid = { gridTemplateColumns: `repeat(${weeks}, minmax(0, 1fr))`, columnGap: HEAT.gap, rowGap: HEAT.gap } as CSSProperties;
  return (
    <div className="grid min-w-0 gap-1.5">
      <div className="flex gap-2">
        <div className="grid shrink-0 grid-rows-[12px_1fr] gap-1 text-[9px] leading-none text-faint" aria-hidden="true">
          <span />
          <div className="grid grid-rows-7" style={{ rowGap: HEAT.gap }}>
            {WEEKDAYS.map((w, i) => (
              <span key={w} className={cn("flex items-center", i % 2 === 1 && "invisible")}>
                {w}
              </span>
            ))}
          </div>
        </div>
        <div ref={measureRef} className="grid min-w-0 flex-1 grid-rows-[12px_auto] gap-1">
          <div className="grid text-[9.5px] leading-3 text-faint" style={grid} aria-hidden="true">
            {months.map((m) => (
              <span key={`${m.col}-${m.label}`} className="whitespace-nowrap" style={{ gridColumn: `${m.col + 1} / span 3`, gridRow: 1 }}>
                {m.label}
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
            className="grid touch-manipulation grid-flow-col grid-rows-7 rounded-sm outline-offset-4"
            style={grid}
            data-weeks={weeks}
          >
            {cols.map((col, ci) =>
              col.map((c) => {
                const has = !!c.day && c.day.score != null;
                const on = selected === c.key;
                const isToday = c.key === todayKey;
                if (c.inFuture) return <div key={c.key} aria-hidden="true" className="aspect-square min-h-0" />;
                return (
                  <div
                    key={c.key}
                    id={`heat-${c.key}`}
                    role="option"
                    aria-selected={on}
                    aria-label={cellLabel(c, isToday)}
                    data-key={has ? c.key : undefined}
                    data-today={isToday ? "" : undefined}
                    className={cn(
                      "relative grid aspect-square min-h-0 place-items-center rounded-[3px] transition-opacity duration-300",
                      has ? cn(LEVEL_BG[c.level], "cursor-pointer") : "",
                      isToday && "shadow-[inset_0_0_0_1px_#9b9b9b]",
                      on && "outline outline-2 outline-offset-1 outline-signal",
                      seen || reduced ? "opacity-100" : "opacity-30",
                    )}
                    style={reduced ? undefined : { transitionDelay: `${ci * 8}ms` }}
                  >
                    {!has && !isToday && <span aria-hidden="true" className="size-[3px] rounded-full bg-[#3a3a3a]" />}
                  </div>
                );
              }),
            )}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 pl-6 text-[9.5px] text-faint" aria-hidden="true">
        <span className="flex items-center gap-3">
          <span className="flex items-center gap-1.5">
            <span className="grid size-2.5 place-items-center">
              <span className="size-[3px] rounded-full bg-[#3a3a3a]" />
            </span>
            kein Trade
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-[2px] shadow-[inset_0_0_0_1px_#9b9b9b]" />
            heute
          </span>
        </span>
        <span className="flex items-center gap-1">
          <span>weniger</span>
          {LEVEL_BG.slice(1).map((bg) => (
            <span key={bg} className={cn("size-2.5 rounded-[2px]", bg)} />
          ))}
          <span>mehr Regeln erfüllt</span>
        </span>
      </div>
    </div>
  );
}

/**
 * Score trend of the last 30 calendar days as a dot-matrix lollipop: a faint dot on every day, a stem up to the day
 * score on traded days (white ≥ 80 %, red < 50 %), the 80 % streak line dashed. Decorative for screen readers (the
 * summary line carries the numbers). First view: stems grow from the baseline (scaleY, column stagger).
 */
function ScoreTrend({ points, avg, selected }: { points: readonly TrendPoint[]; avg: number | null; selected: string | null }) {
  const reduced = useReducedFx();
  const root = useRef<HTMLDivElement>(null);
  const seen = useSeenOnce(root);
  const traded = points.filter((p) => p.score != null).length;
  const first = points[0];
  const mid = points[Math.floor(points.length / 2)];
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className={SUB}>Score-Verlauf · {points.length} Tage</span>
        <span className="num font-mono text-[11.5px] text-mute">
          Ø <span className="text-fg">{avg == null ? "–" : `${Math.round(avg)} %`}</span> · {traded} {traded === 1 ? "Handelstag" : "Handelstage"}
        </span>
      </div>
      <div ref={root} aria-hidden="true" className="relative h-[76px]">
        {/* 80 % streak line + 0 baseline */}
        <span className="absolute inset-x-0 border-t border-dashed border-[#3a3a3a]" style={{ bottom: `${STREAK_MIN}%` }} />
        <span className="absolute left-0 -translate-y-full pb-0.5 font-mono text-[9px] leading-none text-faint" style={{ bottom: `${STREAK_MIN}%` }}>
          {STREAK_MIN} %
        </span>
        <span className="absolute inset-x-0 bottom-0 h-px bg-line" />
        {traded === 0 && <span className="absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-[11.5px] text-faint">Keine Handelstage in den letzten {points.length} Tagen</span>}
        <div className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${points.length}, minmax(0, 1fr))` }}>
          {points.map((p, i) => {
            const tone = scoreTone(p.score);
            const on = p.key === selected;
            return (
              <div key={p.key} className="relative">
                {p.score == null ? (
                  <span className={cn("absolute bottom-[-1px] left-1/2 size-[3px] -translate-x-1/2 rounded-full", p.today ? "bg-mute" : "bg-[#3a3a3a]")} />
                ) : (
                  <span
                    className="absolute inset-x-0 bottom-0 origin-bottom transition-transform duration-500 ease-out"
                    style={{ height: `${Math.max(4, p.score)}%`, transform: seen || reduced ? "none" : "scaleY(0.02)", transitionDelay: reduced ? undefined : `${i * 12}ms` }}
                  >
                    <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-[#5f5f5f]" />
                    <span className={cn("absolute left-1/2 top-0 size-[7px] -translate-x-1/2 -translate-y-1/2 rounded-full", TONE_DOT[tone], on && "ring-2 ring-signal ring-offset-2 ring-offset-ink-900")} />
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div className="flex justify-between font-mono text-[9.5px] text-faint" aria-hidden="true">
        <span>{first ? fmtDate(first.date).slice(0, 6) : ""}</span>
        <span>{mid ? fmtDate(mid.date).slice(0, 6) : ""}</span>
        <span>Heute</span>
      </div>
    </div>
  );
}

/** The newest trading days: date, score and every rule as a mark (✓ green · ✕ red · – not judged); a tap selects the day. */
function LastDays({ days, selected, onSelect }: { days: readonly DisciplineDay[]; selected: string | null; onSelect: (key: string) => void }) {
  return (
    <div className="grid content-start gap-1.5">
      <span className={SUB}>Letzte Handelstage</span>
      <ul className="grid">
        {days.map((d, i) => {
          const marks = dayMarks(d);
          const broken = marks.filter((m) => m.ok === false).map((m) => RULE_SHORT[m.key]);
          const tone = scoreTone(d.score);
          const on = d.key === selected;
          const head = dayHead(d.date, weekdayOf(d.date));
          return (
            <li key={d.key} className={cn(i > 0 && "border-t border-line")}>
              <button
                type="button"
                aria-pressed={on}
                aria-label={`${head}: ${Math.round(d.score ?? 0)} %, ${d.met} von ${d.applicable} Regeln${broken.length ? `, verletzt: ${broken.join(", ")}` : ", alle erfüllt"}`}
                onClick={() => onSelect(d.key)}
                className={cn("grid min-h-11 w-full gap-1 rounded-lg px-2 py-2 text-left transition-colors duration-200 hover:bg-white/[0.03]", on && "bg-white/[0.04]")}
              >
                <span className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3">
                  <span className="flex min-w-0 items-center gap-2 text-[12.5px] text-fg">
                    <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", on ? "bg-signal" : "bg-transparent")} />
                    <span className="num truncate font-mono text-[11.5px]">{head}</span>
                  </span>
                  <span aria-hidden="true" className="flex items-center gap-[3px]">
                    {marks.map((m) => (
                      <span key={m.key} className={cn("h-2.5 w-1.5 rounded-[1.5px]", m.ok === true ? "bg-win/80" : m.ok === false ? "bg-loss" : "bg-[#2c2c2c]")} />
                    ))}
                  </span>
                  <span className={cn("num w-11 text-right font-mono text-[12px]", TONE_TEXT[tone])}>{d.score == null ? "–" : `${Math.round(d.score)} %`}</span>
                </span>
                <span className="truncate pl-3.5 text-[11px] text-faint">{broken.length ? `✕ ${broken.join(" · ")}` : "✓ alle prüfbaren Regeln erfüllt"}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** The rule kept least often in the window, what it asks for, and how often it broke (or: every rule kept). */
function WeakestRule({ weak, window, judged }: { weak: WeakRule | null; window: number; judged: boolean }) {
  return (
    <div className="grid content-start gap-2 rounded-xl border border-line bg-ink-950/50 p-3.5">
      <span className={SUB}>Schwächste Regel · {window} Tage</span>
      {!judged ? (
        <p className="text-[12.5px] text-mute">Keine Handelstage in den letzten {window} Tagen.</p>
      ) : weak ? (
        <>
          <div className="flex items-baseline justify-between gap-3">
            <strong className="min-w-0 text-[13.5px] font-semibold text-fg">{weak.label}</strong>
            <span className="num shrink-0 font-mono text-[15px] text-signal">{Math.round(weak.rate * 100)} %</span>
          </div>
          <Bar value={weak.rate} className="h-1" fill="bg-signal" />
          <p className="text-[11.5px] leading-snug text-mute">
            {brokenLine(weak)} {RULE_HINTS[weak.key]}
          </p>
        </>
      ) : (
        <p className="flex items-center gap-2 text-[12.5px] text-fg">
          <span aria-hidden="true" className="font-semibold text-win">
            ✓
          </span>
          Alle prüfbaren Regeln eingehalten.
        </p>
      )}
    </div>
  );
}

const mark = (ok: boolean | null) => (ok === true ? { t: "✓", c: "text-win" } : ok === false ? { t: "✕", c: "text-loss" } : { t: "–", c: "text-faint" });

/**
 * `Disziplin` (Tradezella progress tracker, fully automatic): score ring of the selected traded day (default: the last
 * one) with streak and 30-day average, the heat map (as many weeks as fit, every day visible; tap / arrows pick a day,
 * double tap / Enter opens it in the calendar), the 30-day score trend, the last trading days with their rule hits, the
 * weakest rule, and every rule with its result that day and its 30-day rate.
 */
export function DisciplineCard() {
  const { view, settings } = useInsightsBase();
  const notes = useJournal((s) => s.days);
  const focusDay = useInsightsUi((s) => s.focusDay);
  const [today] = useState(() => new Date());
  const sum = useMemo(() => disciplineSummary({ list: view.list, settings, notes }, today), [view.list, settings, notes, today]);
  const trend = useMemo(() => scoreTrend(sum.days, today, sum.window), [sum.days, today, sum.window]);
  const recent = useMemo(() => lastTradingDays(sum.days, 5), [sum.days]);
  const weak = useMemo(() => weakestRule(sum.rates), [sum.rates]);
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
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,23rem)] lg:gap-8">
          <div className="grid min-w-0 content-start gap-6">
            <div className="grid gap-5 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-start sm:gap-6">
              <div className="flex items-center gap-4 sm:flex-col sm:items-center">
                <RingGauge value={score == null ? null : score / 100} size={116} stroke={8} aria-label={`Tagesscore ${score == null ? "–" : Math.round(score)} %`}>
                  {(p) => (
                    <div className="grid justify-items-center gap-0.5">
                      <RingCentre progress={p} />
                      <span className="text-[10px] uppercase tracking-[0.12em] text-faint">Score</span>
                    </div>
                  )}
                </RingGauge>
                <div className="grid gap-1.5 text-[12.5px] sm:justify-items-center sm:text-center">
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
              <HeatMap days={sum.days} today={today} selected={day?.key ?? null} onSelect={setPick} onOpen={focusDay} />
            </div>
            <ScoreTrend points={trend} avg={sum.avg} selected={day?.key ?? null} />
            <div className="grid gap-5 md:grid-cols-2 md:items-start">
              <LastDays days={recent} selected={day?.key ?? null} onSelect={setPick} />
              <WeakestRule weak={weak} window={sum.window} judged={sum.rates.some((r) => r.rate != null)} />
            </div>
          </div>
          <div className="grid min-w-0 content-start gap-1.5">
            <span className={SUB}>Regeln · Tag und {sum.window} Tage</span>
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
        </div>
      )}
    </InsightCard>
  );
}
