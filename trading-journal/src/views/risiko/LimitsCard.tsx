/**
 * `Live-Limits` (P05): the daily loss as a `LiquidGauge` that fills towards the red edge (red from `warnAt`), the other
 * limits as `RingGauge`s with the warn marker as needle – the arc turns signal red the moment it passes the needle and
 * an upward crossing flashes a halo. A breach sends one red `BorderBeam` lap round the card; the pause shows as an
 * error `StatusPill` whose ring runs to `endsAt` ("Pause · mm:ss" on `nowMv`, zero renders per second) with a
 * `HoldConfirm` "Limit überschreiben" (hold = do it, a tap asks inline). Only the strongest warnings are listed.
 */
import { DotUnit } from "@/primitives/DotUnit";
import { themePaint } from "@/lib/themePaint";
import { AnimatePresence, motion, useTransform } from "motion/react";
import { useEffect, useState } from "react";
import { clockText, type LimitReport, type LimitRow, type RiskWarning } from "@/domain/risk";
import { cn } from "@/lib/cn";
import { useNowMv } from "@/motion/clock";
import { HoldConfirm, useConfirmFocus } from "@/motion/HoldConfirm";
import { LiquidGauge } from "@/motion/fx";
import { StatusPill } from "@/motion/StatusPill";
import { spring, stagger, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Button } from "@/primitives/Button";
import { RingGauge } from "@/primitives/RingGauge";
import { useRiskGuardStore } from "./guard";
import { RISIKO } from "./strings";
import { RiskCard, money, pct } from "./ui";

const S = RISIKO.limits;
const SIGNAL = themePaint("#e5202e");

/** True while `until` (epoch ms) lies ahead; flips to false on time (one timer), not at the next minute tick. */
function useActiveUntil(until: number | null): boolean {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (until == null) return;
    const ms = until - Date.now();
    if (ms <= 0 || ms > 2 ** 31 - 1) return;
    const t = setTimeout(() => setNow(Date.now()), ms + 30);
    return () => clearTimeout(t);
  }, [until]);
  return until != null && until > now;
}

/** "Pause · 12:34" counting down on the shared clock (a MotionValue leaf, no render per second). */
function PauseLabel({ endsAt }: { endsAt: number }) {
  const now = useNowMv();
  const text = useTransform(now, (t) => `${RISIKO.status.pause} · ${clockText(endsAt - t)}`);
  return <motion.span className="num font-mono">{text}</motion.span>;
}

/** The ring's centre: the figure in Doto, its unit (`×`, `%`) beside it in Plex Sans (`DotUnit`). */
function ringCentre(r: LimitRow): { n: string; unit: string } {
  if (r.unit === "count") return { n: `${r.used}/${r.limit}`, unit: "" };
  if (r.unit === "x") return { n: r.used > 0 ? String(Math.round(r.used * 10) / 10).replace(".", ",") : "0", unit: "×" };
  return { n: String(Math.round(Math.min(r.ratio, 9.99) * 100)), unit: "%" };
}

const STATE_TEXT: Record<LimitRow["state"], string> = { ok: "text-mute", warn: "text-warn", breach: "text-loss" };

function LimitRing({ r, warnAt, index }: { r: LimitRow; warnAt: number; index: number }) {
  const reduced = useReducedFx();
  const centre = ringCentre(r);
  return (
    <motion.li
      className="grid min-w-0 justify-items-center gap-1.5 rounded-xl border border-line bg-ink-950/40 px-2 pb-2.5 pt-3 text-center"
      data-testid={`limit-${r.key}`}
      data-state={r.state}
      initial={reduced ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0, transitionEnd: { transform: "none" } }}
      transition={{ ...spring.enter, delay: reduced ? 0 : Math.min(index, stagger.max) * stagger.reveal }}
    >
      <RingGauge value={Math.min(1, r.ratio)} marker={warnAt} size={92} stroke={8} color="var(--color-gauge-ink, #cfcfcf)" passColor={SIGNAL} aria-label={`${r.label}: ${r.detail}`}>
        <span className={cn("dot-num text-[15px] leading-none", r.state === "breach" ? "text-loss" : "text-fg")}>
          {centre.n}
          {centre.unit && <DotUnit>{centre.unit}</DotUnit>}
        </span>
      </RingGauge>
      <span className="label !text-[9.5px]">{r.label}</span>
      <span className={cn("line-clamp-2 text-[10.5px] leading-snug", STATE_TEXT[r.state])}>{r.detail}</span>
    </motion.li>
  );
}

