import { lazy, Suspense } from "react";
import { cn } from "@/lib/cn";
import { Quiet } from "@/motion/rich";
import type { SlotViewProps } from "./SlotView";

/**
 * Placeholder for a connection that is needed here (TradingView, Binance, Bitunix, e-mail / telephone alarm, cloud
 * account). The row itself is a lazy chunk (`SlotView` + its glass styles + the stores it reads); until it arrives the
 * same-size outline stands there, so nothing moves. Put it ONLY on pages with `[data-rich]` (or inside components
 * mounted there) – the Übersicht and the Cockpit keep their picture.
 */
const SlotLazy = lazy(() => import("./SlotView"));

/** Same box as the real row (`.cx-slot`: min 78 px). */
function Outline({ className }: { className?: string }) {
  return <div aria-hidden="true" data-connect-outline="" className={cn("min-h-[4.875rem] w-full rounded-2xl border border-line bg-white/[0.02]", className)} />;
}

export function ConnectSlot(props: SlotViewProps) {
  return (
    <Quiet>
      <Suspense fallback={<Outline className={props.className} />}>
        <SlotLazy {...props} />
      </Suspense>
    </Quiet>
  );
}

export type { SlotViewProps as ConnectSlotProps };
