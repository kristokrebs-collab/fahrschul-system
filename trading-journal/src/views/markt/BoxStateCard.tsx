/**
 * `Box-Status` (P02): the newest box of a timeframe on a phase rail – In der Box → Schluss abwarten → Ausbruch → Retest
 * → Ziel (a failed breakout falls back to the start) – with a status pill that counts down to the candle close (the
 * breakout counts only then), the box as a vertical gauge with the live price in it, the distances to both edges
 * (rolling digits on the live price), the quality and the targets in both directions.
 *
 * Motion: the rail fills on `spring.smooth` and the reached dots pop (`spring.pop`); the price marker glides inside the
 * gauge (transform only, the price itself is a MotionValue); the pill turns warn → live at a confirmed breakout and runs
 * its own countdown ring (`RingCycle`, no render per second). A breakout ABOVE the range high of the loaded history
 * celebrates once (`celebrateFrom` kind `record`). Reduced motion: static.
 */
import { motion, useSpring, useTransform } from "motion/react";
import { memo, useEffect, useRef, useState } from "react";
import { BOX_TF_MS, PHASE_LABEL, type BoxPhase, type BoxTf } from "@/domain/boxes";
import { cn } from "@/lib/cn";
import { getBoxBars, type BoxesView, type BoxTfView } from "@/market/boxes/store";
import { hhmmss } from "@/market/format";
import { priceMv } from "@/market/motionValues";
import { useNowMv } from "@/motion/clock";
import { celebrateFrom } from "@/motion/Celebrate";
import { StatusPill } from "@/motion/StatusPill";
import { spring } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { DotMatrix } from "@/motion/DotMatrix";
import { Card } from "@/primitives/Card";
import { Segmented } from "@/primitives/Segmented";
import { MARKT, RAIL, TF_TEXT } from "./strings";
import { EdgeDistance, price } from "./ui";

const S = MARKT.state;
const TFS: readonly { v: BoxTf; label: string }[] = [
  { v: "4h", label: TF_TEXT["4h"] },
  { v: "1d", label: TF_TEXT["1d"] },
  { v: "1w", label: TF_TEXT["1w"] },
];

/** Index on the rail (−1 = no box). `running` sits after the breakout, `failed` falls back to the start. */
export function railIndex(phase: BoxPhase, pending: number): number {
  if (phase === "none") return -1;
  if (phase === "inside" || phase === "failed") return pending !== 0 ? 1 : 0;
  if (phase === "breakout" || phase === "running") return 2;
  if (phase === "retest") return 3;
  return 4;
}

/** The pill: live once the close confirmed a breakout, warn while the close is pending, muted otherwise. */
export function pillOf(v: BoxTfView): { tone: "live" | "warn" | "error" | "muted"; label: string } {
  const st = v.analysis?.box;
  if (!st || !st.box) return { tone: "muted", label: S.none };
  // a wick back into the box after a close-confirmed breakout: only the close decides (MM-5)
  if (st.pendingBack && st.phase !== "target") return { tone: "warn", label: S.pendingBack };
  if (st.phase === "breakout" || st.phase === "retest" || st.phase === "target") return { tone: "live", label: `${PHASE_LABEL[st.phase]} ${st.dir > 0 ? "↑" : "↓"}` };
  if (st.pending !== 0) return { tone: "warn", label: S.pending };
  if (st.phase === "failed") return { tone: "error", label: PHASE_LABEL.failed };
  return { tone: "muted", label: PHASE_LABEL[st.phase] };
}

function Rail({ index, failed, reduced }: { index: number; failed: boolean; reduced: boolean }) {
  const n = RAIL.length;
  return (
    <ol className="relative grid grid-cols-5 gap-1 pt-1" aria-label="Phasen der Box" data-testid="box-rail" data-index={index}>
      <span aria-hidden="true" className="absolute left-[10%] right-[10%] top-[9px] h-px bg-line-2" />
      <motion.span
        aria-hidden="true"
        className="absolute left-[10%] right-[10%] top-[9px] h-px origin-left bg-fg"
        initial={false}
        animate={{ scaleX: index <= 0 ? 0 : index / (n - 1) }}
        transition={reduced ? { duration: 0 } : spring.smooth}
      />
      {RAIL.map((r, i) => {
        const on = i <= index;
        const cur = i === index;
        return (
          <li key={r.id} className="relative grid justify-items-center gap-1.5 text-center" aria-current={cur ? "step" : undefined}>
            <motion.span
              aria-hidden="true"
              className={cn("relative z-[1] size-[18px] rounded-full border-2", on ? "border-fg bg-fg" : "border-line-2 bg-ink-900", cur && (failed ? "!border-loss !bg-loss" : i === 1 ? "!border-warn !bg-warn" : ""))}
              initial={false}
              animate={{ scale: cur ? 1.12 : on ? 1 : 0.82 }}
              transition={reduced ? { duration: 0 } : spring.pop}
            />
            <span className={cn("text-[10.5px] leading-tight", cur ? "font-semibold text-fg" : on ? "text-mute" : "text-faint")}>{r.label}</span>
          </li>
        );
      })}
    </ol>
  );
}

