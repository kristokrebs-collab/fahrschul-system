import { motion } from "motion/react";
import { useMemo, useState, type ReactNode } from "react";
import { BEHAVIOR_LABEL, type BehaviorKey } from "@/domain/coach/events";
import { holdLabel, holdMs } from "@/domain/excursion";
import { fillStats, FILL_KIND_LABELS } from "@/domain/fills";
import type { EnrichedTrade, Setup, Trade } from "@/domain/types";
import { stripEnrichment } from "@/domain/csv";
import { cn } from "@/lib/cn";
import { date as fmtDate, n2, price as fmtPrice, signed, time as fmtTime } from "@/lib/format";
import { useProvider } from "@/market";
import { measureAndStore, measurablePair, MEASURE_HINTS, type MeasureStatus } from "@/market/excursion";
import { MilestoneRail, type Milestone } from "@/motion/pulse/MilestoneRail";
import { StaggerItem } from "@/motion/Stagger";
import { spring } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { useJournal } from "@/store/journalStore";
import { pushToast } from "@/store/uiStore";
import { openReplay } from "@/views/trades/replay/replayStore";
import { SCALE_LABELS } from "../editor/PsychSection";
import { ShotReel } from "../screenshots/ShotReel";
import { downloadShareCard } from "../sharePng";
import { ExcursionBar } from "./ExcursionBar";
import { FillsBar } from "./FillsBar";
import { RatingDots } from "./RatingDots";

export interface JournalDetailProps {
  trade: EnrichedTrade;
  currency: string;
  setups: readonly Setup[];
}

const MARKET = { perp: "Perp", spot: "Spot" } as const;
const MARGIN = { isolated: "Isoliert", cross: "Cross" } as const;

/** Rows of the `Ausführung` facts (only what the trade has). */
export function executionFacts(t: EnrichedTrade, currency: string): [string, string][] {
  const out: [string, string][] = [];
  if (t.exitDate) out.push(["Ausstieg um", `${fmtDate(new Date(t.exitDate))} ${fmtTime(new Date(t.exitDate))}`]);
  const hold = holdMs(t);
  if (hold != null) out.push(["Haltedauer", holdLabel(hold)]);
  const venue = [t.market ? MARKET[t.market] : "", t.exchange ?? "", t.exchangeAccount ?? ""].filter(Boolean).join(" · ");
  if (venue) out.push(["Börse", venue]);
  if (t.qty != null) out.push(["Menge", t.qty.toLocaleString("de-DE", { maximumFractionDigits: 6 })]);
  if (t.fundingFees != null) out.push(["Funding", `${signed(-t.fundingFees)} ${currency}`]);
  if (t.slippage != null) out.push(["Slippage", `${n2(t.slippage)} ${currency}`]);
  if (t.plannedEntry != null) out.push(["Geplant", fmtPrice(t.plannedEntry)]);
  if (t.margin != null) out.push(["Margin", `${n2(t.margin)} ${currency}${t.marginMode ? ` · ${MARGIN[t.marginMode]}` : ""}`]);
  else if (t.marginMode) out.push(["Margin", MARGIN[t.marginMode]]);
  if (t.liqPrice != null) out.push(["Liq.-Preis", fmtPrice(t.liqPrice)]);
  if (t.atrPct != null) out.push(["ATR Einstieg", `${t.atrPct.toFixed(2).replace(".", ",")} %`]);
  return out;
}

/** Fill milestones for the rail (time order). */
export function fillMilestones(t: Pick<Trade, "fills" | "side">): Milestone[] {
  const s = fillStats(t.fills, t.side);
  const partTone = new Map(s.parts.map((p) => [p.id, p.pnl > 0 ? "win" : p.pnl < 0 ? "loss" : "mute"] as const));
  return s.ordered.map((f) => {
    const d = f.at ? new Date(f.at) : null;
    return {
      id: f.id,
      title: FILL_KIND_LABELS[f.kind],
      date: d && !Number.isNaN(+d) ? `${fmtDate(d)} ${fmtTime(d)}` : undefined,
      text: `${fmtPrice(f.price)} × ${f.qty.toLocaleString("de-DE", { maximumFractionDigits: 6 })}`,
      tone: f.side === "open" ? "fg" : (partTone.get(f.id) ?? "mute"),
    };
  });
}

/**
 * Journal-v3 block of the trade detail: execution facts, the fills (position bar cut by every exit + a horizontal
 * milestone rail), MAE / MFE (measure on demand with an honest hint when it cannot be measured here), tags and rating,
 * psyche, screenshots (reel window + lightbox) and the actions `Replay` and `Als Bild`. Every part renders only when
 * the trade has data for it; each is a `StaggerItem` of the detail body cascade.
 */
