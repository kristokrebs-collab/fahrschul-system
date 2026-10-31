/**
 * "Chart spiegeln / Bias prüfen" (F62) under a chart: the free mirror switch, the layer chips (breakouts, trendlines,
 * boxes, own trades, RSI – each on its own), the optional 100−RSI, and the guided test:
 *
 *   setup  → what to cover (name, position, P&L, long / short colours)
 *   first  → the picture is frozen at the last closed bar; direction + conditions + invalidation are written down and
 *            STORED (with the time) – only then the chart turns
 *   flipped→ the same data upside down; the trader rates again and names trigger / invalidation; STORED – only then
 *   revealed → the original comes back, the covered labels return and both answers are put side by side
 *
 * Nothing here reads a price after the anchor. The comparison states facts and possible contradictions; there is no score.
 * Surfaces (Markt chart, trade replay) pass `capture` (the context at the start, or why it cannot start) and read the
 * resulting view with `useMirrorState(surface)`.
 */
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useId, useMemo, useState } from "react";
import type { MirrorLayers } from "@/chart/mirror";
import { biasTestsOf, compareAnswers, DIRECTION_LABEL, DIRECTIONS, draftGaps, isOpen, isRevealed, OUTCOMES, summarize, type BiasContext, type BiasSurface, type BiasTest, type Direction, type OutcomeValue } from "@/domain/biasTest";
import { cn } from "@/lib/cn";
import { Switch } from "@/motion/Switch";
import { spring, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Button } from "@/primitives/Button";
import { Input, Textarea } from "@/primitives/Input";
import { Segmented } from "@/primitives/Segmented";
import { useJournal } from "@/store/journalStore";
import { discardOpenTest, recordOutcome, submitFirst, submitSecond, useBiasUi, type Flow } from "./flowStore";
import { mirrorStateOf, useMirrorState } from "./hooks";
import { BIAS } from "./strings";

const LAYER_ORDER = ["breakouts", "trendlines", "boxes", "trades", "rsi"] as const satisfies readonly (keyof MirrorLayers)[];

export interface MirrorPanelProps {
  surface: BiasSurface;
  /** the context to freeze at the start of a test, or why none can be taken now */
  capture: () => BiasContext | { reason: string };
  /** which layers this chart has (the replay only has its own trade) */
  layers?: readonly (keyof MirrorLayers)[];
  /** the replay lists only the tests of its trade */
  tradeId?: string;
  /** Markt / replay decide whether an unfinished test can continue on what is on screen now */
  canResume?: (t: BiasTest) => boolean;
  className?: string;
}

const hasReason = (c: BiasContext | { reason: string }): c is { reason: string } => "reason" in c;

/** Layer chips (`aria-pressed`, ≥ 44 px on coarse pointers). */
function LayerChips({ surface, available, locked }: { surface: BiasSurface; available: readonly (keyof MirrorLayers)[]; locked: boolean }) {
  const reduced = useReducedFx();
  const layers = useBiasUi((s) => s.prefs[surface].layers);
  const running = useBiasUi((s) => (s.flow?.surface === surface ? s.flow.layers : null));
  const shown = locked && running ? running : layers;
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={BIAS.layers} data-testid="bias-layers">
      {LAYER_ORDER.filter((k) => available.includes(k)).map((k) => {
        const on = shown[k];
        return (
          <motion.button
            key={k}
            type="button"
            aria-pressed={on}
            disabled={locked}
            onClick={() => useBiasUi.getState().setLayer(surface, k, !on)}
            whileTap={reduced || locked ? undefined : { scale: 0.95 }}
            transition={spring.press}
            data-bias-layer={k}
            className={cn(
              "inline-flex items-center rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition-[color,border-color,background-color] duration-200 pointer-coarse:min-h-11 pointer-coarse:px-3 disabled:cursor-not-allowed",
              on ? "border-white/25 bg-white/[0.06] text-fg" : "border-line-2 text-faint hover:text-mute",
              locked && "opacity-70",
            )}
          >
            {BIAS.layer[k]}
          </motion.button>
        );
      })}
    </div>
  );
}

function Check({ id, checked, onChange, children }: { id: string; checked: boolean; onChange: (on: boolean) => void; children: string }) {
  return (
    <label htmlFor={id} className="flex min-h-9 cursor-pointer items-center gap-3 rounded-xl border border-line px-3 py-2 text-[13px] pointer-coarse:min-h-11">
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="size-4 accent-white" />
      {children}
    </label>
  );
}

