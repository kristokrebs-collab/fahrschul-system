/**
 * "Frag dein Journal" (Paket F2) – a question in German, answered from the journal on this device: no model, no network, no guessing.
 *
 * The dot opens into a search bar (a clip-path that grows from the middle), the question is typed, a short shimmer reads
 * "Durchsuche 214 Trades …" (the count is the real one; the calculation itself takes milliseconds, the half second is a deliberate beat
 * and is skipped under reduced motion) and three result cards fan out from the middle. The answer comes from `askCards`
 * (`@/domain/ask`): the closed set of question types, filter / aggregate over the real closed trades, the real numbers, the trades they
 * are about (a button opens the list, each row opens the trade) and how reliable the sample is. A question it cannot place ends in
 * "So kann ich das noch nicht beantworten." with three examples – nothing is guessed, nothing is invented.
 *
 * Not the Coach chat and not the function finder: the finder (`features.ts`) finds PAGES and functions, the Coach chat keeps its history
 * and charts; this is the same answer engine as a bar with cards, placed where the reports are. Lazy chunk of the Berichte page.
 */
import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { askCards, exampleQuestions, type AskCard, type AskResult } from "@/domain/ask";
import type { AnswerData } from "@/domain/coach/nlq";
import type { EnrichedTrade } from "@/domain/types";
import { cn } from "@/lib/cn";
import { useReducedFx } from "@/motion/useReducedFx";
import { Card } from "@/primitives/Card";
import { EvidenceTrades } from "@/views/coach/ui";
import type { ReportPage } from "./hooks";
import "./frost.css";

/** The beat of the shimmer before the cards come (ms). Not a calculation time – see the header. */
export const SEEK_MS = 520;
/** At most this many trades are listed under the cards (the rest stay in the Trades list). */
export const LIST_MAX = 8;

export const ASK_COPY = {
  title: "Frag dein Journal",
  note: "Antworten nur aus deinen eigenen Trades – gerechnet auf diesem Gerät, ohne Netz und ohne KI.",
  dot: "Frage stellen",
  input: "Deine Frage",
  placeholder: "z. B. Verluste im Setup … letzten Monat",
  send: "Fragen",
  seek: (n: number) => `Durchsuche ${n} ${n === 1 ? "Trade" : "Trades"} …`,
  reading: "So habe ich die Frage gelesen",
  idle: "Frag in deinen Worten – ich rechne nur, was ich verstehe. Zum Beispiel:",
  tryThese: "Versuch es mit einer dieser Fragen:",
  trades: (n: number) => `Betroffene Trades (${n})`,
  tradesNote: (shown: number, n: number) => (n > shown ? `Die neuesten ${shown} von ${n} – die übrigen findest du unter Trades.` : `Alle ${n}.`),
  hide: "Trades ausblenden",
  reset: "Zurücksetzen",
  reliability: "Belastbarkeit",
} as const;

function ResultCards({ cards }: { cards: readonly AskCard[] }) {
  return (
    <ul className="fr-fan" data-testid="ask-cards" aria-label="Ergebnisse">
      {cards.map((c, i) => (
        <li key={c.id} className="fr-rcard fr-glass" style={{ ["--i" as string]: i }} data-testid="ask-card">
          <dl className="grid gap-1">
            <dt>{c.label}</dt>
            <dd data-tone={c.tone} data-testid="ask-card-value">
              {c.value}
            </dd>
          </dl>
          {c.sub && <small>{c.sub}</small>}
        </li>
      ))}
    </ul>
  );
}

