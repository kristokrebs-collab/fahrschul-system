import type { ReactNode } from "react";
import { ErrorBoundary } from "@/app/ErrorBoundary";

/**
 * One app-level host (P14): a leaf in its own `data-layer` element (layer diagnostics name it) behind its own error
 * boundary – a host that throws is reported (`reportError`, opt-in) and simply disappears; the page, the other hosts
 * and the overlays keep running. `display: contents`: the wrapper never takes part in layout (the hosts render
 * fixed overlays, portals or nothing).
 */
export function HostSlot({ name, children }: { name: string; children: ReactNode }) {
  return (
    <ErrorBoundary variant="widget" label={name} fallback={() => null}>
      <div data-layer={name} className="contents">
        {children}
      </div>
    </ErrorBoundary>
  );
}
