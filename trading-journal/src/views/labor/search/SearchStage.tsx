/**
 * The Frost block of the strategy search: the big title, two counters („Gezeichnet“ / „Geprüft“, „Bester bisher“), the four stages, the stage
 * with the REAL curves of a finished search (canvas, `timeline.ts`), the result over the stage, the foot with caption and buttons.
 *
 * Honest by construction: while the worker computes, the counters and the stage show the worker's real count („412 von 1.000 Varianten“) –
 * nothing is drawn that is not computed yet. Afterwards the finished runs are replayed in their real order (labelled as replay, with the
 * measured compute time in the caption); every line is a run, every dot a compared variant, the best changes exactly when the running best
 * score changed, the band behind the winner is the resampling of its real final-test trades.
 *
 * Performance: three stacked canvases – the grid (painted once), the 1.000 faint curves with the dots (painted ONCE, incrementally, a bounded
 * number of segments per frame; it steps back by CSS opacity, no repaint) and the front, where every frame strokes only a few lines (halos
 * without `shadowBlur`); counters and chips are written to the DOM directly (no React render per frame). Reduced motion: no replay – the final picture is built in a few frames and stays. `data-state` ("playing" | "done") on the stage.
 */
import { useEffect, useRef, type ReactNode } from "react";
import { useReducedFx } from "@/motion/useReducedFx";
import { cn } from "@/lib/cn";
import { SEARCH } from "./strings";
import { advanceLayers, drawGrid, framePlan, geometryOf, newLayers, paintFrame, placeOverlay, rangeOf, REPLAY_MS, STAGES, type Layers, type Palette, type Scene } from "./timeline";
import "./search.css";

const F = SEARCH.frost;
/** Segments painted into the layers per frame at most (keeps every frame far below 50 ms, also when the whole picture is built at once). */
const SEGMENTS_PER_FRAME = 24_000;

function paletteOf(el: HTMLElement): Palette {
  const cs = getComputedStyle(el);
  const v = (name: string, fb: string): string => cs.getPropertyValue(name).trim() || fb;
  return { veil: v("--veil-rgb", "255 255 255"), fg: v("--color-fg", "#f2f2f2"), faint: v("--color-faint", "#8a8a8a"), win: v("--color-win", "#3ddc84"), loss: v("--color-loss", "#ff4d4f") };
}

const fmt = (n: number): string => n.toLocaleString("de-DE");
export const idText = (id: number | null): string => (id == null ? "–" : `#${String(id + 1).padStart(4, "0")}`);

export interface StageStats {
  label: "Gezeichnet" | "Geprüft";
  value: string;
  best: string;
  /** active stage 0…3, −1 = none; stages before it count as done */
  stage: number;
}

export interface SearchStageProps {
  scene: Scene | null;
  /** a new value starts the replay again (one per finished search / „Nochmal ansehen“) */
  playKey: number;
  /** a new value jumps to the end state */
  skipKey?: number;
  /** called once per replay when its end state is on screen, with the `playKey` it belongs to */
  onDone?: (playKey: number) => void;
  label: string;
  /** what the counters show without a replay (busy: the worker's real numbers; idle / restored: the stand) */
  stats: StageStats;
  /** content of the stage without a scene (idle text, the worker's progress, an error) */
  center?: ReactNode;
  overlay?: ReactNode;
  caption: ReactNode;
  actions: ReactNode;
  children?: ReactNode;
  className?: string;
}

