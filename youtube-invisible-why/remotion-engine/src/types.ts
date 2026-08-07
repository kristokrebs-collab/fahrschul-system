export type CameraMove =
  | "static"
  | "slow zoom in"
  | "slow zoom out"
  | "pan left"
  | "pan right"
  | "zoom out to reveal";

export interface Scene {
  scene: number;
  start: number; // seconds
  duration: number; // seconds
  narration: string;
  visual: string;
  drawing_elements: string[];
  on_screen_text: string | null;
  camera: CameraMove;
  sound_effect?: string | null;
  /**
   * Start this scene with its first element already largely drawn instead of
   * on blank paper. Set on the opening scene: a cold open that begins with an
   * empty page spends its most valuable second showing nothing, and the hook
   * on the channels that win this format is always visual.
   */
  open_prehydrated?: boolean;
}

export interface Storyboard {
  video_id: string;
  accent_color: string;
  scenes: Scene[];
}

export const FPS = 30;
export const CANVAS_WIDTH = 1920;
export const CANVAS_HEIGHT = 1080;

export const totalDurationInFrames = (storyboard: Storyboard): number => {
  const last = storyboard.scenes[storyboard.scenes.length - 1];
  if (!last) return FPS * 10;
  return Math.ceil((last.start + last.duration) * FPS);
};
