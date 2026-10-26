import { themePaint } from "@/lib/themePaint";
import { DotUnit } from "@/primitives/DotUnit";
import { useId } from "react";
import { cn } from "@/lib/cn";
import { NumberCascade } from "@/motion/fx/NumberCascade";
import { Switch } from "@/motion/Switch";
import { TextScramble } from "@/motion/TextScramble";
import { Button } from "@/primitives/Button";
import { Card } from "@/primitives/Card";
import { RingGauge } from "@/primitives/RingGauge";
import { fmtDd, fmtPct, fmtR, METRIC_LABEL, ORIGIN_HINT, ORIGIN_LABEL } from "@/social/format";
import { percentileIn, useLocalStats } from "@/social/hooks";
import { metricValue, MIN_TRADES, SOCIAL_METRICS, type SocialMetric } from "@/social/metrics";
import { refreshMe, rerollPseudonym, setOptIn, useBoard, useSocial } from "@/social/store";
import { YOU } from "@/social/strings";
import { Glyph } from "@/social/ui/glyphs";
import { Monogram } from "@/social/ui/Monogram";
import { DistributionStrip } from "./DistributionStrip";
import { Caption, Progress } from "./parts";

function Figure({ metric, value, active }: { metric: SocialMetric; value: number | null; active: boolean }) {
  const isR = metric === "expectancy";
  const isDd = metric === "drawdown";
  const tone = value == null ? "text-faint" : isR ? (value > 0 ? "text-win" : value < 0 ? "text-loss" : "text-fg") : "text-fg";
  return (
    <div className={cn("grid gap-1 rounded-xl border px-3 py-2.5 transition-colors duration-200", active ? "border-line-2 bg-white/[0.04]" : "border-line bg-ink-950/40")} data-testid={`you-${metric}`}>
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint">{METRIC_LABEL[metric]}</span>
      <span className={cn("dot-num truncate text-[17px] leading-none sm:text-[19px] lg:text-[17px]", tone)}>
        {value == null ? (
          "–"
        ) : (
          <>
            <span className="sr-only">{isR ? fmtR(value) : isDd ? fmtDd(value) : fmtPct(value)}</span>
            <span aria-hidden="true">
              <NumberCascade value={value} decimals={isR ? 2 : isDd ? 1 : 0} signed={isR} />
              <DotUnit>{isR || isDd ? "R" : "%"}</DotUnit>
            </span>
          </>
        )}
      </span>
    </div>
  );
}

/**
 * "Du in der Community" (P12): pseudonym (decodes on every re-roll) on its dot-matrix monogram, the ranking opt-in, the
 * own 90-day figures (server values when computed, else the same code on this device), and the percentile ring – where
 * the trader stands among everybody who takes part (median needle; k-anonymous: no ring below 10 traders).
 */
