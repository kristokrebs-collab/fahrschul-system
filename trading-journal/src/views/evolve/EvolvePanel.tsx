/**
 * The background optimiser as a panel (Hintergrund-Optimierer). A host hands in the strategies, their candles and what to do
 * on "save" / "challenger" (`types.ts`); the panel shows the strategies, the controls (start, pause, stop – and always
 * "Läuft nur, solange die App offen ist"), the progress, a leaderboard per strategy, the tournament, the proposals and the
 * learning card. Lazy-friendly: the default export is the whole panel, the protocol drawer is a chunk of its own.
 *
 * The panel never changes a strategy by itself: a run ends in OPEN proposals; saving, testing live and rejecting are the user's
 * clicks on a proposal, and the host callbacks run only after such a click.
 */
import { lazy, Suspense, useEffect, useId, useMemo, useRef, useState } from "react";
import { MAX_STRATEGIES, evolveCfgOf, freedomOf, type Power, type StoredProposal } from "@/domain/evolve";
import { sanitizeCustom, validateCustom } from "@/domain/lab";
import { cn } from "@/lib/cn";
import { Badge, type BadgeTone } from "@/primitives/Badge";
import { Button } from "@/primitives/Button";
import { Card } from "@/primitives/Card";
import { Collapse, Expander } from "@/primitives/Expander";
import { EmptyState } from "@/primitives/EmptyState";
import { Segmented } from "@/primitives/Segmented";
import { useJournal } from "@/store/journalStore";
import { DEFAULT_BUDGET, useEvolve, type RunStatus } from "./evolveStore";
import { dayText } from "./fmt";
import { Leaderboard, WindowsStrip } from "./Leaderboard";
import { LearnedCard } from "./LearnedCard";
import { ProposalCard } from "./ProposalCard";
import { DISCLAIMER, EVOLVE } from "./strings";
import { Tournament } from "./Tournament";
import type { EvolvePanelProps, StrategyEntry } from "./types";

const ProtocolSheet = lazy(() => import("./ProtocolSheet"));
const E = EVOLVE;
const BUDGETS = [200, 400, 1000] as const;

const STATUS_TONE: Record<RunStatus, BadgeTone> = { idle: "mute", starting: "steel", running: "win", paused: "warn", stopping: "steel", done: "teal", error: "loss" };

const seedNow = (): number => Math.floor(Date.now() % 2_147_483_647) || 1;

function issueOf(e: StrategyEntry): string | null {
  const bad = validateCustom(sanitizeCustom(e.config), { funding: e.engine.costs.funding.kind === "history" }).find((i) => i.level === "error");
  return bad ? bad.text : null;
}

