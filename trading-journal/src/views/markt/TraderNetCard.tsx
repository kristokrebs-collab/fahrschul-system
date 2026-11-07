/**
 * "Top-Trader: Netto Long/Short" on the Markt page – the big card for the net position of the biggest Binance accounts (C3, the
 * complete "Wal-Karte"): a headline that says the last flip in words (`netTitle`, only from the history it has: "… sind seit 28.10.
 * netto Short – erstmals seit 03.10." / "… im geladenen Verlauf von 20 Tagen erstmals."), three key figures (current net, time since
 * the flip, price change since the flip), the provenance in three reserved lines (Quelle · Kohorte · Messzeit), two switches – the
 * series (Positionen / Konten of the same cohort) and the range (7 / 30 / 90 Tage / Alles) – and the plot (`TraderNetPlot`: soft
 * green/red area around zero, price line on its own right-hand scale, an arrow at the flip, the alert marks of the engine's rule,
 * the gaps, a crosshair with a readout).
 *
 * History: the live series is the one the app already loads (about 21 days at 1 h, Binance keeps ~30 days). In front of it sits what
 * THIS device has stored from earlier visits (`@/market/netArchive`, up to 180 days, on by default, off with one switch, deletable).
 * A stretch nobody saw is a gap: the line breaks there, the stretch is shaded and the readout says so – nothing is interpolated. The
 * headline and the key figures come from the newest run without a gap.
 *
 * Marks: the Top-Trader-Umschlag alarm of the alert engine (`@/domain/alerts`, `replayWhale`) replayed over the history – where the
 * rule would have fired with its default thresholds (Vorwarnung ring, Bestätigung diamond). A look back at a rule, not advice.
 *
 * Honest: "Top-Trader ≠ Wale" – one exchange's biggest accounts, never called "Wale", never "Glassnode", not on-chain. Without Binance
 * data the card says why (and shows the stored history when there is one, marked as such) and keeps its size.
 *
 * Lazy chunk (`MarktView` shows a `PendingCard` of the finished size meanwhile). Every block has a fixed or reserved height, so
 * nothing moves when the data arrives, the series or range changes or the plot paints. The flip, the ring pulse and the draw-in live
 * in `TraderNetPlot`.
 */
import { useEffect, useMemo, useState } from "react";
import type { WhaleMark } from "@/domain/alerts/replay";
import { netTitle, NET_SERIES, NET_SERIES_IDS, netPointsToCsv, type NetFlip, type NetPoint, type NetSeriesId, type NetTitleSegment, type TraderNetView } from "@/domain/signals";
import { cn } from "@/lib/cn";
import { useProvider, useTraderNet } from "@/market";
import { useNetArchive } from "@/market/netArchive";
import { TextRoll } from "@/motion/TextRoll";
import { ThinkingOrb } from "@/motion/ThinkingOrb";
import { Badge, type BadgeTone } from "@/primitives/Badge";
import { Card } from "@/primitives/Card";
import { Segmented } from "@/primitives/Segmented";
import { download } from "@/store/download";
import { TraderNetArchive } from "./TraderNetArchive";
import TraderNetPlot from "./TraderNetPlot";
import { flipIn, gapsInWindow, kpisOf, loadedLine, plotLabel, rangeChoices, windowPoints, type Kpi, type KpiTone } from "./traderNetCardModel";
import { NETCARD as S } from "./traderNetStrings";
import { archiveLine, buildWal, marksIn, marksRuleText, marksSummary, provenanceOf, walLine } from "./traderNetWal";

export const TRADER_NET_CARD_ID = "markt-trader-net";

const BADGE: Record<"long" | "short" | "neutral", { tone: BadgeTone; label: string }> = {
  long: { tone: "win", label: "Netto Long" },
  short: { tone: "loss", label: "Netto Short" },
  neutral: { tone: "mute", label: "Ausgeglichen" },
};
const TONE_TEXT: Record<KpiTone, string> = { win: "text-win", loss: "text-loss", mute: "text-mute", fg: "text-fg" };
const SIDE_TEXT = { long: "text-win", short: "text-loss" } as const;

const NO_POINTS: readonly NetPoint[] = [];
const MINUTE = 60_000;

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
      <span className="min-h-[3.9em] text-[11px] leading-[1.3] text-mute sm:min-h-0">{k.label}</span>
      <span className={cn("block whitespace-nowrap font-mono text-[15px] font-medium leading-tight tabular-nums sm:text-[18px]", TONE_TEXT[k.tone])} data-testid={`trader-net-kpi-${k.id}-value`}>
        <TextRoll text={k.value} mode="roll" />
      </span>
      <span className="min-h-[3.9em] text-[11px] leading-[1.3] text-mute sm:min-h-[1.3em]">{k.sub}</span>
    </div>
  );
}

