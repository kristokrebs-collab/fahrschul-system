/**
 * Wires the live check to the journal settings: `settings.signals` (raw, sanitised by the engine) is applied on
 * start and whenever the settings object changes. Started and stopped together with the market provider
 * (`startMarket` / `stopMarket`), so no component has to mount anything.
 */
import { useJournal } from "@/store/journalStore";
import type { MarketProvider } from "../provider";
import { attachSignalEngine, detachSignalEngine, setSignalConfig } from "./engine";

let offSettings: (() => void) | null = null;

function signalsOf(s: unknown): unknown {
  return s && typeof s === "object" ? (s as { signals?: unknown }).signals : undefined;
}

export function startSignals(p: MarketProvider): void {
  if (!offSettings) {
    let last = signalsOf(useJournal.getState().settings);
    setSignalConfig(last);
    offSettings = useJournal.subscribe((state) => {
      const next = signalsOf(state.settings);
      if (next === last) return;
      last = next;
      setSignalConfig(next);
    });
  }
  attachSignalEngine(p);
}

export function stopSignals(): void {
  offSettings?.();
  offSettings = null;
  detachSignalEngine();
}
