/**
 * `Exposure` (P05): open journal trades + live venue positions as one book – gross, net, hedged, effective leverage,
 * per asset (long right in green, short left in red, growing from the centre on first view) and per venue, the HHI
 * concentration, and two live leaves: the net exposure as a signed `DotMatrix` VU meter and the unrealised P&L as
 * `LiveText` (both MotionValues on `priceMv`: zero React renders per tick). "Trade the best": the four biggest assets
 * only, the rest summed. Without P11 the card says it only knows the journal.
 */
import { motion, useTransform, type MotionValue } from "motion/react";
import { useMemo, useRef } from "react";
import type { ExposureLeg, ExposureReport } from "@/domain/risk";
import { cn } from "@/lib/cn";
import { priceMv, useProvider } from "@/market";
import { DotMatrix } from "@/motion/DotMatrix";
import { LiveText } from "@/motion/LiveText";
import { spring, stagger } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Badge } from "@/primitives/Badge";
import { DotUnit } from "@/primitives/DotUnit";
import { EmptyState } from "@/primitives/EmptyState";
import { useSeenOnce } from "@/primitives/revealValue";
import { useLiveUpnl } from "./hooks";
import { RISIKO } from "./strings";
import { Metric, RiskCard, money, pct } from "./ui";

const S = RISIKO.exposure;
const TOP = 4;

/** Net ÷ gross of the legs with the live provider price for its journal legs (−1 … 1, √-scaled, a MotionValue). */
function useNetRatioMv(legs: readonly ExposureLeg[]): MotionValue<number> {
  const provider = useProvider();
  const sym = provider?.symbolInfo.binance ?? null;
  const parts = useMemo(
    () => legs.map((l) => ({ live: l.source === "journal" && !!sym && l.symbol === sym, dir: l.side === "short" ? -1 : 1, qty: l.qty, notional: l.notional })),
    [legs, sym],
  );
  return useTransform(priceMv, (p) => {
    let net = 0;
    let gross = 0;
    for (const x of parts) {
      const n = x.live && p > 0 ? x.qty * p : x.notional;
      net += x.dir * n;
      gross += n;
    }
    // perceptual (square-root) scale: a small net lean is still visible on the VU meter
    const r = gross > 0 ? net / gross : 0;
    return Math.sign(r) * Math.sqrt(Math.abs(r));
  });
}

function AssetRow({ asset, long, short, share, max, index }: { asset: string; long: number; short: number; share: number; max: number; index: number }) {
  const reduced = useReducedFx();
  const ref = useRef<HTMLLIElement>(null);
  const seen = useSeenOnce(ref);
  const on = seen || reduced;
  const delay = reduced ? 0 : Math.min(index, stagger.max) * stagger.reveal;
  const w = (v: number) => `${((v / (max || 1)) * 50).toFixed(2)}%`;
  return (
    <li ref={ref} className="grid grid-cols-[3.25rem_minmax(0,1fr)_3rem] items-center gap-2" data-testid="exposure-asset">
      <span className="truncate font-mono text-[12px] text-fg">{asset}</span>
      <span className="relative h-2.5 rounded-full bg-white/[0.05]" aria-hidden="true">
        <span className="absolute inset-y-0 left-1/2 w-px bg-white/25" />
        {short > 0 && (
          <motion.span
            className="absolute inset-y-0 rounded-l-full bg-loss/70"
            style={{ right: "50%", width: w(short), originX: 1 }}
            initial={reduced ? false : { scaleX: 0 }}
            animate={{ scaleX: on ? 1 : 0 }}
            transition={{ ...spring.enter, delay }}
          />
        )}
        {long > 0 && (
          <motion.span
            className="absolute inset-y-0 rounded-r-full bg-win/70"
            style={{ left: "50%", width: w(long), originX: 0 }}
            initial={reduced ? false : { scaleX: 0 }}
            animate={{ scaleX: on ? 1 : 0 }}
            transition={{ ...spring.enter, delay }}
          />
        )}
      </span>
      <span className="num text-right font-mono text-[11px] text-mute">{pct(share, 0)}</span>
    </li>
  );
}

