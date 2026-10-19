/**
 * One training case (F38): the chart ends at the decision candle (the candle before the journal trade's entry – nothing
 * later is passed to the chart, so the price axis and the time axis cannot leak the future either), the trader answers
 * (setup present?, long / short / wait, stop, the setup's checklist, one sentence), the decision is STORED, and only
 * then the chart plays on and is compared with the real course. Reflection comes last. The profit of the case never
 * decides anything.
 */
import { motionValue } from "motion/react";
import { lazy, Suspense, useMemo, useState, type ReactNode } from "react";
import type { ReplayBar, ReplayLine, ReplayTrade } from "@/chart/ReplayChart";
import { ACTION_LABEL, ACTIONS, CASE_INTERVAL_MS, caseInterval, caseWindow, decisionAt, decisionGaps, decisionOfDraft, EMPTY_DECISION, planOutcome, RECOGNITION_LABEL, RECOGNITIONS, ruleResult, stopCheck, TRAINING_VERSION, VERDICT_LABEL, VERDICTS, visibleBars, type Action, type DecisionDraft, type Recognition, type TrainingRound, type Verdict } from "@/domain/training";
import type { ChecklistEntry, EnrichedTrade, Setup } from "@/domain/types";
import { cn } from "@/lib/cn";
import { date as fmtDate, price as fmtPrice, r as fmtR, time as fmtTime } from "@/lib/format";
import { newId } from "@/lib/ids";
import { DotMatrix } from "@/motion/DotMatrix";
import { ScrubTimeline } from "@/motion/pulse/ScrubTimeline";
import { StaggerItem } from "@/motion/Sheet";
import { useReducedFx } from "@/motion/useReducedFx";
import { Button, CheckboxRow, Input, Segmented, Skeleton, Textarea } from "@/primitives";
import { buildReplay, type ReplayInterval } from "@/views/trades/replay/replayModel";
import { useCandles } from "@/views/trades/replay/useCandles";
import { persistReflection, persistRound } from "./actions";
import { TRAIN } from "./strings";

const ReplayChart = lazy(() => import("@/chart/ReplayChart"));
const CHART_H = 300;

export interface CaseProps {
  trade: EnrichedTrade;
  /** the case carries the practised setup in the journal */
  positive: boolean;
  setup: Setup;
  setups: readonly Setup[];
  /** the setup's checklist (the journal's rules + the setup's items) */
  items: readonly ChecklistEntry[];
  /** market name and date stay covered while deciding */
  blind: boolean;
  index: number;
  total: number;
  isLast: boolean;
  /** the case is over (`roundId` = the stored round, `null` = skipped) */
  onDone: (roundId: string | null) => void;
}

const ms = (local: string | undefined): number => (local ? new Date(local).getTime() : NaN);
const clock = (t: number): string => `${fmtDate(new Date(t))} ${fmtTime(new Date(t))}`;

function Notice({ text, children }: { text: string; children?: ReactNode }) {
  return (
    <StaggerItem className="grid min-h-[180px] place-items-center rounded-2xl border border-line bg-ink-950/50 p-6 text-center" data-testid="training-notice">
      <div className="grid justify-items-center gap-3">
        <DotMatrix text="--" tone="mute" size={4} gap={2} glow={false} />
        <p className="max-w-[44ch] text-[13px] text-mute">{text}</p>
        {children}
      </div>
    </StaggerItem>
  );
}

export function CaseView(props: CaseProps) {
  const { trade, onDone } = props;
  const interval = caseInterval(trade);
  const [now] = useState(() => Date.now());
  const win = useMemo(() => caseWindow(trade, interval, now), [trade, interval, now]);
  const load = useCandles({ pair: trade.pair, interval, ...win }, TRAIN.otherPair);
  const skip = (
    <Button variant="ghost" size="sm" onClick={() => onDone(null)} className="pointer-coarse:min-h-11">
      {TRAIN.skip}
    </Button>
  );
  if (load.status === "error") return <Notice text={load.message}>{skip}</Notice>;
  if (load.status === "loading")
    return (
      <StaggerItem className="grid h-[300px] place-items-center rounded-2xl border border-line bg-ink-950/50">
        <div className="grid justify-items-center gap-3">
          <DotMatrix preset="wave" tone="fg" size={4} gap={2} label={TRAIN.loading} />
          <span className="text-[12px] text-mute">{TRAIN.loading}</span>
        </div>
      </StaggerItem>
    );
  return <Loaded {...props} bars={load.bars} interval={interval} skip={skip} />;
}

