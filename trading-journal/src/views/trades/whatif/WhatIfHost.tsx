/**
 * "Was wäre wenn" (F33) – the sheet next to the trade detail. One recorded trade on its own candles (the MAE / MFE
 * loader), the recorded course next to a re-run with the recorded rules and a set of variants (another stop,
 * break-even, partial take-profit, another target, trailing, running on) plus one variant the trader composes. The
 * engine is the backtest's (`@/domain/whatif`); this file only shows it. Nothing is written to the journal.
 *
 * Lazy chunk: `DeferredHosts` mounts it the first time `openWhatIf` ran.
 */
import { motionValue } from "motion/react";
import { lazy, Suspense, useMemo, useState, type ReactNode } from "react";
import type { ReplayLine } from "@/chart/ReplayChart";
import { excursionInterval } from "@/domain/excursion";
import { DEFAULT_DRAFT, deltaR, draftActive, draftNotes, PRESET_SCENARIOS, recordedOutcome, runScenarios, scenarioOfDraft, simulateScenario, whatIfTradeOf, type CustomDraft, type ScenarioResult, type WhatIfTrade } from "@/domain/whatif";
import type { EnrichedTrade } from "@/domain/types";
import { cn } from "@/lib/cn";
import { date as fmtDate, price as fmtPrice, r as fmtR, signed, time as fmtTime } from "@/lib/format";
import { DotMatrix } from "@/motion/DotMatrix";
import { Sheet, StaggerItem } from "@/motion/Sheet";
import { CheckboxRow, Input, Segmented, Skeleton } from "@/primitives";
import { useEnriched, useJournal } from "@/store/journalStore";
import { AnalysisNote } from "@/ui/AnalysisNote";
import { buildReplay, defaultReplayInterval, INTERVAL_MS, REPLAY_INTERVALS, replayWindow, type ReplayInterval } from "../replay/replayModel";
import { useCandles } from "../replay/useCandles";
import { closeWhatIf, useWhatIf } from "./whatIfStore";
import { WHATIF } from "./strings";

const ReplayChart = lazy(() => import("@/chart/ReplayChart"));
const CHART_H = 260;
const CUSTOM_ID = "custom";

export default function WhatIfHost() {
  const id = useWhatIf((s) => s.id);
  const enriched = useEnriched();
  const trade = id ? enriched.find((t) => t.id === id) : undefined;
  return (
    <Sheet open={trade != null} onClose={closeWhatIf} title={WHATIF.title} size="lg" dismissGuard={false}>
      {trade ? <WhatIfBody key={trade.id} trade={trade} /> : null}
    </Sheet>
  );
}

const tone = (v: number | null): string => (v == null || v === 0 ? "text-fg" : v > 0 ? "text-win" : "text-loss");
const clock = (ms: number): string => `${fmtDate(new Date(ms))} ${fmtTime(new Date(ms))}`;

function WhatIfBody({ trade }: { trade: EnrichedTrade }) {
  const input = useMemo(() => whatIfTradeOf(trade), [trade]);
  if (!input.ok) return <Notice text={input.why} />;
  return <Loaded trade={trade} sim={input.trade} />;
}

function Notice({ text }: { text: string }) {
  return (
    <StaggerItem className="grid min-h-[160px] place-items-center rounded-2xl border border-line bg-ink-950/50 p-6 text-center" data-testid="whatif-notice">
      <div className="grid justify-items-center gap-3">
        <DotMatrix text="--" tone="mute" size={4} gap={2} glow={false} />
        <p className="max-w-[44ch] text-[13px] text-mute">{text}</p>
      </div>
    </StaggerItem>
  );
}

/** The window: the trade's time in the market, padded like the replay (run-on needs candles after the exit). */
function windowOf(trade: EnrichedTrade, interval: ReplayInterval): { from: number; to: number } {
  return replayWindow(trade, interval);
}

function Loaded({ trade, sim }: { trade: EnrichedTrade; sim: WhatIfTrade }) {
  const currency = useJournal((s) => s.settings.currency);
  const fixed = excursionInterval((sim.exitMs ?? sim.entryMs) - sim.entryMs);
  const interval: ReplayInterval = REPLAY_INTERVALS.includes(fixed) ? fixed : defaultReplayInterval(trade);
  const w = useMemo(() => windowOf(trade, interval), [trade, interval]);
  const load = useCandles({ pair: trade.pair, interval, ...w }, "Alternativen lassen sich nur für das Paar des Live-Markts durchrechnen.");
  if (load.status === "error") return <Notice text={load.message} />;
  if (load.status === "loading")
    return (
      <StaggerItem className="grid h-[260px] place-items-center rounded-2xl border border-line bg-ink-950/50">
        <div className="grid justify-items-center gap-3">
          <DotMatrix preset="wave" tone="fg" size={4} gap={2} label={WHATIF.loading} />
          <span className="text-[12px] text-mute">{WHATIF.loading}</span>
        </div>
      </StaggerItem>
    );
  return <Study trade={trade} sim={sim} bars={load.bars} interval={interval} currency={currency} />;
}

