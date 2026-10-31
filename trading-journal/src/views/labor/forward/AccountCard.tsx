/**
 * One virtual account (F23): status, "Stand: bis Kerzenschluss …" (honest about what has been calculated), equity curve, key
 * numbers with their sample size and uncertainty, the open position, the frozen rules, the trades, and the comparison with the
 * backtest of the same rules. Pause / resume / end / delete (the last two ask first).
 */
import { useId, useMemo, useState } from "react";
import { EXIT_LABEL } from "@/domain/backtest/index";
import { customKey, summarizeCustom } from "@/domain/lab";
import { accountView, LOOKBACK_DAYS, MAX_TRADES, type ForwardAccount, type Lookback } from "@/domain/forward";
import { HIST_MS } from "@/domain/backtest/types";
import { cn } from "@/lib/cn";
import { dateTime, price as fmtPrice, time as fmtTime } from "@/lib/format";
import { EquityDraw } from "@/motion/fx/EquityDraw";
import { Badge } from "@/primitives/Badge";
import { Button } from "@/primitives/Button";
import { Card } from "@/primitives/Card";
import { Collapse } from "@/primitives/Expander";
import { pushToast } from "@/store/uiStore";
import { useLabor } from "../laborStore";
import { ChipPick, Kpi, moneyText, pctText, pfText, rText } from "../ui";
import { endById, pauseById, removeById, resumeById } from "./forwardActions";
import { catchUp, runCompare } from "./forwardRunner";
import { IDLE_COMPARE, IDLE_RUNTIME, useForwardRuntime } from "./forwardStore";
import { FORWARD } from "./strings";

const F = FORWARD;
const TF = (iv: string): string => (iv === "1d" ? "1D" : iv);
const when = (ms: number): string => dateTime(new Date(ms));
const TRADES_SHOWN = 40;

const STATUS_TONE = { running: "win", paused: "warn", ended: "mute" } as const;
const sideWord = (s: "long" | "short"): string => (s === "long" ? "Long" : "Short");

