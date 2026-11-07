/**
 * "Was würde meine These widerlegen?" and the check against the filed numbers. The conditions are thresholds on reported figures
 * ("Umsatzwachstum zum Vorjahresquartal unter 5 %"); the check reads the SEC numbers of the newest quarter and says per condition
 * ausgelöst / nicht ausgelöst / keine Daten, with the number found, the quarter, the filing and the time of the read. When a
 * condition is triggered the panel PROPOSES to look at the thesis again and to save a version – it changes nothing by itself.
 */
import { useId, useState } from "react";
import { dateDe } from "@/domain/analyst";
import { actualText, criterionText, CRITERION_OPS, METRIC_DEFS, MAX_CRITERIA, type Criterion, type CriterionMetric, type CriterionOp, type CriterionStatus, type Thesis, type ThesisPatch } from "@/domain/thesis";
import { cn } from "@/lib/cn";
import { newId } from "@/lib/ids";
import { Badge, type BadgeTone } from "@/primitives/Badge";
import { Button } from "@/primitives/Button";
import { CheckboxRow } from "@/primitives/CheckboxRow";
import { Field } from "@/primitives/Field";
import { inputClass } from "@/primitives/Input";
import type { SecError } from "@/market/sec";
import { SecErrorBox, NumField, Sub, SecStamp } from "./parts";
import { TH } from "./strings";

const STATUS_TONE: Record<CriterionStatus, BadgeTone> = { triggered: "warn", clear: "mute", unknown: "mute" };
const STATUS_TEXT: Record<CriterionStatus, string> = { triggered: TH.triggered, clear: TH.clear, unknown: TH.unknown };

interface Props {
  t: Thesis;
  commit: (patch: ThesisPatch) => void;
  checking: boolean;
  error: SecError | null;
  onCheck: () => void;
  onSeen: () => void;
  onSaveWithCheck: () => void;
}