export function YouCard({ className }: { className?: string }) {
  const me = useSocial((s) => s.me);
  const metric = useSocial((s) => s.metric);
  const busy = useSocial((s) => s.busy);
  const board = useBoard();
  const local = useLocalStats();
  const switchId = useId();
  const server = me?.figures ?? null;
  const fig = server ?? { expectancyR: local.expectancyR, discipline: local.discipline, consistency: local.consistency, winRate: local.winRate, drawdownR: local.drawdownR };
  const origin = server ? (server.origin ?? null) : local.origin;
  const rTrades = server ? server.rTrades : local.rTrades;
  const eligible = server ? server.eligible : local.eligible;
  const value = metricValue(fig, metric);
  const pct = percentileIn(board.data?.community, metric, value);
  const dist = board.data?.community.find((d) => d.metric === metric) ?? null;
  const hasDist = !!dist;
  const optIn = me?.optIn ?? false;
  return (
    <Card title={YOU.title} className={cn("h-full", className)} data-testid="you-card">
      {/* row rule (P1-08): next to the taller ranking the footer sits at the card's bottom, the free height above it */}
      <div className="flex flex-1 flex-col gap-5">
        <div className="flex items-center gap-4">
          <Monogram pseudonym={me?.pseudonym ?? "?"} size="lg" />
          <div className="grid min-w-0 flex-1 gap-1">
            <Caption>{YOU.pseudonym}</Caption>
            {me ? <TextScramble key={me.pseudonym} text={me.pseudonym} className="truncate text-[18px] font-semibold tracking-tight" /> : <span className="h-6 w-40 rounded bg-white/[0.06]" />}
            <span className="text-[11.5px] leading-snug text-faint">{YOU.pseudonymHint}</span>
          </div>
          <Button size="sm" onClick={() => void rerollPseudonym()} disabled={!me || busy === "reroll"} aria-label={YOU.reroll} className="shrink-0 px-2.5" data-testid="you-reroll">
            <Glyph name="dice" className="size-4" />
          </Button>
        </div>

        <div className="flex items-start justify-between gap-4 rounded-xl border border-line bg-ink-950/40 px-3.5 py-3">
          <span className="grid gap-0.5">
            <label htmlFor={switchId} className="text-[13.5px] font-medium">
              {YOU.optIn}
            </label>
            <span className="text-[12px] leading-snug text-mute">{optIn ? YOU.optInHint : YOU.optOutHint}</span>
          </span>
          <Switch id={switchId} checked={optIn} tone="win" disabled={!me || busy === "optIn"} onCheckedChange={(v) => void setOptIn(v)} data-testid="you-optin" />
        </div>

        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
          <div className="grid gap-2">
            <div className="flex items-baseline justify-between gap-2">
              <Caption>{YOU.figures}</Caption>
              <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-faint">{server ? YOU.server : YOU.local}</span>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
              {SOCIAL_METRICS.map((m) => (
                <Figure key={m} metric={m} value={metricValue(fig, m)} active={m === metric} />
              ))}
            </div>
            {origin && (
              <span className="text-[11.5px] leading-snug text-mute" data-testid="you-origin">
                {YOU.origin}: <span className="text-fg">{ORIGIN_LABEL[origin]}</span> – {ORIGIN_HINT[origin]}
              </span>
            )}
            <div className="grid gap-1.5 pt-1">
              <Progress value={rTrades / MIN_TRADES} tone={eligible ? "win" : "fg"} />
              <span className="text-[11.5px] text-mute">{eligible ? YOU.eligible : YOU.notEnough(rTrades, MIN_TRADES)}</span>
            </div>
          </div>
          <div className="grid justify-items-center gap-1.5" data-testid="you-percentile">
            <RingGauge value={pct == null ? null : pct / 100} marker={hasDist ? 0.5 : null} size={124} stroke={8} passColor={themePaint("#3ddc84")} aria-label={pct == null ? YOU.percentileTitle : YOU.percentile(pct)}>
              <span className="grid justify-items-center">
                <span className="dot-num text-[26px] leading-none">
                  {pct == null ? (
                    "–"
                  ) : (
                    <>
                      <NumberCascade value={pct} />
                      <DotUnit>%</DotUnit>
                    </>
                  )}
                </span>
                <span className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-faint">{YOU.percentileTitle}</span>
              </span>
            </RingGauge>
            <span className="max-w-[180px] text-center text-[11.5px] leading-snug text-mute">
              {pct != null ? YOU.percentile(pct) : !hasDist ? YOU.percentileNone : YOU.percentileNoValue}
            </span>
          </div>
        </div>

        {dist && (
          <div className="grid gap-2 rounded-xl border border-line bg-ink-950/40 px-3.5 pb-2.5 pt-3">
            <div className="flex items-baseline justify-between gap-2">
              <Caption>{YOU.whereTitle(METRIC_LABEL[metric])}</Caption>
              <span className="font-mono text-[10px] text-faint">{YOU.whereN(dist.n)}</span>
            </div>
            <DistributionStrip key={metric} dist={dist} metric={metric} value={value} />
          </div>
        )}

        <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
          <span className="text-[11.5px] text-faint">{YOU.syncHint}</span>
          <Button size="sm" onClick={() => void refreshMe()} disabled={!me || busy === "refresh"} data-testid="you-refresh">
            {YOU.refresh}
          </Button>
        </div>
      </div>
    </Card>
  );
}
