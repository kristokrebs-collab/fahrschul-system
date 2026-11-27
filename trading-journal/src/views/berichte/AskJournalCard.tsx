/**
 * "Frag dein Journal" (Paket F2, Runde 13 Paket B) – a question in German, answered from the journal on this device: no model, no
 * network, no guessing.
 *
 * A frosted panel: the search bar grows out of its red dot the first time the panel is seen, the question is typed, three result cards
 * fan out from the middle. The answer comes from `askCards` (`@/domain/ask`) – the SAME deterministic engine as the Coach chat and the
 * assistant's journal branch, with its limits (docs/FRAG-DEIN-JOURNAL.md): the closed set of question types, filter / aggregate over the
 * real closed trades, the real numbers, the trades they are about (a button opens the list, each row opens the trade) and how reliable
 * the sample is. A question it cannot place ends in "So kann ich das noch nicht beantworten." with three examples – nothing is guessed.
 *
 * No pretended calculation time (Runde 13): the answer is worked out in the next task after the tap and shown the moment it exists. The
 * loader – a small `ThinkingOrb` ("search": looking through the journal) with "Durchsuche 214 Trades …" – exists only while that run is
 * open and becomes visible only if it is still open after `LOADER_AFTER_MS` (CSS delay), so a normal answer never flashes a loader.
 *
 * Wide (≥ 880 px of the panel) the bar and the limits stand left and the answer right; narrow they stack. As dense as the other report
 * cards: nothing reserves an empty stage. Lazy chunk of the Berichte page.
 */
import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { askCards, exampleQuestions, type AskCard, type AskResult } from "@/domain/ask";
import type { AnswerData } from "@/domain/coach/nlq";
import type { EnrichedTrade } from "@/domain/types";
import { cn } from "@/lib/cn";
import { ThinkingOrb } from "@/motion/ThinkingOrb";
import { EvidenceTrades } from "@/views/coach/ui";
import { FrostPanel, st, useSeen } from "./FrostPanel";
import type { ReportPage } from "./hooks";
import "./frost.css";

/** The loader shows only when a run is still open after this long (ms, the delay of `.fr-seek` in frost.css) – never for a normal answer. */
export const LOADER_AFTER_MS = 160;
/** At most this many trades are listed under the cards (the rest stay in the Trades list). */
export const LIST_MAX = 8;

