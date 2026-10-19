/**
 * `Preis- & RSI-Struktur` (F05): per selected timeframe the diagonal trendlines of the PRICE and of the RSI – the
 * Abwärtstrendlinie (falling highs) and the Aufwärtstrendlinie (rising lows) – with approach, break and retest stated
 * apart (`describeLine`), the distance in % and ATR (RSI: points) and the number of touches. Everything comes from
 * `analyzeTrendlines` on CLOSED candles of the timeframe's own feed (`src/market/trendlines`); a timeframe the feed cannot
 * serve is shown locked with the reason and never replaced by another one.
 *
 * Lazy: loaded by `MarktView` on its own chunk. Motion: none of its own (the cell reveals); the switch and the chips use
 * the shared tokens. Mobile: one column, chips wrap, touch targets ≥ 44 px on coarse pointers.
 */
import { memo, useState } from "react";
import { KEY_TF_MS, tfLabel } from "@/domain/keylevels";
import { describeLine, emptyText, KIND_HINT, KIND_LABEL, type TrendKind, type TrendLineView, type TrendSeries, type TrendSlot, type TrendTone } from "@/domain/trendlines";
import { cn } from "@/lib/cn";
import { dateTime, price as fmtPrice } from "@/lib/format";
import { fmt } from "@/chart/format";
import { useTrendlines, type TrendTfItem } from "@/market/trendlines/store";
import { toggledTfs, writeTrendlines } from "@/market/trendlines/write";
import { Switch } from "@/motion/Switch";
import { Card } from "@/primitives/Card";
import { TREND } from "./trendStrings";

const TONE_TEXT: Record<TrendTone, string> = { win: "text-win", loss: "text-loss", warn: "text-warn", mute: "text-mute" };
const TONE_DOT: Record<TrendTone, string> = { win: "bg-win", loss: "bg-loss", warn: "bg-warn", mute: "bg-faint" };

function LineStatus({ v, state }: { v: TrendLineView; state: "active" | "broken" }) {
  const t = describeLine(v);
  return (
    <li className="grid gap-0.5" data-testid="trend-line" data-series={v.series} data-kind={v.kind} data-state={state} data-phase={t.phase} data-tone={t.tone}>
      <span className={cn("flex items-center gap-2 text-[13px] font-semibold leading-snug", TONE_TEXT[t.tone])}>
        <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", TONE_DOT[t.tone])} />
        {t.title}
      </span>
      <span className="pl-3.5 text-[12px] leading-snug text-mute">{t.detail}</span>
    </li>
  );
}

function KindBlock({ kind, series, slot, empty }: { kind: TrendKind; series: TrendSeries; slot: TrendSlot; empty: string }) {
  // the break comes first: it is the news; the intact line follows
  const lines: Array<{ v: TrendLineView; state: "active" | "broken" }> = [];
  if (slot.broken) lines.push({ v: slot.broken, state: "broken" });
  if (slot.active) lines.push({ v: slot.active, state: "active" });
  return (
    <div className="grid gap-1" data-testid="trend-kind" data-series={series} data-kind={kind}>
      <span className="label !text-[9.5px]">
        {KIND_LABEL[kind]} <span className="font-normal normal-case tracking-normal text-faint">· {KIND_HINT[kind]}</span>
      </span>
      {lines.length ? (
        <ul className="grid gap-1.5">
          {lines.map((l) => (
            <LineStatus key={l.state} v={l.v} state={l.state} />
          ))}
        </ul>
      ) : (
        <span className="text-[12px] text-faint" data-testid="trend-empty">
          {empty}
        </span>
      )}
    </div>
  );
}

