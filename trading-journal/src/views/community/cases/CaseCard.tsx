import { motion } from "motion/react";
import { useId, useMemo, useState } from "react";
import { useCloudSession } from "@/cloud/session";
import { cn } from "@/lib/cn";
import { radius, spring, stagger, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Badge } from "@/primitives/Badge";
import { Button } from "@/primitives/Button";
import { Textarea } from "@/primitives/Input";
import { Segmented } from "@/primitives/Segmented";
import { Skeleton } from "@/primitives/Skeleton";
import { AnalysisNote } from "@/ui/AnalysisNote";
import { pushToast } from "@/store/uiStore";
import { CASES, DIRECTION_LABEL, INTERVAL_LABEL } from "@/social/caseStrings";
import { caseOutcome, delayCandles, futureBars, hitOf, tally, visibleBars, type CaseOutcome } from "@/social/cases";
import { CASE_CONFIDENCES, CASE_DIRECTIONS, type CaseDirection, type CaseInfo, type GroupDetail, type HypothesisInfo } from "@/social/contract";
import { fmtMove } from "@/social/format";
import { closeCase, deleteCase, postHypothesis, sendFeedback, useSocial } from "@/social/store";
import { S } from "@/social/strings";
import { Glyph } from "@/social/ui/glyphs";
import { Monogram } from "@/social/ui/Monogram";
import { ConfirmAction } from "../ConfirmAction";
import { CaseChart } from "./CaseChart";
import { useCaseBars } from "./useCaseBars";

