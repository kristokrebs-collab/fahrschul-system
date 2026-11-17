/**
 * Schritt 3 · Größe: whole units inside four limits – the loss you accept, the cap on one position, the buying power and the
 * rest of today's loss limit. The smallest wins, and the card says which one binds. A stop that is too far for the risk is a plain
 * refusal, never a quietly smaller order.
 */
import { LIMIT_LABEL, moneyText, num, pctText, priceText, qtyText, unitOf, type LimitRow } from "@/domain/plan";
import { Badge } from "@/primitives/Badge";
import { Segmented } from "@/primitives/Segmented";
import { cn } from "@/lib/cn";
import { savePrefs } from "./actions";
import { usePlanForm } from "./planStore";
import { ChipPick, FieldRow, Kpi, NumInput, StepCard } from "./ui";
import { useStand } from "./EntryStep";
import type { PlanVm } from "./usePlanModel";

const RISK_CHOICES = [0.005, 0.01, 0.02];

function Limits({ rows, lot, base, empty }: { rows: readonly LimitRow[]; lot: number; base: string; empty?: boolean }) {
  return (
    <ul className="grid gap-2" data-testid="hplan-limits" aria-label="Die vier Grenzen">
      {rows.map((r) => (
        <li key={r.key} className={cn("grid gap-1 rounded-xl border px-3 py-2.5", r.binding && !empty ? "border-white/30 bg-white/[0.05]" : "border-line bg-ink-950/50")} data-testid={`hplan-limit-${r.key}`} data-binding={r.binding && !empty ? "true" : undefined}>
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <span className="text-[13px] font-medium text-fg">{LIMIT_LABEL[r.key]}</span>
            <span className="flex items-center gap-2">
              {r.binding && !empty && <Badge tone="steel">bindet</Badge>}
              <span className="num font-mono text-[13px] text-fg">{r.rounded == null ? "–" : `${qtyText(r.rounded, lot)} ${base}`}</span>
            </span>
          </div>
          <p className="text-[12px] leading-snug text-mute [overflow-wrap:anywhere]">{r.detail}</p>
        </li>
      ))}
    </ul>
  );
}

