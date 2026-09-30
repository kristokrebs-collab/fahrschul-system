/**
 * Hosts the `TradeEditor` and feeds it the live price ONLY while it is open (Plan 6.5 `Live-Preis übernehmen`):
 * `App` itself never subscribes to the price feeds, so a mark-price / aggTrade tick re-renders nothing above
 * the editor. While open, the rounded price is read from `priceMv` (≤ 4 Hz, re-render only when the integer
 * changes) and the provenance is re-read once per second.
 */
import { useEffect, useState } from "react";
import { getProvider, lastPrice, priceMv, SOURCE_NAME, type Provenance } from "@/market";
import { TradeEditor } from "@/overlays/TradeEditor";
import { useUi } from "@/store/uiStore";

export interface LivePriceSnapshot {
  price: number | null;
  provenance: Provenance | null;
}

const EMPTY: LivePriceSnapshot = { price: null, provenance: null };
const THROTTLE_MS = 250;

function readSnapshot(): LivePriceSnapshot {
  const p = getProvider();
  const lp = p ? lastPrice(p.snapshot()) : null;
  return { price: lp ? Math.round(lp.price) : null, provenance: lp?.provenance ?? null };
}

/** Rounded last price + provenance, subscribed only while `active`; updates only when the integer or the source changes. */
export function useLivePriceWhile(active: boolean): LivePriceSnapshot {
  const [snap, setSnap] = useState<LivePriceSnapshot>(EMPTY);
  useEffect(() => {
    if (!active) return;
    let last = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const apply = () => {
      last = Date.now();
      const next = readSnapshot();
      setSnap((prev) => (prev.price === next.price && prev.provenance?.source === next.provenance?.source ? prev : next));
    };
    const throttled = () => {
      const wait = THROTTLE_MS - (Date.now() - last);
      if (wait <= 0) apply();
      else if (!timer)
        timer = setTimeout(() => {
          timer = null;
          apply();
        }, wait);
    };
    apply();
    const unsub = priceMv.on("change", throttled);
    const id = setInterval(throttled, 1000);
    return () => {
      unsub();
      clearInterval(id);
      if (timer) clearTimeout(timer);
    };
  }, [active]);
  return active ? snap : EMPTY;
}

export function EditorHost() {
  const open = useUi((s) => s.editor.open);
  const { price, provenance } = useLivePriceWhile(open);
  const livePriceLabel = provenance && provenance.source !== "binance" && provenance.source !== "proxy" ? `Live-Preis (${SOURCE_NAME[provenance.source]}) übernehmen` : undefined;
  return <TradeEditor livePrice={price} livePriceLabel={livePriceLabel} />;
}
