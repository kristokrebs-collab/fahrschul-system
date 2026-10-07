import { AnimatePresence, motion, useMotionValue, type Variants } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import {
  addMonths,
  calendarMonth,
  compact,
  explainCalendar,
  initialMonth,
  monthRange,
  monthTitle,
  TITLES,
  UNIT_LABELS,
  unitValue,
  WEEKDAY_SHORT,
  ymIndex,
  ymKey,
  ymOf,
  type CalendarMonth,
  type CalendarUnit,
  type DayCell,
  type YearMonth,
} from "@/domain/insights";
import { cn } from "@/lib/cn";
import { isoWeek } from "@/lib/dates";
import { pct, pct0, signed } from "@/lib/format";
import { useTouchMoveGuard } from "@/motion/a11y";
import { flickDecision, rubberBand, useAxisDrag } from "@/motion/physics";
import { spring, tween } from "@/motion/tokens";
import { usePressable } from "@/motion/usePressable";
import { useReducedFx } from "@/motion/useReducedFx";
import { AutoHeight } from "@/views/trades/AutoHeight";
import { MotionNumber } from "@/motion/MotionNumber";
import { Segmented } from "@/primitives/Segmented";
import { useJournal } from "@/store/journalStore";
import { DayPanel } from "./DayPanel";
import { useInsightsUi } from "./insightsStore";
import { InsightCard, SEG_TOUCH, Stat, useInsightsBase } from "./ui";

const UNIT_OPTIONS = (["money", "r", "pct"] as const).map((v) => ({ v, label: UNIT_LABELS[v] }));
const WIN = "61 220 132";
const LOSS = "255 77 79";

/** Cell text in the chosen unit, never longer than 6 characters. */
export function cellText(unit: CalendarUnit, v: number | null): string {
  if (v == null) return "–";
  if (unit === "money") return compact(v);
  if (unit === "r") return Math.abs(v) >= 9.95 ? signed(v, 0) : signed(v, 1);
  const p = v * 100;
  return (Math.abs(p) >= 9.95 ? signed(p, 0) : signed(p, 1)) + "%";
}

/** Month / week total in the chosen unit, long form. */
function totalText(unit: CalendarUnit, v: number | null, currency: string): string {
  if (v == null) return "–";
  if (unit === "money") return `${signed(v, 0)} ${currency}`;
  if (unit === "r") return `${signed(v, 1)} R`;
  return pct(v);
}

/** Cell tint: 8 % … 38 % of the P&L colour by the day's size relative to the month (p90). */
function tint(c: DayCell): string | undefined {
  if (!c.g) return undefined;
  if (c.g.net === 0) return "rgb(255 255 255 / 0.06)";
  return `rgb(${c.g.net > 0 ? WIN : LOSS} / ${(0.08 + 0.3 * c.intensity).toFixed(3)})`;
}

const cellLabel = (c: DayCell, unit: CalendarUnit, capital: number, currency: string): string => {
  const head = `${c.day}.`;
  if (!c.g) return `${head} keine Trades${c.hasNote ? ", Notiz vorhanden" : ""}`;
  return `${head} ${totalText(unit, unitValue(c.g, c.rSum, unit, capital), currency)}, ${c.g.n} ${c.g.n === 1 ? "Trade" : "Trades"}${c.hasNote ? ", Notiz vorhanden" : ""}`;
};

const MONTH_VARIANTS: Variants = {
  enter: (dir: number) => ({ opacity: 0, x: dir * 40 }),
  center: { opacity: 1, x: 0 },
  exit: (dir: number) => ({ opacity: 0, x: dir * -30 }),
};
const MONTH_VARIANTS_REDUCED: Variants = { enter: { opacity: 0 }, center: { opacity: 1 }, exit: { opacity: 0 } };

interface GridProps {
  month: CalendarMonth;
  unit: CalendarUnit;
  capital: number;
  currency: string;
  dir: number;
  /** cells that carry the morph id (pointer/focus armed + the one that was open) */
  armed: string | null;
  focusKey: string | null;
  canPrev: boolean;
  canNext: boolean;
  onGo: (k: number) => void;
  onOpen: (key: string) => void;
  onArm: (key: string) => void;
  onFocusKey: (key: string) => void;
}