export function LimitsCard({ report, now, warnings: all }: { report: LimitReport; now: number; warnings: readonly RiskWarning[] }) {
  const reduced = useReducedFx();
  const override = useRiskGuardStore((s) => s.override);
  const overrideUntil = useRiskGuardStore((s) => s.overrideUntil);
  const clearOverride = useRiskGuardStore((s) => s.clearOverride);
  const [asking, setAsking] = useState(false);
  const { trigger, no } = useConfirmFocus(asking);
  const coolLive = useActiveUntil(report.cooldown && report.cooldown.endsAt > now ? report.cooldown.endsAt : null);
  const cool = coolLive ? report.cooldown : null;
  const overridden = useActiveUntil(override?.until ?? null);
  const day = report.rows.find((r) => r.key === "day") ?? null;
  const rings = report.rows.filter((r) => r.key !== "day");
  // trade the best, fuck the rest: the three strongest warnings (the pause has its own row)
  const warnings = all.filter((w) => w.source !== "cooldown").slice(0, 3);
  const breachKey = report.worst === "breach" ? report.rows.filter((r) => r.state === "breach").map((r) => r.key).join("+") + (cool ? `:${cool.since}` : "") : null;

  const doOverride = () => {
    const until = cool?.endsAt ?? Date.now() + 60 * 60_000;
    overrideUntil(until);
    setAsking(false);
  };

  const pill = cool && !overridden ? (
    <StatusPill tone="error" expanded ring={{ endsAt: cool.endsAt, ms: cool.endsAt - cool.since }} label={<PauseLabel endsAt={cool.endsAt} />} />
  ) : overridden ? (
    <StatusPill tone="warn" expanded label={RISIKO.status.overridden} />
  ) : (
    <StatusPill tone={report.worst === "breach" ? "error" : report.worst === "warn" ? "warn" : "live"} expanded label={RISIKO.status[report.worst]} />
  );

  if (!report.rows.length) {
    return (
      <RiskCard title={S.title} data-testid="risk-limits">
        <p className="text-[13px] text-mute">{S.noCapital}</p>
      </RiskCard>
    );
  }

  return (
    <RiskCard title={S.title} note={S.note} action={pill} beam={breachKey} data-testid="risk-limits" data-worst={report.worst} data-cooldown={cool ? "on" : "off"}>
      <div className="grid gap-4 sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)]">
        {day && (
          <div className="grid content-start gap-2" data-testid="limit-day" data-state={day.state}>
            <LiquidGauge value={Math.min(1, day.ratio)} danger={report.limits.warnAt} label={S.dayGauge} valueText={`${pct(day.ratio, 0)} vom Tageslimit`} className="h-32 w-full sm:h-48">
              <span className="grid justify-items-center gap-0.5 text-center">
                <span className={cn("dot-num text-[34px] leading-none", day.state === "breach" ? "text-loss" : "text-fg")}>
                  {Math.round(Math.min(day.ratio, 9.99) * 100)}
                  <DotUnit>%</DotUnit>
                </span>
                <span className="num font-mono text-[11px] text-mute">{day.used > 0 ? money(-day.used, report.currency) : money(0, report.currency)}</span>
              </span>
            </LiquidGauge>
            <span className="label text-center !text-[9.5px]">{S.dayGauge}</span>
            <span className={cn("text-center text-[11px] leading-snug", STATE_TEXT[day.state])}>{day.detail}</span>
          </div>
        )}
        <ul className="grid grid-cols-2 gap-2 min-[420px]:grid-cols-3" aria-label={S.title}>
          {rings.map((r, i) => (
            <LimitRing key={r.key} r={r} warnAt={report.limits.warnAt} index={i} />
          ))}
        </ul>
      </div>

      <div className="mt-4 grid gap-2">
        {cool && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-loss/30 bg-loss/[0.07] px-3 py-2.5" data-testid="risk-cooldown">
            <span className="text-[12.5px] text-fg">{cool.reason === "day" ? "Tageslimit erreicht – für heute ist Schluss." : `${cool.losses} Verluste in Folge. Kurz raus, Plan lesen.`}</span>
            {overridden ? (
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-[11.5px] text-warn">{S.overridden(new Date(override!.until).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }))}</span>
                <Button size="sm" variant="ghost" onClick={clearOverride}>
                  {S.clearOverride}
                </Button>
              </span>
            ) : asking ? (
              <motion.span
                className="flex flex-wrap items-center gap-2 text-[12px] text-danger-text"
                role="alert"
                initial={reduced ? false : { opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ default: tween.fade, scale: spring.pop }}
              >
                {S.overrideAsk}
                <Button size="sm" variant="danger" onClick={doOverride}>
                  {S.overrideYes}
                </Button>
                <Button ref={no} size="sm" onClick={() => setAsking(false)}>
                  {S.overrideNo}
                </Button>
              </motion.span>
            ) : (
              <HoldConfirm ref={trigger} variant="danger" size="sm" holdLabel={S.overrideHold} onAsk={() => setAsking(true)} onConfirm={doOverride} data-testid="risk-override">
                {S.override}
              </HoldConfirm>
            )}
          </div>
        )}
        <AnimatePresence initial={false}>
          {warnings.length === 0 ? (
            <motion.p key="ok" className="text-[12px] text-faint" initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: tween.exit }}>
              {S.allGood}
            </motion.p>
          ) : (
            warnings.map((w, i) => (
                <motion.div
                  key={w.key}
                  className={cn("grid gap-0.5 rounded-xl border px-3 py-2", w.tone === "breach" ? "border-loss/30 bg-loss/[0.06]" : "border-warn/25 bg-warn/[0.05]")}
                  initial={reduced ? false : { opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0, transitionEnd: { transform: "none" } }}
                  exit={{ opacity: 0, transition: tween.exit }}
                  transition={{ ...spring.enter, delay: reduced ? 0 : i * stagger.rows }}
                  data-testid="risk-warning"
                >
                  <span className={cn("text-[12.5px] font-medium", w.tone === "breach" ? "text-loss" : "text-warn")}>{w.title}</span>
                  <span className="text-[11.5px] text-mute">{w.detail}</span>
                </motion.div>
              ))
          )}
        </AnimatePresence>
      </div>
    </RiskCard>
  );
}
