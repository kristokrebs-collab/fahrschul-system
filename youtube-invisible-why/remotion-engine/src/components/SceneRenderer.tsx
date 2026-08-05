import React from "react";
import { AbsoluteFill } from "remotion";
import { Scene, CANVAS_WIDTH, CANVAS_HEIGHT } from "../types";
import { IconOnPaper } from "./IconOnPaper";
import { AnimatedHand } from "./AnimatedHand";
import { TextOverlay } from "./TextOverlay";
import { getIconTipPoint } from "../icons/geometry";

interface SceneRendererProps {
  scene: Scene;
  accentColor: string;
  localFrame: number;
  durationInFrames: number;
}

interface LayoutSlot {
  x: number;
  y: number;
  size: number;
}

// MVP auto-layout: spreads this scene's drawing_elements evenly across a
// centered row. A real production pass would let the Storyboard Agent (or a
// human) supply explicit per-element x/y — see remotion-engine/README.md
// "Known limitations." Keeping layout here (not in the storyboard schema)
// means today's storyboards render immediately without needing that pass.
// The row is biased left of centre rather than centred: the hand reaches
// roughly 260px right and below its own pen tip, so a centred row puts the
// hand half off-canvas whenever it draws the rightmost element. The bias
// also reads better compositionally — the drawing sits in frame with the
// hand entering the space it left.
const HAND_CLEARANCE = 150;

function layoutElements(n: number): LayoutSlot[] {
  if (n === 0) return [];
  const usableWidth = CANVAS_WIDTH * 0.58;
  const centreX = CANVAS_WIDTH / 2 - HAND_CLEARANCE / 2;
  const startX = centreX - usableWidth / 2;
  const spacing = n > 1 ? usableWidth / (n - 1) : 0;
  const size = n === 1 ? 460 : Math.max(200, 420 - n * 28);
  return Array.from({ length: n }).map((_, i) => ({
    x: n === 1 ? centreX : startX + spacing * i,
    y: CANVAS_HEIGHT / 2 - 40,
    size,
  }));
}

// How much of an element's time slot is spent actually drawing. The rest
// is hold time — the finished drawing sitting on the page while the
// narration catches up. Below ~0.6 the pen reads as confident and quick;
// at 1.0 (the old behaviour) it crawls for the entire scene and the hand
// never leaves frame.
const DRAW_FRACTION = 0.58;
// Consecutive elements overlap slightly so the pen keeps moving between
// them instead of pausing dead.
const SLOT_OVERLAP = 0.78;

// Mild ease-out: the stroke leaves the nib fast and settles at the end,
// which is how a real pen stroke lands and reads noticeably quicker than
// a linear reveal even at the same duration.
const easeOut = (t: number) => 1 - Math.pow(1 - t, 1.7);

export const SceneRenderer: React.FC<SceneRendererProps> = ({
  scene,
  accentColor,
  localFrame,
  durationInFrames,
}) => {
  const elements = scene.drawing_elements.filter((e) => !e.startsWith("NEW_ASSET_NEEDED"));
  const positions = layoutElements(elements.length);
  const n = elements.length;
  const perSlot = durationInFrames / Math.max(1, n);

  type Tip = { canvasX: number; canvasY: number; angle: number };
  // Collected per-icon rather than mutating a single outer `let` from
  // inside the map callback — TS can't narrow a closure-mutated variable
  // at the usage site below, so we derive `handTip` via .find() instead.
  const tipCandidates: Array<Tip | null> = [];

  const iconRenders = elements.map((name, i) => {
    const slotStart = i * perSlot * SLOT_OVERLAP;
    const slotDuration = perSlot * DRAW_FRACTION;
    const rawProgress = (localFrame - slotStart) / slotDuration;
    const progress = easeOut(Math.max(0, Math.min(1, rawProgress)));
    const pos = positions[i];

    let tipForThisIcon: Tip | null = null;
    // The hand is only on screen while this element is genuinely being
    // drawn — once the stroke lands it lifts away instead of hovering
    // over finished art for the rest of the scene.
    if (rawProgress >= 0 && rawProgress < 1) {
      const tip = getIconTipPoint(name, progress);
      if (tip) {
        tipForThisIcon = {
          canvasX: pos.x - pos.size / 2 + (tip.x / 100) * pos.size,
          canvasY: pos.y - pos.size / 2 + (tip.y / 100) * pos.size,
          angle: tip.angle - 90,
        };
      }
    }
    tipCandidates.push(tipForThisIcon);

    return (
      <IconOnPaper
        key={name + i}
        name={name}
        x={pos.x}
        y={pos.y}
        size={pos.size}
        progress={progress}
        accentColor={accentColor}
        useAccent={i === n - 1}
      />
    );
  });

  const handTip = [...tipCandidates].reverse().find((t): t is Tip => t !== null) ?? null;

  const textStartFrame = Math.floor(durationInFrames * 0.22);

  return (
    <AbsoluteFill>
      {iconRenders}
      {handTip && (
        <AnimatedHand
          tipX={handTip.canvasX}
          tipY={handTip.canvasY}
          visible
          accent={accentColor}
        />
      )}
      {scene.on_screen_text && (
        <TextOverlay
          text={scene.on_screen_text}
          localFrame={localFrame - textStartFrame}
          accentColor={accentColor}
        />
      )}
    </AbsoluteFill>
  );
};
