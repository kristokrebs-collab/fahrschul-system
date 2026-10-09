import { motion } from "motion/react";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { DayMood } from "@/domain/types";
import { adjacentTradedDays, dayView } from "@/domain/insights";
import { cn } from "@/lib/cn";
import { colorClass, n2, pct0, r as fmtR } from "@/lib/format";
import { MotionNumber } from "@/motion/MotionNumber";
import { radius, spring, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Textarea } from "@/primitives/Input";
import { useDayNote, useJournal, type AccountView } from "@/store/journalStore";
import { Stat, TradeRows } from "./ui";

const fDay = new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

export const DAY_NOTE_LABEL = "Tagesnotiz";
export const DAY_NOTE_PLACEHOLDER = "Plan, Marktlage, was lief gut, was nicht …";
const MOODS: { v: DayMood; label: string }[] = [
  { v: 1, label: "Sehr schlecht" },
  { v: 2, label: "Schlecht" },
  { v: 3, label: "Neutral" },
  { v: 4, label: "Gut" },
  { v: 5, label: "Sehr gut" },
];
/** Typing pause after which the note saves itself. */
const AUTOSAVE_MS = 700;

type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";
const SAVE_TEXT: Record<SaveState, string> = { idle: "", dirty: "Ungespeichert …", saving: "Speichert …", saved: "Gespeichert", error: "Nicht gespeichert – erneut versuchen" };

/**
 * The day's journal entry (`tj2-days` via `saveDay`). Never discards input: it saves itself after a typing pause, on
 * blur and when the day view closes (unmount flush); only `note` / `mood` are written, every other stored field of
 * the day survives (`saveDay` merges). Another tab's change is adopted while nothing is being typed.
 */
function DayNoteEditor({ dayKey }: { dayKey: string }) {
  const stored = useDayNote(dayKey);
  const saveDay = useJournal((s) => s.saveDay);
  const id = useId();
  const [draft, setDraft] = useState({ note: stored?.note ?? "", mood: stored?.mood ?? null });
  const [state, setState] = useState<SaveState>("idle");
  const [seen, setSeen] = useState(stored);
  // adopt external changes (other tab, import) while the user is not typing – adjust during render, no effect
  if (seen !== stored) {
    setSeen(stored);
    if (state !== "dirty" && state !== "saving") setDraft({ note: stored?.note ?? "", mood: stored?.mood ?? null });
  }
  const pending = useRef<{ note: string; mood: DayMood | null } | null>(null);

  const flush = useCallback(async () => {
    const next = pending.current;
    if (!next) return;
    pending.current = null;
    setState("saving");
    try {
      await saveDay(dayKey, { note: next.note, mood: next.mood });
      if (!pending.current) setState("saved");
    } catch {
      pending.current = pending.current ?? next;
      setState("error");
    }
  }, [saveDay, dayKey]);

  const change = (patch: Partial<typeof draft>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    pending.current = next;
    setState("dirty");
  };

  useEffect(() => {
    if (state !== "dirty") return;
    const t = setTimeout(() => void flush(), AUTOSAVE_MS);
    return () => clearTimeout(t);
  }, [state, draft, flush]);

  // closing the day view (or switching the day) saves what was typed
  useEffect(() => () => void flush(), [flush]);

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label htmlFor={id} className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-mute">
          {DAY_NOTE_LABEL}
        </label>
        <div role="radiogroup" aria-label="Stimmung des Tages" className="flex items-center gap-1">
          <span aria-hidden="true" className="mr-1 text-[11px] text-faint">
            Stimmung
          </span>
          {MOODS.map((m) => {
            const on = draft.mood === m.v;
            return (
              <button
                key={m.v}
                type="button"
                role="radio"
                aria-checked={on}
                aria-label={m.label}
                title={m.label}
                onClick={() => {
                  change({ mood: on ? null : m.v });
                }}
                className="touch-hit grid size-7 place-items-center rounded-full"
              >
                <span className={cn("block rounded-full transition-[background-color,transform] duration-200", on ? "size-3 bg-fg" : "size-2 bg-line-2 hover:bg-mute")} style={{ transform: `scale(${0.7 + m.v * 0.08})` }} />
              </button>
            );
          })}
        </div>
      </div>
      <Textarea
        id={id}
        value={draft.note}
        rows={3}
        placeholder={DAY_NOTE_PLACEHOLDER}
        onChange={(e) => change({ note: e.target.value })}
        onBlur={() => void flush()}
        className="min-h-[84px] resize-y text-[13px]"
      />
      <span aria-live="off" className={cn("min-h-4 text-[11px]", state === "error" ? "text-loss" : "text-faint")}>
        {state === "error" ? (
          <button type="button" className="underline underline-offset-2" onClick={() => void flush()}>
            {SAVE_TEXT.error}
          </button>
        ) : (
          SAVE_TEXT[state]
        )}
      </span>
    </div>
  );
}