export function ThesisChecks({ t, commit, checking, error, onCheck, onSeen, onSaveWithCheck }: Props) {
  const mid = useId();
  const oid = useId();
  const [metric, setMetric] = useState<CriterionMetric>("revenueYoY");
  const [op, setOp] = useState<CriterionOp>("<");
  const [value, setValue] = useState<number | null>(null);
  const [fieldKey, setFieldKey] = useState(0);
  const def = METRIC_DEFS.find((m) => m.id === metric)!;
  const results = new Map((t.check?.results ?? []).map((r) => [r.id, r]));
  const triggered = (t.check?.results ?? []).filter((r) => r.status === "triggered").length;
  const full = t.criteria.length >= MAX_CRITERIA;

  const add = (): void => {
    if (value == null || full) return;
    const c: Criterion = { id: newId("c_"), metric, op, value, note: "" };
    commit({ criteria: [...t.criteria, c] });
    setValue(null);
    setFieldKey((k) => k + 1);
  };

  return (
    <section className="grid gap-4" aria-label={TH.criteriaTitle} data-section="thesis-checks" data-testid="thesis-checks">
      <Sub>{TH.criteriaTitle}</Sub>
      <p className="max-w-[78ch] text-[12.5px] leading-relaxed text-mute">{TH.criteriaLead}</p>

      {t.criteria.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line-2 p-3.5 text-[12.5px] text-mute" data-testid="thesis-no-criteria">
          {TH.noCriteria}
        </p>
      ) : (
        <ul className="grid gap-1.5" data-testid="thesis-criteria">
          {t.criteria.map((c) => {
            const r = results.get(c.id);
            return (
              <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-line bg-ink-950/40 px-3 py-2.5 text-[13px]" data-testid="thesis-criterion" data-status={r?.status ?? "unchecked"}>
                <span className="min-w-0 flex-1 basis-56">
                  Widerlegt, wenn {criterionText(c)}
                  {r?.actual != null && <span className="num ml-1.5 font-mono text-[12px] text-mute">(zuletzt {actualText(c.metric, r.actual, t.base.currency)})</span>}
                  {r?.note && <span className="ml-1.5 text-[12px] text-mute">– {r.note}</span>}
                </span>
                {r ? <Badge tone={STATUS_TONE[r.status]} dot={r.status === "triggered"}>{STATUS_TEXT[r.status]}</Badge> : <span className="text-[12px] text-faint">noch nicht geprüft</span>}
                <button type="button" className="touch-hit text-[12px] text-mute underline-offset-2 hover:text-fg hover:underline" aria-label={`Bedingung löschen: ${criterionText(c)}`} onClick={() => commit({ criteria: t.criteria.filter((x) => x.id !== c.id) })}>
                  Löschen
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {!full && (
        <div className="grid gap-3 rounded-xl border border-line bg-ink-950/40 p-3.5" data-testid="thesis-criterion-form">
          <p className="text-[13px] font-semibold">{TH.addCriterion}</p>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
            <Field label={TH.metric} htmlFor={mid}>
              <select id={mid} className={cn(inputClass, "pointer-coarse:min-h-11")} value={metric} onChange={(e) => setMetric(e.target.value as CriterionMetric)} data-testid="thesis-criterion-metric">
                {METRIC_DEFS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={TH.op} htmlFor={oid}>
              <select id={oid} className={cn(inputClass, "pointer-coarse:min-h-11")} value={op} onChange={(e) => setOp(e.target.value as CriterionOp)} data-testid="thesis-criterion-op">
                {CRITERION_OPS.map((o) => (
                  <option key={o} value={o}>
                    {o === "<" ? "unter" : o === "<=" ? "höchstens" : o === ">" ? "über" : "mindestens"}
                  </option>
                ))}
              </select>
            </Field>
            <NumField key={fieldKey} label={`${TH.threshold} (${def.unitText})`} value={value} onCommit={setValue} testId="thesis-criterion-value" />
            <Button size="sm" variant="primary" onClick={add} disabled={value == null} data-testid="thesis-criterion-add">
              {TH.addCriterion}
            </Button>
          </div>
        </div>
      )}

      <div className="grid gap-3 rounded-xl border border-line bg-ink-950/40 p-3.5" data-testid="thesis-monitor">
        <p className="text-[13px] font-semibold">{TH.monitorTitle}</p>
        <p className="text-[12px] leading-relaxed text-mute">{TH.monitorLead}</p>
        {!t.ticker ? (
          <p className="text-[12.5px] text-mute" data-testid="thesis-monitor-noticker">
            Ohne Börsenkürzel kann die App keine Zahlen holen. Trage oben das Kürzel ein.
          </p>
        ) : (
          <>
            <CheckboxRow checked={t.monitoring} onToggle={() => commit({ monitoring: !t.monitoring })} sub="Nur solange die App offen ist; höchstens einmal am Tag je These.">
              {TH.monitorToggle}
            </CheckboxRow>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={onCheck} disabled={checking || t.criteria.length === 0} data-testid="thesis-check-now">
                {checking ? TH.checking : TH.checkNow}
              </Button>
              {t.criteria.length === 0 && <span className="text-[12px] text-mute">Zuerst eine Bedingung anlegen.</span>}
            </div>
            {error && <SecErrorBox error={error} title="Prüfung nicht möglich" testId="thesis-check-error" />}
            {!t.check ? (
              <p className="text-[12.5px] text-mute" data-testid="thesis-check-never">
                {TH.neverChecked}
              </p>
            ) : (
              <div className="grid gap-2" data-testid="thesis-check-result" data-quarter={t.check.quarterEnd ?? ""} data-new={t.check.newQuarter && !t.check.seen ? "1" : "0"}>
                {t.check.newQuarter && !t.check.seen && (
                  <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-warn/30 bg-warn/[0.06] p-3 text-[13px]" data-testid="thesis-new-quarter">
                    <span>{TH.newQuarter(t.check.quarterEnd ? dateDe(t.check.quarterEnd) : "unbekannt")}</span>
                    <Button size="sm" onClick={onSeen}>
                      {TH.seen}
                    </Button>
                  </div>
                )}
                <p className="text-[12.5px] leading-relaxed text-mute" data-testid="thesis-check-stand">
                  Geprüft am {new Date(t.check.at).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })} · Quartal bis {t.check.quarterEnd ? dateDe(t.check.quarterEnd) : "unbekannt"}
                  {t.check.filed ? ` (Meldung vom ${dateDe(t.check.filed)})` : ""}
                  {t.check.url ? (
                    <>
                      {" · "}
                      <a href={t.check.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-fg">
                        Meldung öffnen
                      </a>
                    </>
                  ) : null}
                </p>
                {t.check.sourceUrl && <SecStamp stamp={{ sourceLabel: t.check.source, sourceUrl: t.check.sourceUrl, receivedAt: t.check.fetchedAt, stale: false, cached: false }} testId="thesis-check-source" />}
              </div>
            )}
            {triggered > 0 && (
              <div className="grid gap-2 rounded-xl border border-warn/30 bg-warn/[0.06] p-3.5" role="status" data-testid="thesis-proposal">
                <p className="text-[13px] font-semibold text-warn">{TH.proposalTitle}</p>
                <p className="text-[13px] leading-snug">{TH.proposal(triggered)}</p>
                <div>
                  <Button size="sm" onClick={onSaveWithCheck} data-testid="thesis-save-with-check">
                    {TH.saveWithCheck}
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
