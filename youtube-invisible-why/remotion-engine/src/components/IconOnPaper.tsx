import React from "react";
import { ICONS } from "../icons";
import { DrawnShape } from "./DrawnShape";

interface IconOnPaperProps {
  name: string;
  x: number; // canvas center x
  y: number; // canvas center y
  size: number;
  progress: number; // 0-1 overall reveal for this icon
  accentColor: string;
  useAccent?: boolean; // draw the last stroke in the accent color (emphasis)
}

// Deterministic pseudo-random in [-1, 1] from a string. Used for the tilt
// below: it must be stable across frames (otherwise the icon vibrates) but
// different per icon, so it is derived from the name+position rather than
// from Math.random().
function jitter(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 2000) / 1000 - 1;
}

// Every path used to be stroked at a flat 3.2, which is why finished frames
// read as plotted rather than drawn. Real pen work has a heavy silhouette
// and lighter interior detail, so weight is now assigned by the path's role.
// The icon library authoring rule already guarantees the order we need:
// "outline first, then interior detail" (see icons/index.ts).
const OUTLINE_WEIGHT = 4.8;
const DETAIL_WEIGHT = 2.9;
const SHADOW_COLOR = "#C9BFA8";

export const IconOnPaper: React.FC<IconOnPaperProps> = ({
  name,
  x,
  y,
  size,
  progress,
  accentColor,
  useAccent = false,
}) => {
  const icon = ICONS[name];
  if (!icon) return null;
  const n = icon.paths.length;

  const tilt = jitter(`${name}:${Math.round(x)}`) * 1.6;
  const outlineProgress = n > 0 ? Math.max(0, Math.min(1, progress * n)) : 0;

  return (
    <svg
      viewBox={icon.viewBox}
      width={size}
      height={size}
      style={{
        position: "absolute",
        left: x - size / 2,
        top: y - size / 2,
        overflow: "visible",
        // A degree or two off-square. Perfectly axis-aligned shapes are the
        // single strongest "made by a machine" signal in line art.
        transform: `rotate(${tilt.toFixed(2)}deg)`,
      }}
    >
      {/* Contact shadow: the silhouette redrawn underneath, offset down-right
          and warm-grey, so the object sits ON the paper instead of floating.
          It tracks the outline's own reveal so it never appears early. */}
      <g transform="translate(1.6, 2.2)" opacity={0.55}>
        <DrawnShape
          d={icon.paths[0]}
          progress={outlineProgress}
          stroke={SHADOW_COLOR}
          strokeWidth={OUTLINE_WEIGHT + 1.4}
        />
      </g>

      {/* Accent wash under the emphasised element — colour as area, not just
          as a single coloured stroke. Fades in once the outline has closed,
          otherwise it would bleed outside an unfinished shape. */}
      {useAccent && outlineProgress >= 1 && (
        <path d={icon.paths[0]} fill={accentColor} opacity={0.16} stroke="none" />
      )}

      {icon.paths.map((d, i) => {
        const segStart = i / n;
        const segEnd = (i + 1) / n;
        const segProgress = (progress - segStart) / (segEnd - segStart);
        const isLast = i === n - 1;
        return (
          <DrawnShape
            key={i}
            d={d}
            progress={segProgress}
            stroke={useAccent && isLast ? accentColor : "#1A1A1A"}
            strokeWidth={i === 0 ? OUTLINE_WEIGHT : DETAIL_WEIGHT}
          />
        );
      })}
    </svg>
  );
};
