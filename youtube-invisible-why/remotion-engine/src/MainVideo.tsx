import React from "react";
import { AbsoluteFill, Sequence, useCurrentFrame } from "remotion";
import { Paper } from "./components/Paper";
import { CameraRig } from "./components/CameraRig";
import { SceneRenderer } from "./components/SceneRenderer";
import { Scene, Storyboard, FPS } from "./types";

// How the two preceding scenes sit behind the current one. Each step back
// is pushed further up-left and shrunk, so earlier work reads as "already on
// the page, further along" instead of stacking exactly on top of the new
// elements — the layouts are deterministic per element count, so an
// un-transformed ghost would land precisely under the live drawing and turn
// into mush.
// The two ghosts travel in OPPOSITE directions. Sending both up-left piled
// them into one corner and left the bottom-right half of the frame as dead
// space — the exact emptiness this feature exists to remove.
const GHOSTS = [
  { opacity: 0.2, scale: 0.72, x: -330, y: -180 },
  { opacity: 0.13, scale: 0.6, x: 400, y: 250 },
];

const SceneInner: React.FC<{
  scene: Scene;
  previous: Scene[];
  accentColor: string;
  durationInFrames: number;
}> = ({ scene, previous, accentColor, durationInFrames }) => {
  const localFrame = useCurrentFrame();
  return (
    <CameraRig camera={scene.camera} localFrame={localFrame} durationInFrames={durationInFrames}>
      {previous.map((prev, i) => {
        const g = GHOSTS[i];
        return (
          <div
            key={`ghost-${prev.scene}`}
            style={{
              position: "absolute",
              inset: 0,
              opacity: g.opacity,
              transform: `translate(${g.x}px, ${g.y}px) scale(${g.scale})`,
              transformOrigin: "center center",
            }}
          >
            <SceneRenderer
              scene={prev}
              accentColor={accentColor}
              localFrame={0}
              durationInFrames={durationInFrames}
              ghost
            />
          </div>
        );
      })}
      <SceneRenderer
        scene={scene}
        accentColor={accentColor}
        localFrame={localFrame}
        durationInFrames={durationInFrames}
      />
    </CameraRig>
  );
};

// Props match the Storyboard shape directly (video_id/accent_color/scenes
// at the top level) — the same shape the Storyboard Agent writes to
// storyboards/<id>.json and that n8n's "Trigger Remotion Render" node
// passes via --props=storyboards/<id>.json. No wrapper object, so a
// storyboard file can be passed straight through without reshaping it.
export const MainVideo: React.FC<Storyboard> = ({ accent_color, scenes }) => {
  return (
    <AbsoluteFill style={{ backgroundColor: "#F5F0E6" }}>
      <Paper />
      {scenes.map((scene, i) => {
        const from = Math.round(scene.start * FPS);
        const durationInFrames = Math.max(1, Math.round(scene.duration * FPS));
        // Most-recent first, so GHOSTS[0] is always the scene just finished.
        const previous = scenes.slice(Math.max(0, i - 2), i).reverse();
        return (
          <Sequence key={scene.scene} from={from} durationInFrames={durationInFrames} name={`Scene ${scene.scene}`}>
            <SceneInner
              scene={scene}
              previous={previous}
              accentColor={accent_color}
              durationInFrames={durationInFrames}
            />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
