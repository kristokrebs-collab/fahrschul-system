/**
 * "Top-Trader: Netto Long/Short" on the Markt page – the big card for the net position of the biggest Binance accounts:
 * a headline that says the last flip in words (`netTitle`, only from the loaded history: "… sind seit 28.10. netto Short –
 * erstmals seit 03.10." / "… im geladenen Verlauf von 20 Tagen erstmals."), three key figures (current net, time since the flip,
 * price change since the flip), a range switch whose "Alles" carries the REAL length of the loaded history, and the plot
 * (`TraderNetPlot`: soft green/red area around zero, price line on its own right-hand scale, an arrow at the flip, a crosshair
 * with a readout).
 *
 * Data and logic are the ones of the Long signal's plaque on the Übersicht (`useTraderNet`, `buildTraderNet`) – the same
 * 500-point series the app already loads, no extra request. The series is the public Binance statistic of ONE exchange's
 * biggest accounts: never called "Wale", never "Glassnode", not on-chain; the help line says so. Without Binance data (blocked
 * region, Bybit/OKX source, offline) the card says why and keeps its size.
 *
 * Lazy chunk (`MarktView` shows a `PendingCard` of the finished size meanwhile). Every block has a fixed or reserved height, so
 * nothing moves when the data arrives, the range changes or the plot paints. The flip, the ring pulse and the draw-in live in
 * `TraderNetPlot`.
 */
import { useMemo, useState } from "react";
import { netTitle, type NetPoint, type NetTitleSegment } from "@/domain/signals";
import { cn } from "@/lib/cn";
import { useProvider, useTraderNet } from "@/market";
import { DotMatrix } from "@/motion/DotMatrix";
import { TextRoll } from "@/motion/TextRoll";
import { Badge, type BadgeTone } from "@/primitives/Badge";
import { Card } from "@/primitives/Card";
import { Segmented } from "@/primitives/Segmented";
import TraderNetPlot from "./TraderNetPlot";
import { flipIn, kpisOf, loadedLine, plotLabel, rangeChoices, windowPoints, type Kpi, type KpiTone } from "./traderNetCardModel";
import { NETCARD as S } from "./traderNetStrings";

export const TRADER_NET_CARD_ID = "markt-trader-net";

const BADGE: Record<"long" | "short" | "neutral", { tone: BadgeTone; label: string }> = {
  long: { tone: "win", label: "Netto Long" },
  short: { tone: "loss", label: "Netto Short" },
  neutral: { tone: "mute", label: "Ausgeglichen" },
};
const TONE_TEXT: Record<KpiTone, string> = { win: "text-win", loss: "text-loss", mute: "text-mute", fg: "text-fg" };
const SIDE_TEXT = { long: "text-win", short: "text-loss" } as const;

const NO_POINTS: readonly NetPoint[] = [];

/** The plot's place: same box with a plot, with a reason and while loading (nothing below it moves). */
const PLOT_BOX = "h-[256px] w-full rounded-xl border border-line bg-ink-950/40 lg:h-[336px]";

