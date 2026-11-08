/**
 * The ONE closing ritual (Paket F2): shared by "Wochenabschluss" (`WeekCloseCard`) and "Heute abschließen" (`DayCloseCard`) – never two.
 * A sober list of the process items, the round check button (the check draws itself, one ring leaves it – only when the closing earned
 * it), the week as seven quiet dots, and the two optional channels.
 *
 * It rewards PROCESS only. The reward is the confirmation `processDone(...)` of the caller; this component only draws what it is told:
 * `ring` = the closing was complete. The dots never say "missed": a day without trades or text is neutral, today is "still open", a
 * serial break does not exist here. The channels (vibration, tone) are the same preference as Einstellungen › Darstellung › Bewegung
 * (`useFeedbackPref`) and both stay OFF until the trader switches them on.
 */
import { useId, useState, type ReactNode } from "react";
import type { CloseItem, WeekDot } from "@/domain/growth/dayClose";
import { Switch } from "@/motion/Switch";
import { FEEDBACK_STRINGS, useFeedbackPref } from "@/motion/processFeedback";
import "./frost.css";

const STATE_WORD = { done: "erledigt", open: "offen", na: "entfällt" } as const;

export const RITUAL_STRINGS = {
  items: "Was zum Abschluss gehört",
  days: "Tage dieser Woche",
  channels: "Rückmeldung beim Abschluss",
  channelsNote: "Beides ist aus, bis du es einschaltest. Es meldet sich nur, wenn Checkliste und Review erledigt sind.",
} as const;

/** Haptic + tone switches: the preference of Einstellungen › Darstellung › Bewegung, OFF by default. */
function Channels({ testid }: { testid: string }) {
  const uid = useId();
  const pref = useFeedbackPref();
  const set = useFeedbackPref((s) => s.set);
  return (
    <section className="grid gap-2 border-t border-line pt-4" aria-label={RITUAL_STRINGS.channels} data-testid={`${testid}-channels`}>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
        <div className="flex min-h-11 items-center gap-2.5">
          <label htmlFor={`${uid}-h`} className="text-[13px]">
            {FEEDBACK_STRINGS.haptic}
          </label>
          <Switch id={`${uid}-h`} size="sm" aria-label={FEEDBACK_STRINGS.haptic} checked={pref.haptic} onCheckedChange={(haptic) => set({ haptic })} data-testid={`${testid}-haptic`} />
        </div>
        <div className="flex min-h-11 items-center gap-2.5">
          <label htmlFor={`${uid}-s`} className="text-[13px]">
            {FEEDBACK_STRINGS.sound}
          </label>
          <Switch id={`${uid}-s`} size="sm" aria-label={FEEDBACK_STRINGS.sound} checked={pref.sound} onCheckedChange={(sound) => set({ sound })} data-testid={`${testid}-sound`} />
        </div>
      </div>
      <p className="text-[11.5px] leading-relaxed text-faint">{RITUAL_STRINGS.channelsNote}</p>
    </section>
  );
}

export interface CloseRitualProps {
  /** "week-close" / "day-close": prefix of the test ids */
  testid: string;
  items: readonly CloseItem[] | null;
  dots: readonly WeekDot[];
  dotsText: string;
  closed: boolean;
  /** the closing that just happened was complete (items done): the ring leaves the button */
  ring: boolean;
  busy: boolean;
  /** the day whose dot pops after the tap ("YYYY-MM-DD"), when it is part of the week shown */
  todayKey?: string;
  /** label of the round button and the line beside it */
  action: { label: string; hint: string; done: string };
  onClose: () => void;
  /** where the caller's own parts (lesson field, state line) sit – above the button */
  children?: ReactNode;
}

export function CloseRitual({ testid, items, dots, dotsText, closed, ring, busy, todayKey, action, onClose, children }: CloseRitualProps) {
  // the check draws itself and the dot pops only right after the tap, never when a closed day is merely shown; the flag stays until the
  // day is re-opened (an animation runs once when its attribute appears, so keeping it replays nothing)
  const [fresh, setFresh] = useState(false);
  if (fresh && !closed) setFresh(false);
  return (
    <div className="fr-ritual" data-testid={`${testid}-ritual`}>
      {items && (
        <ul className="fr-items" aria-label={RITUAL_STRINGS.items} data-testid={`${testid}-items`}>
          {items.map((i) => (
            <li key={i.id} data-state={i.state} data-testid={`${testid}-item-${i.id}`}>
              <span className="fr-box" aria-hidden="true" />
              <span>
                {i.label}
                <span className="sr-only"> – {STATE_WORD[i.state]}</span>
                <small>{i.detail}</small>
              </span>
            </li>
          ))}
        </ul>
      )}
      {children}
      <div className="fr-do">
        <button
          type="button"
          className="fr-check"
          disabled={busy || closed}
          aria-label={closed ? action.done : action.label}
          onClick={() => {
            setFresh(true);
            onClose();
          }}
          data-on={closed ? "" : undefined}
          data-fresh={fresh && closed ? "" : undefined}
          data-ring={fresh && closed && ring ? "" : undefined}
          data-testid={closed ? `${testid}-check` : `${testid}-done`}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 12.5l4.5 4.5L19 7.5" />
          </svg>
        </button>
        <div className="grid min-w-0 gap-0.5">
          <b className="text-[14px] font-semibold">{closed ? action.done : action.label}</b>
          <span className="text-[12.5px] text-mute">{closed ? "" : action.hint}</span>
        </div>
      </div>
      <div className="grid gap-1.5">
        <ul className="fr-days" aria-label={RITUAL_STRINGS.days} data-testid={`${testid}-days`}>
          {dots.map((d) => (
            <li key={d.key} data-state={d.state} data-fresh={fresh && d.key === todayKey ? "" : undefined} title={d.label}>
              <span className="fr-dot" aria-hidden="true" />
              <span className="sr-only">{d.label}</span>
            </li>
          ))}
        </ul>
        <span className="text-[11.5px] text-faint" data-testid={`${testid}-days-text`}>
          {dotsText}
        </span>
      </div>
      <Channels testid={testid} />
    </div>
  );
}
