/**
 * „Bewegung“ in Einstellungen › Darstellung (Runde 11, A5): the reader's motion setting (`src/motion/profile.ts` – Wie das Gerät / Reduziert / Volles
 * Profil, kept per device), a preview button and the replay of the logo sequence. The preview is five small marks that wave in from the top one after
 * the other with the chosen profile (reduced: all at once) – the same wave the sidebar plays on the first load.
 */
import { useEffect, useRef, useState } from "react";
import { replayLogo } from "@/app/logoSeq";
import { MOTION_MODES, MOTION_STRINGS, useMotionPref, type MotionMode } from "@/motion/profile";
import { FEEDBACK_STRINGS, useFeedbackPref } from "@/motion/processFeedback";
import { Switch } from "@/motion/Switch";
import { useReducedFx } from "@/motion/useReducedFx";
import { Button } from "@/primitives/Button";
import { Segmented } from "@/primitives/Segmented";

/** Marks in the preview strip. */
const DOTS = 5;
/** The wave's pace, as in the sidebar (`shell-motion.css`): 52 ms apart, 300 ms each, 10 px. */
const STEP_MS = 52;
const DUR_MS = 300;

export function MotionSection() {
  const mode = useMotionPref((s) => s.mode);
  const setMode = useMotionPref((s) => s.setMode);
  const reduced = useReducedFx();
  const strip = useRef<HTMLDivElement>(null);
  const [running, setRunning] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const preview = () => {
    const marks = Array.from(strip.current?.children ?? []) as HTMLElement[];
    if (reduced || typeof marks[0]?.animate !== "function") return;
    clearTimeout(timer.current);
    setRunning(true);
    marks.forEach((el, i) => el.animate([{ opacity: 0, translate: "0 -10px" }, { opacity: 1, translate: "0 0" }], { duration: DUR_MS, delay: i * STEP_MS, easing: "cubic-bezier(0.22, 1, 0.36, 1)", fill: "backwards" }));
    timer.current = setTimeout(() => setRunning(false), (DOTS - 1) * STEP_MS + DUR_MS + 60);
  };

  return (
    <div className="grid gap-2.5 border-t border-line pt-4" data-testid="motion-section">
      <span id="motion-label" className="label">
        {MOTION_STRINGS.title}
      </span>
      <Segmented<MotionMode>
        aria-label={MOTION_STRINGS.radioGroup}
        size="sm"
        value={mode}
        onChange={setMode}
        options={MOTION_MODES.map((v) => ({ v, label: MOTION_STRINGS.modes[v] }))}
      />
      <p className="text-[12px] text-mute" data-testid="motion-hint">
        {MOTION_STRINGS.hints[mode]}
      </p>
      <div className="flex flex-wrap items-center gap-2.5">
        <Button size="sm" onClick={preview} data-testid="motion-preview" aria-describedby="motion-label">
          {running ? MOTION_STRINGS.previewing : MOTION_STRINGS.preview}
        </Button>
        <div ref={strip} aria-hidden="true" className="flex items-center gap-1.5" data-testid="motion-strip">
          {Array.from({ length: DOTS }, (_, i) => (
            <span key={i} className="size-2.5 rounded-full bg-fg/70" />
          ))}
        </div>
        <Button size="sm" variant="ghost" onClick={replayLogo} data-testid="motion-logo">
          {MOTION_STRINGS.logo}
        </Button>
      </div>
      <FeedbackRows />
    </div>
  );
}

/**
 * „Rückmeldung bei geschafften Schritten“ (Paket P): the optional second channel of the quiet process feedback – a short vibration and
 * a soft tone. Both OFF by default; they only ever follow a finished process step (`@/motion/processFeedback`), never a profit,
 * a loss or a trade.
 */
function FeedbackRows() {
  const sound = useFeedbackPref((s) => s.sound);
  const haptic = useFeedbackPref((s) => s.haptic);
  const set = useFeedbackPref((s) => s.set);
  const canVibrate = typeof navigator !== "undefined" && typeof navigator.vibrate === "function";
  return (
    <div className="grid gap-2.5 border-t border-line pt-4" data-testid="feedback-section">
      <span id="feedback-label" className="label">
        {FEEDBACK_STRINGS.title}
      </span>
      <p className="text-[12px] text-mute">{FEEDBACK_STRINGS.lead}</p>
      {canVibrate && (
        <div className="flex items-center justify-between gap-4">
          <label htmlFor="fb-haptic" className="cursor-pointer text-[13px] text-fg">
            {FEEDBACK_STRINGS.haptic}
          </label>
          <Switch id="fb-haptic" className="touch-hit shrink-0" checked={haptic} onCheckedChange={(on) => set({ haptic: on })} data-testid="feedback-haptic" />
        </div>
      )}
      <div className="flex items-center justify-between gap-4">
        <label htmlFor="fb-sound" className="cursor-pointer text-[13px] text-fg">
          {FEEDBACK_STRINGS.sound}
        </label>
        <Switch id="fb-sound" className="touch-hit shrink-0" checked={sound} onCheckedChange={(on) => set({ sound: on })} data-testid="feedback-sound" />
      </div>
    </div>
  );
}