/** Gauge height (px): the box spans the middle two thirds, a quarter box height above and below. */
const GAUGE_PX = 144;

/** Marker offset (px from the gauge top) of `p` in a box `bottom…top` (clamped to −25 % … 125 %). */
export function gaugeY(p: number, top: number, bottom: number, px = GAUGE_PX): number {
  const h = top - bottom;
  const pos = h > 0 && p > 0 ? (p - bottom) / h : 0.5;
  const t = Math.max(-0.25, Math.min(1.25, pos));
  return (1 - (t + 0.25) / 1.5) * px;
}

/** The box as a vertical gauge with the live price marker (transform only, no render per tick; glides on the spring). */
function Gauge({ top, bottom, reduced }: { top: number; bottom: number; reduced: boolean }) {
  const raw = useTransform(priceMv, (p) => gaugeY(p, top, bottom));
  const glide = useSpring(raw, spring.smooth);
  return (
    <div className="relative w-12 shrink-0" style={{ height: GAUGE_PX }} aria-hidden="true" data-testid="box-gauge">
      <span className="absolute inset-x-2 top-[16.67%] bottom-[16.67%] rounded-md border border-white/30 bg-white/[0.06]" />
      <span className="absolute inset-x-2 top-[16.67%] h-px bg-fg/70" />
      <span className="absolute inset-x-2 bottom-[16.67%] h-px bg-fg/70" />
      <motion.span className="absolute left-0 right-0 top-0 h-0" style={{ y: reduced ? raw : glide }}>
        <span className="absolute -top-[5px] left-0 right-0 mx-auto block size-[10px] rounded-full bg-signal shadow-[0_0_0_3px_rgba(229,32,46,0.25)]" />
      </motion.span>
    </div>
  );
}

const BoxDetail = memo(function BoxDetail({ tf, v }: { tf: BoxTf; v: BoxTfView }) {
  const reduced = useReducedFx();
  const a = v.analysis;
  const st = a?.box;
  const b = st?.box;
  if (!a || !st || !b) return <p className="text-[13px] text-mute">{v.bars > 0 && v.bars < 60 ? `Zu wenig ${TF_TEXT[tf]}-Kerzen.` : S.none}</p>;
  const failed = st.phase === "failed";
  return (
    <div className="grid gap-4">
      <Rail index={railIndex(st.phase, st.pending)} failed={failed} reduced={reduced} />
      <div className="flex gap-4">
        <Gauge top={b.top} bottom={b.bottom} reduced={reduced} />
        <dl className="grid min-w-0 flex-1 grid-cols-2 gap-x-3 gap-y-2.5 text-[12px]">
          <div>
            <dt className="text-faint">{S.top}</dt>
            <dd className="num font-mono text-[14px] text-fg">{price(b.top)}</dd>
            <dd className="text-[11px] text-mute">
              <EdgeDistance edge={b.top} />
            </dd>
          </div>
          <div>
            <dt className="text-faint">{S.bottom}</dt>
            <dd className="num font-mono text-[14px] text-fg">{price(b.bottom)}</dd>
            <dd className="text-[11px] text-mute">
              <EdgeDistance edge={b.bottom} />
            </dd>
          </div>
          <div>
            <dt className="text-faint">{S.quality}</dt>
            <dd className="text-fg">
              {b.grade} · {b.quality}
            </dd>
            <dd className="text-[11px] text-mute">{S.touches(b.touchesTop, b.touchesBottom)}</dd>
          </div>
          <div>
            <dt className="text-faint">{st.dir > 0 ? S.targetsUp : st.dir < 0 ? S.targetsDown : S.targetsBoth}</dt>
            <dd className="num font-mono text-[12px] text-fg">
              {(st.dir !== 0 ? st.targets : [st.up[0], st.down[0]])
                .filter((t): t is NonNullable<typeof t> => !!t)
                .slice(0, 2)
                .map((t) => price(t.price))
                .join(" · ") || "–"}
            </dd>
          </div>
        </dl>
      </div>
    </div>
  );
});

