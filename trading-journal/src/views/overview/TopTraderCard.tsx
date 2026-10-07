import { motion, useTransform } from "motion/react";
import { memo, useCallback, useMemo, useState } from "react";
import { HYBLOCK_LINK } from "@/domain/defaults";
import { explainFallingKnife, fallingKnife, KNIFE_TITLE, knifeCardLine, readingAge } from "@/domain/fallingKnife";
import type { HyblockReading } from "@/domain/types";
import { cn } from "@/lib/cn";
import { date as fmtDate, n1 } from "@/lib/format";
import { COHORT_HINT, priceMv, SOURCE_NAME, STRINGS, virtualReading } from "@/market";
import { useNowMv } from "@/motion/clock";
import { MorphCard, MorphTitle } from "@/motion/MorphCard";
import { useMorphDialog } from "@/motion/MorphDialog";
import { MotionNumber } from "@/motion/MotionNumber";
import { radius, spring, stagger, tween } from "@/motion/tokens";
import { Badge } from "@/primitives/Badge";
import { Card } from "@/primitives/Card";
import { EmptyState } from "@/primitives/EmptyState";
import { Segmented } from "@/primitives/Segmented";
import { Sparkline } from "@/primitives/Sparkline";
import { useJournal, useReadings } from "@/store/journalStore";
import { useUi } from "@/store/uiStore";
import { HyblockForm } from "@/app/overlays";
import { ExplanationView } from "./explainer";
import { TapTooltip } from "./TapTooltip";
import { useMotionSelect, usePriceClass, usePriceSource, useTopTraderView } from "./useMarket";

export const TOP_TRADER_TITLE = "Top Trader · Binance";
export const DELTA_HINT = "Top-vs-Alle-Delta: Top 20 % nach Margin vs. alle Konten (Binance), Ersatz für Whale-vs-Retail";
export const READING_DIALOG_TITLE = "Hyblock-Ablesung";
export const DELTA_CANDLES_LABEL = "Δ+ Kerzen";
export const EMPTY_TITLE = "Noch keine Ablesung";
export const EMPTY_TEXT = "Trag Top-Trader-Long-% und Whale-Delta aus Hyblock ein. Mit dem Live-Kurs prüft das Journal dann deinen Falling-Knife-Filter.";
const SPARK_OPTIONS = [
  { v: "readings", label: "Ablesungen" },
  { v: "live", label: "Live" },
] as const;

type KnifeState = "ok" | "no" | "none";
const KNIFE_BAR: Record<KnifeState, string> = { ok: "bg-win", no: "bg-loss/60", none: "bg-white/10" };
const KNIFE_STATES: KnifeState[] = ["none", "no", "ok"];

/** `Stand`: reading age (`vor 12 min`, `vor 3 h`, else the date) on the shared second clock; only the 12-h warn flip re-renders. */
const StandAge = memo(function StandAge({ at }: { at: string }) {
  const now = useNowMv();
  const text = useTransform(now, (n) => readingAge(at, n).label || fmtDate(new Date(at)));
  const sources = useMemo(() => [now], [now]);
  const warn = useMotionSelect(sources, () => readingAge(at, now.get()).warn);
  return <motion.div className={cn("num mt-0.5 font-mono text-[14px] transition-colors duration-300", warn && "text-warn")}>{text}</motion.div>;
});

/**
 * The four Falling-Knife segments: grey / red crossfade, a fulfilled point fills from the left; changes cascade left
 * to right (`stagger.reveal`).
 */
const KnifeBars = memo(function KnifeBars({ states }: { states: string }) {
  return (
    <div className="grid grid-cols-4 gap-1.5">
      {Array.from(states).map((s, i) => {
        const state: KnifeState = s === "o" ? "ok" : s === "x" ? "no" : "none";
        const delay = i * stagger.reveal;
        return (
          <span key={i} className="relative h-1.5 overflow-hidden rounded-full" aria-hidden="true">
            {KNIFE_STATES.map((k) => (
              <motion.span
                key={k}
                className={cn("absolute inset-0 origin-left rounded-full", KNIFE_BAR[k])}
                initial={false}
                animate={k === "ok" ? { opacity: state === k ? 1 : 0, scaleX: state === k ? 1 : 0 } : { opacity: state === k ? 1 : 0 }}
                transition={k === "ok" ? { opacity: { ...tween.crossfade, delay }, scaleX: { ...tween.bar, delay } } : { ...tween.crossfade, delay }}
              />
            ))}
          </span>
        );
      })}
    </div>
  );
});

/** Stable array identity for equal values (the sparkline restarts its morph on every new array). */
function useStableValues(values: readonly number[]): readonly number[] {
  const key = values.join(",");
  return useMemo(() => (key ? key.split(",").map(Number) : []), [key]);
}

