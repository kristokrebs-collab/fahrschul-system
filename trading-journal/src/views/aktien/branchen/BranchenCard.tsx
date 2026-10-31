/**
 * Aktien › Branchen-Trend (lazy chunk): the Ampel of the 48 US industries (base rule of Zarattini & Antonacci 2024), the check of a lab run's
 * result file, the Pine export for TradingView and the paper protocol of signal changes. Nothing is asked of the network before the section has
 * been on screen once (`observeInView`; without an observer – jsdom – it loads at once). The app never sends an order.
 */
import { useEffect, useRef } from "react";
import { canObserveInView, observeInView } from "@/motion/inView";
import { AmpelCard } from "./AmpelCard";
import { ErgebnisCard } from "./ErgebnisCard";
import { PineCard } from "./PineCard";
import { ProtokollCard } from "./ProtokollCard";
import { useBranchen } from "./store";

export default function BranchenCard() {
  // a 1-px marker at the top of the section is what is watched: the section is thousands of pixels tall, so "10 % of it in view" would never happen on a phone
  const root = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const begin = (): void => {
      if (useBranchen.getState().phase === "idle") void useBranchen.getState().start();
    };
    const el = root.current;
    if (!canObserveInView() || !el) {
      begin();
      return;
    }
    return observeInView(el, (inView) => {
      if (inView) begin();
    });
  }, []);
  useEffect(() => () => useBranchen.getState().abort(), []);

  return (
    <div className="relative grid min-w-0 gap-6" data-testid="aktien-branchen">
      <span ref={root} aria-hidden="true" className="pointer-events-none absolute left-0 top-0 size-px" />
      <AmpelCard />
      <ErgebnisCard />
      <PineCard />
      <ProtokollCard />
    </div>
  );
}
