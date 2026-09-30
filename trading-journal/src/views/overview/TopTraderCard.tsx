import { motion } from "motion/react";
import { useState } from "react";
import { HYBLOCK_LINK } from "@/domain/defaults";
import { explainFallingKnife, fallingKnife, KNIFE_TITLE, knifeCardLine, readingAge } from "@/domain/fallingKnife";
import type { HyblockReading } from "@/domain/types";
import { cn } from "@/lib/cn";
import { date as fmtDate, n1 } from "@/lib/format";
import { COHORT_HINT, SOURCE_NAME, STRINGS, useStatusLabel, useTopTrader, virtualReading } from "@/market";
import { MorphCard, MorphTitle } from "@/motion/MorphCard";
import { useMorphDialog } from "@/motion/MorphDialog";
import { MotionNumber } from "@/motion/MotionNumber";
import { radius, spring, tween } from "@/motion/tokens";
import { Badge } from "@/primitives/Badge";
import { Card } from "@/primitives/Card";
import { EmptyState } from "@/primitives/EmptyState";
import { Segmented } from "@/primitives/Segmented";
import { Sparkline } from "@/primitives/Sparkline";
import { Tooltip } from "@/primitives/Tooltip";
import { useJournal, useReadings } from "@/store/journalStore";
import { useUi } from "@/store/uiStore";
import { HyblockForm } from "@/app/overlays";
import { ExplanationView } from "./explainer";
import { usePriceSnapshot } from "./useMarket";

export const TOP_TRADER_TITLE = "Top Trader · Binance";
export const DELTA_HINT = "Top-vs-Alle-Delta: Top 20 % nach Margin vs. alle Konten (Binance), Ersatz für Whale-vs-Retail";
export const READING_DIALOG_TITLE = "Hyblock-Ablesung";
export const EMPTY_TITLE = "Noch keine Ablesung";
export const EMPTY_TEXT = "Trag Top-Trader-Long-% und Whale-Delta aus Hyblock ein. Mit dem Live-Kurs prüft das Journal dann deinen Falling-Knife-Filter.";
const SPARK_OPTIONS = [
  { v: "readings", label: "Ablesungen" },
  { v: "live", label: "Live" },
] as const;

const KNIFE_BAR: Record<"ok" | "no" | "none", string> = { ok: "bg-win", no: "bg-loss/60", none: "bg-white/10" };

/**
 * `Top Trader · Binance` (Bundle `w2` with Binance as the data source, Plan 4.8 / 6.1): Long % (accounts or
 * positions per `tj2-ui.topTraderBase`), second value, `Top vs. Alle` delta, `Kerzen +`, `Stand`, sparkline
 * (`Ablesungen | Live`), Falling-Knife card → dialog, footer with `Letzte löschen` / `Hyblock ↗`.
 */
