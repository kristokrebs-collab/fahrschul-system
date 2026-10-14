/**
 * "Heute" (P04): the coach's view of today – trades and P&L of the day, the behaviours they triggered, the live
 * alert of the watcher (after a save: what the coach saw, the advice and the suggested pause as a `StatusPill` whose
 * ring runs down – "Pause · mm:ss" on the shared clock, zero renders per second) and the focus for the rest of the day
 * (the first step of the plan). A critical alert sends one signal-red `BorderBeam` lap round the card.
 */
import { themePaint } from "@/lib/themePaint";
import { motion, useTransform } from "motion/react";
import { useMemo } from "react";
import { BEHAVIOR_LABEL, triggerOf, type BehaviorEvent, type Recommendation } from "@/domain/coach";
import { clockText } from "@/domain/risk";
import type { EnrichedTrade } from "@/domain/types";
import { cn } from "@/lib/cn";
import { localDateKey, tradeTime } from "@/lib/dates";
import { signed } from "@/lib/format";
import { useNowMv } from "@/motion/clock";
import { StatusPill } from "@/motion/StatusPill";
import { BorderBeam } from "@/primitives/BorderBeam";
import { Button } from "@/primitives/Button";
import { Card } from "@/primitives/Card";
import { openTrade } from "@/views/insights/ui";
import { useCoachUi } from "./coachStore";
import { SeverityDot } from "./ui";

const SIGNAL_HEX = themePaint("#e5202e");

function PauseLabel({ until }: { until: number }) {
  const now = useNowMv();
  const text = useTransform(now, (t) => (until - t > 0 ? `Pause · ${clockText(until - t)}` : "Pause vorbei"));
  return <motion.span className="num font-mono">{text}</motion.span>;
}

export function TodayCard({ list, events, plan, cur, now, className }: { list: readonly EnrichedTrade[]; events: readonly BehaviorEvent[]; plan: readonly Recommendation[]; cur: string; now: number; className?: string }) {
  const alert = useCoachUi((s) => s.alert);
  const dismiss = useCoachUi((s) => s.dismissAlert);
  const today = localDateKey(new Date(now));
  const trades = useMemo(() => list.filter((t) => localDateKey(tradeTime(t)) === today), [list, today]);
  const ids = useMemo(() => new Set(trades.map((t) => t.id)), [trades]);
  const todays = useMemo(() => events.filter((e) => ids.has(triggerOf(e))).reverse(), [events, ids]);
  const net = trades.reduce((s, t) => s + (t.result === "open" ? 0 : (t.pnl ?? 0)), 0);
  const open = trades.filter((t) => t.result === "open").length;
  const liveAlert = alert && now - alert.at < 12 * 3_600_000 ? alert : null;
  const critical = liveAlert?.severity === 3;
  const focus = plan[0];
  return (
    <div className={cn("relative h-full rounded-2xl", className)}>
      <Card title="Heute" note={new Date(now).toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" })} data-testid="coach-today" innerClassName="grid content-start gap-4">
        <dl className="grid grid-cols-3 gap-2">
          {[
            ["Trades", `${trades.length}${open ? ` (${open} offen)` : ""}`, "text-fg"],
            ["P&L", trades.length ? `${signed(net, 0)} ${cur}` : "–", net > 0 ? "text-win" : net < 0 ? "text-loss" : "text-mute"],
            ["Muster", `${todays.length}`, todays.length ? "text-loss" : "text-win"],
          ].map(([k, v, c]) => (
            <div key={k} className="grid min-w-0 gap-0.5 rounded-xl border border-line bg-ink-950/50 px-2.5 py-2">
              <dt className="truncate text-[10px] font-semibold uppercase tracking-[0.1em] text-mute">{k}</dt>
              <dd className={cn("num truncate font-mono text-[14px]", c)}>{v}</dd>
            </div>
          ))}
        </dl>

        {liveAlert && (
          <div className={cn("grid gap-2 rounded-xl border px-3.5 py-3", critical ? "border-signal/45 bg-signal/[0.07]" : liveAlert.severity === 2 ? "border-loss/30 bg-loss/[0.05]" : "border-warn/25 bg-warn/[0.04]")} data-testid="coach-live-alert" data-severity={liveAlert.severity}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-[13px] font-semibold text-fg">
                <SeverityDot severity={liveAlert.severity} />
                {BEHAVIOR_LABEL[liveAlert.key]}
              </span>
              {liveAlert.until && liveAlert.until > now - 60_000 ? <StatusPill tone={critical ? "error" : "warn"} expanded ring={{ endsAt: liveAlert.until, ms: Math.max(60_000, liveAlert.until - liveAlert.at) }} label={<PauseLabel until={liveAlert.until} />} /> : null}
            </div>
            <p className="text-[12.5px] leading-snug text-mute">{liveAlert.detail}</p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => openTrade(liveAlert.tradeId)}>
                Trade ansehen
              </Button>
              <Button size="sm" variant="ghost" onClick={dismiss}>
                Verstanden
              </Button>
            </div>
          </div>
        )}

        {todays.length > 0 ? (
          <ul className="grid" aria-label="Muster heute">
            {todays.slice(0, 6).map((e, i) => (
              <li key={`${e.key}-${triggerOf(e)}-${i}`} className="border-b border-line/60 last:border-b-0">
                <button type="button" onClick={() => openTrade(triggerOf(e))} className="grid min-h-11 w-full grid-cols-[auto_minmax(0,1fr)] items-center gap-2.5 px-1 py-1.5 text-left">
                  <SeverityDot severity={e.severity} />
                  <span className="min-w-0">
                    <span className="block text-[12.5px] text-fg">{BEHAVIOR_LABEL[e.key]}</span>
                    {e.note && <span className="block truncate text-[11px] text-mute">{e.note}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[12.5px] leading-relaxed text-mute">{trades.length ? "Heute sauber – kein Muster erkannt." : "Noch kein Trade heute."}</p>
        )}

        {focus && (
          <div className="grid gap-1 border-t border-line pt-3">
            <span className="label">Fokus heute</span>
            <p className="text-[13px] leading-snug text-fg">{focus.goal.title}</p>
          </div>
        )}
      </Card>
      {critical ? (
        // the beam's rotating disc is far larger than the card: clip it here
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl">
          <BorderBeam fire={liveAlert!.seq} size={120} colorFrom={SIGNAL_HEX} colorTo="#ffb3b8" borderWidth={1.5} />
        </div>
      ) : null}
    </div>
  );
}