function Row({ item, running }: { item: TrendTfItem; running: boolean }) {
  const a = item.analysis;
  const label = tfLabel(item.tf);
  return (
    <li className="grid gap-3 rounded-xl border border-line bg-ink-950/30 p-3" data-testid="trend-row" data-tf={item.tf} data-status={a ? a.status : "locked"}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="num inline-flex items-center rounded-md border border-line-2 px-1.5 py-px font-mono text-[10.5px] text-mute">{label}</span>
        {a ? (
          <span className="text-[11px] text-faint">
            {TREND.closedBars(a.bars)}
            {a.asOf != null && ` · ${TREND.asOf} ${dateTime(new Date(a.asOf + KEY_TF_MS[item.tf]))}`}
            {a.status === "ok" && a.rsiLast != null && ` · ${TREND.rsiNow} ${fmt.n1(a.rsiLast)}`}
            {a.status === "ok" && a.atr != null && ` · ${TREND.atr} ${fmtPrice(a.atr)}`}
          </span>
        ) : null}
      </div>
      {!a ? (
        <p className="text-[12px] text-mute" data-testid="trend-locked">
          {!running ? TREND.idle : item.avail.reason}
        </p>
      ) : a.status === "few" ? (
        <p className="text-[12px] text-mute" data-testid="trend-few">
          {emptyText(a, "price")}
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {(["price", "rsi"] as const).map((s) => (
            <section key={s} className="grid content-start gap-3" aria-label={s === "price" ? TREND.price : TREND.rsi} data-testid="trend-series" data-series={s}>
              <h3 className="label flex items-center gap-2">
                <span className="size-1.5 rounded-full bg-signal" aria-hidden="true" />
                {s === "price" ? TREND.price : TREND.rsi}
              </h3>
              {(["down", "up"] as const).map((k) => (
                <KindBlock key={k} kind={k} series={s} slot={a[s][k]} empty={emptyText(a, s)} />
              ))}
            </section>
          ))}
        </div>
      )}
    </li>
  );
}

export const TrendStructureCard = memo(function TrendStructureCard() {
  const view = useTrendlines();
  const [failed, setFailed] = useState(false);
  const save = (patch: Parameters<typeof writeTrendlines>[0]) => void writeTrendlines(patch).then((ok) => setFailed(!ok));
  const selected = view.items.filter((i) => i.selected);
  const blocked = view.items.filter((i) => !i.avail.ok);
  const running = view.state === "ok";
  return (
    <Card
      title={TREND.title}
      note={TREND.note}
      data-testid="markt-trend"
      action={
        <label className="flex items-center gap-2 text-[11.5px] text-mute pointer-coarse:min-h-11">
          <span>{TREND.chartSwitch}</span>
          <Switch size="sm" checked={view.cfg.chart} onCheckedChange={(chart) => save({ chart })} aria-label={view.cfg.chart ? TREND.chartSwitchOn : TREND.chartSwitchOff} data-testid="trend-chart-switch" />
        </label>
      }
    >
      <div className="grid gap-4">
        <div className="grid gap-2">
          <span id="trend-tfs-l" className="label">
            {TREND.tfs}
          </span>
          <div className="flex flex-wrap gap-1.5" role="group" aria-labelledby="trend-tfs-l" data-testid="trend-tfs">
            {view.items.map((it) => {
              const on = it.selected;
              const disabled = !it.avail.ok && !on;
              return (
                <button
                  key={it.tf}
                  type="button"
                  aria-pressed={on}
                  disabled={disabled}
                  title={it.avail.ok ? undefined : (it.avail.reason ?? undefined)}
                  onClick={() => save({ tfs: toggledTfs(view.cfg.tfs, it.tf, !on) })}
                  data-tf={it.tf}
                  data-locked={it.avail.ok ? undefined : ""}
                  className={cn(
                    "num min-h-8 rounded-full border px-3 font-mono text-[12px] transition-colors duration-200 pointer-coarse:min-h-11 pointer-coarse:min-w-11",
                    on ? "border-transparent bg-fg font-medium text-ink-900" : "border-line-2 text-mute hover:border-white/30 hover:text-fg",
                    disabled && "cursor-not-allowed opacity-40 hover:border-line-2 hover:text-mute",
                  )}
                >
                  {tfLabel(it.tf)}
                </button>
              );
            })}
          </div>
          {blocked.length > 0 ? (
            <ul className="grid gap-0.5 text-[11px] text-faint" aria-label={TREND.blocked} data-testid="trend-blocked">
              {blocked.map((b) => (
                <li key={b.tf}>
                  <span className="num font-mono text-mute">{tfLabel(b.tf)}</span> – {b.avail.reason}
                </li>
              ))}
            </ul>
          ) : (
            <span className="text-[11px] text-faint">{TREND.tfsHelp}</span>
          )}
          {failed && (
            <span role="alert" className="text-[11px] text-loss">
              {TREND.saveFailed}
            </span>
          )}
        </div>
        {selected.length === 0 ? (
          <p className="text-[12px] text-mute" data-testid="trend-none">
            {TREND.none}
          </p>
        ) : (
          <ul className="grid gap-2" data-testid="trend-rows">
            {selected.map((it) => (
              <Row key={it.tf} item={it} running={running} />
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
});
