/**
 * „Muster-Entdecker“ (Auftrag B): a card that looks for patterns in the entries of a set of trades and tells – in plain
 * German and with the number of tests it made – which of them hold up against chance. It is fed with trades (a backtest of
 * the Labor or the Strategie-Studio, or the real journal) and never starts by itself: the search is a button, it runs in a worker
 * with progress and "Abbrechen", and it changes nothing. The stages are `bestätigt` · `Hinweis` · `verworfen (Zufall)`; the
 * rejected ones are counted and the closest ones shown, so nothing is made to look better than it is.
 *
 * Props are the `DiscoveryInput` fields (trades + the candles they were taken on) plus an optional "Mit diesem Filter testen" hook
 * that the host wires to its own backtest. Lazy-ready: `lazy(() => import("@/views/discovery/DiscoveryPanel"))`.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import type { PatternFilterSpec } from "@/domain/discovery/spec";
import { runDiscovery, isDiscoveryAbort } from "@/domain/discovery/runner";
import { breakdownText, countsSentence, DISCLAIMER } from "@/domain/discovery/text";
import { LIMITS, type DiscoveryInput, type DiscoveryResult, type DiscoveryTrade, type Finding } from "@/domain/discovery/types";
import { cn } from "@/lib/cn";
import { Button } from "@/primitives/Button";
import { Card } from "@/primitives/Card";
import { Collapse } from "@/primitives/Expander";
import { FindingCard, type FilterTestState } from "./FindingCard";
import { rememberDiscovery } from "./lastResult";
import { DISC } from "./strings";

export type { FilterTestState } from "./FindingCard";

export interface DiscoveryPanelProps {
  /** the trades to look at (a backtest's, or the journal's) – only those with a known R count */
  trades: readonly DiscoveryTrade[];
  /** the candles the trades were taken on, per market key (see `DiscoveryInput`); without them only the clock, history and journal fields work */
  markets?: DiscoveryInput["markets"];
  source?: DiscoveryInput["source"];
  /** what is analysed ("BTCUSDT 4h · Eigene Idee") */
  label?: string;
  /** start value of the random draws; shown on the card (default: the fixed one of the domain) */
  seed?: number;
  /** also use descriptions only known after the trade (hold time) – off by default, such patterns are marked */
  includePostEntry?: boolean;
  /** "Mit diesem Filter testen" for a confirmed, filterable finding; the host decides what the click runs (nothing is adopted by itself) */
  onTestFilter?: (spec: PatternFilterSpec, finding: Finding) => void;
  /** the state of such a test, shown under its finding */
  filterTest?: FilterTestState | null;
  /** `idle` runs on the main thread (tests, single-file builds choose it by themselves) */
  mode?: "auto" | "idle";
  /** the card without its frame (when the host already has one) */
  bare?: boolean;
  className?: string;
}

type Status = "idle" | "running" | "done" | "error" | "cancelled";
interface RunState {
  status: Status;
  progress: number;
  result: DiscoveryResult | null;
  error: string | null;
  /** the signature of the input this state belongs to */
  sig: string;
  /** epoch ms the search finished (the "Stand" under the result) */
  at: number;
}

const IDLE: RunState = { status: "idle", progress: 0, result: null, error: null, sig: "", at: 0 };

const p2 = (n: number): string => String(n).padStart(2, "0");
const dayText = (ms: number): string => {
  const d = new Date(ms);
  return `${p2(d.getDate())}.${p2(d.getMonth() + 1)}.${d.getFullYear()}`;
};
const stampText = (ms: number): string => `${dayText(ms)} ${p2(new Date(ms).getHours())}:${p2(new Date(ms).getMinutes())}`;

/** A cheap fingerprint of what is analysed: when it changes, an old result no longer describes the data. */
function signature(p: Pick<DiscoveryPanelProps, "trades" | "markets" | "source" | "label" | "seed" | "includePostEntry">): string {
  let h = 2166136261;
  const mix = (x: number): void => {
    h = Math.imul(h ^ (x | 0), 16777619);
  };
  for (const t of p.trades) {
    mix(t.entryTime / 1000);
    mix(t.r == null ? 7 : Math.round(t.r * 1000));
    mix(t.side === "long" ? 1 : 2);
  }
  const mk = p.markets ?? {};
  for (const k of Object.keys(mk)) {
    const m = mk[k]!;
    mix(m.bars.length);
    mix(m.bars[m.bars.length - 1]?.t ?? 0);
    mix(m.levels?.length ?? 0);
  }
  return [p.source ?? "backtest", p.label ?? "", p.seed ?? "", p.includePostEntry ? 1 : 0, p.trades.length, h >>> 0].join("|");
}

