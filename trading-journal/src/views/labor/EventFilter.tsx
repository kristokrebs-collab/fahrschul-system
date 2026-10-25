/**
 * Event filter row of the Filtervergleich (F43): "Keine Einstiege X Minuten vor/nach einem Termin". Appointments that follow a
 * rule for every candle of any backtest (Funding grid, Deribit expiry, US stock market opening) can be chosen; FOMC dates and the
 * trader's own entries cannot, and the row says why (they would filter only part of the history). Same look and test ids as the
 * other filter rows (`labor-filter`, `data-filter="event"`).
 */
import { DEFAULT_EVENT_KINDS, EVENT_FILTER_KINDS, EVENT_FILTER_LABEL, EVENT_FILTER_REASON, EVENT_MINUTES, type EventFilterKind } from "@/domain/events/filterKinds";
import { cn } from "@/lib/cn";
import { Switch } from "@/motion/Switch";
import { useExtras } from "./extrasStore";
import { ChipPick } from "./ui";

const MINUTE_OPTIONS = [15, 30, 60, 90, 120, 180, 240].filter((v) => v >= EVENT_MINUTES.min && v <= EVENT_MINUTES.max);

export const EVENT_FILTER_TEXT = {
  label: "Keine Einstiege rund um Termine",
  sub: "Kein Einstieg X Minuten vor oder nach einem Termin. Es zählt die Eröffnung der Kerze nach dem Signal.",
  minutes: "Minuten vor und nach dem Termin",
  kinds: "Termine",
  why: "Warum nicht FOMC und eigene Termine?",
} as const;

export function EventFilterRow() {
  const sel = useExtras((s) => s.selection);
  const setOn = useExtras((s) => s.setFilterOn);
  const setParam = useExtras((s) => s.setEventParam);
  const on = sel.on.includes("event");
  const minutes = sel.eventMinutes ?? EVENT_MINUTES.def;
  const kinds = sel.eventKinds ?? DEFAULT_EVENT_KINDS;
  const toggle = (k: EventFilterKind): void => {
    const next = kinds.includes(k) ? kinds.filter((x) => x !== k) : EVENT_FILTER_KINDS.filter((x) => x === k || kinds.includes(x));
    // the last kind cannot be switched off – the filter would do nothing; switch the filter off instead
    if (next.length) setParam({ eventKinds: next });
  };
  return (
    <li className="grid gap-2 rounded-xl border border-line bg-ink-950/50 p-3.5" data-testid="labor-filter" data-filter="event" data-available="true">
      <div className="flex items-start gap-3">
        <Switch size="sm" checked={on} onCheckedChange={(v) => setOn("event", v)} aria-label={EVENT_FILTER_TEXT.label} data-testid="labor-filter-switch-event" className="mt-0.5 shrink-0" />
        <div className="grid min-w-0 flex-1 gap-1">
          <p className="text-[13px] font-semibold">{EVENT_FILTER_TEXT.label}</p>
          <p className="text-[12px] leading-snug text-faint">{EVENT_FILTER_TEXT.sub}</p>
        </div>
      </div>
      {on && (
        <>
          <div className="grid gap-1.5 pl-1">
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-mute">{EVENT_FILTER_TEXT.minutes}</span>
            <ChipPick id="labor-filter-event-min" label={EVENT_FILTER_TEXT.minutes} value={minutes} options={MINUTE_OPTIONS.map((v) => ({ v, label: String(v) }))} onChange={(v) => setParam({ eventMinutes: v })} />
          </div>
          <div className="grid gap-1.5 pl-1">
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-mute">{EVENT_FILTER_TEXT.kinds}</span>
            <div role="group" aria-label={EVENT_FILTER_TEXT.kinds} className="flex flex-wrap gap-1.5">
              {EVENT_FILTER_KINDS.map((k) => {
                const pressed = kinds.includes(k);
                return (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={pressed}
                    onClick={() => toggle(k)}
                    data-testid={`labor-filter-event-kind-${k}`}
                    className={cn("min-h-9 rounded-full border px-3 text-[12px] font-medium transition-colors pointer-coarse:min-h-11 pointer-coarse:min-w-11", pressed ? "border-line-2 bg-ink-750 text-fg" : "border-line-2 text-mute hover:border-white/30 hover:text-fg")}
                  >
                    {EVENT_FILTER_LABEL[k]}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
      <details className="pl-1 text-[12px] leading-snug text-mute">
        <summary className="cursor-pointer select-none py-1 text-faint hover:text-mute pointer-coarse:py-2.5">{EVENT_FILTER_TEXT.why}</summary>
        <p className="pt-1" data-testid="labor-filter-event-reason">
          {EVENT_FILTER_REASON}
        </p>
      </details>
    </li>
  );
}
