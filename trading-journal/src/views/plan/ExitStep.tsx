/**
 * Schritt 2 · Ausstieg: where the idea has failed (stop) and where to take what you came for (target) – decided BEFORE the entry.
 * The rules are the ones of the skill trader-exit; a refused plan says why and how to fix it, nothing is bent to make it pass.
 */
import { useMemo, useState } from "react";
import { SeeAlso } from "@/app/FeatureLinks";
import { allKeyLevels } from "@/domain/keylevels";
import { clockIn, num, parseHHMM, pctText, priceText, rText, toStep, type StopRule, type TargetRule } from "@/domain/plan";
import { Input } from "@/primitives/Input";
import { useJournal } from "@/store/journalStore";
import { usePlanForm } from "./planStore";
import { ManageCard } from "./ManageCard";
import { ChipPick, FieldRow, Kpi, NumInput, StepCard } from "./ui";
import { useStand } from "./EntryStep";
import type { PlanVm } from "./usePlanModel";

type StopKind = StopRule["kind"];
type TargetKind = TargetRule["kind"];
const R_CHOICES = [1, 1.5, 2, 3];

/** A clock-time field that commits a valid `HH:MM` (or empty) when it is left. */
function ClockInput({ value, onCommit, placeholder }: { value: string | null; onCommit: (v: string | null) => void; placeholder: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [bad, setBad] = useState(false);
  const shown = draft ?? value ?? "";
  const commit = (): void => {
    if (draft == null) return;
    const t = draft.trim();
    if (!t) {
      setDraft(null);
      setBad(false);
      onCommit(null);
    } else if (parseHHMM(t) == null) setBad(true);
    else {
      setBad(false);
      setDraft(null);
      onCommit(t);
    }
  };
  return (
    <div className="grid min-w-0 gap-1.5">
      <label htmlFor="plan-flatby" className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-mute">
        Flat by (Uhrzeit)
      </label>
      <Input
        id="plan-flatby"
        value={shown}
        placeholder={placeholder}
        invalid={bad}
        aria-invalid={bad || undefined}
        aria-describedby="plan-flatby-help"
        inputMode="numeric"
        data-testid="hplan-flatby"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
        }}
      />
      <span id="plan-flatby-help" className={bad ? "text-[11.5px] text-loss" : "text-[11.5px] leading-snug text-mute"} role={bad ? "alert" : undefined}>
        {bad ? "Bitte eine Uhrzeit wie 15:55 eingeben." : "Ortszeit der Sitzung. Bis dahin bist du draußen, ob Gewinn oder Verlust. Leer = fünf Minuten vor dem Ende."}
      </span>
    </div>
  );
}

