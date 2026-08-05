import React from "react";
import { getPathLength } from "../lib/pathMath";

interface DrawnShapeProps {
  d: string;
  progress: number; // 0-1 reveal
  stroke?: string;
  strokeWidth?: number;
}

export const DrawnShape: React.FC<DrawnShapeProps> = ({
  d,
  progress,
  stroke = "#1A1A1A",
  strokeWidth = 3,
}) => {
  const length = getPathLength(d);
  const clamped = Math.max(0, Math.min(1, progress));
  if (length === 0) return null;
  return (
    <path
      d={d}
      fill="none"
      stroke={stroke}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeDasharray={length}
      strokeDashoffset={length * (1 - clamped)}
    />
  );
};
