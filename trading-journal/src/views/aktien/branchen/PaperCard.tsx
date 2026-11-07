/**
 * Papier-Portfolio (Branchen-Trend › Papier, C1): a green industry signal → check of the candidate with the Zeitmaschine → the risk rule →
 * exactly ONE paper position (long, ETF) with `signalId` / `simulationId` / `tradeId` → history. Red = cash: the position of that industry
 * is closed, nothing is ever sold short. An Not-Aus stops every new position; no order is sent anywhere; old data open nothing.
 * The rules are `@/domain/industryTrend/paper`; the actions live in `paperStore`.
 */
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { BASE_PARAMS, fmtDay, industryName, strategyId } from "@/domain/industryTrend";
import { bookStats, instrumentOf, MAX_SIGNAL_AGE_DAYS, positionIdOf, signalAgeDays, signalOfRow, type PaperPosition, type TrendSignal } from "@/domain/industryTrend/paper";
import { cn } from "@/lib/cn";
import { date as fmtDate, time as fmtTime } from "@/lib/format";
import { Badge } from "@/primitives/Badge";
import { Button } from "@/primitives/Button";
import { Card } from "@/primitives/Card";
import { loadTv } from "@/connect/tvStore";
import { CardNote, Mini } from "../ui";
import { BridgeLog } from "./BridgeLog";
import { useBranchen } from "./store";
import { paperNow, usePaper, type CheckRun } from "./paperStore";
import { PAPER } from "./paperStrings";

const TradeSimulationBlock = lazy(() => import("@/views/timemachine/TradeSimulationBlock"));

/** Rows of the candidate list kept free before the data are there (a row is about 106 px on a phone, 58 px wider; four rows = 448 / 256 px). */
const RESERVED_ROWS = 4;
const RESERVE_CLASS = "min-h-[448px] sm:min-h-[256px]";

const money = (v: number): string => v.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const sign = (v: number): string => `${v > 0 ? "+" : v < 0 ? "−" : ""}${money(Math.abs(v))}`;
const ageText = (age: number): string => (!Number.isFinite(age) ? "Alter unbekannt" : age < 1 ? "weniger als 1 Tag alt" : `${age.toLocaleString("de-DE", { maximumFractionDigits: 1 })} Tage alt`);
const when = (ms: number): string => `${fmtDate(new Date(ms))} ${fmtTime(new Date(ms))}`;
const short = (id: string): string => `${id.slice(0, 12)}…`;