export function DiscoveryPanel(props: DiscoveryPanelProps) {
  const { trades, markets, source = "backtest", label, seed, includePostEntry, onTestFilter, filterTest, mode = "auto", bare, className } = props;
  const sig = useMemo(() => signature({ trades, markets, source, label, seed, includePostEntry }), [trades, markets, source, label, seed, includePostEntry]);
  const input = useMemo<DiscoveryInput>(
    () => ({ trades, source, ...(markets ? { markets } : {}), ...(label ? { label } : {}), ...(seed != null ? { seed } : {}), ...(includePostEntry ? { includePostEntry: true } : {}) }),
    // the signature stands for the content: a new array with the same trades must not discard a result
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sig],
  );
  const usable = useMemo(() => trades.filter((t) => t.r != null && Number.isFinite(t.r)).length, [trades]);
  const [run, setRun] = useState<RunState>(IDLE);
  const ctl = useRef<AbortController | null>(null);
  const lastUi = useRef(0);
  const titleId = useId();
  const [showMethod, setShowMethod] = useState(false);
  const [showHints, setShowHints] = useState(false);
  const [showRejected, setShowRejected] = useState(false);

  // a run belongs to its data: changing the data (or leaving) stops it; the old result is simply not shown any more
  useEffect(
    () => () => {
      ctl.current?.abort();
    },
    [sig],
  );

  const start = useCallback(async (): Promise<void> => {
    ctl.current?.abort();
    const mine = new AbortController();
    ctl.current = mine;
    const forSig = sig;
    setRun({ status: "running", progress: 0, result: null, error: null, sig: forSig, at: 0 });
    try {
      const result = await runDiscovery(input, {
        signal: mine.signal,
        mode,
        onProgress: (p) => {
          const t = Date.now();
          if (ctl.current !== mine || t - lastUi.current < 100) return;
          lastUi.current = t;
          setRun((s) => (s.sig === forSig && s.status === "running" ? { ...s, progress: p } : s));
        },
      });
      if (ctl.current !== mine) return;
      // the assistant quotes the last finished search (it never starts one itself)
      rememberDiscovery({ result, at: Date.now(), source: input.source, label: input.label ?? null });
      setRun({ status: "done", progress: 1, result, error: null, sig: forSig, at: Date.now() });
    } catch (e) {
      if (ctl.current !== mine) return;
      if (isDiscoveryAbort(e)) setRun({ status: "cancelled", progress: 0, result: null, error: DISC.cancelled, sig: forSig, at: 0 });
      else {
        console.error("Muster-Entdecker: Suche fehlgeschlagen", e);
        setRun({ status: "error", progress: 0, result: null, error: DISC.failed, sig: forSig, at: 0 });
      }
    } finally {
      if (ctl.current === mine) ctl.current = null;
    }
  }, [input, sig, mode]);

  const cancel = useCallback((): void => {
    ctl.current?.abort();
  }, []);

  const current: RunState = run.sig === sig ? run : IDLE;
  const outdated = run.sig !== "" && run.sig !== sig && run.status === "done";
  const res = current.status === "done" ? current.result : null;
  const tooFew = usable < LIMITS.minTrades;
  const busy = current.status === "running";
  const findings = res?.findings ?? [];
  const wins = findings.filter((f) => f.tier === "confirmed" && f.side === "win");
  const losses = findings.filter((f) => f.tier === "confirmed" && f.side === "loss");
  const hints = findings.filter((f) => f.tier === "hint");
  const rejected = findings.filter((f) => f.tier === "rejected");
  const tested = res?.counts.tested ?? 0;
  const span = useMemo<[number, number] | null>(() => {
    const ts = trades.filter((t) => t.r != null && Number.isFinite(t.r)).map((t) => t.entryTime);
    return ts.length ? [Math.min(...ts), Math.max(...ts)] : null;
  }, [trades]);

  const body = (
    <div className="grid gap-4" data-testid="discovery-panel" data-status={current.status} data-source={source}>
      <p className="text-[13px] leading-snug text-mute">{DISC.intro}</p>

      <div className="grid gap-2 rounded-xl border border-line bg-ink-950/40 p-3.5" data-testid="discovery-setup">
        <p className="text-[12.5px] leading-snug text-mute" data-testid="discovery-source">
          {label ? <span className="font-medium text-fg/90">{label} · </span> : null}
          {trades.length === 0 ? DISC.noInput : DISC.trades(usable, trades.length)}
        </p>
        {tooFew && trades.length > 0 && (
          <p className="text-[13px] leading-snug text-warn" role="status" data-testid="discovery-empty">
            {DISC.tooFew(usable)}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {busy ? (
            <Button size="sm" onClick={cancel} data-testid="discovery-cancel">
              {DISC.cancel}
            </Button>
          ) : (
            <Button size="sm" variant={res ? "ghost" : "primary"} onClick={() => void start()} disabled={tooFew} data-testid="discovery-start">
              {res ? DISC.again : DISC.start}
            </Button>
          )}
          {busy && (
            <div className="flex min-w-0 flex-1 items-center gap-3" data-testid="discovery-busy">
              <span role="progressbar" aria-label={DISC.progress} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(current.progress * 100)} className="h-1 min-w-24 flex-1 overflow-hidden rounded-full bg-white/[0.07]" data-testid="discovery-progress">
                <span className="block h-full origin-left rounded-full bg-fg/80 transition-transform duration-200 ease-out" style={{ transform: `scaleX(${Math.max(0.02, Math.min(1, current.progress))})` }} />
              </span>
              <span className="num shrink-0 font-mono text-[11.5px] text-mute">{DISC.running(Math.round(current.progress * 100))}</span>
            </div>
          )}
        </div>
        {busy && <p className="text-[11.5px] text-faint">{DISC.phase(current.progress)}</p>}
        <p className="text-[11.5px] leading-snug text-faint" data-testid="discovery-seed">
          {DISC.seed(res?.seed ?? seed ?? LIMITS.defaultSeed)}
        </p>
        {outdated && (
          <p role="status" className="text-[12.5px] text-mute" data-testid="discovery-outdated">
            {DISC.outdated}
          </p>
        )}
        {current.error && (current.status === "error" || current.status === "cancelled") && (
          <p role="status" className={cn("text-[12.5px]", current.status === "error" ? "text-warn" : "text-mute")} data-testid="discovery-error">
            {current.error}
          </p>
        )}
      </div>

      {res && res.status !== "ok" && (
        <p className="rounded-xl border border-line bg-ink-950/40 p-3 text-[13px] leading-snug text-mute" role="status" data-testid="discovery-empty">
          {res.note}
        </p>
      )}

      {res && res.status === "ok" && (
        <div className="grid gap-5" data-testid="discovery-result">
          <section className="grid gap-1.5" data-testid="discovery-summary" aria-labelledby={titleId}>
            <h3 id={titleId} className="text-[15px] font-semibold leading-snug text-fg" data-testid="discovery-counts">
              {countsSentence(res.counts)}
            </h3>
            <p className="text-[12.5px] leading-snug text-mute" data-testid="discovery-breakdown">
              {breakdownText(res.counts)}
            </p>
            <p className="text-[11.5px] leading-snug text-faint" data-testid="discovery-stand">
              {DISC.stand(stampText(current.at), span ? dayText(span[0]) : null, span ? dayText(span[1]) : null, source)}
            </p>
            <p className="text-[11.5px] leading-snug text-faint" data-testid="discovery-method-line">
              {[DISC.setup.split(res.nDisc, res.nConf), DISC.setup.perms(res.permutations), DISC.setup.features(res.featuresUsed.length), res.droppedNoR ? DISC.setup.noR(res.droppedNoR) : "", res.droppedCap ? DISC.setup.cap(res.droppedCap) : ""].filter(Boolean).join(" ")}
            </p>
          </section>

          <Group kind="win" items={wins} tested={tested} onTestFilter={onTestFilter} filterTest={filterTest} />
          <Group kind="loss" items={losses} tested={tested} onTestFilter={onTestFilter} filterTest={filterTest} />
          {wins.length + losses.length === 0 && (
            <p className="rounded-xl border border-line bg-ink-950/40 p-3 text-[13px] leading-snug text-mute" data-testid="discovery-none">
              {hints.length > 0 ? DISC.empty.onlyHints : DISC.empty.nothing}
            </p>
          )}

          <Fold open={showHints} onToggle={() => setShowHints((o) => !o)} title={`${DISC.groups.hints.title} · ${res.counts.hint}`} sub={DISC.groups.hints.sub} testId="discovery-hints" disabled={hints.length === 0}>
            <ul className="grid gap-2.5">
              {hints.map((f) => (
                <FindingCard key={f.id} f={f} tested={tested} />
              ))}
            </ul>
            {res.counts.hint > hints.length && <p className="text-[11.5px] text-faint">{`Die ${hints.length} stärksten von ${res.counts.hint} sind gezeigt.`}</p>}
          </Fold>
          <Fold open={showRejected} onToggle={() => setShowRejected((o) => !o)} title={`${DISC.groups.rejected.title} · ${res.counts.rejected.toLocaleString("de-DE")}`} sub={DISC.groups.rejected.sub} testId="discovery-rejected" disabled={rejected.length === 0}>
            <ul className="grid gap-2.5">
              {rejected.map((f) => (
                <FindingCard key={f.id} f={f} tested={tested} />
              ))}
            </ul>
          </Fold>
        </div>
      )}

      <div className="grid gap-2">
        <button
          type="button"
          onClick={() => setShowMethod((o) => !o)}
          aria-expanded={showMethod}
          className="touch-hit w-fit text-left text-[12px] font-semibold text-mute underline-offset-4 hover:text-fg hover:underline"
          data-testid="discovery-method-toggle"
        >
          {DISC.method.title}
        </button>
        <Collapse open={showMethod}>
          <ul className="grid list-disc gap-1.5 pl-5 text-[12px] leading-snug text-mute" data-testid="discovery-method">
            {DISC.method.items.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </Collapse>
      </div>

      <p className="rounded-xl border border-line p-3 text-[11.5px] leading-snug text-mute" data-testid="discovery-disclaimer">
        {DISCLAIMER}
      </p>
    </div>
  );

  if (bare) return <div className={className}>{body}</div>;
  return (
    <Card title={DISC.title} note={DISC.note} className={className} data-testid="discovery-card">
      {body}
    </Card>
  );
}

function Group({ kind, items, tested, onTestFilter, filterTest }: { kind: "win" | "loss"; items: Finding[]; tested: number; onTestFilter?: DiscoveryPanelProps["onTestFilter"]; filterTest?: FilterTestState | null }) {
  const g = DISC.groups[kind];
  return (
    <section className="grid gap-2.5" data-testid={`discovery-group-${kind}`} aria-label={g.title}>
      <header className="grid gap-0.5">
        <h3 className="label flex items-center gap-2">
          <span className={cn("size-1.5 rounded-full", kind === "win" ? "bg-win" : "bg-loss")} aria-hidden="true" />
          {g.title} · {items.length}
        </h3>
        <p className="text-[11.5px] text-faint">{g.sub}</p>
      </header>
      {items.length > 0 ? (
        <ul className="grid gap-2.5">
          {items.map((f) => (
            <FindingCard key={f.id} f={f} tested={tested} onTestFilter={onTestFilter} filterTest={filterTest} />
          ))}
        </ul>
      ) : (
        <p className="text-[12.5px] text-faint">Keines bestätigt.</p>
      )}
    </section>
  );
}

function Fold({ open, onToggle, title, sub, testId, disabled, children }: { open: boolean; onToggle: () => void; title: string; sub: string; testId: string; disabled?: boolean; children: ReactNode }) {
  const region = useId();
  return (
    <section className="grid gap-2" data-testid={testId}>
      <button type="button" onClick={onToggle} disabled={disabled} aria-expanded={open && !disabled} aria-controls={region} className="touch-hit grid w-full gap-0.5 text-left disabled:cursor-default" data-testid={`${testId}-toggle`}>
        <span className="label flex items-center gap-2">
          <span className="size-1.5 rounded-full border border-faint" aria-hidden="true" />
          {title}
          {!disabled && <span className="text-faint">{open ? "−" : "+"}</span>}
        </span>
        <span className="text-[11.5px] text-faint">{sub}</span>
      </button>
      <Collapse open={open && !disabled} id={region}>
        <div className="grid gap-2.5 pt-1">{children}</div>
      </Collapse>
    </section>
  );
}

export default DiscoveryPanel;