function Setup({ surface, capture }: { surface: BiasSurface; capture: MirrorPanelProps["capture"] }) {
  const flow = useBiasUi((s) => s.flow);
  const uid = useId();
  const [reason, setReason] = useState<string | null>(null);
  if (!flow || flow.surface !== surface) return null;
  const set = useBiasUi.getState().setBlind;
  return (
    <div className="grid gap-4" data-testid="bias-setup">
      <div className="grid gap-1.5">
        <h3 className="text-[14px] font-semibold">{BIAS.setup.title}</h3>
        <p className="max-w-[62ch] text-[12.5px] text-mute">{BIAS.setup.lead}</p>
        <ol className="grid gap-0.5 text-[12px] text-mute">
          {BIAS.setup.steps.map((s, i) => (
            <li key={s}>
              <span className="num mr-2 text-faint">{i + 1}</span>
              {s}
            </li>
          ))}
        </ol>
      </div>
      <fieldset className="grid gap-2 sm:grid-cols-2">
        <legend className="label mb-2">{BIAS.setup.blind}</legend>
        <Check id={`${uid}-name`} checked={flow.blind.hideName} onChange={(on) => set({ hideName: on })}>
          {BIAS.setup.hideName}
        </Check>
        <Check id={`${uid}-pos`} checked={flow.blind.hidePosition} onChange={(on) => set({ hidePosition: on })}>
          {BIAS.setup.hidePosition}
        </Check>
        <Check id={`${uid}-pnl`} checked={flow.blind.hidePnl} onChange={(on) => set({ hidePnl: on })}>
          {BIAS.setup.hidePnl}
        </Check>
        <Check id={`${uid}-col`} checked={flow.blind.neutralColors} onChange={(on) => set({ neutralColors: on })}>
          {BIAS.setup.neutralColors}
        </Check>
      </fieldset>
      <p className="text-[12px] text-faint">{BIAS.setup.note}</p>
      {reason && (
        <p role="status" className="text-[12.5px] text-warn" data-testid="bias-reason">
          {reason}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          data-testid="bias-begin"
          onClick={() => {
            const c = capture();
            if (hasReason(c)) {
              setReason(c.reason);
              return;
            }
            setReason(null);
            useBiasUi.getState().startFirst(c);
          }}
        >
          {BIAS.setup.begin}
        </Button>
        <Button variant="ghost" onClick={() => useBiasUi.getState().leave()}>{BIAS.setup.cancel}</Button>
      </div>
    </div>
  );
}

function AnswerForm({ flow, second }: { flow: Flow; second: boolean }) {
  const uid = useId();
  const T = second ? BIAS.second : BIAS.first;
  const d = flow.draft;
  const gaps = draftGaps(d);
  const tones = flow.blind.neutralColors ? undefined : ({ long: "bg-win/15 border-win/30", short: "bg-loss/15 border-loss/30" } as const);
  return (
    <div className="grid gap-4" data-testid={second ? "bias-second" : "bias-first"}>
      <div className="grid gap-1">
        <h3 className="text-[14px] font-semibold">{T.title}</h3>
        <p className="max-w-[62ch] text-[12.5px] text-mute">{T.lead}</p>
      </div>
      <div className="grid gap-1.5">
        <span id={`${uid}-dir`} className="text-[12.5px] font-medium">
          {second ? BIAS.second.direction : BIAS.field.direction}
        </span>
        <Segmented<Direction>
          aria-labelledby={`${uid}-dir`}
          value={d.direction}
          onChange={(v) => useBiasUi.getState().setDraft({ direction: v })}
          options={DIRECTIONS.map((v) => ({ v, label: DIRECTION_LABEL[v] }))}
          tones={tones}
        />
      </div>
      <div className="grid gap-1.5">
        <label htmlFor={`${uid}-cond`} className="text-[12.5px] font-medium">
          {second ? BIAS.second.conditions : BIAS.field.conditions}
        </label>
        <Textarea id={`${uid}-cond`} rows={3} maxLength={1000} value={d.conditions} placeholder={BIAS.field.conditionsHint} onChange={(e) => useBiasUi.getState().setDraft({ conditions: e.target.value })} data-testid="bias-conditions" />
      </div>
      <div className="grid gap-1.5">
        <label htmlFor={`${uid}-inv`} className="text-[12.5px] font-medium">
          {BIAS.field.invalidation}
        </label>
        <Input id={`${uid}-inv`} maxLength={1000} value={d.invalidation} placeholder={BIAS.field.invalidationHint} onChange={(e) => useBiasUi.getState().setDraft({ invalidation: e.target.value })} data-testid="bias-invalidation" />
      </div>
      {flow.showGaps && gaps.length > 0 && (
        <ul role="status" className="grid gap-0.5 text-[12.5px] text-warn" data-testid="bias-gaps">
          {gaps.map((g) => (
            <li key={g}>{g}</li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" disabled={flow.saving} onClick={() => void (second ? submitSecond() : submitFirst())} data-testid={second ? "bias-submit-second" : "bias-submit-first"}>
          {flow.saving ? BIAS.saving : T.submit}
        </Button>
        <Button onClick={() => useBiasUi.getState().leave()} disabled={flow.saving}>
          {BIAS.setup.cancel}
        </Button>
      </div>
    </div>
  );
}

function AnswerBlock({ title, a }: { title: string; a: NonNullable<BiasTest["first"]> }) {
  return (
    <div className="grid content-start gap-1.5 rounded-xl border border-line bg-ink-950/40 p-3">
      <span className="label">{title}</span>
      <span className="text-[15px] font-semibold">{DIRECTION_LABEL[a.direction]}</span>
      <dl className="grid gap-1 text-[12.5px]">
        <div>
          <dt className="text-faint">{BIAS.revealed.conditions}</dt>
          <dd className="whitespace-pre-wrap break-words text-mute">{a.conditions || BIAS.revealed.none}</dd>
        </div>
        <div>
          <dt className="text-faint">{BIAS.revealed.invalidation}</dt>
          <dd className="whitespace-pre-wrap break-words text-mute">{a.invalidation || BIAS.revealed.none}</dd>
        </div>
      </dl>
    </div>
  );
}

/** Both answers side by side with the plain comparison (also used by the history rows). */
export function BiasComparison({ test }: { test: BiasTest }) {
  if (!test.second) return null;
  const c = compareAnswers(test.first, test.second);
  return (
    <div className="grid gap-3" data-testid="bias-comparison" data-relation={c.relation}>
      <div className="grid gap-3 sm:grid-cols-2">
        <AnswerBlock title={BIAS.revealed.first} a={test.first} />
        <AnswerBlock title={BIAS.revealed.second} a={test.second} />
      </div>
      <div className="grid gap-1.5 rounded-xl border border-line-2 p-3">
        <p className="text-[13px] font-medium" data-testid="bias-headline">
          {c.headline}
        </p>
        {c.points.map((p) => (
          <p key={p} className="text-[12.5px] text-mute">
            {p}
          </p>
        ))}
      </div>
    </div>
  );
}

function Revealed({ test }: { test: BiasTest }) {
  return (
    <div className="grid gap-4" data-testid="bias-revealed">
      <div className="grid gap-1">
        <h3 className="text-[14px] font-semibold">{BIAS.revealed.title}</h3>
        <p className="max-w-[62ch] text-[12.5px] text-mute">
          {test.context.symbol} · {test.context.interval}. {BIAS.revealed.note}
        </p>
      </div>
      <BiasComparison test={test} />
      <p className="text-[12px] text-faint">{BIAS.revealed.outcomeLater}</p>
      <div>
        <Button variant="primary" onClick={() => useBiasUi.getState().leave()} data-testid="bias-done">
          {BIAS.revealed.done}
        </Button>
      </div>
    </div>
  );
}

function TestPanel({ surface, capture }: { surface: BiasSurface; capture: MirrorPanelProps["capture"] }) {
  const flow = useBiasUi((s) => s.flow);
  const reduced = useReducedFx();
  const mine = flow && flow.surface === surface ? flow : null;
  // leaving the surface (sheet closed, page changed) drops an unsaved test; a stored first answer stays in the history
  useEffect(() => () => {
    if (useBiasUi.getState().flow?.surface === surface) useBiasUi.getState().leave();
  }, [surface]);
  if (!mine) return null;
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.section
        key={mine.phase}
        aria-label={BIAS.start}
        data-testid="bias-panel"
        data-phase={mine.phase}
        className="rounded-2xl border border-line-2 bg-ink-950/40 p-4"
        initial={reduced ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={reduced ? undefined : { opacity: 0, transition: tween.exit }}
        transition={tween.fade}
      >
        {mine.phase === "setup" ? <Setup surface={surface} capture={capture} /> : null}
        {mine.phase === "first" ? <AnswerForm flow={mine} second={false} /> : null}
        {mine.phase === "flipped" ? <AnswerForm flow={mine} second /> : null}
        {mine.phase === "revealed" && mine.result ? <Revealed test={mine.result} /> : null}
      </motion.section>
    </AnimatePresence>
  );
}

const dateFmt = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });

function OutcomeForm({ test }: { test: BiasTest }) {
  const [value, setValue] = useState<OutcomeValue | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="grid gap-2" data-testid="bias-outcome-form">
      <span className="text-[12.5px] font-medium">{BIAS.history.outcomeTitle}</span>
      <Segmented<OutcomeValue> aria-label={BIAS.history.outcomeTitle} size="sm" value={value} onChange={setValue} options={OUTCOMES.map((v) => ({ v, label: BIAS.outcome[v] }))} />
      <Input value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} placeholder={BIAS.history.outcomeNote} aria-label={BIAS.history.outcomeNote} />
      <div>
        <Button
          size="sm"
          disabled={!value || busy}
          onClick={async () => {
            if (!value) return;
            setBusy(true);
            await recordOutcome(test.id, value, note);
            setBusy(false);
          }}
        >
          {BIAS.history.outcomeSave}
        </Button>
      </div>
    </div>
  );
}

function HistoryRow({ test, canResume }: { test: BiasTest; canResume: boolean }) {
  const [open, setOpen] = useState(false);
  const unfinished = isOpen(test);
  const covered = test.blind.hideName && unfinished;
  const where = covered ? BIAS.history.covered : `${test.context.symbol} · ${test.context.interval}`;
  return (
    <li className="grid gap-2 rounded-xl border border-line px-3 py-2.5" data-testid="bias-history-row" data-open={unfinished ? "true" : "false"}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <span className="min-w-0 text-[12.5px]">
          <span className="num text-faint">{dateFmt.format(new Date(test.createdAt))}</span> · {where}
        </span>
        <span className="flex flex-wrap items-center gap-2 text-[12px]">
          <span className="rounded-full border border-line-2 px-2 py-0.5">
            {BIAS.history.first}: {DIRECTION_LABEL[test.first.direction]}
          </span>
          {test.second ? (
            <span className="rounded-full border border-line-2 px-2 py-0.5">
              {BIAS.history.second}: {DIRECTION_LABEL[test.second.direction]}
            </span>
          ) : (
            <span className="text-warn">{BIAS.history.open}</span>
          )}
          {test.outcome ? <span className="text-mute">{BIAS.outcome[test.outcome.value]}</span> : null}
        </span>
      </div>
      {unfinished ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={!canResume} onClick={() => useBiasUi.getState().resume(test)} data-testid="bias-resume">
            {BIAS.history.resume}
          </Button>
          <Button size="sm" variant="danger" onClick={() => void discardOpenTest(test.id)}>
            {BIAS.history.discard}
          </Button>
          {!canResume && <span className="text-[11.5px] text-faint">{BIAS.history.resumeBlocked}</span>}
        </div>
      ) : (
        <>
          <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="justify-self-start text-[12px] text-mute underline-offset-2 hover:underline pointer-coarse:min-h-11">
            {open ? BIAS.history.collapse : BIAS.history.expand}
          </button>
          {open && (
            <div className="grid gap-3">
              <BiasComparison test={test} />
              {test.outcome ? (
                <p className="text-[12.5px] text-mute">
                  {BIAS.history.outcome}: {BIAS.outcome[test.outcome.value]}
                  {test.outcome.note ? ` – ${test.outcome.note}` : ""}
                </p>
              ) : (
                <OutcomeForm test={test} />
              )}
            </div>
          )}
          {!open && !test.outcome && <span className="text-[11.5px] text-faint">{BIAS.history.outcomeNone}</span>}
        </>
      )}
    </li>
  );
}

/** The history of past tests with both answers and the outcome the trader recorded later. */
export function BiasHistory({ surface, tradeId, canResume }: { surface?: BiasSurface; tradeId?: string; canResume?: (t: BiasTest) => boolean }) {
  const all = useBiasTests();
  const list = all.filter((t) => (surface ? t.context.surface === surface : true) && (tradeId ? t.context.tradeId === tradeId : true));
  const sum = summarize(list);
  const sorted = [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return (
    <section className="grid gap-2" aria-label={BIAS.history.title} data-testid="bias-history">
      <h3 className="label">{BIAS.history.title}</h3>
      <p className="max-w-[70ch] text-[12px] text-faint" data-testid="bias-summary">
        {sum.text}
      </p>
      {sorted.length === 0 ? (
        <p className="text-[12.5px] text-mute">{BIAS.history.empty}</p>
      ) : (
        <ul className="grid gap-2">
          {sorted.map((t) => (
            <HistoryRow key={t.id} test={t} canResume={canResume ? canResume(t) : false} />
          ))}
        </ul>
      )}
    </section>
  );
}

/** The stored tests, sanitised – re-read only when the stored key changes. */
function useBiasTests(): BiasTest[] {
  const raw = useJournal((s) => (s.settings as { biasTests?: unknown }).biasTests);
  return useMemo(() => biasTestsOf({ biasTests: raw }), [raw]);
}

/** The panel: switch + chips + the RSI option + the running test + (collapsed) history. */
export function MirrorPanel({ surface, capture, layers = LAYER_ORDER, tradeId, canResume, className }: MirrorPanelProps) {
  const uid = useId();
  const state = useMirrorState(surface);
  const flipped = useBiasUi((s) => s.flipped[surface]);
  const flow = useBiasUi((s) => s.flow);
  const prefs = useBiasUi((s) => s.prefs[surface]);
  const running = state.frozen;
  const other = flow != null && flow.surface !== surface;
  const [historyOpen, setHistoryOpen] = useState(false);
  const effective = mirrorStateOf(surface, flipped, prefs, flow);
  const tests = useBiasTests();
  const mine = tests.filter((t) => t.context.surface === surface && (!tradeId || t.context.tradeId === tradeId));
  const finished = mine.filter(isRevealed).length;
  return (
    <div className={cn("grid gap-3", className)} data-testid="bias-controls" data-flipped={effective.view.flipped ? "true" : "false"} data-phase={state.phase ?? "idle"}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 items-center gap-3">
          <Switch id={`${uid}-flip`} aria-label={BIAS.flip} checked={effective.view.flipped} disabled={state.testing} onCheckedChange={(on) => useBiasUi.getState().setFlipped(surface, on)} data-testid="bias-flip" />
          <label htmlFor={`${uid}-flip`} className="grid min-w-0 cursor-pointer">
            <span className="text-[13px] font-medium">{BIAS.flip}</span>
            <span className="text-[11.5px] text-faint" data-testid="bias-flip-note">
              {state.testing ? BIAS.flipLocked : effective.view.flipped ? BIAS.flipOn : BIAS.flipNote}
            </span>
          </label>
        </div>
        <Button size="sm" onClick={() => useBiasUi.getState().beginSetup(surface)} disabled={state.testing || other} data-testid="bias-start">
          {BIAS.start}
        </Button>
      </div>
      <LayerChips surface={surface} available={layers} locked={running} />
      {running && <p className="-mt-1 text-[11.5px] text-faint">{BIAS.layersLocked}</p>}
      {layers.includes("rsi") && effective.view.flipped && effective.view.layers.rsi && (
        <div className="grid gap-1" data-testid="bias-rsi-option">
          <label className="flex min-h-9 cursor-pointer items-center gap-3 text-[12.5px] pointer-coarse:min-h-11">
            <input
              type="checkbox"
              className="size-4 accent-white"
              checked={effective.view.rsiMirrored}
              disabled={running}
              onChange={(e) => useBiasUi.getState().setRsiMirrored(surface, e.target.checked)}
              data-testid="bias-rsi-mirror"
            />
            {BIAS.rsiMirror}
          </label>
          <span className="text-[11.5px] text-faint">{BIAS.rsiMirrorNote}</span>
        </div>
      )}
      <TestPanel surface={surface} capture={capture} />
      <div className="grid gap-2">
        <button
          type="button"
          aria-expanded={historyOpen}
          aria-controls={`${uid}-history`}
          onClick={() => setHistoryOpen((o) => !o)}
          className="justify-self-start text-[12px] text-mute underline-offset-2 hover:underline pointer-coarse:min-h-11"
          data-testid="bias-history-toggle"
        >
          {BIAS.history.title} ({finished})
        </button>
        <div id={`${uid}-history`} hidden={!historyOpen}>
          {historyOpen && <BiasHistory surface={surface} tradeId={tradeId} canResume={canResume} />}
        </div>
      </div>
    </div>
  );
}
