/**
 * Daily check-in (P08, F61) as a sheet: the mood as five dot-matrix glyphs (the big glyph cross-fades through the phosphor
 * when the mood changes – no emojis), stress / energy / sleep (+ Konzentration, Schlafqualität, Tagesrisiko and the
 * trader's own questions) on elastic sliders, verfügbare Zeit and geplante Session as chips, a free comment, the words of the
 * moment (+ an own word) and today's habits. Which fields appear is the trader's choice (`settings.checkin`, "Felder und
 * Erinnerung anpassen" at the bottom). Writes the day journal (`saveCheckin`: `mood` + `checkin`); every value starts unset.
 *
 * Two ways in:
 *  - from the Wachstum page / `useGrowthUi.getState().openCheckin(day)`: "Speichern" / "Leeren" as before;
 *  - the DAILY prompt (`DailyCheckinHost`, `openCheckin(day, true)`): "Später" (per device, until the reminder time),
 *    "Heute überspringen" and "Erledigt" – the outcome is written to the synced day entry, so no other device asks again.
 * A check-in for a day before today is marked "nachgetragen"; it never counts as known when the day's trades began.
 */
import { chipClass } from "@/primitives/chip";
import { motion } from "motion/react";
import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { checkinConfigOf, dayKeyIn, deviceTimeZone, effectiveTimeZone } from "@/domain/checkin";
import { activeHabits, growthOf } from "@/domain/growth";
import { CHECKIN_EMOTIONS, checkinOf, checkinRawOf, checkinStatusOf, cleanEmotions, emotionTone, ENERGY_LABELS, MOOD_LABELS, moodOf, STRESS_LABELS, EMPTY_CHECKIN, type CheckIn, type Level5 } from "@/domain/psych";
import { cn } from "@/lib/cn";
import { textLink } from "@/lib/textLink";
import { Sheet } from "@/motion/Sheet";
import { StaggerItem } from "@/motion/Stagger";
import { spring } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Button } from "@/primitives/Button";
import { Input } from "@/primitives/Input";
import { Switch } from "@/motion/Switch";
import { useJournal } from "@/store/journalStore";
import { pushToast } from "@/store/uiStore";
import { saveCheckin, skipCheckin } from "./actions";
import { CheckInFields } from "./CheckInFields";
import { CheckInSettings } from "./CheckInSettings";
import { DAILY } from "./checkinStrings";
import { checkinNow, snoozeCheckin } from "./dailyCheckin";
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
      className={chipClass(on, { tone: tone === "neg" ? "loss" : tone === "pos" ? "win" : "neutral" })}
    >
      {children}
    </motion.button>
  );
}

const fDay = new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "numeric", month: "long" });
const dayText = (key: string): string => fDay.format(new Date(`${key}T12:00:00`));

