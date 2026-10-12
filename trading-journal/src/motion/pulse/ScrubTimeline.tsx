import { useMotionValue, type MotionValue } from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { cn } from "@/lib/cn";
import { createFrameLoop, latestPointer } from "@/motion/pulse/engine";
import { watchActivity } from "@/motion/pulse/textKit";
import { useFirstInView } from "@/motion/inView";
import { useReducedFx } from "@/motion/useReducedFx";

/**
 * pulse-motion `agent-trace` (measured), generalised from the equity replay (`src/chart/replay.ts`): a scrubbable
 * timeline where EVERYTHING is a pure function of one time `t` – playhead, span bars (`scaleX` of their progress),
 * rows that "wake up" when their span starts, the time readout and the slider value. Scrubbing follows the pointer
 * 1:1 (no spring – the pack's coupling), Play advances `t` from the rAF clock (`dt · total / playSeconds · speed`),
 * stops at the end (or loops with `loop`) and sleeps off screen / in a hidden tab.
 *
 * `time` can be your own MotionValue: a replay chart, a Monte-Carlo fan or a diary subscribes to it and redraws –
 * the timeline itself never re-renders React per frame (DOM writes only on change; the track rect is read once per
 * gesture). `onCommit(t)` fires on pointer-up, keys and the end of a play – not per frame.
 *
 * A11y: the track is `role="slider"` (arrows ± `step`, Shift / Page ± `bigStep`, Home / End, Space = play / pause),
 * the play button has a label, the rows are a list with their real labels. Reduced motion: no auto-play (scrubbing
 * stays – it is user driven), rows switch without fades.
 */
export const CONFIG = {
  /** seconds a full run takes at 1× (pack: 10.4 s timeline) */
  playSeconds: 10.4,
  speeds: [1, 2, 4] as readonly number[],
  /** pack: rows not yet started dim to .45 (fade ≈ 160 ms), hover 120 ms */
  dimOpacity: 0.45,
  dimMs: 160,
  rowHeight: 30,
  labelWidth: 132,
  /** bar thickness (pack 8 px, radius 4) */
  bar: 8,
} as const;

export type ScrubTone = "fg" | "mute" | "win" | "loss" | "signal" | "warn";

export interface ScrubSpan {
  id: string;
  label: string;
  /** start time (same unit as `total`) */
  start: number;
  duration: number;
  tone?: ScrubTone;
  /** shown at the row end once the span has finished */
  meta?: string;
}

export interface ScrubMarker {
  at: number;
  label?: string;
  tone?: ScrubTone;
}

/** Progress 0..1 of a span at time `t`. */
export function spanProgress(span: Pick<ScrubSpan, "start" | "duration">, t: number): number {
  if (span.duration <= 0) return t >= span.start ? 1 : 0;
  return Math.min(1, Math.max(0, (t - span.start) / span.duration));
}

/** Slider key → new time (`null` = key not handled). */
export function scrubKey(key: string, shift: boolean, t: number, total: number, step: number, bigStep: number): number | null {
  const s = shift ? bigStep : step;
  const clamp = (v: number) => Math.min(total, Math.max(0, v));
  switch (key) {
    case "ArrowLeft":
    case "ArrowDown":
      return clamp(t - s);
    case "ArrowRight":
    case "ArrowUp":
      return clamp(t + s);
    case "PageDown":
      return clamp(t - bigStep);
    case "PageUp":
      return clamp(t + bigStep);
    case "Home":
      return 0;
    case "End":
      return total;
    default:
      return null;
  }
}

/** Time at a pointer x over a track [left, left + width] (clamped). */
export function timeAtX(x: number, left: number, width: number, total: number): number {
  if (width <= 0) return 0;
  return Math.min(total, Math.max(0, ((x - left) / width) * total));
}

/** Next play time: advances by `dt` seconds; loops or clamps at the end. Returns [t, ended]. */
export function playStep(t: number, dt: number, total: number, playSeconds: number, speed: number, loop: boolean): [number, boolean] {
  const next = t + (dt * total * speed) / Math.max(1e-6, playSeconds);
  if (next < total) return [next, false];
  return loop ? [next % total, false] : [total, true];
}

/** Default readout: seconds with one decimal ("5,2 s"). */
export function formatSeconds(t: number): string {
  return `${t.toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} s`;
}

const TONE_BG: Record<ScrubTone, string> = { fg: "bg-fg", mute: "bg-mute", win: "bg-win", loss: "bg-loss", signal: "bg-signal", warn: "bg-warn" };

