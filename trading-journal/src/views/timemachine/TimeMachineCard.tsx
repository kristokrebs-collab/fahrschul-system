/**
 * Zeitmaschine – the card (trader-timemachine). It takes a trade plan (direction, entry, stop, target) and the market's closed
 * candles and shows what 10 000 re-mixed sessions and every earlier occasion on the real candles say about it: the odds of
 * target first / stop first / neither with intervals, the expectancy in R, the fan of price paths, the histogram of results, the
 * worst / middle / best case, the time to exit, the earlier occasions one by one and the comparison of both with a warning when
 * they disagree. Everything is computed by `@/domain/timemachine` (the backtest engine's rules and costs, a fixed seed, no
 * language model) in a Web Worker with progress and abort; this file only starts it and shows it. A probability, not a promise:
 * the card never sends an order and never changes the plan.
 *
 * States: invalid plan (with the reason) · waiting (no autoStart) · running (progress, abort) · done · cancelled · error. A
 * changed plan marks the result on screen as outdated and (autoStart) starts the next run after a short beat.
 * Lazy: default export, import with `lazy(() => import("@/views/timemachine/TimeMachineCard"))`.
 */
import { motion } from "motion/react";
import { lazy, Suspense, type ReactNode } from "react";
import { assumptionsOf, count, durationText, MIN_EVENTS, MIN_EVENTS_SHARES, pc, pc0, planLine, rr, triggerText, TM_INTERVAL_TEXT, TM_RUNS, TM_SEED, type TmHistory, type TmResult, type Quart } from "@/domain/timemachine";
import { cn } from "@/lib/cn";
import { spring } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Button } from "@/primitives/Button";
import { Card } from "@/primitives/Card";
import { Skeleton } from "@/primitives/Skeleton";
import { VerdictPanel } from "@/primitives/VerdictPanel";
import { AnalysisNote } from "@/ui/AnalysisNote";
import { SourceStand } from "@/ui/SourceStand";
import { HistoryList } from "./HistoryList";
import { Block, OddsBar, Tile, type Share } from "./parts";
import { TM } from "./strings";
import type { TimeMachineProps } from "./types";
import { useTimeMachine, type TimeMachineRun } from "./useTimeMachine";

// the two pictures are their own chunk: a card that only shows an empty state or a progress bar never loads them
const FanChart = lazy(() => import("./FanChart"));
const Histogram = lazy(() => import("./Histogram"));

const tone = (v: number): string => (v > 0.005 ? "text-win" : v < -0.005 ? "text-loss" : "text-fg");

function quartText(q: Quart | null, interval: TmResult["interval"]): string {
  if (!q) return TM.time.none;
  return `Median ${durationText(q.p50, interval)} · 25–75 %: ${count(q.p25)}–${count(q.p75)} Kerzen`;
}

function Progress({ run }: { run: TimeMachineRun }) {
  const reduced = useReducedFx();
  const pct = Math.round(run.progress * 100);
  return (
    <div className="grid gap-2 rounded-xl border border-line bg-ink-950/50 p-3.5" data-testid="tm-busy" data-phase={run.phase ?? "pool"}>
      <div className="flex items-center justify-between gap-3 text-[12.5px]">
        <span className="text-fg">
          {TM.running} · {TM.phase[run.phase ?? "pool"]}
        </span>
        <span className="num font-mono text-mute">{pct} %</span>
      </div>
      <div role="progressbar" aria-label="Fortschritt der Zeitmaschine" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
        <motion.div className="h-full w-full origin-left rounded-full bg-fg/80" initial={false} animate={{ scaleX: Math.max(0.02, run.progress) }} transition={reduced ? { duration: 0 } : spring.smooth} />
      </div>
    </div>
  );
}

