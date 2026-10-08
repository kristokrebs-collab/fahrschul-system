import { motion, useTransform } from "motion/react";
import { memo, useMemo, useState, type ReactNode } from "react";
import { HYBLOCK_LINK } from "@/domain/defaults";
import { readingAge } from "@/domain/fallingKnife";
import { KNIFE_INFO, KNIFE_INFO_LAGE, KNIFE_LTF_TITLE, KNIFE_TITLE, type KnifeFilter, type KnifeId, type KnifeItem, type Side } from "@/domain/signals";
import type { HyblockReading } from "@/domain/types";
import { cn } from "@/lib/cn";
import { date as fmtDate, n1, signed } from "@/lib/format";
import {
  buildFeedSpecs,
  COHORT_HINT,
  deriveTopTrader,
  freshnessText,
  initialHealth,
  STRINGS,
  topTraderFreshness,
  topTraderHealthSignature,
  useFeed,
  useHealthSelect,
  useProvider,
  useSignalCheck,
  virtualReading,
  type ProviderHealth,
  type StatusLabel,
  type TopTraderBase,
  type TopTraderFreshness,
  type TopTraderView,
} from "@/market";
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
import { VerdictPanel, type VerdictTone } from "@/primitives/VerdictPanel";
import { useJournal, useReadings } from "@/store/journalStore";
import { useUi } from "@/store/uiStore";
import { HyblockForm } from "@/app/overlays";
import { StateLine } from "./signalParts";
import { labelParts, verdictStateLine, verdictText } from "./signalView";
import { TapTooltip } from "./TapTooltip";
import { useMotionSelect } from "./useMarket";

export const TOP_TRADER_TITLE = "Top Trader · Binance";
export const DELTA_HINT =
  "Top-vs-Alle-Delta: Long-Anteil der Top-Trader (Top 20 % nach Margin) minus alle Konten (Binance), Ersatz für Hyblocks Whale-vs-Retail. Der Einstiegs-Check rechnet sein Whale–Retail-Delta mit den Top-Trader-Konten.";
export const READING_DIALOG_TITLE = "Hyblock-Ablesung";
export const DELTA_CANDLES_LABEL = "Δ+ Kerzen";
export const EMPTY_TITLE = "Noch keine Ablesung";
export const EMPTY_TEXT = "Optional: Top-Trader-Long-% und Whale-Delta aus Hyblock als Notiz eintragen. Der Falling-Knife-Filter läuft automatisch aus den Live-Daten des Einstiegs-Checks.";
const SPARK_OPTIONS = [
  { v: "readings", label: "Ablesungen" },
  { v: "live", label: "Live" },
] as const;

type KnifeState = "ok" | "no" | "none";
const KNIFE_BAR: Record<KnifeState, string> = { ok: "bg-win", no: "bg-loss/60", none: "bg-white/10" };
const KNIFE_STATES: KnifeState[] = ["none", "no", "ok"];

const EMPTY_HEALTH: ProviderHealth = initialHealth(buildFeedSpecs("1h"));

/**
 * Top-trader view + freshness without the global version counter: re-derives when one of the ratio series (chosen
 * period and the 5-min live twins) publishes or a health field the card reads changes – never on price ticks.
 */
function useTopTraderLive(base: TopTraderBase): { tt: TopTraderView; fresh: TopTraderFreshness } {
  const provider = useProvider();
  const health = useHealthSelect(topTraderHealthSignature);
  const topAccountRatio = useFeed("topAccountRatio");
  const topPositionRatio = useFeed("topPositionRatio");
  const globalAccountRatio = useFeed("globalAccountRatio");
  const takerRatio = useFeed("takerRatio");
  const topAccountRatio5m = useFeed("topAccountRatio5m");
  const topPositionRatio5m = useFeed("topPositionRatio5m");
  const globalAccountRatio5m = useFeed("globalAccountRatio5m");
  return useMemo(() => {
    const h = provider?.getHealth() ?? EMPTY_HEALTH;
    const tt = deriveTopTrader({ topAccountRatio, topPositionRatio, globalAccountRatio, takerRatio, topAccountRatio5m, topPositionRatio5m, globalAccountRatio5m }, h, base);
    // cadence of the chosen-period series (a test double may come without `specs`)
    const periodMs = provider?.specs?.topAccountRatio?.cadenceMs;
    return { tt, fresh: topTraderFreshness(tt, h, periodMs) };
    // `health` is the change signal for the health object read from the provider
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, health, topAccountRatio, topPositionRatio, globalAccountRatio, takerRatio, topAccountRatio5m, topPositionRatio5m, globalAccountRatio5m, base]);
}

