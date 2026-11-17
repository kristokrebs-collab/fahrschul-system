/**
 * Apple-style physics, ADDITIVE to the tuned tokens (see README "Physics"): Apple spring conversion, release and
 * context springs, a weighted least-squares velocity tracker, UIScrollView projection, the iOS rubber band, commit
 * rules, a passive global pointer-tempo probe, and the `useAxisDrag` / `useSwipeDismiss` hooks.
 * Import from `@/motion/physics`.
 */
export { physics, type PhysicsTuning } from "@/motion/physics/constants";
export {
  appleSpring,
  appleParams,
  appleParamsOf,
  dampingRatio,
  physicsOf,
  motionTimeSpring,
  isSpring,
  isTimeDefined,
  smoothstep,
  tempoOf,
  releaseSpring,
  flingSpring,
  contextSpring,
  contextSpringAt,
  mixSpring,
  pressTempo,
  progressVelocity,
  type PhysicsSpring,
  type VelocitySpring,
  type FlingSpring,
  type AppleParams,
} from "@/motion/physics/apple";
export {
  clamp,
  project,
  projectPoint,
  decayInertia,
  rubberBand,
  rubberBandInverse,
  rubberClamp,
  dismissThreshold,
  swipeDecision,
  flickDecision,
  nearestIndex,
  snapIndex,
  flickStep,
  axisLock,
  type SwipeDecisionInput,
  type FlickStepInput,
  type AxisLock,
} from "@/motion/physics/gesture";
export { createVelocityTracker, type VelocityTracker, type VelocityTrackerOptions, type PointerSampleSource } from "@/motion/physics/velocity";
export {
  inputSpeed,
  installTempo,
  tempoInstalled,
  pointerSpeed,
  pointerTempo,
  lastPointerType,
  lastPressMs,
  setNavTempo,
  consumeNavTempo,
  haptic,
  useTempoProbe,
  type PointerKind,
} from "@/motion/physics/tempo";
export {
  useAxisDrag,
  springTo,
  DEFAULT_DRAG_IGNORE,
  type DragAxis,
  type AxisXY,
  type AxisDragStart,
  type AxisDragMove,
  type AxisDragRelease,
  type AxisDragReleaseResult,
  type UseAxisDragOptions,
  type AxisDragHandlers,
  type AxisDrag,
} from "@/motion/physics/useAxisDrag";
export { useSwipeDismiss, flingExit, flingValue, type SwipeDismissInfo, type UseSwipeDismissOptions, type SwipeDismiss } from "@/motion/physics/useSwipeDismiss";
