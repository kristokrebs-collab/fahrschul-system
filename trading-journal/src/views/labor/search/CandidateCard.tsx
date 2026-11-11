/**
 * „Aktueller Kandidat“: after a passed search the winner's rules on the CURRENT candles – signal now (Long / Short / none, honest „Heute kein
 * Signal – warte“), entry / stop / target from the rules, for the opening range the reasons one by one (volume factor, trend yes / no, grade),
 * the position size from the trader's OWN risk settings (nothing is shown as a recommendation when the trader never set a risk), a note on fees and
 * funding, and „In Handelsplan übernehmen“, which only opens the Handelsplan prefilled – nothing is ordered, saved or booked. A rejected search offers
 * no candidate. No financial advice.
 */
import { useMemo, useState } from "react";
import { sizeCandidate, type Candidate } from "@/domain/lab/search";
import { riskLimits } from "@/domain/risk/config";
import type { AccountId } from "@/domain/types";
import { cn } from "@/lib/cn";
import { dateTime, price, n0, n2 } from "@/lib/format";
import { Button } from "@/primitives/Button";
import { Card } from "@/primitives/Card";
import { Segmented } from "@/primitives/Segmented";
import { useJournal } from "@/store/journalStore";
import { Kpi } from "../ui";
import { openCandidateInPlan } from "./openInPlan";
import { checkCandidate, useSearch } from "./searchStore";
import { SEARCH } from "./strings";

const C = SEARCH.candidate;
const ACC = [
  { v: "scalp" as const, label: "Scalp" },
  { v: "makro" as const, label: "Makro" },
];
const STATE_TEXT: Record<Candidate["state"], string> = { long: C.long, short: C.short, none: C.none, stale: C.stale, nodata: C.nodata };

