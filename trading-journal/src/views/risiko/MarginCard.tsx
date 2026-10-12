/**
 * `Margin` (P05): the margin the venue positions bind, against the start capital of the scope – a round
 * `LiquidGauge` (red from 50 %) plus the split per venue. Without an exchange connection (P11
 * `useHasExchangeConnection`) an honest empty state: no fake numbers.
 */
import type { ExposureReport } from "@/domain/risk";
import { useHasExchangeConnection } from "@/exchanges/positions";
import { LiquidGauge } from "@/motion/fx";
import { EmptyState } from "@/primitives/EmptyState";
import { RISIKO } from "./strings";
import { Metric, RiskCard, money, pct } from "./ui";

const S = RISIKO.margin;
/** Margin load from which the gauge turns red. */
const MARGIN_DANGER = 0.5;

export function MarginCard({ ex, capital, cur }: { ex: ExposureReport; capital: number; cur: string }) {
  const connected = useHasExchangeConnection();
  const venue = ex.legs.filter((l) => l.source === "exchange");
  if (!connected) {
    return (
      <RiskCard title={S.title} data-testid="risk-margin" data-connected="0">
        <EmptyState title={S.emptyTitle} text={S.emptyText} line={false} />
      </RiskCard>
    );
  }
  const used = venue.reduce((s, l) => s + (l.margin ?? 0), 0);
  const load = capital > 0 ? used / capital : 0;
  const byVenue = [...new Set(venue.map((l) => l.venue))].map((v) => ({ v, m: venue.filter((l) => l.venue === v).reduce((s, l) => s + (l.margin ?? 0), 0) }));
  return (
    <RiskCard title={S.title} data-testid="risk-margin" data-connected="1">
      <div className="grid gap-4">
        <LiquidGauge value={Math.min(1, load)} danger={MARGIN_DANGER} shape="round" label={S.load} valueText={`${pct(load, 0)} ${S.load}`} className="mx-auto size-36">
          <span className="grid justify-items-center gap-0.5">
            <span className="dot-num text-[26px] leading-none">{Math.round(load * 100)}%</span>
            <span className="label !text-[9px]">{S.load}</span>
          </span>
        </LiquidGauge>
        <div className="grid grid-cols-2 gap-3">
          <Metric label={S.used}>{money(used, cur)}</Metric>
          <Metric label={S.free}>{money(Math.max(0, capital - used), cur)}</Metric>
        </div>
        {byVenue.length > 0 && (
          <ul className="grid gap-1 text-[11.5px] text-mute">
            {byVenue.map(({ v, m }) => (
              <li key={v} className="flex justify-between gap-2">
                <span className="capitalize">{v}</span>
                <span className="num font-mono text-fg">{money(m, cur)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </RiskCard>
  );
}