function DayButton({ c, unit, capital, currency, armed, tabbable, onOpen, onArm }: { c: DayCell; unit: CalendarUnit; capital: number; currency: string; armed: boolean; tabbable: boolean; onOpen: (k: string) => void; onArm: (k: string) => void }) {
  const press = usePressable({ scale: 0.95 });
  if (!c.inMonth)
    return (
      <div aria-hidden="true" className="flex aspect-square min-h-0 items-start p-1 text-[10px] leading-none text-faint/50">
        {c.day}
      </div>
    );
  const v = c.g ? unitValue(c.g, c.rSum, unit, capital) : null;
  return (
    <motion.button
      type="button"
      data-day={c.key}
      tabIndex={tabbable ? 0 : -1}
      aria-label={cellLabel(c, unit, capital, currency)}
      aria-current={c.isToday ? "date" : undefined}
      onClick={() => onOpen(c.key)}
      onPointerEnter={(e) => e.pointerType === "mouse" && onArm(c.key)}
      onPointerDown={() => onArm(c.key)}
      onFocus={() => onArm(c.key)}
      whileTap={press.whileTap}
      transition={press.transition}
      className={cn(
        // children never take the pointer: the armed surface remounts on pointerdown, and a removed pointerdown
        // target would cancel the click (touch has no hover to arm it earlier)
        "group/day relative flex aspect-square min-h-0 flex-col justify-between rounded-lg p-1 text-left outline-offset-1 sm:p-1.5 [&>*]:pointer-events-none",
        c.future && !c.hasNote ? "opacity-60" : "",
      )}
    >
      {/* tinted surface = the morph source of the day view. Motion registers a shared layoutId only on mount, so the
          surface remounts (key) when the cell gets armed (hover / press / focus) */}
      <motion.span
        key={armed ? "armed" : "idle"}
        aria-hidden="true"
        layoutId={armed ? `cal-day-${c.key}` : undefined}
        className={cn("absolute inset-0 rounded-lg border transition-[border-color] duration-200", c.isToday ? "border-white/45" : "border-line", "[@media(hover:hover)]:group-hover/day:border-white/30")}
        style={{ borderRadius: 8, background: tint(c) }}
        transition={{ layout: spring.detail }}
      />
      <span className="relative flex items-start justify-between text-[10px] leading-none">
        <span className={c.isToday ? "font-semibold text-fg" : "text-faint"}>{c.day}</span>
        {c.hasNote && <span aria-hidden="true" className="mt-px size-1 rounded-full bg-mute" />}
      </span>
      {c.g && <span className={cn("num relative truncate font-mono text-[10px] leading-none sm:text-[11px]", v == null || v === 0 ? "text-mute" : v > 0 ? "text-win" : "text-loss")}>{cellText(unit, v)}</span>}
    </motion.button>
  );
}