export function ExposureCard({ ex, cur }: { ex: ExposureReport; cur: string }) {
  const upnl = useLiveUpnl(ex.legs);
  const netMv = useNetRatioMv(ex.legs);
  if (!ex.legs.length) {
    return (
      <RiskCard title={S.title} data-testid="risk-exposure" data-legs={0}>
        <EmptyState title={S.empty} text={S.emptyText} line={false} />
      </RiskCard>
    );
  }
  const top = ex.byAsset.slice(0, TOP);
  const rest = ex.byAsset.slice(TOP);
  const max = Math.max(...ex.byAsset.map((g) => Math.max(g.long, g.short)), 1);
  const restLong = rest.reduce((s, g) => s + g.long, 0);
  const restShort = rest.reduce((s, g) => s + g.short, 0);
  return (
    <RiskCard
      title={S.title}
      note={ex.sources.exchange === 0 ? S.journalOnly : undefined}
      action={<Badge tone={ex.hhiLabel === "konzentriert" ? "warn" : "mute"}>{`${S.hhi}: ${S.hhiLabels[ex.hhiLabel]}`}</Badge>}
      data-testid="risk-exposure"
      data-legs={ex.legs.length}
    >
      <div className="grid gap-4">
        <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
          <div className="grid gap-1.5">
            <span className="label !text-[10px]">
              {S.net} · {ex.net >= 0 ? "long" : "short"} {pct(Math.abs(ex.netRatio), 0)}
            </span>
            <DotMatrix meter={netMv} signed rows={9} cols={30} size={3} gap={1.5} tone="win" negativeTone="loss" glow={false} label={S.meter} />
          </div>
          <div className="grid gap-1">
            <span className="label !text-[10px]">{S.upnl}</span>
            {/* the figure in Doto, the currency beside it in Plex Sans (`DotUnit`) */}
            <span className="dot-num text-[26px] leading-none">
              <LiveText source={upnl} smooth flash format={(v) => money(v, "", true).trim()} aria-label={S.upnl} />
              <DotUnit> {cur}</DotUnit>
            </span>
            <span className="num font-mono text-[11px] text-faint">{ex.legs.length} offen</span>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Metric label={S.gross}>{money(ex.gross, cur)}</Metric>
          <Metric label={S.net} tone={ex.net >= 0 ? "text-win" : "text-loss"} sub={pct(ex.netRatio, 0)}>
            {money(ex.net, cur, true)}
          </Metric>
          <Metric label={S.hedged}>{money(ex.hedged, cur)}</Metric>
          <Metric label={S.lev}>{ex.leverage != null ? `${ex.leverage.toFixed(2).replace(".", ",")}×` : "–"}</Metric>
        </div>
        <ul className="grid gap-2" aria-label="Exposure je Asset">
          {top.map((g, i) => (
            <AssetRow key={g.key} asset={g.key} long={g.long} short={g.short} share={g.share} max={max} index={i} />
          ))}
          {rest.length > 0 && <AssetRow asset={`+${rest.length}`} long={restLong} short={restShort} share={rest.reduce((s, g) => s + g.share, 0)} max={max} index={top.length} />}
        </ul>
        <ul className="grid gap-1.5 border-t border-line pt-3" aria-label="Offene Positionen" data-testid="exposure-legs">
          {[...ex.legs]
            .sort((a, b) => b.notional - a.notional)
            .slice(0, TOP)
            .map((l) => (
              <li key={l.id} className="flex min-w-0 items-center justify-between gap-3 text-[12px]">
                <span className="flex min-w-0 items-center gap-2">
                  <span className={cn("size-1.5 shrink-0 rounded-full", l.side === "long" ? "bg-win" : "bg-loss")} aria-hidden="true" />
                  <span className="truncate text-fg">{l.label}</span>
                  {l.leverage != null && <span className="shrink-0 font-mono text-[10.5px] text-faint">{String(l.leverage).replace(".", ",")}×</span>}
                </span>
                <span className="num shrink-0 font-mono text-mute">
                  {money(l.notional, cur)}
                  {l.upnl != null && <span className={cn("ml-2", l.upnl >= 0 ? "text-win" : "text-loss")}>{money(l.upnl, cur, true)}</span>}
                </span>
              </li>
            ))}
        </ul>
        {(ex.byVenue.length > 1 || ex.crossVenue.length > 0) && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="label mr-1 !text-[9.5px]">{S.venues}</span>
            {ex.byVenue.map((v) => (
              <Badge key={v.key} tone={ex.crossVenue.length ? "warn" : "mute"}>
                {v.key === "journal" ? "Journal" : v.key} · {pct(v.share, 0)}
              </Badge>
            ))}
          </div>
        )}
      </div>
    </RiskCard>
  );
}
