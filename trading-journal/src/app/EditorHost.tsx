/**
 * Hosts the `TradeEditor` and feeds it the live price ONLY while it is open (Plan 6.5 `Live-Preis übernehmen`):
 * `App` itself never subscribes to the price feeds, so a trade, book or mark tick re-renders nothing above the
 * editor. While open, the rounded price and its provenance are read once per second on the shared `nowMv` clock
 * (no per-trade subscription, no throttle timers) and the editor re-renders only when the integer price or the
 * source changes – at most once a second. Live displays inside the editor render `priceMv` directly.
 */
import { useSyncExternalStore } from "react";
import { getProvider, lastPrice, SOURCE_NAME, type Provenance } from "@/market";
import { nowMv, retainClock } from "@/motion/clock";
import { TradeEditor } from "@/overlays/TradeEditor";
import { useUi } from "@/store/uiStore";

export interface LivePriceSnapshot {
  price: number | null;
  provenance: Provenance | null;
}

const EMPTY: LivePriceSnapshot = { price: null, provenance: null };

function readSnapshot(): LivePriceSnapshot {
  const p = getProvider();
  const lp = p ? lastPrice(p.snapshot()) : null;
  return { price: lp ? Math.round(lp.price) : null, provenance: lp?.provenance ?? null };
}

/** Snapshot getter that keeps its object while the rounded price and the source are unchanged. */
function createSnapshotReader(): () => LivePriceSnapshot {
  let last = EMPTY;
  return () => {
    const next = readSnapshot();
    if (next.price === last.price && next.provenance?.source === last.provenance?.source) return last;
    last = next;
    return last;
  };
}

/** Holds the shared second clock while subscribed and re-reads on every tick. */
function subscribeSeconds(cb: () => void): () => void {
  const release = retainClock();
  const off = nowMv.on("change", cb);
  return () => {
    off();
    release();
  };
}

const noSubscribe = () => () => {};
const readEmpty = () => EMPTY;
const readLive = createSnapshotReader();

/** Rounded last price + provenance, subscribed only while `active`; re-renders only when the integer or the source changes. */
export function useLivePriceWhile(active: boolean): LivePriceSnapshot {
  return useSyncExternalStore(active ? subscribeSeconds : noSubscribe, active ? readLive : readEmpty, readEmpty);
}

export function EditorHost() {
  const open = useUi((s) => s.editor.open);
  const { price, provenance } = useLivePriceWhile(open);
  const livePriceLabel = provenance && provenance.source !== "binance" && provenance.source !== "proxy" ? `Live-Preis (${SOURCE_NAME[provenance.source]}) übernehmen` : undefined;
  return <TradeEditor livePrice={price} livePriceLabel={livePriceLabel} />;
}