function MonthGrid({ month, unit, capital, currency, dir, armed, focusKey, canPrev, canNext, onGo, onOpen, onArm, onFocusKey }: GridProps) {
  const reduced = useReducedFx();
  const x = useMotionValue(0);
  const width = useRef(320);
  const root = useRef<HTMLDivElement>(null);
  const drag = useAxisDrag({
    axis: "x",
    x,
    touchAction: "pan-y",
    onPress: () => {
      width.current = root.current?.offsetWidth || 320;
    },
    map: (raw) => ({ x: (raw.x > 0 && !canPrev) || (raw.x < 0 && !canNext) ? rubberBand(raw.x, width.current / 2) : raw.x }),
    onRelease: (r) => {
      const d = flickDecision({ offset: r.dx, velocity: r.vx, threshold: 0.3 * width.current, minOffset: 40 });
      if (d === 1 && canPrev) onGo(-1);
      else if (d === -1 && canNext) onGo(1);
    },
  });
  // native non-passive touchmove guard while swiping: an unconsumed fast swipe makes Chrome swallow the next tap
  const touchGuard = useTouchMoveGuard(drag.isDragging);
  const rootRef = useCallback(
    (el: HTMLDivElement | null) => {
      root.current = el;
      const off = touchGuard(el);
      return () => {
        root.current = null;
        off?.();
      };
    },
    [touchGuard],
  );

  const inMonth = month.weeks.flatMap((w) => w.cells).filter((c) => c.inMonth);
  const tabKey = focusKey && inMonth.some((c) => c.key === focusKey) ? focusKey : (inMonth.find((c) => c.isToday) ?? inMonth.find((c) => c.g) ?? inMonth[0])?.key;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : e.key === "ArrowDown" ? 7 : e.key === "ArrowUp" ? -7 : 0;
    if (e.key === "PageUp" && canPrev) {
      e.preventDefault();
      onGo(-1);
      return;
    }
    if (e.key === "PageDown" && canNext) {
      e.preventDefault();
      onGo(1);
      return;
    }
    if (!step) return;
    const cur = (e.target as HTMLElement).closest<HTMLElement>("[data-day]")?.dataset.day;
    const i = inMonth.findIndex((c) => c.key === cur);
    if (i < 0) return;
    const next = inMonth[i + step];
    e.preventDefault();
    if (!next) return;
    onFocusKey(next.key);
    root.current?.querySelector<HTMLElement>(`[data-day="${next.key}"]`)?.focus();
  };

  const cols = "grid-cols-7 @min-[420px]/cal:grid-cols-[repeat(7,minmax(0,1fr))_minmax(0,1.15fr)]";
  return (
    <div className="@container/cal">
      <div className={cn("grid gap-0.5 pb-1 @min-[420px]/cal:gap-1", cols)} aria-hidden="true">
        {WEEKDAY_SHORT.map((w) => (
          <div key={w} className="text-center text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">
            {w}
          </div>
        ))}
        <div className="hidden text-center text-[10px] font-semibold uppercase tracking-[0.1em] text-faint @min-[420px]/cal:block">Woche</div>
      </div>
      <div ref={rootRef} className="relative overflow-hidden" {...drag.handlers} style={drag.style as CSSProperties}>
        <motion.div style={{ x }}>
          <AnimatePresence mode="popLayout" initial={false} custom={dir}>
            <motion.div
              key={ymKey(month)}
              custom={dir}
              variants={reduced ? MONTH_VARIANTS_REDUCED : MONTH_VARIANTS}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ x: spring.segment, opacity: tween.fade }}
              role="group"
              aria-label={monthTitle(month)}
              onKeyDown={onKeyDown}
              className={cn("grid gap-0.5 @min-[420px]/cal:gap-1", cols)}
            >
              {month.weeks.map((w, wi) => [
                ...w.cells.map((c) => (
                  <DayButton key={c.key} c={c} unit={unit} capital={capital} currency={currency} armed={armed === c.key} tabbable={c.key === tabKey} onOpen={onOpen} onArm={onArm} />
                )),
                <div key={`w${wi}`} className="hidden min-w-0 flex-col justify-center rounded-lg border border-line bg-ink-950/40 px-1.5 text-right @min-[420px]/cal:flex">
                  {w.g.n ? (
                    <>
                      <span className={cn("num truncate font-mono text-[10.5px]", w.g.net > 0 ? "text-win" : w.g.net < 0 ? "text-loss" : "text-mute")}>{cellText(unit, unitValue(w.g, w.rSum, unit, capital))}</span>
                      <span className="text-[9.5px] text-faint">{w.days} T</span>
                    </>
                  ) : (
                    <span className="text-[10px] text-faint">–</span>
                  )}
                </div>,
              ])}
            </motion.div>
          </AnimatePresence>
        </motion.div>
      </div>
      {/* narrow cards: the week column moves below the grid */}
      <div className="mt-2 grid grid-cols-3 gap-1 @min-[420px]/cal:hidden">
        {month.weeks
          .filter((w) => w.cells.some((c) => c.inMonth))
          .map((w) => {
            const first = w.cells.find((c) => c.inMonth)!;
            return (
              <div key={first.key} className="flex min-w-0 items-baseline justify-between gap-1 rounded-lg border border-line bg-ink-950/40 px-2 py-1">
                <span className="shrink-0 text-[9.5px] text-faint">KW {isoWeek(new Date(first.key + "T12:00")).week}</span>
                <span className={cn("num truncate font-mono text-[10.5px]", w.g.net > 0 ? "text-win" : w.g.net < 0 ? "text-loss" : "text-faint")}>{w.g.n ? cellText(unit, unitValue(w.g, w.rSum, unit, capital)) : "–"}</span>
              </div>
            );
          })}
      </div>
    </div>
  );
}

