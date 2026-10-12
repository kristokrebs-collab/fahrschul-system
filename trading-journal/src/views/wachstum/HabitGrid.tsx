/**
 * Habit grid (P08): one row per habit over the last weeks (5 on wide screens, 3 on phones), the cells cascading in
 * from TODAY outward (`HeatGridReveal`, origin = today, one signal ring). Manual habits are ticked for today right
 * here (or in the check-in), automatic ones count themselves from the day journal (check-in, plan, review). The 30-day
 * rate and the streak per habit; adding one (suggestions + own words) and hiding one.
 */
import { motion } from "motion/react";
import { useState, type KeyboardEvent } from "react";
import { AUTO_HABITS, HABIT_SUGGESTIONS, type HabitRow } from "@/domain/growth";
import { cn } from "@/lib/cn";
import { HeatGridReveal } from "@/motion/fx";
import { RollingDigits } from "@/motion/RollingDigits";
import { spring } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Button } from "@/primitives/Button";
import { Card } from "@/primitives/Card";
import { Collapse } from "@/primitives/Expander";
import { Input } from "@/primitives/Input";
import { addHabit, archiveHabit, setHabitDone } from "./actions";
import { WACHSTUM } from "./strings";

const H = WACHSTUM.habits;

function Row({ row, columns, todayKey }: { row: HabitRow; columns: readonly string[]; todayKey: string }) {
  const reduced = useReducedFx();
  const h = row.habit;
  const todayIdx = columns.indexOf(todayKey);
  const [busy, setBusy] = useState(false);
  const toggle = async () => {
    if (h.auto || busy) return;
    setBusy(true);
    await setHabitDone(todayKey, h.id, !row.doneToday);
    setBusy(false);
  };
  return (
    <li className="grid gap-2 border-t border-line pt-3 first:border-t-0 first:pt-0" data-testid="habit-row" data-habit={h.id} data-done={row.doneToday ? "1" : "0"}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[13px] font-medium">{h.title}</span>
          {h.auto && <span className="rounded-full border border-line-2 px-1.5 py-px text-[9.5px] uppercase tracking-wider text-faint">{H.auto}</span>}
        </div>
        <div className="flex items-center gap-3 text-[11px] text-mute">
          <span className="num">{Math.round(row.rate * 100)} % · {H.rate}</span>
          <span className="flex items-baseline gap-1" title={`Bestwert ${row.best} Tage`}>
            <RollingDigits value={row.streak} className="num font-mono text-[13px] font-semibold text-fg" aria-label={`Serie ${row.streak} Tage`} />
            <span>{row.streak === 1 ? "Tag" : "Tage"} in Folge</span>
          </span>
          {!h.auto && (
            <motion.button
              type="button"
              role="checkbox"
              aria-checked={row.doneToday}
              aria-label={`${h.title}: ${H.today}`}
              onClick={() => void toggle()}
              whileTap={reduced ? undefined : { scale: 0.88 }}
              transition={spring.press}
              className={cn("grid size-8 place-items-center rounded-lg border transition-colors pointer-coarse:size-11", row.doneToday ? "border-win/60 bg-win/20 text-win" : "border-line-2 text-faint hover:border-white/40")}
              data-testid="habit-today"
            >
              <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden="true">
                <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity={row.doneToday ? 1 : 0.35} />
              </svg>
            </motion.button>
          )}
        </div>
      </div>
      <HeatGridReveal cols={columns.length} origin={todayIdx < 0 ? columns.length - 1 : todayIdx} className="gap-[3px]" cellClassName="rounded-[3px]" aria-label={`${h.title}: ${row.cells.filter((c) => c.done).length} von ${row.cells.filter((c) => !c.future).length} Tagen`} role="img">
        {row.cells.map((c) => (
          <span key={c.key} title={c.key} data-cell={c.done ? "done" : c.future ? "future" : "open"} className={cn("block aspect-square rounded-[3px]", c.done ? "bg-win/85" : c.future ? "bg-white/[0.025]" : "bg-white/[0.08]", c.today && !c.done && "outline outline-1 -outline-offset-1 outline-white/40")} />
        ))}
      </HeatGridReveal>
      <div className="flex justify-end">
        <button type="button" className="min-h-8 rounded px-1 text-[10.5px] text-faint hover:text-fg pointer-coarse:min-h-11" onClick={() => void archiveHabit(h.id)}>
          {H.archive}
        </button>
      </div>
    </li>
  );
}

export function HabitGrid({ rows, columns, todayKey, existing, className }: { rows: readonly HabitRow[]; columns: readonly string[]; todayKey: string; existing: readonly string[]; className?: string }) {
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");
  // one label per week: the Monday's date ("ab 05.10.")
  const weeks = columns.filter((_, i) => i % 7 === 0).map((k) => `${k.slice(8, 10)}.${k.slice(5, 7)}.`);
  const add = async (title: string, auto?: (typeof AUTO_HABITS)[number]) => {
    const ok = await addHabit(auto?.title ?? title, auto?.auto, auto?.id);
    if (ok) {
      setText("");
      setAdding(false);
    }
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && text.trim()) {
      e.preventDefault();
      void add(text);
    }
  };
  const freeAuto = AUTO_HABITS.filter((a) => !existing.includes(a.id));
  return (
    <Card
      title={H.title}
      note={`Die letzten ${columns.length / 7} Wochen · Mo – So`}
      action={
        <Button size="sm" onClick={() => setAdding((a) => !a)} aria-expanded={adding} data-testid="habit-add">
          {H.add}
        </Button>
      }
      className={className}
      data-testid="growth-habits"
      data-n={rows.length}
    >
      <Collapse open={adding}>
        <div className="grid gap-2 pb-4">
          <div className="flex gap-2">
            <Input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} placeholder={H.placeholder} maxLength={60} aria-label={H.add} className="flex-1" data-testid="habit-input" />
            <Button variant="primary" onClick={() => void add(text)} disabled={!text.trim()} data-testid="habit-save">
              +
            </Button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {freeAuto.map((a) => (
              <button key={a.id} type="button" onClick={() => void add(a.title, a)} className="rounded-full border border-line-2 px-2.5 py-1 text-[11.5px] text-mute hover:border-white/40 hover:text-fg pointer-coarse:min-h-11" data-testid="habit-suggest-auto">
                {a.title} · {H.auto}
              </button>
            ))}
            {HABIT_SUGGESTIONS.filter((s) => !rows.some((r) => r.habit.title === s)).map((s) => (
              <button key={s} type="button" onClick={() => void add(s)} className="rounded-full border border-line px-2.5 py-1 text-[11.5px] text-mute hover:border-white/40 hover:text-fg pointer-coarse:min-h-11">
                {s}
              </button>
            ))}
          </div>
        </div>
      </Collapse>
      {rows.length === 0 ? (
        <p className="text-[12.5px] leading-relaxed text-mute">{H.empty}</p>
      ) : (
        <div className="grid gap-2">
          <div className="grid gap-[3px] text-[9.5px] text-faint" style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }} aria-hidden="true">
            {weeks.map((w) => (
              <span key={w} className="truncate border-l border-line-2 pl-1" style={{ gridColumn: "span 7" }}>
                {w}
              </span>
            ))}
          </div>
          <ul className="grid gap-3">
            {rows.map((r) => (
              <Row key={r.habit.id} row={r} columns={columns} todayKey={todayKey} />
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
