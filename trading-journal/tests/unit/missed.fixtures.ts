/** Shared fixtures of the signal chain tests (F25 / F27 / F28 / F32 / F60). */
import type { SignalEvent, SignalEventInput } from "@/domain/missed";

export const H = 3_600_000;
export const DAY = 24 * H;

export const signalInput = (over: Partial<SignalEventInput> = {}): SignalEventInput => ({ key: "k1", at: new Date(2026, 2, 4, 10, 0).getTime(), source: "entry", kind: "entry", entry: true, symbol: "BTCUSDT", side: "long", tf: "1h", label: "Starker Long-Einstieg", detail: "Score 85", strength: 3, score: 85, ref: null, ...over });

/** A complete stored event (every additive field `null` unless given). */
export function signalEvent(over: Partial<SignalEvent> & Partial<SignalEventInput> = {}, id: string = over.id ?? over.key ?? "k1"): SignalEvent {
  return { price: null, stop: null, target: null, barClose: null, name: null, setupKind: null, grade: null, rr: null, ...signalInput(over), watch: false, seenAt: null, skip: null, skipAt: null, tradeId: null, prereq: [], rules: null, log: [], ...(over as Partial<SignalEvent>), id } as SignalEvent;
}