export function AccountCard({ account: a, className }: { account: ForwardAccount; className?: string }) {
  const uid = useId();
  const view = useMemo(() => accountView(a), [a]);
  const rt = useForwardRuntime((s) => s.byId[a.id] ?? IDLE_RUNTIME);
  const cmp = useForwardRuntime((s) => s.compare[a.id] ?? IDLE_COMPARE);
  const drafts = useLabor((s) => s.drafts);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [tradesOpen, setTradesOpen] = useState(false);
  const [cmpOpen, setCmpOpen] = useState(false);
  const [ask, setAsk] = useState<"end" | "remove" | null>(null);
  const [lookback, setLookback] = useState<Lookback>(365);
  const s = view.stats;
  const ivMs = HIST_MS[a.interval];
  // close of the next candle that will count: the one after the last processed, or the first one at all
  const nextClose = a.cursor.t != null ? a.cursor.t * 1000 + 2 * ivMs : a.startMs + ivMs;
  const busy = rt.phase !== "idle";
  const lines = useMemo(() => summarizeCustom(a.config), [a.config]);
  // the saved draft the account started from has been edited since: its rules are a new version
  const draftChanged = a.source.kind === "draft" && drafts.some((d) => d.name === a.source.label && customKey(d.config) !== a.key);
  const tone = (v: number | null | undefined): string => ((v ?? 0) > 0 ? "text-win" : (v ?? 0) < 0 ? "text-loss" : "text-fg");
  const trades = useMemo(() => [...a.trades].reverse(), [a.trades]);

  const refresh = async (): Promise<void> => {
    const r = await catchUp(a.id);
    if (r.kind === "error") pushToast({ kind: "error", title: r.message });
  };

  return (
    <Card
      title={a.name}
      note={`${a.symbol} · ${TF(a.interval)} · ${F.started_at(when(a.createdAt))}`}
      className={className}
      data-testid="forward-account"
      data-status={a.status}
      data-id={a.id}
      action={
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          {a.source.foreign && (
            <Badge tone="warn" title="Regeln aus einem Playbook von jemand anderem – nicht von dir geprüft">
              {F.foreign}
            </Badge>
          )}
          <Badge tone="steel">{F.source[a.source.kind]}{a.source.versionNo ? ` · V${a.source.versionNo}` : ""}</Badge>
          <Badge tone={STATUS_TONE[a.status]} dot ping={a.status === "running"}>
            <span data-testid="forward-status">{F.status[a.status]}</span>
          </Badge>
        </div>
      }
    >
      <div className="grid gap-4">
        <div className="grid gap-1">
          <p className="num text-[13px] font-medium" data-testid="forward-stand">
            {view.upTo != null ? F.upTo(when(view.upTo), TF(a.interval)) : F.noCandleYet(when(nextClose), TF(a.interval))}
          </p>
          <p className="text-[11.5px] text-faint" role="status" data-testid="forward-runtime" data-phase={rt.phase}>
            {rt.error ? <span className="text-(--color-danger-text)">{rt.error}</span> : rt.phase === "loading" ? (rt.load.total ? `${F.runtime.loading} ${rt.load.done}/${Math.max(rt.load.done, rt.load.total)}` : F.runtime.loading) : rt.phase === "calc" ? F.runtime.calc : rt.checkedAt ? F.checked(fmtTime(new Date(rt.checkedAt))) : F.statusHint[a.status]}
            {a.status === "paused" && rt.phase === "idle" && !rt.error && <span> {F.statusHint.paused}</span>}
          </p>
          {a.status === "ended" && a.endReason && (
            <p className="text-[11.5px] text-faint">
              {F.status.ended}: {F.endReason[a.endReason]}{a.endedAt ? `, ${when(a.endedAt)}` : ""}.
            </p>
          )}
          {a.endReason === "limit" && <p className="text-[11.5px] text-warn">{F.limit(MAX_TRADES)}</p>}
          {rt.rebuilt && <p className="text-[11.5px] text-faint">{F.rebuilt}</p>}
        </div>

        {draftChanged && (
          <p className="rounded-xl border border-warn/30 bg-warn/8 px-3 py-2 text-[12px] leading-relaxed text-warn" data-testid="forward-changed">
            {F.changedRules}
          </p>
        )}

        {view.curve.length > 1 && <EquityDraw values={view.curve} baseline={0} height={72} label={`${a.name}: ${pctText(view.nowPct)}`} />}

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6" data-testid="forward-kpis">
          <Kpi label={F.kpi.equity} tone={tone(view.nowPct)} sub={pctText(view.nowPct)}>
            {moneyText(view.now, "USDT", false)}
          </Kpi>
          <Kpi label={F.kpi.trades} sub={F.sample(s.n)}>
            {s.n}
          </Kpi>
          <Kpi label={F.kpi.winRate} sub={s.winRateCI ? `${pctText(s.winRateCI.lo, 0, false)} – ${pctText(s.winRateCI.hi, 0, false)}` : undefined}>
            {pctText(s.winRate, 0, false)}
          </Kpi>
          <Kpi label={F.kpi.avgR} tone={tone(s.avgR)} sub={s.rCI ? `${rText(s.rCI.lo, 1)} – ${rText(s.rCI.hi, 1)}` : undefined}>
            {rText(s.avgR)}
          </Kpi>
          <Kpi label={F.kpi.pf}>{pfText(s.pf)}</Kpi>
          <Kpi label={F.kpi.dd}>{s.n || view.hasData ? pctText(-s.maxDD, 1, false) : "–"}</Kpi>
        </div>
        <p className="text-[11.5px] leading-relaxed text-faint" data-testid="forward-sample">
          {s.n < 10 ? F.sampleThin(s.n) : F.sample(s.n)} 80-%-Bereiche unter den Zahlen. {F.ddNote}
        </p>

        {(view.open || view.pendingEntry) && (
          <div className="rounded-xl border border-line bg-ink-950/50 px-3 py-2.5 text-[12.5px]" data-testid="forward-open">
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-mute">{F.openPos}</span>
            {view.open && (
              <p className="num mt-1">
                {F.openSince(sideWord(view.open.side), when(view.open.since))} · {F.entryLabel} {fmtPrice(view.open.entry)} · {F.stopLabel} {fmtPrice(view.open.stop)} · {F.targetLabel} {view.open.target != null ? fmtPrice(view.open.target) : "–"} ·{" "}
                <span className={tone(view.open.unrealised)}>{moneyText(view.open.unrealised, "USDT")}</span>
              </p>
            )}
            {view.pendingEntry && <p className="mt-1 text-mute">{F.pending(sideWord(view.pendingEntry))}</p>}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => void refresh()} disabled={busy || a.cursor.done} data-testid="forward-refresh">
            {F.refresh}
          </Button>
          {a.status === "running" && (
            <Button size="sm" onClick={() => void pauseById(a.id)} data-testid="forward-pause">
              {F.pause}
            </Button>
          )}
          {a.status === "paused" && (
            <Button size="sm" onClick={() => void resumeById(a.id)} data-testid="forward-resume">
              {F.resume}
            </Button>
          )}
          {a.status !== "ended" && (
            <Button size="sm" variant="secondary" onClick={() => setAsk(ask === "end" ? null : "end")} aria-expanded={ask === "end"} data-testid="forward-end">
              {F.end}
            </Button>
          )}
          <Button size="sm" variant="danger" onClick={() => setAsk(ask === "remove" ? null : "remove")} aria-expanded={ask === "remove"} data-testid="forward-remove">
            {F.remove}
          </Button>
        </div>
        {ask && (
          <div className="grid gap-2 rounded-xl border border-line bg-ink-950/50 p-3" role="alert" data-testid="forward-confirm">
            <p className="text-[12.5px] leading-relaxed text-mute">{ask === "end" ? F.endAsk : F.removeAsk}</p>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="danger"
                onClick={() => {
                  setAsk(null);
                  void (ask === "end" ? endById(a.id) : removeById(a.id));
                }}
                data-testid="forward-confirm-yes"
              >
                {ask === "end" ? F.endYes : F.removeYes}
              </Button>
              <Button size="sm" onClick={() => setAsk(null)}>
                {F.no}
              </Button>
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => setRulesOpen((o) => !o)} aria-expanded={rulesOpen} aria-controls={`${uid}-rules`} data-testid="forward-rules-toggle">
            {rulesOpen ? F.rulesHide : F.rulesShow}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setTradesOpen((o) => !o)} aria-expanded={tradesOpen} aria-controls={`${uid}-trades`} data-testid="forward-trades-toggle">
            {tradesOpen ? F.tradesHide(a.trades.length) : F.tradesShow(a.trades.length)}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setCmpOpen((o) => !o)} aria-expanded={cmpOpen} aria-controls={`${uid}-cmp`} data-testid="forward-compare-toggle">
            {F.cmpTitle}
          </Button>
        </div>

        <Collapse open={rulesOpen} id={`${uid}-rules`}>
          <ul className="grid gap-1 rounded-xl border border-line bg-ink-950/50 p-3 text-[12.5px] leading-relaxed text-fg/85" data-testid="forward-rules-list">
            {lines.map((l) => (
              <li key={l}>{l}</li>
            ))}
            <li className="text-faint">
              Kapital {moneyText(a.capital, "USDT", false)} · Risiko {String(a.riskPct).replace(".", ",")} % · max. Hebel {a.maxLeverage} × · Gebühren {a.exchange} · Funding {a.funding === "history" ? "Historie" : a.funding === "flat" ? "0,01 % / 8 h" : "keins"}
            </li>
          </ul>
        </Collapse>

        <Collapse open={tradesOpen} id={`${uid}-trades`}>
          {!trades.length ? (
            <p className="text-[12.5px] text-mute">{F.noTrades}</p>
          ) : (
            <div className="grid gap-1" data-testid="forward-trades">
              <ul className="grid">
                {trades.slice(0, TRADES_SHOWN).map((t, i) => (
                  <li key={t.id} className={cn("grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-0.5 py-2 text-[12.5px]", i > 0 && "border-t border-line")} data-testid="forward-trade">
                    <span className="min-w-0 truncate">
                      <span className={cn("font-medium", t.side === "long" ? "text-win" : "text-loss")}>{sideWord(t.side)}</span> {fmtPrice(t.entry)} → {fmtPrice(t.exit)} <span className="text-faint">· {EXIT_LABEL[t.reason]}</span>
                    </span>
                    <span className={cn("num font-mono", tone(t.pnl))}>{rText(t.r)}</span>
                    <span className="num text-[11px] text-faint">{when(t.exitTime)}</span>
                    <span className={cn("num font-mono text-[11px]", tone(t.pnl))}>{moneyText(t.pnl, "USDT")}</span>
                  </li>
                ))}
              </ul>
              {trades.length > TRADES_SHOWN && <p className="text-[11.5px] text-faint">{F.tradesCap(TRADES_SHOWN, trades.length)}</p>}
            </div>
          )}
        </Collapse>

        <Collapse open={cmpOpen} id={`${uid}-cmp`}>
          <div className="grid gap-3 rounded-xl border border-line bg-ink-950/50 p-3" data-testid="forward-compare">
            <p className="text-[12.5px] leading-relaxed text-mute">{F.cmpLead}</p>
            <div className="flex flex-wrap items-end gap-3">
              <div className="grid gap-1.5">
                <span className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-mute">{F.cmpPeriod}</span>
                <ChipPick id={`${uid}-lb`} label={F.cmpPeriod} value={lookback} options={LOOKBACK_DAYS.map((d) => ({ v: d, label: F.cmpPeriods[d]! }))} onChange={setLookback} />
              </div>
              <Button size="sm" variant="primary" disabled={cmp.status === "loading" || cmp.status === "calc"} onClick={() => void runCompare(a.id, lookback)} data-testid="forward-compare-run">
                {cmp.status === "done" ? F.cmpAgain : F.cmpRun}
              </Button>
            </div>
            {(cmp.status === "loading" || cmp.status === "calc") && (
              <p className="text-[12px] text-mute" role="status">
                {cmp.status === "loading" ? F.cmpLoading : F.cmpCalc}
              </p>
            )}
            {cmp.status === "error" && <p className="text-[12px] text-(--color-danger-text)">{cmp.error}</p>}
            {cmp.status === "done" && cmp.result && (
              <div className="grid gap-3" data-testid="forward-compare-result" data-level={cmp.result.level}>
                <p className={cn("text-[13px] leading-relaxed", cmp.result.level === "differs" ? "text-warn" : "text-fg")}>{cmp.result.headline}</p>
                <div className="min-w-0 overflow-x-auto">
                  <table className="w-full min-w-[34rem] text-left text-[12px]" data-testid="forward-compare-table">
                    <thead>
                      <tr className="text-[10.5px] uppercase tracking-[0.1em] text-faint">
                        <th scope="col" className="py-1.5 pr-3 font-semibold">{F.cmpThead.what}</th>
                        <th scope="col" className="py-1.5 pr-3 font-semibold">{F.cmpThead.fwd}</th>
                        <th scope="col" className="py-1.5 pr-3 font-semibold">{F.cmpThead.bt}</th>
                        <th scope="col" className="py-1.5 font-semibold">{F.cmpThead.diff}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cmp.result.rows.map((r) => (
                        <tr key={r.id} className="border-t border-line align-top" data-row={r.id}>
                          <th scope="row" className="py-2 pr-3 font-medium">{r.label}</th>
                          <td className="num py-2 pr-3">{r.forward}</td>
                          <td className="num py-2 pr-3">{r.backtest}</td>
                          <td className="num py-2">
                            {r.diff ?? "–"}
                            {r.inside != null && <span className={cn("ml-1.5", r.inside ? "text-faint" : "text-warn")}>({r.inside ? F.cmpInside : F.cmpOutside})</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-[11.5px] text-faint">{F.cmpWindow(cmp.result.backtestDays, cmp.result.backtestN)}</p>
                <ul className="grid gap-1 text-[11.5px] leading-relaxed text-faint">
                  {cmp.result.notes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </Collapse>
      </div>
    </Card>
  );
}
