import { motion } from "motion/react";
import type { KeyboardEvent } from "react";
import { BEHAVIOR_KEYS, BEHAVIOR_LABEL, type BehaviorKey } from "@/domain/coach/behaviorKeys";
import { cn } from "@/lib/cn";
import { radius, spring, stagger, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Field, Input, Textarea } from "@/primitives";
import { EXIT_REASONS, type JournalForm } from "./form";
import { VoiceNote } from "./VoiceNote";

export const SCALE_LABELS = {
  stress: ["Entspannt", "Locker", "Angespannt", "Gestresst", "Unter Strom"],
  confidence: ["Zweifelnd", "Unsicher", "Okay", "Sicher", "Felsenfest"],
} as const;

/**
 * Inner-state flags offered on a trade (P04 behaviour keys, German labels). The keys that describe an ACTION already
 * have a mistake tag (`Revenge-Trade`, `FOMO-Einstieg`, `Stop verschoben`, `Zu früh raus`, `Gegen den Plan`), so the
 * `Fehler` section keeps those; here only the states.
 */
const STATE_KEYS = new Set<BehaviorKey>(["tilt", "overtrading", "lossAversion", "overconfidence", "impulsive", "boredom"]);
export const PSYCH_FLAGS: readonly { key: string; label: string }[] = BEHAVIOR_KEYS.filter((k) => STATE_KEYS.has(k)).map((k) => ({ key: k, label: BEHAVIOR_LABEL[k] }));

export interface PsychSectionProps {
  j: JournalForm;
  onChange: (patch: Partial<JournalForm>) => void;
}

/**
 * `Psyche` (Journal v3): stress and confidence on two 1–5 meters (bars rise on `spring.bar`, staggered), behaviour
 * flags (the coach's keys), the exit reason (quick chips or own words) and notes before / after the trade.
 */
export function PsychSection({ j, onChange }: PsychSectionProps) {
  const toggleFlag = (k: string) => onChange({ flags: j.flags.includes(k) ? j.flags.filter((f) => f !== k) : [...j.flags, k] });
  const reduced = useReducedFx();
  const customFlags = j.flags.filter((f) => !PSYCH_FLAGS.some((p) => p.key === f));
  // a chosen quick reason shows as its chip only; the text field holds own words (typing replaces the chip)
  const preset = (EXIT_REASONS as readonly string[]).includes(j.exitReason);
  return (
    <div className="grid gap-4">
      <div className="grid gap-3.5 sm:grid-cols-2">
        <Field label="Stress">
          <Meter5 label="Stress" value={j.stress} onChange={(stress) => onChange({ stress })} labels={SCALE_LABELS.stress} tone="loss" />
        </Field>
        <Field label="Zuversicht">
          <Meter5 label="Zuversicht" value={j.confidence} onChange={(confidence) => onChange({ confidence })} labels={SCALE_LABELS.confidence} tone="win" />
        </Field>
      </div>
      <Field label="Verhalten">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Verhalten">
          {[...PSYCH_FLAGS, ...customFlags.map((f) => ({ key: f, label: BEHAVIOR_LABEL[f as BehaviorKey] ?? f }))].map((f) => {
            const on = j.flags.includes(f.key);
            return (
              <motion.button
                key={f.key}
                type="button"
                aria-pressed={on}
                onClick={() => toggleFlag(f.key)}
                whileTap={reduced ? undefined : { scale: 0.94 }}
                transition={spring.press}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors duration-200 pointer-coarse:min-h-11",
                  on ? "border-white/50 bg-white/[0.1] text-fg" : "border-line-2 text-mute hover:border-white/40 hover:text-fg",
                )}
              >
                {f.label}
              </motion.button>
            );
          })}
        </div>
      </Field>
      <Field label="Exit-Grund" htmlFor="f-exit-reason">
        <div className="grid gap-2">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Exit-Grund wählen">
            {EXIT_REASONS.map((r) => {
              const on = j.exitReason === r;
              return (
                <button
                  key={r}
                  type="button"
                  aria-pressed={on}
                  onClick={() => onChange({ exitReason: on ? "" : r })}
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-[11.5px] transition-colors pointer-coarse:min-h-11",
                    on ? "border-white/50 bg-white/[0.1] text-fg" : "border-line text-mute hover:border-white/30 hover:text-fg",
                  )}
                >
                  {r}
                </button>
              );
            })}
          </div>
          <Input
            id="f-exit-reason"
            value={preset ? "" : j.exitReason}
            onChange={(e) => onChange({ exitReason: e.target.value })}
            placeholder={preset ? "Oder in eigenen Worten (ersetzt die Auswahl)" : "Oder in eigenen Worten"}
            maxLength={120}
            autoComplete="off"
          />
        </div>
      </Field>
      <div className="grid gap-3.5 md:grid-cols-2">
        <Field label="Vor dem Trade" htmlFor="f-pre-note">
          <Textarea id="f-pre-note" rows={2} className="leading-relaxed" value={j.preNote} onChange={(e) => onChange({ preNote: e.target.value })} placeholder="Wie ging es dir? Was war der Plan?" />
          <VoiceNote value={j.preNote} onChange={(preNote) => onChange({ preNote })} label="Vor dem Trade" testId="voice-pre-note" />
        </Field>
        <Field label="Nach dem Trade" htmlFor="f-post-note">
          <Textarea id="f-post-note" rows={2} className="leading-relaxed" value={j.postNote} onChange={(e) => onChange({ postNote: e.target.value })} placeholder="Wie fühlt es sich jetzt an?" />
          <VoiceNote value={j.postNote} onChange={(postNote) => onChange({ postNote })} label="Nach dem Trade" testId="voice-post-note" />
        </Field>
      </div>
    </div>
  );
}

