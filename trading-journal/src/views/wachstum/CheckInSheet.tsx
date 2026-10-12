/**
 * Daily check-in (P08) as a sheet: the mood as five dot-matrix glyphs (the big glyph cross-fades through the phosphor
 * when the mood changes – no emojis), stress / energy / sleep on elastic sliders (the thumb stretches with its speed),
 * the words of the moment as chips (+ an own word), today's habits. Writes the day journal (`saveDay`: `mood` +
 * `checkin`), never blocks; "Leeren" removes the check-in again. Opened from the page header, the Heute card or
 * `useGrowthUi.getState().openCheckin(day)`.
 */
import { motion } from "motion/react";
import { useMemo, useState, type KeyboardEvent } from "react";
import { activeHabits, growthOf } from "@/domain/growth";
import { CHECKIN_EMOTIONS, checkinOf, cleanEmotions, emotionTone, ENERGY_LABELS, MOOD_LABELS, moodOf, STRESS_LABELS, EMPTY_CHECKIN, type CheckIn, type Level5 } from "@/domain/psych";
import { cn } from "@/lib/cn";
import { Sheet } from "@/motion/Sheet";
import { StaggerItem } from "@/motion/Stagger";
import { spring } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Button } from "@/primitives/Button";
import { Input } from "@/primitives/Input";
import { Switch } from "@/motion/Switch";
import { useJournal } from "@/store/journalStore";
import { pushToast } from "@/store/uiStore";
import { saveCheckin } from "./actions";
import { useGrowthUi, useSheetOwner } from "./growthStore";
import { WACHSTUM } from "./strings";
import { ElasticSlider, MoodGlyph } from "./ui";
import { habitDone } from "@/domain/growth/habits";

const C = WACHSTUM.checkin;
const sleepText = (h: number) => `${String(h).replace(".", ",")} h`;

function Chip({ on, onClick, children, tone }: { on: boolean; onClick: () => void; children: string; tone: "pos" | "neutral" | "neg" }) {
  const reduced = useReducedFx();
  return (
    <motion.button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      whileTap={reduced ? undefined : { scale: 0.92 }}
      transition={spring.press}
      className={cn(
        "rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors duration-200 pointer-coarse:min-h-11",
        on ? (tone === "neg" ? "border-signal/60 bg-signal/15 text-fg" : tone === "pos" ? "border-win/50 bg-win/10 text-fg" : "border-white/50 bg-white/[0.1] text-fg") : "border-line-2 text-mute hover:border-white/40 hover:text-fg",
      )}
    >
      {children}
    </motion.button>
  );
}