/** Intraday cumulative P&L (one point per closed trade), drawn in once. */
function DayCurve({ curve }: { curve: number[] }) {
  const reduced = useReducedFx();
  const W = 240;
  const H = 44;
  const min = Math.min(0, ...curve);
  const max = Math.max(0, ...curve);
  const span = max - min || 1;
  const pts = curve.map((v, i) => [(i / Math.max(1, curve.length - 1)) * W, H - 3 - ((v - min) / span) * (H - 6)] as const);
  const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("");
  const zero = H - 3 - ((0 - min) / span) * (H - 6);
  const last = curve[curve.length - 1] ?? 0;
  return (
    <motion.div initial={reduced ? false : { clipPath: "inset(0 100% 0 0)" }} animate={{ clipPath: "inset(0 0% 0 0)" }} transition={tween.draw} aria-hidden="true">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block h-11 w-full overflow-visible">
        <line x1="0" x2={W} y1={zero} y2={zero} stroke="#2c2c2c" strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
        <path d={d} fill="none" stroke={last >= 0 ? "#3ddc84" : "#ff4d4f"} strokeWidth="1.6" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      </svg>
    </motion.div>
  );
}

export interface DayPanelProps {
  dayKey: string;
  view: AccountView;
  currency: string;
  onClose: () => void;
  onNavigate: (key: string) => void;
}

/**
 * Day view inside the calendar card: the tinted day cell morphs into this panel's surface (shared
 * `layoutId="cal-day-{key}"`), the content fades in a beat later. Day stats, intraday curve, the trades (→ trade
 * detail), open trades of the day, and the editable day note. Escape or "Monat" goes back.
 */
export function DayPanel({ dayKey, view, currency, onClose, onNavigate }: DayPanelProps) {
  const reduced = useReducedFx();
  const d = useMemo(() => dayView(view.list, dayKey), [view.list, dayKey]);
  const adj = useMemo(() => adjacentTradedDays(view.closed, dayKey), [view.closed, dayKey]);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, [dayKey]);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
    }
  };
  const g = d.g;
  return (
    <div className="relative" onKeyDown={onKeyDown} data-testid="calendar-day">
      <motion.div
        aria-hidden="true"
        layoutId={`cal-day-${dayKey}`}
        className="absolute inset-0 rounded-2xl border border-line-2 bg-ink-950/60"
        style={{ borderRadius: radius.card }}
        transition={{ layout: spring.detail }}
      />
      <motion.div
        className="relative grid gap-4 p-3.5 sm:p-4"
        initial={reduced ? { opacity: 0 } : { opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0, transition: { ...tween.reveal, delay: reduced ? 0 : 0.12 } }}
        exit={{ opacity: 0, transition: tween.exit }}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button type="button" onClick={onClose} aria-label="Zurück zum Monat" className="touch-hit -ml-1 inline-flex min-h-8 items-center gap-1 rounded-lg px-1.5 text-[12.5px] font-medium text-mute hover:text-fg">
            <span aria-hidden="true">‹</span> Monat
          </button>
          <div className="flex items-center gap-1">
            <button type="button" disabled={!adj.prev} onClick={() => adj.prev && onNavigate(adj.prev)} aria-label="Vorheriger Handelstag" className="touch-hit grid size-8 place-items-center rounded-lg border border-line-2 text-mute hover:text-fg disabled:opacity-30">
              ‹
            </button>
            <button type="button" disabled={!adj.next} onClick={() => adj.next && onNavigate(adj.next)} aria-label="Nächster Handelstag" className="touch-hit grid size-8 place-items-center rounded-lg border border-line-2 text-mute hover:text-fg disabled:opacity-30">
              ›
            </button>
          </div>
        </div>
        <h3 ref={heading} tabIndex={-1} className="text-[15px] font-semibold text-fg outline-none">
          {fDay.format(d.date)}
        </h3>
        {g.n > 0 ? (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="Netto" value={<MotionNumber value={g.net} signed suffix={` ${currency}`} tone="auto" />} />
              <Stat label="Trades" value={`${g.n}`} sub={`${g.wins} G · ${g.losses} V${g.be ? ` · ${g.be} BE` : ""}`} />
              <Stat label="Win-Rate" value={pct0(g.winRate)} sub={`PF ${g.pf === Infinity ? "∞" : n2(g.pf)}`} />
              <Stat label="Σ R" value={d.rSum == null ? "–" : fmtR(d.rSum)} tone={colorClass(d.rSum)} sub={`Gebühren ${n2(g.fees)}`} />
            </div>
            {d.curve.length > 2 && (
              <div className="grid gap-1">
                <span className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-mute">Verlauf des Tages</span>
                <DayCurve curve={d.curve} />
              </div>
            )}
            <TradeRows trades={d.trades} group="cal-day" timeOnly extra={(t) => `${t.account === "makro" ? "Makro" : "Scalp"}${t.r != null ? ` · ${fmtR(t.r)}` : ""}`} />
          </>
        ) : (
          <p className="text-[13px] text-mute">Keine abgeschlossenen Trades an diesem Tag. Die Notiz kannst du trotzdem schreiben – zum Beispiel deinen Plan.</p>
        )}
        {d.open.length > 0 && (
          <div className="grid gap-1">
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-mute">Offen ({d.open.length})</span>
            <TradeRows trades={d.open} group="cal-open" timeOnly />
          </div>
        )}
        <DayNoteEditor key={dayKey} dayKey={dayKey} />
      </motion.div>
    </div>
  );
}