export function SearchStage({ scene, playKey, skipKey = 0, onDone, label, stats, center, overlay, caption, actions, children, className }: SearchStageProps) {
  const reduced = useReducedFx();
  const root = useRef<HTMLDivElement>(null);
  const plot = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const gridCv = useRef<HTMLCanvasElement>(null);
  const linesCv = useRef<HTMLCanvasElement>(null);
  const statLabel = useRef<HTMLSpanElement>(null);
  const statValue = useRef<HTMLElement>(null);
  const bestValue = useRef<HTMLElement>(null);
  const chips = useRef<(HTMLLIElement | null)[]>([]);
  const result = useRef<HTMLDivElement>(null);
  const raf = useRef(0);
  const jump = useRef<(() => void) | null>(null);
  const doneRef = useRef(onDone);
  useEffect(() => {
    doneRef.current = onDone;
  });
  const skipSeen = useRef(skipKey);

  /** writes counters and chips to the DOM (no React render per frame) */
  const write = (s: StageStats, pop = false): void => {
    if (statLabel.current && statLabel.current.textContent !== s.label) statLabel.current.textContent = s.label;
    if (statValue.current && statValue.current.textContent !== s.value) statValue.current.textContent = s.value;
    const b = bestValue.current;
    if (b && b.textContent !== s.best) {
      b.textContent = s.best;
      if (pop && !reduced) {
        b.dataset.pop = "0";
        void b.offsetWidth;
        b.dataset.pop = "1";
      }
    }
    chips.current.forEach((el, i) => {
      if (!el) return;
      const st = s.stage < 0 ? "" : i === s.stage ? "on" : i < s.stage ? "done" : "";
      if ((el.dataset.state ?? "") !== st) el.dataset.state = st;
    });
  };

  // without a scene: the given stand (busy: the worker's real count)
  useEffect(() => {
    if (!scene) write(stats);
  });

  useEffect(() => {
    const box = plot.current;
    const cv = canvas.current;
    const cvGrid = gridCv.current;
    const cvLines = linesCv.current;
    const el = root.current;
    if (!scene || !box || !cv || !cvGrid || !cvLines || !el) return;
    const ctx = typeof cv.getContext === "function" ? cv.getContext("2d") : null;
    const range = rangeOf(scene);
    let pal: Palette | null = null;
    let w = 0;
    let h = 0;
    let dpr = 1;
    let layers: Layers | null = null;
    let rest = -1;
    let t = reduced ? REPLAY_MS : 0;
    let start = 0;
    let finished = false;
    let lastBest: number | null = null;
    if (result.current) result.current.dataset.in = "0";
    el.dataset.state = reduced ? "done" : "playing";

    const build = (): void => {
      const r = box.getBoundingClientRect();
      w = Math.round(r.width);
      h = Math.round(r.height);
      if (!ctx || w <= 0 || h <= 0) return;
      dpr = Math.min(2, window.devicePixelRatio || 1);
      pal ??= paletteOf(el);
      const mk = (c: HTMLCanvasElement): CanvasRenderingContext2D => {
        c.width = Math.round(w * dpr);
        c.height = Math.round(h * dpr);
        const x = c.getContext("2d")!;
        x.setTransform(dpr, 0, 0, dpr, 0, 0);
        return x;
      };
      mk(cv);
      drawGrid(mk(cvGrid), geometryOf(w, h), scene, range, pal);
      layers = newLayers(mk(cvLines), scene.n);
      // the result sits over the training zone, never over the final test, and on the side the winner's line leaves free (wide screens only)
      const ov = result.current;
      if (ov) {
        const wide = typeof window.matchMedia === "function" && window.matchMedia("(min-width: 761px)").matches;
        const at = wide ? placeOverlay(geometryOf(w, h), scene, range, ov.offsetWidth, ov.offsetHeight) : null;
        ov.style.right = at ? `${at.right}px` : "";
        ov.style.top = at?.vertical === "top" ? "14px" : "";
        ov.style.bottom = at ? (at.vertical === "bottom" ? "14px" : "auto") : "";
      }
    };

    const paint = (): boolean => {
      if (!ctx || !layers || !pal) return true;
      const g = geometryOf(w, h);
      const plan = framePlan(scene, t);
      const complete = advanceLayers(layers, g, scene, range, pal, plan, SEGMENTS_PER_FRAME);
      // the faint curves step back by opacity (compositor), not by repainting them
      if (plan.rest !== rest) {
        rest = plan.rest;
        cvLines.style.opacity = String(rest);
      }
      paintFrame(ctx, g, scene, range, pal, plan);
      write({ label: plan.counter.label, value: fmt(plan.counter.value), best: idText(plan.best), stage: plan.done ? 3 : plan.stage }, plan.best !== lastBest);
      lastBest = plan.best;
      return complete;
    };

    const finish = (): void => {
      if (finished) return;
      finished = true;
      el.dataset.state = "done";
      if (result.current) result.current.dataset.in = "1";
      doneRef.current?.(playKey);
    };

    const loop = (stamp: number): void => {
      if (!start) start = stamp;
      if (!reduced && t < REPLAY_MS) t = Math.min(REPLAY_MS, stamp - start);
      const complete = paint();
      if (t >= REPLAY_MS && complete) {
        finish();
        return;
      }
      raf.current = requestAnimationFrame(loop);
    };

    jump.current = () => {
      t = REPLAY_MS;
      cancelAnimationFrame(raf.current);
      raf.current = requestAnimationFrame(loop);
    };

    build();
    if (reduced) finish();
    raf.current = requestAnimationFrame(loop);

    // size and theme changes rebuild the layers (painted again in a few frames)
    let lastW = w;
    const ro =
      typeof ResizeObserver === "function"
        ? new ResizeObserver(() => {
            const nw = Math.round(box.getBoundingClientRect().width);
            if (Math.abs(nw - lastW) < 2) return;
            lastW = nw;
            build();
            cancelAnimationFrame(raf.current);
            raf.current = requestAnimationFrame(loop);
          })
        : null;
    ro?.observe(box);
    const mo =
      typeof MutationObserver === "function"
        ? new MutationObserver(() => {
            pal = null;
            build();
            cancelAnimationFrame(raf.current);
            raf.current = requestAnimationFrame(loop);
          })
        : null;
    mo?.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-accent"] });
    return () => {
      cancelAnimationFrame(raf.current);
      ro?.disconnect();
      mo?.disconnect();
      jump.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one replay per scene / play key; `write` only touches refs
  }, [scene, playKey, reduced]);

  // „Überspringen“: straight to the end state
  useEffect(() => {
    if (skipKey === skipSeen.current) return;
    skipSeen.current = skipKey;
    if (root.current?.dataset.state === "playing") jump.current?.();
  }, [skipKey]);

  return (
    <div ref={root} className={cn("sx-frost", className)} data-testid="search-stage" data-curves={scene?.n ?? 0} data-flashes={scene?.flashes.length ?? 0} data-winner={scene?.winner ?? ""}>
      <div className="sx-head">
        <div>
          {/* the section's h2 carries the same words for assistive tech; this is the display line */}
          <p className="sx-title" aria-hidden="true">
            {SEARCH.title}
          </p>
          <p className="sx-lead">{F.lead}</p>
        </div>
        <div className="sx-stats">
          <div className="sx-stat">
            <span ref={statLabel} />
            <b ref={statValue} data-testid="search-stat-checked" />
          </div>
          <div className="sx-stat">
            <span>{F.best}</span>
            <b ref={bestValue} data-testid="search-stat-best" />
          </div>
        </div>
      </div>
      <ol className="sx-stages" aria-label={F.stagesLabel}>
        {STAGES.map((s, i) => (
          <li
            key={s.id}
            className="sx-pill"
            ref={(n) => {
              chips.current[i] = n;
            }}
          >
            {s.label}
          </li>
        ))}
      </ol>
      <div className="sx-stage">
        <div ref={plot} className="sx-plot" data-testid="search-stage-box">
          {scene ? (
            <>
              <canvas ref={gridCv} aria-hidden="true" />
              <canvas ref={linesCv} aria-hidden="true" />
              <canvas ref={canvas} role="img" aria-label={label} data-testid="search-canvas" />
            </>
          ) : (
            center
          )}
          <p className="sx-zone" data-side="a" aria-hidden="true">
            {F.zoneSel}
          </p>
          <p className="sx-zone" data-side="b" aria-hidden="true">
            {F.zoneTest}
            <small>{F.unseen}</small>
          </p>
        </div>
        {scene && overlay && (
          <div ref={result} className="sx-result" data-in="0" data-testid="search-overlay">
            {overlay}
          </div>
        )}
      </div>
      <div className="sx-foot">
        <small data-testid="search-caption">{caption}</small>
        <div>{actions}</div>
      </div>
      {children}
    </div>
  );
}