export function SizeStep({ vm }: { vm: PlanVm }) {
  const { form, model, limits, capital, currency, prefs } = vm;
  const set = usePlanForm((s) => s.set);
  const step = model.steps[2]!;
  const stand = useStand(vm);
  const size = model.size;
  const stocks = model.market === "stocks";
  const base = unitOf(model.market, form.symbol);
  const rule = limits.leverageRule[form.account];
  const risk = model.riskPct;
  const M = (x: number): string => `${moneyText(x)} ${currency}`;

  let headline: string;
  if (!size) headline = "Wartet auf Schritt 2: ohne Stop und Ziel gibt es keine Größe.";
  else if (!size.ok) headline = "Abgelehnt: So lässt sich keine Position planen.";
  else headline = `${qtyText(size.qty, model.lot)} ${base} für ${M(size.notional)}; am Stop gehen höchstens ${M(size.maxLoss)} verloren.`;

  const levChoices = Array.from({ length: Math.max(1, Math.floor(rule)) }, (_, i) => i + 1);
  return (
    <StepCard id="size" n={3} title="Größe" lead="Ganze Einheiten innerhalb deiner Grenzen – die kleinste Menge gewinnt." status={step.status} current={step.current} headline={headline} assumed={model.assumptions.size} stand={stand}>
      <div className="grid gap-4" data-testid="hplan-size-controls">
        <div className="grid gap-4 sm:grid-cols-2">
          <FieldRow label="Konto" hint={`${M(capital)} Startkapital`}>
            <Segmented
              aria-label="Konto"
              options={[
                { v: "scalp" as const, label: "Scalp" },
                { v: "makro" as const, label: "Makro" },
              ]}
              value={form.account}
              onChange={(v) => set({ account: v })}
            />
          </FieldRow>
          {stocks ? (
            <FieldRow label="Hebel" hint="Aktien werden ohne Hebel gerechnet. Margin und Leerverkauf prüft die App nicht.">
              <p className="num text-[13px] text-fg" data-testid="hplan-no-leverage">
                1× – nur eigenes Geld
              </p>
            </FieldRow>
          ) : (
            <FieldRow label="Hebel" hint={`Regel des Kontos: bis ${rule}×. 1× heißt: nur eigenes Geld.`}>
              <ChipPick id="plan-lev" label="Hebel" value={form.leverage} options={levChoices.map((l) => ({ v: l, label: `${l}×` }))} onChange={(v) => set({ leverage: v })} />
            </FieldRow>
          )}
        </div>
        <FieldRow label="Risiko pro Trade" hint={`Dein Limit pro Trade: ${pctText(limits.maxLossTradePct, 2)} des Kontos.`}>
          <div className="grid gap-2 sm:grid-cols-[auto_1fr] sm:items-end">
            <ChipPick id="plan-risk" label="Risiko pro Trade" value={RISK_CHOICES.find((r) => Math.abs(r - risk) < 1e-9) ?? -1} options={RISK_CHOICES.map((r) => ({ v: r, label: pctText(r, 1) }))} onChange={(v) => set({ riskPct: v })} />
            <NumInput label="Oder eigenes Risiko" suffix="%" value={Math.round(risk * 10000) / 100} onCommit={(v) => set({ riskPct: v == null ? null : v / 100 })} min={0.01} max={100} testId="hplan-risk-pct" className="sm:max-w-40" />
          </div>
        </FieldRow>

        <details className="rounded-xl border border-line bg-ink-950/40 px-3 py-2" data-testid="hplan-size-more">
          <summary className="cursor-pointer select-none text-[12.5px] font-medium text-mute pointer-coarse:min-h-11 pointer-coarse:py-2">Mehr: Deckel, Cash-Puffer, Mengenschritt und Kursschritt</summary>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <NumInput label="Deckel für eine Position" suffix="% des Kontos" value={Math.round(prefs.maxPositionPct * 10000) / 100} onCommit={(v) => v != null && void savePrefs({ maxPositionPct: v / 100 })} min={1} max={1000} testId="hplan-pref-cap" help="Der Positionswert darf nicht mehr als diesen Anteil des Kontos sein." />
            <NumInput label="Cash-Puffer" suffix="% des Kontos" value={Math.round(prefs.cashBufferPct * 10000) / 100} onCommit={(v) => v != null && void savePrefs({ cashBufferPct: v / 100 })} min={0} max={90} testId="hplan-pref-buffer" help="Dieser Anteil bleibt immer frei; die Kaufkraft rechnet ohne ihn." />
            <NumInput label="Kleinster Positionswert" suffix={currency} value={prefs.minOrderValue} onCommit={(v) => v != null && void savePrefs({ minOrderValue: v })} min={0} max={1e9} testId="hplan-pref-min" />
            <NumInput label="Mengenschritt" value={form.lot} onCommit={(v) => set({ lot: v })} min={0.00000001} placeholder={String(model.lot).replace(".", ",")} help={stocks ? `Aktien gibt es in ganzen Stück (1). Bietet dein Broker Bruchstücke an, trage den Schritt ein (zum Beispiel 0,01). Es wird immer abgerundet. Leer = ${String(model.lot).replace(".", ",")}.` : `Die kleinste Menge, die deine Börse zulässt (Krypto oft 0,001, Aktien 1). Es wird immer abgerundet. Leer = ${String(model.lot).replace(".", ",")}.`} testId="hplan-lot" />
            <NumInput label="Kursschritt" value={form.tick} onCommit={(v) => set({ tick: v })} min={0.00000001} placeholder={priceText(model.tick, model.tick)} help={`Aktuell ${priceText(model.tick, model.tick)} (${model.tickSource}). Stop und Ziel runden darauf.`} testId="hplan-tick" />
          </div>
          <p className="mt-3 text-[11.5px] leading-snug text-mute">Gebühren und Slippage kommen aus den Risiko-Einstellungen. Deckel, Cash-Puffer, Mengen- und Kursschritt gelten für alle deine Pläne; sie werden mit deinen Einstellungen gespeichert.</p>
        </details>
      </div>

      {size && (
        <div className="grid gap-3" data-testid="hplan-size-result" data-ok={size.ok ? "true" : "false"}>
          {size.ok && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="hplan-size-kpis">
              <Kpi label="Größe" sub={base}>
                <span data-testid="hplan-qty">{qtyText(size.qty, model.lot)}</span>
              </Kpi>
              <Kpi label="Positionswert" sub={`${num(size.neededLeverage, 2)}× das Konto`}>
                {M(size.notional)}
              </Kpi>
              <Kpi label="Verlust am Stop" sub={`${pctText(size.riskOfCapital, 2)} des Kontos`} tone="text-loss">
                <span data-testid="hplan-maxloss">{M(size.maxLoss)}</span>
              </Kpi>
              <Kpi label="davon Kosten" sub="Gebühren + Slippage">
                {M(size.fees + size.slippage)}
              </Kpi>
            </div>
          )}
          {size.ok && (
            <p className="text-[13px] leading-snug text-fg/90" data-testid="hplan-binding">
              {size.headline}
            </p>
          )}
          {!size.ok && (
            <p className="rounded-xl border border-loss/30 bg-loss/[0.06] px-3 py-2 text-[12.5px] leading-snug text-fg/90" role="status" data-testid="hplan-size-refused" data-code={size.code}>
              Grund: {size.reason}
            </p>
          )}
          <Limits rows={size.rows} lot={model.lot} base={base} empty={!size.ok} />
        </div>
      )}
    </StepCard>
  );
}
