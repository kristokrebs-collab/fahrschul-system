/**
 * „Entscheidung: du, Regelwerk, KI“ (F24, Analyse › Vergleich): do the trader's own decisions, rule-based signals and AI
 * suggestions end differently? Per group the count with a sample word, the hit rate with its Wilson interval and the mean R with its
 * t-interval (`compareDecisions`), then every pair with a corrected verdict – and the sentences that say what the numbers do NOT
 * show. Too few trades is a state of its own („Zu wenig Daten“), never a smaller number. Below: „Herkunft nachtragen“ (the
 * trader's marks) and the KI-Protokoll, both behind a toggle. Numbers come from `@/domain/provenance`; nothing here changes a
 * trade except the trader's tap in the list.
 */
import { useMemo, useState } from "react";
import { basisLine, compareDecisions, inboxLinksOf, rText, signalHints, winText, type DecisionGroup } from "@/domain/provenance";
import type { AccountView } from "@/domain/account";
import { cn } from "@/lib/cn";
import { useSignalArchive } from "@/market/signalArchive";
import { Badge } from "@/primitives/Badge";
import { Button } from "@/primitives/Button";
import { Collapse } from "@/primitives/Expander";
import { AnaCard, CiWhisker, SigBadge, whiskerDomain } from "../ui";
import { AiLogPanel } from "./AiLogPanel";
import { AssignList } from "./AssignList";
import { DECISION_UI } from "./strings";

function Row({ label, value, tone = "fg" }: { label: string; value: string; tone?: "fg" | "mute" }) {
  return (
    <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 border-b border-line/70 py-1.5 text-[12.5px] last:border-b-0">
      <span className="text-mute">{label}</span>
      <span className={cn("num font-mono", tone === "mute" ? "text-mute" : "text-fg")}>{value}</span>
    </div>
  );
}

function GroupBlock({ g, domain, index }: { g: DecisionGroup; domain: [number, number]; index: number }) {
  const basis = basisLine(g);
  const ctx = g.n ? DECISION_UI.context(g.markets, g.first, g.last, g.longShare) : "";
  return (
    <li className="grid content-start gap-2 rounded-xl border border-line bg-ink-950/50 p-3" data-testid="decision-group" data-by={g.by} data-n={g.n} data-enough={g.enough ? "1" : "0"}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="min-w-0 text-[13.5px] font-semibold text-fg">{g.label}</h3>
        <Badge tone={g.level === "tragfähig" ? "steel" : "mute"}>{DECISION_UI.sample(g.level)}</Badge>
      </div>
      <p className="num font-mono text-[26px] font-semibold leading-none text-fg">
        {g.n} <span className="text-[12px] font-normal text-mute">{DECISION_UI.trades}</span>
      </p>
      {g.enough ? (
        <div className="grid">
          <Row label={DECISION_UI.rate} value={winText(g)} />
          <Row label={DECISION_UI.avgR} value={g.avgR == null ? "–" : rText(g)} tone={g.avgR == null ? "mute" : "fg"} />
          <CiWhisker ci={g.rCI} value={g.avgR} domain={domain} index={index} className="mt-1" />
          <p className="mt-1 text-[11.5px] leading-snug text-mute">{g.avgR == null ? DECISION_UI.avgRFew : DECISION_UI.rN(g.rN, g.n)}</p>
        </div>
      ) : (
        <p className="text-[12.5px] leading-relaxed text-mute" data-testid="decision-few">
          {g.n === 0 ? "Keine Trades. " : ""}
          {DECISION_UI.few}
        </p>
      )}
      {basis && <p className="text-[11.5px] leading-snug text-mute">{basis}</p>}
      {ctx && <p className="text-[11.5px] leading-snug text-mute">{ctx}</p>}
    </li>
  );
}