/**
 * 1–5 meter (`radiogroup` of five radios named `n · label`): bars of growing height; the chosen bar and those below it
 * rise in on `spring.bar` (`stagger.rows` apart) tinted by `tone`. Re-choosing clears; arrows move.
 */
export function Meter5({ label, value, onChange, labels, tone }: { label: string; value: number | null; onChange: (v: number | null) => void; labels: readonly string[]; tone: "win" | "loss" | "fg" }) {
  const reduced = useReducedFx();
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const cur = value ?? 0;
    const next = e.key === "ArrowRight" || e.key === "ArrowUp" ? Math.min(5, cur + 1) : e.key === "ArrowLeft" || e.key === "ArrowDown" ? Math.max(1, cur - 1) : null;
    if (next == null) return;
    e.preventDefault();
    onChange(next);
    e.currentTarget.querySelector<HTMLButtonElement>(`[data-level="${next}"]`)?.focus();
  };
  const fill = tone === "win" ? "bg-win" : tone === "loss" ? "bg-loss" : "bg-fg";
  return (
    <div className="flex items-end gap-3">
      <div role="radiogroup" aria-label={label} className="flex items-end gap-1.5 pointer-coarse:gap-0" onKeyDown={onKey}>
        {[1, 2, 3, 4, 5].map((n, i) => {
          const on = value === n;
          const lit = value != null && n <= value;
          return (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={`${n} · ${labels[i]}`}
              data-level={n}
              tabIndex={on || (value == null && n === 1) ? 0 : -1}
              onClick={() => onChange(on ? null : n)}
              className="group grid h-11 w-7 items-end justify-items-center rounded-md focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/50 pointer-coarse:w-11"
            >
              <span className="relative block w-3.5 overflow-hidden rounded-[3px] bg-white/[0.08] transition-colors group-hover:bg-white/[0.14]" style={{ height: 10 + n * 6 }}>
                <motion.span
                  aria-hidden="true"
                  className={cn("absolute inset-0 origin-bottom", fill)}
                  style={{ borderRadius: radius.thumb / 2 }}
                  initial={false}
                  animate={{ scaleY: lit ? 1 : 0, opacity: lit ? 1 : 0 }}
                  transition={reduced ? { duration: 0 } : { scaleY: { ...spring.bar, delay: lit ? Math.min(i, stagger.max) * stagger.rows : 0 }, opacity: tween.fade }}
                />
              </span>
            </button>
          );
        })}
      </div>
      <span className="pb-1 font-mono text-[11px] text-mute" aria-hidden="true">
        {value ? labels[value - 1] : "–"}
      </span>
    </div>
  );
}
