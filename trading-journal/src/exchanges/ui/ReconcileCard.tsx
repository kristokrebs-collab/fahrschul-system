import { AnimatePresence, motion } from "motion/react";
import { useMemo, type ReactNode } from "react";
import { create } from "zustand";
import { cn } from "@/lib/cn";
import { HoldButton } from "@/motion/HoldButton";
import { TactileHighlight } from "@/motion/pulse/TactileHighlight";
import { spring, stagger, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Badge } from "@/primitives/Badge";
import { Button } from "@/primitives/Button";
import { Card } from "@/primitives/Card";
import { pushToast } from "@/store/uiStore";
import { useJournal } from "@/store/journalStore";
import { readJson, storageKey, writeJson } from "@/store/storage";
import { mergeDuplicate, reconcile, type DuplicatePair, type ReconcileReport } from "../reconcile";
import { primaryConnection, syncNow, useExchange } from "../store";
import { RECON } from "../strings";
import { fmtPlain, Money, shortWhen } from "./parts";

const IGNORE_KEY = storageKey("exchange-recon-ignored");
const SHOW = 4;

function readIgnored(): Set<string> {
  const v = readJson<unknown>(IGNORE_KEY, []);
  return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
}

/** Pairs the trader chose to ignore (per device) – shared by the card and the section that decides to show it. */
const useIgnored = create<{ ids: Set<string> }>(() => ({ ids: readIgnored() }));

const ignoredIds = (): Set<string> => useIgnored.getState().ids;

/** The current reconciliation of the journal (memoised on trades, the last dry run and the ignore list). */
export function useReconcileReport(): ReconcileReport {
  const trades = useJournal((s) => s.trades);
  const dry = useExchange((s) => s.dryRun);
  const ignored = useIgnored((s) => s.ids);
  return useMemo(() => reconcile(trades, dry?.checks ?? [], ignored), [trades, dry, ignored]);
}

/** Open items (duplicates + missing positions); the section shows the card only when there are any. */
export function useReconcileCount(): number {
  const r = useReconcileReport();
  return r.duplicates.length + r.missing.length;
}

function Section({ title, count, line, children }: { title: string; count: number; line: string; children: ReactNode }) {
  return (
    <section className="grid gap-2">
      <div className="flex items-center gap-2">
        <h3 className="text-[13px] font-semibold">{title}</h3>
        <Badge tone={count ? "warn" : "mute"}>{count}</Badge>
      </div>
      <p className="text-[12px] text-faint">{line}</p>
      {children}
    </section>
  );
}

function PairRow({ d, i, onMerge, onIgnore }: { d: DuplicatePair; i: number; onMerge: () => void; onIgnore: () => void }) {
  const reduced = useReducedFx();
  const off = d.pnlDiff !== null && Math.abs(d.pnlDiff) > Math.max(1, Math.abs(d.syncedPnl ?? 0) * 0.01);
  return (
    <motion.li
      layout="position"
      className="grid gap-2 rounded-xl border border-line bg-ink-950/45 p-3"
      initial={reduced ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0, transitionEnd: { transform: "none" } }}
      exit={{ opacity: 0, scale: 0.97, transition: tween.exit }}
      transition={{ y: { ...spring.enter, delay: i * stagger.reveal }, opacity: { ...tween.fade, delay: i * stagger.reveal }, layout: spring.layout }}
      data-testid="recon-pair"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2">
          <span className={cn("size-1.5 shrink-0 rounded-full", d.synced.side === "long" ? "bg-win" : "bg-loss")} aria-hidden="true" />
          <span className="text-[13.5px] font-medium">{d.synced.pair}</span>
          <span className="text-[11.5px] text-faint">{shortWhen(d.synced.date)}</span>
        </span>
        {off && d.pnlDiff !== null && (
          <span className="text-[12px] text-mute">
            Δ{" "}
            <TactileHighlight tone="signal" playOnView tab={false} padX={0.12}>
              <span className="num font-mono">{`${d.pnlDiff > 0 ? "+" : "−"}${fmtPlain(Math.abs(d.pnlDiff))}`}</span>
            </TactileHighlight>
          </span>
        )}
      </div>
      <dl className="grid grid-cols-2 gap-2 text-[12px]">
        <div className="rounded-lg border border-line bg-ink-900/60 px-2.5 py-1.5">
          <dt className="text-faint">{RECON.manual}</dt>
          <dd>
            <Money value={d.manualPnl} />
          </dd>
        </div>
        <div className="rounded-lg border border-line bg-ink-900/60 px-2.5 py-1.5">
          <dt className="text-faint">{RECON.exchange}</dt>
          <dd>
            <Money value={d.syncedPnl} />
          </dd>
        </div>
      </dl>
      <div className="flex flex-wrap items-center gap-2">
        <HoldButton size="sm" variant="primary" holdLabel={RECON.mergeHold} onConfirm={onMerge} data-testid="recon-merge">
          {RECON.merge}
        </HoldButton>
        <Button size="sm" onClick={onIgnore}>
          {RECON.ignore}
        </Button>
        <span className="text-[11px] text-faint">{RECON.holdHint}</span>
      </div>
    </motion.li>
  );
}

