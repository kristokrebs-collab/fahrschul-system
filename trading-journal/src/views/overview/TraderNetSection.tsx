/**
 * "Top-Trader (Binance)" plaque in the Long signal: a calm plaque (side, since when it flipped, the net in points, the price
 * since the flip) and, opened, the small canvas chart (`TraderNetChart`, a lazy chunk) with the net as an area around zero,
 * the price as a thin line and a mark at the last sign change. Only the Long view gets it (the Short view and the rest of the
 * page stay as they were). It shows; it does not score – the sign appears as one explained row in "Warum handeln oder
 * auslassen?" and the verdict is unchanged.
 *
 * Honest naming: the data is the public Binance statistic of the biggest accounts of ONE exchange (long minus short share of
 * their positions), never "Wale" and never on-chain; the help line under the chart says so. Height is reserved: the plaque
 * has the same box with data, without data and while loading (two reserved lines of detail on phones), the chart a fixed
 * 176 px box that is filled as soon as the chunk is there.
 */
import { lazy, Suspense, useState } from "react";
import { netDetail, netHeadline, TRADER_NET_IS, TRADER_NET_IS_NOT, TRADER_NET_SOURCE } from "@/domain/signals";
import type { LiveTraderNet } from "@/market";
import { Badge, type BadgeTone } from "@/primitives/Badge";
import { Collapse, Expander } from "@/primitives/Expander";
import { NET_CHART_H } from "./traderNetChart";

const TraderNetChart = lazy(() => import("./TraderNetChart"));

export const TRADER_NET_ID = "trader-net";

const BADGE: Record<"long" | "short" | "neutral", { tone: BadgeTone; label: string }> = {
  long: { tone: "win", label: "Netto Long" },
  short: { tone: "loss", label: "Netto Short" },
  neutral: { tone: "mute", label: "Ausgeglichen" },
};

export function TraderNetSection({ net }: { net: LiveTraderNet }) {
  const [open, setOpen] = useState(false);
  // the wipe plays on the first opening only
  const [played, setPlayed] = useState(false);
  const v = net.view;
  const ok = v !== null && v.status === "ok" && v.last !== null;
  const badge = ok && v.side ? BADGE[v.side] : null;
  const state = ok ? (net.status === "stale" ? "stale" : "ok") : v?.status === "short" ? "short" : net.status === "loading" ? "loading" : "none";
  const headline = v && v.status !== "none" ? netHeadline(v) : (net.detail ?? "keine Daten");
  const detail = v && v.status !== "none" ? netDetail(v) : "";
  const stale = net.status === "stale" && ok;

  return (
    <section className="grid gap-1.5" aria-label={`${TRADER_NET_SOURCE}: netto`} data-testid={TRADER_NET_ID} data-state={state} data-side={ok ? v.side : undefined}>
      <div className="flex min-h-6 items-center gap-3">
        <h3 className="label flex-1">{TRADER_NET_SOURCE}</h3>
        {badge ? (
          <Badge tone={stale ? "warn" : badge.tone} dot>
            {stale ? "veraltet" : badge.label}
          </Badge>
        ) : (
          <Badge tone="mute">{state === "loading" ? "lädt" : state === "short" ? "zu wenig Verlauf" : "keine Daten"}</Badge>
        )}
        {ok && <Expander open={open} onToggle={() => setOpen((o) => !o)} label={`${TRADER_NET_SOURCE} netto`} controls={`${TRADER_NET_ID}-body`} />}
      </div>
      <p className="min-h-[1.375em] text-[13px] leading-snug text-fg" data-testid="trader-net-headline">
        {headline}
      </p>
      {/* two reserved lines on a phone (the detail wraps there), one from sm on – same box with and without data */}
      <p className="min-h-[2.75em] text-[12px] leading-snug text-mute sm:min-h-[1.375em]" data-testid="trader-net-detail">
        {detail}
        {stale && net.detail ? ` · ${net.detail}` : ""}
      </p>
      <Collapse open={open && ok} id={`${TRADER_NET_ID}-body`}>
        {ok && v && (
          <div className="grid gap-2 pt-1.5">
            <Suspense fallback={<div className="w-full rounded-xl border border-line bg-ink-950/40" style={{ height: NET_CHART_H }} aria-hidden="true" />}>
              <TraderNetChart view={v} animate={!played} onDrawn={() => setPlayed(true)} />
            </Suspense>
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] leading-snug text-mute" data-testid="trader-net-legend">
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden="true" className="size-2 rounded-sm bg-win/70" />
                netto Long
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden="true" className="size-2 rounded-sm bg-loss/70" />
                netto Short
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden="true" className="h-px w-3 bg-fg/70" />
                BTC-Preis (eigene Skala)
              </span>
              <span>Pkt. = Long-Anteil minus Short-Anteil</span>
            </p>
            <p className="text-[11px] leading-snug text-faint" data-testid="trader-net-help">
              {TRADER_NET_IS} {TRADER_NET_IS_NOT}
            </p>
          </div>
        )}
      </Collapse>
    </section>
  );
}
