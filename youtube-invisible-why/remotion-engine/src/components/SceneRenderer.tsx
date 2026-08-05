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
function layoutElements(n: number): LayoutSlot[] {
  if (n === 0) return [];
  const usableWidth = CANVAS_WIDTH * 0.68;
  const startX = CANVAS_WIDTH / 2 - usableWidth / 2;
  const spacing = n > 1 ? usableWidth / (n - 1) : 0;
  const size = n === 1 ? 460 : Math.max(200, 420 - n * 28);
  return Array.from({ length: n }).map((_, i) => ({
    x: n === 1 ? CANVAS_WIDTH / 2 : startX + spacing * i,
    y: CANVAS_HEIGHT / 2 - 30,
    size,
  }));
}

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
    // 30% overlap between consecutive elements keeps the hand moving
    // continuously instead of pausing dead between icons.
    const slotStart = i * perSlot * 0.7;
    const slotDuration = perSlot * 1.4;
    const rawProgress = (localFrame - slotStart) / slotDuration;
    const progress = Math.max(0, Math.min(1, rawProgress));
    const pos = positions[i];

    let tipForThisIcon: Tip | null = null;
    if (rawProgress >= 0 && rawProgress < 1.1) {
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
        <AnimatedHand tipX={handTip.canvasX} tipY={handTip.canvasY} visible angle={-38} />
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
