/**
 * Read-only views of a stored / computed "Einstiegs-Check" snapshot (`trade.signal`, see `@/domain/signals`): the
 * summary box of the trade editor and the trade detail, the compact strength bars of the trades table / cards, and
 * the mistake chips of the detail. Pure presentation – no data access, no timers.
 */
import { motion, useTransform } from "motion/react";
import { memo } from "react";
import {
  isStrongKind,
  KNIFE_TITLE,
  kindText,
  parseSignalSnapshot,
  ppText,
  PROVISIONAL_PREFIX,
  provisionalText,
  snapshotLadderLength,
  snapshotState,
  STATE_TEXT,
  strengthLine,
  strengthText,
  TRADERS_SIDE_TITLE,
  WHALE_NO_DATA,
  WHALE_NO_DATA_HINT,
  WHALE_TITLE,
  ZONE_TEXT,
  type Side,
  type SignalSnapshot,
  type SignalSnapshotPart,
  type SignalState,
} from "@/domain/signals";
import { cn } from "@/lib/cn";
import { dateTime, n1 } from "@/lib/format";
import { useNowMv } from "@/motion/clock";
import { spring, stagger, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";

/** Valid long / short → win / loss (as the overview's Einstiegs-Check card), otherwise neutral grey. */
export function signalTone(s: Pick<SignalSnapshot, "valid" | "side">): { text: string; dot: string; on: string } {
  if (!s.valid) return { text: "text-fg", dot: "bg-fg/80", on: "border-white/25 bg-white/[0.05]" };
  return s.side === "long" ? { text: "text-win", dot: "bg-win", on: "border-win/35 bg-win/[0.07]" } : { text: "text-loss", dot: "bg-loss", on: "border-loss/35 bg-loss/[0.07]" };
}

/** Where the snapshot came from, as a short German tag. */
export function snapshotSource(s: Pick<SignalSnapshot, "mode" | "at">): string {
  const at = dateTime(new Date(s.at));
  if (s.mode === "live") return `live beim Eintragen · ${at}`;
  if (s.mode === "retro") return `aus Binance-Kerzen nachgerechnet · ${at}`;
  return `gespeichert · ${at}`;
}

/** The stored snapshot of a trade (`trade.signal`, either app's format) or null. */
export function tradeSignal(t: { signal?: unknown }): SignalSnapshot | null {
  return parseSignalSnapshot(t.signal);
}

/** Four strength dots (`Stärke n von 4`); filled dots pop in once (`spring.pop`, staggered). */
export const StrengthDots = memo(function StrengthDots({ strength, dot, className, variant = "solid" }: { strength: number; dot: string; className?: string; variant?: "solid" | "provisional" }) {
  const reduced = useReducedFx();
  const prov = variant === "provisional";
  return (
    <span className={cn("flex gap-1", className)} role="img" aria-label={prov ? `Stärke ${strength} von 4 bei Kerzenschluss (vorläufig)` : `Stärke ${strength} von 4`}>
      {[1, 2, 3, 4].map((i) => (
        <span key={i} className="relative size-2 rounded-full bg-white/[0.12]" aria-hidden="true">
          <motion.span
            className={cn("absolute inset-0 rounded-full", prov ? cn("border bg-ink-950", dot) : dot)}
            initial={false}
            animate={{ opacity: i <= strength ? 1 : 0, scale: i <= strength ? 1 : 0.4 }}
            transition={reduced ? { duration: 0 } : { opacity: tween.fade, scale: { ...spring.pop, delay: (i - 1) * stagger.reveal } }}
          />
        </span>
      ))}
    </span>
  );
});

/**
 * Compact signal-strength glyph for the trades table / cards: four rising bars (`Signal-Stärke 2 von 4`), filled in
 * the snapshot's tone; a provisional entry (base candle still forming at the check) shows the strength it would have
 * got on the close as outlined soft bars; a dash when the trade has no stored check. Static (rows never animate per
 * cell).
 */
export function StrengthBars({ snap, className }: { snap: (Pick<SignalSnapshot, "strength" | "valid" | "side"> & Partial<Pick<SignalSnapshot, "state" | "provStrength">>) | null; className?: string }) {
  if (!snap) {
    return (
      <span className={cn("inline-flex h-2.5 w-[19px] items-end justify-center text-[10px] leading-none text-faint", className)} role="img" aria-label="Kein Einstiegs-Check gespeichert">
        <span aria-hidden="true">·</span>
      </span>
    );
  }
  const prov = snap.state === "provisional";
  const tone = signalTone(snap);
  const n = prov ? (snap.provStrength ?? 0) : snap.strength;
  const label = prov ? `Signal vorläufig, Stärke ${n} von 4 bei Kerzenschluss` : `Signal-Stärke ${snap.strength} von 4 (${strengthText(snap.strength)})`;
  return (
    <span className={cn("inline-flex h-2.5 items-end gap-[2px]", className)} role="img" aria-label={label} data-strength={snap.strength} data-state={snap.state}>
      {[1, 2, 3, 4].map((i) => (
        <span
          key={i}
          aria-hidden="true"
          className={cn("w-[3px] rounded-[1px]", i > n ? "bg-white/[0.14]" : prov ? cn("border", SOFT[snap.side].ring) : tone.dot)}
          style={{ height: `${3 + i * 1.75}px` }}
        />
      ))}
    </span>
  );
}

export interface SignalSummaryProps {
  snap: SignalSnapshot;
  /** Side of the trade: a snapshot taken for the other side is labelled as such. */
  side?: "long" | "short";
  /**
   * Close (ms) of the forming base candle while a LIVE provisional entry is shown (editor live view): the state chip
   * counts down `vorläufig · schließt in mm:ss` on the shared clock. Stored snapshots have none.
   */
  closesAt?: number | null;
  className?: string;
}

/** Soft (~50 % saturation) tones of a provisional signal (decision 9), as in the chart. */
const SOFT = {
  long: { text: "text-[#65b488]", dot: "bg-[#65b488]", ring: "border-[#65b488]", on: "border-dashed border-[#65b488]/45 bg-[#65b488]/[0.05]" },
  short: { text: "text-[#d2797a]", dot: "bg-[#d2797a]", ring: "border-[#d2797a]", on: "border-dashed border-[#d2797a]/45 bg-[#d2797a]/[0.05]" },
} as const;

/** The verdict label without the stored `Vorläufig: ` prefix (the state chip says it). */
const plainLabel = (label: string): string => (label.startsWith(PROVISIONAL_PREFIX) ? label.slice(PROVISIONAL_PREFIX.length) : label);

/**
 * Score, verdict label + candle-close state (`⚠ vorläufig` / `bestätigt` / `stark bestätigt`), strength
 * (`{Stärke} · {tiers} von {n} Timeframes`; a provisional entry shows the strength it gets on the close, outlined),
 * one pill per timeframe (`30m · Bottom · RSI 38,2`, toned while it confirms the ladder, `· vorläufig` dashed on a
 * forming candle, `· stark`), the zone pill, the legacy "Top-Trader kaufen · Retail rot" pill of older snapshots, the
 * graded parts stored with v2 snapshots (Top-Trader-Kombi, Divergenz, Support / Widerstand) and the falling-knife
 * filter; the source line says whether the check was taken live, recomputed from history or comes from the other
 * journal version.
 */
export function SignalSummary({ snap, side, closesAt, className }: SignalSummaryProps) {
  const tone = signalTone(snap);
  const n = snapshotLadderLength(snap);
  const otherSide = side && snap.side !== side;
  const state = snapshotState(snap);
  const provisional = state === "provisional";
  const soft = SOFT[snap.side];
  const shownStrength = provisional ? (snap.provStrength ?? 0) : snap.strength;
  return (
    <div
      className={cn("@container grid gap-3 rounded-2xl border border-line bg-ink-950/50 p-3.5", className)}
      data-testid="signal-summary"
      data-strength={snap.strength}
      data-state={state ?? undefined}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-baseline gap-1" aria-label={`Score ${snap.score} von 100`} role="img">
          <span className="dot-num text-[26px] leading-none text-fg" aria-hidden="true">
            {snap.score}
          </span>
          <span className="font-mono text-[11px] text-faint" aria-hidden="true">
            /100
          </span>
        </div>
        <div className="grid min-w-0 gap-1">
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className={cn("text-[14.5px] font-semibold leading-tight", provisional ? soft.text : tone.text)}>{plainLabel(snap.label)}</span>
            {state && state !== "none" && <StateChip state={state} side={snap.side} closesAt={provisional ? closesAt : null} />}
          </span>
          <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <StrengthDots strength={shownStrength} dot={provisional ? soft.ring : tone.dot} variant={provisional ? "provisional" : "solid"} />
            <span className="text-[11.5px] text-mute">
              {strengthLine(shownStrength, snap.tiers, n)}
              {provisional && " · bei Kerzenschluss"}
            </span>
          </span>
        </div>
      </div>
      {(snap.tfs.length > 0 || snap.zone) && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Timeframes">
          {snap.tfs.map((tf, i) => {
            const ok = tf.ok ?? i < snap.tiers;
            const prov = tf.state === "provisional";
            const strong = tf.state === "strong";
            return (
              <li
                key={`${tf.tf}-${i}`}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[11px]",
                  ok ? (prov ? cn(soft.on, "text-fg") : cn(tone.on, "text-fg")) : prov ? "border-dashed border-line-2 text-mute" : "border-line text-mute",
                )}
                data-state={tf.state}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "size-1.5 shrink-0 rounded-full",
                    !tf.kind
                      ? "bg-white/20"
                      : prov
                        ? cn("border", soft.ring)
                        : isStrongKind(tf.kind)
                          ? ok
                            ? tone.dot
                            : "bg-fg/60"
                          : "border border-current",
                    strong && ok && "ring-1 ring-current ring-offset-1 ring-offset-ink-950",
                  )}
                />
                {tf.tf} · {kindText(tf.kind)}
                {Number.isFinite(tf.rsi) ? ` · RSI ${n1(tf.rsi)}` : ""}
                {prov ? " · vorläufig" : strong ? " · stark" : ""}
              </li>
            );
          })}
          <li className={cn("inline-flex items-center rounded-full border px-2.5 py-1 font-mono text-[11px]", snap.zoneOk ? cn(tone.on, "text-fg") : "border-line text-mute")}>
            Zone {snap.zone ? ZONE_TEXT[snap.zone] : "–"}
          </li>
          {snap.whale !== undefined && <WhalePill snap={snap} on={tone.on} />}
        </ul>
      )}
      {(snap.parts?.length || snap.knife) && <SnapshotParts snap={snap} />}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-faint">
        <span>{snapshotSource(snap)}</span>
        {otherSide && <span className="text-mute">· geprüft für {snap.side === "long" ? "Long" : "Short"}</span>}
      </div>
    </div>
  );
}

