/**
 * What a surface (Markt chart, trade replay) reads from the mirror state: the view to draw, what is covered, and whether
 * its picture is frozen. Pure derivation `mirrorStateOf` + the hook.
 */
import { useMemo } from "react";
import { chartMirrorOf, clipAtAnchor, type ChartMirror, type MirrorLayers, type MirrorView } from "@/chart/mirror";
import { NO_BLIND, type BiasBlind, type BiasSurface } from "@/domain/biasTest";
import { useBiasUi, type Flow, type Phase, type SurfacePrefs } from "./flowStore";

export interface MirrorState {
  view: MirrorView;
  /** what the chart needs (flat) */
  chart: ChartMirror;
  /** what is covered right now – nothing once the original view is uncovered */
  blind: BiasBlind;
  /** the picture is frozen at `anchorMs` (steps 1 and 2): no live data, no later bars */
  frozen: boolean;
  anchorMs: number | null;
  phase: Phase | null;
  /** a test runs on this surface (setup included) */
  testing: boolean;
}

/** The state of one surface from the store's pieces. Step 1 and the reveal show the original, step 2 the mirror. */
export function mirrorStateOf(surface: BiasSurface, flipped: boolean, prefs: SurfacePrefs, flow: Flow | null): MirrorState {
  const mine = flow && flow.surface === surface ? flow : null;
  const phase = mine?.phase ?? null;
  const running = phase === "first" || phase === "flipped";
  // a running test fixes layers and the RSI option; otherwise the free choice of the trader
  const layers: MirrorLayers = running && mine ? mine.layers : prefs.layers;
  const rsiMirrored = running && mine ? mine.rsiMirrored : prefs.rsiMirrored;
  const isFlipped = mine && (phase === "first" || phase === "revealed" || phase === "setup") ? false : phase === "flipped" ? true : flipped;
  const view: MirrorView = { flipped: isFlipped, rsiMirrored, layers };
  const blind = running && mine ? mine.blind : NO_BLIND;
  return { view, chart: chartMirrorOf(view, blind.neutralColors), blind, frozen: running, anchorMs: running ? (mine?.context?.anchorMs ?? null) : null, phase, testing: mine != null };
}

export function useMirrorState(surface: BiasSurface): MirrorState {
  const flipped = useBiasUi((s) => s.flipped[surface]);
  const prefs = useBiasUi((s) => s.prefs[surface]);
  const flow = useBiasUi((s) => s.flow);
  const mine = flow && flow.surface === surface ? flow : null;
  // primitives only: the memo below must not change for typing in the answer fields
  const phase = mine?.phase ?? null;
  const layersKey = mine ? JSON.stringify(mine.layers) : "";
  const blindKey = mine ? JSON.stringify(mine.blind) : "";
  const anchor = mine?.context?.anchorMs ?? null;
  const rsiM = mine?.rsiMirrored ?? false;
  return useMemo(
    () => mirrorStateOf(surface, flipped, prefs, mine),
    // `mine` itself changes with every keystroke of the draft; the fields the state reads are listed instead
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [surface, flipped, prefs, phase, layersKey, blindKey, anchor, rsiM],
  );
}

/**
 * Bars of a frozen picture: only up to the anchor (everything later is the future), and the SAME array while the closed
 * part does not change – a feed that appends a bar must not make the chart reload its history.
 */
export function useFrozenBars<T extends { time: number }>(bars: readonly T[], anchorMs: number | null): readonly T[] {
  const clipped = anchorMs == null ? null : clipAtAnchor(bars, anchorMs);
  const key = clipped ? `${anchorMs}:${clipped.length}:${clipped[0]?.time ?? 0}` : "";
  // the closed bars below the anchor never change; the key names them
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stable = useMemo(() => clipped, [key]);
  return anchorMs == null ? bars : (stable ?? bars);
}