function Headline({ segments, side }: { segments: readonly NetTitleSegment[]; side: "long" | "short" | null }) {
  return (
    <>
      {segments.map((seg, i) =>
        seg.strong ? (
          <strong key={i} className={cn("font-semibold", side && (seg.text === "Long" || seg.text === "Short") ? SIDE_TEXT[side] : "text-fg")}>
            {seg.text}
          </strong>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </>
  );
}

function KpiTile({ k }: { k: Kpi }) {
  return (
    <div className="grid min-w-0 content-start gap-1 border-l border-line px-3 first:border-l-0 first:pl-0" data-testid={`trader-net-kpi-${k.id}`}>
      <span className="min-h-[2.6em] text-[11px] leading-[1.3] text-mute sm:min-h-0">{k.label}</span>
      <span className={cn("block whitespace-nowrap font-mono text-[15px] font-medium leading-tight tabular-nums sm:text-[18px]", TONE_TEXT[k.tone])} data-testid={`trader-net-kpi-${k.id}-value`}>
        <TextRoll text={k.value} mode="roll" />
      </span>
      <span className="min-h-[2.6em] text-[11px] leading-[1.3] text-mute sm:min-h-[1.3em]">{k.sub}</span>
    </div>
  );
}

export default function TraderNetCard() {
  const net = useTraderNet();
  const provider = useProvider();
  const v = net.view;
  const ok = v !== null && v.status === "ok" && v.last !== null;
  const stale = ok && net.status === "stale";
  const state = ok ? (stale ? "stale" : "ok") : v?.status === "short" ? "short" : net.status === "loading" ? "loading" : "none";
  const title = netTitle(v);
  const choices = useMemo(() => rangeChoices(ok ? v.spanMs : 0), [ok, v?.spanMs]);
  const [rangeId, setRangeId] = useState("all");
  const range = choices.find((c) => c.id === rangeId) ?? choices[choices.length - 1]!;
  const all = ok ? v.points : NO_POINTS;
  const points = useMemo(() => windowPoints(all, range.days), [all, range.days]);
  const flip = ok ? flipIn(points, v.flip) : null;
  const kpis = kpisOf(ok ? v : null);
  const badge = ok && v.side ? BADGE[v.side] : null;
  const base = provider?.symbolInfo.base ?? "BTC";
  const detail = loadedLine(v, net.stepMs, net.detail);

  return (
    <Card
      title={S.title}
      note={S.note}
      className="h-full"
      action={
        badge ? (
          <Badge tone={stale ? "warn" : badge.tone} dot>
            {stale ? "veraltet" : badge.label}
          </Badge>
        ) : (
          <Badge tone="mute">{state === "loading" ? "lädt" : state === "short" ? "zu wenig Verlauf" : "keine Daten"}</Badge>
        )
      }
      data-testid={TRADER_NET_CARD_ID}
      data-state={state}
      data-side={ok ? v.side : undefined}
      data-kind={title.kind}
    >
      <div className="grid gap-3">
        {/* the headline and the line under it keep their room as one block: three lines of headline and two of detail on a
            phone, two and one from sm up – the text starts at the top, the spare room is at the end of the block */}
        <div className="grid min-h-[calc(3.9*clamp(16px,4.4vw,21px)+6px+33px)] content-start gap-1.5 sm:min-h-[77px]">
          <h3 className="text-[clamp(16px,4.4vw,21px)] font-medium leading-[1.3] tracking-tight text-fg" data-testid="trader-net-title" data-kind={title.kind}>
            {state === "loading" ? S.loading : <Headline segments={title.segments} side={title.side} />}
          </h3>
          <p className="text-[12px] leading-snug text-mute" data-testid="trader-net-line">
            {state === "loading" ? "" : detail}
            {stale && net.detail ? ` · ${net.detail}` : ""}
          </p>
        </div>

        <div className="grid grid-cols-3 border-y border-line py-3" data-testid="trader-net-kpis">
          {kpis.map((k) => (
            <KpiTile key={k.id} k={k} />
          ))}
        </div>

        <div className="flex min-h-9 items-center justify-between gap-3">
          <span className="text-[11px] text-mute max-[420px]:sr-only">{S.rangeLabel}</span>
          {ok && choices.length > 1 ? (
            <Segmented size="sm" aria-label={S.rangeLabel} value={range.id} onChange={setRangeId} options={choices.map((c) => ({ v: c.id, label: c.label }))} />
          ) : (
            <span className="text-[11px] text-mute" data-testid="trader-net-range-fixed">
              {ok ? range.label : "–"}
            </span>
          )}
        </div>

        {ok ? (
          <TraderNetPlot points={points} flip={flip} windowKey={range.id} priceName={base} label={plotLabel(v, points, flip)} />
        ) : (
          <div className={cn(PLOT_BOX, "grid place-items-center px-6 text-center")} data-testid="trader-net-empty">
            {state === "loading" ? (
              <span className="grid place-items-center gap-3">
                <DotMatrix preset="loader" size={2.5} gap={2} tone="mute" />
                <span className="sr-only">{S.loading}</span>
              </span>
            ) : (
              <p className="max-w-[44ch] text-[13px] leading-snug text-mute">{net.detail ?? detail}</p>
            )}
          </div>
        )}

        <p className="flex min-h-[2.75em] flex-wrap items-center gap-x-4 gap-y-1 text-[11px] leading-snug text-mute sm:min-h-[1.375em]" data-testid="trader-net-legend">
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="size-2 rounded-sm bg-win/70" />
            {S.legendLong}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="size-2 rounded-sm bg-loss/70" />
            {S.legendShort}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="h-px w-3 bg-fg/70" />
            {base}-{S.legendPrice}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="text-fg/70">
              ↓
            </span>
            {S.legendFlip}
          </span>
        </p>
        <p className="text-[11.5px] leading-snug text-mute" data-testid="trader-net-help">
          {S.help}
        </p>
      </div>
    </Card>
  );
}