/** `⚠ vorläufig · schließt in 12:04` (live, on the shared clock) / `⚠ vorläufig` / `bestätigt` / `stark bestätigt`. */
export function StateChip({ state, side, closesAt }: { state: SignalState; side: Side; closesAt?: number | null }) {
  const provisional = state === "provisional";
  const soft = SOFT[side];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 font-mono text-[10.5px] leading-4",
        provisional ? cn("border-dashed", soft.ring, soft.text) : state === "strong" ? "border-white/30 text-fg" : "border-line-2 text-mute",
      )}
      data-testid="signal-summary-state"
      data-state={state}
    >
      {provisional && <span aria-hidden="true">⚠</span>}
      {provisional && closesAt != null && Number.isFinite(closesAt) ? <Countdown closesAt={closesAt} /> : STATE_TEXT[state]}
    </span>
  );
}

/** The countdown text of a forming candle: a MotionValue on the shared clock (no React render per second). */
function Countdown({ closesAt }: { closesAt: number }) {
  const now = useNowMv();
  const text = useTransform(now, (t) => provisionalText(closesAt - t));
  return <motion.span className="tabular-nums">{text}</motion.span>;
}

// ------------------------------------------------------------------ graded parts of a v2 snapshot

const fmt0 = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 });
const fmt1 = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const p0 = (x: number): string => fmt0.format(x).replace("-", "−");
const p1 = (x: number): string => fmt1.format(x).replace("-", "−");
const NO_DATA = "keine Daten";
const OSC_TEXT = { rsi: "RSI", wt: "WT" } as const;
const DIV_KIND_TEXT = { regular: "regulär", hidden: "versteckt" } as const;

