import { LayoutGroupContext } from "motion/react";
import { createContext, useContext, useMemo, type ContextType, type ReactNode } from "react";

type LayoutGroupValue = ContextType<typeof LayoutGroupContext>;

/** The group context a `NoLayoutCascade` replaced (with its `forceRender`), for `LayoutCascade` inside it. */
const Outer = createContext<LayoutGroupValue | null>(null);

/**
 * Opts an `AnimatePresence` out of the root `LayoutGroup`'s re-render cascade.
 *
 * When every exit of an `AnimatePresence` has finished, Motion calls `LayoutGroupContext.forceRender()`. Under the
 * app's id-less root `LayoutGroup` (`MotionRoot`) that re-renders every motion component in the app (≈ 1,700 nodes),
 * so siblings outside the presence can measure a layout change. A presence whose exits never move an in-flow sibling
 * (`mode="popLayout"` swaps, fixed overlays, `absolute` rings) gains nothing from that, so wrap it here: the context
 * keeps its `id` and `group` (shared `layoutId`s still live in the root group), only `forceRender` is dropped.
 * Content with presences of its own next to `layout` siblings (sheet and dialog bodies) gets the cascade back with
 * `LayoutCascade`.
 */
export function NoLayoutCascade({ children }: { children: ReactNode }) {
  const ctx = useContext(LayoutGroupContext);
  const value = useMemo(() => ({ ...ctx, forceRender: undefined }), [ctx]);
  return (
    <Outer.Provider value={ctx}>
      <LayoutGroupContext.Provider value={value}>{children}</LayoutGroupContext.Provider>
    </Outer.Provider>
  );
}

/** Inside a `NoLayoutCascade`: restores the surrounding group's `forceRender` for this subtree. Elsewhere a no-op. */
export function LayoutCascade({ children }: { children: ReactNode }) {
  const outer = useContext(Outer);
  return outer ? <LayoutGroupContext.Provider value={outer}>{children}</LayoutGroupContext.Provider> : children;
}
