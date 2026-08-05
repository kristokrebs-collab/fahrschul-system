import React from "react";
import { Composition } from "remotion";
import { MainVideo } from "./MainVideo";
import { CANVAS_WIDTH, CANVAS_HEIGHT, FPS, totalDurationInFrames, Storyboard } from "./types";
import sampleStoryboard from "./storyboards/sample.json";

// Remotion's <Composition> generic requires Props to satisfy
// Record<string, unknown> (an index signature) — Storyboard is otherwise a
// precisely-typed interface, so we widen only at this JSX boundary rather
// than loosening the interface everywhere it's used.
type CompositionProps = Storyboard & Record<string, unknown>;

export const RemotionRoot: React.FC = () => {
  const initial = sampleStoryboard as CompositionProps;
  return (
    <Composition<any, CompositionProps>
      id="MainVideo"
      component={MainVideo}
      fps={FPS}
      width={CANVAS_WIDTH}
      height={CANVAS_HEIGHT}
      durationInFrames={totalDurationInFrames(initial)}
      defaultProps={initial}
      calculateMetadata={async ({ props }) => {
        return { durationInFrames: totalDurationInFrames(props) };
      }}
    />
  );
};
