import { Suspense, useEffect, type ReactNode } from "react";
import { armOverlay, useOverlayArmed, type OverlayId } from "@/app/overlayLoad";

/**
 * Mounts a lazy overlay (`@/app/overlays`) only once it is armed – its chunk has arrived at idle / on intent
 * (`preloadOverlay`) – or while `open` (the user was faster than the idle preload). From then on it stays mounted, closed,
 * exactly like the overlays of the first load: the exit animation plays out and the next opening finds the sheet
 * in the tree. The Suspense fallback is empty on purpose – an overlay brings its own scrim and entrance.
 */
export function ArmedOverlay({ id, open, children }: { id: OverlayId; open: boolean; children: ReactNode }) {
  const armed = useOverlayArmed(id);
  // opened before the idle preload: keep it mounted afterwards, so closing is animated and not an unmount
  useEffect(() => {
    if (open) armOverlay(id);
  }, [id, open]);
  if (!armed && !open) return null;
  return <Suspense fallback={null}>{children}</Suspense>;
}