/**
 * No analysis yet because the page is still loading / off / failing: the card says that (the same loader as „Beste
 * Setups“) instead of „Noch keine saubere Box.“ – that line is a verdict about loaded candles.
 */
export function waitOf(view: BoxesView, v: BoxTfView): { tone: "warn" | "error" | "muted"; label: string; text: string; loading: boolean } | null {
  if (v.analysis) return null;
  if (view.state === "loading" || view.state === "idle") return { tone: "muted", label: S.loadingPill, text: view.detail ?? MARKT.best.loading, loading: true };
  if (view.state === "off") return { tone: "muted", label: S.offPill, text: view.detail ?? S.none, loading: false };
  if (view.state === "error") return { tone: "error", label: S.errorPill, text: view.detail ?? S.none, loading: false };
  return null;
}

/** Height of the loaded body (rail 41 + gap 16 + gauge): the loader keeps it, so nothing below moves when the box arrives. */
const BODY_PX = 41 + 16 + GAUGE_PX;

export function BoxStateCard({ view }: { view: BoxesView }) {
  const [tf, setTf] = useState<BoxTf>("4h");
  const v = view.tfs[tf];
  const wait = waitOf(view, v);
  const pill = wait ?? pillOf(v);
  const closesAt = v.closesAt;
  const ref = useRef<HTMLDivElement>(null);
  // a confirmed upward breakout to a new high of the loaded history celebrates once per box
  const seen = useRef<Map<string, string>>(new Map());
  useEffect(() => {
    for (const t of ["4h", "1d", "1w"] as const) {
      const x = view.tfs[t];
      const st = x.analysis?.box;
      if (!st || !x.boxId) continue;
      const prev = seen.current.get(t);
      const now = `${x.boxId}:${st.phase}:${st.dir}`;
      seen.current.set(t, now);
      if (prev === undefined || prev === now || st.phase !== "breakout" || st.dir <= 0) continue;
      const bars = getBoxBars(t);
      const hi = bars.reduce((m, b) => Math.max(m, b.h), -Infinity);
      if (bars.length && st.price >= hi) celebrateFrom(ref.current, { kind: "record" });
    }
  }, [view.tfs]);
  return (
    <Card
      title={S.title}
      note={S.note}
      action={<Segmented<BoxTf> size="sm" aria-label="Timeframe" options={TFS} value={tf} onChange={setTf} />}
      className="h-full"
      data-testid="markt-state"
    >
      <div ref={ref} className="grid gap-4" data-phase={v.analysis?.box.phase ?? "none"} data-tf={tf}>
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill tone={pill.tone} label={pill.label} expanded ring={closesAt ? { endsAt: closesAt, ms: BOX_TF_MS[tf] } : null} layoutKey={`${tf}:${pill.label}`} />
          {closesAt && !wait ? <CloseIn at={closesAt} /> : null}
        </div>
        {wait ? (
          <div className="pt-1 text-[13px] text-mute" style={{ minHeight: BODY_PX }} data-testid="state-wait" data-loading={wait.loading || undefined}>
            <span className="flex items-center gap-3">
              {/* loading: the „Lädt“ pill + the loader say it – the sentence stands once, in Beste Setups (P2-09) */}
              {wait.loading && <DotMatrix preset="loader" size={3} gap={2} />}
              <span className={cn(wait.loading && "sr-only")}>{wait.text}</span>
            </span>
          </div>
        ) : (
          <BoxDetail tf={tf} v={v} />
        )}
      </div>
    </Card>
  );
}

/** `Kerzenschluss in 2:14:05` on the shared second clock (no React render per second). */
function CloseIn({ at }: { at: number }) {
  const text = useCloseText(at);
  return (
    <span className="text-[11.5px] text-faint">
      {S.closeIn} <motion.span className="num font-mono text-mute">{text}</motion.span>
    </span>
  );
}

function useCloseText(at: number) {
  const now = useNowMv();
  return useTransform(now, (n) => {
    const left = at - n;
    if (left <= 0) return "jetzt";
    const d = Math.floor(left / 86_400_000);
    return d > 0 ? `${d} T ${hhmmss(left - d * 86_400_000)}` : hhmmss(left);
  });
}