const FRESH_TONE: Record<StatusLabel["tone"], string> = { live: "text-faint", muted: "text-faint", warn: "text-warn", error: "text-loss" };

/**
 * Card note: what the numbers are and how fresh – `Binance liefert alle 5 min neu · Stand 14:05 · nächste Daten in
 * 3:12`, `Binance antwortet nicht (Netzwerk/CORS) · Stand 13:55 · neuer Versuch in 0:28`, `Binance blockiert (Region)`.
 * The countdown runs on the shared second clock (no React render per second).
 */
export const FreshnessNote = memo(function FreshnessNote({ f }: { f: TopTraderFreshness }) {
  const now = useNowMv();
  const text = useTransform(now, (n) => freshnessText(f, n));
  return (
    <motion.span data-testid="top-trader-freshness" data-kind={f.kind} title={f.detail} className={cn("transition-colors duration-300", FRESH_TONE[f.tone])}>
      {text}
    </motion.span>
  );
});

/** `Stand`: reading age (`vor 12 min`, `vor 3 h`, else the date) on the shared second clock; only the 12-h warn flip re-renders. */
const StandAge = memo(function StandAge({ at }: { at: string }) {
  const now = useNowMv();
  const text = useTransform(now, (n) => readingAge(at, n).label || fmtDate(new Date(at)));
  const sources = useMemo(() => [now], [now]);
  const warn = useMotionSelect(sources, () => readingAge(at, now.get()).warn);
  return <motion.div className={cn("num mt-0.5 font-mono text-[14px] transition-colors duration-300", warn && "text-warn")}>{text}</motion.div>;
});

/**
 * The Falling-Knife segments (one per point): grey / red crossfade, a fulfilled point fills from the left; changes
 * cascade left to right (`stagger.reveal`).
 */