export interface ScrubTimelineProps {
  /** Accessible name of the slider. */
  label: string;
  total: number;
  spans?: readonly ScrubSpan[];
  markers?: readonly ScrubMarker[];
  /** Controlled time (MotionValue); an internal one otherwise. */
  time?: MotionValue<number>;
  /** Start time of the internal value (default `total`). */
  defaultTime?: number;
  /** Play once on first view (from 0 when at the end). Never under reduced motion. */
  autoPlay?: boolean;
  loop?: boolean;
  /** Seconds a full run takes at 1× (default 10.4, the pack's timeline). */
  playSeconds?: number;
  speeds?: readonly number[];
  step?: number;
  bigStep?: number;
  formatTime?: (t: number) => string;
  onCommit?: (t: number) => void;
  /** Show play / speed controls (default true). */
  transport?: boolean;
  /** Title over the rows. */
  title?: string;
  rowHeight?: number;
  labelWidth?: number;
  className?: string;
}

export function ScrubTimeline({
  label,
  total,
  spans = [],
  markers = [],
  time,
  defaultTime,
  autoPlay = false,
  loop = false,
  playSeconds = CONFIG.playSeconds,
  speeds = CONFIG.speeds,
  step,
  bigStep,
  formatTime = formatSeconds,
  onCommit,
  transport = true,
  title,
  rowHeight = CONFIG.rowHeight,
  labelWidth = CONFIG.labelWidth,
  className,
}: ScrubTimelineProps) {
  const reduced = useReducedFx();
  const own = useMotionValue(defaultTime ?? total);
  const t = time ?? own;
  const [playing, setPlaying] = useState(false);
  const [speedIdx, setSpeedIdx] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const readoutRef = useRef<HTMLSpanElement>(null);
  const fillRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const rowRefs = useRef<(HTMLLIElement | null)[]>([]);
  const barRefs = useRef<(HTMLDivElement | null)[]>([]);
  const metaRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const st = useRef({ playing: false, speed: speeds[0] ?? 1, loop, total, playSeconds, active: true, pointerX: null as number | null, rect: { left: 0, width: 0 }, onCommit, formatTime, spans, setPlaying });
  useLayoutEffect(() => {
    Object.assign(st.current, { speed: speeds[speedIdx] ?? 1, loop, total, playSeconds, onCommit, formatTime, spans });
  });
  const stepSize = step ?? total / 100;
  const big = bigStep ?? total / 10;

  // time → DOM (zero React renders); written only when the value changes
  useLayoutEffect(() => {
    const written = { pct: "", text: "", rows: [] as number[], metas: [] as number[], fills: [] as number[] };
    const apply = (raw: number) => {
      const s = st.current;
      const v = Math.min(s.total, Math.max(0, Number.isFinite(raw) ? raw : 0));
      const r = s.total > 0 ? v / s.total : 0;
      const pct = `${(r * 100).toFixed(3)}%`;
      if (pct !== written.pct) {
        written.pct = pct;
        if (headRef.current) headRef.current.style.transform = `translate3d(${pct},0,0)`;
      }
      const text = s.formatTime(v);
      if (text !== written.text) {
        written.text = text;
        if (readoutRef.current) readoutRef.current.textContent = text;
        const track = trackRef.current;
        track?.setAttribute("aria-valuenow", v.toFixed(3));
        track?.setAttribute("aria-valuetext", text);
      }
      s.spans.forEach((span, i) => {
        const p = spanProgress(span, v);
        const q = Math.round(p * 1000);
        if (written.fills[i] !== q) {
          written.fills[i] = q;
          const f = fillRefs.current[i];
          if (f) f.style.transform = `scaleX(${p.toFixed(4)})`;
        }
        const started = v >= span.start ? 1 : 0;
        if (written.rows[i] !== started) {
          written.rows[i] = started;
          for (const row of [rowRefs.current[i], barRefs.current[i]]) {
            if (!row) continue;
            row.style.opacity = started ? "1" : String(CONFIG.dimOpacity);
            row.toggleAttribute("data-started", started === 1);
          }
        }
        const done = p >= 1 ? 1 : 0;
        if (written.metas[i] !== done) {
          written.metas[i] = done;
          const m = metaRefs.current[i];
          if (m) m.style.opacity = String(done);
        }
      });
    };
    apply(t.get());
    return t.on("change", apply);
  }, [t, spans, total]);

  // one frame loop for play AND the coalesced pointer scrub
  const loopRef = useRef<ReturnType<typeof createFrameLoop> | null>(null);
  useEffect(() => {
    const s = st.current;
    const loop = createFrameLoop((dt) => {
      if (!s.active) return false;
      let busy = false;
      if (s.pointerX !== null) {
        t.set(timeAtX(s.pointerX, s.rect.left, s.rect.width, s.total));
        s.pointerX = null;
      }
      if (s.playing) {
        const [next, ended] = playStep(t.get(), dt, s.total, s.playSeconds, s.speed, s.loop);
        t.set(next);
        if (ended) {
          s.playing = false;
          s.setPlaying(false);
          s.onCommit?.(next);
        } else busy = true;
      }
      return busy;
    });
    loopRef.current = loop;
    const root = rootRef.current;
    const unwatch = root
      ? watchActivity(root, (a) => {
          s.active = a;
          if (a && s.playing) loop.wake();
        })
      : () => {};
    return () => {
      unwatch();
      loop.stop();
    };
  }, [t]);

  const play = (on: boolean) => {
    const s = st.current;
    if (on && t.get() >= s.total - 1e-9) t.set(0);
    s.playing = on;
    setPlaying(on);
    if (on) loopRef.current?.wake();
    else s.onCommit?.(t.get());
  };

  // auto-play once on first view (never under reduced motion)
  const seen = useFirstInView(rootRef, autoPlay && !reduced);
  const auto = useRef(false);
  useEffect(() => {
    if (!autoPlay || reduced || !seen || auto.current) return;
    auto.current = true;
    const s = st.current;
    if (t.get() >= s.total - 1e-9) t.set(0);
    s.playing = true;
    s.setPlaying(true);
    loopRef.current?.wake();
  }, [seen, autoPlay, reduced, t]);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const track = trackRef.current;
    if (!track) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const r = track.getBoundingClientRect();
    const s = st.current;
    s.rect = { left: r.left, width: r.width };
    s.playing = false;
    if (playing) setPlaying(false);
    t.set(timeAtX(e.clientX, r.left, r.width, s.total));
    track.focus({ preventScroll: true });
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture?.(e.pointerId)) return;
    st.current.pointerX = latestPointer(e.nativeEvent).x;
    loopRef.current?.wake();
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture?.(e.pointerId)) return;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    st.current.onCommit?.(t.get());
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      play(!st.current.playing);
      return;
    }
    const next = scrubKey(e.key, e.shiftKey, t.get(), total, stepSize, big);
    if (next === null) return;
    e.preventDefault();
    if (st.current.playing) play(false);
    t.set(next);
    onCommit?.(next);
  };

  const speed = speeds[speedIdx] ?? 1;
  const initial = t.get();
  const ticks = 10;
  const hasRows = spans.length > 0;
  const rowStyle = (span: ScrubSpan) => ({
    height: rowHeight,
    opacity: initial >= span.start ? 1 : CONFIG.dimOpacity,
    transition: reduced ? undefined : `opacity ${CONFIG.dimMs}ms cubic-bezier(.22,.8,.3,1)`,
  });
  return (
    <div ref={rootRef} data-pulse="scrub-timeline" className={cn("grid gap-3 overflow-x-clip rounded-2xl border border-line-2 bg-ink-850 p-3 sm:p-4", className)}>
      {(transport || title) && (
        <div className="flex items-center gap-3">
          {transport && (
            <button
              type="button"
              onClick={() => play(!playing)}
              aria-label={playing ? "Pause" : "Abspielen"}
              data-testid="scrub-play"
              className="grid size-8 shrink-0 place-items-center rounded-full bg-ink-700 text-fg transition-transform active:scale-95"
            >
              <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden="true">
                {playing ? <path d="M4.5 3h2.4v10H4.5zM9.1 3h2.4v10H9.1z" fill="currentColor" /> : <path d="M5 3.2v9.6L12.8 8z" fill="currentColor" />}
              </svg>
            </button>
          )}
          <div className="grid min-w-0 flex-1">
            {title && <span className="truncate text-[13px] font-medium text-fg">{title}</span>}
            <span className="font-mono text-[11px] text-mute tabular-nums">
              <span ref={readoutRef}>{formatTime(initial)}</span>
              <span className="text-faint"> / {formatTime(total)}</span>
            </span>
          </div>
          {transport && speeds.length > 1 && (
            <button
              type="button"
              onClick={() => setSpeedIdx((i) => (i + 1) % speeds.length)}
              aria-label={`Tempo ${speed}×, wechseln`}
              className="rounded-full border border-line-2 px-2.5 py-1 font-mono text-[11px] text-mute tabular-nums hover:text-fg"
            >
              {speed}×
            </button>
          )}
        </div>
      )}

      <div className="grid" style={{ gridTemplateColumns: hasRows ? `minmax(0, min(${labelWidth}px, 30%)) minmax(0, 1fr)` : "minmax(0, 1fr)" }}>
        {hasRows && (
          <div className="grid content-start">
            <span aria-hidden="true" className="h-4" />
            <ol aria-label={title ?? label} className="grid">
              {spans.map((span, i) => (
                <li
                  key={span.id}
                  ref={(el) => {
                    rowRefs.current[i] = el;
                  }}
                  className="flex items-center truncate pr-2 font-mono text-[11.5px] text-fg"
                  style={rowStyle(span)}
                >
                  <span className="truncate">{span.label}</span>
                  {span.meta && <span className="sr-only">, {span.meta}</span>}
                </li>
              ))}
            </ol>
          </div>
        )}

        {/* plot column: ruler, bars, track – one scrub surface, one playhead across all of it */}
        <div className="relative touch-none select-none" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
          <div aria-hidden="true" className="relative h-4">
            {Array.from({ length: ticks + 1 }, (_, i) => (
              <span key={i} className={cn("absolute bottom-0 w-px bg-line-2", i % 5 === 0 ? "h-2.5" : "h-1.5")} style={{ left: `${(i / ticks) * 100}%` }} />
            ))}
            {markers.map((m, i) => (
              <span key={i} className={cn("absolute bottom-0 size-1.5 -translate-x-1/2 rounded-full", TONE_BG[m.tone ?? "signal"])} style={{ left: `${(m.at / Math.max(1e-9, total)) * 100}%` }} title={m.label} />
            ))}
          </div>
          {spans.map((span, i) => (
            <div
              key={span.id}
              aria-hidden="true"
              ref={(el) => {
                barRefs.current[i] = el;
              }}
              className="relative flex items-center"
              style={rowStyle(span)}
            >
              <span className="absolute inset-x-0 h-px bg-white/[0.05]" />
              <span className="absolute rounded-full bg-white/[0.07]" style={{ left: `${(span.start / total) * 100}%`, width: `${(span.duration / total) * 100}%`, height: CONFIG.bar }}>
                <span
                  ref={(el) => {
                    fillRefs.current[i] = el;
                  }}
                  className={cn("absolute inset-0 origin-left rounded-full", TONE_BG[span.tone ?? "fg"])}
                  style={{ transform: `scaleX(${spanProgress(span, initial)})` }}
                />
              </span>
              {span.meta && (
                <span
                  ref={(el) => {
                    metaRefs.current[i] = el;
                  }}
                  className="absolute max-w-[40%] truncate pl-1.5 font-mono text-[10.5px] text-mute"
                  style={{ left: `${Math.min(100, ((span.start + span.duration) / total) * 100)}%`, opacity: spanProgress(span, initial) >= 1 ? 1 : 0 }}
                >
                  {span.meta}
                </span>
              )}
            </div>
          ))}
          <div
            ref={trackRef}
            role="slider"
            tabIndex={0}
            aria-label={label}
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={Number(initial.toFixed(3))}
            aria-valuetext={formatTime(initial)}
            data-testid="scrub-track"
            onKeyDown={onKeyDown}
            className="relative mt-1 h-6 cursor-ew-resize rounded-full outline-none focus-visible:ring-2 focus-visible:ring-steel/60"
          >
            <span aria-hidden="true" className="absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-ink-700" />
          </div>
          <div ref={headRef} aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 w-full" style={{ transform: `translate3d(${((initial / Math.max(1e-9, total)) * 100).toFixed(3)}%,0,0)` }}>
            <span className="absolute top-2 bottom-3 left-0 w-px -translate-x-1/2 bg-signal/75" />
            <span className="absolute top-[9px] left-0 size-[7px] -translate-x-1/2 -translate-y-1/2 rotate-45 bg-signal" />
            <span className="absolute bottom-3 left-0 size-3 -translate-x-1/2 translate-y-1/2 rounded-full bg-steel shadow-[0_0_0_4px_rgb(0_0_0/0.35)]" />
          </div>
        </div>
      </div>
    </div>
  );
}
