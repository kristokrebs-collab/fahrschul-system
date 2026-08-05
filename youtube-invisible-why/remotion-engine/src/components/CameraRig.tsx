import React from "react";
import { interpolate } from "remotion";
import { CameraMove } from "../types";

interface CameraRigProps {
  camera: CameraMove;
  localFrame: number;
  durationInFrames: number;
  children: React.ReactNode;
}

// One continuous camera move per scene — hard cuts only happen at scene
// boundaries (channel-bible/visual-style.md). "zoom out to reveal" is the
// channel's signature move, reserved for Turn/Deeper Cause beats.
export const CameraRig: React.FC<CameraRigProps> = ({
  camera,
  localFrame,
  durationInFrames,
  children,
}) => {
  const progress = Math.max(0, Math.min(1, localFrame / Math.max(1, durationInFrames)));

  let scale = 1;
  let tx = 0;

  switch (camera) {
    case "slow zoom in":
      scale = interpolate(progress, [0, 1], [1, 1.14]);
      break;
    case "slow zoom out":
      scale = interpolate(progress, [0, 1], [1.14, 1]);
      break;
    case "zoom out to reveal":
      scale = interpolate(progress, [0, 1], [1.35, 0.82]);
      break;
    case "pan left":
      tx = interpolate(progress, [0, 1], [40, -140]);
      break;
    case "pan right":
      tx = interpolate(progress, [0, 1], [-40, 140]);
      break;
    case "static":
    default:
      break;
  }

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        transform: `scale(${scale}) translateX(${tx}px)`,
        transformOrigin: "center center",
      }}
    >
      {children}
    </div>
  );
};