const KnifeBars = memo(function KnifeBars({ states }: { states: string }) {
  return (
    <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${Math.max(1, states.length)}, minmax(0, 1fr))` }}>
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

/* ------------------------------------------------------------------ falling-knife filter (decision 11) */

/** Where each point comes from — the same module as in the Einstiegs-Check (single source of truth). */
export const KNIFE_SOURCE: Readonly<Record<KnifeId, string>> = {
  lage: "Lage-Ampel · 2 Tagesschlüsse unter der 1D-EMA 21 = Abwärtstrend · dieselbe Sperre wie im Einstiegs-Check",
  signs: "Lage-Ampel · Kurs > 1D-EMA 21 · 4H > EMA 21 · 4H-EMA 21 > 50 · 4H-Struktur hoch",
  structure: "Marktstruktur 1H/4H · dieselbe wie Support / Widerstand im Einstiegs-Check",
  divergence: "Divergenzen · dieselben wie im Einstiegs-Check",
  whale: "Top-Trader-Kombi · Whale–Retail-Delta = Top-Trader-Konten minus alle Konten (Long-%) · Binance-5-min-Daten wie im Einstiegs-Check",
};
export const KNIFE_WAITING = "Wartet auf die Live-Daten des Einstiegs-Checks …";

/** Card line under the bars. */
export function knifeLine(k: KnifeFilter | null): string {
  if (!k || !k.data) return KNIFE_WAITING;
  if (k.ltf) {
    // Lage layout (decision 23): point 1 is the gate
    const trend = k.items.find((i) => i.id === "lage");
    if (trend?.met) return k.all ? "Tagestrend steht, 4H dreht hoch: kein fallendes Messer." : "Tagestrend steht: Kaufsignale zählen.";
    return k.n > 0 ? "Abwärtstrend, Umkehr bildet sich: noch abwarten." : "Fällt noch: abwarten statt kaufen.";
  }
  if (k.all) return k.side === "long" ? "Kein fallendes Messer: Makro-Long abgesichert." : "Kein steigendes Messer: Makro-Short abgesichert.";
  if (k.n === 0) return k.side === "long" ? "Fallendes Messer möglich: beobachten statt kaufen." : "Steigendes Messer möglich: beobachten statt shorten.";
  return `${k.label} · Tippen für Details`;
}

/** Tone of the count / verdict: all met = win, none = loss, some = warn, no data = mute. */
export function knifeTone(k: KnifeFilter | null): VerdictTone {
  if (!k || !k.data) return "mute";
  return k.all ? "win" : k.n === 0 ? "loss" : "warn";
}

const TONE_TEXT: Record<VerdictTone, string> = { win: "text-win", loss: "text-loss", warn: "text-warn", mute: "text-faint" };

function knifeVerdict(k: KnifeFilter): string {
  if (k.ltf) {
    const trend = k.items.find((i) => i.id === "lage");
    if (trend?.met) return "Lage grün: kein Abwärtstrend im Tageschart – Kaufsignale des Einstiegs-Checks zählen. Die 4H-Zeichen zeigen, wie fest die Erholung ist.";
    return k.n > 0
      ? "Lage gelb: der Tagestrend ist noch abwärts, auf 4H bilden sich Umkehr-Zeichen – Kaufsignale zählen noch nicht (an der Historie: halb so oft ein fallendes Messer wie ohne Zeichen, aber noch zu oft)."
      : "Lage rot: Abwärtstrend ohne Umkehr-Zeichen – fallendes Messer. Kaufsignale zählen nicht; auf den ersten Tagesschluss über der 1D-EMA 21 warten.";
  }
  const what = k.side === "long" ? "Makro-Long" : "Makro-Short";
  if (k.all) return `Alle ${k.total} Punkte erfüllt: Filter frei – der ${what} ist abgesichert. Auslöser bleibt der Einstiegs-Check.`;
  if (k.n === 0) return `Kein Punkt erfüllt: ${k.side === "long" ? "fallendes" : "steigendes"} Messer möglich – beobachten statt handeln.`;
  return `${k.label}: noch keine Absicherung für einen ${what} – weiter beobachten.`;
}

/** Falling-knife card (inside the Top-Trader card): reads the live check itself, so only it re-renders (≤ 1/s). */
const KnifeCard = memo(function KnifeCard({ open, body }: { open: boolean; body: () => ReactNode }) {
  const snap = useSignalCheck().snapshot;
  const k = snap?.knife?.long ?? null;
  // the counted points (Lage layout: Tagestrend + 4H signs; the Top-Trader delta is info only and has no bar)
  const states = k ? k.items.filter((i) => !i.info).map((i) => (i.met ? "o" : i.met === false ? "x" : "-")).join("") : "---";
  const tone = knifeTone(k);
  return (
    <MorphCard id="falling-knife" title={KNIFE_TITLE} className="rounded-2xl border border-line-2 bg-ink-950/25 p-3.5 hover:border-white/30" body={body}>
      <div className="mb-2.5 flex items-center justify-between gap-2" data-testid="knife-card" data-n={k?.n ?? ""} data-tone={tone}>
        <MorphTitle id="falling-knife" as="span" className="label !text-fg">
          {KNIFE_TITLE}
        </MorphTitle>
        <motion.span
          layout="position"
          layoutId="morph-fk-count"
          layoutDependency={`${k?.n ?? -1}|${open}`}
          style={{ borderRadius: 0 }}
          className={cn("dot-num text-[18px] transition-colors duration-300", TONE_TEXT[tone])}
        >
          {k ? <MotionNumber value={k.n} /> : "–"}/{k?.total ?? 3}
        </motion.span>
      </div>
      <KnifeBars states={states} />
      <p className={cn("mt-2.5 text-[12px] transition-colors duration-300", tone === "mute" ? "text-mute" : TONE_TEXT[tone])}>{knifeLine(k)}</p>
    </MorphCard>
  );
});

const ITEM_MARK: Record<"ok" | "no" | "none", { mark: string; cls: string; sr: string }> = {
  ok: { mark: "✓", cls: "bg-win/20 text-win", sr: "erfüllt: " },
  no: { mark: "✕", cls: "bg-loss/15 text-loss", sr: "offen: " },
  none: { mark: "–", cls: "bg-white/[0.06] text-faint", sr: "keine Daten: " },
};

/** Keeps a value with its unit and a window with its change together (`−3,7 pp`, `1h −6,7`): a narrow row never splits them. */
const keepValues = (text: string): string => text.replace(/(\d) (pp|%)/g, "$1\u00a0$2").replace(/(\d+[mh]) (?=[−+±])/g, "$1\u00a0");

/** Marks of a point that does not count (Top-Trader delta as info, the 30m/1H signs in the Lage layout): no ✕ in red. */
const INFO_MARK: Record<"ok" | "no" | "none", { mark: string; cls: string; sr: string }> = {
  ok: { mark: "✓", cls: "bg-white/[0.1] text-fg", sr: "an (zählt nicht): " },
  no: { mark: "·", cls: "bg-white/[0.06] text-faint", sr: "aus (zählt nicht): " },
  none: { mark: "–", cls: "bg-white/[0.06] text-faint", sr: "keine Daten: " },
};

function KnifeRow({ item, info }: { item: KnifeItem; info?: boolean }) {
  const st = item.met ? "ok" : item.met === false ? "no" : "none";
  const m = (info ?? item.info) ? INFO_MARK[st] : ITEM_MARK[st];
  return (
    <li
      className="grid grid-cols-[auto_minmax(0,1fr)] gap-3 rounded-xl border border-line bg-ink-950/40 px-3 py-2.5"
      data-testid="knife-item"
      data-id={item.id}
      data-met={item.met === null ? "none" : String(item.met)}
      data-info={(info ?? item.info) ? "" : undefined}
    >
      <span aria-hidden="true" className={cn("mt-px grid size-5 place-items-center rounded-full text-[11px] font-bold", m.cls)}>
        {m.mark}
      </span>
      <span className="grid min-w-0 gap-1">
        <span className={cn("text-[13px] font-semibold leading-snug", st === "ok" ? "text-fg" : "text-mute")}>
          <span className="sr-only">{m.sr}</span>
          {item.label}
        </span>
        <span className="text-[12px] leading-snug text-mute">{item.id === "whale" ? keepValues(item.detail) : item.detail}</span>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-faint">
          {item.tfs.map((tf) => (
            <span key={tf} className="num rounded-md border border-win/30 px-1.5 py-px font-mono text-[10.5px] text-win">
              {tf}
            </span>
          ))}
          <span>{KNIFE_SOURCE[item.id]}</span>
        </span>
      </span>
    </li>
  );
}

const KNIFE_SIDES = [
  { v: "long", label: "Long" },
  { v: "short", label: "Short" },
] as const;
const KNIFE_SIDE_TONES = { long: "!border-win/30", short: "!border-loss/30" } as const;

/**
 * Dialog body: what the filter is (safety check for macro trades vs. the Einstiegs-Check as the trigger, same live
 * data), the three automatic points with their detail and source, the verdict, the Einstiegs-Check's own state for
 * the same side, and the latest manual Hyblock reading as an optional note (it does not count).
 */
export function KnifeExplain({ reading }: { reading: HyblockReading | null }) {
  const snap = useSignalCheck().snapshot;
  const [side, setSide] = useState<Side>("long");
  const k = snap?.knife?.[side] ?? null;
  const v = snap ? snap[side] : null;
  const tone = knifeTone(k);
  return (
    <div className="grid gap-4" data-testid="knife-explain">
      <p className="max-w-[70ch] text-[13px] leading-relaxed text-mute">{k?.ltf ? KNIFE_INFO_LAGE : KNIFE_INFO}</p>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented<Side> size="sm" aria-label="Richtung des Filters" options={KNIFE_SIDES} value={side} onChange={setSide} tones={KNIFE_SIDE_TONES} />
        <span className={cn("dot-num text-[18px]", TONE_TEXT[tone])} data-testid="knife-count">
          {k ? `${k.n}/${k.total}` : "–/3"}
        </span>
      </div>
      {!k ? (
        <p className="text-[12.5px] text-mute">{KNIFE_WAITING}</p>
      ) : (
        <>
          <ul className="grid gap-2" aria-label="Punkte des Filters">
            {k.items.map((it) => (
              <KnifeRow key={it.id} item={it} />
            ))}
          </ul>
          <VerdictPanel tone={tone} className="text-[12.5px]">
            {knifeVerdict(k)}
          </VerdictPanel>
          {k.ltf && k.ltf.length > 0 && (
            <div className="grid gap-2" data-testid="knife-ltf">
              <span className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-faint">{KNIFE_LTF_TITLE}</span>
              <ul className="grid gap-2" aria-label={KNIFE_LTF_TITLE}>
                {k.ltf.map((it) => (
                  <KnifeRow key={it.id} item={it} info />
                ))}
              </ul>
            </div>
          )}
        </>
      )}
      {snap && v && (
        <div className="grid gap-1 rounded-xl border border-line-2 bg-white/[0.02] px-3 py-2.5" data-testid="knife-trigger">
          <span className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-mute">Einstiegs-Check · Auslöser</span>
          <span className={cn("text-[13px] font-semibold leading-snug", verdictText(v))}>
            {labelParts(v.label).prefix && <span className="sr-only">{labelParts(v.label).prefix}</span>}
            {labelParts(v.label).text}
            <span className="num ml-2 font-mono text-[12px] font-normal text-mute">Score {v.score}</span>
          </span>
          <StateLine line={verdictStateLine(snap, v, snap.cfg)} side={side} />
        </div>
      )}
      {reading && (
        <div className="grid gap-1 rounded-xl border border-dashed border-line-2 px-3 py-2.5 text-[12px] leading-snug" data-testid="knife-reading">
          <span className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-faint">Deine Ablesung · Notiz, zählt nicht</span>
          <span className="num text-mute">
            Long {n1(reading.longPct)} % · Delta {signed(reading.delta, 1)} · {reading.deltaCandles} {reading.deltaCandles === 1 ? "Kerze" : "Kerzen"} · Struktur {reading.structure ? "✓" : "–"} · RSI {reading.rsi ? "✓" : "–"}
          </span>
          <span className="text-[11px] text-faint">
            {readingAge(reading.at).label || fmtDate(new Date(reading.at))}
            {reading.note ? ` · ${reading.note}` : ""}
          </span>
        </div>
      )}
    </div>
  );
}

/** Stable array identity for equal values (the sparkline restarts its morph on every new array). */
function useStableValues(values: readonly number[]): readonly number[] {
  const key = values.join(",");
  return useMemo(() => (key ? key.split(",").map(Number) : []), [key]);
}

/**
 * `Top Trader · Binance` (Bundle `w2` with Binance as the data source, Plan 4.8 / 6.1): Long % (accounts or
 * positions per `tj2-ui.topTraderBase`), second value, `Top vs. Alle` delta, `Δ+ Kerzen`, `Stand`, sparkline
 * (`Ablesungen | Live`), Falling-Knife card → dialog, footer with `Letzte löschen` / `Hyblock ↗`.
 * The Falling-Knife-Filter (decision 11) runs LIVE from the Einstiegs-Check's evaluation (`snapshot.knife`: market
 * structure 1H/4H, RSI divergence, Top-Trader-Kombi on 5-min data — the former support-zone point is gone); manual
 * Hyblock readings are an optional note. Re-renders only when a ratio series publishes or its health changes – never
 * per trade or kline tick; the knife card follows the published check (≤ 1/s) on its own. `Stand` ages on the clock.
 */
export function TopTraderCard() {
  const deleteHyblock = useJournal((s) => s.deleteHyblock);
  const readings = useReadings();
  const base = useUi((s) => s.topTraderBase);
  const spark = useUi((s) => s.sparkline);
  const setPref = useUi((s) => s.setPref);
  const pushToast = useUi((s) => s.pushToast);
  const { tt, fresh } = useTopTraderLive(base);
  const { open, close } = useMorphDialog();
  const [confirm, setConfirm] = useState(false);

  const last = readings[readings.length - 1];
  const prev = readings[readings.length - 2];
  const virtual = virtualReading(tt, last);
  const current: HyblockReading | undefined = virtual ?? last;
  const previous = virtual ? last : prev;
  const rising = current && previous ? current.longPct > previous.longPct : null;
  const note = <FreshnessNote f={fresh} />;
  const otherBase = base === "positions" ? tt.longPctAccounts : tt.longPctPositions;
  const sparkValues = useStableValues(spark === "live" && !tt.onlyBinance ? tt.sparkline : readings.slice(-20).map((r) => r.longPct));
  const knifeOpen = open?.id === "falling-knife";
  // the manual reading (not the virtual live one) is the optional note of the filter
  const knifeBody = () => <KnifeExplain reading={last ?? null} />;

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
                  <Badge tone="mute" title={fresh.detail ?? COHORT_HINT.bybit}>
                    {STRINGS.onlyBinance}
                  </Badge>
                )}
              </div>
              <div className="dot-num mt-1 flex items-baseline gap-2 text-[38px] leading-none">
                <MotionNumber value={current.longPct} decimals={1} flash />
                {rising != null && (
                  <motion.span key={String(rising)} initial={{ y: rising ? 6 : -6, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={spring.smooth} className={cn("font-mono text-sm", rising ? "text-win" : "text-loss")}>
                    {rising ? "▲" : "▼"}
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

          <KnifeCard open={knifeOpen} body={knifeBody} />

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
        <div className="grid gap-4">
          <EmptyState
            title={EMPTY_TITLE}
            text={EMPTY_TEXT}
            action={
              <a href={HYBLOCK_LINK} target="_blank" rel="noreferrer" className="touch-hit label mt-2 !text-fg hover:underline">
                Hyblock öffnen ↗
              </a>
            }
          />
          <KnifeCard open={knifeOpen} body={knifeBody} />
        </div>
      )}
    </Card>
  );
}