function Study({ trade, sim, bars, interval, currency }: { trade: EnrichedTrade; sim: WhatIfTrade; bars: Parameters<typeof runScenarios>[1]; interval: ReplayInterval; currency: string }) {
  const intervalMs = INTERVAL_MS[interval];
  const run = useMemo(() => runScenarios(sim, bars, intervalMs, PRESET_SCENARIOS), [sim, bars, intervalMs]);
  const [draft, setDraft] = useState<CustomDraft>({ ...DEFAULT_DRAFT });
  const customScenario = useMemo(() => scenarioOfDraft(draft), [draft]);
  const custom = useMemo(() => simulateScenario(sim, bars, intervalMs, customScenario), [sim, bars, intervalMs, customScenario]);
  const [selected, setSelected] = useState<string>("base");
  const rec = recordedOutcome(sim, { r: trade.r, pnl: trade.pnl });
  const all: ScenarioResult[] = [run.base, ...run.results, custom];
  const shown = all.find((x) => x.id === selected) ?? run.base;
  const model = useMemo(() => buildReplay(trade, bars, interval), [trade, bars, interval]);
  const step = useMemo(() => motionValue(bars.length), [bars.length]);
  const lines = useMemo<ReplayLine[]>(() => {
    if (shown.status !== "ok" || shown.id === "base") return [];
    const out: ReplayLine[] = [];
    if (shown.stop != null && Math.abs(shown.stop - sim.stop) > 1e-9) out.push({ price: shown.stop, label: WHATIF.legend.stop, tone: "mute", dashed: true });
    if (shown.exitPrice != null) out.push({ price: shown.exitPrice, label: WHATIF.legend.exit, tone: (shown.r ?? 0) >= 0 ? "win" : "loss" });
    return out;
  }, [shown, sim.stop]);
  const ambiguous = all.some((x) => x.ambiguous);

  return (
    <div className="grid gap-4" data-testid="whatif">
      <StaggerItem className="grid gap-1.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className={cn("font-mono text-xs font-semibold uppercase tracking-[0.12em]", trade.side === "short" ? "text-loss" : "text-win")}>{trade.side === "short" ? "▼ Short" : "▲ Long"} · {trade.pair}</span>
          <span className="font-mono text-[11.5px] text-faint">
            {WHATIF.candles} {interval} · {WHATIF.sample}
          </span>
        </div>
        <p className="text-[12.5px] text-mute">
          {clock(sim.entryMs)} · {fmtPrice(sim.entry)} → {fmtPrice(sim.exit)} · Stopp {fmtPrice(sim.stop)}
          {sim.target != null ? ` · Ziel ${fmtPrice(sim.target)}` : ""}
        </p>
        <p className="text-[12.5px] text-mute">{WHATIF.lead}</p>
      </StaggerItem>

      <StaggerItem className="rounded-2xl border border-warn/30 bg-warn/[0.06] px-3.5 py-3 text-[12.5px] text-fg/90" data-testid="whatif-hindsight" role="note">
        <span className="font-semibold text-warn">{WHATIF.hindsightTitle}. </span>
        {WHATIF.hindsight}
      </StaggerItem>

      {model && (
        <StaggerItem>
          <Suspense fallback={<Skeleton height={CHART_H} />}>
            <ReplayChart bars={bars} trade={model.trade} steps={model.steps} step={step} wipeKey={selected} lines={lines} height={CHART_H} />
          </Suspense>
        </StaggerItem>
      )}

      <StaggerItem className="grid gap-2" data-testid="whatif-results">
        <ul className="grid gap-2" aria-label="Ergebnisse">
          <Row label={WHATIF.rowRecorded} note={`${WHATIF.recordedNote} · ${WHATIF.grossNote}: ${rec.grossR != null ? fmtR(rec.grossR) : "–"}`} r={rec.r} money={rec.pnl} currency={currency} testId="whatif-row-recorded" />
          {all.map((x) => (
            <Row key={x.id} result={x} base={run.base} currency={currency} selected={selected === x.id} onSelect={() => setSelected(x.id)} isCustom={x.id === CUSTOM_ID} testId={`whatif-row-${x.id}`} />
          ))}
        </ul>
        {ambiguous && <p className="text-[12px] text-warn">{WHATIF.ambiguous}.</p>}
      </StaggerItem>

      <StaggerItem>
        <Builder draft={draft} setDraft={setDraft} interval={interval} />
      </StaggerItem>

      <StaggerItem className="grid gap-2 text-[12px] text-mute">
        <p>
          <span className="font-semibold text-fg/85">{WHATIF.orderTitle}. </span>
          {WHATIF.order}
        </p>
        <p>
          <span className="font-semibold text-fg/85">{WHATIF.assumptionsTitle}. </span>
          {WHATIF.assumptions}
        </p>
      </StaggerItem>

      <StaggerItem>
        <AnalysisNote lead="Nachrechnung auf den Kerzen dieses einen Trades – keine Prognose." />
      </StaggerItem>
    </div>
  );
}

