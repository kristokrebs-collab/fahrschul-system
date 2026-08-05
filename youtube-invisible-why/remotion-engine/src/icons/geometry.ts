import { ICONS } from "./index";
import { getPointAtProgress, PathPoint } from "../lib/pathMath";

// Given overall reveal progress (0-1) for an icon, find which of its
// sub-paths is currently "being drawn" and return the point on that path —
// this is what the hand tracks. Paths before it are treated as fully drawn,
// paths after as not yet started (see IconOnPaper for the matching visual
// reveal logic, which must use the same segmentation).
export function getIconTipPoint(name: string, progress: number): PathPoint | null {
  const icon = ICONS[name];
  if (!icon || icon.paths.length === 0) return null;
  const n = icon.paths.length;
  const clamped = Math.max(0, Math.min(0.999, progress));
  const idx = Math.min(n - 1, Math.floor(clamped * n));
  const segStart = idx / n;
  const segEnd = (idx + 1) / n;
  const segProgress = (clamped - segStart) / (segEnd - segStart);
  return getPointAtProgress(icon.paths[idx], segProgress);
}