function Rules({ run }: { run: CheckRun }) {
  const d = run.decision;
  if (!d) return null;
  return (
    <div className="grid gap-2" data-testid="paper-rules" data-ok={d.ok ? "true" : "false"}>
      <Mini>{PAPER.rulesTitle}</Mini>
      <p className="text-[12px] leading-snug text-faint">{PAPER.rulesLead}</p>
      <ul className="grid gap-1.5">
        {d.checks.map((c) => (
          <li key={c.id} className="grid grid-cols-[auto_1fr] gap-x-2 text-[12.5px] leading-snug" data-testid="paper-rule" data-rule={c.id} data-ok={c.ok ? "true" : "false"}>
            <span aria-hidden="true" className={cn("mt-px font-mono", c.ok ? "text-win" : "text-loss")}>
              {c.ok ? "✓" : "✕"}
            </span>
            <span className="min-w-0">
              <span className="font-medium text-fg">{PAPER.rule[c.id]}: </span>
              <span className={c.ok ? "text-mute" : "text-fg"}>{c.text}</span>
              <span className="sr-only">{c.ok ? " – Ja" : " – Nein"}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className={cn("rounded-xl border px-3 py-2 text-[12.5px] leading-snug", d.ok ? "border-win/30 bg-win/[0.06] text-fg" : "border-loss/30 bg-loss/[0.06] text-fg")} role="status" data-testid="paper-verdict">
        {d.ok ? PAPER.passed : PAPER.failed}
      </p>
    </div>
  );
}

function CheckPanel({ signal, run }: { signal: TrendSignal; run: CheckRun }) {
  const book = usePaper((s) => s.book);
  const openFrom = usePaper((s) => s.openFrom);
  const existing = book.positions.find((p) => p.signalId === signal.signalId);
  const d = run.decision;
  const s = d?.sizing;
  return (
    <div className="grid gap-3 rounded-xl border border-line bg-ink-950/40 p-3.5" data-testid="paper-check-panel" data-status={run.status} data-signal-id={signal.signalId}>
      {run.status === "running" && (
        <div className="grid gap-1.5" role="status" data-testid="paper-running" data-step={run.step ?? ""}>
          <p className="text-[12.5px] text-fg">{run.step ? PAPER.steps[run.step] : PAPER.checking} …</p>
          {run.step === "zeitmaschine" && (
            <div role="progressbar" aria-label="Fortschritt der Zeitmaschine" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(run.progress * 100)} className="h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
              <div className="h-full origin-left rounded-full bg-fg/80 transition-transform duration-200" style={{ transform: `scaleX(${Math.max(0.02, run.progress)})` }} />
            </div>
          )}
        </div>
      )}
      {run.status === "error" && (
        <p className="rounded-xl border border-loss/30 bg-loss/[0.06] px-3 py-2 text-[12.5px] text-fg" role="alert" data-testid="paper-error">
          <span className="font-semibold text-loss">{PAPER.checkError}. </span>
          {run.message}
        </p>
      )}
      {run.status === "done" && (
        <>
          {run.plan && instrumentOf(signal.branche) && <p className="num text-[12px] leading-snug text-mute" data-testid="paper-plan">{PAPER.planLine(instrumentOf(signal.branche)!.symbol, money(run.plan.entry), money(run.plan.stop), money(run.plan.target))}{run.source ? ` · Quelle: ${run.source}` : ""}</p>}
          <Rules run={run} />
          {d?.ok && s && (
            <p className="num text-[12.5px] text-fg" data-testid="paper-sizing">
              {PAPER.qty(s.qty, instrumentOf(signal.branche)!.symbol, money(s.entry))} · {PAPER.riskLine(money(s.riskAmount), money(s.notional))}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {existing ? (
              <Badge tone="mute" dot>
                <span data-testid="paper-already">{PAPER.alreadyOpen}</span>
              </Badge>
            ) : (
              <Button size="sm" variant="primary" disabled={!d?.ok} onClick={() => openFrom(signal)} data-testid="paper-open">
                {PAPER.open}
              </Button>
            )}
            <span className="text-[11.5px] text-faint">{PAPER.paperTag}</span>
          </div>
          {run.simulationId && (
            <details className="text-[12px] text-mute" data-testid="paper-sim">
              <summary className="cursor-pointer select-none py-1 pointer-coarse:min-h-11 pointer-coarse:py-3">{PAPER.simulation}</summary>
              <Suspense fallback={null}>
                <TradeSimulationBlock tradeId={existing?.tradeId ?? positionIdFor(signal)} className="mt-2" />
              </Suspense>
            </details>
          )}
        </>
      )}
    </div>
  );
}

const positionIdFor = (signal: TrendSignal): string => positionIdOf(signal.signalId);

function PositionRow({ p, redSignal }: { p: PaperPosition; redSignal: TrendSignal | null }) {
  const close = usePaper((s) => s.close);
  const [busy, setBusy] = useState(false);
  const closed = p.status === "closed";
  const act = async (reason: "rot" | "manuell"): Promise<void> => {
    setBusy(true);
    try {
      await close(p.id, reason, reason === "rot" ? redSignal?.signalId : undefined);
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className="grid gap-2 rounded-xl border border-line bg-ink-950/40 px-3 py-2.5" data-testid="paper-position" data-status={p.status} data-signal-id={p.signalId} data-simulation-id={p.simulationId} data-trade-id={p.tradeId} data-branche={p.branche}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Badge tone={closed ? "mute" : "win"} dot>
          {PAPER.status[p.status]}
        </Badge>
        <span className="min-w-0 flex-1 basis-40 text-[13px] text-fg">
          {industryName(p.branche)} <span className="num text-faint">{p.symbol}</span>
        </span>
        <span className="num text-[11px] text-faint">{PAPER.paperTag}</span>
      </div>
      <p className="num text-[12.5px] text-mute">
        {PAPER.qty(p.qty, p.symbol, money(p.entry))} · {when(p.openedAt)}
        {closed && p.exit != null ? ` → ${money(p.exit)} $ · ${when(p.closedAt ?? p.openedAt)} · ${PAPER.exitReason[p.exitReason ?? "manuell"]} · ${sign(p.pnl ?? 0)} $ (${(p.r ?? 0).toLocaleString("de-DE", { signDisplay: "exceptZero", maximumFractionDigits: 2 })} R)` : ""}
      </p>
      <p className="num break-all font-mono text-[11px] leading-snug text-faint" data-testid="paper-ids">
        {PAPER.ids.signal} {short(p.signalId)} · {PAPER.ids.simulation} {short(p.simulationId)} · {PAPER.ids.trade} {short(p.tradeId)}
      </p>
      {!closed && (
        <div className="flex flex-wrap items-center gap-2">
          {redSignal && <span className="text-[12px] text-warn">{PAPER.rotHint}</span>}
          {redSignal ? (
            <Button size="sm" variant="primary" disabled={busy} onClick={() => void act("rot")} data-testid="paper-close-rot">
              {busy ? PAPER.closing : PAPER.closeRot}
            </Button>
          ) : (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void act("manuell")} data-testid="paper-close">
              {busy ? PAPER.closing : PAPER.closeManual}
            </Button>
          )}
        </div>
      )}
    </li>
  );
}

export function PaperCard() {
  const ampel = useBranchen((s) => s.ampel);
  const book = usePaper((s) => s.book);
  const checks = usePaper((s) => s.checks);
  const note = usePaper((s) => s.note);
  const setKill = usePaper((s) => s.setKillSwitch);
  const check = usePaper((s) => s.check);
  const strat = useMemo(() => strategyId(BASE_PARAMS), []);
  // received signals (TradingView address) are settled against this book when the card opens (the status load starts the bridge)
  useEffect(() => {
    void loadTv();
  }, []);

  const signals = useMemo(() => (ampel ? ampel.rows.map((r) => ({ row: r, signal: signalOfRow(r, ampel.asOf, strat) })) : []), [ampel, strat]);
  const candidates = signals.filter((x) => x.row.state === "kauf" && instrumentOf(x.row.code));
  const redOf = (branche: string): TrendSignal | null => signals.find((x) => x.row.code === branche && x.row.state === "cash")?.signal ?? null;
  const stats = bookStats(book);
  const positions = [...book.positions].reverse();
  // the clock of the age shown per candidate: read at the start and at every check (the check itself reads the clock at the click)
  const [now, setNow] = useState(() => paperNow());

  return (
    <Card title={PAPER.title} className="h-full" data-testid="branchen-paper">
      <div className="grid min-w-0 gap-4">
        <p className="max-w-[80ch] text-[13px] leading-relaxed text-mute">{PAPER.lead}</p>
        <ul className="grid gap-1 text-[12px] leading-snug text-faint">
          {PAPER.honest.map((t) => (
            <li key={t} className="flex gap-2">
              <span aria-hidden="true">·</span>
              <span>{t}</span>
            </li>
          ))}
        </ul>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2" data-testid="paper-status">
          <Badge tone="mute">{PAPER.account}</Badge>
          <Badge tone="mute">
            <span data-testid="paper-open-count">{PAPER.openCount(stats.open)}</span>
          </Badge>
          <Badge tone={book.killSwitch ? "loss" : "mute"} dot>
            <span data-testid="paper-kill-state">{book.killSwitch ? PAPER.killOn : PAPER.killOff}</span>
          </Badge>
          <Button size="sm" variant={book.killSwitch ? "secondary" : "danger"} aria-pressed={book.killSwitch} onClick={() => setKill(!book.killSwitch)} data-testid="paper-kill">
            {book.killSwitch ? PAPER.killTurnOff : PAPER.killTurnOn}
          </Button>
        </div>
        <p className="text-[11.5px] text-faint">{PAPER.killHelp}</p>
        {note && (
          <p className="rounded-xl border border-line-2 bg-white/[0.03] px-3 py-2 text-[12.5px] text-fg" role="status" data-testid="paper-note">
            {note}
          </p>
        )}

        <section aria-labelledby="paper-cand-h" className="grid gap-2">
          <Mini>
            <span id="paper-cand-h">{PAPER.candidates}</span>
          </Mini>
          <p className="text-[12px] text-faint">{PAPER.candidatesLead}</p>
          {!ampel ? (
            <div className="grid gap-2" data-testid="paper-no-ampel-wrap">
              <p className="text-[13px] text-mute" data-testid="paper-no-ampel">
                {PAPER.noAmpel}
              </p>
              {/* the place of the list is kept while the data come (a few rows high; a longer list grows from here) */}
              <div aria-hidden="true" className="grid gap-2" data-testid="paper-candidates-reserve">
                {Array.from({ length: RESERVED_ROWS }, (_, i) => (
                  <div key={i} className="min-h-[106px] rounded-xl border border-dashed border-line bg-ink-950/20 sm:min-h-[58px]" />
                ))}
              </div>
            </div>
          ) : candidates.length === 0 ? (
            <p className={cn("text-[13px] text-mute", RESERVE_CLASS)} data-testid="paper-no-candidates">
              {PAPER.noCandidates}
            </p>
          ) : (
            <ul className={cn("grid content-start gap-2", RESERVE_CLASS)} data-testid="paper-candidates">
              {candidates.map(({ row, signal }) => {
                const run = checks[signal.signalId];
                const inst = instrumentOf(row.code)!;
                const age = signalAgeDays(signal.asOf, now);
                const running = run?.status === "running";
                return (
                  <li key={row.code} className="grid gap-2" data-testid="paper-candidate" data-branche={row.code} data-signal-id={signal.signalId}>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-line bg-ink-950/40 px-3 py-2">
                      <span className="min-w-0 flex-1 basis-44 text-[13px] text-fg">
                        {industryName(row.code)} <span className="num text-faint">{row.code}</span>
                        <span className="block text-[11.5px] text-mute">
                          {inst.symbol} · {inst.name}
                        </span>
                      </span>
                      <span className={cn("num text-[11.5px]", age > MAX_SIGNAL_AGE_DAYS ? "text-warn" : "text-mute")} data-testid="paper-age">
                        {PAPER.dataStand(fmtDay(signal.asOf), ageText(age))}
                      </span>
                      <Button size="sm" variant="secondary" disabled={running} onClick={() => {
                          setNow(paperNow());
                          void check(signal);
                        }}
                        data-testid="paper-check">
                        {running ? PAPER.checking : run ? PAPER.checkAgain : PAPER.check}
                      </Button>
                    </div>
                    {run && <CheckPanel signal={signal} run={run} />}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <BridgeLog />

        <section aria-labelledby="paper-pos-h" className="grid gap-2">
          <Mini>
            <span id="paper-pos-h">{PAPER.positions}</span>
          </Mini>
          {stats.closed > 0 && (
            <p className="num text-[12.5px] text-mute" data-testid="paper-stats">
              {PAPER.stats(stats.closed, sign(stats.pnl), stats.r.toLocaleString("de-DE", { signDisplay: "exceptZero", maximumFractionDigits: 2 }))}
            </p>
          )}
          {positions.length === 0 ? (
            <p className="text-[13px] text-mute" data-testid="paper-empty">
              {PAPER.positionsEmpty}
            </p>
          ) : (
            <ul className="grid gap-2" data-testid="paper-positions">
              {positions.map((p) => (
                <PositionRow key={p.id} p={p} redSignal={p.status === "open" ? redOf(p.branche) : null} />
              ))}
            </ul>
          )}
        </section>
        <CardNote lead="Papier und Simulation: keine Order, keine Prognose, kein Rat." />
      </div>
    </Card>
  );
}