/** One result row: the recorded line (no `result`) or a simulated scenario (selectable). */
function Row({ label, note, r, money, currency, result, base, selected, onSelect, isCustom, testId }: { label?: string; note?: string; r?: number | null; money?: number | null; currency: string; result?: ScenarioResult; base?: ScenarioResult; selected?: boolean; onSelect?: () => void; isCustom?: boolean; testId: string }) {
  const ok = !result || result.status === "ok";
  const rr = result ? result.r : (r ?? null);
  const mm = result ? result.money : (money ?? null);
  const delta = result && base && result.id !== base.id ? deltaR(result, base) : null;
  const body: ReactNode = (
    <>
      <div className="min-w-0">
        <div className="truncate text-[13px] font-medium text-fg">{result?.label ?? label}</div>
        <div className="mt-0.5 text-[11.5px] text-faint">
          {result
            ? result.status === "ok"
              ? `${result.exitLabel}${result.exitPrice != null ? ` bei ${fmtPrice(result.exitPrice)}` : ""} · ${result.bars} ${result.bars === 1 ? "Kerze" : "Kerzen"}${result.partials ? ` · ${result.partials} Teilverkauf` : ""}${result.id === "base" ? ` · ${WHATIF.baseNote}` : ""}`
              : `${WHATIF.skippedPrefix} ${result.why}`
            : note}
        </div>
        {result?.ambiguous && <div className="mt-0.5 text-[11.5px] text-warn">{WHATIF.ambiguous}</div>}
      </div>
      <div className="text-right font-mono">
        <div className={cn("text-[15px] font-medium", tone(rr))}>{ok ? fmtR(rr) : "–"}</div>
        <div className={cn("text-[11.5px]", tone(mm))}>{ok ? (mm != null ? `${signed(mm)} ${currency}` : WHATIF.noMoney) : ""}</div>
        {delta != null && (
          <div className="text-[11px] text-faint" title={`${WHATIF.deltaBase}`}>
            Δ {fmtR(delta)} {WHATIF.deltaBase}
          </div>
        )}
      </div>
    </>
  );
  const cls = cn("grid grid-cols-[1fr_auto] items-start gap-3 rounded-xl border px-3.5 py-2.5 text-left", selected ? "border-white/40 bg-white/[0.06]" : "border-line bg-ink-950/50", isCustom && "border-dashed");
  return (
    <li data-testid={testId} data-status={result?.status ?? "recorded"}>
      {onSelect ? (
        <button type="button" onClick={onSelect} aria-pressed={selected} aria-label={`${result?.label ?? label}: ${WHATIF.selectRow}`} className={cn(cls, "w-full transition-colors hover:border-white/30 pointer-coarse:min-h-11")}>
          {body}
        </button>
      ) : (
        <div className={cls}>{body}</div>
      )}
    </li>
  );
}

