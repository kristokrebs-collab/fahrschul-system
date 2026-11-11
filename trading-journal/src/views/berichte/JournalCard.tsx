/**
 * "Einträge durchgehen" (Paket F2) – the closed trades of the shown period, one at a time, in a frosted card in front of the word REVIEW.
 *
 * Everything on the card is the journal's own: "Eintrag 06 von 12" is the position in the REAL list of the period (`entryList`), the chips
 * are the setups and tags the trader gave that trade, the R and the net are the stored, fee-adjusted values (a trade without a stop has no
 * R and says so), the pill says whether it has a review. A loss stays a loss: the same red, the same markup, no festive treatment, no
 * "almost". The quiet curve behind the card is the real cumulative result of the period; the dashed line marks the entry on screen.
 *
 * Turning: the two round buttons (44 px), ← / → / Home / End with the card focused, a swipe (`swipeStep`). It stops at both ends (no wrap).
 * "Trade öffnen" opens the trade detail. An empty period says so. Reduced motion: the card and the word stand there at once, a step swaps
 * the entry without sliding (`base.css` zeroes every duration).
 */
import { useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { entryCurve, entryList, entryView, keyStep, pad2, stepIndex, swipeStep, type EntryView } from "@/domain/reports/entries";
import type { EnrichedTrade, Settings } from "@/domain/types";
import { cn } from "@/lib/cn";
import { price, r as fmtR, signed } from "@/lib/format";
import { Card } from "@/primitives/Card";
import { EmptyState } from "@/primitives/EmptyState";
import { openTrade } from "@/views/insights/ui";
import "./frost.css";

export const JOURNAL_STRINGS = {
  title: "Einträge durchgehen",
  note: "Deine abgeschlossenen Trades dieses Zeitraums, einer nach dem anderen – mit dem, was du selbst eingetragen hast.",
  empty: "Keine abgeschlossenen Trades in diesem Zeitraum.",
  emptyText: "Sobald es welche gibt, kannst du sie hier nacheinander durchgehen.",
  word: "REVIEW",
  prev: "Vorheriger Eintrag",
  next: "Nächster Eintrag",
  open: "Trade öffnen",
  noSetup: "ohne Setup",
  noText: "Keine Begründung oder Notiz eingetragen.",
  noStop: "kein Stopp, daher kein R",
  checklist: (k: number, n: number) => `Checkliste ${k} von ${n}`,
  review: { yes: "Review geschrieben", no: "Review offen" },
  plan: { yes: "Plan befolgt", no: "Plan nicht befolgt" },
  hint: "← → blättern, Home und Ende springen, auf dem Handy wischen.",
} as const;

const sideLabel = (s: EntryView["side"]): string => (s === "short" ? "Short" : "Long");
const TONE_CLASS = { win: "text-win", loss: "text-loss", mute: "text-mute" } as const;

/** What the live region says after a step ("Eintrag 6 von 12: BTC/USDT, Long, −0,80 R"). */
export const entrySpoken = (e: EntryView): string => `Eintrag ${e.n} von ${e.of}: ${e.pair}, ${sideLabel(e.side)}, ${e.r != null ? fmtR(e.r) : JOURNAL_STRINGS.noStop}`;

function Curve({ points, at }: { points: readonly number[]; at: number }) {
  const w = 960;
  const h = 560;
  const lo = Math.min(...points);
  const hi = Math.max(...points);
  const span = hi - lo || 1;
  const x = (i: number) => (points.length > 1 ? (i / (points.length - 1)) * w : w / 2);
  const y = (v: number) => h * 0.78 - ((v - lo) / span) * h * 0.5;
  const line = points.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  // the dashed line stands on the point AFTER entry `at` (points[0] is the start at 0)
  const cx = x(at + 1);
  return (
    <svg className="fr-curve" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true" data-testid="journal-curve">
      <polyline points={line} />
      <line x1={0} x2={0} y1={0} y2={h} style={{ transform: `translate3d(${cx}px,0,0)` }} />
    </svg>
  );
}

function EntryBody({ e, dir }: { e: EntryView; dir: "next" | "prev" | "none" }) {
  const S = JOURNAL_STRINGS;
  const labelId = useId();
  const chips = [...e.setups.map((s) => ({ k: `s:${s}`, text: s })), ...e.tags.map((t) => ({ k: `t:${t}`, text: `#${t}` }))];
  const numbers: [string, number | null][] = [
    ["Einstieg", e.plan.entry],
    ["Stopp", e.plan.stop],
    ["Ziel", e.plan.target],
    ["Ausstieg", e.plan.exit],
  ];
  return (
    <div className="fr-body" data-dir={dir} data-testid="journal-entry" data-id={e.id}>
      <div className="fr-top">
        <span className="fr-pill" data-testid="journal-pill">
          Eintrag {pad2(e.n)} von {pad2(e.of)}
        </span>
        <span className="fr-numeral" aria-hidden="true">
          {pad2(e.n)}
        </span>
      </div>
      <h3 className="fr-title">
        {e.pair}
        <small>
          {sideLabel(e.side)} · {e.when}
        </small>
      </h3>
      <dl className="fr-plan" aria-label="Plan und Ausführung">
        {numbers.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v == null ? "–" : price(v)}</dd>
          </div>
        ))}
      </dl>
      <p className="fr-excerpt" data-testid="journal-excerpt">{e.excerpt || S.noText}</p>
      <div className="grid gap-1.5">
        <span className="fr-label" id={labelId}>
          Setup
        </span>
        <ul className="fr-chips" aria-labelledby={labelId}>
          {chips.length ? (
            chips.map((c) => (
              <li key={c.k} className="fr-pill" data-testid="journal-chip">
                {c.text}
              </li>
            ))
          ) : (
            <li className="fr-pill" data-quiet="" data-testid="journal-chip">
              {S.noSetup}
            </li>
          )}
        </ul>
      </div>
      <div className="fr-res">
        <div>
          <output className={TONE_CLASS[e.tone]} data-testid="journal-r" data-tone={e.tone} aria-label={`Ergebnis ${e.r != null ? fmtR(e.r) : S.noStop}`}>
            {e.r != null ? fmtR(e.r) : "– R"}
          </output>
          <small data-testid="journal-net">
            {e.net != null ? `${signed(e.net, 2)} netto` : "netto unbekannt"}
            {e.r == null ? ` · ${S.noStop}` : ""}
          </small>
        </div>
        <ul className="fr-chips" aria-label="Prozess" style={{ justifyContent: "flex-end" }}>
          <li className="fr-pill" data-quiet="" data-testid="journal-review">
            {e.process.reviewed ? S.review.yes : S.review.no}
          </li>
          {e.process.checklist && (
            <li className="fr-pill" data-quiet="">
              {S.checklist(e.process.checklist.checked, e.process.checklist.total)}
            </li>
          )}
          {e.process.followedPlan != null && (
            <li className="fr-pill" data-quiet="">
              {e.process.followedPlan ? S.plan.yes : S.plan.no}
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}

export function JournalCard({ trades, settings, className }: { trades: readonly EnrichedTrade[]; settings: Pick<Settings, "setups">; className?: string }) {
  const S = JOURNAL_STRINGS;
  const list = useMemo(() => entryList([...trades]), [trades]);
  const curve = useMemo(() => entryCurve(list), [list]);
  const [index, setIndex] = useState(0);
  const [dir, setDir] = useState<"next" | "prev" | "none">("none");
  const cur = Math.min(index, Math.max(0, list.length - 1));
  const e = entryView(list, cur, settings);
  const drag = useRef<{ x: number; y: number } | null>(null);
  // the live region reads a step, not the first paint
  const [spoken, setSpoken] = useState("");

  const go = (to: number) => {
    const next = stepIndex(0, to, list.length);
    if (next === cur) return;
    setDir(next > cur ? "next" : "prev");
    setIndex(next);
    const v = entryView(list, next, settings);
    if (v) setSpoken(entrySpoken(v));
  };

  if (!e) {
    return (
      <Card title={S.title} note={S.note} className={className} data-testid="journal-cards" data-state="empty">
        <EmptyState title={S.empty} text={S.emptyText} line={false} />
      </Card>
    );
  }
  const onKey = (ev: KeyboardEvent<HTMLElement>) => {
    const to = keyStep(ev.key, cur, list.length);
    if (to == null) return;
    ev.preventDefault();
    go(to);
  };
  const onDown = (ev: PointerEvent<HTMLElement>) => {
    if (ev.pointerType === "mouse" && ev.button !== 0) return;
    drag.current = { x: ev.clientX, y: ev.clientY };
  };
  const onUp = (ev: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const step = swipeStep(ev.clientX - d.x, ev.clientY - d.y);
    if (step !== 0) go(cur + step);
  };

  return (
    <section className={cn("fr-journal", className)} aria-label={S.title} data-testid="journal-cards" data-state="ready" data-index={cur + 1} data-total={list.length}>
      <Curve points={curve} at={cur} />
      <div className="fr-shade" aria-hidden="true" />
      <p className="fr-word" data-word={S.word} aria-hidden="true" data-testid="journal-word" />
      <article
        className="fr-card fr-glass"
        tabIndex={0}
        aria-roledescription="Eintrag"
        aria-label={`Eintrag ${e.n} von ${e.of}`}
        aria-keyshortcuts="ArrowLeft ArrowRight Home End"
        onKeyDown={onKey}
        onPointerDown={onDown}
        onPointerUp={onUp}
        onPointerCancel={() => (drag.current = null)}
        data-testid="journal-card"
      >
        <EntryBody key={e.id} e={e} dir={dir} />
        <div className="fr-nav">
          <button type="button" className="fr-round" aria-label={S.prev} disabled={cur === 0} onClick={() => go(cur - 1)} data-testid="journal-prev">
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
              <path d="M10 3.5 5.5 8l4.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button type="button" className="fr-round" aria-label={S.next} disabled={cur === list.length - 1} onClick={() => go(cur + 1)} data-testid="journal-next">
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
              <path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button type="button" className="fr-open" onClick={() => openTrade(e.id)} data-testid="journal-open">
            {S.open}
          </button>
        </div>
        <p className="sr-only">{S.hint}</p>
      </article>
      <p className="sr-only" role="status" aria-live="polite" data-testid="journal-live">
        {spoken}
      </p>
    </section>
  );
}
