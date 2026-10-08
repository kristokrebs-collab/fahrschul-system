import { MotionConfig } from "motion/react";
import type { ReactNode } from "react";
import { useTempoProbe } from "@/motion/physics";
import { spring } from "@/motion/tokens";

/**
 * App-level motion root (Plan 3.1): `reducedMotion="user"`, `spring.smooth` as the default transition
 * for every `motion` element without its own. NO layout group: `layoutId`s are global (the projection tree has one root
 * for the document) and NOT prefixed – collisions are avoided by naming and conditions (see README "layoutId contracts").
 * A layout change measures only the nodes that changed, a finished exit re-renders nobody; subtrees whose nodes must
 * glide together opt into a scoped group with `LayoutCascade` (`src/motion/NoLayoutCascade.tsx`). It also installs the
 * passive pointer-tempo probe
 * (`useTempoProbe`, `@/motion/physics`) for the app's lifetime, so context springs and the dock's press tempo have data
 * from the first interaction and `lastPointerType()` can tell real mouse hover from touch-emulated mouse events.
 */
export function MotionRoot({ children }: { children: ReactNode }) {
  useTempoProbe();
  return (
    <MotionConfig reducedMotion="user" transition={spring.smooth}>
      {children}
    </MotionConfig>
  );
}