export function DecisionCard({ view, cur }: { view: AccountView; cur: string }) {
  const events = useSignalArchive();
  const links = useMemo(() => inboxLinksOf(events), [events]);
  const report = useMemo(() => compareDecisions(view.closed, links), [view.closed, links]);
  const hints = useMemo(() => signalHints(view.closed, events), [view.closed, events]);
  const [assign, setAssign] = useState(false);
  const [log, setLog] = useState(false);
  const domain = useMemo(() => whiskerDomain(report.groups.map((g) => g.rCI), report.groups.map((g) => g.avgR)), [report]);
  const none = report.assigned === 0;
  return (
    <AnaCard title={DECISION_UI.title} note={DECISION_UI.note} data-testid="ana-decision">
      <div className="grid gap-4" data-closed={report.closed} data-assigned={report.assigned} data-unassigned={report.unassigned}>
        {report.closed === 0 ? (
          <p className="text-[13px] leading-relaxed text-mute" data-testid="decision-none">
            {DECISION_UI.noTrades}
          </p>
        ) : (
          <>
            <p className="max-w-[72ch] text-[13.5px] leading-relaxed text-fg" data-testid="decision-headline">
              {none ? DECISION_UI.emptyTitle + ". " + DECISION_UI.emptyText : report.headline}
            </p>
            {!none && (
              <ul className="grid gap-3 md:grid-cols-3" aria-label={DECISION_UI.groupsLabel} data-testid="decision-groups">
                {report.groups.map((g, i) => (
                  <GroupBlock key={g.by} g={g} domain={domain} index={i} />
                ))}
              </ul>
            )}
            {!none && (
              <section className="grid gap-2" aria-label={DECISION_UI.pairsTitle} data-testid="decision-pairs">
                <h3 className="label">{DECISION_UI.pairsTitle}</h3>
                <p className="max-w-[72ch] text-[12px] leading-relaxed text-mute">{DECISION_UI.pairsNote}</p>
                <ul className="grid gap-2">
                  {report.pairs.map((p) => (
                    <li key={`${p.a}-${p.b}`} className="grid gap-1.5 rounded-xl border border-line bg-ink-950/50 px-3 py-2.5" data-testid="decision-pair" data-pair={`${p.a}-${p.b}`} data-comparable={p.comparable ? "1" : "0"}>
                      <p className="max-w-[72ch] text-[12.5px] leading-relaxed text-fg">{p.text}</p>
                      {p.comparable && (
                        <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-mute">
                          <span>Ø R</span>
                          <SigBadge verdict={p.avgR.verdict} />
                          <span>Trefferquote</span>
                          <SigBadge verdict={p.winRate.verdict} />
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {report.unassigned > 0 && (
              <p className="max-w-[72ch] text-[12.5px] leading-relaxed text-mute" data-testid="decision-unassigned">
                {DECISION_UI.unassigned(report.unassigned, report.closed)}
              </p>
            )}
          </>
        )}
        <p className="max-w-[72ch] text-[12px] leading-relaxed text-mute">{DECISION_UI.lead}</p>
        <div className="flex flex-wrap gap-2.5">
          {report.closed > 0 && (
            <Button size="sm" onClick={() => setAssign((o) => !o)} aria-expanded={assign} aria-controls="decision-assign-region" data-testid="decision-assign-toggle">
              {assign ? DECISION_UI.assignClose : DECISION_UI.assignOpen}
            </Button>
          )}
          <Button size="sm" onClick={() => setLog((o) => !o)} aria-expanded={log} aria-controls="decision-log-region" data-testid="decision-log-toggle">
            {DECISION_UI.logOpen}
          </Button>
        </div>
        <Collapse open={assign} id="decision-assign-region">
          <div className="pt-1">
            <AssignList closed={view.closed} links={links} hints={hints} cur={cur} />
          </div>
        </Collapse>
        <Collapse open={log} id="decision-log-region">
          <div className="pt-1">
            <AiLogPanel />
          </div>
        </Collapse>
      </div>
    </AnaCard>
  );
}
