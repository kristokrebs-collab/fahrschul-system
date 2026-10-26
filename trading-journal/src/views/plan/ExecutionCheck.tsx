/**
 * „Ausführbarkeit jetzt (live)“ (F44) inside the Ticket step of the Handelsplan: on a click it reads ONE order-book snapshot of
 * the plan's Binance symbol and shows what the plan has only assumed so far – the spread, the depth around the middle, the price
 * the planned size would get when it walks the book (opening and stop fill), that stop fill held against the slippage the plan
 * assumed, and the order next to the 24 h turnover. Source and time are said on the card; a failure is said with its reason and
 * is never a green light. For stocks there is no order-book source, and the card says so.
 *
 * The app sends no order and has no broker connection; this card only reads public data. Nothing here changes the plan.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { priceText, qtyText, type TicketPlan } from "@/domain/plan";
import { checkExecution, type FindingId, type Tone } from "@/domain/execution";
import { cn } from "@/lib/cn";
import { loadBook, defaultBookDeps, type BookResult } from "@/market/execution/book";
import { Button } from "@/primitives/Button";
import { EXEC_STRINGS as S, SPREAD_RULE, TONE_WORD, TURNOVER_RULE, assumptionLine, bandLine, baseOf, failureText, headline, legLine, quoteOf, spreadLine, turnoverLine } from "./executionModel";

const TONE_DOT: Record<Tone, string> = { ok: "bg-win", warn: "bg-warn", bad: "bg-loss", unknown: "bg-faint-line" };
const TONE_TEXT: Record<Tone, string> = { ok: "text-win", warn: "text-warn", bad: "text-loss", unknown: "text-mute" };

const clock = (ms: number, tz: string): string => new Date(ms).toLocaleTimeString("de-DE", { timeZone: tz, hour12: false });
const STALE_MS = 60_000;

function Row({ tone, children, testId }: { tone: Tone; children: ReactNode; testId: string }) {
  return (
    <li className="grid grid-cols-[auto_1fr] items-start gap-x-2.5 gap-y-0.5 rounded-lg bg-ink-950/60 px-3 py-2" data-testid={testId} data-tone={tone}>
      <span className={cn("mt-0.5 inline-flex items-center gap-1.5 whitespace-nowrap text-[10.5px] font-semibold uppercase tracking-[0.06em]", TONE_TEXT[tone])}>
        <span aria-hidden="true" className={cn("size-1.5 rounded-full", TONE_DOT[tone])} />
        {TONE_WORD[tone]}
      </span>
      <span className="num text-[12.5px] leading-snug text-fg [overflow-wrap:anywhere]">{children}</span>
    </li>
  );
}

export function ExecutionCheck({ plan, slippagePct, crypto }: { plan: TicketPlan; slippagePct: number; crypto: boolean }) {
  const [phase, setPhase] = useState<"idle" | "loading" | "done">("idle");
  const [result, setResult] = useState<BookResult | null>(null);
  const [clockNow, setClockNow] = useState<number | null>(null);
  const ctl = useRef<AbortController | null>(null);

  useEffect(() => () => ctl.current?.abort(), []);
  // the age of the snapshot is read from a slow tick, never from the render
  useEffect(() => {
    if (phase !== "done") return;
    const t0 = setTimeout(() => setClockNow(Date.now()), 0);
    const id = setInterval(() => setClockNow(Date.now()), 10_000);
    return () => {
      clearTimeout(t0);
      clearInterval(id);
    };
  }, [phase, result]);

  const run = async (): Promise<void> => {
    ctl.current?.abort();
    const c = new AbortController();
    ctl.current = c;
    setPhase("loading");
    const r = await loadBook(plan.symbol, defaultBookDeps(c.signal));
    if (c.signal.aborted) return;
    setResult(r);
    setClockNow(Date.now());
    setPhase("done");
  };

  // a reading belongs to the symbol it was taken for: another symbol in the plan shows none
  const forThis = result && result.symbol === plan.symbol.toUpperCase() ? result : null;
  const ok = forThis && forThis.ok ? forThis : null;
  const failed = forThis && !forThis.ok ? forThis : null;
  const check = useMemo(() => (ok ? checkExecution({ book: ok.book, side: plan.side, qty: plan.qty, assumedSlippage: slippagePct, quoteVolume24h: ok.quoteVolume24h }) : null), [ok, plan.side, plan.qty, slippagePct]);
  const quote = quoteOf(plan.symbol);
  const base = baseOf(plan.symbol);
  const tone = (id: FindingId): Tone => check?.findings.find((f) => f.id === id)?.tone ?? "unknown";
  const value = check?.touch ? plan.qty * check.touch.mid : null;
  const age = ok && clockNow !== null ? clockNow - ok.receivedAt : 0;

  if (!crypto) {
    return (
      <section className="grid gap-2 rounded-xl border border-line bg-ink-950/40 p-3" aria-label={S.title} data-testid="hplan-exec">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-mute">{S.title}</h3>
        <p className="text-[12.5px] leading-snug text-mute" data-testid="hplan-exec-stocks">
          {S.stocks}
        </p>
      </section>
    );
  }

  return (
    <section className="grid gap-3 rounded-xl border border-line bg-ink-950/40 p-3" aria-label={S.title} data-testid="hplan-exec">
      <div className="grid gap-1">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-mute">{S.title}</h3>
        <p className="text-[12px] leading-snug text-mute">{S.lead}</p>
      </div>
      <div>
        <Button size="sm" className="pointer-coarse:min-h-11" onClick={() => void run()} disabled={phase === "loading"} data-testid="hplan-exec-run">
          {phase === "loading" ? S.loading : phase === "done" ? S.again : S.button}
        </Button>
      </div>

      {failed && phase === "done" && (
        <div className="grid gap-1" role="status" data-testid="hplan-exec-failed">
          <p className="text-[12.5px] text-warn">
            Das Orderbuch ließ sich nicht lesen: {failureText(failed.kind)} Das ist keine Freigabe – es gibt dazu keine Zahlen.
          </p>
          <p className="num text-[11.5px] text-mute">Quelle: {S.source} · Stand: keine Daten · Versuch {clock(failed.at, plan.tz)} Uhr</p>
        </div>
      )}

      {ok && check && (
        <div className="grid gap-3" data-testid="hplan-exec-result" data-tone={check.tone}>
          <p className="text-[13px] font-medium text-fg" data-testid="hplan-exec-headline">
            {headline(check.tone)}
          </p>
          <ul className="grid gap-1.5">
            <Row tone={tone("spread")} testId="hplan-exec-spread">
              {spreadLine(check, plan.tick)}
            </Row>
            <Row tone={tone("depth")} testId="hplan-exec-entry">
              {legLine("Einstieg", base, check.entry, plan.tick, plan.lot)}
            </Row>
            <Row tone={tone("depth")} testId="hplan-exec-stop">
              {legLine("Stop-Ausstieg", base, check.stop, plan.tick, plan.lot)}
            </Row>
            <Row tone={tone("assumption")} testId="hplan-exec-assumption">
              {assumptionLine(check)}
            </Row>
            <Row tone={tone("turnover")} testId="hplan-exec-turnover">
              {turnoverLine(check, value, ok.quoteVolume24h, quote, ok.volumeNote)}
            </Row>
          </ul>
          {check.bands.length > 0 && (
            <div className="grid gap-1" data-testid="hplan-exec-depth">
              <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-mute">Tiefe um die Mitte</span>
              <ul className="grid gap-0.5">
                {check.bands.map((b) => (
                  <li key={b.pct} className="num text-[12px] text-mute">
                    {bandLine(b, quote)}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-[11.5px] leading-snug text-mute" data-testid="hplan-exec-rules">
            {SPREAD_RULE} {TURNOVER_RULE} Die Slippage wird als Abstand des Ø-Preises von der Mitte gerechnet (halber Spread plus Preiswirkung) und mit der Annahme im Plan ({priceText(slippagePct * 100, 0.001)} %) verglichen.
          </p>
          {age > STALE_MS && (
            <p className="text-[12px] text-warn" role="status" data-testid="hplan-exec-old">
              {S.old}
            </p>
          )}
          <p className="num text-[11.5px] leading-relaxed text-mute" data-testid="hplan-exec-stand">
            Quelle: {S.source} ({ok.levels} Stufen{ok.route === "proxy" ? ", über den EU-Proxy der App" : ", direkt"}) · Stand {clock(ok.asOf, plan.tz)} Uhr · abgerufen {clock(ok.receivedAt, plan.tz)} Uhr · Größe {qtyText(plan.qty, plan.lot)} {base}.
          </p>
          <p className="text-[11.5px] leading-snug text-mute">
            {S.moment} {S.noBacktest}
          </p>
        </div>
      )}
    </section>
  );
}

export default ExecutionCheck;