export interface PartRow {
  id: string;
  label: string;
  value: string;
  /** lit / unlit; `null` = keine Daten */
  met: boolean | null;
  provisional?: boolean;
}
export interface PartView {
  id: string;
  title: string;
  /** right-aligned summary (`3 von 4 · +7,5 Punkte`, `1h · +8,0 Punkte`, `2,3 R`) */
  detail: string;
  /** the part held fully */
  ok: boolean;
  data: boolean;
  provisional: boolean;
  rows: PartRow[];
}

const pointsText = (p: SignalSnapshotPart): string => (p.weight > 0 ? `${p.points > 0 ? "+" : "±"}${p1(p.points)} Punkte` : "zählt nicht");
const partItem = (p: SignalSnapshotPart, id: string) => p.items.find((i) => i.id === id);

/** The stored parts in German rows (pure; values are formatted from the stored raw numbers). */
export function snapshotPartViews(snap: Pick<SignalSnapshot, "side" | "parts" | "zone">): PartView[] {
  const long = snap.side === "long";
  const out: PartView[] = [];
  for (const p of snap.parts ?? []) {
    if (p.id === "traders") {
      const share = (raw: number | null | undefined): string => (raw == null ? NO_DATA : `${p1(long ? raw : 100 - raw)} % ${long ? "Long" : "Short"}`);
      const pos = partItem(p, "pos");
      const acc = partItem(p, "acc");
      const retail = partItem(p, "retail");
      const zone = partItem(p, "zone");
      out.push({
        id: "traders",
        title: TRADERS_SIDE_TITLE[snap.side],
        detail: p.data ? `${p.met ?? 0} von 4 · ${pointsText(p)}` : NO_DATA,
        ok: p.ok,
        data: p.data,
        provisional: false,
        rows: [
          { id: "pos", label: "Top-Trader Positionen", value: share(pos?.raw), met: pos?.met ?? null },
          { id: "acc", label: "Top-Trader Konten", value: share(acc?.raw), met: acc?.met ?? null },
          { id: "retail", label: `Retail ${long ? "rot" : "grün"}${p.period ? ` (${p.period})` : ""}`, value: retail?.raw == null ? NO_DATA : ppText(retail.raw), met: retail?.met ?? null },
          {
            id: "zone",
            label: `Preis im ${long ? "Discount" : "Premium"}`,
            value: zone?.raw == null ? NO_DATA : `${snap.zone ? ZONE_TEXT[snap.zone] : "Zone"} · ${p0(zone.raw * 100)} %`,
            met: zone?.met ?? null,
          },
        ],
      });
    } else if (p.id === "div") {
      const hits = p.hits ?? [];
      const rows: PartRow[] = p.items.map((it) => {
        const own = hits.filter((h) => h.tf === it.id);
        const seen: string[] = [];
        for (const h of own) {
          const t = `${OSC_TEXT[h.osc]} ${DIV_KIND_TEXT[h.kind]}`;
          if (!seen.includes(t)) seen.push(t);
        }
        const prov = own.length > 0 && own.every((h) => h.state === "provisional");
        return { id: it.id, label: it.id, value: it.met == null ? NO_DATA : seen.length ? `${seen.join(" · ")}${prov ? " · vorläufig" : ""}` : "keine", met: it.met, provisional: prov };
      });
      out.push({
        id: "div",
        title: long ? "Bullische Divergenz" : "Bärische Divergenz",
        detail: !p.data ? NO_DATA : p.tf ? `${p.tf} · ${pointsText(p)}` : "keine Divergenz",
        ok: p.ok,
        data: p.data,
        provisional: p.state === "provisional",
        rows,
      });
    } else if (p.id === "sr") {
      const near = partItem(p, "near");
      const room = partItem(p, "room");
      const lean = p.lean;
      const target = p.target;
      const r = p.r;
      out.push({
        id: "sr",
        title: long ? "Support + Platz nach oben" : "Widerstand + Platz nach unten",
        detail: !p.data ? NO_DATA : `${p.free ? "Platz frei" : r != null ? `${p1(r)} R` : "kein Stop"} · ${pointsText(p)}`,
        ok: p.ok,
        data: p.data,
        provisional: false,
        rows: [
          {
            id: "near",
            label: long ? "Am Support / Demand" : "Am Widerstand / Supply",
            value: !p.data ? NO_DATA : lean ? `${lean.label} ${p0(lean.price)} · ${p1(lean.distAtr)} ATR` : long ? "kein Support darunter" : "kein Widerstand darüber",
            met: near?.met ?? null,
          },
          {
            id: "room",
            label: `Platz bis ${long ? "Widerstand" : "Support"}`,
            value: !p.data ? NO_DATA : p.free ? `frei (kein ${long ? "Widerstand" : "Support"})` : target && r != null ? `${target.label} ${p0(target.price)} · ${p1(r)} R` : "–",
            met: room?.met ?? null,
          },
        ],
      });
    }
  }
  return out;
}