const when = (iso: string) => new Date(iso).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const stamp = (t: number) => new Date(t).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const pctText = (v: number) => `${v.toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;

/** Until the candles are there (or when they failed) no hypothesis can be judged. */
const UNJUDGED: CaseOutcome = { status: "unavailable", reason: "noAnchor" };

function reportCase(id: string): void {
  if (useCloudSession.getState().phase !== "signedIn") {
    pushToast({ kind: "error", title: S.loginToReport });
    return;
  }
  void sendFeedback({ kind: "report", message: "Unangemessener Inhalt", page: "community", target: { type: "case", id } });
}

/** One hypothesis of the group, with the time the server stored it and – once the outcome is known – whether it fit. */
function HypothesisRow({ h, c, outcome }: { h: HypothesisInfo; c: CaseInfo; outcome: CaseOutcome }) {
  const hit = hitOf(h, outcome);
  const delay = delayCandles(h, c);
  return (
    <li className="grid gap-1.5 rounded-xl border border-line bg-ink-950/40 px-3 py-2.5" data-testid="hypothesis-row">
      <div className="flex flex-wrap items-center gap-2">
        <Monogram pseudonym={h.author} size="sm" tone={h.me ? "signal" : "fg"} />
        <span className="min-w-0 truncate text-[13px] font-medium">{h.me ? `${CASES.you} · ${h.author}` : h.author}</span>
        <Badge tone={h.direction === "up" ? "win" : h.direction === "down" ? "loss" : "mute"}>{DIRECTION_LABEL[h.direction]}</Badge>
        <span className="num font-mono text-[11.5px] text-mute">{h.confidence} %</span>
        {hit != null && (
          <Badge tone={hit ? "win" : "loss"} dot>
            {hit ? CASES.hit : CASES.miss}
          </Badge>
        )}
        <span className="flex-1" />
        <span className="font-mono text-[10.5px] text-faint" title={CASES.delayNote}>
          {delay === 0 ? CASES.delay0 : CASES.delayN(delay)}
        </span>
      </div>
      <p className="text-[13px] leading-relaxed text-fg [overflow-wrap:anywhere]">{h.reason}</p>
    </li>
  );
}

/** The one thing a reader does before the future is shown: write the hypothesis. It is stored once and not changed. */
function Form({ c }: { c: CaseInfo }) {
  const busy = useSocial((s) => s.busy);
  const [direction, setDirection] = useState<CaseDirection | null>(null);
  const [confidence, setConfidence] = useState<number>(60);
  const [reason, setReason] = useState("");
  const [tried, setTried] = useState(false);
  const rid = useId();
  const short = reason.trim().length < 10;
  const submit = async () => {
    if (!direction || short) {
      setTried(true);
      return;
    }
    await postHypothesis(c.groupId, c.id, { direction, confidence: confidence as 50, reason: reason.trim() });
  };
  return (
    <div className="grid gap-3 rounded-2xl border border-line-2 bg-ink-950/50 p-3.5" data-testid="case-form">
      <h4 className="label">{CASES.formTitle}</h4>
      <div className="grid gap-1.5">
        <span className="text-[12.5px] text-mute">{CASES.direction}</span>
        <Segmented<CaseDirection>
          aria-label={CASES.direction}
          options={CASE_DIRECTIONS.map((d) => ({ v: d, label: DIRECTION_LABEL[d] }))}
          value={direction}
          onChange={setDirection}
          tones={{ up: "bg-win/15 border-win/30", down: "bg-loss/15 border-loss/30" }}
          className="w-full"
        />
        {tried && !direction && <span className="text-[12px] text-loss">{CASES.direction}</span>}
      </div>
      <div className="grid gap-1.5">
        <span className="text-[12.5px] text-mute">{CASES.confidence}</span>
        <Segmented<string> size="sm" aria-label={CASES.confidence} options={CASE_CONFIDENCES.map((p) => ({ v: String(p), label: `${p} %` }))} value={String(confidence)} onChange={(v) => setConfidence(Number(v))} className="w-full" />
      </div>
      <div className="grid gap-1.5">
        <label htmlFor={rid} className="text-[12.5px] text-mute">
          {CASES.reason}
        </label>
        <Textarea id={rid} value={reason} maxLength={280} rows={3} onChange={(e) => setReason(e.target.value)} placeholder={CASES.reasonPlaceholder} data-testid="case-reason" />
        {tried && short && <span className="text-[12px] text-loss">{CASES.reasonShort}</span>}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" onClick={submit} disabled={busy === "hypothesis"} data-testid="case-commit">
          <Glyph name="check" className="size-4" />
          {CASES.commit}
        </Button>
        <span className="min-w-0 flex-1 text-[12px] leading-snug text-faint">{CASES.commitHint}</span>
      </div>
    </div>
  );
}

/** The result block: what the price did, in the numbers of the public candles, and how my hypothesis fits. */
function Result({ c, outcome }: { c: CaseInfo; outcome: CaseOutcome }) {
  const mine = c.mine;
  const hit = mine ? hitOf(mine, outcome) : null;
  return (
    <div className="grid gap-2 rounded-2xl border border-line bg-ink-950/40 p-3.5" data-testid="case-result" data-outcome={outcome.status}>
      <h4 className="label">{CASES.resultTitle}</h4>
      {outcome.status === "pending" ? (
        <p className="text-[13px] leading-relaxed text-mute">{CASES.pending(stamp(outcome.readyAt))}</p>
      ) : outcome.status === "unavailable" ? (
        <p className="text-[13px] leading-relaxed text-warn">{CASES.unavailable[outcome.reason]}</p>
      ) : (
        <>
          <p className="text-[13.5px] leading-relaxed" data-testid="case-outcome">
            {CASES.outcome(fmtMove(outcome.movePct), c.horizon, pctText(outcome.bandPct), DIRECTION_LABEL[outcome.direction])}
          </p>
          <p className="text-[12.5px] text-mute">{CASES.way(fmtMove(outcome.maxUpPct), fmtMove(outcome.maxDownPct))}</p>
          {mine && hit != null && (
            <p className={cn("text-[13.5px] font-medium", hit ? "text-win" : "text-loss")} data-testid="case-mine-result">
              {CASES.hitNote(DIRECTION_LABEL[mine.direction], mine.confidence, hit ? CASES.hit : CASES.miss)}
            </p>
          )}
          <p className="text-[12px] leading-snug text-faint">{CASES.convention}</p>
          <p className="text-[12px] leading-snug text-faint">{CASES.oneCase}</p>
        </>
      )}
    </div>
  );
}

/**
 * One Chartfall (F47). The reader sees the candles up to the anchor; the future – in the picture AND in its scale – stays
 * out until the hypothesis is stored (or the case is closed). Then the result is worked out from the public candles on
 * this device. The others' hypotheses appear when the case closes, each with the time the server stored it.
 */
export function CaseCard({ c, group, index }: { c: CaseInfo; group: GroupDetail; index: number }) {
  const reduced = useReducedFx();
  const manager = group.role === "owner" || group.role === "mentor";
  const [retry, setRetry] = useState(0);
  const [now] = useState(() => Date.now());
  const load = useCaseBars(c, true, retry);
  const hasMine = !!c.mine;
  const showFuture = hasMine || c.closed;
  const bars = load.status === "ok" ? load.bars : null;
  const outcome = useMemo<CaseOutcome | null>(() => (bars ? caseOutcome(bars, c, now) : null), [bars, c, now]);
  const visible = useMemo(() => (bars ? visibleBars(bars, c) : []), [bars, c]);
  const future = useMemo(() => (bars && showFuture ? futureBars(bars, c) : []), [bars, c, showFuture]);
  const everyone = useMemo(() => [...(c.mine ? [c.mine] : []), ...c.revealed].sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1)), [c.mine, c.revealed]);
  const judge = outcome ?? UNJUDGED;
  const t = outcome ? tally(everyone, outcome) : null;
  const phase = c.closed ? "closed" : hasMine ? "committed" : "decide";
  const size = INTERVAL_LABEL[c.interval];
  return (
    <motion.article
      layout="position"
      id={`case-${c.id}`}
      className="grid gap-3 rounded-2xl border border-line bg-ink-900 p-4"
      style={{ borderRadius: radius.card }}
      initial={reduced ? false : { opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0, transitionEnd: { transform: "none" } }}
      transition={{ default: { ...spring.enter, delay: Math.min(index, stagger.max) * stagger.cards }, opacity: { ...tween.fade, delay: Math.min(index, stagger.max) * stagger.cards }, layout: spring.layout }}
      data-testid="case-card"
      data-phase={phase}
    >
      <header className="flex flex-wrap items-center gap-2">
        <Monogram pseudonym={c.author} tone={c.me ? "signal" : "fg"} />
        <span className="grid min-w-0">
          <span className="truncate text-[13.5px] font-medium">{c.me ? `${CASES.you} · ${c.author}` : c.author}</span>
          <span className="font-mono text-[10.5px] text-faint">{when(c.createdAt)}</span>
        </span>
        <span className="flex-1" />
        <Badge tone={c.closed ? "mute" : "warn"} dot>
          {c.closed ? CASES.closedBadge : CASES.open(when(c.closesAt))}
        </Badge>
        <Badge tone="mute">{CASES.hypotheses(c.hypotheses)}</Badge>
      </header>

      <div className="grid gap-1">
        <h4 className="text-[15px] font-semibold tracking-tight">
          {c.pair} · {size}
        </h4>
        <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-faint">{CASES.anchor(stamp(c.anchorMs))}</span>
      </div>
      {c.question && <blockquote className="border-l-2 border-signal/60 pl-3 text-[13.5px] leading-relaxed text-fg [overflow-wrap:anywhere]">{c.question}</blockquote>}
      <p className="text-[13px] text-mute">{CASES.question(c.horizon, size)}</p>

      {load.status === "loading" || load.status === "idle" ? (
        <Skeleton className="aspect-[640/260] w-full rounded-xl" />
      ) : load.status === "error" ? (
        <div className="grid justify-items-start gap-2 rounded-xl border border-line bg-ink-950/40 p-4" role="alert" data-testid="case-error">
          <p className="text-[13px] text-warn">{load.message}</p>
          <Button size="sm" onClick={() => setRetry((n) => n + 1)}>
            {CASES.reload}
          </Button>
        </div>
      ) : (
        <CaseChart visible={visible} future={future} frame={c} bandPct={outcome?.status === "ready" && showFuture ? outcome.bandPct : null} end={outcome?.status === "ready" && showFuture ? outcome.end : null} />
      )}

      {phase === "decide" && load.status === "ok" && <Form c={c} />}
      {phase === "decide" && load.status === "ok" && <p className="text-[12px] text-faint">{CASES.futureHidden}</p>}

      {showFuture && outcome && <Result c={c} outcome={outcome} />}

      {phase === "committed" && c.mine && (
        <div className="grid gap-2" data-testid="case-mine">
          <h4 className="label">{CASES.mine}</h4>
          <ul className="grid gap-1.5">
            <HypothesisRow h={c.mine} c={c} outcome={judge} />
          </ul>
          <p className="text-[12px] leading-snug text-faint">{CASES.hiddenUntilClosed}</p>
        </div>
      )}

      {phase === "closed" && (
        <div className="grid gap-2" data-testid="case-others">
          <h4 className="label">{CASES.others}</h4>
          {everyone.length === 0 ? (
            <p className="text-[13px] text-mute">{CASES.nobody}</p>
          ) : (
            <>
              {t && (
                <p className="text-[12.5px] leading-snug text-mute" data-testid="case-tally">
                  {CASES.tally(t)}
                  {t.judged > 0 ? ` · ${CASES.hitRate(t.hits, t.judged, t.hitRate)}` : ""}
                </p>
              )}
              <ul className="grid gap-1.5">
                {everyone.map((h) => (
                  <HypothesisRow key={h.authorId} h={h} c={c} outcome={judge} />
                ))}
              </ul>
              <p className="text-[12px] leading-snug text-faint">{CASES.delayNote}</p>
            </>
          )}
        </div>
      )}

      {(phase === "closed" || phase === "committed") && <AnalysisNote lead="Die Zahlen kommen aus den öffentlichen Kerzen der Börse." className="text-[11.5px]" />}

      <footer className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
        {!c.closed && (c.me || manager) && (
          <Button size="sm" onClick={() => void closeCase(group.id, c.id)} title={CASES.closeHint} data-testid="case-close">
            <Glyph name="check" className="size-3.5" />
            {CASES.close}
          </Button>
        )}
        <span className="flex-1" />
        {!c.me && (
          <Button size="sm" onClick={() => reportCase(c.id)} aria-label={CASES.report}>
            <Glyph name="flag" className="size-3.5" />
          </Button>
        )}
        {(c.me || manager) && <ConfirmAction label={CASES.delete} question={CASES.deleteAsk} onConfirm={() => void deleteCase(group.id, c.id)} testId="case-delete" />}
      </footer>
    </motion.article>
  );
}
