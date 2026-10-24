/**
 * One proposal ("Verbesserungsvorschlag"): version 2 against version 1 in plain language, the numbers on the test windows next
 * to the current version's (never the training number alone), the confirmation window, the probability of luck after all
 * tried variants, the plateau check, the sample, every warning – and the user's three choices: save as a new version, test live
 * as a challenger, reject (with an optional reason). Nothing here changes a strategy until one of those buttons is pressed on
 * THIS proposal; the live check of a challenger is shown below the buttons once it exists.
 */
import { useEffect, useId, useMemo, useState } from "react";
import { forwardCfgOf } from "@/domain/forward";
import { liveCheck, liveFactsOf, overfitLevel, type LiveCheck, type StoredProposal, type WinMetrics } from "@/domain/evolve";
import { cn } from "@/lib/cn";
import { Badge, type BadgeTone } from "@/primitives/Badge";
import { Button } from "@/primitives/Button";
import { Card } from "@/primitives/Card";
import { Collapse, Expander } from "@/primitives/Expander";
import { Input } from "@/primitives/Input";
import { useJournal } from "@/store/journalStore";
import { pushToast } from "@/store/uiStore";
import { decideProposal, recordLiveVerdict } from "./actions";
import { dayShort, dayText, dec, num, pctText, rText, stampText, toneOf } from "./fmt";
import { DISCLAIMER, EVOLVE } from "./strings";
import type { EvolveActionResult, StrategyEntry } from "./types";

const P = EVOLVE.proposals;
const LEVEL_TONE: Record<"low" | "mid" | "high", BadgeTone> = { low: "win", mid: "warn", high: "loss" };

function MetricRows({ base, cand }: { base: WinMetrics; cand: WinMetrics }) {
  const rows: { label: string; a: string; b: string; tone?: [number | null, number | null]; sub?: [string, string] }[] = [
    { label: P.rows.trades, a: String(base.n), b: String(cand.n) },
    { label: P.rows.avgR, a: rText(base.avgR), b: rText(cand.avgR), tone: [base.avgR, cand.avgR], sub: [base.avgRCI ? `${num(base.avgRCI.lo)} bis ${num(base.avgRCI.hi)}` : "", cand.avgRCI ? `${num(cand.avgRCI.lo)} bis ${num(cand.avgRCI.hi)}` : ""] },
    { label: P.rows.winRate, a: pctText(base.winRate), b: pctText(cand.winRate) },
    { label: P.rows.sumR, a: rText(base.sumR, 1), b: rText(cand.sumR, 1), tone: [base.sumR, cand.sumR] },
    { label: P.rows.dd, a: `${dec(base.maxDdR, 1)} R`, b: `${dec(cand.maxDdR, 1)} R` },
    { label: P.rows.net, a: pctText(base.netPct, 1, true), b: pctText(cand.netPct, 1, true), tone: [base.netPct, cand.netPct] },
  ];
  return (
    <div className="grid gap-1 text-[12px]" role="table" aria-label={P.testWindows}>
      <div role="row" className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-2 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-mute">
        <span role="columnheader" />
        <span role="columnheader" className="text-right">v1</span>
        <span role="columnheader" className="text-right">v2</span>
      </div>
      {rows.map((r) => (
        <div role="row" key={r.label} className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-2 border-t border-line/60 pt-1">
          <span role="cell" className="text-mute">{r.label}</span>
          <span role="cell" className={cn("num text-right", r.tone && toneOf(r.tone[0]))}>
            {r.a}
            {r.sub?.[0] && <span className="block text-[10.5px] text-faint">{r.sub[0]}</span>}
          </span>
          <span role="cell" className={cn("num text-right font-medium", r.tone && toneOf(r.tone[1]))}>
            {r.b}
            {r.sub?.[1] && <span className="block text-[10.5px] font-normal text-faint">{r.sub[1]}</span>}
          </span>
        </div>
      ))}
    </div>
  );
}