export function EvolvePanel({ strategies, candles, candleStatus, onLoadCandles, onSaveVersion, onStartChallenger, defaultSelected, budget: budgetProp, seed, className }: EvolvePanelProps) {
  const uid = useId();
  const status = useEvolve((s) => s.status);
  const snapshot = useEvolve((s) => s.snapshot);
  const result = useEvolve((s) => s.result);
  const throttle = useEvolve((s) => s.throttle);
  const via = useEvolve((s) => s.via);
  const error = useEvolve((s) => s.error);
  const book = useEvolve((s) => s.book);
  const raw = useJournal((s) => s.settings.evolve);
  const cfg = useMemo(() => evolveCfgOf(raw), [raw]);
  const power: Power = cfg.prefs.power;

  const initial = useMemo(() => new Set(defaultSelected ?? strategies.slice(0, 3).map((s) => s.id)), [defaultSelected, strategies]);
  const [selected, setSelected] = useState<ReadonlySet<string>>(initial);
  const [budget, setBudget] = useState<number>(budgetProp ?? DEFAULT_BUDGET);
  // a start that is waiting for candles (a ref: it is read by the effect below, never rendered)
  const wantStart = useRef(false);
  const [protocolSeen, setProtocolSeen] = useState(false);
  const [protocolOpen, setProtocolOpen] = useState(false);
  const [decidedOpen, setDecidedOpen] = useState(false);

  const issues = useMemo(() => Object.fromEntries(strategies.map((s) => [s.id, issueOf(s)])), [strategies]);
  const chosen = useMemo(() => strategies.filter((s) => selected.has(s.id) && !issues[s.id]).slice(0, MAX_STRATEGIES), [strategies, selected, issues]);
  const busy = status === "starting" || status === "running" || status === "paused" || status === "stopping";
  const names = useMemo(() => Object.fromEntries(strategies.map((s) => [s.id, s.name])), [strategies]);
  const byId = useMemo(() => new Map(strategies.map((s) => [s.id, s])), [strategies]);

  const begin = (): void => {
    if (!chosen.length || busy) return;
    const missing = chosen.filter((s) => !candles[s.id]).map((s) => s.id);
    if (missing.length) {
      wantStart.current = true;
      onLoadCandles?.(missing);
      return;
    }
    useEvolve.getState().start({ entries: chosen, candles, budget, seed: seed ?? seedNow(), power });
  };

  // a start that waited for candles goes on as soon as they are there (or gives up when loading failed)
  useEffect(() => {
    if (!wantStart.current) return;
    if (chosen.some((s) => candleStatus?.[s.id]?.state === "error")) {
      wantStart.current = false;
      return;
    }
    if (chosen.length && chosen.every((s) => candles[s.id])) {
      wantStart.current = false;
      useEvolve.getState().start({ entries: chosen, candles, budget, seed: seed ?? seedNow(), power });
    }
  }, [chosen, candles, candleStatus, budget, seed, power]);

  const toggle = (id: string): void =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const proposals = cfg.proposals;
  const open = proposals.filter((p) => p.decision === "open").sort((a, b) => b.createdAt - a.createdAt);
  const decided = proposals.filter((p) => p.decision !== "open").sort((a, b) => (b.decidedAt ?? b.createdAt) - (a.decidedAt ?? a.createdAt));
  const logTotal = Object.values(book).reduce((s, l) => s + l.total, 0);
  const pct = Math.round((snapshot?.progress ?? 0) * 100);
  const loading = chosen.filter((s) => candleStatus?.[s.id]?.state === "loading");
  const candleErrors = chosen.map((s) => candleStatus?.[s.id]).filter((c) => c?.state === "error");

  const card = (p: StoredProposal) => <ProposalCard key={p.id} proposal={p} entry={byId.get(p.sid)} onSave={onSaveVersion} onChallenger={onStartChallenger} />;

  return (
    <div className={cn("grid min-w-0 gap-4", className)} data-testid="evolve-panel" data-status={status}>
      <Card
        title={E.title}
        action={
          <Badge tone={STATUS_TONE[status]} dot ping={status === "running"}>
            <span data-testid="evolve-status">{E.status[status]}</span>
          </Badge>
        }
      >
        <div className="grid gap-4">
          <p className="max-w-[78ch] text-[13px] leading-relaxed text-mute">{E.lead}</p>
          <div className="grid gap-1.5 rounded-xl border border-line bg-ink-950/50 p-3" data-testid="evolve-open-note">
            <p className="text-[13px] font-semibold">{E.openNote}</p>
            <p className="text-[12px] leading-relaxed text-mute">{E.openNoteMore}</p>
            <p className="text-[12px] leading-relaxed text-mute">{E.neverAuto}</p>
          </div>

          <section aria-label={E.strategies} className="grid gap-2">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <h3 className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-mute">{E.strategies}</h3>
              <span className="text-[11px] text-faint">{E.strategiesHint(MAX_STRATEGIES)}</span>
            </div>
            {!strategies.length ? (
              <EmptyState title="Keine Strategie" text={E.noStrategies} line={false} />
            ) : (
              <ul className="grid gap-1.5" data-testid="evolve-strategies">
                {strategies.map((s) => {
                  const on = selected.has(s.id) && !issues[s.id];
                  const c = candles[s.id];
                  const st = candleStatus?.[s.id];
                  const prior = cfg.lineages[s.id]?.trials ?? 0;
                  return (
                    <li key={s.id} data-testid="evolve-strategy" data-id={s.id} data-on={on ? "yes" : "no"}>
                      <label className={cn("grid cursor-pointer grid-cols-[auto_minmax(0,1fr)] items-start gap-3 rounded-xl border bg-ink-950/50 px-3 py-2.5 pointer-coarse:min-h-11", on ? "border-line-2" : "border-line", (busy || issues[s.id]) && "cursor-default opacity-80")}>
                        <input type="checkbox" checked={on} disabled={busy || !!issues[s.id]} onChange={() => toggle(s.id)} className="mt-1 size-4 accent-white" aria-describedby={`${uid}-${s.id}`} />
                        <span className="grid min-w-0 gap-0.5">
                          <span className="flex flex-wrap items-baseline gap-x-2">
                            <span className="truncate text-[13px] font-medium">{s.name}</span>
                            <span className="num text-[11.5px] text-faint">
                              {s.symbol} · {s.config.interval === "1d" ? "1D" : s.config.interval}
                              {s.versionLabel ? ` · ${s.versionLabel}` : ""}
                            </span>
                          </span>
                          <span id={`${uid}-${s.id}`} className="num text-[11.5px] leading-snug text-mute">
                            {issues[s.id] ? E.invalid(issues[s.id]!) : `${E.freedom(freedomOf(sanitizeCustom(s.config)).total)} · ${E.priorTrials(prior)} · ${st?.state === "loading" ? E.loadingCandles : st?.state === "error" ? (st.message ?? "Kerzen konnten nicht geladen werden") : c ? E.hasCandles(c.data[s.config.interval]?.length ?? 0, dayText(c.toMs)) : E.noCandles}`}
                          </span>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
            {candleErrors.length > 0 && (
              <p role="alert" className="text-[12px] text-(--color-danger-text)">
                {candleErrors[0]?.message ?? "Kerzen konnten nicht geladen werden."}
              </p>
            )}
          </section>

          <div className="flex flex-wrap items-end justify-between gap-3" data-testid="evolve-controls">
            <div className="flex flex-wrap gap-2">
              {(status === "idle" || status === "done" || status === "error") && (
                <Button variant="primary" onClick={begin} disabled={!chosen.length || loading.length > 0} data-testid="evolve-start">
                  {loading.length ? E.loadingCandles : status === "done" ? E.controls.again : E.controls.start}
                </Button>
              )}
              {status === "starting" && (
                <Button variant="primary" disabled data-testid="evolve-start">
                  {E.status.starting} …
                </Button>
              )}
              {status === "running" && (
                <Button onClick={() => useEvolve.getState().pause()} data-testid="evolve-pause">
                  {E.controls.pause}
                </Button>
              )}
              {status === "paused" && (
                <Button variant="primary" onClick={() => useEvolve.getState().resume()} data-testid="evolve-resume">
                  {E.controls.resume}
                </Button>
              )}
              {(status === "running" || status === "paused") && (
                <Button onClick={() => useEvolve.getState().stop()} data-testid="evolve-stop">
                  {E.controls.stop}
                </Button>
              )}
              {busy && (
                <Button variant="danger" onClick={() => useEvolve.getState().abort()} data-testid="evolve-abort">
                  {E.controls.abort}
                </Button>
              )}
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <div className="grid gap-1">
                <span className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-mute">{E.controls.budget}</span>
                <Segmented aria-label={E.controls.budget} size="sm" value={String(budget)} onChange={(v) => setBudget(Number(v))} options={BUDGETS.map((b) => ({ v: String(b), label: String(b), disabled: busy }))} />
              </div>
              <div className="grid gap-1">
                <span className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-mute">{E.controls.power}</span>
                <Segmented aria-label={E.controls.power} size="sm" value={power} onChange={(v) => useEvolve.getState().setPower(v)} options={(["gentle", "normal", "full"] as const).map((p) => ({ v: p, label: E.controls.powers[p] }))} />
              </div>
            </div>
          </div>
          {!chosen.length && strategies.length > 0 && <p className="text-[12px] text-faint">{E.controls.startHint}</p>}
          {error && (
            <p role="alert" className="text-[12.5px] text-(--color-danger-text)" data-testid="evolve-error">
              {error}
            </p>
          )}

          {snapshot && (busy || status === "done") && (
            <section className="grid gap-3" aria-label={E.progress.label} data-testid="evolve-progress">
              <div className="grid gap-1.5">
                <div role="progressbar" aria-label={E.progress.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
                  <div className="h-full w-full origin-left rounded-full bg-white transition-transform duration-300 motion-reduce:transition-none" style={{ transform: `scaleX(${Math.max(0.005, snapshot.progress)})` }} />
                </div>
                <p className="num flex flex-wrap justify-between gap-x-3 text-[11.5px] text-mute">
                  <span data-testid="evolve-trials">{E.progress.trials(snapshot.trialsDone, snapshot.trialsBudget)}</span>
                  <span>{pct} %</span>
                </p>
              </div>
              <ul className="grid gap-1.5">
                {snapshot.strategies.map((s) => (
                  <li key={s.id} className="grid gap-0.5 rounded-xl border border-line bg-ink-950/50 px-3 py-2 text-[12px]" data-testid="evolve-strategy-progress" data-id={s.id} data-phase={s.phase}>
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <span className="font-medium">{s.name}</span>
                      <span className="num text-mute">
                        {s.error ? "nicht möglich" : `${E.phases[s.phase]} · ${E.progress.trials(Math.min(s.trials, s.budget), s.budget)}`}
                      </span>
                    </div>
                    {s.error && <p className="text-[11.5px] text-(--color-danger-text)">{s.error}</p>}
                    {!s.error && s.lastText && s.phase === "search" && (
                      <p className="truncate text-[11.5px] text-faint">
                        {E.progress.last}: {s.lastText}
                      </p>
                    )}
                    {!s.error && s.stagnation >= 20 && <p className="text-[11.5px] text-faint">{E.progress.stagnation(s.stagnation)}</p>}
                    {s.notes.map((n) => (
                      <p key={n} className="text-[11.5px] leading-relaxed text-warn">
                        {n}
                      </p>
                    ))}
                  </li>
                ))}
              </ul>
              {(throttle?.reason || via) && (
                <p className="text-[11.5px] leading-relaxed text-faint" data-testid="evolve-throttle">
                  {throttle?.reason ? `${throttle.reason}. ` : ""}
                  {via ? E.progress.via[via] : ""}
                  {status === "paused" ? " Pausiert – es wird nichts gerechnet." : ""}
                </p>
              )}
            </section>
          )}

          {snapshot && snapshot.strategies.some((s) => s.windows) && (
            <div className="grid gap-4">
              {snapshot.strategies.map((s) =>
                s.windows ? (
                  <div key={s.id} className="grid gap-3 border-t border-line pt-3">
                    <Leaderboard snap={s} />
                    <WindowsStrip windows={s.windows} />
                  </div>
                ) : null,
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
            <Button
              size="sm"
              onClick={() => {
                setProtocolSeen(true);
                setProtocolOpen(true);
              }}
              data-testid="evolve-protocol-open"
            >
              {E.protocol.open(logTotal)}
            </Button>
            <p className="text-[11.5px] text-faint" data-testid="evolve-disclaimer">
              {DISCLAIMER}
            </p>
          </div>
        </div>
      </Card>

      {result && <Tournament result={result} />}

      <section className="grid gap-3" aria-label={E.proposals.title} data-testid="evolve-proposals">
        <div className="grid gap-0.5">
          <h3 className="text-[12px] font-semibold uppercase tracking-[0.1em] text-mute">{E.proposals.title}</h3>
          <p className="text-[12px] text-faint">{E.proposals.sub}</p>
        </div>
        {result?.strategies.some((s) => s.error) &&
          result.strategies
            .filter((s) => s.error)
            .map((s) => (
              <p key={s.id} className="text-[12px] text-(--color-danger-text)">
                {E.proposals.failed(names[s.id] ?? s.id, s.error!)}
              </p>
            ))}
        {result && result.strategies.filter((s) => !s.error && !s.proposals.length).map((s) => (
          <p key={s.id} className="rounded-xl border border-line bg-ink-950/50 px-3 py-2 text-[12.5px] leading-relaxed text-mute" data-testid="evolve-nothing" data-id={s.id}>
            <span className="font-medium text-fg">{names[s.id] ?? s.id}: </span>
            {E.proposals.nothing(s.trials)}
          </p>
        ))}
        {!open.length && !result ? <EmptyState title="Noch kein Vorschlag" text={E.proposals.empty} line={false} /> : null}
        {open.map(card)}
        {decided.length > 0 && (
          <div className="grid gap-2">
            <div className="flex items-center justify-between gap-3 rounded-xl border border-line px-3 py-2">
              <span className="text-[12.5px] font-medium">Entschieden ({decided.length})</span>
              <Expander open={decidedOpen} onToggle={() => setDecidedOpen((v) => !v)} label="Entschiedene Vorschläge" controls={`${uid}-decided`} />
            </div>
            <Collapse open={decidedOpen} id={`${uid}-decided`}>
              <div className="grid gap-4 pt-1" data-testid="evolve-decided-list">
                {decided.map(card)}
              </div>
            </Collapse>
          </div>
        )}
      </section>

      <LearnedCard />

      {protocolSeen && (
        <Suspense fallback={null}>
          <ProtocolSheet open={protocolOpen} onClose={() => setProtocolOpen(false)} book={book} names={names} />
        </Suspense>
      )}
    </div>
  );
}

export default EvolvePanel;
