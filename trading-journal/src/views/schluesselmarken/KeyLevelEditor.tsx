/**
 * Editor of one key level (F09): name, price, timeframe, direction, rule, its parameter, invalidation, priority, role in
 * the day plan and the level's alert stages. Inline in the card (no dialog): a form is easier to reach on a phone and
 * keeps the status list visible. A timeframe the market feed cannot serve is DISABLED with the reason, never replaced.
 */
import { useId, useMemo, useState, type FormEvent } from "react";
import { KEY_TIMEFRAMES, PLAN_ROLES, STAGE_LABEL, TRIGGER_KINDS, type KeyLevel, type KeyTf, type TfAvailability } from "@/domain/keylevels";
import { price as fmtPrice } from "@/lib/format";
import { newId } from "@/lib/ids";
import { MorphSelect } from "@/motion/pulse/MorphSelect";
import { Switch } from "@/motion/Switch";
import { Button } from "@/primitives/Button";
import { Field } from "@/primitives/Field";
import { Input } from "@/primitives/Input";
import { Segmented } from "@/primitives/Segmented";
import { cn } from "@/lib/cn";
import { emptyForm, formFromLevel, levelFromForm, parsePriceInput, type EditorErrors, type EditorForm } from "./editorModel";
import { DIRECTION_LABEL, EDITOR as E, KIND_HELP, KIND_LABEL, ROLE_HELP, ROLE_LABEL, STAGE_HELP } from "./strings";

const KIND_OPTIONS = TRIGGER_KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] }));
const ROLE_OPTIONS = PLAN_ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r] }));
const PRIORITY_OPTIONS = [1, 2, 3, 4, 5].map((n) => ({ v: String(n), label: String(n) }));
const STAGES = ["prepare", "confirm", "retest", "invalid"] as const;

export interface KeyLevelEditorProps {
  /** `null` = a new level */
  level: KeyLevel | null;
  symbol: string | null;
  tf: readonly TfAvailability[];
  /** live price (reading of the typed price, placeholder) */
  price: number | null;
  onSave: (level: KeyLevel) => void;
  onCancel: () => void;
  className?: string;
}

