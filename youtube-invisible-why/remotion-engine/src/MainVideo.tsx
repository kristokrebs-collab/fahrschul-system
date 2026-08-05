import React from "react";
import { AbsoluteFill, Sequence, useCurrentFrame } from "remotion";
import { Paper } from "./components/Paper";
import { CameraRig } from "./components/CameraRig";
import { SceneRenderer } from "./components/SceneRenderer";
import { Scene, Storyboard, FPS } from "./types";

const SceneInner: React.FC<{ scene: Scene; accentColor: string; durationInFrames: number }> = ({
  scene,
  accentColor,
  durationInFrames,
}) => {
  const localFrame = useCurrentFrame();
  return (
    <CameraRig camera={scene.camera} localFrame={localFrame} durationInFrames={durationInFrames}>
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
      {scenes.map((scene) => {
        const from = Math.round(scene.start * FPS);
        const durationInFrames = Math.max(1, Math.round(scene.duration * FPS));
        return (
          <Sequence key={scene.scene} from={from} durationInFrames={durationInFrames} name={`Scene ${scene.scene}`}>
            <SceneInner scene={scene} accentColor={accent_color} durationInFrames={durationInFrames} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
