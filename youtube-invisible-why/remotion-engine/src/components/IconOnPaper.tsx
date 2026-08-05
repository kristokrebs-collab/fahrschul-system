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

  return (
    <svg
      viewBox={icon.viewBox}
      width={size}
      height={size}
      style={{ position: "absolute", left: x - size / 2, top: y - size / 2, overflow: "visible" }}
    >
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
            strokeWidth={3.2}
          />
        );
      })}
    </svg>
  );
};