/**
 * `Top Trader · Binance` (Bundle `w2` with Binance as the data source, Plan 4.8 / 6.1): Long % (accounts or
 * positions per `tj2-ui.topTraderBase`), second value, `Top vs. Alle` delta, `Δ+ Kerzen`, `Stand`, sparkline
 * (`Ablesungen | Live`), Falling-Knife card → dialog, footer with `Letzte löschen` / `Hyblock ↗`.
 * Re-renders only when a ratio series publishes, its health changes or the price crosses the support zone –
 * never per trade or kline tick. Values flash on change; `Stand` ages on the shared clock.
 */
export function TopTraderCard() {
  const settings = useJournal((s) => s.settings);
  const deleteHyblock = useJournal((s) => s.deleteHyblock);
  const readings = useReadings();
  const base = useUi((s) => s.topTraderBase);
  const spark = useUi((s) => s.sparkline);
  const setPref = useUi((s) => s.setPref);
  const pushToast = useUi((s) => s.pushToast);
  const { tt, label } = useTopTraderView(base);
  const priceSource = usePriceSource();
  const { open, close } = useMorphDialog();
  const [confirm, setConfirm] = useState(false);

  // the card only needs to know whether the price is inside the support zone; the dialog reads the price on open
  const { zoneLow, zoneHigh } = settings.market;
  const classifyZone = useCallback((p: number | null) => (p == null ? "none" : p >= zoneLow && p <= zoneHigh ? "in" : "out"), [zoneLow, zoneHigh]);
  const zone = usePriceClass(classifyZone, null);

  const last = readings[readings.length - 1];
  const prev = readings[readings.length - 2];
  const virtual = virtualReading(tt, last);
  const current: HyblockReading | undefined = virtual ?? last;
  const previous = virtual ? last : prev;
  const source = priceSource ? SOURCE_NAME[priceSource] : "Binance";
  const fk = fallingKnife(current, previous, { price: zone.price, source }, settings);
  const note = tt.state === "live" || tt.state === "fallback" ? label.text : undefined;
  const otherBase = base === "positions" ? tt.longPctAccounts : tt.longPctPositions;
  const sparkValues = useStableValues(spark === "live" && !tt.onlyBinance ? tt.sparkline : readings.slice(-20).map((r) => r.longPct));
  const knifeStates = fk.pts.map((p) => (p.ok ? "o" : p.ok === false ? "x" : "-")).join("");
  const knifeOpen = open?.id === "falling-knife";

  const remove = async () => {
    if (!current?.id) return;
    setConfirm(false);
    try {
      await deleteHyblock(current.id);
      pushToast({ kind: "info", title: "Ablesung gelöscht" });
    } catch {
      pushToast({ kind: "error", title: "Löschen fehlgeschlagen." });
    }
  };

  const knifeBody = () => {
    const p = priceMv.get();
    const fresh = fallingKnife(current, previous, { price: p > 0 ? p : zone.price, source }, settings);
    return <ExplanationView bare d={explainFallingKnife(fresh)} />;
  };

  const action = (
    <span className="flex flex-wrap items-center gap-2">
      <Segmented<"readings" | "live">
        size="sm"
        aria-label="Sparkline"
        options={SPARK_OPTIONS.map((o) => (o.v === "live" && tt.onlyBinance ? { ...o, disabled: true, label: <span title={STRINGS.onlyBinance}>{o.label}</span> } : o))}
        value={spark}
        onChange={(v) => setPref("sparkline", v)}
      />
      <MorphCard
        id="hyblock-new"
        title={READING_DIALOG_TITLE}
        borderRadius={radius.pill}
        className="touch-hit !w-auto rounded-full border border-line-2 bg-white/[0.04] px-3 py-1 hover:bg-white/[0.08]"
        body={() => <HyblockForm last={last ?? null} live={tt.liveReadingOk ? { longPct: tt.longPct, delta: tt.delta, deltaCandles: tt.deltaCandles } : null} onClose={close} />}
      >
        <span className="text-[12px] font-semibold text-fg">+ Ablesung</span>
      </MorphCard>
    </span>
  );

  return (
    <Card title={TOP_TRADER_TITLE} note={note} action={action}>
      {current ? (
        <div className="grid gap-4">
          <div className="grid grid-cols-[auto_1fr] items-end gap-5">
            <div>
              <div className="label flex items-center gap-2">
                Long %
                {tt.onlyBinance && (
                  <Badge tone="mute" title={label.detail ?? COHORT_HINT.bybit}>
                    {STRINGS.onlyBinance}
                  </Badge>
                )}
              </div>
              <div className="dot-num mt-1 flex items-baseline gap-2 text-[38px] leading-none">
                <MotionNumber value={current.longPct} decimals={1} flash />
                {fk.rising != null && (
                  <motion.span key={String(fk.rising)} initial={{ y: fk.rising ? 6 : -6, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={spring.smooth} className={cn("font-mono text-sm", fk.rising ? "text-win" : "text-loss")}>
                    {fk.rising ? "▲" : "▼"}
                  </motion.span>
                )}
              </div>
              {tt.onlyBinance ? (
                tt.globalLongPct != null && (
                  <div className="mt-1 flex items-center gap-2 text-[11.5px] text-mute">
                    <span className="dot-num text-[18px] text-fg">{n1(tt.globalLongPct)} %</span>
                    <span>Alle Konten (Bybit)</span>
                    <TapTooltip content={COHORT_HINT.bybit}>
                      <button type="button" className="touch-hit rounded-full">
                        <Badge tone="mute">{STRINGS.otherCohort}</Badge>
                      </button>
                    </TapTooltip>
                  </div>
                )
              ) : (
                <button
                  type="button"
                  onClick={() => setPref("topTraderBase", base === "positions" ? "accounts" : "positions")}
                  className="touch-hit mt-1 flex items-center gap-2 text-[11.5px] text-mute hover:text-fg"
                  title="Basis wechseln"
                >
                  <span className="dot-num text-[18px] text-fg">{otherBase == null ? "–" : `${n1(otherBase)} %`}</span>
                  <span>{base === "positions" ? "Konten" : "Positionen"}</span>
                </button>
              )}
            </div>
            <Sparkline values={sparkValues} />
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-xl border border-line bg-ink-950/30 px-3 py-2">
              <TapTooltip content={DELTA_HINT}>
                <button type="button" className="touch-hit label !text-[9.5px] underline decoration-dotted decoration-faint underline-offset-2">
                  Delta
                </button>
              </TapTooltip>
              {/* display only: the label's 44 px tap area reaches over the value (a tap on the value explains it too) */}
              <div className={cn("pointer-events-none num mt-0.5 font-mono text-[14px] transition-colors duration-300", current.delta > 0 ? "text-win" : current.delta < 0 ? "text-loss" : "")}>
                <MotionNumber value={current.delta} decimals={1} signed flash />
              </div>
              <div className="text-[10px] text-faint">Top vs. Alle</div>
            </div>
            <div className="rounded-xl border border-line bg-ink-950/30 px-3 py-2">
              {/* "Δ+": consecutive candles with a positive delta (a bare "+" read like an expand affordance) */}
              <div className="label !text-[9.5px]">{DELTA_CANDLES_LABEL}</div>
              <div className="num mt-0.5 font-mono text-[14px]">
                <MotionNumber value={current.deltaCandles} flash />
              </div>
            </div>
            <div className="rounded-xl border border-line bg-ink-950/30 px-3 py-2">
              <div className="label !text-[9.5px]">Stand</div>
              <StandAge at={current.at} />
            </div>
          </div>

          <MorphCard id="falling-knife" title={KNIFE_TITLE} className="rounded-2xl border border-line-2 bg-ink-950/25 p-3.5 hover:border-white/30" body={knifeBody}>
            <div className="mb-2.5 flex items-center justify-between gap-2">
              <MorphTitle id="falling-knife" as="span" className="label !text-fg">
                {KNIFE_TITLE}
              </MorphTitle>
              <motion.span
                layout="position"
                layoutId="morph-fk-count"
                layoutDependency={`${fk.n}|${knifeOpen}`}
                style={{ borderRadius: 0 }}
                className={cn("dot-num text-[18px] transition-colors duration-300", fk.all ? "text-win" : fk.knife ? "text-loss" : "text-warn")}
              >
                <MotionNumber value={fk.n} />
                /4
              </motion.span>
            </div>
            <KnifeBars states={knifeStates} />
            <p className={cn("mt-2.5 text-[12px] transition-colors duration-300", fk.all ? "text-win" : fk.knife ? "text-loss" : "text-mute")}>{knifeCardLine(fk)}</p>
          </MorphCard>

          <div className="flex items-center justify-between gap-2 text-[11.5px] text-faint">
            <span>{virtual ? virtual.note : tt.detail && tt.state !== "live" ? tt.detail : `${readings.length} Ablesung${readings.length === 1 ? "" : "en"}`}</span>
            <span className="flex gap-3">
              {current.id &&
                (confirm ? (
                  <>
                    <button type="button" className="touch-hit text-loss" onClick={remove}>
                      Wirklich löschen
                    </button>
                    <button type="button" className="touch-hit" onClick={() => setConfirm(false)}>
                      Nein
                    </button>
                  </>
                ) : (
                  <button type="button" className="touch-hit hover:text-loss" onClick={() => setConfirm(true)}>
                    Letzte löschen
                  </button>
                ))}
              <a href={HYBLOCK_LINK} target="_blank" rel="noreferrer" className="touch-hit text-fg hover:underline">
                Hyblock ↗
              </a>
            </span>
          </div>
        </div>
      ) : (
        <EmptyState
          title={EMPTY_TITLE}
          text={EMPTY_TEXT}
          action={
            <a href={HYBLOCK_LINK} target="_blank" rel="noreferrer" className="touch-hit label mt-2 !text-fg hover:underline">
              Hyblock öffnen ↗
            </a>
          }
        />
      )}
    </Card>
  );
}
