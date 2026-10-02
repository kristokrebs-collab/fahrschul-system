import { CONFIG } from "@/intro/introConfig";
import { appPose, introRoot, landAllCells, prepareFlight, type Flight } from "@/intro/flight";
import { createPortal, measureCounter, type Portal, type PortalSetup } from "@/intro/portal";
import { clamp01, createFrameLoop, easeOutCubic, lerp } from "@/motion/pulse/engine";

/**
 * The intro timeline: one rAF loop, a pure function of the elapsed wall-clock time (the A1 text primitives started
 * in the same commit run on the same clock). Writes only transform / opacity / filter (plus a one-off placement of
 * the marker, the reel window and the canvas at start), every write cached; React only hears about discrete beats
 * (typewriter start, phases, cell landings).
 */

export interface StageRefs {
  overlay: HTMLElement;
  grid: HTMLElement;
  canvas: HTMLCanvasElement;
  scene: HTMLElement;
  group: HTMLElement;
  top: HTMLElement;
  bottom: HTMLElement;
  statement: HTMLElement;
  win: HTMLElement;
  glow: HTMLElement;
  reels: HTMLElement[];
  marker: HTMLElement;
  dot: HTMLElement;
  pings: HTMLElement[];
  square: HTMLElement;
  pill: HTMLElement;
  /** wrappers of the two AsciiCascade rows (their glyph cells give the exact positions for the canvas and the dive) */
  textTop: HTMLElement;
  textBottom: HTMLElement;
}

export interface DirectorEvents {
  onType(): void;
  onBuild(): void;
  onDone(): void;
}

export interface Director {
  skip(): void;
  destroy(): void;
}

const R = CONFIG.reels;
const T_COLLAPSE = R.startAt + R.collapseAt;
const T_PORTAL = T_COLLAPSE + R.collapseDur + CONFIG.portal.gap;
const T_FLIGHT = T_PORTAL + CONFIG.flight.startAt;

/** Beat boundaries (ms) – exported for tests and the e2e timing. */
export const BEATS = { collapse: T_COLLAPSE, portal: T_PORTAL, flight: T_FLIGHT, portalEnd: T_PORTAL + CONFIG.portal.dur } as const;

/** Window scale (open × collapse, both ease-out cubic) and the reel shown at `t`; -1 = window closed. */
export function reelState(t: number): { scale: number; reel: number; collapse: number } {
  const open = easeOutCubic((t - R.openAt) / R.openDur);
  const collapse = easeOutCubic((t - T_COLLAPSE) / R.collapseDur);
  const scale = t < R.openAt ? 0 : open * (1 - collapse);
  let reel = 0;
  const local = t - R.startAt;
  for (let i = 0; i < R.starts.length; i++) if (local >= R.starts[i]!) reel = i;
  return { scale, reel: scale <= 0.002 ? -1 : reel, collapse };
}

function cache() {
  const m = new Map<object, Record<string, string>>();
  return (el: HTMLElement | SVGElement, prop: "transform" | "opacity" | "filter" | "visibility", v: string) => {
    let rec = m.get(el);
    if (!rec) m.set(el, (rec = {}));
    if (rec[prop] === v) return;
    rec[prop] = v;
    el.style[prop] = v;
  };
}

function fontMetrics(font: string, text: string): { asc: number; desc: number; cap: number } {
  const c = document.createElement("canvas").getContext("2d");
  if (!c) return { asc: 0.8, desc: 0.2, cap: 0.7 };
  c.font = font;
  const m = c.measureText(text);
  return { asc: m.fontBoundingBoxAscent, desc: m.fontBoundingBoxDescent, cap: m.actualBoundingBoxAscent };
}

/** Glyph cells of the first (grey) AsciiCascade layer: one inline-block per character, untransformed at start. */
function cellsOf(row: HTMLElement): HTMLElement[] {
  const layer = row.querySelector('[data-pulse="ascii-cascade"] > span[aria-hidden] > span');
  return layer ? (Array.from(layer.children) as HTMLElement[]) : [];
}

interface RowGeo {
  left: number;
  baseline: number;
  inkTop: number;
}

function rowGeo(row: HTMLElement, fm: { asc: number; desc: number; cap: number }): { geo: RowGeo; cells: DOMRect[] } {
  const cells = cellsOf(row).map((c) => c.getBoundingClientRect());
  const box = cells[0] ?? row.getBoundingClientRect();
  // CSS baseline of an inline-block cell: half-leading above the font's ascent
  const baseline = box.top + (box.height - (fm.asc + fm.desc)) / 2 + fm.asc;
  return { geo: { left: box.left, baseline, inkTop: baseline - fm.cap }, cells };
}

