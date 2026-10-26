/**
 * Verwaltung nach dem Einstieg (F65): Break-even, Teilziel und Trailing-Stop PLANEN – im Handelsplan (Schritt 2) und im Positionsrechner
 * der Risiko-Seite. Die Regeln sind die des Backtests (`ManageSpec` = `ExitsCfg`), die Preise und Beispielrechnungen kommen aus
 * `managePlan` (rein, Handrechnung in `tests/unit/plan.manage.test.ts`). Die Karte ändert nichts am Markt: sie schreibt eine Anweisung an
 * dich selbst, die App sendet nie eine Order und ändert nie eine echte.
 *
 * Die Wirt-Seiten besitzen den Zustand (`spec` / `onChange`) und rechnen das Ergebnis; die Karte zeigt und fragt.
 */
import { useId } from "react";
import { manageActive, moneyText, num, type ManageResult, type ManageSpec } from "@/domain/plan";
import { cn } from "@/lib/cn";
import { Collapse } from "@/primitives/Expander";
import { CheckboxRow } from "@/primitives/CheckboxRow";
import { ChipPick, FieldRow } from "@/views/labor/ui";
import { NumInput } from "./ui";

export interface ManageCardProps {
  spec: ManageSpec;
  onChange: (next: ManageSpec) => void;
  /** `null` = no result yet (see `waiting`) */
  result: ManageResult | null;
  /** why there is no result yet, in a sentence */
  waiting: string;
  /** prefix of the test ids (`hplan`, `risk`) */
  testPrefix: string;
  /** more lines for "Annahmen und Grenzen" (what the host assumed) */
  extraAssumptions?: readonly string[];
  className?: string;
}

const money = (x: number, cur: string): string => `${x > 0 ? "+" : x < 0 ? "−" : ""}${moneyText(Math.abs(x))} ${cur}`;
const rTxt = (r: number): string => `${r > 0 ? "+" : r < 0 ? "−" : ""}${num(Math.abs(r), 2)} R`;