/**
 * `P&L-Kalender` (Tradezella calendar + day journal): month grid (Mo–So + Woche), unit €/R/%, month by arrows,
 * keyboard (arrows, PageUp/PageDown) or swipe (velocity-carried, rubber band at the first / current month). A day
 * cell morphs into the day view (trades, day stats, intraday curve, editable day note → `tj2-days`).
 */
export function CalendarCard() {
  const { view, cur, acc } = useInsightsBase();
  const notes = useJournal((s) => s.days);
  const unit = useInsightsUi((s) => s.unit);
  const setUnit = useInsightsUi((s) => s.setUnit);
  const focus = useInsightsUi((s) => s.focus);
  const [today] = useState(() => new Date());
  const range = useMemo(() => monthRange(view.closed, today), [view.closed, today]);
  const [ym, setYm] = useState<YearMonth>(() => initialMonth(view.closed, today));
  const [dir, setDir] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [armed, setArmed] = useState<string | null>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [seenFocus, setSeenFocus] = useState(focus?.seq ?? 0);
  const [seenAcc, setSeenAcc] = useState(acc);
  const card = useRef<HTMLDivElement>(null);

  // another card asked to open a day (adjust during render; the scroll happens in the effect below)
  if (focus && focus.seq !== seenFocus) {
    setSeenFocus(focus.seq);
    const d = new Date(focus.key + "T12:00");
    setDir(0);
    setYm(ymOf(d));
    setSelected(focus.key);
    setArmed(focus.key);
  }
  // an account switch closes the day view (its trades belong to the other account)
  if (acc !== seenAcc) {
    setSeenAcc(acc);
    setSelected(null);
  }
  // only requests made while mounted scroll (the store outlives a page switch)
  const scrolledSeq = useRef(focus?.seq ?? 0);
  useEffect(() => {
    if (!focus || focus.seq === scrolledSeq.current) return;
    scrolledSeq.current = focus.seq;
    card.current?.scrollIntoView({ block: "nearest" });
  }, [focus]);

  const minIdx = ymIndex(range.min);
  const maxIdx = ymIndex(range.max);
  const shownIdx = Math.min(maxIdx, Math.max(minIdx, ymIndex(ym)));
  const month = useMemo(() => calendarMonth(view.closed, addMonths({ y: 0, m: 0 }, shownIdx), { notes, today }), [view.closed, shownIdx, notes, today]);
  const shown: YearMonth = { y: month.y, m: month.m };
  const canPrev = shownIdx > minIdx;
  const canNext = shownIdx < maxIdx;
  const go = (k: number) => {
    setDir(k);
    setYm(addMonths(shown, k));
  };
  const open = (key: string) => {
    setArmed(key);
    setSelected(key);
  };
  const close = () => {
    const key = selected;
    setSelected(null);
    if (key) {
      setFocusKey(key);
      // focus returns to the day once the grid is back
      requestAnimationFrame(() => card.current?.querySelector<HTMLElement>(`[data-day="${key}"]`)?.focus({ preventScroll: true }));
    }
  };
  const capital = view.start;
  const monthValue = unitValue(month.g, month.rSum, unit, capital);
  const isCurrent = ymIndex(shown) === ymIndex(ymOf(today));

  return (
    <div ref={card} className="h-full">
      <InsightCard
        title={TITLES.calendar}
        explain={() => explainCalendar(month, cur)}
        innerClassName="p-4 sm:p-5"
        data-testid="insights-calendar"
        action={<Segmented<CalendarUnit> size="sm" aria-label="Einheit" options={UNIT_OPTIONS} value={unit} onChange={setUnit} className={SEG_TOUCH} />}
      >
        <div className="mb-3 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2">
          <button type="button" onClick={() => go(-1)} disabled={!canPrev || !!selected} aria-label="Vorheriger Monat" className="touch-hit grid size-9 place-items-center rounded-lg border border-line-2 text-mute hover:text-fg disabled:opacity-30">
            ‹
          </button>
          <div className="grid min-w-0 justify-items-center gap-0.5 text-center">
            <button
              type="button"
              onClick={() => {
                setSelected(null);
                const now = ymOf(today);
                setDir(Math.sign(ymIndex(now) - ymIndex(shown)));
                setYm(now);
              }}
              disabled={isCurrent && !selected}
              aria-label={isCurrent ? monthTitle(shown) : `${monthTitle(shown)} – zum aktuellen Monat`}
              className="touch-hit rounded-lg px-2 text-[14px] font-semibold text-fg disabled:cursor-default"
            >
              {monthTitle(shown)}
            </button>
            <span className={cn("num font-mono text-[12.5px]", unit === "money" ? undefined : monthValue == null || monthValue === 0 ? "text-mute" : monthValue > 0 ? "text-win" : "text-loss")}>
              {unit === "money" ? <MotionNumber value={month.g.net} signed suffix={` ${cur}`} tone="auto" aria-label={`Monat ${signed(month.g.net, 0)} ${cur}`} /> : totalText(unit, monthValue, cur)}
            </span>
          </div>
          <button type="button" onClick={() => go(1)} disabled={!canNext || !!selected} aria-label="Nächster Monat" className="touch-hit grid size-9 place-items-center rounded-lg border border-line-2 text-mute hover:text-fg disabled:opacity-30">
            ›
          </button>
        </div>
        <div className="mb-3 grid grid-cols-3 gap-2">
          <Stat label="Tage" value={String(month.tradingDays)} sub={month.tradingDays ? `${month.winDays} + · ${month.lossDays} −` : "–"} />
          <Stat label="Im Plus" value={pct0(month.dayWinRate)} sub={month.tradingDays ? `${month.winDays} von ${month.tradingDays}` : "–"} />
          <Stat label="Trades" value={String(month.g.n)} sub={month.g.n ? `${pct0(month.g.winRate)} Win` : "–"} />
        </div>
        {/* the grid stays mounted under the day view (faded, inert, out of flow): its cell is the live morph source
            in both directions, and it keeps its month / focus state */}
        <AutoHeight transition={spring.detail}>
          <div className="relative">
            <motion.div
              className={cn(selected && "pointer-events-none absolute inset-x-0 top-0")}
              initial={false}
              animate={{ opacity: selected ? 0 : 1 }}
              transition={selected ? tween.exit : tween.fade}
              inert={selected ? true : undefined}
              aria-hidden={selected ? true : undefined}
            >
              <MonthGrid
                month={month}
                unit={unit}
                capital={capital}
                currency={cur}
                dir={dir}
                armed={armed}
                focusKey={focusKey}
                canPrev={canPrev}
                canNext={canNext}
                onGo={go}
                onOpen={open}
                onArm={setArmed}
                onFocusKey={setFocusKey}
              />
            </motion.div>
            <AnimatePresence mode="popLayout" initial={false}>
              {selected && (
                <DayPanel
                  key="day"
                  dayKey={selected}
                  view={view}
                  currency={cur}
                  onClose={close}
                  onNavigate={(k) => {
                    setArmed(k);
                    setSelected(k);
                    setYm(ymOf(new Date(k + "T12:00")));
                  }}
                />
              )}
            </AnimatePresence>
          </div>
        </AutoHeight>
      </InsightCard>
    </div>
  );
}
