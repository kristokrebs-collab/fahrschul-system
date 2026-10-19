/**
 * The F61 fields of the check-in sheet that go beyond the original ones: Schlafqualität, Konzentration, verfügbare Zeit,
 * geplante Session, Tagesrisiko, Kommentar and the trader's own questions. Each one is shown only when its switch in
 * `settings.checkin.fields` is on; every value starts unset (a ghost thumb / no chip) and stays absent from the record
 * until the trader sets it – nothing is pre-filled, nothing "defaults to fine".
 */
import { motion } from "motion/react";
import type { ReactNode } from "react";
import { activeQuestions, type CheckinConfig } from "@/domain/checkin";
import { AVAILABLE_CHOICES, CHECKIN_SESSIONS, FOCUS_LABELS, SLEEP_QUALITY_LABELS, type CheckIn, type Level5 } from "@/domain/psych";
import { cn } from "@/lib/cn";
import { StaggerItem } from "@/motion/Stagger";
import { spring } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Textarea } from "@/primitives/Input";
import { DAILY } from "./checkinStrings";
import { ElasticSlider } from "./ui";

const F = DAILY.field;

function ChoiceChip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
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
        on ? "border-white/50 bg-white/[0.1] text-fg" : "border-line-2 text-mute hover:border-white/40 hover:text-fg",
      )}
    >
      {children}
    </motion.button>
  );
}

export function CheckInFields({ config, value, onChange }: { config: CheckinConfig; value: CheckIn; onChange: (patch: Partial<CheckIn>) => void }) {
  const f = config.fields;
  const questions = activeQuestions(config);
  const sliders = f.sleepQuality || f.focus || f.dayRisk || questions.length > 0;
  return (
    <>
      {sliders && (
        <StaggerItem as="section" className="grid gap-5 sm:grid-cols-2" aria-label="Weitere Angaben">
          {f.focus && (
            <ElasticSlider id="ci-focus" data-testid="ci-focus" label={F.focus} min={1} max={5} step={1} value={value.focus ?? null} onChange={(v) => onChange({ focus: v as Level5 })} format={(v) => FOCUS_LABELS[v - 1] ?? ""} tone="fg" ends={[...F.ends.focus]} />
          )}
          {f.sleepQuality && (
            <ElasticSlider
              id="ci-sleepq"
              data-testid="ci-sleepq"
              label={F.sleepQuality}
              min={1}
              max={5}
              step={1}
              value={value.sleepQuality ?? null}
              onChange={(v) => onChange({ sleepQuality: v as Level5 })}
              format={(v) => SLEEP_QUALITY_LABELS[v - 1] ?? ""}
              tone="fg"
              ends={[...F.ends.sleepQuality]}
            />
          )}
          {f.dayRisk && (
            <ElasticSlider id="ci-dayrisk" data-testid="ci-dayrisk" label={F.dayRisk} min={0} max={5} step={0.25} value={value.dayRisk ?? null} onChange={(v) => onChange({ dayRisk: v })} format={DAILY.riskText} tone="warn" ends={[...F.ends.dayRisk]} />
          )}
          {questions.map((q) => (
            <ElasticSlider
              key={q.id}
              id={`ci-q-${q.id}`}
              data-testid={`ci-q-${q.id}`}
              label={q.label}
              min={1}
              max={q.max}
              step={1}
              value={value.custom?.[q.id] ?? null}
              onChange={(v) => onChange({ custom: { ...value.custom, [q.id]: v } })}
              format={(v) => `${v} von ${q.max}`}
              tone="fg"
              ends={[q.minLabel ?? "1", q.maxLabel ?? String(q.max)]}
            />
          ))}
        </StaggerItem>
      )}

      {(f.availableTime || f.session) && (
        <StaggerItem as="section" className="grid gap-4" aria-label="Plan für heute">
          {f.availableTime && (
            <div className="grid gap-2">
              <span className="text-[12.5px] font-medium">{F.availableTime}</span>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label={F.availableTime} data-testid="ci-available">
                {AVAILABLE_CHOICES.map((min) => (
                  <ChoiceChip key={min} on={value.availableMin === min} onClick={() => onChange({ availableMin: value.availableMin === min ? undefined : min })}>
                    {DAILY.availableText(min)}
                  </ChoiceChip>
                ))}
              </div>
            </div>
          )}
          {f.session && (
            <div className="grid gap-2">
              <span className="text-[12.5px] font-medium">{F.session}</span>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label={F.session} data-testid="ci-session">
                {CHECKIN_SESSIONS.map((s) => (
                  <ChoiceChip key={s} on={value.session === s} onClick={() => onChange({ session: value.session === s ? undefined : s })}>
                    {s}
                  </ChoiceChip>
                ))}
              </div>
            </div>
          )}
        </StaggerItem>
      )}

      {f.comment && (
        <StaggerItem as="section" className="grid gap-2" aria-label={F.comment}>
          <label htmlFor="ci-comment" className="text-[12.5px] font-medium">
            {F.comment}
          </label>
          <Textarea id="ci-comment" data-testid="ci-comment" rows={3} maxLength={500} value={value.comment ?? ""} placeholder={F.commentPlaceholder} onChange={(e) => onChange({ comment: e.target.value || undefined })} />
        </StaggerItem>
      )}
    </>
  );
}