export function KeyLevelEditor({ level, symbol, tf, price, onSave, onCancel, className }: KeyLevelEditorProps) {
  const uid = useId();
  const id = (s: string) => `${uid}-${s}`;
  const [f, setF] = useState<EditorForm>(() => (level ? formFromLevel(level) : emptyForm()));
  const [errors, setErrors] = useState<EditorErrors>({});
  const [shake, setShake] = useState(0);
  const set = <K extends keyof EditorForm>(k: K, v: EditorForm[K]) => setF((cur) => ({ ...cur, [k]: v }));
  const available = useMemo(() => new Set<KeyTf>(tf.filter((t) => t.ok).map((t) => t.tf)), [tf]);
  const blocked = tf.filter((t) => !t.ok);
  const parsed = parsePriceInput(f.price, price);
  const sym = level?.symbol ?? symbol;
  const needsDist = f.kind === "buffer" || f.kind === "retest";
  const wide = "sm:col-span-2";

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!sym) return;
    const res = levelFromForm(f, { id: level?.id ?? newId("k_"), symbol: sym, now: Date.now(), prev: level, ref: price, available });
    if (!res.ok) {
      setErrors(res.errors);
      setShake((n) => n + 1);
      return;
    }
    setErrors({});
    onSave(res.level);
  };

  return (
    <form onSubmit={submit} className={cn("grid gap-4 rounded-2xl border border-line-2 bg-ink-950/50 p-4", className)} aria-label={level ? E.titleEdit : E.titleNew} data-testid="keylevel-editor" noValidate>
      <h3 className="label flex items-center gap-2">
        <span className="size-1.5 rounded-full bg-signal" aria-hidden="true" />
        {level ? E.titleEdit : E.titleNew}
        {sym && <span className="num ml-auto font-mono text-[11px] normal-case tracking-normal text-mute">{sym}</span>}
      </h3>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={E.name} htmlFor={id("name")}>
          <Input id={id("name")} value={f.name} maxLength={60} placeholder={E.namePlaceholder} onChange={(e) => set("name", e.target.value)} autoComplete="off" />
        </Field>
        <Field
          label={E.price}
          htmlFor={id("price")}
          invalidKey={errors.price ? shake : null}
          error={errors.price}
          help={parsed != null && parsed > 0 ? `${E.priceHelp} ${fmtPrice(parsed)}` : undefined}
        >
          <Input id={id("price")} numeric value={f.price} placeholder={price ? new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 }).format(price) : E.pricePlaceholder} invalid={!!errors.price} aria-describedby={errors.price ? `${id("price")}-error` : undefined} onChange={(e) => set("price", e.target.value)} autoComplete="off" />
        </Field>

        <div className={cn("grid gap-1.5", wide)}>
          <span id={id("tf-l")} className="label">
            {E.tf}
          </span>
          <Segmented<KeyTf>
            aria-labelledby={id("tf-l")}
            size="md"
            className="justify-self-start"
            value={f.tf}
            onChange={(v) => set("tf", v)}
            options={KEY_TIMEFRAMES.map((t) => ({ v: t, label: t, disabled: !available.has(t) && level?.tf !== t }))}
          />
          {blocked.length > 0 ? (
            <ul className="grid gap-0.5 text-[11px] text-faint" aria-label="Nicht verfügbare Zeiteinheiten" data-testid="keylevel-tf-blocked">
              {blocked.map((t) => (
                <li key={t.tf}>
                  <span className="num font-mono text-mute">{t.tf}</span> – {t.reason}
                </li>
              ))}
            </ul>
          ) : (
            <span className="text-[11px] text-faint">{E.tfHelp}</span>
          )}
          {errors.tf && (
            <span role="alert" className="text-[11px] text-loss">
              {errors.tf}
            </span>
          )}
        </div>

        <div className="grid gap-1.5">
          <span id={id("dir-l")} className="label">
            {E.direction}
          </span>
          <Segmented<"above" | "below">
            aria-labelledby={id("dir-l")}
            size="md"
            className="justify-self-start"
            value={f.direction}
            onChange={(v) => set("direction", v)}
            tones={{ above: "bg-win/15 border-win/30", below: "bg-loss/15 border-loss/30" }}
            options={(["above", "below"] as const).map((d) => ({ v: d, label: DIRECTION_LABEL[d] }))}
          />
        </div>
        <Field label={E.kind} htmlFor={id("kind")} help={KIND_HELP[f.kind]}>
          <MorphSelect id={id("kind")} value={f.kind} onChange={(v) => set("kind", v)} options={KIND_OPTIONS} />
        </Field>

        {f.kind === "closes" && (
          <Field label={E.closes} htmlFor={id("closes")}>
            <Input id={id("closes")} numeric value={f.closes} onChange={(e) => set("closes", e.target.value)} autoComplete="off" />
          </Field>
        )}
        {needsDist && (
          <>
            <Field label={f.kind === "buffer" ? E.distanceBuffer : E.distanceRetest} htmlFor={id("dist")} error={errors.distance} invalidKey={errors.distance ? shake : null}>
              <Input id={id("dist")} numeric value={f.distValue} invalid={!!errors.distance} onChange={(e) => set("distValue", e.target.value)} autoComplete="off" />
            </Field>
            <div className="grid gap-1.5">
              <span id={id("unit-l")} className="label">
                {E.distanceUnit}
              </span>
              <Segmented<"pct" | "atr"> aria-labelledby={id("unit-l")} size="md" className="justify-self-start" value={f.distMode} onChange={(v) => set("distMode", v)} options={[{ v: "pct", label: "% vom Level" }, { v: "atr", label: "× ATR(14)" }]} />
            </div>
          </>
        )}

        <Field label={E.invalidation} htmlFor={id("inv")} help={E.invalidationHelp} error={errors.invalidation} invalidKey={errors.invalidation ? shake : null}>
          <Input id={id("inv")} numeric value={f.invalidation} invalid={!!errors.invalidation} onChange={(e) => set("invalidation", e.target.value)} autoComplete="off" />
        </Field>
        <div className="grid gap-1.5">
          <span id={id("prio-l")} className="label">
            {E.priority}
          </span>
          <Segmented<string> aria-labelledby={id("prio-l")} size="md" className="justify-self-start" value={String(f.priority)} onChange={(v) => set("priority", Number(v))} options={PRIORITY_OPTIONS} />
          <span className="text-[11px] text-faint">{E.priorityHelp}</span>
        </div>
        <Field label={E.role} htmlFor={id("role")} help={ROLE_HELP}>
          <MorphSelect id={id("role")} value={f.role} onChange={(v) => set("role", v)} options={ROLE_OPTIONS} />
        </Field>
        <Field label={E.note} htmlFor={id("note")}>
          <Input id={id("note")} value={f.note} maxLength={280} onChange={(e) => set("note", e.target.value)} autoComplete="off" />
        </Field>
      </div>

      <fieldset className="grid gap-3 rounded-xl border border-line bg-ink-950/40 p-3">
        <legend className="sr-only">{E.alerts}</legend>
        <div className="flex items-start justify-between gap-4">
          <span className="grid gap-0.5">
            <label htmlFor={id("al")} className="cursor-pointer text-[13px] text-fg">
              {E.alerts}
            </label>
            <span id={id("al-h")} className="text-[11px] text-faint">
              {E.alertsHelp}
            </span>
          </span>
          <Switch id={id("al")} checked={f.alertsOn} onCheckedChange={(v) => set("alertsOn", v)} aria-describedby={id("al-h")} className="touch-hit mt-0.5 shrink-0" />
        </div>
        {f.alertsOn && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <span className="label">{E.stages}</span>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label={E.stages}>
                {STAGES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    role="checkbox"
                    aria-checked={f[s]}
                    title={STAGE_HELP[s]}
                    onClick={() => set(s, !f[s])}
                    className={cn(
                      "touch-hit inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] transition-colors duration-200",
                      f[s] ? "border-white/40 bg-white/[0.08] text-fg" : "border-line-2 text-mute hover:border-white/30",
                    )}
                  >
                    <span aria-hidden="true">{f[s] ? "✓" : "○"}</span>
                    {STAGE_LABEL[s]}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid gap-1.5">
              <span id={id("mode-l")} className="label">
                {E.mode}
              </span>
              <Segmented<"once" | "recurring">
                aria-labelledby={id("mode-l")}
                size="md"
                className="justify-self-start"
                value={f.recurring ? "recurring" : "once"}
                onChange={(v) => set("recurring", v === "recurring")}
                options={[{ v: "once", label: E.once }, { v: "recurring", label: E.recurring }]}
              />
              <span className="text-[11px] text-faint">{f.recurring ? E.recurringHelp : E.onceHelp}</span>
            </div>
          </div>
        )}
      </fieldset>

      <div className="flex flex-wrap justify-end gap-x-2 gap-y-3.5">
        <Button variant="secondary" onClick={onCancel}>
          {E.cancel}
        </Button>
        <Button type="submit" variant="primary" disabled={!sym} data-testid="keylevel-save">
          {E.save}
        </Button>
      </div>
    </form>
  );
}
