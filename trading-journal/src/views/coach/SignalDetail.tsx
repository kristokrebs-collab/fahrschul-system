/**
 * Signalprotokoll (F25/F28) in the detail of an inbox entry: the conditions that held when the app raised the signal (a list with
 * a word per line, never colour alone), the version of the rules it came from, and its history as dated lines – what the same
 * box / key level did around it, what you did with it, the trade the journal holds, the end of the window and the outcome the
 * candles gave. Everything is read from the archive, the journal and the evaluated outcome (`@/domain/missed/history`); a part
 * that is not known says so.
 */
import { useMemo } from "react";
import { ruleLabel, signalHistory, type SignalEvent, type SignalOutcome, type SignalPrereq } from "@/domain/missed";
import type { InboxRow } from "@/domain/missed";
import type { EnrichedTrade } from "@/domain/types";
import { cn } from "@/lib/cn";
import { getRuleVersions } from "@/market/ruleVersions";
import { stamp } from "./signalUi";

export const DETAIL_STRINGS = {
  prereq: "Voraussetzungen beim Auslösen",
  prereqNone: "Zu diesem Signal sind keine Voraussetzungen gespeichert (es entstand, bevor die App sie festhielt, oder die Quelle nennt keine).",
  prereqNote: "So stand es, als die App das Signal auslöste – später nachgerechnet wurde nichts.",
  rules: "Regelstand",
  rulesNone: "Kein Regelstand gespeichert (das Signal entstand, bevor die App Versionen festhielt).",
  rulesNote: "Ein Regelstand ist ein Fingerabdruck der Einstellungen, die die Auswertung verändern. Gleiche Einstellungen haben dieselbe Nummer; ändert sich eine, beginnt die nächste. Was sich geändert hat, steht hier nicht.",
  history: "Verlauf",
  sibling: "dieselbe Marke / Box",
  derived: "aus Journal, Kerzen oder Uhr",
} as const;

const MET_WORD: Record<"true" | "false" | "null", string> = { true: "erfüllt", false: "nicht erfüllt", null: "keine Daten" };

function Prereq({ list }: { list: readonly SignalPrereq[] }) {
  return (
    <section className="grid gap-1" aria-label={DETAIL_STRINGS.prereq} data-testid="detail-prereq">
      <h4 className="text-[10px] font-semibold uppercase tracking-[0.1em] text-mute">{DETAIL_STRINGS.prereq}</h4>
      {list.length === 0 ? (
        <p className="text-faint" data-testid="detail-prereq-none">
          {DETAIL_STRINGS.prereqNone}
        </p>
      ) : (
        <>
          <ul className="grid gap-0.5">
            {list.map((p) => {
              const k = String(p.met) as "true" | "false" | "null";
              return (
                <li key={p.id} className="grid grid-cols-[auto_1fr] gap-x-2" data-met={k}>
                  <span className={cn("whitespace-nowrap text-[10.5px] font-semibold uppercase tracking-[0.04em]", p.met === true ? "text-win" : p.met === false ? "text-loss" : "text-faint")}>
                    <span aria-hidden="true">{p.met === true ? "✓ " : p.met === false ? "✗ " : "? "}</span>
                    {MET_WORD[k]}
                  </span>
                  <span className="text-fg/90">{p.label}</span>
                </li>
              );
            })}
          </ul>
          <p className="text-faint">{DETAIL_STRINGS.prereqNote}</p>
        </>
      )}
    </section>
  );
}

function Rules({ event }: { event: SignalEvent }) {
  const r = event.rules;
  // is this still the rule set the app runs with? – read from the registry, nothing is recomputed
  const newest = useMemo(() => {
    if (!r) return null;
    const scope = r.kind === "key" ? (event.ref ?? "") : "";
    const mine = getRuleVersions().filter((v) => v.kind === r.kind && v.scope === scope);
    return mine.length ? mine.reduce((a, b) => (b.since > a.since ? b : a)) : null;
  }, [r, event.ref]);
  return (
    <section className="grid gap-1" aria-label={DETAIL_STRINGS.rules} data-testid="detail-rules">
      <h4 className="text-[10px] font-semibold uppercase tracking-[0.1em] text-mute">{DETAIL_STRINGS.rules}</h4>
      {r ? (
        <>
          <p className="num font-mono text-fg/90" data-testid="detail-rules-label">
            {ruleLabel(r)}
            {r.since != null ? ` · zuerst gesehen ${stamp(r.since)}` : ""}
          </p>
          {newest && newest.hash !== r.hash && (
            <p className="text-warn" data-testid="detail-rules-changed">
              Seitdem hat sich dieser Regelstand geändert: aktuell Regelstand {newest.n} ({newest.hash}) seit {stamp(newest.since)}.
            </p>
          )}
          <p className="text-faint">{DETAIL_STRINGS.rulesNote}</p>
        </>
      ) : (
        <p className="text-faint" data-testid="detail-rules-none">
          {DETAIL_STRINGS.rulesNone}
        </p>
      )}
    </section>
  );
}

export function SignalDetail({ row, events, trades, outcome }: { row: InboxRow; events: readonly SignalEvent[]; trades: readonly EnrichedTrade[]; outcome: SignalOutcome | undefined }) {
  const e = row.event;
  const lines = useMemo(() => signalHistory(e, events, trades, outcome), [e, events, trades, outcome]);
  return (
    <div className="grid gap-3" data-testid="detail-protocol">
      <Prereq list={e.prereq} />
      <Rules event={e} />
      <section className="grid gap-1" aria-label={DETAIL_STRINGS.history} data-testid="detail-history">
        <h4 className="text-[10px] font-semibold uppercase tracking-[0.1em] text-mute">{DETAIL_STRINGS.history}</h4>
        <ol className="grid gap-0.5">
          {lines.map((l, i) => (
            <li key={`${l.at}-${l.kind}-${i}`} className="grid grid-cols-[auto_1fr] gap-x-2" data-kind={l.kind} data-sibling={l.sibling} data-derived={l.derived}>
              <span className="num font-mono text-[11px] text-faint">{stamp(l.at)}</span>
              <span className={cn("text-fg/90", l.sibling && "text-mute")}>
                {l.text}
                {l.sibling ? <span className="text-faint"> · {DETAIL_STRINGS.sibling}</span> : l.derived ? <span className="text-faint"> · {DETAIL_STRINGS.derived}</span> : null}
              </span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