export function CheckInSheet() {
  const owner = useSheetOwner("checkin");
  const open = useGrowthUi((s) => s.checkinOpen);
  const day = useGrowthUi((s) => s.checkinDay);
  const close = useGrowthUi((s) => s.closeCheckin);
  const days = useJournal((s) => s.days);
  const settings = useJournal((s) => s.settings);
  const note = day ? days[day] : undefined;
  const habits = useMemo(() => activeHabits(growthOf(settings)), [settings]);
  const [c, setC] = useState<CheckIn>(EMPTY_CHECKIN);
  const [mood, setMood] = useState<Level5 | null>(null);
  const [own, setOwn] = useState("");
  const [busy, setBusy] = useState(false);
  const reduced = useReducedFx();

  // (re)initialise from the stored entry each time the sheet opens (state adjusted during render – React's pattern for
  // "reset when a prop changes"; a sync while the sheet is open never resets the form)
  const [session, setSession] = useState<string | null>(null);
  const sessionKey = open ? `open:${day}` : null;
  if (sessionKey !== session) {
    setSession(sessionKey);
    if (sessionKey) {
      const stored = checkinOf(note);
      setC(stored ? { ...stored, emotions: [...stored.emotions], habits: { ...stored.habits } } : { ...EMPTY_CHECKIN, emotions: [], habits: {} });
      setMood(moodOf(note));
      setOwn("");
    }
  }

  const toggleWord = (w: string) => setC((x) => ({ ...x, emotions: x.emotions.includes(w) ? x.emotions.filter((e) => e !== w) : cleanEmotions([...x.emotions, w]) }));
  const addOwn = () => {
    const w = own.trim();
    if (!w) return;
    setC((x) => ({ ...x, emotions: cleanEmotions([...x.emotions, w]) }));
    setOwn("");
  };
  const onOwnKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addOwn();
    }
  };
  const ownWords = c.emotions.filter((w) => !CHECKIN_EMOTIONS.some((e) => e.word === w));

  const save = async (clear = false) => {
    if (!day || busy) return;
    setBusy(true);
    const ok = await saveCheckin(day, clear ? { ...EMPTY_CHECKIN, emotions: [], habits: {} } : c, clear ? null : mood);
    setBusy(false);
    if (!ok) return;
    pushToast({ kind: "success", title: clear ? C.cleared : C.saved });
    close();
  };

  if (!owner) return null;
  return (
    <Sheet
      open={open}
      onClose={close}
      title={C.sheet}
      dismissGuard={false}
      footer={
        <>
          {(checkinOf(note) || moodOf(note) != null) && (
            <Button variant="ghost" onClick={() => void save(true)} disabled={busy} data-testid="checkin-clear">
              {C.clear}
            </Button>
          )}
          <span className="flex-1" />
          <Button variant="primary" onClick={() => void save()} disabled={busy} data-testid="checkin-save">
            {C.save}
          </Button>
        </>
      }
    >
      <div className="grid gap-6" data-testid="checkin-sheet">
        <StaggerItem as="section" aria-label={C.mood}>
          <div className="flex items-center gap-5">
            <div className="grid size-[92px] shrink-0 place-items-center rounded-2xl border border-line bg-ink-950/60" data-testid="checkin-mood-glyph" data-mood={mood ?? ""}>
              <MoodGlyph mood={mood} size={8} label={mood ? `Stimmung: ${MOOD_LABELS[mood - 1]}` : "Stimmung nicht gesetzt"} />
            </div>
            <div className="grid min-w-0 flex-1 gap-2">
              <span className="text-[12.5px] font-medium">{C.mood}</span>
              <div role="radiogroup" aria-label={C.mood} className="grid grid-cols-5 gap-1.5">
                {MOOD_LABELS.map((l, i) => {
                  const v = (i + 1) as Level5;
                  const on = mood === v;
                  return (
                    <motion.button
                      key={l}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      aria-label={l}
                      title={l}
                      onClick={() => setMood(on ? null : v)}
                      whileTap={reduced ? undefined : { scale: 0.9 }}
                      transition={spring.press}
                      className={cn("grid min-h-11 place-items-center rounded-xl border transition-colors", on ? "border-white/60 bg-white/[0.08]" : "border-line hover:border-white/30")}
                    >
                      <MoodGlyph mood={v} size={3} />
                    </motion.button>
                  );
                })}
              </div>
              <span className="text-[11.5px] text-mute" aria-hidden="true">
                {mood ? MOOD_LABELS[mood - 1] : "Wie geht es dir gerade?"}
              </span>
            </div>
          </div>
        </StaggerItem>

        <StaggerItem as="section" className="grid gap-5 sm:grid-cols-2" aria-label="Zustand">
          <ElasticSlider id="ci-stress" data-testid="ci-stress" label={C.stress} min={1} max={5} step={1} value={c.stress} onChange={(v) => setC((x) => ({ ...x, stress: v as Level5 }))} format={(v) => STRESS_LABELS[v - 1] ?? ""} tone={c.stress != null && c.stress >= 4 ? "loss" : "fg"} ends={["entspannt", "unter Strom"]} />
          <ElasticSlider id="ci-energy" data-testid="ci-energy" label={C.energy} min={1} max={5} step={1} value={c.energy} onChange={(v) => setC((x) => ({ ...x, energy: v as Level5 }))} format={(v) => ENERGY_LABELS[v - 1] ?? ""} tone="win" ends={["leer", "voller Energie"]} />
          <div className="sm:col-span-2">
            <ElasticSlider id="ci-sleep" data-testid="ci-sleep" label={C.sleep} min={0} max={12} step={0.5} value={c.sleep} onChange={(v) => setC((x) => ({ ...x, sleep: v }))} format={sleepText} tone={c.sleep != null && c.sleep < 6 ? "warn" : "fg"} ends={["0 h", "12 h"]} />
          </div>
        </StaggerItem>

        <StaggerItem as="section" className="grid gap-2.5" aria-label={C.emotions}>
          <span className="text-[12.5px] font-medium">{C.emotions}</span>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label={C.emotions} data-testid="checkin-emotions">
            {[...CHECKIN_EMOTIONS.map((e) => e.word), ...ownWords].map((w) => (
              <Chip key={w} on={c.emotions.includes(w)} onClick={() => toggleWord(w)} tone={emotionTone(w)}>
                {w}
              </Chip>
            ))}
          </div>
          <div className="flex gap-2">
            <Input value={own} onChange={(e) => setOwn(e.target.value)} onKeyDown={onOwnKey} placeholder={C.ownWord} maxLength={24} aria-label={C.ownWord} className="flex-1" />
            <Button onClick={addOwn} disabled={!own.trim()}>
              +
            </Button>
          </div>
        </StaggerItem>

        {habits.length > 0 && day && (
          <StaggerItem as="section" className="grid gap-2" aria-label={C.habits}>
            <span className="text-[12.5px] font-medium">{C.habits}</span>
            <ul className="grid gap-1">
              {habits.map((h) => (
                <li key={h.id} className="flex min-h-11 items-center justify-between gap-3 rounded-xl border border-line px-3 py-2">
                  <span className="min-w-0 truncate text-[13px]">{h.title}</span>
                  {h.auto ? (
                    <span className={cn("text-[11px]", habitDone(h, day, days) ? "text-win" : "text-faint")}>{habitDone(h, day, days) ? "erledigt" : WACHSTUM.habits.auto}</span>
                  ) : (
                    <Switch aria-label={h.title} checked={c.habits[h.id] === true} onCheckedChange={(on) => setC((x) => ({ ...x, habits: { ...x.habits, [h.id]: on } }))} tone="win" size="sm" />
                  )}
                </li>
              ))}
            </ul>
          </StaggerItem>
        )}
      </div>
    </Sheet>
  );
}
