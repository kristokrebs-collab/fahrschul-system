/**
 * Pre-trade check (P08): "Bereit" or "Pause" before the next entry – from today's check-in, the trader's own checklist
 * (the Grundregeln, else four standard points; ticks per device and day) and the live limits + pause of the P05 risk
 * guard (`useRiskBase` / `useLimitReport` / the guard's override – reused, never re-derived), plus today's revenge /
 * tilt patterns of the coach. The verdict is a dot-matrix word that cross-fades through the phosphor (BEREIT · OFFEN ·
 * PAUSE), the score a `ConfidenceMeter`, a running pause an error `StatusPill` whose ring runs to its end ("Pause ·
 * mm:ss" on `nowMv`, no render per second). Advice only – nothing is blocked.
 */
import { motion, useTransform } from "motion/react";
import { useMemo } from "react";
import { clockText } from "@/domain/risk";
import { preTradeChecklist, readiness, READINESS_LABEL, type CheckIn, type Level5 } from "@/domain/psych";
import type { BehaviorEvent } from "@/domain/coach/events";
import { cn } from "@/lib/cn";
import { useNowMv } from "@/motion/clock";
import { ConfidenceMeter } from "@/motion/fx";
import { DotMatrixText } from "@/motion/fx/DotMatrixText";
import { StatusPill } from "@/motion/StatusPill";
import { spring, stagger } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Card } from "@/primitives/Card";
import { CheckboxRow } from "@/primitives/CheckboxRow";
import { useJournal } from "@/store/journalStore";
import { useRiskGuardStore } from "@/views/risiko/guard";
import { useLimitReport, useRiskBase } from "@/views/risiko/hooks";
import { ticksFor, useGrowthUi } from "./growthStore";
import { WACHSTUM } from "./strings";

const WORD = { ready: "BEREIT", caution: "OFFEN", pause: "PAUSE" } as const;
const TONE = { ready: "win", caution: "warn", pause: "signal" } as const;

function PauseLabel({ endsAt }: { endsAt: number }) {
  const now = useNowMv();
  const text = useTransform(now, (t) => `Pause · ${clockText(endsAt - t)}`);
  return <motion.span className="num font-mono">{text}</motion.span>;
}

export interface PreTradeCheckProps {
  checkin: CheckIn | null;
  mood: Level5 | null;
  events: readonly BehaviorEvent[];
  todayKey: string;
  className?: string;
}

export function PreTradeCheck({ checkin, mood, events, todayKey, className }: PreTradeCheckProps) {
  const base = useRiskBase();
  const report = useLimitReport(base);
  const override = useRiskGuardStore((s) => s.override);
  const rules = useJournal((s) => s.settings.rules);
  const pretrade = useGrowthUi((s) => s.pretrade);
  const toggleTick = useGrowthUi((s) => s.toggleTick);
  const reduced = useReducedFx();
  const checklist = useMemo(() => preTradeChecklist(rules), [rules]);
  const ticked = ticksFor(pretrade, todayKey);
  const own = (rules ?? []).some((r) => r.text?.trim());
  const r = useMemo(
    () => readiness({ checkin, mood, checklist, ticked, limits: report.rows.length ? report : null, overrideUntil: override?.until ?? null, events, now: base.now }),
    [checkin, mood, checklist, ticked, report, override, events, base.now],
  );
  const cd = report.cooldown && report.cooldown.endsAt > base.now && !(override && override.until > base.now) ? report.cooldown : null;
  const shown = r.reasons.filter((x) => x.tone !== "ok").slice(0, 3);
  const oks = r.reasons.filter((x) => x.tone === "ok").slice(0, 2);

  return (
    <Card title={WACHSTUM.ready.title} data-testid="growth-ready" data-state={r.state} className={className}>
      <div className="grid gap-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="grid gap-2">
            <DotMatrixText text={WORD[r.state]} width={6} align="left" tone={TONE[r.state]} size={5} gap={2} label={READINESS_LABEL[r.state]} />
            <span className={cn("text-[13px] font-semibold", r.state === "ready" ? "text-win" : r.state === "pause" ? "text-signal" : "text-warn")} data-testid="growth-ready-label">
              {READINESS_LABEL[r.state]}
            </span>
          </div>
          <div className="grid justify-items-end gap-2">
            <ConfidenceMeter value={r.score} label="Bereitschaft" tone={r.state === "ready" ? "win" : r.state === "pause" ? "signal" : "fg"} />
            {cd ? <StatusPill tone="error" expanded ring={{ endsAt: cd.endsAt, ms: cd.endsAt - cd.since }} label={<PauseLabel endsAt={cd.endsAt} />} /> : null}
          </div>
        </div>

        {(shown.length > 0 || oks.length > 0) && (
          <ul className="grid gap-1.5" data-testid="growth-ready-reasons">
            {[...shown, ...(shown.length ? [] : oks)].map((x, i) => (
              <motion.li
                key={x.key}
                className="flex items-start gap-2 text-[12.5px] leading-snug"
                initial={reduced ? false : { opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0, transitionEnd: { transform: "none" } }}
                transition={{ ...spring.enter, delay: reduced ? 0 : i * stagger.rows * 2 }}
              >
                <span aria-hidden="true" className={cn("mt-[5px] size-1.5 shrink-0 rounded-full", x.tone === "stop" ? "bg-signal" : x.tone === "warn" ? "bg-warn" : "bg-win")} />
                <span className={x.tone === "ok" ? "text-mute" : "text-fg"}>{x.text}</span>
              </motion.li>
            ))}
          </ul>
        )}

        <div className="grid gap-1.5 border-t border-line pt-3">
          <div className="flex items-baseline justify-between gap-2">
            <span className="label !text-[10px]">{WACHSTUM.ready.checklist}</span>
            <span className="num font-mono text-[11px] text-faint" data-testid="growth-ready-count">
              {r.checked}/{r.total}
            </span>
          </div>
          <div className="grid gap-1" data-testid="growth-ready-checklist">
            {checklist.map((p) => (
              <CheckboxRow key={p.id} checked={ticked[p.id] === true} onToggle={() => toggleTick(todayKey, p.id)} strike>
                {p.text}
              </CheckboxRow>
            ))}
          </div>
          <span className="text-[10.5px] text-faint">{own ? WACHSTUM.ready.ownRules : WACHSTUM.ready.defaults}</span>
        </div>
      </div>
    </Card>
  );
}