function Loaded({ trade, positive, setup, setups, items, blind, index, total, isLast, onDone, bars, interval, skip }: CaseProps & { bars: ReplayBar[]; interval: ReplayInterval; skip: ReactNode }) {
  const reduced = useReducedFx();
  const intervalMs = CASE_INTERVAL_MS[interval];
  const entryMs = ms(trade.date);
  const decision = useMemo(() => decisionAt(bars, entryMs, intervalMs), [bars, entryMs, intervalMs]);
  const [draft, setDraft] = useState<DecisionDraft>({ ...EMPTY_DECISION, checks: {} });
  const [phase, setPhase] = useState<"decide" | "saving" | "revealed">("decide");
  const [showGaps, setShowGaps] = useState(false);
  const [round, setRound] = useState<TrainingRound | null>(null);
  const visible = useMemo(() => (decision ? visibleBars(bars, decision) : []), [bars, decision]);
  const lastClose = visible[visible.length - 1]?.close ?? 0;
  if (!decision) return <Notice text={TRAIN.tooLittle}>{skip}</Notice>;

  const gaps = decisionGaps(draft, lastClose);
  const set = (patch: Partial<DecisionDraft>) => setDraft((d) => ({ ...d, ...patch }));

  const commit = async () => {
    const d = decisionOfDraft(draft, lastClose, Date.now());
    if (!d) {
      setShowGaps(true);
      return;
    }
    const rr = ruleResult(d.action, draft.stop, lastClose, items, d.checks);
    const recognized = d.recognition === "unsure" ? null : d.recognition === "yes" ? positive : !positive;
    const next: TrainingRound = {
      id: newId("tr_"),
      v: TRAINING_VERSION,
      createdAt: d.at,
      updatedAt: d.at,
      setupId: setup.id,
      tradeId: trade.id,
      positive,
      interval,
      anchorMs: decision.anchorMs,
      blind,
      decision: d,
      rules: { checked: rr.checked, total: rr.total, stopOk: rr.stopOk, followed: rr.followed },
      recognized,
      // the future is shown right after this write: the decision above is stored first, and the write stamps both times
      revealedAt: d.at,
    };
    setPhase("saving");
    // order: the decision is stored first – the future is shown only after the write went through
    const ok = await persistRound(next);
    if (!ok) {
      setPhase("decide");
      return;
    }
    setRound(next);
    setPhase("revealed");
  };

  const revealed = phase === "revealed" && round != null;
  return (
    <div className="grid gap-4" data-testid="training-case" data-phase={phase}>
      <StaggerItem className="flex flex-wrap items-center justify-between gap-2">
        <div className="grid gap-0.5">
          <span className="font-mono text-xs font-semibold uppercase tracking-[0.12em] text-fg">{TRAIN.caseOf(index + 1, total)}</span>
          <span className="text-[12.5px] text-mute" data-testid="training-case-head">
            {revealed || !blind ? `${trade.pair} · ${clock(entryMs)}` : "Markt und Datum verdeckt"}
            {` · Kerzen ${interval}`}
          </span>
        </div>
        <span className="rounded-full border border-line-2 px-2.5 py-1 font-mono text-[11px] text-fg/85">{setup.name}</span>
      </StaggerItem>

      <StaggerItem>
        <CaseChart trade={trade} bars={bars} visible={visible} decisionVisible={decision.visible} interval={interval} round={revealed ? round : null} reduced={reduced} stopText={draft.stop} action={draft.action} lastClose={lastClose} />
      </StaggerItem>

      {!revealed && (
        <StaggerItem className="grid gap-4" data-testid="training-form">
          <p className="text-[12px] text-faint">{TRAIN.frozenNote}</p>
          <Block title={TRAIN.step1}>
            <span className="text-[13px] text-fg/90">{TRAIN.recognitionQ(setup.name)}</span>
            <Segmented<Recognition> aria-label="Setup erkannt" size="sm" value={draft.recognition} onChange={(v) => set({ recognition: v })} options={RECOGNITIONS.map((v) => ({ v, label: RECOGNITION_LABEL[v] }))} />
          </Block>
          <Block title={TRAIN.step2}>
            <span className="text-[13px] text-fg/90">{TRAIN.actionQ}</span>
            <Segmented<Action> aria-label="Entscheidung" size="sm" value={draft.action} onChange={(v) => set({ action: v })} options={ACTIONS.map((v) => ({ v, label: ACTION_LABEL[v] }))} />
            {draft.action && draft.action !== "wait" && (
              <label className="grid gap-1 text-[12px] text-mute">
                <span>{TRAIN.stopLabel}</span>
                <Input numeric value={draft.stop} onChange={(e) => set({ stop: e.target.value })} aria-label={TRAIN.stopLabel} placeholder={fmtPrice(lastClose)} invalid={showGaps && !stopCheck(draft.action, draft.stop, lastClose).ok} />
                <span className="text-faint">{TRAIN.stopHint(fmtPrice(lastClose))}</span>
              </label>
            )}
          </Block>
          <Block title={TRAIN.step3}>
            {items.length ? (
              <>
                <span className="text-[12px] text-mute">{TRAIN.rulesLead}</span>
                <div className="grid gap-1.5" role="group" aria-label="Regeln des Setups">
                  {items.map((it) => (
                    <CheckboxRow key={it.id} checked={!!draft.checks[it.id]} onToggle={() => set({ checks: { ...draft.checks, [it.id]: !draft.checks[it.id] } })}>
                      {it.text}
                    </CheckboxRow>
                  ))}
                </div>
              </>
            ) : (
              <span className="text-[12px] text-mute">{TRAIN.noRules}</span>
            )}
          </Block>
          <Block title={TRAIN.step4}>
            <label className="grid gap-1 text-[12px] text-mute">
              <span>{TRAIN.reasonLabel}</span>
              <Textarea value={draft.reason} onChange={(e) => set({ reason: e.target.value })} aria-label={TRAIN.reasonLabel} rows={2} maxLength={1000} invalid={showGaps && !draft.reason.trim()} />
            </label>
          </Block>
          {showGaps && gaps.length > 0 && (
            <ul className="grid gap-1 text-[12px] text-warn" role="status" data-testid="training-gaps">
              {gaps.map((g) => (
                <li key={g}>{g}</li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="max-w-[46ch] text-[11.5px] text-faint">{TRAIN.commitNote}</span>
            <div className="flex flex-wrap items-center gap-2">
              {skip}
              <Button variant="primary" onClick={() => void commit()} disabled={phase === "saving"} data-testid="training-commit" className="pointer-coarse:min-h-11">
                {phase === "saving" ? TRAIN.committing : TRAIN.commit}
              </Button>
            </div>
          </div>
        </StaggerItem>
      )}

      {revealed && round && <Revealed round={round} trade={trade} bars={bars} setup={setup} setups={setups} items={items} intervalMs={intervalMs} decisionIdx={decision.entryIdx} isLast={isLast} onDone={onDone} />}
    </div>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="grid gap-2 border-0 p-0">
      <legend className="mb-1 text-[11.5px] font-semibold uppercase tracking-[0.1em] text-faint">{title}</legend>
      {children}
    </fieldset>
  );
}

const FLAT: ReplayTrade = { side: "long", entry: 0, stop: null, target: null, exit: null, entryIndex: Number.MAX_SAFE_INTEGER, exitIndex: null, result: "open" };

/** The chart: the frozen picture while deciding, the whole course (playing on from the decision) after the reveal. */
function CaseChart({ trade, bars, visible, decisionVisible, interval, round, reduced, stopText, action, lastClose }: { trade: EnrichedTrade; bars: ReplayBar[]; visible: ReplayBar[]; decisionVisible: number; interval: ReplayInterval; round: TrainingRound | null; reduced: boolean; stopText: string; action: Action | null; lastClose: number }) {
  const frozenStep = useMemo(() => motionValue(visible.length), [visible.length]);
  const model = useMemo(() => (round ? buildReplay(trade, bars, interval) : null), [round, trade, bars, interval]);
  const playStep = useMemo(() => (round ? motionValue(reduced ? bars.length : decisionVisible) : null), [round, reduced, bars.length, decisionVisible]);
  const flatTrade = useMemo<ReplayTrade>(() => ({ ...FLAT, entry: lastClose }), [lastClose]);
  const stopLine = useMemo<ReplayLine[]>(() => {
    if (round) return round.decision.stop != null ? [{ price: round.decision.stop, label: "Dein Stopp", tone: "mute", dashed: true }] : [];
    if (!action || action === "wait") return [];
    const c = stopCheck(action, stopText, lastClose);
    return c.ok && c.stop != null ? [{ price: c.stop, label: "Dein Stopp", tone: "mute", dashed: true }] : [];
  }, [round, action, stopText, lastClose]);
  const revealedModel = model && playStep;
  return (
    <div className="grid gap-3">
      <Suspense fallback={<Skeleton height={CHART_H} />}>
        <ReplayChart
          bars={revealedModel ? bars : visible}
          trade={revealedModel ? model.trade : flatTrade}
          steps={revealedModel ? model.steps : []}
          step={revealedModel ? playStep : frozenStep}
          wipeKey={round ? "reveal" : "frozen"}
          showTrade={!!revealedModel}
          lines={stopLine}
          height={CHART_H}
        />
      </Suspense>
      {revealedModel && (
        <ScrubTimeline
          label="Aufdeck-Zeitleiste"
          title={`${model.total} Kerzen · ${interval}`}
          total={model.total}
          spans={model.spans}
          markers={[{ at: decisionVisible, label: "Entscheidung", tone: "fg" }, ...model.markers]}
          time={playStep}
          defaultTime={decisionVisible}
          autoPlay
          playSeconds={Math.max(6, Math.min(16, (model.total - decisionVisible) / 6))}
          step={1}
          bigStep={10}
          formatTime={(t) => {
            const b = bars[Math.max(0, Math.min(bars.length - 1, Math.ceil(t) - 1))];
            return b ? clock(b.time) : "–";
          }}
        />
      )}
    </div>
  );
}

const markTone = (v: boolean | null): string => (v === null ? "text-faint" : v ? "text-win" : "text-loss");
const markGlyph = (v: boolean | null): string => (v === null ? TRAIN.markNone : v ? TRAIN.markYes : TRAIN.markNo);

/** After the reveal: the three marks, the journal's trade, the plan on the real candles, the reflection. */
function Revealed({ round, trade, bars, setup, setups, items, intervalMs, decisionIdx, isLast, onDone }: { round: TrainingRound; trade: EnrichedTrade; bars: ReplayBar[]; setup: Setup; setups: readonly Setup[]; items: readonly ChecklistEntry[]; intervalMs: number; decisionIdx: number; isLast: boolean; onDone: (id: string | null) => void }) {
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [note, setNote] = useState("");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const d = round.decision;
  const gapsList = useMemo(() => ruleResult(d.action, d.stop != null ? String(d.stop) : "", bars[decisionIdx - 1]?.close ?? 0, items, d.checks).gaps, [d, items, bars, decisionIdx]);
  const exitMs = trade.status === "closed" && trade.exitDate ? ms(trade.exitDate) : null;
  const plan = useMemo(() => (d.action === "wait" || d.stop == null ? null : planOutcome(d.action, d.stop, bars, { entryIdx: decisionIdx, visible: decisionIdx, anchorMs: round.anchorMs }, intervalMs, exitMs)), [d, bars, decisionIdx, intervalMs, exitMs, round.anchorMs]);
  const names = (trade.setups ?? []).map((id) => setups.find((s) => s.id === id)?.name ?? id);
  const said = RECOGNITION_LABEL[d.recognition];
  const truth = round.positive ? TRAIN.truthYes(setup.name) : TRAIN.truthNo(setup.name);
  const reflected = saved;

  const save = async () => {
    if (!verdict || saving) return;
    setSaving(true);
    const ok = await persistReflection(round.id, verdict, note);
    setSaving(false);
    if (ok) setSaved(true);
  };

  return (
    <div className="grid gap-4" data-testid="training-reveal">
      <StaggerItem className="grid gap-2">
        <span className="label">{TRAIN.revealTitle}</span>
        <div className="grid gap-2 sm:grid-cols-3">
          <Mark label={TRAIN.marks.recognition} value={round.recognized} testId="mark-recognition">
            {TRAIN.recognitionLine(said, truth)}
            <span className="mt-1 block text-faint">{TRAIN.recognitionNote}</span>
          </Mark>
          <Mark label={TRAIN.marks.rules} value={round.rules.followed} testId="mark-rules">
            {round.rules.total ? `${round.rules.checked} von ${round.rules.total} Regeln abgehakt. ` : ""}
            {d.action === "wait" ? TRAIN.rulesWait : round.rules.total === 0 ? TRAIN.rulesNone : round.rules.followed ? TRAIN.rulesDone : gapsList.join(" ")}
          </Mark>
          <Mark label={TRAIN.marks.reflection} value={reflected ? true : null} testId="mark-reflection">
            {reflected ? TRAIN.reflectSaved : TRAIN.reflectNote}
          </Mark>
        </div>
      </StaggerItem>

      <StaggerItem className="grid gap-2 rounded-2xl border border-line bg-ink-950/50 px-3.5 py-3 text-[12.5px]" data-testid="training-then">
        <span className="label">{TRAIN.then}</span>
        <p className="text-fg/90">
          {trade.side === "short" ? "▼ Short" : "▲ Long"} · Einstieg {fmtPrice(trade.entry)}
          {trade.exit != null ? ` → Ausstieg ${fmtPrice(trade.exit)}` : ""} · {trade.r != null ? fmtR(trade.r) : "R unbekannt"}
        </p>
        <p className="text-mute">{names.length ? `Setup im Journal: ${names.join(", ")}.` : "Im Journal ohne Setup."} Das Ergebnis dieses Trades zählt für die Auswertung nicht.</p>
      </StaggerItem>

      <StaggerItem className="grid gap-1.5 rounded-2xl border border-dashed border-line-2 px-3.5 py-3 text-[12.5px]" data-testid="training-plan">
        <span className="label">{TRAIN.plan}</span>
        {plan == null ? (
          <p className="text-mute">{TRAIN.planWait}</p>
        ) : plan.status === "ok" ? (
          <p className="text-fg/90">
            {ACTION_LABEL[d.action]} mit Stopp {fmtPrice(d.stop)}: {plan.exitLabel}
            {plan.exitPrice != null ? ` bei ${fmtPrice(plan.exitPrice)}` : ""} · {fmtR(plan.r)} (R deines Stopps, vor Gebühren){plan.ambiguous ? " · Stopp und Ziel in einer Kerze: als Stopp gewertet" : ""}
          </p>
        ) : (
          <p className="text-mute">
            Nicht berechenbar: {plan.why}
          </p>
        )}
        {plan != null && <p className="text-[11.5px] text-faint">{TRAIN.planNote}</p>}
      </StaggerItem>

      <StaggerItem className="grid gap-2 rounded-2xl border border-line-2 bg-ink-950/40 p-3.5" data-testid="training-reflect">
        <span className="label">{TRAIN.reflectTitle}</span>
        <span className="text-[12.5px] text-mute">{TRAIN.reflectQ}</span>
        <Segmented<Verdict> aria-label="Verlauf im Vergleich" size="sm" value={verdict} onChange={(v) => !saved && setVerdict(v)} options={VERDICTS.map((v) => ({ v, label: VERDICT_LABEL[v], disabled: saved }))} />
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} aria-label="Reflexion" placeholder={TRAIN.reflectNote} rows={2} maxLength={1000} disabled={saved} />
        <div className="flex flex-wrap items-center justify-end gap-2">
          {!saved && (
            <Button variant="ghost" size="sm" onClick={() => void save()} disabled={!verdict || saving} data-testid="training-reflect-save" className="pointer-coarse:min-h-11">
              {TRAIN.reflectSave}
            </Button>
          )}
          <Button variant="primary" size="sm" onClick={() => onDone(round.id)} data-testid="training-next" className={cn("pointer-coarse:min-h-11")}>
            {isLast ? TRAIN.finish : TRAIN.next}
          </Button>
        </div>
      </StaggerItem>
    </div>
  );
}

function Mark({ label, value, testId, children }: { label: string; value: boolean | null; testId: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-ink-950/50 px-3 py-2 text-[12px] text-mute" data-testid={testId} data-value={value === null ? "none" : value ? "yes" : "no"}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">{label}</span>
        <span className={cn("font-mono text-[15px] font-semibold", markTone(value))} aria-label={value === null ? "nicht gewertet" : value ? "ja" : "nein"}>
          {markGlyph(value)}
        </span>
      </div>
      <div className="mt-1">{children}</div>
    </div>
  );
}