/** Falling-knife items of a snapshot (short labels; long = HL/BOS, short mirrored). */
export function knifeRows(snap: Pick<SignalSnapshot, "side" | "knife">): PartRow[] {
  const long = snap.side === "long";
  const label: Record<string, string> = {
    structure: long ? "Higher Low / BOS 1H·4H" : "Lower High / BOS 1H·4H",
    divergence: long ? "RSI bullische Divergenz" : "RSI bärische Divergenz",
    whale: "Whale vs. Retail",
  };
  return (snap.knife?.items ?? []).map((i) => ({ id: i.id, label: label[i.id] ?? i.id, value: i.met == null ? NO_DATA : i.met ? "erfüllt" : "offen", met: i.met }));
}

/** Lit / unlit / no-data marker of a part row. */
function RowDot({ met, side, provisional }: { met: boolean | null; side: Side; provisional?: boolean }) {
  if (met == null) return <span aria-hidden="true" className="h-px w-2 shrink-0 bg-faint" />;
  if (!met) return <span aria-hidden="true" className="size-2 shrink-0 rounded-full border border-line-2" />;
  return <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full", provisional ? cn("border", SOFT[side].ring) : side === "long" ? "bg-win" : "bg-loss")} />;
}

const metWord = (m: boolean | null): string => (m == null ? "keine Daten: " : m ? "erfüllt: " : "offen: ");

