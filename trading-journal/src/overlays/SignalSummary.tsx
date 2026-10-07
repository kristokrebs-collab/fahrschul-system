/**
 * Read-only views of a stored / computed "Einstiegs-Check" snapshot (`trade.signal`, see `@/domain/signals`): the
 * summary box of the trade editor and the trade detail, the compact strength bars of the trades table / cards, and
 * the mistake chips of the detail. Pure presentation – no data access, no timers.
 */
import { motion } from "motion/react";
import { memo } from "react";
import { isStrongKind, kindText, parseSignalSnapshot, snapshotLadderLength, strengthLine, strengthText, WHALE_NO_DATA, WHALE_NO_DATA_HINT, WHALE_TITLE, ZONE_TEXT, type SignalSnapshot } from "@/domain/signals";
import { cn } from "@/lib/cn";
import { dateTime, n1 } from "@/lib/format";
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
export const StrengthDots = memo(function StrengthDots({ strength, dot, className }: { strength: number; dot: string; className?: string }) {
  const reduced = useReducedFx();
  return (
    <span className={cn("flex gap-1", className)} role="img" aria-label={`Stärke ${strength} von 4`}>
      {[1, 2, 3, 4].map((i) => (
        <span key={i} className="relative size-2 rounded-full bg-white/[0.12]" aria-hidden="true">
          <motion.span
            className={cn("absolute inset-0 rounded-full", dot)}
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
 * the snapshot's tone; a dash when the trade has no stored check. Static (rows never animate per cell).
 */
export function StrengthBars({ snap, className }: { snap: Pick<SignalSnapshot, "strength" | "valid" | "side"> | null; className?: string }) {
  if (!snap) {
    return (
      <span className={cn("inline-flex h-2.5 w-[19px] items-end justify-center text-[10px] leading-none text-faint", className)} role="img" aria-label="Kein Einstiegs-Check gespeichert">
        <span aria-hidden="true">·</span>
      </span>
    );
  }
  const tone = signalTone(snap);
  return (
    <span className={cn("inline-flex h-2.5 items-end gap-[2px]", className)} role="img" aria-label={`Signal-Stärke ${snap.strength} von 4 (${strengthText(snap.strength)})`} data-strength={snap.strength}>
      {[1, 2, 3, 4].map((i) => (
        <span key={i} aria-hidden="true" className={cn("w-[3px] rounded-[1px]", i <= snap.strength ? tone.dot : "bg-white/[0.14]")} style={{ height: `${3 + i * 1.75}px` }} />
      ))}
    </span>
  );
}

export interface SignalSummaryProps {
  snap: SignalSnapshot;
  /** Side of the trade: a snapshot taken for the other side is labelled as such. */
  side?: "long" | "short";
  className?: string;
}

/**
 * Score, verdict label, strength (`{Stärke} · {tiers} von {n} Timeframes`), one pill per timeframe
 * (`30m · Bottom · RSI 38,2`, toned while it confirms the ladder), the zone pill and – for our snapshots – the
 * "Top-Trader kaufen · Retail rot" pill; the source line says whether the
 * check was taken live, recomputed from history or comes from the other journal version.
 */
export function SignalSummary({ snap, side, className }: SignalSummaryProps) {
  const tone = signalTone(snap);
  const n = snapshotLadderLength(snap);
  const otherSide = side && snap.side !== side;
  return (
    <div className={cn("grid gap-3 rounded-2xl border border-line bg-ink-950/50 p-3.5", className)} data-testid="signal-summary" data-strength={snap.strength}>
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
          <span className={cn("text-[14.5px] font-semibold leading-tight", tone.text)}>{snap.label}</span>
          <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <StrengthDots strength={snap.strength} dot={tone.dot} />
            <span className="text-[11.5px] text-mute">{strengthLine(snap.strength, snap.tiers, n)}</span>
          </span>
        </div>
      </div>
      {(snap.tfs.length > 0 || snap.zone) && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Timeframes">
          {snap.tfs.map((tf, i) => {
            const ok = tf.ok ?? i < snap.tiers;
            return (
              <li
                key={`${tf.tf}-${i}`}
                className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[11px]", ok ? cn(tone.on, "text-fg") : "border-line text-mute")}
              >
                <span
                  aria-hidden="true"
                  className={cn("size-1.5 shrink-0 rounded-full", !tf.kind ? "bg-white/20" : isStrongKind(tf.kind) ? (ok ? tone.dot : "bg-fg/60") : "border border-current")}
                />
                {tf.tf} · {kindText(tf.kind)}
                {Number.isFinite(tf.rsi) ? ` · RSI ${n1(tf.rsi)}` : ""}
              </li>
            );
          })}
          <li className={cn("inline-flex items-center rounded-full border px-2.5 py-1 font-mono text-[11px]", snap.zoneOk ? cn(tone.on, "text-fg") : "border-line text-mute")}>
            Zone {snap.zone ? ZONE_TEXT[snap.zone] : "–"}
          </li>
          {snap.whale !== undefined && <WhalePill snap={snap} on={tone.on} />}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-faint">
        <span>{snapshotSource(snap)}</span>
        {otherSide && <span className="text-mute">· geprüft für {snap.side === "long" ? "Long" : "Short"}</span>}
      </div>
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
