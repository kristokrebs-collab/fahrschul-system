/**
 * Schritt 4 · Risiko-Check: the plan against YOUR limits (Verlust pro Trade, Tageslimit, Trades heute, offenes Risiko, Hebel,
 * Pause …) – a traffic light and the reasons, in words. The numbers are the live limits of the Risiko page. Red is final for this
 * plan: there is no ticket until the plan is changed (smaller, a closer stop, later). Amber is allowed; look at the marked lines.
 */
import type { Light, LineState, RiskLine } from "@/domain/plan";
import { num } from "@/domain/plan";
import { cn } from "@/lib/cn";
import { savePrefs } from "./actions";
import { NumInput, StepCard } from "./ui";
import { useStand } from "./EntryStep";
import type { PlanVm } from "./usePlanModel";

const LIGHT_WORD: Record<Light, string> = { green: "Grün", amber: "Gelb", red: "Rot" };
const ORDER: Record<LineState, number> = { breach: 0, warn: 1, ok: 2 };
const STATE_WORD: Record<LineState, string> = { ok: "in Ordnung", warn: "Achtung", breach: "verletzt" };

/** The three lamps; only the current one is lit. */
export function Ampel({ light }: { light: Light | null }) {
  const lamp = (l: Light, tone: string) => <span key={l} className={cn("size-5 rounded-full border border-white/10 transition-opacity duration-300", tone, light === l ? "opacity-100 shadow-[0_0_14px_currentColor]" : "opacity-20")} />;
  return (
    <span role="img" aria-label={light ? `Ampel: ${LIGHT_WORD[light]}` : "Ampel: noch nicht geprüft"} className="inline-flex items-center gap-1.5 rounded-full border border-line-2 bg-ink-950/70 px-2.5 py-2" data-testid="hplan-ampel" data-light={light ?? "none"}>
      {lamp("red", "bg-loss text-loss")}
      {lamp("amber", "bg-warn text-warn")}
      {lamp("green", "bg-win text-win")}
    </span>
  );
}

function Mark({ state }: { state: LineState }) {
  return state === "ok" ? (
    <svg viewBox="0 0 16 16" className="mt-0.5 size-4 shrink-0 text-win" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3.5 8.5l3 3 6-6.5" />
    </svg>
  ) : state === "warn" ? (
    <svg viewBox="0 0 16 16" className="mt-0.5 size-4 shrink-0 text-warn" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 2.5l6 10.5H2z" />
      <path d="M8 6.5v3M8 11.3v.2" />
    </svg>
  ) : (
    <svg viewBox="0 0 16 16" className="mt-0.5 size-4 shrink-0 text-loss" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}

function Line({ line }: { line: RiskLine }) {
  return (
    <li className={cn("flex gap-2.5 rounded-xl border px-3 py-2.5", line.state === "breach" ? "border-loss/30 bg-loss/[0.06]" : line.state === "warn" ? "border-warn/30 bg-warn/[0.06]" : "border-line bg-ink-950/50")} data-testid={`hplan-risk-${line.key}`} data-state={line.state}>
      <Mark state={line.state} />
      <div className="min-w-0">
        <p className="text-[13px] font-medium leading-snug text-fg [overflow-wrap:anywhere]">
          {line.title}
          <span className="sr-only"> – {STATE_WORD[line.state]}</span>
        </p>
        <p className="text-[12px] leading-snug text-mute [overflow-wrap:anywhere]">{line.detail}</p>
      </div>
    </li>
  );
}

export function RiskStep({ vm }: { vm: PlanVm }) {
  const { model, prefs } = vm;
  const step = model.steps[3]!;
  const stand = useStand(vm);
  const risk = model.risk;
  const headline = risk ? risk.headline : model.size && !model.size.ok ? "Wartet: ohne eine zulässige Größe gibt es nichts zu prüfen." : "Wartet auf Schritt 3: erst wenn Einstieg, Stop, Ziel und Größe stehen, wird geprüft.";
  const lines = risk ? [...risk.lines].sort((a, b) => ORDER[a.state] - ORDER[b.state]) : [];
  return (
    <StepCard id="risk" n={4} title="Risiko-Check" lead="Der Plan gegen deine Grenzen: Ampel und Gründe. Rot ist final für diesen Plan." status={step.status} current={step.current} headline={headline} assumed={model.assumptions.risk} stand={stand}>
      <div className="flex flex-wrap items-center gap-3">
        <Ampel light={risk?.light ?? null} />
        {risk && (
          <p className="text-[clamp(20px,5.4vw,24px)] font-semibold tracking-tight" data-testid="hplan-light-word">
            {LIGHT_WORD[risk.light]}
            <span className="ml-2 text-[13px] font-normal text-mute">
              {risk.counts.breach} verletzt · {risk.counts.warn} Achtung · {risk.counts.ok} in Ordnung
            </span>
          </p>
        )}
      </div>
      {risk && (
        <ul className="grid gap-2" data-testid="hplan-risk-lines" data-light={risk.light}>
          {lines.map((l) => (
            <Line key={l.key} line={l} />
          ))}
        </ul>
      )}
      {risk?.blocked && (
        <p className="rounded-xl border border-loss/30 bg-loss/[0.06] px-3 py-2 text-[12.5px] leading-snug text-fg/90" data-testid="hplan-risk-blocked" role="status">
          Für diesen Plan gibt es kein Ticket. Ändere ihn (kleinere Größe, ein näherer Stop, ein späterer Zeitpunkt) oder lass den Trade aus – die App lockert keine deiner Grenzen.
        </p>
      )}
      <div className="max-w-60">
        <NumInput label="Kleinstes Chance-Risiko" suffix=": 1" value={prefs.minRewardRisk} format={(v) => num(v, v % 1 ? 2 : 0)} onCommit={(v) => v != null && void savePrefs({ minRewardRisk: v })} min={0} max={50} testId="hplan-pref-minrr" help="Darunter ist der Plan rot. Gilt für alle deine Pläne." />
      </div>
    </StepCard>
  );
}