function Examples({ items, onPick, label }: { items: readonly string[]; onPick: (q: string) => void; label: string }) {
  return (
    <div className="grid gap-2">
      <p className="text-[12.5px] leading-relaxed text-mute">{label}</p>
      <ul className="fr-ex" aria-label="Beispielfragen">
        {items.map((q) => (
          <li key={q}>
            <button type="button" className="fr-chip" onClick={() => onPick(q)} data-testid="ask-example">
              {q}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AskJournalCard({ page, className }: { page: Pick<ReportPage, "view" | "settings" | "events" | "cur">; className?: string }) {
  const { view, settings, events, cur } = page;
  const reduced = useReducedFx();
  const uid = useId();
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [phase, setPhase] = useState<"idle" | "seek" | "done">("idle");
  const [result, setResult] = useState<AskResult | null>(null);
  const [seq, setSeq] = useState(0);
  const [showTrades, setShowTrades] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const base: Omit<AnswerData, "now"> = useMemo(() => ({ closed: view.closed, settings, events, currency: cur, start: view.start }), [view.closed, view.start, settings, events, cur]);
  const examples = useMemo(() => exampleQuestions(base), [base]);
  const byId = useMemo(() => new Map<string, EnrichedTrade>(view.list.map((t) => [t.id, t])), [view.list]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const openBar = () => {
    setOpen(true);
    // focus after the bar started to grow (the input is not focusable while it is clipped)
    requestAnimationFrame(() => input.current?.focus());
  };
  const ask = (text: string) => {
    const question = text.trim();
    if (!question) return;
    setOpen(true);
    setQ(question);
    setShowTrades(false);
    // the answer is calculated at once (the real work takes milliseconds); only its arrival waits for the shimmer
    const r = askCards(question, { ...base, now: Date.now() });
    clearTimeout(timer.current);
    setResult(null);
    setSeq((n) => n + 1);
    if (reduced) {
      setResult(r);
      setPhase("done");
      return;
    }
    setPhase("seek");
    timer.current = setTimeout(() => {
      setResult(r);
      setPhase("done");
    }, SEEK_MS);
  };
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    ask(q);
  };
  const reset = () => {
    clearTimeout(timer.current);
    setQ("");
    setResult(null);
    setPhase("idle");
    setShowTrades(false);
    input.current?.focus();
  };
  const trades = result && result.status === "ok" ? result.tradeIds.map((id) => byId.get(id)).filter((t): t is EnrichedTrade => !!t) : [];
  const listed = trades.slice(0, LIST_MAX);

  return (
    <Card title={ASK_COPY.title} note={ASK_COPY.note} className={className} data-testid="ask-journal" data-phase={phase} innerClassName="grid content-start gap-3">
      <div className="fr-ask">
        <form className="fr-bar" role="search" aria-label={ASK_COPY.title} data-open={open ? "" : undefined} onSubmit={onSubmit} data-testid="ask-bar">
          <div className="fr-pillbox">
            <label htmlFor={`${uid}-q`} className="sr-only">
              {ASK_COPY.input}
            </label>
            <input
              ref={input}
              id={`${uid}-q`}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={ASK_COPY.placeholder}
              autoComplete="off"
              maxLength={300}
              enterKeyHint="search"
              tabIndex={open ? 0 : -1}
              aria-hidden={open ? undefined : true}
              data-testid="ask-input"
            />
            <button type="submit" className="fr-send" disabled={!q.trim() || !open} tabIndex={open ? 0 : -1} aria-hidden={open ? undefined : true} data-testid="ask-send">
              {ASK_COPY.send}
            </button>
          </div>
          {!open && <button type="button" className="fr-closedhit" aria-label={ASK_COPY.dot} aria-expanded="false" aria-controls={`${uid}-q`} onClick={openBar} data-testid="ask-open" />}
          <span className="fr-dotbtn" aria-hidden="true" data-testid="ask-dot" />
        </form>

        <div className="fr-stage" aria-live="polite" data-testid="ask-stage">
          <div className="fr-seek" data-on={phase === "seek" ? "" : undefined} data-testid="ask-seek">
            {phase === "seek" ? ASK_COPY.seek(view.closed.length) : ""}
          </div>

          {phase === "idle" && <Examples items={examples} onPick={ask} label={ASK_COPY.idle} />}

          {phase === "done" && result && result.status === "unknown" && (
            <div className="grid gap-3" data-testid="ask-unknown" data-reason={result.reason}>
              <p className="text-[14px] leading-snug text-fg">{result.message}</p>
              <Examples items={result.examples} onPick={ask} label={ASK_COPY.tryThese} />
            </div>
          )}

          {phase === "done" && result && result.status === "empty" && (
            <div className="grid gap-2" data-testid="ask-empty">
              <p className="text-[14px] leading-snug text-fg">{result.text}</p>
              <p className="text-[12px] text-mute">{result.confidence.note}</p>
            </div>
          )}

          {phase === "done" && result && result.status === "ok" && (
            <div key={seq} className="grid gap-3" data-testid="ask-answer" data-kind={result.kind}>
              {result.reading.length > 0 && (
                <ul className="flex flex-wrap gap-1.5" aria-label={ASK_COPY.reading}>
                  {result.reading.map((u) => (
                    <li key={u} className="rounded-md border border-line-2 px-1.5 py-0.5 font-mono text-[10.5px] tracking-wide text-mute">
                      {u}
                    </li>
                  ))}
                </ul>
              )}
              <ResultCards cards={result.cards} />
              <p className="text-[13.5px] leading-relaxed text-fg" data-testid="ask-text">
                {result.text}
              </p>
              <p className="text-[11.5px] leading-snug text-faint" data-testid="ask-confidence">
                <span className="font-semibold text-mute">{ASK_COPY.reliability}: {result.confidence.label}</span> · {result.confidence.note}
              </p>
            </div>
          )}
        </div>

        {phase === "done" && result && result.status === "ok" && trades.length > 0 && (
          <div className="grid gap-2" data-testid="ask-trades-block">
            <button
              type="button"
              className={cn("fr-chip justify-self-start")}
              aria-expanded={showTrades}
              onClick={() => setShowTrades((v) => !v)}
              data-testid="ask-trades-toggle"
            >
              {showTrades ? ASK_COPY.hide : ASK_COPY.trades(result.tradeIds.length)}
            </button>
            {showTrades && (
              <div className="grid gap-1" data-testid="ask-trades">
                <p className="text-[11.5px] text-faint">{ASK_COPY.tradesNote(listed.length, result.tradeIds.length)}</p>
                <EvidenceTrades trades={listed} group={`ask-ev-${seq}`} />
              </div>
            )}
          </div>
        )}

        {phase !== "idle" && (
          <button type="button" className="fr-chip justify-self-start" onClick={reset} data-testid="ask-reset">
            {ASK_COPY.reset}
          </button>
        )}
      </div>
    </Card>
  );
}