function LiveBox({ check, p }: { check: LiveCheck; p: StoredProposal }) {
  const tone: BadgeTone = check.level === "confirmed" ? "win" : check.level === "below" ? "warn" : "mute";
  return (
    <div className="grid gap-1.5 rounded-xl border border-line bg-ink-950/50 p-3" data-testid="evolve-live" data-level={check.level}>
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-[12.5px] font-semibold">{P.live.title}</h4>
        <Badge tone={tone}>{check.headline}</Badge>
      </div>
      <p className="text-[12px] leading-relaxed text-mute">{check.text}</p>
      {check.notes.map((n) => (
        <p key={n} className="text-[11.5px] leading-relaxed text-faint">
          {n}
        </p>
      ))}
      {p.outcome && <p className="text-[11.5px] text-faint">{P.live.recorded}</p>}
    </div>
  );
}

export function ProposalCard({
  proposal: p,
  entry,
  onSave,
  onChallenger,
  className,
}: {
  proposal: StoredProposal;
  entry: StrategyEntry | undefined;
  onSave: (e: StrategyEntry, p: StoredProposal) => Promise<EvolveActionResult> | EvolveActionResult;
  onChallenger: (e: StrategyEntry, p: StoredProposal) => Promise<EvolveActionResult> | EvolveActionResult;
  className?: string;
}) {
  const uid = useId();
  const [busy, setBusy] = useState<null | "save" | "challenger" | "reject">(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [methodOpen, setMethodOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const rawForward = useJournal((s) => s.settings.forward);
  const level = overfitLevel(p.overfit.p);
  const open = p.decision === "open";

  // the live check of a challenger: held against the expectation the proposal was made with
  const account = useMemo(() => (p.challengerId ? forwardCfgOf(rawForward).accounts.find((a) => a.id === p.challengerId) : undefined), [p.challengerId, rawForward]);
  const check = useMemo(() => (account ? liveCheck(p.expected, liveFactsOf(account)) : null), [account, p.expected]);
  useEffect(() => {
    if (check && !p.outcome && (check.level === "confirmed" || check.level === "below")) void recordLiveVerdict(p.id, check, Date.now());
  }, [check, p.id, p.outcome]);

  const run = async (kind: "save" | "challenger"): Promise<void> => {
    if (!entry || busy) return;
    setBusy(kind);
    setErr(null);
    try {
      const res = await (kind === "save" ? onSave(entry, p) : onChallenger(entry, p));
      if (!res.ok) {
        setErr(res.reason);
        pushToast({ kind: "error", title: P.actionFailed, detail: res.reason });
        return;
      }
      const ok = kind === "save" ? await decideProposal(p.id, { decision: "saved", savedAs: res.label }, Date.now()) : await decideProposal(p.id, { decision: "challenger", challengerId: res.id ?? "", savedAs: p.savedAs }, Date.now());
      if (ok) pushToast({ kind: "success", title: kind === "save" ? P.saved : P.started, detail: res.label });
    } finally {
      setBusy(null);
    }
  };

  const reject = async (): Promise<void> => {
    setBusy("reject");
    const ok = await decideProposal(p.id, { decision: "rejected", reason }, Date.now());
    setBusy(null);
    if (ok) {
      setRejecting(false);
      pushToast({ kind: "success", title: P.rejectedToast });
    }
  };

  const testDays = p.expected.days;
  const hold = p.holdout;
  return (
    <Card
      title={`${p.strategyName} · ${p.symbol} ${p.interval === "1d" ? "1D" : p.interval}`}
      note={P.asOf(dayText(p.dataTo))}
      className={className}
      data-testid="evolve-proposal"
      data-id={p.id}
      data-decision={p.decision}
      data-level={level}
      action={
        <Badge tone={LEVEL_TONE[level]} title={P.overfitWhat(p.overfit.trialsRun, p.overfit.strategiesInRun, p.overfit.trialsPrior, p.overfit.pNaive)}>
          {P.overfitShort} {pctText(p.overfit.p)}
        </Badge>
      }
    >
      <div className="grid gap-4">
        <section aria-label={P.changes} className="grid gap-1.5">
          <h3 className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-mute">{P.changes}</h3>
          <ul className="grid gap-1 text-[13px] leading-snug" data-testid="evolve-changes">
            {p.changes.length ? p.changes.map((c) => <li key={c}>· {c}</li>) : <li className="text-mute">· (keine sichtbare Änderung)</li>}
          </ul>
        </section>

        <section className="grid gap-2" aria-label={P.testWindows}>
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <h3 className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-mute">{P.testWindows}</h3>
            <span className="num text-[11px] text-faint">{P.sampleText(p.test.cand.n, testDays)}</span>
          </div>
          <MetricRows base={p.test.base} cand={p.test.cand} />
          <p className="text-[12px] text-mute" data-testid="evolve-better">
            {P.better(p.windowsBetter, p.windows.length)}
          </p>
          <ul className="grid gap-0.5 text-[11.5px] text-faint" aria-label={P.perWindow}>
            {p.windows.map((w, i) => (
              <li key={w.from} className="num flex flex-wrap justify-between gap-x-3">
                <span>
                  Fenster {i + 1} · {dayShort(w.from)}–{dayShort(w.to)}
                </span>
                <span>
                  <span className={toneOf(w.baseSumR)}>{rText(w.baseSumR, 1)}</span> → <span className={toneOf(w.candSumR)}>{rText(w.candSumR, 1)}</span> · {w.candN} Trades
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="grid gap-1.5 rounded-xl border border-line bg-ink-950/50 p-3 text-[12px]" aria-label={P.train}>
          <div className="flex flex-wrap justify-between gap-x-3">
            <span className="text-mute">{P.train}</span>
            <span className="num">
              v1 {rText(p.train.base.avgR)} ({p.train.base.n}) · v2 {rText(p.train.cand.avgR)} ({p.train.cand.n})
            </span>
          </div>
          <div className="flex flex-wrap justify-between gap-x-3" data-testid="evolve-holdout">
            <span className="text-mute">
              {P.holdout}
              {hold ? ` · ${dayShort(hold.window.from)}–${dayShort(hold.window.to)}` : ""}
            </span>
            <span className="num">{hold ? `v1 ${rText(hold.base.avgR)} (${hold.base.n}) · v2 ${rText(hold.cand.avgR)} (${hold.cand.n})` : "nicht gerechnet"}</span>
          </div>
        </section>

        <section className="grid gap-2" aria-label={P.overfit} data-testid="evolve-overfit">
          <div className="flex items-start justify-between gap-3">
            <div className="grid gap-0.5">
              <h3 className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-mute">{P.overfit}</h3>
              <p className="num text-[22px] font-medium leading-none" data-testid="evolve-overfit-p">
                {pctText(p.overfit.p)}
              </p>
            </div>
            <Expander open={methodOpen} onToggle={() => setMethodOpen((v) => !v)} label={P.overfit} controls={`${uid}-method`} />
          </div>
          <p className="text-[12px] leading-relaxed text-mute">{P.overfitWhat(p.overfit.trialsRun, p.overfit.strategiesInRun, p.overfit.trialsPrior, p.overfit.pNaive)}</p>
          {p.overfit.floor != null && (
            <p className="text-[12px] leading-relaxed text-warn" data-testid="evolve-overfit-floor">
              {P.overfitFloor(p.overfit.floor)}
            </p>
          )}
          <Collapse open={methodOpen} id={`${uid}-method`}>
            <p className="pb-1 text-[11.5px] leading-relaxed text-faint">{P.overfitMethod}</p>
          </Collapse>
          <dl className="grid gap-1 text-[12px] sm:grid-cols-3">
            <div className="rounded-lg border border-line bg-ink-950/50 px-2.5 py-1.5">
              <dt className="text-[10.5px] uppercase tracking-[0.08em] text-mute">{P.plateau}</dt>
              <dd className="num" data-testid="evolve-plateau">
                {p.plateau ? P.plateauText(p.plateau.ok, p.plateau.checked) : P.plateauNone}
              </dd>
            </div>
            <div className="rounded-lg border border-line bg-ink-950/50 px-2.5 py-1.5">
              <dt className="text-[10.5px] uppercase tracking-[0.08em] text-mute">{P.freedom}</dt>
              <dd className="num">
                {p.freedom.base} → {p.freedom.cand}
              </dd>
            </div>
            <div className="rounded-lg border border-line bg-ink-950/50 px-2.5 py-1.5">
              <dt className="text-[10.5px] uppercase tracking-[0.08em] text-mute">{P.sample}</dt>
              <dd className="num">{p.test.cand.n} Trades</dd>
            </div>
          </dl>
        </section>

        <section className="grid gap-1.5" aria-label={P.warnings}>
          <h3 className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-mute">{P.warnings}</h3>
          {p.warnings.length ? (
            <ul className="grid gap-1.5 text-[12px] leading-snug" data-testid="evolve-warnings">
              {p.warnings.map((w) => (
                <li key={w} className="flex gap-2 text-warn">
                  <span aria-hidden="true" className="mt-1.5 size-1.5 shrink-0 rounded-full bg-current" />
                  <span>{w}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[12px] text-mute">{P.noWarnings}</p>
          )}
        </section>

        {open ? (
          <div className="grid gap-2" data-testid="evolve-actions">
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" onClick={() => void run("save")} disabled={!entry || busy != null} data-testid="evolve-save" title={P.saveHelp}>
                {busy === "save" ? "Speichert …" : P.actions.save}
              </Button>
              <Button onClick={() => void run("challenger")} disabled={!entry || busy != null} data-testid="evolve-challenger" title={P.challengerHelp}>
                {busy === "challenger" ? "Startet …" : P.actions.challenger}
              </Button>
              <Button variant="danger" onClick={() => setRejecting((v) => !v)} disabled={busy != null} data-testid="evolve-reject" aria-expanded={rejecting}>
                {P.actions.reject}
              </Button>
            </div>
            <p className="text-[11.5px] leading-relaxed text-faint">
              {P.saveHelp} {P.challengerHelp}
            </p>
            {!entry && <p className="text-[12px] text-warn">Die Strategie gibt es in der Liste nicht mehr – speichern oder live testen geht dafür nicht, ablehnen schon.</p>}
            {err && (
              <p role="alert" className="text-[12px] text-(--color-danger-text)">
                {err}
              </p>
            )}
            {rejecting && (
              <div className="grid gap-2 rounded-xl border border-line bg-ink-950/50 p-3" data-testid="evolve-reject-box">
                <label htmlFor={`${uid}-reason`} className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-mute">
                  {P.actions.reason}
                </label>
                <Input id={`${uid}-reason`} value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} autoComplete="off" data-testid="evolve-reject-reason" />
                <p className="text-[11px] text-faint">{P.actions.reasonHint}</p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="danger" size="sm" onClick={() => void reject()} disabled={busy != null} data-testid="evolve-reject-confirm">
                    {P.actions.rejectConfirm}
                  </Button>
                  <Button size="sm" onClick={() => setRejecting(false)}>
                    {P.actions.cancel}
                  </Button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="grid gap-2" data-testid="evolve-decided">
            <p className="text-[12.5px]">
              {p.decision === "saved" && P.states.saved(p.savedAs ?? "", stampText(p.decidedAt ?? 0))}
              {p.decision === "challenger" && P.states.challenger(stampText(p.decidedAt ?? 0))}
              {p.decision === "rejected" && P.states.rejected(stampText(p.decidedAt ?? 0), p.reason)}
            </p>
            {p.decision === "saved" && entry && !p.challengerId && (
              <div>
                <Button size="sm" onClick={() => void run("challenger")} disabled={busy != null} data-testid="evolve-challenger">
                  {busy === "challenger" ? "Startet …" : P.actions.challenger}
                </Button>
              </div>
            )}
            {p.challengerId && (check ? <LiveBox check={check} p={p} /> : <p className="text-[12px] text-faint">{P.live.none}</p>)}
          </div>
        )}
        <p className="text-[11.5px] text-faint" data-testid="evolve-disclaimer">
          {DISCLAIMER}
        </p>
      </div>
    </Card>
  );
}