export function createDirector(refs: StageRefs, ev: DirectorEvents): Director {
  const put = cache();
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // ---- one-off geometry (fonts are loaded; nothing is transformed yet) ----
  const cs = getComputedStyle(refs.textBottom.querySelector('[data-pulse="ascii-cascade"]') ?? refs.textBottom);
  const sizePx = parseFloat(cs.fontSize) || 64;
  const font = `${cs.fontStyle} ${cs.fontWeight} ${sizePx}px ${cs.fontFamily}`;
  const letterSpacing = cs.letterSpacing === "normal" ? "0px" : cs.letterSpacing;
  const fm = fontMetrics(font, CONFIG.wordmark.top + CONFIG.wordmark.bottom);
  const { geo: topGeo } = rowGeo(refs.textTop, fm);
  const { geo: botGeo, cells: botCells } = rowGeo(refs.textBottom, fm);
  const botRect = refs.textBottom.getBoundingClientRect();
  const groupRect = refs.group.getBoundingClientRect();
  const dive = botCells[CONFIG.wordmark.dive.index];
  const counter = measureCounter(font);
  const ox = dive ? dive.left + dive.width / 2 : botRect.left + botRect.width * 0.21;
  const oy = botGeo.baseline + counter.cy * sizePx;
  const r0 = Math.max(4, counter.r * sizePx);
  // marker (signal dot + rotating square) sits on the counter, in the bottom row's coordinates
  refs.marker.style.left = `${ox - botRect.left}px`;
  refs.marker.style.top = `${oy - botRect.top}px`;
  refs.square.style.width = refs.square.style.height = `${Math.round(r0 * 2 + sizePx * 0.18)}px`;
  // reel window between the rows (centred between the inks: caps sit low in Doto's line box)
  const topInkBottom = topGeo.baseline;
  const gap = botGeo.inkTop - topInkBottom;
  const winW = Math.min(vw * 0.84, 600, (vh * 0.4 * R.w) / R.h, Math.max(260, (R.w * vw) / 1234));
  const winH = (winW * R.h) / R.w;
  const mid = (topInkBottom + botGeo.inkTop) / 2;
  refs.win.style.width = `${winW}px`;
  refs.win.style.height = `${winH}px`;
  refs.win.style.left = `${(groupRect.width - winW) / 2}px`;
  refs.win.style.top = `${mid - groupRect.top - winH / 2}px`;
  const part = winH / 2 + R.padPx - gap / 2;
  // aim: during the collapse the wordmark glides so the dive point lands on the viewport centre
  const aimX = vw / 2 - ox;
  const aimY = vh / 2 - oy;

  let portal: Portal | null = null;
  let flight: Flight | null = null;
  let typed = false;
  let built = false;
  let finished = false;
  let portalDone = false;
  let skipAt = -1;
  let skipFrom = { overlay: 1, scale: 1, blur: 0 };
  let appNow = { scale: 1, blur: 0 };
  const t0 = performance.now();

  function setApp(scale: number, blur: number) {
    const root = introRoot();
    appNow = { scale, blur };
    if (!root) return;
    if (scale === 1 && blur <= 0.01) {
      root.style.transform = "";
      root.style.filter = "";
      root.style.willChange = "";
      return;
    }
    root.style.transform = `scale(${scale.toFixed(4)})`;
    root.style.filter = blur > 0.01 ? `blur(${blur.toFixed(2)}px)` : "";
  }

  function startPortal() {
    const root = introRoot();
    let origin = "";
    if (root) {
      const rr = root.getBoundingClientRect();
      origin = `${(vw / 2 - rr.left).toFixed(1)}px ${(vh / 2 - rr.top).toFixed(1)}px`;
    }
    flight = prepareFlight(vw, vh);
    if (root) {
      root.style.transformOrigin = origin;
      root.style.willChange = "transform";
    }
    const setup: PortalSetup = {
      vw,
      vh,
      dpr: Math.min(window.devicePixelRatio || 1, CONFIG.portal.maxDpr),
      font,
      letterSpacing,
      rows: [
        { text: CONFIG.wordmark.top, x: topGeo.left + aimX, baseline: topGeo.baseline + aimY },
        { text: CONFIG.wordmark.bottom, x: botGeo.left + aimX, baseline: botGeo.baseline + aimY },
      ],
      ox: vw / 2,
      oy: vh / 2,
      r0,
    };
    portal = createPortal(refs.canvas, setup);
    put(refs.canvas, "visibility", "visible");
    refs.overlay.style.background = "transparent";
    put(refs.grid, "opacity", "0");
  }

  function endStage() {
    if (built) return;
    built = true;
    put(refs.overlay, "visibility", "hidden");
    portal?.destroy();
    portal = null;
    ev.onBuild();
  }

  function finish() {
    if (finished) return;
    finished = true;
    loop.stop();
    if (flight) flight.finish();
    else landAllCells();
    setApp(1, 0);
    const root = introRoot();
    if (root) root.style.transformOrigin = "";
    endStage();
    ev.onDone();
  }

  function render(t: number) {
    // signal: grid, marker square, dot pop + pings
    put(refs.grid, "opacity", clamp01((t - CONFIG.stage.gridIn[0]) / (CONFIG.stage.gridIn[1] - CONFIG.stage.gridIn[0])).toFixed(3));
    const sq = CONFIG.square;
    const sqIn = clamp01((t - sq.fadeIn[0]) / (sq.fadeIn[1] - sq.fadeIn[0]));
    const sqOut = 1 - clamp01((t - T_PORTAL) / CONFIG.portal.squareOut);
    put(refs.square, "opacity", (sqIn * sqOut).toFixed(3));
    put(refs.square, "transform", `translate(-50%,-50%) rotate(${(sq.rot0 + (sq.degPerSec * t) / 1000).toFixed(2)}deg)`);
    put(refs.dot, "transform", `translate(-50%,-50%) scale(${easeOutCubic(t / CONFIG.signal.popMs).toFixed(3)})`);
    refs.pings.forEach((p, i) => {
      const q = (t - (CONFIG.signal.pings[i] ?? 0)) / CONFIG.signal.pingMs;
      const on = q > 0 && q < 1;
      put(p, "opacity", on ? (0.7 * (1 - q)).toFixed(3) : "0");
      if (on) put(p, "transform", `translate(-50%,-50%) scale(${(1 + (CONFIG.signal.pingScale - 1) * easeOutCubic(q)).toFixed(3)})`);
    });
    put(refs.pill, "opacity", clamp01((t - CONFIG.pillIn[0]) / (CONFIG.pillIn[1] - CONFIG.pillIn[0])).toFixed(3));

    if (!typed && t >= CONFIG.type.at) {
      typed = true;
      ev.onType();
    }

    // reels: window opens between the rows, hard cuts, collapses (scaleY); the rows frame its edges
    const rs = reelState(t);
    const off = part * rs.scale;
    put(refs.top, "transform", `translate3d(0,${(-off).toFixed(2)}px,0)`);
    put(refs.bottom, "transform", `translate3d(0,${off.toFixed(2)}px,0)`);
    put(refs.win, "visibility", rs.reel < 0 ? "hidden" : "visible");
    put(refs.win, "transform", `scale(1,${Math.max(0.002, rs.scale).toFixed(4)})`);
    put(refs.glow, "opacity", (clamp01((t - R.openAt) / R.glowMs) * (1 - rs.collapse)).toFixed(3));
    refs.reels.forEach((el, i) => put(el, "visibility", i === rs.reel ? "visible" : "hidden"));
    put(refs.statement, "opacity", (1 - clamp01((t - T_COLLAPSE) / R.statementOut)).toFixed(3));
    put(refs.group, "transform", `translate3d(${(aimX * rs.collapse).toFixed(2)}px,${(aimY * rs.collapse).toFixed(2)}px,0)`);

    // portal: canvas takes over the stage, the dive opens the counter onto the real app
    if (t >= T_PORTAL && !portalDone) {
      if (!portal && !built) startPortal();
      const u = clamp01((t - T_PORTAL) / CONFIG.portal.dur);
      // the canvas wordmark is registered on the DOM one: it is fully there at once, the DOM layer fades off it
      const textA = 1;
      put(refs.scene, "opacity", (1 - clamp01((t - T_PORTAL) / CONFIG.portal.textFade)).toFixed(3));
      const open = clamp01((t - T_PORTAL) / CONFIG.portal.openDur);
      const rim = 1 - clamp01((u - 0.15) / 0.5);
      const covered = portal ? portal.draw(u, open, textA, rim) : u >= 1;
      const a = appPose(u);
      setApp(a.scale, a.blur);
      if (covered || u >= 1) endStage();
      if (u >= 1) portalDone = true;
    }
    if (flight && t >= T_FLIGHT) {
      const busy = flight.step(t - T_FLIGHT);
      if (!busy && portalDone) {
        finish();
        return false;
      }
    } else if (portalDone && !flight) {
      finish();
      return false;
    }
    return true;
  }

  function settle(now: number) {
    const e = clamp01((now - skipAt) / CONFIG.skip.ms);
    put(refs.overlay, "opacity", (skipFrom.overlay * (1 - clamp01((now - skipAt) / CONFIG.skip.overlayMs))).toFixed(3));
    flight?.settle(e);
    const k = easeOutCubic(e);
    setApp(lerp(skipFrom.scale, 1, k), lerp(skipFrom.blur, 0, k));
    if (e >= 1) {
      finish();
      return false;
    }
    return true;
  }

  const loop = createFrameLoop((_dt, now) => (skipAt >= 0 ? settle(now) : render(now - t0)));
  render(0);
  loop.wake();

  return {
    skip() {
      if (finished || skipAt >= 0) return;
      skipAt = performance.now();
      skipFrom = { overlay: built ? 0 : 1, scale: appNow.scale, blur: appNow.blur };
      if (!built) {
        built = true;
        ev.onBuild();
      }
      loop.wake();
    },
    destroy() {
      loop.stop();
      portal?.destroy();
      if (!finished) {
        if (flight) flight.finish();
        else landAllCells();
        setApp(1, 0);
        const root = introRoot();
        if (root) root.style.transformOrigin = "";
      }
    },
  };
}