export function TopTraderCard() {
  const settings = useJournal((s) => s.settings);
  const deleteHyblock = useJournal((s) => s.deleteHyblock);
  const readings = useReadings();
  const base = useUi((s) => s.topTraderBase);
  const spark = useUi((s) => s.sparkline);
  const setPref = useUi((s) => s.setPref);
  const pushToast = useUi((s) => s.pushToast);
  const tt = useTopTrader(base);
  const label = useStatusLabel(base === "positions" ? "topPositionRatio" : "topAccountRatio");
  const { price, provenance } = usePriceSnapshot();
  const { close } = useMorphDialog();
  const [confirm, setConfirm] = useState(false);

  const last = readings[readings.length - 1];
  const prev = readings[readings.length - 2];
  const virtual = virtualReading(tt, last);
  const current: HyblockReading | undefined = virtual ?? last;
  const previous = virtual ? last : prev;
  const source = provenance ? SOURCE_NAME[provenance.source] : "Binance";
  const fk = fallingKnife(current, previous, { price, source }, settings);
  const age = current ? readingAge(current.at) : null;
  const note = tt.state === "live" || tt.state === "fallback" ? label.text : undefined;
  const otherBase = base === "positions" ? tt.longPctAccounts : tt.longPctPositions;
  const sparkValues = spark === "live" && !tt.onlyBinance ? tt.sparkline : readings.slice(-20).map((r) => r.longPct);

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
        className="!w-auto rounded-full border border-line-2 bg-white/[0.04] px-3 py-1 hover:bg-white/[0.08]"
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
                <MotionNumber value={current.longPct} decimals={1} />
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
                    <Tooltip content={COHORT_HINT.bybit} delayDuration={300}>
                      <button type="button" className="rounded-full">
                        <Badge tone="mute">{STRINGS.otherCohort}</Badge>
                      </button>
                    </Tooltip>
                  </div>
                )
              ) : (
                <button
                  type="button"
                  onClick={() => setPref("topTraderBase", base === "positions" ? "accounts" : "positions")}
                  className="mt-1 flex items-center gap-2 text-[11.5px] text-mute hover:text-fg"
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
              <Tooltip content={DELTA_HINT} delayDuration={300}>
                <button type="button" className="label !text-[9.5px] underline decoration-dotted decoration-faint underline-offset-2">
                  Delta
                </button>
              </Tooltip>
              <div className={cn("num mt-0.5 font-mono text-[14px]", current.delta > 0 ? "text-win" : current.delta < 0 ? "text-loss" : "")}>
                <MotionNumber value={current.delta} decimals={1} signed />
              </div>
              <div className="text-[10px] text-faint">Top vs. Alle</div>
            </div>
            <div className="rounded-xl border border-line bg-ink-950/30 px-3 py-2">
              <div className="label !text-[9.5px]">Kerzen +</div>
              <div className="num mt-0.5 font-mono text-[14px]">
                <MotionNumber value={current.deltaCandles} />
              </div>
            </div>
            <div className="rounded-xl border border-line bg-ink-950/30 px-3 py-2">
              <div className="label !text-[9.5px]">Stand</div>
              <div className={cn("num mt-0.5 font-mono text-[14px]", age?.warn && "text-warn")}>{age && age.label ? age.label : fmtDate(new Date(current.at))}</div>
            </div>
          </div>

          <MorphCard id="falling-knife" title={KNIFE_TITLE} className="rounded-2xl border border-line-2 bg-ink-950/25 p-3.5 hover:border-white/30" body={() => <ExplanationView bare d={explainFallingKnife(fk)} />}>
            <div className="mb-2.5 flex items-center justify-between gap-2">
              <MorphTitle id="falling-knife" as="span" className="label !text-fg">
                {KNIFE_TITLE}
              </MorphTitle>
              <motion.span layout="position" layoutId="morph-fk-count" className={cn("dot-num text-[18px]", fk.all ? "text-win" : fk.knife ? "text-loss" : "text-warn")}>
                <MotionNumber value={fk.n} />
                /4
              </motion.span>
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {fk.pts.map((p) => (
                <span key={p.k} className="relative h-1.5 overflow-hidden rounded-full" aria-hidden="true">
                  {(["ok", "no", "none"] as const).map((k) => (
                    <motion.span key={k} className={cn("absolute inset-0 rounded-full", KNIFE_BAR[k])} initial={false} animate={{ opacity: (p.ok ? "ok" : p.ok === false ? "no" : "none") === k ? 1 : 0 }} transition={tween.crossfade} />
                  ))}
                </span>
              ))}
            </div>
            <p className={cn("mt-2.5 text-[12px]", fk.all ? "text-win" : fk.knife ? "text-loss" : "text-mute")}>{knifeCardLine(fk)}</p>
          </MorphCard>

          <div className="flex items-center justify-between gap-2 text-[11.5px] text-faint">
            <span>{virtual ? virtual.note : tt.detail && tt.state !== "live" ? tt.detail : `${readings.length} Ablesung${readings.length === 1 ? "" : "en"}`}</span>
            <span className="flex gap-3">
              {current.id &&
                (confirm ? (
                  <>
                    <button type="button" className="text-loss" onClick={remove}>
                      Wirklich löschen
                    </button>
                    <button type="button" onClick={() => setConfirm(false)}>
                      Nein
                    </button>
                  </>
                ) : (
                  <button type="button" className="hover:text-loss" onClick={() => setConfirm(true)}>
                    Letzte löschen
                  </button>
                ))}
              <a href={HYBLOCK_LINK} target="_blank" rel="noreferrer" className="text-fg hover:underline">
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
            <a href={HYBLOCK_LINK} target="_blank" rel="noreferrer" className="label mt-2 !text-fg hover:underline">
              Hyblock öffnen ↗
            </a>
          }
        />
      )}
    </Card>
  );
}
