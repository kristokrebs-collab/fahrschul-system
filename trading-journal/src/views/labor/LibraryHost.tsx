/**
 * The strategy library's host (F06): the sheet must sit at the page level like the replay sheet (`LabReplayHost`) – inside a
 * reveal cell its stacking context would put it under the dock. The builder only opens it (`useLibrary.getState().show()`);
 * the sheet's chunk is fetched on the first opening.
 */
import { lazy, Suspense } from "react";
import { create } from "zustand";

const LibrarySheet = lazy(() => import("./LibrarySheet"));

interface LibraryState {
  open: boolean;
  /** opened at least once: the chunk is mounted from then on (so the closing animation can finish) */
  seen: boolean;
  show(): void;
  hide(): void;
}

export const useLibrary = create<LibraryState>()((set) => ({
  open: false,
  seen: false,
  show: () => set({ open: true, seen: true }),
  hide: () => set({ open: false }),
}));

export function LibraryHost() {
  const seen = useLibrary((s) => s.seen);
  const open = useLibrary((s) => s.open);
  const hide = useLibrary((s) => s.hide);
  if (!seen) return null;
  return (
    <Suspense fallback={null}>
      <LibrarySheet open={open} onClose={hide} />
    </Suspense>
  );
}

/** Test hook. */
export function __resetLibrary(): void {
  useLibrary.setState({ open: false, seen: false });
}