export function ExitStep({ vm }: { vm: PlanVm }) {
  const { form, model } = vm;
  const set = usePlanForm((s) => s.set);
  const settings = useJournal((s) => s.settings);
  const step = model.steps[1]!;
  const stand = useStand(vm);
  const exit = model.exit;
  const side = model.side ?? form.manualSide;
  const P = (x: number): string => priceText(x, model.tick);
  const entry = model.entryPrice;

  const levels = useMemo(() => {
    if (entry == null) return [];
    return allKeyLevels(settings)
      .filter((l) => l.enabled && l.symbol === form.symbol && (side === "long" ? l.price > entry : l.price < entry))
      .sort((a, b) => Math.abs(a.price - entry) - Math.abs(b.price - entry))
      .slice(0, 8);
  }, [settings, form.symbol, entry, side]);

  const pickStop = (k: StopKind): void => {
    const rule: StopRule =
      k === "atr"
        ? { kind: "atr", mult: 1.5 }
        : k === "pct"
          ? { kind: "pct", pct: 1 }
          : k === "price"
            ? { kind: "price", price: exit?.ok ? exit.stop : toStep((entry ?? 100) * (side === "long" ? 0.99 : 1.01), model.tick, side === "long" ? "floor" : "ceil") }
            : { kind: k };
    set({ stop: rule });
  };
  const pickTarget = (k: TargetKind): void => {
    const rule: TargetRule =
      k === "r"
        ? { kind: "r", r: 2 }
        : k === "range-projection"
          ? { kind: "range-projection", mult: 1 }
          : k === "price"
            ? { kind: "price", price: exit?.ok ? exit.target : toStep((entry ?? 100) * (side === "long" ? 1.02 : 0.98), model.tick, "nearest-away", side === "long" ? 1 : -1) }
            : { kind: "level", price: levels[0]?.price ?? entry ?? 100, name: levels[0]?.name ?? "Schlüsselmarke" };
    set({ target: rule });
  };

  let headline: string;
  if (!exit) headline = "Wartet auf Schritt 1: ohne Einstieg gibt es weder Stop noch Ziel.";
  else if (!exit.ok) headline = "Abgelehnt: So lässt sich der Ausstieg nicht planen.";
  else headline = `Stop ${P(exit.stop)}, Ziel ${P(exit.target)}: ${P(exit.risk)} Risiko (${pctText(exit.riskPct, 2)}) je Einheit, Chance-Risiko ${num(exit.rr, 2)} : 1.`;

  const stopRule = form.stop;
  const targetRule = form.target;
  return (
    <StepCard id="exit" n={2} title="Ausstieg" lead="Stop und Ziel stehen fest, bevor du einsteigst – ein Stop ist ein Plan, keine Garantie." status={step.status} current={step.current} headline={headline} assumed={model.assumptions.exit} stand={stand}>
      <div className="grid gap-4" data-testid="hplan-exit-controls">
        <FieldRow label="Stop">
          <ChipPick
            id="plan-stop"
            label="Stop-Regel"
            value={stopRule.kind}
            options={[
              { v: "range-mid" as StopKind, label: "Range-Mitte" },
              { v: "range-far" as StopKind, label: side === "long" ? "Range-Tief" : "Range-Hoch" },
              { v: "atr" as StopKind, label: "ATR" },
              { v: "pct" as StopKind, label: "Prozent" },
              { v: "price" as StopKind, label: "Eigener Preis" },
            ]}
            onChange={pickStop}
          />
          {stopRule.kind === "atr" && <NumInput label="ATR-Faktor" suffix="× ATR" value={stopRule.mult} onCommit={(v) => v != null && set({ stop: { kind: "atr", mult: v } })} min={0.1} max={20} testId="hplan-stop-atr" help={model.atr ? `ATR jetzt ${P(model.atr.value)} (${model.atr.bars} Kerzen).` : "Noch zu wenige Kerzen für eine ATR."} />}
          {stopRule.kind === "pct" && <NumInput label="Abstand zum Einstieg" suffix="%" value={stopRule.pct} onCommit={(v) => v != null && set({ stop: { kind: "pct", pct: v } })} min={0.01} max={99} testId="hplan-stop-pct" />}
          {stopRule.kind === "price" && <NumInput label="Stop-Preis" value={stopRule.price} onCommit={(v) => v != null && set({ stop: { kind: "price", price: v } })} min={0.0000001} testId="hplan-stop-price" help="Wird vom Einstieg weg auf den Kursschritt gerundet." />}
        </FieldRow>

        <FieldRow label="Ziel">
          <ChipPick
            id="plan-target"
            label="Ziel-Regel"
            value={targetRule.kind}
            options={[
              { v: "r" as TargetKind, label: "R-Vielfaches" },
              { v: "range-projection" as TargetKind, label: "Range-Projektion" },
              { v: "level" as TargetKind, label: "Schlüsselmarke" },
              { v: "price" as TargetKind, label: "Eigener Preis" },
            ]}
            onChange={pickTarget}
          />
          {targetRule.kind === "r" && (
            <div className="grid gap-2 sm:grid-cols-[auto_1fr] sm:items-end">
              <ChipPick id="plan-r" label="Vielfaches des Risikos" value={R_CHOICES.includes(targetRule.r) ? targetRule.r : -1} options={R_CHOICES.map((r) => ({ v: r, label: rText(r) }))} onChange={(r) => set({ target: { kind: "r", r } })} />
              <NumInput label="Oder eigenes Vielfaches" suffix="R" value={targetRule.r} onCommit={(v) => v != null && set({ target: { kind: "r", r: v } })} min={0.1} max={50} testId="hplan-target-r" className="sm:max-w-40" />
            </div>
          )}
          {targetRule.kind === "range-projection" && <NumInput label="Faktor der Range-Höhe" suffix="×" value={targetRule.mult} onCommit={(v) => v != null && set({ target: { kind: "range-projection", mult: v } })} min={0.1} max={20} testId="hplan-target-proj" help="Die Höhe der Range, vom durchbrochenen Rand aus in Richtung des Trades abgetragen." />}
          {targetRule.kind === "price" && <NumInput label="Ziel-Preis" value={targetRule.price} onCommit={(v) => v != null && set({ target: { kind: "price", price: v } })} min={0.0000001} testId="hplan-target-price" />}
          {targetRule.kind === "level" &&
            (levels.length ? (
              <ChipPick
                id="plan-level"
                label="Schlüsselmarke als Ziel"
                value={levels.find((l) => l.price === targetRule.price && l.name === targetRule.name)?.id ?? ""}
                options={levels.map((l) => ({ v: l.id, label: `${l.name} · ${P(l.price)}` }))}
                onChange={(id) => {
                  const l = levels.find((x) => x.id === id);
                  if (l) set({ target: { kind: "level", price: l.price, name: l.name } });
                }}
              />
            ) : (
              <p className="text-[12.5px] leading-snug text-mute" data-testid="hplan-no-levels">
                {entry == null
                  ? "Ohne Einstieg lässt sich keine Marke einordnen."
                  : model.market === "stocks"
                    ? "Schlüsselmarken gibt es nur für den Live-Markt (Krypto); für Aktien wähle eine andere Regel."
                    : `Keine eigene Schlüsselmarke für ${form.symbol} ${side === "long" ? "über" : "unter"} dem Einstieg. Lege eine auf der Markt-Seite an oder wähle eine andere Regel.`}
              </p>
            ))}
        </FieldRow>

        <ClockInput value={form.flatBy} onCommit={(v) => set({ flatBy: v })} placeholder={clockIn(model.flatByMs, model.session.tz)} />
      </div>

      {exit?.ok && (
        <div className="grid gap-3" data-testid="hplan-exit-result">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" data-testid="hplan-levels">
            <Kpi label="Einstieg">{P(exit.entry)}</Kpi>
            <Kpi label="Stop" tone="text-loss" sub={exit.stopLabel}>
              <span data-testid="hplan-stop">{P(exit.stop)}</span>
            </Kpi>
            <Kpi label="Ziel" tone="text-win" sub={exit.targetLabel}>
              <span data-testid="hplan-target">{P(exit.target)}</span>
            </Kpi>
            <Kpi label="Risiko je Einheit" sub={pctText(exit.riskPct, 2)}>
              {P(exit.risk)}
            </Kpi>
            <Kpi label="Chance-Risiko">
              <span data-testid="hplan-rr">{num(exit.rr, 2)} : 1</span>
            </Kpi>
            <Kpi label="Flat by" sub={model.session.zone}>
              {clockIn(model.flatByMs, model.session.tz)} Uhr
            </Kpi>
          </div>
          {(exit.stopDetail || exit.targetDetail) && (
            <p className="num text-[12px] leading-snug text-mute" data-testid="hplan-exit-detail">
              {[exit.stopDetail && `Stop: ${exit.stopDetail}.`, exit.targetDetail && `Ziel: ${exit.targetDetail}.`].filter(Boolean).join(" ")}
            </p>
          )}
          {exit.hints.length > 0 && (
            <ul className="grid gap-1.5" data-testid="hplan-exit-hints">
              {exit.hints.map((h) => (
                <li key={h.key} className="flex gap-2 rounded-xl border border-warn/25 bg-warn/[0.06] px-3 py-2 text-[12.5px] leading-snug text-fg/90" data-hint={h.key}>
                  <span aria-hidden="true" className="mt-[6px] size-1.5 shrink-0 rounded-full bg-warn" />
                  {h.text}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {exit?.ok && (
        <>
          <ManageCard
            spec={form.manage}
            onChange={(manage) => set({ manage })}
            result={model.manage}
            waiting={model.size == null ? "Die Preise und Beispielrechnungen erscheinen, sobald Schritt 3 die Größe berechnet hat." : "Schritt 3 hat keine Größe berechnet – ohne Menge gibt es keine Beispielrechnung."}
            testPrefix="hplan"
          />
          <SeeAlso at="plan.exit" />
        </>
      )}
      {exit && !exit.ok && (
        <p className="rounded-xl border border-loss/30 bg-loss/[0.06] px-3 py-2 text-[12.5px] leading-snug text-fg/90" role="status" data-testid="hplan-exit-refused" data-code={exit.code}>
          Grund: {exit.reason} Die App ändert Stop oder Ziel nicht von selbst – du änderst die Regel oben.
        </p>
      )}
    </StepCard>
  );
}
