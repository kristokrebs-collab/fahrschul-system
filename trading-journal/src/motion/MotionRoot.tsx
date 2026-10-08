import { MotionConfig } from "motion/react";
import type { ReactNode } from "react";
import { RootLayoutGroup } from "@/motion/NoLayoutCascade";
import { useTempoProbe } from "@/motion/physics";
import { spring } from "@/motion/tokens";

/**
 * App-level motion root (Plan 3.1): `reducedMotion="user"`, `spring.smooth` as the default transition
 * for every `motion` element without its own, and ONE id-less layout group so siblings outside an
 * `AnimatePresence` are notified of layout changes. `layoutId`s are NOT prefixed – collisions are
 * avoided by naming and conditions (see README "layoutId contracts"). The group is `RootLayoutGroup`: Motion's
 * `LayoutGroup` without its `forceRender`, so a finished exit anywhere never re-renders the whole app (every motion
 * component reads the group context); subtrees that need the cascade opt in with `LayoutCascade`
 * (`src/motion/NoLayoutCascade.tsx`). It also installs the passive pointer-tempo probe
 * (`useTempoProbe`, `@/motion/physics`) for the app's lifetime, so context springs and the dock's press tempo have data
 * from the first interaction and `lastPointerType()` can tell real mouse hover from touch-emulated mouse events.
 */
export function MotionRoot({ children }: { children: ReactNode }) {
  useTempoProbe();
  return (
    <MotionConfig reducedMotion="user" transition={spring.smooth}>
      <RootLayoutGroup>{children}</RootLayoutGroup>
    </MotionConfig>
  );
}
