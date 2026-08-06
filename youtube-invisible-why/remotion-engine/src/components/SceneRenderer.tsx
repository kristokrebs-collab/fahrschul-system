import React from "react";
import { AbsoluteFill } from "remotion";
import { Scene, CANVAS_WIDTH, CANVAS_HEIGHT } from "../types";
import { IconOnPaper } from "./IconOnPaper";
import { Pen } from "./Pen";
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

// ---------------------------------------------------------------------------
// Layout: fill the page.
//
// The previous version spread every element along one horizontal row at a
// single size, biased left to keep the drawing hand on canvas. That did two
// bad things at once: it wasted the top and bottom thirds of a 1920x1080
// frame, and it made every scene the same shape, so twelve scenes in a row
// read as one scene playing twelve times.
//
// Replacing the hand with a bare pen removed the clearance constraint (the
// pen occludes roughly a tenth of the area), so composition is now free.
// Each element count gets its own arrangement with a deliberate hero — one
// element noticeably larger than the rest — because equal-sized objects in a
// grid read as a chart, and a hero reads as a picture.
//
// Bounds: x 6-94%, y 12-74%. The lower quarter stays clear for TextOverlay,
// which sits 90px off the bottom.
// ---------------------------------------------------------------------------
const W = CANVAS_WIDTH;
const H = CANVAS_HEIGHT;
const px = (fx: number, fy: number, size: number): LayoutSlot => ({ x: W * fx, y: H * fy, size });

// Sizes are large on purpose. An icon only inks roughly 60-70% of its own
// box (the paths sit inside the 0-100 viewBox with margin), so a "size" of
// 560 puts about 380px of actual line on the page. The first pass used
// 330-470 and left the bottom third of a 1080-high frame empty, which is
// the "page isn't full" problem — it was a scale problem, not a position
// problem, and spreading the same small icons further apart would only have
// made the holes bigger.
const LAYOUTS: Record<number, LayoutSlot[]> = {
  1: [px(0.5, 0.44, 820)],
  2: [px(0.29, 0.42, 700), px(0.72, 0.47, 620)],
  // triangle — two up, one down: the most stable three-object arrangement
  3: [px(0.21, 0.34, 580), px(0.63, 0.3, 660), px(0.43, 0.63, 540)],
  4: [px(0.19, 0.31, 540), px(0.56, 0.27, 620), px(0.81, 0.53, 500), px(0.36, 0.63, 520)],
  5: [px(0.15, 0.3, 470), px(0.43, 0.25, 560), px(0.76, 0.3, 500), px(0.27, 0.63, 470), px(0.64, 0.64, 500)],
  6: [px(0.14, 0.28, 430), px(0.4, 0.24, 500), px(0.69, 0.28, 450), px(0.19, 0.61, 430), px(0.47, 0.64, 470), px(0.77, 0.59, 420)],
};

function layoutElements(n: number): LayoutSlot[] {
  if (n === 0) return [];
  const preset = LAYOUTS[n];
  if (preset) return preset;
  // 7+: two rows, alternating size so it still reads as composed, not tiled.
  const perRow = Math.ceil(n / 2);
  return Array.from({ length: n }).map((_, i) => {
    const row = Math.floor(i / perRow);
    const col = i % perRow;
    const fx = 0.1 + (col / Math.max(1, perRow - 1)) * 0.8;
    return px(fx, row === 0 ? 0.29 : 0.62, i % 2 === 0 ? 430 : 380);
  });
}

// Pacing. The pen now spends 42% of an element's slot actually drawing and
// the slots overlap hard, so a six-element scene finishes its line work in
// roughly the first two-thirds of the scene instead of crawling to the last
// frame. Anything slower reads as waiting for the drawing to catch up with
// the narration, which is the specific complaint these values answer.
const DRAW_FRACTION = 0.42;
const SLOT_OVERLAP = 0.62;

// Ease-out: the stroke leaves the nib fast and settles. A linear reveal at
// the same duration reads noticeably slower than this does.
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

  type Tip = { canvasX: number; canvasY: number };
  const tipCandidates: Array<Tip | null> = [];

  const iconRenders = elements.map((name, i) => {
    const slotStart = i * perSlot * SLOT_OVERLAP;
    const slotDuration = perSlot * DRAW_FRACTION;
    const rawProgress = (localFrame - slotStart) / slotDuration;
    const progress = easeOut(Math.max(0, Math.min(1, rawProgress)));
    const pos = positions[i];

    let tipForThisIcon: Tip | null = null;
    // The pen is on screen only while this element is genuinely being drawn;
    // once the stroke lands it lifts away rather than hovering over finished
    // art for the rest of the scene.
    if (rawProgress >= 0 && rawProgress < 1) {
      const tip = getIconTipPoint(name, progress);
      if (tip) {
        tipForThisIcon = {
          canvasX: pos.x - pos.size / 2 + (tip.x / 100) * pos.size,
          canvasY: pos.y - pos.size / 2 + (tip.y / 100) * pos.size,
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

  const penTip = [...tipCandidates].reverse().find((t): t is Tip => t !== null) ?? null;

  const textStartFrame = Math.floor(durationInFrames * 0.18);

  return (
    <AbsoluteFill>
      {iconRenders}
      {penTip && <Pen tipX={penTip.canvasX} tipY={penTip.canvasY} visible accent={accentColor} />}
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