/** The builder of "Eigene Variante": four groups – Stopp, Break-even, Teilziel, Ausstieg (Ziel, Dauer, Trailing). */
function Builder({ draft, setDraft, interval }: { draft: CustomDraft; setDraft: (d: CustomDraft) => void; interval: ReplayInterval }) {
  const set = <K extends keyof CustomDraft>(k: K, v: CustomDraft[K]) => setDraft({ ...draft, [k]: v });
  const notes = draftNotes(draft);
  return (
    <div className="grid gap-3 rounded-2xl border border-line-2 bg-ink-950/40 p-3.5" data-testid="whatif-builder">
      <div className="grid gap-0.5">
        <span className="label">{WHATIF.custom}</span>
        <span className="text-[12px] text-mute">{WHATIF.customLead}</span>
      </div>

      <Group title="Stopp">
        <Segmented<CustomDraft["stop"]> aria-label="Stopp" size="sm" value={draft.stop} onChange={(v) => set("stop", v)} options={[{ v: "orig", label: "Wie gebucht" }, { v: "factor", label: "Abstand ×" }, { v: "price", label: "Kurs" }]} />
        {draft.stop === "factor" && <Num label="Faktor des ursprünglichen Abstands" value={draft.stopFactor} onChange={(v) => set("stopFactor", v)} suffix="×" />}
        {draft.stop === "price" && <Num label="Stopp-Kurs" value={draft.stopPrice} onChange={(v) => set("stopPrice", v)} />}
      </Group>

      <Group title="Break-even">
        <CheckboxRow checked={draft.breakEven} onToggle={() => set("breakEven", !draft.breakEven)}>
          Stopp auf den Einstieg ziehen
        </CheckboxRow>
        {draft.breakEven && <Num label="Ab Gewinn von (R der Variante)" value={draft.breakEvenR} onChange={(v) => set("breakEvenR", v)} suffix="R" />}
      </Group>

      <Group title="Teilziel">
        <CheckboxRow checked={draft.partial} onToggle={() => set("partial", !draft.partial)}>
          Einen Teil bei einem Zwischenziel verkaufen
        </CheckboxRow>
        {draft.partial && (
          <div className="grid gap-2 sm:grid-cols-2">
            <Num label="Zwischenziel (R der Variante)" value={draft.partialR} onChange={(v) => set("partialR", v)} suffix="R" />
            <Num label="Anteil, der verkauft wird" value={draft.partialPct} onChange={(v) => set("partialPct", v)} suffix="%" />
            <div className="sm:col-span-2">
              <CheckboxRow checked={draft.partialThenBe} onToggle={() => set("partialThenBe", !draft.partialThenBe)}>
                Danach den Stopp auf den Einstieg ziehen
              </CheckboxRow>
            </div>
          </div>
        )}
      </Group>

      <Group title="Ausstieg">
        <Segmented<CustomDraft["target"]> aria-label="Ziel" size="sm" value={draft.target} onChange={(v) => set("target", v)} options={[{ v: "keep", label: "Ziel wie gebucht" }, { v: "none", label: "Kein Ziel" }, { v: "r", label: "Ziel in R" }]} />
        {draft.target === "r" && <Num label="Ziel (R der Variante)" value={draft.targetR} onChange={(v) => set("targetR", v)} suffix="R" />}
        <Segmented<CustomDraft["horizon"]> aria-label="Dauer" size="sm" value={draft.horizon} onChange={(v) => set("horizon", v)} options={[{ v: "actual", label: "Bis zum Ist-Ausstieg" }, { v: "runOn", label: "Weiterlaufen" }, { v: "bars", label: "Nach n Kerzen" }]} />
        {draft.horizon === "bars" && <Num label={`Kerzen (${interval}) bis zum Ausstieg`} value={draft.horizonBars} onChange={(v) => set("horizonBars", v)} />}
        <Segmented<CustomDraft["trail"]> aria-label="Trailing" size="sm" value={draft.trail} onChange={(v) => set("trail", v)} options={[{ v: "off", label: "Kein Trailing" }, { v: "pct", label: "Trailing %" }, { v: "atr", label: "Trailing ATR" }]} />
        {draft.trail !== "off" && (
          <div className="grid gap-2 sm:grid-cols-2">
            <Num label={draft.trail === "atr" ? "Abstand (× ATR 14)" : "Abstand (% vom Hoch)"} value={draft.trailValue} onChange={(v) => set("trailValue", v)} />
            <Num label="Startet ab (R der Variante)" value={draft.trailFromR} onChange={(v) => set("trailFromR", v)} suffix="R" />
          </div>
        )}
      </Group>

      {notes.length > 0 && (
        <ul className="grid gap-1 text-[12px] text-warn" role="status">
          {notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
      <div className="flex justify-end">
        <button type="button" onClick={() => setDraft({ ...DEFAULT_DRAFT })} disabled={!draftActive(draft)} className="rounded-full border border-line-2 px-3 py-1.5 text-[12px] font-medium text-fg transition-colors hover:border-white/40 disabled:opacity-40 pointer-coarse:min-h-11">
          Zurücksetzen
        </button>
      </div>
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="grid gap-2 border-0 p-0">
      <legend className="mb-1 text-[11.5px] font-semibold uppercase tracking-[0.1em] text-faint">{title}</legend>
      {children}
    </fieldset>
  );
}

function Num({ label, value, onChange, suffix }: { label: string; value: string; onChange: (v: string) => void; suffix?: string }) {
  return (
    <label className="grid gap-1 text-[12px] text-mute">
      <span>{label}</span>
      <span className="flex items-center gap-2">
        <Input numeric value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} wrapperClassName="flex-1" />
        {suffix && <span className="font-mono text-[12px] text-faint">{suffix}</span>}
      </span>
    </label>
  );
}