export function ManageCard({ spec, onChange, result, waiting, testPrefix, extraAssumptions = [], className }: ManageCardProps) {
  const uid = useId();
  const p = testPrefix;
  const active = manageActive(spec);
  const set = (patch: Partial<ManageSpec>): void => onChange({ ...spec, ...patch });
  const be = spec.breakEven;
  const pa = spec.partial;
  const tr = spec.trail;

  return (
    <section className={cn("grid gap-3 rounded-xl border border-line bg-ink-950/40 p-3 sm:p-4", className)} aria-labelledby={`${uid}-h`} data-testid={`${p}-manage`} data-active={active ? "true" : "false"}>
      <header className="grid gap-0.5">
        <h3 id={`${uid}-h`} className="text-[14px] font-semibold tracking-tight">
          Verwaltung nach dem Einstieg
        </h3>
        <p className="text-[12.5px] leading-snug text-mute">Optional: den Stop nachziehen oder einen Teil mitnehmen – jetzt geplant, später von dir selbst gesetzt. Die App ändert nie eine echte Order.</p>
      </header>

      <div className="grid gap-2" data-testid={`${p}-manage-rules`}>
        <CheckboxRow checked={be.on} onToggle={() => set({ breakEven: { ...be, on: !be.on } })} sub="Nach einem Kursgewinn rückt der Stop auf den Einstieg oder auf Netto-Break-even.">
          Break-even
        </CheckboxRow>
        <Collapse open={be.on} id={`${uid}-be`}>
          <div className="grid gap-3 pb-1 pl-1 pt-2 sm:grid-cols-2" data-testid={`${p}-manage-be`}>
            <div className="flex flex-wrap items-end gap-2">
              <NumInput label="Auslöser: Kurs läuft um" value={be.value} onCommit={(v) => v != null && set({ breakEven: { ...be, value: v } })} min={be.trigger === "r" ? 0.2 : 0.1} max={be.trigger === "r" ? 10 : 50} suffix={be.trigger === "r" ? "R" : "%"} testId={`${p}-manage-be-value`} className="w-36" />
              <FieldRow label="Einheit">
                <ChipPick id={`${uid}-be-trig`} label="Break-even: Einheit des Auslösers" value={be.trigger} options={[{ v: "r", label: "R" }, { v: "pct", label: "%" }]} onChange={(trigger) => set({ breakEven: { ...be, trigger, value: trigger === "r" ? 1 : 2 } })} />
              </FieldRow>
            </div>
            <FieldRow label="Der Stop wandert">
              <ChipPick id={`${uid}-be-to`} label="Break-even: Ziel des Stops" value={be.to} options={[{ v: "entry", label: "auf den Einstieg" }, { v: "net", label: "auf Netto-Break-even" }]} onChange={(to) => set({ breakEven: { ...be, to } })} />
            </FieldRow>
          </div>
        </Collapse>

        <CheckboxRow checked={pa.on} onToggle={() => set({ partial: { ...pa, on: !pa.on } })} sub="Ein Teil der Position wird bei einem näheren Kurs mit Limit-Order verkauft.">
          Teilziel
        </CheckboxRow>
        <Collapse open={pa.on} id={`${uid}-pa`}>
          <div className="grid gap-3 pb-1 pl-1 pt-2 sm:grid-cols-2" data-testid={`${p}-manage-pa`}>
            <NumInput label="Teilziel bei" value={pa.atR} onCommit={(v) => v != null && set({ partial: { ...pa, atR: v } })} min={0.2} max={10} suffix="R" testId={`${p}-manage-pa-r`} help="Vielfaches deines Anfangsrisikos; muss vor dem Ziel liegen." />
            <NumInput label="Anteil der Position" value={pa.fracPct} onCommit={(v) => v != null && set({ partial: { ...pa, fracPct: Math.round(v) } })} min={5} max={95} suffix="%" testId={`${p}-manage-pa-frac`} />
            <CheckboxRow checked={pa.thenBreakEven} onToggle={() => set({ partial: { ...pa, thenBreakEven: !pa.thenBreakEven } })} className="sm:col-span-2">
              Danach den Stop auf Break-even setzen
            </CheckboxRow>
          </div>
        </Collapse>

        <CheckboxRow checked={tr.on} onToggle={() => set({ trail: { ...tr, on: !tr.on } })} sub="Der Stop folgt dem besten Kurs mit Abstand – nur in Gewinnrichtung.">
          Trailing-Stop
        </CheckboxRow>
        <Collapse open={tr.on} id={`${uid}-tr`}>
          <div className="grid gap-3 pb-1 pl-1 pt-2 sm:grid-cols-2" data-testid={`${p}-manage-tr`}>
            <div className="flex flex-wrap items-end gap-2">
              <NumInput label="Abstand hinter dem besten Kurs" value={tr.value} onCommit={(v) => v != null && set({ trail: { ...tr, value: v } })} min={tr.kind === "atr" ? 0.5 : 0.2} max={tr.kind === "atr" ? 10 : 30} suffix={tr.kind === "atr" ? "× ATR" : "%"} testId={`${p}-manage-tr-value`} className="w-40" />
              <FieldRow label="Art">
                <ChipPick id={`${uid}-tr-kind`} label="Trailing: Art des Abstands" value={tr.kind} options={[{ v: "atr", label: "× ATR" }, { v: "pct", label: "%" }]} onChange={(kind) => set({ trail: { ...tr, kind, value: kind === "atr" ? 2 : 3 } })} />
              </FieldRow>
            </div>
            <NumInput label="Trailing startet ab" value={tr.activateR} onCommit={(v) => v != null && set({ trail: { ...tr, activateR: v } })} min={0} max={10} suffix="R" testId={`${p}-manage-tr-from`} help="0 = ab der ersten Kerze." />
          </div>
        </Collapse>
      </div>

      {!active && (
        <p className="text-[12.5px] leading-snug text-mute" data-testid={`${p}-manage-off`}>
          Keine Verwaltung geplant: der erste Stop und das Ziel gelten bis zum Ende des Trades.
        </p>
      )}
      {active && !result && (
        <p className="text-[12.5px] leading-snug text-mute" role="status" data-testid={`${p}-manage-wait`}>
          {waiting}
        </p>
      )}
      {active && result && !result.ok && (
        <p className="rounded-xl border border-loss/30 bg-loss/[0.06] px-3 py-2 text-[12.5px] leading-snug" role="status" data-testid={`${p}-manage-refused`}>
          Grund: {result.reason}
        </p>
      )}
      {active && result?.ok && (
        <div className="grid gap-4" data-testid={`${p}-manage-result`}>
          <div className="grid gap-2">
            <h4 className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-mute">Dein Ablauf</h4>
            <ol className="grid gap-2" data-testid={`${p}-manage-steps`}>
              {result.steps.map((s, i) => (
                <li key={s.id} className={cn("grid gap-0.5 rounded-xl border px-3 py-2.5", s.never ? "border-warn/30 bg-warn/[0.06]" : "border-line bg-ink-950/50")} data-step={s.id} data-never={s.never ? "true" : "false"}>
                  <span className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-mute">
                    {i + 1} · {s.title}
                    {s.never ? " · greift nie" : ""}
                  </span>
                  <span className="num text-[12.5px] leading-snug text-mute [overflow-wrap:anywhere]">{s.when}</span>
                  <span className="num text-[13px] leading-snug text-fg [overflow-wrap:anywhere]">→ {s.then}</span>
                </li>
              ))}
            </ol>
          </div>

          {result.scenarios.length > 0 && (
            <div className="grid gap-2">
              <h4 className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-mute">Beispielrechnungen einzelner Wege</h4>
              <ul className="grid gap-px overflow-hidden rounded-xl border border-line bg-line" data-testid={`${p}-manage-scenarios`}>
                {result.scenarios.map((s) => (
                  <li key={s.id} className="grid gap-0.5 bg-ink-950/70 px-3 py-2 sm:grid-cols-[1fr_auto] sm:items-baseline sm:gap-4" data-scenario={s.id}>
                    <span className="grid min-w-0">
                      <span className="text-[12.5px] font-medium text-fg">{s.label}</span>
                      <span className="num text-[11.5px] leading-snug text-mute [overflow-wrap:anywhere]">{s.detail}</span>
                    </span>
                    <span className={cn("num whitespace-nowrap font-mono text-[13px]", s.pnl > 0 ? "text-win" : s.pnl < 0 ? "text-loss" : "text-fg")} data-testid={`${p}-manage-pnl-${s.id}`}>
                      {money(s.pnl, result.currency)} · {rTxt(s.r)}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="text-[11.5px] leading-snug text-mute">Rechenbeispiele für einzelne Kursverläufe nach Gebühren und Slippage – keine Prognose, welcher Weg eintritt.</p>
            </div>
          )}

          {result.notes.some((n) => n.level === "warn") && (
            <ul className="grid gap-1.5" data-testid={`${p}-manage-warnings`}>
              {result.notes
                .filter((n) => n.level === "warn")
                .map((n) => (
                  <li key={n.key} className="flex gap-2 rounded-xl border border-warn/25 bg-warn/[0.06] px-3 py-2 text-[12.5px] leading-snug text-fg/90" data-note={n.key}>
                    <span aria-hidden="true" className="mt-[6px] size-1.5 shrink-0 rounded-full bg-warn" />
                    {n.text}
                  </li>
                ))}
            </ul>
          )}

          <details className="rounded-xl border border-line bg-ink-950/40 px-3 py-2" data-testid={`${p}-manage-assumed`}>
            <summary className="cursor-pointer select-none text-[12.5px] font-medium text-mute pointer-coarse:min-h-11 pointer-coarse:py-2">Annahmen und Grenzen</summary>
            <ul className="mt-2 grid gap-1.5">
              {[...result.assumptions, ...extraAssumptions, ...result.notes.filter((n) => n.level === "info").map((n) => n.text)].map((t) => (
                <li key={t} className="flex gap-2 text-[12px] leading-snug text-mute">
                  <span aria-hidden="true" className="mt-[7px] size-1 shrink-0 rounded-full bg-faint-line" />
                  <span className="min-w-0 [overflow-wrap:anywhere]">{t}</span>
                </li>
              ))}
            </ul>
          </details>
        </div>
      )}
    </section>
  );
}