function PartBlock({ view, side }: { view: PartView; side: Side }) {
  return (
    <section className="grid gap-1.5 border-t border-line pt-2.5 first:border-t-0 first:pt-0" aria-label={view.title} data-testid={`signal-summary-part-${view.id}`} data-ok={view.ok || undefined}>
      {/* nothing truncates: a detail / value that does not fit beside its label wraps to its own line, right-aligned */}
      <header className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <h4 className={cn("text-[10.5px] font-semibold uppercase tracking-[0.1em]", view.ok ? "text-fg" : "text-mute")}>{view.title}</h4>
        <span className={cn("num ml-auto whitespace-nowrap font-mono text-[11px]", view.data ? "text-mute" : "text-faint")}>{view.detail}</span>
      </header>
      <ul className="grid gap-x-5 gap-y-1 @md:grid-cols-2">
        {view.rows.map((r) => (
          <li key={r.id} className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-[12px]" data-met={r.met == null ? "none" : String(r.met)}>
            <span className="inline-flex items-center gap-2 self-center">
              <RowDot met={r.met} side={side} provisional={r.provisional} />
              <span className="sr-only">{metWord(r.met)}</span>
              <span className={r.met ? "text-fg" : "text-mute"}>{r.label}</span>
            </span>
            <span className={cn("num ml-auto whitespace-nowrap text-right font-mono text-[11.5px]", r.met == null ? "text-faint" : r.provisional ? SOFT[side].text : "text-mute")}>{r.value}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** "Bedingungen" of a v2 snapshot: the graded parts and the falling-knife filter at check time. */
function SnapshotParts({ snap }: { snap: SignalSnapshot }) {
  const views = snapshotPartViews(snap);
  const knife = snap.knife;
  return (
    <div className="grid gap-2.5 rounded-xl border border-line/80 bg-white/[0.015] p-3" data-testid="signal-summary-parts">
      {views.map((v) => (
        <PartBlock key={v.id} view={v} side={snap.side} />
      ))}
      {knife && (
        <PartBlock
          view={{ id: "knife", title: KNIFE_TITLE, detail: `${knife.n} von ${knife.items.length || 3}`, ok: knife.items.length > 0 && knife.n === knife.items.length, data: true, provisional: false, rows: knifeRows(snap) }}
          side={snap.side}
        />
      )}
    </div>
  );
}

/**
 * "Top-Trader kaufen · Retail rot" (short: "verkaufen · Retail grün") as stored with the check: toned with its run
 * when it held, muted when open, "keine Daten" when Binance had no top-trader data for that moment (never a fail).
 * Only our snapshots carry the field; the other version's have no pill.
 */
function WhalePill({ snap, on }: { snap: SignalSnapshot; on: string }) {
  const w = snap.whale;
  const title = WHALE_TITLE[snap.side];
  if (!w)
    return (
      <li className="inline-flex items-center rounded-full border border-line px-2.5 py-1 font-mono text-[11px] text-faint" title={WHALE_NO_DATA_HINT} data-testid="signal-summary-whale" data-state="none">
        Top-Trader · {WHALE_NO_DATA}
      </li>
    );
  return (
    <li
      className={cn("inline-flex items-center rounded-full border px-2.5 py-1 font-mono text-[11px]", w.ok ? cn(on, "text-fg") : "border-line text-mute")}
      data-testid="signal-summary-whale"
      data-state={w.ok ? "ok" : "open"}
    >
      <span className="sr-only">{w.ok ? "erfüllt: " : "offen: "}</span>
      {title} · {w.run}× {w.period}
    </li>
  );
}

/** Mistake tags of a trade as loss-tinted chips (detail view); nothing when there are none. */
export function MistakeChips({ tags, className }: { tags: readonly string[]; className?: string }) {
  if (tags.length === 0) return null;
  return (
    <ul className={cn("flex flex-wrap gap-1.5", className)} aria-label="Fehler">
      {tags.map((m) => (
        <li key={m} className="rounded-full border border-loss/40 bg-loss/[0.1] px-2.5 py-1 text-[11.5px] text-[#ff8a90]">
          {m}
        </li>
      ))}
    </ul>
  );
}
