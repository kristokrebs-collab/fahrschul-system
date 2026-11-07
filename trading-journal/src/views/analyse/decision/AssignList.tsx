/**
 * „Herkunft nachtragen“ (F24): the closed trades without a known decision, newest first, each with three taps – Ich · Regelwerk · KI.
 * The list only offers; a hint (a signal of the app that fits the trade in time) is information, never a pre-selection. A tap
 * writes that one trade (`setTradeDecision`) and the trade leaves the list.
 */
import { useMemo, useState } from "react";
import { decisionOf, DECISION_BY, type DecisionHint } from "@/domain/provenance";
import type { DecisionBy, EnrichedTrade } from "@/domain/types";
import { tradeTime } from "@/lib/dates";
import { date as fmtDate, r as fmtR, signed } from "@/lib/format";
import { Badge } from "@/primitives/Badge";
import { Button } from "@/primitives/Button";
import { Segmented } from "@/primitives/Segmented";
import { SEG_TOUCH } from "../ui";
import { setTradeDecision } from "./actions";
import { DECISION_UI } from "./strings";

const PAGE = 8;

function line(t: EnrichedTrade, cur: string): string {
  const when = fmtDate(tradeTime(t));
  const res = t.r != null ? fmtR(t.r) : `${signed(t.pnl ?? 0, 0)} ${cur}`;
  return `${when} · ${t.pair || "–"} · ${t.side === "long" ? "Long" : "Short"} · ${res}`;
}

export function AssignList({ closed, links, hints, cur }: { closed: readonly EnrichedTrade[]; links: ReadonlyMap<string, string>; hints: ReadonlyMap<string, DecisionHint>; cur: string }) {
  const [shown, setShown] = useState(PAGE);
  const [status, setStatus] = useState<string>("");
  const open = useMemo(() => closed.filter((t) => !decisionOf(t, links)).sort((a, b) => +tradeTime(b) - +tradeTime(a)), [closed, links]);
  const set = async (id: string, by: DecisionBy): Promise<void> => {
    const ok = await setTradeDecision(id, by);
    setStatus(ok ? DECISION_UI.setDone : DECISION_UI.setFailed);
  };
  return (
    <div className="grid gap-3" data-testid="decision-assign">
      <div className="grid gap-1">
        <h3 className="label !text-fg">{DECISION_UI.assignTitle}</h3>
        <p className="max-w-[68ch] text-[12.5px] leading-relaxed text-mute">{DECISION_UI.assignLead}</p>
      </div>
      {open.length === 0 ? (
        <p className="text-[13px] text-mute" data-testid="decision-assign-empty">
          {DECISION_UI.assignEmpty}
        </p>
      ) : (
        <ul className="grid gap-2">
          {open.slice(0, shown).map((t) => {
            const hint = hints.get(t.id);
            return (
              <li key={t.id} className="grid gap-2 rounded-xl border border-line bg-ink-950/50 px-3 py-2.5" data-testid="decision-assign-row" data-trade={t.id}>
                <span className="num min-w-0 font-mono text-[12.5px] text-fg">{line(t, cur)}</span>
                {hint && (
                  <span>
                    <Badge tone="steel" className="whitespace-normal text-left">
                      {DECISION_UI.hint(hint.label, hint.gapMin)}
                    </Badge>
                  </span>
                )}
                <Segmented<DecisionBy>
                  size="sm"
                  aria-label={`${DECISION_UI.chooseLabel}: ${line(t, cur)}`}
                  className={SEG_TOUCH}
                  value={null}
                  onChange={(v) => void set(t.id, v)}
                  options={DECISION_BY.map((v) => ({ v, label: DECISION_UI.choose[v] }))}
                />
              </li>
            );
          })}
        </ul>
      )}
      {open.length > shown && (
        <div>
          <Button size="sm" onClick={() => setShown((n) => n + PAGE)} data-testid="decision-assign-more">
            {DECISION_UI.assignMore(Math.min(PAGE, open.length - shown))}
          </Button>
        </div>
      )}
      <p className="min-h-[18px] text-[12px] text-mute" role="status" aria-live="polite" data-testid="decision-assign-status">
        {status}
      </p>
    </div>
  );
}