export const ASK_COPY = {
  title: "Frag dein Journal",
  note: "Antworten nur aus deinen eigenen Trades – gerechnet auf diesem Gerät, ohne Netz und ohne KI.",
  limits: "Nur abgeschlossene Trades. Ein Rückblick – kein Rat und keine Prognose. Was ich nicht verstehe, beantworte ich nicht.",
  none: "Noch keine abgeschlossenen Trades. Sobald du den ersten Trade schließt, rechne ich hier mit deinen Zahlen.",
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
        <li key={c.id} className="fr-rcard fr-glass" style={st(i)} data-testid="ask-card">
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
  const uid = useId();
  const input = useRef<HTMLInputElement>(null);
  const [bar, seen] = useSeen<HTMLFormElement>();
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

  const ask = (text: string) => {
    const question = text.trim();
    if (!question) return;
    setQ(question);
    setShowTrades(false);
    clearTimeout(timer.current);
    setResult(null);
    setSeq((n) => n + 1);
    setPhase("seek");
    // the run itself, in its own task (the tap paints first): it ends when the answer exists – no beat is added
    timer.current = setTimeout(() => {
      setResult(askCards(question, { ...base, now: Date.now() }));
      setPhase("done");
    }, 0);
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
  const ok = phase === "done" && result?.status === "ok" ? result : null;
  const trades = ok ? ok.tradeIds.map((id) => byId.get(id)).filter((t): t is EnrichedTrade => !!t) : [];
  const listed = trades.slice(0, LIST_MAX);
  const total = view.closed.length;

  return (
    <FrostPanel title={ASK_COPY.title} note={ASK_COPY.note} className={className} data-testid="ask-journal" data-phase={phase}>
      <div className="fr-ask">
        <div className="fr-askq fr-st" style={st(1)}>
          <form ref={bar} className="fr-bar" role="search" aria-label={ASK_COPY.title} data-open={seen ? "" : undefined} onSubmit={onSubmit} data-testid="ask-bar">
            <div className="fr-pillbox">
              <label htmlFor={`${uid}-q`} className="sr-only">
                {ASK_COPY.input}
              </label>
              <input ref={input} id={`${uid}-q`} value={q} onChange={(e) => setQ(e.target.value)} placeholder={ASK_COPY.placeholder} autoComplete="off" maxLength={300} enterKeyHint="search" data-testid="ask-input" />
              <button type="submit" className="fr-send" disabled={!q.trim()} data-testid="ask-send">
                {ASK_COPY.send}
              </button>
            </div>
            <span className="fr-dotbtn" aria-hidden="true" data-testid="ask-dot" />
          </form>
          <p className="fr-limits" data-testid="ask-limits">
            {ASK_COPY.limits}
          </p>
        </div>

        <div className="fr-stage fr-st" style={st(2)} aria-live="polite" data-testid="ask-stage">
          {phase === "seek" && (
            <div className="fr-seek" data-on="" data-testid="ask-seek">
              <ThinkingOrb variant="search" size={18} className="text-mute" />
              <span>{ASK_COPY.seek(total)}</span>
            </div>
          )}

          {phase === "idle" &&
            (total > 0 ? (
              <Examples items={examples} onPick={ask} label={ASK_COPY.idle} />
            ) : (
              <p className="text-[13px] leading-relaxed text-mute" data-testid="ask-none">
                {ASK_COPY.none}
              </p>
            ))}

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

          {ok && (
            <div key={seq} className="grid gap-3" data-testid="ask-answer" data-kind={ok.kind}>
              {ok.reading.length > 0 && (
                <ul className="flex flex-wrap gap-1.5" aria-label={ASK_COPY.reading}>
                  {ok.reading.map((u) => (
                    <li key={u} className="rounded-md border border-line-2 px-1.5 py-0.5 font-mono text-[10.5px] tracking-wide text-mute">
                      {u}
                    </li>
                  ))}
                </ul>
              )}
              <ResultCards cards={ok.cards} />
              <p className="text-[13.5px] leading-relaxed text-fg" data-testid="ask-text">
                {ok.text}
              </p>
              <p className="text-[11.5px] leading-snug text-mute" data-testid="ask-confidence">
                <span className="font-semibold">
                  {ASK_COPY.reliability}: {ok.confidence.label}
                </span>{" "}
                · {ok.confidence.note}
              </p>
            </div>
          )}

          {phase !== "idle" && (
            <div className="flex flex-wrap items-center gap-2" data-testid="ask-actions">
              {ok && trades.length > 0 && (
                <button type="button" className="fr-chip" aria-expanded={showTrades} onClick={() => setShowTrades((v) => !v)} data-testid="ask-trades-toggle">
                  {showTrades ? ASK_COPY.hide : ASK_COPY.trades(ok.tradeIds.length)}
                </button>
              )}
              <button type="button" className={cn("fr-chip", "ml-auto")} onClick={reset} data-testid="ask-reset">
                {ASK_COPY.reset}
              </button>
            </div>
          )}
          {ok && trades.length > 0 && showTrades && (
            <div className="grid gap-1" data-testid="ask-trades">
              <p className="text-[11.5px] text-mute">{ASK_COPY.tradesNote(listed.length, ok.tradeIds.length)}</p>
              <EvidenceTrades trades={listed} group={`ask-ev-${seq}`} />
            </div>
          )}
        </div>
      </div>
    </FrostPanel>
  );
}