function Odds({ r }: { r: TmResult }) {
  const s = r.sim;
  const range = (p: { lo: number; hi: number }) => `${TM.odds.ci} ${pc0(p.lo)}–${pc0(p.hi)}`;
  const shares: Share[] = [
    { id: "target", label: `${TM.odds.target} (ausgefüllt)`, p: s.target.p, look: "solid" },
    { id: "stop", label: `${TM.odds.stop} (schraffiert)`, p: s.stop.p, look: "hatch" },
    ...(s.moved.k > 0 ? [{ id: "moved", label: `${TM.odds.moved} (leer)`, p: s.moved.p, look: "open" as const }] : []),
    { id: "neither", label: `${TM.odds.neither} (gepunktet)`, p: s.neither.p, look: "dots" },
  ];
  return (
    <Block title={TM.odds.title} testId="tm-odds" lead={`${count(s.runs)} ${TM.sessions}, jede ${durationText(s.horizon, r.interval)} lang. ${TM.odds.ciNote}`}>
      <div className={cn("grid gap-2", s.moved.k > 0 ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3")}>
        <Tile label={TM.odds.target} value={pc(s.target.p)} sub={range(s.target)} testId="tm-p-target" />
        <Tile label={TM.odds.stop} value={pc(s.stop.p)} sub={range(s.stop)} testId="tm-p-stop" />
        <Tile label={TM.odds.neither} value={pc(s.neither.p)} sub={TM.odds.neitherSub(durationText(s.horizon, r.interval))} testId="tm-p-neither" />
        {s.moved.k > 0 && <Tile label={TM.odds.moved} value={pc(s.moved.p)} sub={range(s.moved)} testId="tm-p-moved" />}
      </div>
      <OddsBar shares={shares} label={TM.odds.bar} />
    </Block>
  );
}

function Expectancy({ r, stocks }: { r: TmResult; stocks: boolean }) {
  const s = r.sim;
  const e = s.expectancy;
  return (
    <Block title={TM.expectancy.title} lead={stocks ? TM.expectancy.leadStocks : TM.expectancy.lead} testId="tm-expectancy">
      <div className="grid gap-2 sm:grid-cols-2">
        <Tile label="Ø je Trade, nach Kosten" value={<span className={tone(e.mean)}>{rr(e.mean)}</span>} sub={`${TM.odds.ci} ${rr(e.lo)} bis ${rr(e.hi)}`} testId="tm-e-mean" />
        <Tile label="Kosten im Schnitt" value={`${new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(s.costR)} R`} sub={stocks ? "Gebühren und Slippage je Trade" : "Gebühren, Slippage, Funding je Trade"} testId="tm-e-cost" />
      </div>
      <p className="text-[11.5px] text-faint">{TM.expectancy.noise}</p>
    </Block>
  );
}

function Cases({ r }: { r: TmResult }) {
  const c = r.sim.cases;
  return (
    <Block title={TM.cases.title} testId="tm-cases" lead={TM.cases.note}>
      <div className="grid grid-cols-3 gap-2">
        <Tile label={TM.cases.worst} value={<span className={tone(c.worst)}>{rr(c.worst)}</span>} sub={TM.cases.worstSub} testId="tm-case-worst" />
        <Tile label={TM.cases.median} value={<span className={tone(c.median)}>{rr(c.median)}</span>} sub={TM.cases.medianSub} testId="tm-case-median" />
        <Tile label={TM.cases.best} value={<span className={tone(c.best)}>{rr(c.best)}</span>} sub={TM.cases.bestSub} testId="tm-case-best" />
      </div>
      <dl className="num grid grid-cols-3 gap-x-3 gap-y-1 font-mono text-[11.5px] text-mute">
        {[
          [TM.cases.p5, c.p5],
          [TM.cases.mean, c.mean],
          [TM.cases.p95, c.p95],
        ].map(([label, v]) => (
          <div key={label as string} className="grid gap-0.5">
            <dt className="font-sans text-[10.5px] text-faint">{label as string}</dt>
            <dd>{rr(v as number)}</dd>
          </div>
        ))}
      </dl>
    </Block>
  );
}

function TimeToExit({ r }: { r: TmResult }) {
  const s = r.sim;
  return (
    <Block title={TM.time.title} testId="tm-time">
      <dl className="grid gap-2 text-[12.5px] sm:grid-cols-2">
        {[
          [TM.time.toTarget, quartText(s.timeTarget, r.interval), "tm-t-target"],
          [TM.time.toStop, quartText(s.timeStop, r.interval), "tm-t-stop"],
          [TM.time.maeTarget, s.maeTarget ? `Median ${rr(-s.maeTarget.p50)} · 75 %: ${rr(-s.maeTarget.p75)}` : TM.time.none, "tm-t-mae-target"],
          [TM.time.maeAll, s.maeAll ? `Median ${rr(-s.maeAll.p50)} · 75 %: ${rr(-s.maeAll.p75)}` : TM.time.none, "tm-t-mae"],
        ].map(([label, text, id]) => (
          <div key={id} className="grid min-w-0 gap-0.5 rounded-xl border border-line bg-ink-950/50 px-3 py-2" data-testid={id}>
            <dt className="text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">{label}</dt>
            <dd className="num text-fg">{text}</dd>
          </div>
        ))}
      </dl>
    </Block>
  );
}

function HistoryBlock({ r }: { r: TmResult }) {
  const h: TmHistory = r.history;
  return (
    <Block title={TM.history.title} lead={TM.history.lead} testId="tm-history">
      <p className="text-[12px] text-mute" data-testid="tm-history-rule">
        {TM.history.rule}: {triggerText(h.trigger, r.relative.kind)}.
      </p>
      {h.n === 0 ? (
        <p className="rounded-xl border border-dashed border-line-2 px-3 py-3 text-[12.5px] text-mute" data-testid="tm-history-empty">
          {TM.history.none}
        </p>
      ) : (
        <>
          <p className="num text-[13px] text-fg" data-testid="tm-history-summary">
            {TM.history.summary(h.n, h.target.k, h.stop.k, h.n - h.target.k - h.stop.k)}
            {h.n >= MIN_EVENTS_SHARES && h.expectancy ? ` · Ø ${rr(h.expectancy.mean)} (${TM.odds.ci} ${rr(h.expectancy.lo)} bis ${rr(h.expectancy.hi)})` : ""}
          </p>
          {h.n >= MIN_EVENTS_SHARES ? (
            <div className="grid grid-cols-3 gap-2">
              <Tile label={TM.odds.target} value={pc(h.target.p)} sub={`${TM.odds.ci} ${pc0(h.target.lo)}–${pc0(h.target.hi)}`} testId="tm-h-target" />
              <Tile label={TM.odds.stop} value={pc(h.stop.p)} sub={`${TM.odds.ci} ${pc0(h.stop.lo)}–${pc0(h.stop.hi)}`} testId="tm-h-stop" />
              <Tile label={TM.odds.neither} value={pc(h.neither.p)} sub={`${TM.odds.ci} ${pc0(h.neither.lo)}–${pc0(h.neither.hi)}`} testId="tm-h-neither" />
            </div>
          ) : (
            <p className="rounded-xl border border-warn/30 bg-warn/[0.06] px-3 py-2 text-[12.5px] text-warn" data-testid="tm-history-few">
              {TM.history.few(h.n, MIN_EVENTS_SHARES)}
            </p>
          )}
          <HistoryList events={h.events} interval={r.interval} />
        </>
      )}
      {h.unfilled > 0 && <p className="text-[11.5px] text-faint">{TM.history.unfilled(h.unfilled)}</p>}
      {h.openAtEnd > 0 && <p className="text-[11.5px] text-faint">{TM.history.openEnd}</p>}
    </Block>
  );
}

function CompareBlock({ r }: { r: TmResult }) {
  const c = r.compare;
  const fmt = (v: number | null, unit: "%" | "R"): string => (v == null ? TM.compare.noReal : unit === "%" ? pc(v) : rr(v));
  const diff = (v: number | null, unit: "%" | "R"): string => (v == null ? TM.compare.noReal : unit === "%" ? `${v > 0 ? "+" : v < 0 ? "−" : ""}${new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 }).format(Math.abs(v * 100))} Pkt.` : rr(v));
  return (
    <Block title={TM.compare.title} testId="tm-compare" lead={undefined}>
      <ul className="grid overflow-hidden rounded-xl border border-line" aria-label="Simulation und echte Vorfälle im Vergleich">
        {c.rows.map((row, k) => (
          <li key={row.id} className={cn("grid gap-1.5 px-3 py-2.5", k > 0 && "border-t border-line")} data-testid="tm-compare-row" data-row={row.id} data-off={row.off ? "true" : "false"}>
            <span className="text-[12.5px] text-mute">{row.label}</span>
            <dl className="num grid grid-cols-3 gap-2 font-mono text-[12.5px]">
              <div className="grid gap-0.5">
                <dt className="font-sans text-[10px] uppercase tracking-[0.06em] text-faint">{TM.compare.sim}</dt>
                <dd className="whitespace-nowrap text-fg">{fmt(row.sim, row.unit)}</dd>
              </div>
              <div className="grid gap-0.5">
                <dt className="font-sans text-[10px] uppercase tracking-[0.06em] text-faint">{TM.compare.real}</dt>
                <dd className="whitespace-nowrap text-fg">{fmt(row.hist, row.unit)}</dd>
              </div>
              <div className="grid gap-0.5">
                <dt className="font-sans text-[10px] uppercase tracking-[0.06em] text-faint">{TM.compare.diff}</dt>
                <dd className={cn("whitespace-nowrap", row.off ? "text-warn" : "text-mute")}>
                  {row.off && (
                    <span aria-hidden="true" className="mr-1">
                      ⚠
                    </span>
                  )}
                  {diff(row.diff, row.unit)}
                </dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>
      <p className={cn("rounded-xl border px-3 py-2 text-[12.5px] leading-snug", c.warn ? "border-warn/40 bg-warn/[0.07] text-warn" : "border-line-2 bg-white/[0.03] text-mute")} role={c.warn ? "alert" : "note"} data-testid="tm-compare-text" data-warn={c.warn ? "true" : "false"}>
        {c.warn && <span className="mr-1.5 font-semibold">⚠</span>}
        {c.text}
      </p>
      {c.status === "unavailable" && c.rows.some((x) => x.hist != null) && <p className="text-[11.5px] text-faint">Verglichen wird ab {MIN_EVENTS} Vorfällen; die Werte der echten Vorfälle sind bis dahin Beispiele.</p>}
    </Block>
  );
}

function Results({ r, run, props }: { r: TmResult; run: TimeMachineRun; props: TimeMachineProps }) {
  const stale = run.stale;
  return (
    <div className={cn("grid gap-6 transition-opacity duration-200", stale && "opacity-60")} data-testid="tm-result" data-stale={stale ? "true" : "false"} data-seed={r.seed}>
      <div className="grid gap-2">
        <VerdictPanel tone={r.verdict.tone}>
          <span data-testid="tm-verdict" data-verdict={r.verdict.id}>
            {r.verdict.text}
          </span>
        </VerdictPanel>
        {r.verdict.lines.map((l) => (
          <p key={l} className="text-[12.5px] leading-snug text-mute" data-testid="tm-verdict-line">
            {l}
          </p>
        ))}
      </div>
      <Odds r={r} />
      <Expectancy r={r} stocks={props.market === "stocks"} />
      <Block title={TM.fan.title} lead={TM.fan.lead} testId="tm-fan-block">
        <Suspense fallback={<Skeleton height={260} />}>
          <FanChart result={r} />
        </Suspense>
      </Block>
      <Block title={TM.hist.title} lead={TM.hist.lead} testId="tm-hist-block">
        <Suspense fallback={<Skeleton height={200} />}>
          <Histogram result={r} />
        </Suspense>
      </Block>
      <Cases r={r} />
      <TimeToExit r={r} />
      <HistoryBlock r={r} />
      <CompareBlock r={r} />
      {r.notes.length > 0 && (
        <Block title={TM.notes.title} testId="tm-notes">
          <ul className="grid gap-1.5 text-[12.5px] leading-snug">
            {r.notes.map((n) => (
              <li key={n.id} data-note={n.id} data-level={n.level} className={cn("flex gap-2", n.level === "warn" ? "text-warn" : "text-mute")}>
                <span aria-hidden="true" className="mt-px shrink-0">
                  {n.level === "warn" ? "⚠" : "·"}
                </span>
                <span>{n.text}</span>
              </li>
            ))}
          </ul>
        </Block>
      )}
      <details className="text-[12.5px] text-mute" data-testid="tm-assumptions">
        <summary className="cursor-pointer select-none py-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-mute pointer-coarse:min-h-11 pointer-coarse:py-3">{TM.assumptions.title}</summary>
        <ul className="mt-2 grid gap-1.5 leading-snug">
          {assumptionsOf(r, props.source)
            // a stock has no funding: the line about it ("kein Funding") would only be noise
            .map((a) => (props.market === "stocks" ? a.replace("; kein Funding.", ".") : a))
            .map((a) => (
            <li key={a} className="flex gap-2">
              <span aria-hidden="true" className="shrink-0 text-faint">
                ·
              </span>
              <span>{a}</span>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

export function TimeMachineCard(props: TimeMachineProps) {
  const run = useTimeMachine(props);
  const r = run.result;
  const autoStart = props.autoStart !== false;
  const busy = run.status === "running";
  const plan = { side: props.side, entry: props.entry, stop: props.stop, target: props.target };
  const interval = props.interval;
  const header = (
    <div className="flex flex-wrap items-center gap-2">
      {busy ? (
        <Button variant="ghost" size="sm" onClick={run.cancel} data-testid="tm-cancel">
          {TM.cancel}
        </Button>
      ) : (
        <Button size="sm" variant={r ? "secondary" : "primary"} onClick={run.start} disabled={run.status === "invalid"} data-testid="tm-start">
          {r ? TM.rerun : TM.start}
        </Button>
      )}
      {props.onClose && (
        <Button size="sm" variant="secondary" onClick={props.onClose} data-testid="tm-close">
          {TM.close}
        </Button>
      )}
    </div>
  );
  let status: ReactNode = null;
  if (run.status === "invalid")
    status = (
      <div className="rounded-xl border border-warn/30 bg-warn/[0.06] px-3.5 py-3 text-[12.5px] text-warn" role="status" data-testid="tm-invalid">
        <span className="font-semibold">{TM.invalidTitle}. </span>
        {run.reason}
      </div>
    );
  else if (busy) status = <Progress run={run} />;
  else if (run.status === "error")
    status = (
      <div className="grid gap-2 rounded-xl border border-loss/30 bg-loss/[0.06] px-3.5 py-3 text-[12.5px]" role="alert" data-testid="tm-error">
        <span className="font-semibold text-loss">{TM.errorTitle}</span>
        <span className="text-mute">{run.reason}</span>
        <Button size="sm" onClick={run.start} className="w-fit">
          {TM.retry}
        </Button>
      </div>
    );
  else if (run.status === "cancelled") status = <p className="text-[12.5px] text-mute" role="status" data-testid="tm-cancelled">{TM.cancelled}</p>;
  else if (!r) status = <p className="text-[12.5px] text-mute" data-testid="tm-idle">{autoStart ? TM.staleWait : TM.idleHint}</p>;

  const runs = r?.options.runs ?? props.options?.runs ?? TM_RUNS;
  const seed = r?.seed ?? props.seed ?? props.options?.seed ?? TM_SEED;
  const note = `${count(runs)} ${TM.sessions} · ${TM.seed} ${seed} · Kerzen: ${TM_INTERVAL_TEXT[interval] ?? interval}`;
  const body = (
    <div className="grid gap-5">
      {props.note && <p className="text-[12.5px] leading-snug text-mute">{props.note}</p>}
      <p className="num font-mono text-[12px] leading-snug text-fg" data-testid="tm-plan">
        {planLine(plan, props.symbol, interval)}
      </p>
      {run.stale && (
        <p className="rounded-xl border border-warn/30 bg-warn/[0.06] px-3.5 py-2 text-[12.5px] text-warn" role="status" data-testid="tm-stale">
          {TM.stale} {autoStart ? TM.staleWait : TM.staleManual}
        </p>
      )}
      {status}
      {r && <Results r={r} run={run} props={props} />}
      <div className="grid gap-2 border-t border-line pt-3">
        <SourceStand source={props.source ?? TM.candlesOwn} parts={[{ label: "Kerzen bis", at: r?.pool.toMs ?? null, long: true }, { label: "Abruf", at: props.fetchedAt ?? null }]} testId="tm-source" />
        {props.hosted ? (
          <p className="max-w-[72ch] text-[12px] leading-relaxed text-mute" data-testid="analysis-lead">
            {TM.noAdvice}
          </p>
        ) : (
          <AnalysisNote lead={TM.noAdvice} />
        )}
      </div>
    </div>
  );
  if (props.framed === false)
    return (
      <section className={cn("grid gap-4", props.className)} aria-label={TM.title} data-testid="tm-card" data-status={run.status}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="grid gap-0.5">
            <h2 className="label">{TM.title}</h2>
            <p className="text-xs text-faint">{note}</p>
          </div>
          {header}
        </div>
        {body}
      </section>
    );
  return (
    <Card title={TM.title} note={note} action={header} className={props.className} data-testid="tm-card" data-status={run.status}>
      {body}
    </Card>
  );
}

export default TimeMachineCard;