export function CandidateCard({ className }: { className?: string }) {
  const summary = useSearch((s) => s.summary);
  const candidate = useSearch((s) => s.candidate);
  const busy = useSearch((s) => s.candidateBusy);
  const err = useSearch((s) => s.candidateError);
  const settings = useJournal((s) => s.settings);
  const wd = summary?.datasets.find((d) => d.family === summary.winnerFamily);
  const [acc, setAcc] = useState<AccountId>(wd?.interval === "5m" || wd?.interval === "1h" ? "scalp" : "makro");
  const limits = useMemo(() => riskLimits(settings), [settings]);
  // only a risk the trader SAVED himself counts: `settings.risk` holds the key only after a save that changed it
  const ownRisk = useMemo(() => {
    const r = (settings as { risk?: { riskPerTradePct?: unknown } }).risk;
    return typeof r?.riskPerTradePct === "number" && r.riskPerTradePct > 0 ? r.riskPerTradePct : null;
  }, [settings]);
  const capital = settings.capital?.[acc] ?? null;
  const sig = candidate?.signal ?? null;
  const sizing = useMemo(() => (sig ? sizeCandidate(sig, { capital, riskPct: ownRisk, feePct: limits.feePct, slippagePct: limits.slippagePct, maxLeverage: limits.leverageRule[acc] ?? null }) : null), [sig, capital, ownRisk, limits, acc]);
  if (!summary) return null;
  const demo = summary.datasets.some((d) => d.fixture);
  const symbol = wd?.symbol ?? "";

  if (!summary.verdict.passed) {
    return (
      <Card title={C.title} className={className} data-testid="search-candidate" data-state="rejected">
        <p className="max-w-[62ch] text-[13px] leading-relaxed text-mute" data-testid="search-candidate-rejected">
          {C.rejected}
        </p>
      </Card>
    );
  }

  return (
    <Card title={C.title} note={C.note} className={className} data-testid="search-candidate" data-state={candidate?.state ?? "unchecked"}>
      <div className="grid gap-4">
        {!candidate && (
          <div className="grid justify-items-start gap-2">
            {wd?.fixture ? (
              <p className="text-[13px] text-mute">{C.noCandles}</p>
            ) : (
              <Button size="md" onClick={() => void checkCandidate()} loading={busy} data-testid="search-candidate-check">
                {busy ? C.checking : C.check}
              </Button>
            )}
            {err && (
              <p role="alert" className="text-[12.5px] text-(--color-danger-text)">
                {err}
              </p>
            )}
          </div>
        )}
        {candidate && (
          <>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">{C.signal}</span>
              <b className={cn("text-[20px] font-semibold leading-none", candidate.state === "long" && "text-win", candidate.state === "short" && "text-loss")} data-testid="search-candidate-state">
                {STATE_TEXT[candidate.state]}
              </b>
              <span className="num text-[11.5px] text-faint">{C.asOf(candidate.asOf ? dateTime(new Date(candidate.asOf)) : "–")}</span>
            </div>
            <p className="max-w-[68ch] text-[13px] leading-relaxed text-mute" data-testid="search-candidate-text">
              {candidate.text}
            </p>
            <p className="max-w-[68ch] text-[12px] leading-snug text-faint">
              <span className="text-mute">{C.rules}: </span>
              {candidate.rules}
            </p>
            {candidate.reasons && (
              <ul className="grid gap-1.5" data-testid="search-candidate-reasons" aria-label={C.reasons}>
                {candidate.reasons.map((r) => (
                  <li key={r.label} className="grid grid-cols-[5.5rem_1fr] gap-x-2 text-[12.5px] leading-snug" data-testid={`search-reason-${r.label.toLowerCase()}`} data-ok={r.ok == null ? "" : r.ok ? "true" : "false"}>
                    <span className="text-faint">{r.label}</span>
                    <span className="text-fg">
                      {r.value}
                      {r.ok != null && <span className="sr-only">{r.ok ? " – erfüllt" : " – nicht erfüllt"}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {sig && (
              <>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="search-candidate-levels">
                  <Kpi label={C.entry} sub={C.entryNote}>
                    {price(sig.entry)}
                  </Kpi>
                  <Kpi label={C.stop} sub={`${n2(sig.stopPct)} %`}>
                    {price(sig.stop)}
                  </Kpi>
                  <Kpi label={C.target} sub={`${n2(sig.targetR)} R`}>
                    {sig.target == null ? "–" : price(sig.target)}
                  </Kpi>
                  <Kpi label={C.timeStop}>{sig.maxBars == null ? C.timeStopSession : `${sig.maxBars} Kerzen`}</Kpi>
                </div>
                <div className="grid gap-2 rounded-xl border border-line bg-ink-950/50 px-3 py-2.5" data-testid="search-candidate-size">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">{C.size}</span>
                    <Segmented size="sm" aria-label={C.account} value={acc} onChange={setAcc} options={ACC} className="pointer-coarse:[&>button]:min-h-11 pointer-coarse:[&>button]:min-w-11 pointer-coarse:[&>button]:justify-center" />
                  </div>
                  {sizing?.kind === "ok" ? (
                    <>
                      <p className="num text-[15px] font-medium text-fg">
                        {n2(sizing.sizing.qty)} · {n0(sizing.sizing.notional)} USDT
                      </p>
                      <p className="text-[12px] leading-snug text-faint">{C.sizeLine(`${n2((ownRisk ?? 0) * 100)} %`, `${n0(capital ?? 0)} USDT`, acc === "scalp" ? "Konto Scalp" : "Konto Makro")}</p>
                      {sizing.sizing.overRule && <p className="text-[12px] leading-snug text-warn">{C.overRule(String(limits.leverageRule[acc] ?? ""))}</p>}
                    </>
                  ) : sizing?.kind === "needRisk" ? (
                    <div className="grid justify-items-start gap-2">
                      <p className="max-w-[62ch] text-[12.5px] leading-snug text-mute" data-testid="search-candidate-needrisk">
                        {C.needRisk}
                      </p>
                      <Button size="sm" variant="secondary" onClick={() => void import("@/app/featureOpen").then((m) => m.openFeature("risiko-einstellungen"))}>
                        {C.toRisk}
                      </Button>
                    </div>
                  ) : (
                    <p className="text-[12.5px] leading-snug text-mute">{sizing?.kind === "needCapital" ? C.needCapital : C.sizeError}</p>
                  )}
                  <p className="text-[11.5px] leading-snug text-faint">{C.costs}</p>
                </div>
                <div className="grid justify-items-start gap-1.5">
                  <Button size="md" variant="primary" fx={false} onClick={() => void openCandidateInPlan(symbol, sig)} data-testid="search-to-plan">
                    {C.toPlan}
                  </Button>
                  <p className="max-w-[62ch] text-[11.5px] leading-snug text-faint">{C.toPlanNote}</p>
                </div>
              </>
            )}
            {demo && <p className="text-[11.5px] font-semibold text-fg">{SEARCH.demo}.</p>}
          </>
        )}
      </div>
    </Card>
  );
}
