/**
 * Zahlen-Analyst (F68): the reported numbers of a US company, quarter by quarter, from SEC EDGAR through the app's server.
 * A ticker field and "Laden" (nothing is fetched by itself unless the host says `autoLoad`), then: the company line with source
 * and stand, the sentences "Was sich geändert hat", the last quarters (table / cards), the last filings with the earnings 8-K and
 * its press release, dates and events, and the notes about the data (derived quarters, restatements, one-offs, missing numbers).
 *
 * Honest by construction: every figure is a filed number or plain arithmetic on filed numbers (`src/domain/analyst`); what is not
 * there says "keine Daten"; there is NO consensus ("kein Konsens, nur gemeldete Zahlen") and no price. Nothing is stored and
 * nothing is traded. Lazy-ready: `lazy(() => import("@/views/analyst/AnalystPanel"))`.
 */
import { useEffect, useId, useRef, useState } from "react";
import { dateDe } from "@/domain/analyst";
import { seedFromAnalyst } from "@/domain/dcf";
import { cn } from "@/lib/cn";
import { Badge } from "@/primitives/Badge";
import { Button } from "@/primitives/Button";
import { Card } from "@/primitives/Card";
import { EmptyState } from "@/primitives/EmptyState";
import { Field } from "@/primitives/Field";
import { Input } from "@/primitives/Input";
import { Skeleton } from "@/primitives/Skeleton";
import { normalizeTicker, type SecFiling } from "@/market/sec";
import { useAnalysis, type Analysis } from "./data";
import { Disclosure, PanelNote, SecErrorBox, SecStamp, Sub } from "./parts";
import { QuarterTable } from "./QuarterTable";
import { AN, ITEM_LABELS } from "./strings";
import type { AnalystPanelProps } from "./types";

const FORM_TONE: Record<string, "steel" | "teal" | "mute"> = { "10-Q": "steel", "10-Q/A": "steel", "10-K": "teal", "10-K/A": "teal", "10-KT": "teal" };

function itemsText(f: SecFiling): string {
  const named = f.items.filter((i) => ITEM_LABELS[i]).map((i) => ITEM_LABELS[i]!);
  return named.length ? named.join(" · ") : f.items.join(", ");
}