/** The legend swatches for the marks: a ring (Vorwarnung) and a diamond (Bestätigung) in the neutral ink – the colour is the side. */
function MarkSwatch({ kind }: { kind: "warn" | "confirm" }) {
  return (
    <svg aria-hidden="true" viewBox="-7 -7 14 14" className="size-3 shrink-0 text-fg/80">
      {kind === "warn" ? <circle r="4.6" fill="none" stroke="currentColor" strokeWidth="1.8" /> : <path d="M0 -6 L6 0 L0 6 L-6 0 Z" fill="currentColor" />}
    </svg>
  );
}

export default function TraderNetCard() {
  const [series, setSeries] = useState<NetSeriesId>("position");
  const net = useTraderNet(series);
  const provider = useProvider();
  const symbol = provider?.symbolInfo.binance ?? null;
  const base = provider?.symbolInfo.base ?? "BTC";
  const info = NET_SERIES[series];
  const livePoints = net.view !== null && net.view.status === "ok" ? net.view.points : NO_POINTS;
  const archive = useNetArchive({ series, symbol, live: livePoints, stepMs: net.stepMs });
  // the clock of the card: the minute (ages: "vor 12 Min.", "seit 3 Tagen")
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), MINUTE);
    return () => clearInterval(id);
  }, []);
  const wal = useMemo(() => buildWal({ live: net, archive: archive.rows, symbol: symbol ?? "BTCUSDT", now }), [net, archive.rows, symbol, now]);
  const v = wal.view;
  // the stored history is read once per series: until then the card waits (a plot that jumps when the history arrives is worse)
  const waiting = symbol !== null && archive.status === "loading" && typeof indexedDB !== "undefined";
  const state = waiting && wal.state !== "none" && wal.state !== "short" ? "loading" : wal.state;
  const ok = state === "ok" || state === "stale" || state === "archive";
  const stale = state === "stale";
  const title = netTitle(ok ? v : null, info.who);
  const choices = useMemo(() => rangeChoices(ok && v ? (wal.points.length > 1 ? wal.points[wal.points.length - 1]!.t - wal.points[0]!.t : 0) : 0), [ok, v, wal.points]);
  const [rangeId, setRangeId] = useState("all");
  const range = choices.find((c) => c.id === rangeId && !c.disabled) ?? choices[choices.length - 1]!;
  const all = ok ? wal.points : NO_POINTS;
  const points = useMemo(() => windowPoints(all, range.days), [all, range.days]);
  const flip = ok && v ? flipIn(points, v.flip) : null;
  const gaps = useMemo(() => gapsInWindow(wal.gaps, points), [wal.gaps, points]);
  const marks = useMemo(() => (points.length ? marksIn(wal.marks, points[0]!.t, points[points.length - 1]!.t) : []), [wal.marks, points]);
  const kpis = kpisOf(ok ? v : null);
  const badge = ok && v?.side ? BADGE[v.side] : null;
  const withStored = wal.storedCount > 0 || wal.gaps.length > 0;
  const detail = ok && withStored ? walLine(wal, net.stepMs) : loadedLine(v, net.stepMs, net.detail);
  const prov = provenanceOf({ series, state, source: net.source, measuredAt: wal.measuredAt, now, stepMs: net.stepMs });
  const archiveStored = archive.rows.length;
  const aLine = archiveLine({
    status: symbol ? archive.status : "ready",
    recording: archive.recording,
    storedCount: archiveStored,
    firstT: archive.rows[0]?.t ?? null,
    lastT: archive.rows[archiveStored - 1]?.t ?? null,
    gaps: wal.gaps.length,
  });
  const headBadge = badge ? (
    <Badge tone={stale || state === "archive" ? "warn" : badge.tone} dot>
      {stale ? "veraltet" : state === "archive" ? "gespeichert" : badge.label}
    </Badge>
  ) : (
    <Badge tone="mute">{state === "loading" ? "lädt" : state === "short" ? "zu wenig Verlauf" : "keine Daten"}</Badge>
  );

  const exportCsv = () => {
    void download(`top-trader-netto-${series}-${symbol ?? "BTCUSDT"}.csv`, netPointsToCsv(wal.points, wal.gaps, wal.liveFrom), "text/csv;charset=utf-8");
  };

  return (
    <Card
      title={S.title}
      note={S.note}
      className="h-full"
      action={headBadge}
      data-testid={TRADER_NET_CARD_ID}
      data-state={state}
      data-side={ok ? v?.side : undefined}
      data-kind={title.kind}
      data-series={series}
    >
      <div className="grid gap-3">
        {/* the headline and the line under it keep their room as one block: three lines of headline and two of detail on a
            phone, two and one from sm up – the text starts at the top, the spare room is at the end of the block */}
        <div className="grid min-h-[calc(3.9*clamp(16px,4.4vw,21px)+6px+33px)] content-start gap-1.5 sm:min-h-[77px]">
          <h3 className="text-[clamp(16px,4.4vw,21px)] font-medium leading-[1.3] tracking-tight text-fg" data-testid="trader-net-title" data-kind={title.kind}>
            {state === "loading" ? S.loading : <Headline segments={title.segments} side={title.side} />}
          </h3>
          <p className="text-[12px] leading-snug text-mute" data-testid="trader-net-line">
            {state === "loading" ? "" : state === "archive" ? S.archiveStateNote : detail}
            {stale && net.detail ? ` · ${net.detail}` : ""}
          </p>
        </div>

        <div className="grid grid-cols-3 border-y border-line py-3" data-testid="trader-net-kpis">
          {kpis.map((k) => (
            <KpiTile key={k.id} k={k} />
          ))}
        </div>

        {/* provenance: three lines, each with room for two on a phone */}
        <dl className="grid grid-cols-[3.6rem_minmax(0,1fr)] gap-x-3 gap-y-1 text-[11px] leading-[1.3]" data-testid="trader-net-provenance">
          {prov.map((p) => (
            <div key={p.id} className="contents">
              <dt className="text-mute">{p.label}</dt>
              <dd className="min-h-[2.6em] min-w-0 text-fg/90 sm:min-h-[1.3em]" data-testid={`trader-net-prov-${p.id}`}>
                {p.value}
              </dd>
            </div>
          ))}
        </dl>

        <div className="grid gap-1.5">
          <div className="flex min-h-9 items-center justify-between gap-3">
            <span className="text-[11px] text-mute max-[420px]:sr-only">{S.seriesLabel}</span>
            <Segmented size="sm" aria-label={S.seriesLabel} value={series} onChange={(id) => setSeries(id)} options={NET_SERIES_IDS.map((id) => ({ v: id, label: NET_SERIES[id].label }))} />
          </div>
          <div className="flex min-h-9 items-center justify-between gap-3">
            <span className="text-[11px] text-mute max-[420px]:sr-only">{S.rangeLabel}</span>
            {ok ? (
              <Segmented size="sm" aria-label={S.rangeLabel} value={range.id} onChange={setRangeId} options={choices.map((c) => ({ v: c.id, label: c.label, disabled: c.disabled }))} />
            ) : (
              <span className="text-[11px] text-mute" data-testid="trader-net-range-fixed">
                –
              </span>
            )}
          </div>
        </div>

        {ok ? (
          <TraderNetPlot points={points} flip={flip} gaps={gaps} marks={marks} windowKey={`${series}:${range.id}`} priceName={base} label={plotLabelOf(v!, points, flip, marks, gaps.length)} />
        ) : (
          <div className={cn(PLOT_BOX, "grid place-items-center px-6 text-center")} data-testid="trader-net-empty">
            {state === "loading" ? (
              <span className="grid place-items-center gap-3">
                <ThinkingOrb variant="search" size={36} />
                <span className="text-[12px] text-mute">{S.loading}</span>
              </span>
            ) : (
              <p className="max-w-[44ch] text-[13px] leading-snug text-mute">{net.detail ?? detail}</p>
            )}
          </div>
        )}

        <p className="flex min-h-[4.125em] flex-wrap items-center gap-x-4 gap-y-1 text-[11px] leading-snug text-mute sm:min-h-[2.75em] xl:min-h-[1.375em]" data-testid="trader-net-legend">
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
          <span className="inline-flex items-center gap-1.5">
            <MarkSwatch kind="warn" />
            {S.legendWarn}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <MarkSwatch kind="confirm" />
            {S.legendConfirm}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="h-2.5 w-3 rounded-[3px] border border-dashed border-fg/45 bg-fg/[0.06]" />
            {S.legendGap}
          </span>
        </p>
        <p className="text-[11.5px] leading-snug text-mute" data-testid="trader-net-marks-help">
          {marksRuleText()} {S.marksHelp}
        </p>

        <TraderNetArchive line={aLine} status={symbol ? archive.status : "ready"} recording={archive.recording} stored={archiveStored} canExport={ok && wal.points.length > 0} onCsv={exportCsv} onClear={archive.clear} />

        <p className="text-[11.5px] leading-snug text-mute" data-testid="trader-net-help">
          {S.help} {S.seriesHint}.
        </p>
      </div>
    </Card>
  );
}

/** The accessible name of the plot: what the base label says plus the marks and the gaps of the range. */
function plotLabelOf(v: TraderNetView, points: readonly NetPoint[], flip: NetFlip | null, marks: readonly WhaleMark[], gapCount: number): string {
  const base = plotLabel(v, points, flip);
  const extra = [marks.length ? `Marken der Alarm-Regel: ${marksSummary(marks)}` : "", gapCount ? `${gapCount} ${gapCount === 1 ? "Lücke" : "Lücken"} ohne Messwerte` : ""].filter(Boolean).join(". ");
  return extra ? `${base} ${extra}.` : base;
}