/**
 * "Broker-Abgleich" (P11): duplicates (hand-typed + synced, merge suggestion), P&L deviations (the difference marked
 * with a TactileHighlight sweep) and positions of the last dry run that are missing in the journal. Merging needs a
 * HOLD (HoldButton) – the synced record keeps the exchange numbers and takes the trader's notes, setups and feelings,
 * then the hand-typed copy is removed. Nothing is ever deleted automatically; "Ignorieren" is remembered per device.
 */
export function ReconcileCard({ className }: { className?: string }) {
  const save = useJournal((s) => s.saveTrade);
  const remove = useJournal((s) => s.deleteTrade);
  const dry = useExchange((s) => s.dryRun);
  const connId = useExchange((s) => primaryConnection(s.status)?.id ?? null);
  const busy = useExchange((s) => s.busy);
  const report = useReconcileReport();
  const dups = report.duplicates;
  const total = dups.length + report.missing.length;

  const ignore = (key: string) => {
    const next = new Set(ignoredIds()).add(key);
    writeJson(IGNORE_KEY, [...next].slice(-2000));
    useIgnored.setState({ ids: next });
  };
  const merge = async (d: DuplicatePair) => {
    // the hand-typed copy is removed only after the merged record is saved – a failed save keeps both
    try {
      await save(mergeDuplicate(d.synced, d.manual, new Date().toISOString()));
    } catch {
      pushToast({ kind: "error", title: RECON.mergeFailed });
      return;
    }
    try {
      await remove(d.manual.id);
    } catch {
      pushToast({ kind: "error", title: RECON.removeFailed });
      return;
    }
    pushToast({ kind: "success", title: RECON.mergeDone });
  };

  return (
    <div className="h-full" data-testid="reconcile-card">
      <Card title={RECON.title} className={cn("h-full", className)} action={total ? <Badge tone="warn">{total}</Badge> : <Badge tone="win">OK</Badge>}>
        <div className="grid gap-4">
          <p className="text-[12.5px] text-mute">{RECON.lead}</p>
          {report.synced === 0 && !report.missing.length ? (
            <p className="rounded-xl border border-line bg-ink-950/40 p-3 text-[13px] text-mute">{RECON.noSync}</p>
          ) : total === 0 ? (
            <p className="rounded-xl border border-win/25 bg-win/[0.05] p-3 text-[13px] text-mute" data-testid="recon-ok">
              {RECON.allGood}
            </p>
          ) : null}

          {dups.length > 0 && (
            <Section
              title={report.pnlDiffs.length ? `${RECON.dupTitle} · ${RECON.pnlTitle}` : RECON.dupTitle}
              count={dups.length}
              line={report.pnlDiffs.length ? RECON.pnlLine(fmtPlain(Math.abs(report.pnlDiffs[0]!.pnlDiff ?? 0))) : RECON.dupLine}
            >
              <ul className="grid gap-2">
                <AnimatePresence initial={false}>
                  {dups.slice(0, SHOW).map((d, i) => (
                    <PairRow key={d.key} d={d} i={i} onMerge={() => void merge(d)} onIgnore={() => ignore(d.key)} />
                  ))}
                </AnimatePresence>
              </ul>
            </Section>
          )}

          {report.missing.length > 0 && (
            <Section title={RECON.missTitle} count={report.missing.length} line={RECON.missLine}>
              <ul className="grid gap-1.5">
                {report.missing.slice(0, SHOW).map((m) => (
                  <li key={m.id} className="flex items-center justify-between gap-3 rounded-xl border border-line bg-ink-950/40 px-3 py-2 text-[12.5px]">
                    <span className="min-w-0 truncate">
                      {m.pair} <span className="text-faint">{shortWhen(m.exitDate)}</span>
                    </span>
                    <Money value={m.net} />
                  </li>
                ))}
              </ul>
              {connId && dry && (
                <Button
                  size="sm"
                  variant="primary"
                  className="justify-self-start"
                  disabled={!!busy}
                  onClick={() => void syncNow(connId, { from: new Date(dry.window.from).toISOString() })}
                >
                  {RECON.importMissing}
                </Button>
              )}
            </Section>
          )}
        </div>
      </Card>
    </div>
  );
}