function Filings({ a }: { a: Analysis }) {
  if (!a.filings) return <p className="text-[12.5px] leading-relaxed text-mute" data-testid="filings-missing">{a.filingsError ? `${AN.filingsMissing} (${a.filingsError.message})` : AN.filingsMissing}</p>;
  const list = a.filings.data.filings;
  return (
    <ul className="grid gap-1.5" data-testid="analyst-filings">
      {list.map((f) => (
        <li key={f.accession} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-line bg-ink-950/40 px-3 py-2 text-[12.5px]" data-form={f.form}>
          <Badge tone={FORM_TONE[f.form] ?? "mute"}>{f.form}</Badge>
          <span className="num font-mono text-mute">{dateDe(f.filed)}</span>
          {f.reportDate && f.form !== "8-K" ? <span className="text-mute">Zeitraum bis {dateDe(f.reportDate)}</span> : null}
          {f.items.length ? <span className="min-w-0 flex-1 text-mute">{itemsText(f)}</span> : <span className="flex-1" />}
          <a href={f.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-fg">
            {AN.openFiling}
          </a>
        </li>
      ))}
    </ul>
  );
}

function Events({ a }: { a: Analysis }) {
  const hist = a.filings?.data.earningsHistory ?? [];
  return (
    <div className="grid gap-2 text-[12.5px] leading-relaxed" data-testid="analyst-events">
      <p className="text-mute" data-testid="next-report-note">{AN.nextReport}</p>
      {hist.length > 0 ? (
        <p>
          <span className="text-mute">{AN.lastReports}: </span>
          <span className="num font-mono">{hist.slice(0, 4).map((f) => dateDe(f.filed)).join(" · ")}</span>
        </p>
      ) : null}
    </div>
  );
}

export function AnalystPanel({ ticker: tickerProp = "", autoLoad = false, onLoaded, onUseInDcf, onStartThesis, className, bare, hosted, fetchImpl }: AnalystPanelProps) {
  const id = useId();
  const [text, setText] = useState(tickerProp);
  const { state, load } = useAnalysis(fetchImpl);
  const started = useRef(false);
  const norm = normalizeTicker(text);

  const run = async (fresh?: boolean): Promise<void> => {
    if (!norm) return;
    const a = await load(norm, fresh);
    if (a && onLoaded) onLoaded({ ticker: a.ticker, result: a.result, filings: a.filings });
  };

  // the host asks for an immediate load (once)
  useEffect(() => {
    if (!autoLoad || started.current || !normalizeTicker(tickerProp)) return;
    started.current = true;
    void load(normalizeTicker(tickerProp)!).then((a) => {
      if (a && onLoaded) onLoaded({ ticker: a.ticker, result: a.result, filings: a.filings });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoLoad, tickerProp]);

  const busy = state.status === "loading";
  const body = (
    <div className={cn("grid min-w-0 gap-4", className)} data-testid="analyst-panel" data-status={state.status}>
      <p className="max-w-[78ch] text-[13px] leading-relaxed text-mute">{AN.lead}</p>

      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <Field label={AN.tickerLabel} htmlFor={id} help={AN.tickerHelp} className="w-full max-w-[220px]">
          <Input id={id} value={text} autoCapitalize="characters" autoComplete="off" spellCheck={false} maxLength={10} placeholder="AAPL" data-testid="analyst-ticker" onChange={(e) => setText(e.target.value.toUpperCase())} />
        </Field>
        <Button type="submit" variant="primary" disabled={!norm || busy} data-testid="analyst-load">
          {state.status === "ready" ? AN.reload : AN.load}
        </Button>
      </form>

      {state.status === "idle" && <EmptyState title={AN.emptyTitle} text={AN.emptyText} line={false} />}

      {busy && (
        <div className="grid gap-2" role="status" aria-live="polite" data-testid="analyst-loading">
          <p className="text-[13px] text-mute">{AN.loading(state.ticker)}</p>
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-24 w-full" />
        </div>
      )}

      {state.status === "error" && <SecErrorBox error={state.error} title={AN.errorTitle} />}

      {state.status === "ready" && <Ready a={state.analysis} onUseInDcf={onUseInDcf} onStartThesis={onStartThesis} />}

      <div data-testid="analyst-note">
        <PanelNote lead={AN.disclaimer} hosted={hosted} />
      </div>
    </div>
  );
  return bare ? body : <Card title={AN.title}>{body}</Card>;
}

function Ready({ a, onUseInDcf, onStartThesis }: { a: Analysis; onUseInDcf: AnalystPanelProps["onUseInDcf"]; onStartThesis: AnalystPanelProps["onStartThesis"] }) {
  const r = a.result;
  const important = r.notes.filter((n) => n.kind === "stale" || n.kind === "lag" || n.kind === "old");
  const rest = r.notes.filter((n) => n.kind !== "stale" && n.kind !== "lag" && n.kind !== "old");
  const press = a.filings?.data.earnings8k ?? null;
  return (
    <div className="grid gap-5" data-testid="analyst-result" data-ticker={a.ticker}>
      <header className="grid gap-1.5">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h3 className="text-[17px] font-semibold" data-testid="analyst-entity">
            {r.entity || a.ticker}
          </h3>
          <span className="num font-mono text-[12px] text-mute">
            {a.ticker} · CIK {r.cik} · {r.currency}
          </span>
          <Badge tone="mute" title={r.consensus.text}>
            {AN.consensusTag}
          </Badge>
        </div>
        <SecStamp stamp={a.facts} extra={r.stamp.asOf ? dateDe(r.stamp.asOf) : null} asOfLabel="neuestes Quartal bis" />
      </header>

      {important.length > 0 && (
        <ul className="grid gap-2" data-testid="analyst-important">
          {important.map((n, i) => (
            <li key={i} role="status" className="rounded-xl border border-warn/30 bg-warn/[0.06] p-3 text-[13px] leading-snug" data-kind={n.kind}>
              {n.text}
              {n.url ? (
                <>
                  {" "}
                  <a href={n.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
                    Öffnen
                  </a>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {r.quarters.length === 0 ? (
        <EmptyState title="Keine Quartalszahlen" text={r.notes.find((n) => n.kind === "missing")?.text ?? "In den Daten dieser Firma gibt es keine Quartalszahlen."} line={false} />
      ) : (
        <>
          <section className="grid gap-2" aria-label={AN.changedTitle}>
            <Sub>{AN.changedTitle}</Sub>
            <ul className="grid gap-1.5 text-[13.5px] leading-snug" data-testid="analyst-changes">
              {r.changes.map((c) => (
                <li key={c.id} data-id={c.id} className={cn("rounded-lg px-1", c.group === "caution" && "text-mute")}>
                  {c.text}
                </li>
              ))}
            </ul>
          </section>

          <section className="grid gap-2" aria-label={AN.quartersTitle}>
            <Sub>{AN.quartersTitle}</Sub>
            <QuarterTable result={r} filingsMissing={!a.filings} pressUrl={press?.exhibitUrl ?? null} pressFiled={press?.filed ?? null} />
          </section>

          <section className="grid gap-2" aria-label={AN.eventsTitle}>
            <Sub>{AN.eventsTitle}</Sub>
            <Events a={a} />
          </section>

          <Disclosure title={AN.filingsTitle} count={a.filings?.data.filings.length ?? 0} testId="analyst-filings-section">
            <Filings a={a} />
          </Disclosure>

          <Disclosure title={AN.notesTitle} count={rest.length} defaultOpen testId="analyst-notes-section">
            <ul className="grid gap-1.5 text-[12.5px] leading-relaxed text-mute" data-testid="analyst-notes">
              {rest.map((n, i) => (
                <li key={i} data-kind={n.kind}>
                  {n.text}
                </li>
              ))}
            </ul>
          </Disclosure>

          {(onUseInDcf || onStartThesis) && (
            <div className="flex flex-wrap gap-2">
              {onUseInDcf && (
                <Button size="sm" onClick={() => onUseInDcf(seedFromAnalyst(r), a.ticker)} data-testid="analyst-use-dcf">
                  {AN.useInDcf}
                </Button>
              )}
              {onStartThesis && (
                <Button size="sm" onClick={() => onStartThesis(a.ticker)} data-testid="analyst-start-thesis">
                  {AN.startThesis}
                </Button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default AnalystPanel;
