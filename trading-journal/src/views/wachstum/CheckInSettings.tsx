/**
 * "Felder und Erinnerung anpassen" inside the check-in sheet (F61): the daily prompt on / off, which fields are asked, the
 * time zone the day is counted in, the optional reminder time and the trader's own questions with a scale. Every change is
 * written at once to `settings.checkin` (synced, merged per field / per question id). Nothing is asked that is switched off;
 * a hidden question keeps its answers.
 */
import { useId, useState } from "react";
import { CHECKIN_FIELD_IDS, CHECKIN_FIELD_LABEL, CUSTOM_LABEL_MAX, CUSTOM_MAX, deviceTimeZone, isValidTimeZone, setQuestionOn, withoutQuestion, withQuestion, type CheckinConfig } from "@/domain/checkin";
import { newId } from "@/lib/ids";
import { Switch } from "@/motion/Switch";
import { Button } from "@/primitives/Button";
import { Input, inputClass } from "@/primitives/Input";
import { cn } from "@/lib/cn";
import { saveCheckinConfig } from "./actions";
import { DAILY } from "./checkinStrings";
import { setDevicePrompt, useDevicePrompt } from "./dailyCheckin";

const S = DAILY.settings;
const ZONES = ["Europe/Berlin", "Europe/Zurich", "Europe/London", "America/New_York", "America/Chicago", "America/Los_Angeles", "Asia/Dubai", "Asia/Singapore", "Asia/Tokyo", "Australia/Sydney", "UTC"] as const;

function Row({ label, children, htmlFor }: { label: string; children: React.ReactNode; htmlFor?: string }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-3 rounded-xl border border-line px-3 py-2">
      <label htmlFor={htmlFor} className="min-w-0 text-[13px]">
        {label}
      </label>
      {children}
    </div>
  );
}

export function CheckInSettings({ config }: { config: CheckinConfig }) {
  const uid = useId();
  const deviceOff = useDevicePrompt((s) => s.off);
  const device = deviceTimeZone();
  const zones = [...new Set<string>([...ZONES, ...(config.timeZone ? [config.timeZone] : []), device])];
  const [label, setLabel] = useState("");
  const [max, setMax] = useState(5);
  const [low, setLow] = useState("");
  const [high, setHigh] = useState("");
  const full = config.custom.length >= CUSTOM_MAX;

  const add = () => {
    if (!label.trim() || full) return;
    void saveCheckinConfig({ custom: withQuestion(config.custom, { id: newId("cq_"), label, max, minLabel: low, maxLabel: high }) });
    setLabel("");
    setLow("");
    setHigh("");
  };

  return (
    <div className="grid gap-5 rounded-2xl border border-line bg-ink-950/40 p-4" data-testid="checkin-settings">
      <div className="grid gap-2">
        <Row label={S.prompt} htmlFor={`${uid}-prompt`}>
          <Switch id={`${uid}-prompt`} aria-label={S.prompt} checked={config.prompt} onCheckedChange={(on) => void saveCheckinConfig({ prompt: on })} data-testid="cs-prompt" />
        </Row>
        <Row label={S.device} htmlFor={`${uid}-device`}>
          <Switch id={`${uid}-device`} aria-label={S.device} checked={!deviceOff} onCheckedChange={(on) => setDevicePrompt(on)} data-testid="cs-device" />
        </Row>
        <p className="text-[11.5px] text-faint">{S.promptNote}</p>
      </div>

      <fieldset className="grid gap-2">
        <legend className="label mb-1">{S.fields}</legend>
        <p className="text-[11.5px] text-faint">{S.fieldsNote}</p>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {CHECKIN_FIELD_IDS.map((id) => (
            <Row key={id} label={CHECKIN_FIELD_LABEL[id]} htmlFor={`${uid}-f-${id}`}>
              <Switch id={`${uid}-f-${id}`} aria-label={CHECKIN_FIELD_LABEL[id]} size="sm" checked={config.fields[id]} onCheckedChange={(on) => void saveCheckinConfig({ fields: { [id]: on } })} data-testid={`cs-field-${id}`} />
            </Row>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-2 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <label htmlFor={`${uid}-tz`} className="text-[12.5px] font-medium">
            {S.timeZone}
          </label>
          <select
            id={`${uid}-tz`}
            data-testid="cs-timezone"
            className={cn(inputClass, "pointer-coarse:min-h-11")}
            value={config.timeZone ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              void saveCheckinConfig({ timeZone: v && isValidTimeZone(v) ? v : null });
            }}
          >
            <option value="">{`${S.timeZoneDevice} (${device})`}</option>
            {zones.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
          <span className="text-[11.5px] text-faint">{S.timeZoneNote}</span>
        </div>
        <div className="grid gap-1.5">
          <label htmlFor={`${uid}-rem`} className="text-[12.5px] font-medium">
            {S.reminder}
          </label>
          <div className="flex gap-2">
            <Input
              id={`${uid}-rem`}
              data-testid="cs-reminder"
              type="time"
              value={config.reminder ?? ""}
              onChange={(e) => void saveCheckinConfig({ reminder: /^\d{2}:\d{2}$/.test(e.target.value) ? e.target.value : null })}
              className="flex-1"
            />
            {config.reminder && (
              <Button size="sm" onClick={() => void saveCheckinConfig({ reminder: null })}>
                {S.reminderClear}
              </Button>
            )}
          </div>
          <span className="text-[11.5px] text-faint">{S.reminderNote}</span>
        </div>
      </div>

      <section className="grid gap-2" aria-label={S.own}>
        <h4 className="label">{S.own}</h4>
        <p className="text-[11.5px] text-faint">{S.ownNote}</p>
        {config.custom.length > 0 && (
          <ul className="grid gap-1.5">
            {config.custom.map((q) => (
              <li key={q.id} className="flex min-h-11 items-center justify-between gap-3 rounded-xl border border-line px-3 py-2" data-testid="cs-question">
                <span className="min-w-0 text-[13px]">
                  {q.label} <span className="text-faint">· 1–{q.max}</span>
                </span>
                <span className="flex shrink-0 items-center gap-3">
                  <Switch aria-label={`${q.label} ${S.ownOn}`} size="sm" checked={q.on} onCheckedChange={(on) => void saveCheckinConfig({ custom: setQuestionOn(config.custom, q.id, on) })} />
                  <Button size="sm" variant="danger" aria-label={`${S.ownRemove}: ${q.label}`} onClick={() => void saveCheckinConfig({ custom: withoutQuestion(config.custom, q.id) })}>
                    ×
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
        {!full && (
          <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
            <div className="grid gap-2">
              <Input data-testid="cs-q-label" value={label} maxLength={CUSTOM_LABEL_MAX} placeholder={S.ownPlaceholder} aria-label={S.ownLabel} onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), add())} />
              <div className="grid grid-cols-3 gap-2">
                <select aria-label={S.ownMax} data-testid="cs-q-max" className={cn(inputClass, "pointer-coarse:min-h-11")} value={max} onChange={(e) => setMax(Number(e.target.value))}>
                  {[3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                    <option key={n} value={n}>{`${S.ownMax} ${n}`}</option>
                  ))}
                </select>
                <Input value={low} maxLength={24} placeholder={S.ownMin} aria-label={S.ownMin} onChange={(e) => setLow(e.target.value)} />
                <Input value={high} maxLength={24} placeholder={S.ownTop} aria-label={S.ownTop} onChange={(e) => setHigh(e.target.value)} />
              </div>
            </div>
            <Button onClick={add} disabled={!label.trim()} data-testid="cs-q-add" className="self-start">
              {S.ownAdd}
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}