export function CheckInSheet() {
  const owner = useSheetOwner("checkin");
  const open = useGrowthUi((s) => s.checkinOpen);
  const day = useGrowthUi((s) => s.checkinDay);
  const daily = useGrowthUi((s) => s.checkinDaily);
  const close = useGrowthUi((s) => s.closeCheckin);
  const days = useJournal((s) => s.days);
  const settings = useJournal((s) => s.settings);
  const note = day ? days[day] : undefined;
  const habits = useMemo(() => activeHabits(growthOf(settings)), [settings]);
  const config = useMemo(() => checkinConfigOf(settings), [settings]);
  const [c, setC] = useState<CheckIn>(EMPTY_CHECKIN);
  const [mood, setMood] = useState<Level5 | null>(null);
  const [own, setOwn] = useState("");
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [custom, setCustom] = useState(false);
  const reduced = useReducedFx();

  // (re)initialise from the stored entry each time the sheet opens (state adjusted during render – React's pattern for
  // "reset when a prop changes"; a sync while the sheet is open never resets the form)
  const [session, setSession] = useState<string | null>(null);
  const sessionKey = open ? `open:${day}:${daily}` : null;
  if (sessionKey !== session) {
    setSession(sessionKey);
    if (sessionKey) {
      const stored = checkinOf(note);
      setC(stored ? { ...stored, emotions: [...stored.emotions], habits: { ...stored.habits } } : { ...EMPTY_CHECKIN, emotions: [], habits: {} });
      setMood(moodOf(note));
      setOwn("");
      setDirty(false);
      setCustom(false);
    }
  }

  const patch = (p: Partial<CheckIn>) => {
    setDirty(true);
    setC((x) => ({ ...x, ...p }));
  };
  const toggleWord = (w: string) => patch({ emotions: c.emotions.includes(w) ? c.emotions.filter((e) => e !== w) : cleanEmotions([...c.emotions, w]) });
  const addOwn = () => {
    const w = own.trim();
    if (!w) return;
    patch({ emotions: cleanEmotions([...c.emotions, w]) });
    setOwn("");
  };
  const onOwnKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addOwn();
    }
  };
  const ownWords = c.emotions.filter((w) => !CHECKIN_EMOTIONS.some((e) => e.word === w));

  const tz = effectiveTimeZone(config, deviceTimeZone());
  const todayKey = dayKeyIn(checkinNow(), tz);
  const isLate = !!day && (day < todayKey || checkinRawOf(note)?.late === true);

  const save = async (clear = false) => {
    if (!day || busy) return;
    setBusy(true);
    const ok = await saveCheckin(day, c, mood, { clear, now: checkinNow() });
    setBusy(false);
    if (!ok) return;
    pushToast({ kind: "success", title: clear ? C.cleared : daily ? DAILY.doneToast : C.saved });
    close();
  };
  const later = () => {
    snoozeCheckin(checkinNow());
    close();
  };
  const skip = async () => {
    if (!day || busy) return;
    setBusy(true);
    const ok = await skipCheckin(day, checkinNow());
    setBusy(false);
    if (!ok) return;
    pushToast({ kind: "info", title: DAILY.skippedToast });
    close();
  };

  // another device answered or skipped this day meanwhile (the sync landed while the prompt is open) and nothing has been
  // typed here: the prompt closes quietly instead of asking for what is already there
  const stored = day ? checkinStatusOf(note) : null;
  useEffect(() => {
    if (open && daily && !dirty && !busy && stored != null) close();
  }, [open, daily, dirty, busy, stored, close]);

  if (!owner) return null;
  return (
    <Sheet
      open={open}
      onClose={daily ? later : close}
      title={daily && day ? `${DAILY.titleSheet} · ${dayText(day)}` : C.sheet}
      dismissGuard={false}
      footer={
        daily ? (
          <>
            <Button variant="secondary" onClick={later} disabled={busy} data-testid="checkin-later">
              {DAILY.later}
            </Button>
            <Button variant="secondary" onClick={() => void skip()} disabled={busy} data-testid="checkin-skip">
              {DAILY.skip}
            </Button>
            <span className="flex-1" />
            <Button variant="primary" onClick={() => void save()} disabled={busy} data-testid="checkin-done">
              {DAILY.done}
            </Button>
          </>
        ) : (
          <>
            {(checkinOf(note) || moodOf(note) != null) && (
              <Button variant="secondary" onClick={() => void save(true)} disabled={busy} data-testid="checkin-clear">
                {C.clear}
              </Button>
            )}
            <span className="flex-1" />
            <Button variant="primary" onClick={() => void save()} disabled={busy} data-testid="checkin-save">
              {C.save}
            </Button>
          </>
        )
      }
    >
      <div className="grid gap-6" data-testid="checkin-sheet" data-daily={daily ? "1" : "0"} data-late={isLate ? "1" : "0"}>
        {(daily || isLate) && (
          <StaggerItem className="grid gap-1.5">
            {daily && <p className="max-w-[60ch] text-[12.5px] text-mute">{DAILY.lead}</p>}
            {isLate && (
              <p className="flex flex-wrap items-center gap-2 text-[12px] text-warn" data-testid="checkin-late">
                <span className="rounded-full border border-warn/50 px-2 py-0.5 font-mono text-[10.5px] uppercase tracking-[0.1em]">{DAILY.late}</span>
                {DAILY.lateNote}
              </p>
            )}
          </StaggerItem>
        )}
        {config.fields.mood && (
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
                        onClick={() => {
                          setDirty(true);
                          setMood(on ? null : v);
                        }}
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
        )}

        {(config.fields.stress || config.fields.energy || config.fields.sleep) && (
          <StaggerItem as="section" className="grid gap-5 sm:grid-cols-2" aria-label="Zustand">
            {config.fields.stress && (
              <ElasticSlider id="ci-stress" data-testid="ci-stress" label={C.stress} min={1} max={5} step={1} value={c.stress} onChange={(v) => patch({ stress: v as Level5 })} format={(v) => STRESS_LABELS[v - 1] ?? ""} tone={c.stress != null && c.stress >= 4 ? "loss" : "fg"} ends={["entspannt", "unter Strom"]} />
            )}
            {config.fields.energy && (
              <ElasticSlider id="ci-energy" data-testid="ci-energy" label={C.energy} min={1} max={5} step={1} value={c.energy} onChange={(v) => patch({ energy: v as Level5 })} format={(v) => ENERGY_LABELS[v - 1] ?? ""} tone="win" ends={["leer", "voller Energie"]} />
            )}
            {config.fields.sleep && (
              <div className="sm:col-span-2">
                <ElasticSlider id="ci-sleep" data-testid="ci-sleep" label={C.sleep} min={0} max={12} step={0.5} value={c.sleep} onChange={(v) => patch({ sleep: v })} format={sleepText} tone={c.sleep != null && c.sleep < 6 ? "warn" : "fg"} ends={["0 h", "12 h"]} />
              </div>
            )}
          </StaggerItem>
        )}

        <CheckInFields config={config} value={c} onChange={patch} />

        {config.fields.emotions && (
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
        )}

        {config.fields.habits && habits.length > 0 && day && (
          <StaggerItem as="section" className="grid gap-2" aria-label={C.habits}>
            <span className="text-[12.5px] font-medium">{C.habits}</span>
            <ul className="grid gap-1">
              {habits.map((h) => (
                <li key={h.id} className="flex min-h-11 items-center justify-between gap-3 rounded-xl border border-line px-3 py-2">
                  <span className="min-w-0 truncate text-[13px]">{h.title}</span>
                  {h.auto ? (
                    <span className={cn("text-[11px]", habitDone(h, day, days) ? "text-win" : "text-faint")}>{habitDone(h, day, days) ? "erledigt" : WACHSTUM.habits.auto}</span>
                  ) : (
                    <Switch aria-label={h.title} checked={c.habits[h.id] === true} onCheckedChange={(on) => patch({ habits: { ...c.habits, [h.id]: on } })} tone="win" size="sm" />
                  )}
                </li>
              ))}
            </ul>
          </StaggerItem>
        )}

        <StaggerItem as="section" className="grid gap-3" aria-label={DAILY.settings.open}>
          <button
            type="button"
            aria-expanded={custom}
            onClick={() => setCustom((o) => !o)}
            className={cn(textLink, "justify-self-start text-[12px] pointer-coarse:min-h-11")}
            data-testid="checkin-customize"
          >
            {custom ? DAILY.settings.close : DAILY.settings.open}
          </button>
          {custom && <CheckInSettings config={config} />}
        </StaggerItem>
      </div>
    </Sheet>
  );
}