export function JournalDetail({ trade: t, currency, setups }: JournalDetailProps) {
  const reduced = useReducedFx();
  const provider = useProvider();
  const saveTrade = useJournal((s) => s.saveTrade);
  const [measuring, setMeasuring] = useState(false);
  const [measureNote, setMeasureNote] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const facts = useMemo(() => executionFacts(t, currency), [t, currency]);
  const stats = useMemo(() => (t.fills?.length ? fillStats(t.fills, t.side) : null), [t.fills, t.side]);
  const milestones = useMemo(() => (t.fills?.length ? fillMilestones(t) : []), [t]);
  const psych = t.psych;
  const hasPsych = !!psych && (psych.stress != null || psych.confidence != null || (psych.flags?.length ?? 0) > 0 || !!psych.exitReason || !!psych.preNote || !!psych.postNote);
  const canMeasure = t.status === "closed" && t.mae == null && measurablePair(t.pair, provider);
  const cannot: MeasureStatus | null = t.mae != null ? null : !provider ? "noProvider" : !measurablePair(t.pair, provider) ? "otherPair" : t.status === "closed" && !t.exitDate ? "noExit" : null;

  const measure = async () => {
    setMeasuring(true);
    setMeasureNote(null);
    try {
      const r = await measureAndStore(stripEnrichment(t), { latest: (id) => useJournal.getState().trades.find((x) => x.id === id), save: (next) => saveTrade(next) });
      if (r.status !== "ok") setMeasureNote(MEASURE_HINTS[r.status]);
    } catch {
      setMeasureNote(MEASURE_HINTS.failed);
    } finally {
      setMeasuring(false);
    }
  };

  const share = async () => {
    setSharing(true);
    try {
      const ok = await downloadShareCard(t, { currency, setups, privacy: "percent" });
      pushToast(ok ? { kind: "success", title: "Bild gespeichert", detail: "Ohne Beträge – nur R und %." } : { kind: "error", title: "Bild ging nicht", detail: "Dieser Browser kann kein Bild erzeugen." });
    } finally {
      setSharing(false);
    }
  };

  return (
    <>
      {facts.length > 0 && (
        <StaggerItem>
          <Head label="Ausführung" />
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11.5px] min-[420px]:grid-cols-3">
            {facts.map(([label, value]) => (
              <div key={label} className="flex min-w-0 items-baseline justify-between gap-2 border-b border-line/60 pb-1">
                <dt className="shrink-0 text-faint">{label}</dt>
                <dd className="num truncate whitespace-nowrap font-mono text-fg/85">{value}</dd>
              </div>
            ))}
          </dl>
        </StaggerItem>
      )}

      {stats && stats.openQty > 0 && (
        <StaggerItem className="grid gap-2">
          <Head label="Fills" right={`${stats.ordered.length} · Ø ${fmtPrice(stats.avgEntry)}${stats.avgExit != null ? ` → ${fmtPrice(stats.avgExit)}` : ""}`} />
          <FillsBar stats={stats} />
          {milestones.length > 1 && <MilestoneRail items={milestones} orientation="horizontal" label="Fills der Position" className="-mx-1" />}
          {stats.dca && (
            <p className="text-[11.5px] text-mute">
              DCA mit {stats.dca.entries} Einstiegen: Ø {stats.dca.improvement >= 0 ? "besser" : "schlechter"} als der erste um <span className="font-mono text-fg">{Math.abs(stats.dca.improvement * 100).toFixed(2).replace(".", ",")} %</span>.
            </p>
          )}
        </StaggerItem>
      )}

      {(t.mae != null || canMeasure || cannot === "noExit") && (
        <StaggerItem className="grid gap-2">
          <Head label="MAE / MFE" right={t.atrPct != null ? `ATR ${t.atrPct.toFixed(2).replace(".", ",")} %` : undefined} />
          {t.mae != null ? (
            <ExcursionBar trade={t} />
          ) : (
            <div className="flex flex-wrap items-center gap-2 text-[12px] text-mute">
              {canMeasure ? (
                <motion.button
                  type="button"
                  onClick={() => void measure()}
                  disabled={measuring}
                  whileTap={reduced ? undefined : { scale: 0.96 }}
                  transition={spring.press}
                  className="rounded-full border border-line-2 px-3 py-1.5 text-[12px] text-fg transition-colors hover:border-white/40 disabled:opacity-50 pointer-coarse:min-h-11"
                >
                  {measuring ? "Misst …" : "MAE/MFE messen"}
                </motion.button>
              ) : null}
              <span>{measureNote ?? (cannot ? MEASURE_HINTS[cannot as Exclude<MeasureStatus, "ok">] : "Wie weit lief der Trade gegen und für dich?")}</span>
            </div>
          )}
        </StaggerItem>
      )}

      {((t.tags?.length ?? 0) > 0 || t.rating != null) && (
        <StaggerItem className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1.5" aria-label="Tags">
            {(t.tags ?? []).map((tag) => (
              <span key={tag} className="rounded-full border border-white/20 bg-white/[0.05] px-2.5 py-0.5 text-[11.5px] text-fg/90">
                #{tag}
              </span>
            ))}
          </div>
          {t.rating != null && <RatingDots value={t.rating} size="sm" />}
        </StaggerItem>
      )}

      {hasPsych && psych && (
        <StaggerItem className="grid gap-2">
          <Head label="Psyche" />
          <div className="grid grid-cols-2 gap-2 text-[11.5px]">
            {psych.stress != null && <Pill label="Stress">{`${psych.stress} · ${SCALE_LABELS.stress[psych.stress - 1] ?? ""}`}</Pill>}
            {psych.confidence != null && <Pill label="Zuversicht">{`${psych.confidence} · ${SCALE_LABELS.confidence[psych.confidence - 1] ?? ""}`}</Pill>}
            {psych.exitReason && <Pill label="Exit-Grund">{psych.exitReason}</Pill>}
          </div>
          {(psych.flags?.length ?? 0) > 0 && (
            <div className="flex flex-wrap gap-1.5" aria-label="Verhalten">
              {psych.flags!.map((f) => (
                <span key={f} className="rounded-full border border-loss/35 bg-loss/[0.08] px-2.5 py-0.5 text-[11.5px] text-[#ff8a90]">
                  {BEHAVIOR_LABEL[f as BehaviorKey] ?? f}
                </span>
              ))}
            </div>
          )}
          {(psych.preNote || psych.postNote) && (
            <div className="grid gap-1.5 text-[12.5px] leading-relaxed">
              {psych.preNote && (
                <p>
                  <span className="label mr-2">Vorher</span>
                  <span className="text-fg/85">{psych.preNote}</span>
                </p>
              )}
              {psych.postNote && (
                <p>
                  <span className="label mr-2">Nachher</span>
                  <span className="text-fg/85">{psych.postNote}</span>
                </p>
              )}
            </div>
          )}
        </StaggerItem>
      )}

      {(t.screenshots?.length ?? 0) > 0 && (
        <StaggerItem className="grid gap-2">
          <Head label="Screenshots" right={String(t.screenshots!.length)} />
          <ShotReel shots={t.screenshots!} title={t.pair || "Trade"} />
        </StaggerItem>
      )}

      <StaggerItem className="flex flex-wrap items-center gap-2">
        <ActionButton onClick={() => openReplay(t.id, { fromDetail: true })} icon="M7 5v14l11-7z">
          Replay
        </ActionButton>
        <ActionButton onClick={() => void share()} disabled={sharing} icon="M12 4v11M7 9l5-5 5 5M5 20h14">
          {sharing ? "Erzeugt …" : "Als Bild"}
        </ActionButton>
      </StaggerItem>
    </>
  );
}

function Head({ label, right }: { label: string; right?: string }) {
  return (
    <div className="mb-1.5 flex items-baseline justify-between gap-2 text-[11.5px]">
      <span className="label">{label}</span>
      {right && <span className="truncate font-mono text-mute">{right}</span>}
    </div>
  );
}

function Pill({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 rounded-xl border border-line bg-ink-950/40 px-2.5 py-1.5">
      <div className="label !text-[9.5px]">{label}</div>
      <div className="mt-0.5 truncate text-[12px] text-fg/85">{children}</div>
    </div>
  );
}

function ActionButton({ children, onClick, icon, disabled }: { children: ReactNode; onClick: () => void; icon: string; disabled?: boolean }) {
  const reduced = useReducedFx();
  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={disabled}
      whileTap={reduced || disabled ? undefined : { scale: 0.96 }}
      transition={spring.press}
      className={cn("inline-flex items-center gap-1.5 rounded-full border border-line-2 px-3 py-1.5 text-[12px] font-medium text-fg transition-colors hover:border-white/40 disabled:opacity-50 pointer-coarse:min-h-11")}
    >
      <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d={icon} />
      </svg>
      {children}
    </motion.button>
  );
}
