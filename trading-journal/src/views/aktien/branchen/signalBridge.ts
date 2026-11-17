/**
 * Brücke Signal-Empfänger → Papier-Portfolio, the doing side (B3 → C1). Received Branchen-Signale (`GET /connections/tradingview` →
 * `signals`) are settled ONE BY ONE against the paper book with the rules that already exist (`paperStore`: candles → Zeitmaschine → risk
 * rule → exactly one position; red = close, never short; Not-Aus). What the pure side decides is in `@/domain/industryTrend/bridge`.
 *
 * - Idempotent twice over: the paper position id derives from the signal's content (a second try finds the first), and every settled
 *   received signal is written to the log (`branchen-bridge`, this device) and never looked at again.
 * - Old signals are ignored and logged as such; a signal whose candles could not be fetched is NOT settled (it waits for the next look and
 *   ages out by the same limit) – a network hiccup never loses a signal, and never opens a position on old data either.
 * - It only runs while the app is open and signed in (the book lives on this device; the server sends and stores nothing about positions).
 * - Paper only: nothing here, or in `paperStore`, sends an order.
 */
import { create } from "zustand";
import {
  handledIdsOf,
  logOfStored,
  pendingSignals,
  verdictOf,
  withEntry,
  type BridgeEntry,
  type BridgeLog,
  type ReceivedSignal,
} from "@/domain/industryTrend/bridge";
import { industryName } from "@/domain/industryTrend/config";
import { positionIdOf } from "@/domain/industryTrend/paper";
import { readJson, storageKey, writeJson } from "@/store/storage";
import { paperNow, redTarget, usePaper } from "./paperStore";

const LOG_KEY = storageKey("branchen-bridge");

export interface BridgeState {
  log: BridgeLog;
  running: boolean;
  /** received signals that could not be settled yet, with the reason (memory only) */
  waiting: Record<string, string>;
}

export const useBridge = create<BridgeState>()(() => ({ log: logOfStored(readJson<unknown>(LOG_KEY, null)), running: false, waiting: {} }));

function settle(row: ReceivedSignal, e: Omit<BridgeEntry, "id" | "at" | "symbol">): BridgeEntry {
  const entry: BridgeEntry = { id: row.id, at: paperNow(), symbol: row.symbol, ...e };
  const log = withEntry(useBridge.getState().log, entry);
  writeJson(LOG_KEY, log);
  useBridge.setState((s) => {
    const { [row.id]: _w, ...waiting } = s.waiting;
    void _w;
    return { log, waiting };
  });
  return entry;
}

const wait = (row: ReceivedSignal, why: string): void => useBridge.setState((s) => ({ waiting: { ...s.waiting, [row.id]: why } }));

async function one(row: ReceivedSignal): Promise<BridgeEntry | null> {
  const v = verdictOf(row, paperNow());
  if (v.action === "ignore") return settle(row, { outcome: "ignored", note: v.reason, paperSignalId: null, state: null });
  const { signal } = v;
  const paper = usePaper.getState();
  const common = { paperSignalId: signal.signalId, state: signal.state };

  if (v.action === "close") {
    const target = redTarget(signal);
    if (!target) return settle(row, { ...common, outcome: "nothing-to-close", note: `Rot für ${signal.branche}: es ist keine Position offen – nichts zu schließen (Cash bleibt Cash, es wird nie leer verkauft).` });
    const ok = await paper.close(target.id, "rot", signal.signalId);
    if (!ok) {
      wait(row, usePaper.getState().note ?? "Kein Kurs zum Schließen.");
      return null;
    }
    return settle(row, { ...common, outcome: "closed", note: `Rot: die Papier-Position ${target.symbol} wurde geschlossen (nichts gesendet).` });
  }

  // green: the same signal already has its position → nothing to do
  const have = paper.book.positions.find((p) => p.signalId === signal.signalId || p.id === positionIdOf(signal.signalId));
  if (have) return settle(row, { ...common, outcome: "duplicate", note: `Dieses Signal hat schon eine Papier-Position (${have.symbol}): es wurde keine zweite eröffnet.` });

  await paper.check(signal);
  const run = usePaper.getState().checks[signal.signalId];
  if (!run || run.status === "running") return null;
  if (run.status === "error") {
    wait(row, run.message ?? "Die Prüfung ist fehlgeschlagen.");
    return null;
  }
  const failed = run.decision?.checks.filter((c) => !c.ok) ?? [];
  // no candles = no decision yet: wait (the signal ages out by itself), never settle on a hiccup
  // a rule that needs no data and said no (Not-Aus, too old, no instrument, a position is open …) settles the signal – only missing candles wait
  const early = failed.find((c) => ["notaus", "gruen", "alter", "instrument", "doppel", "offen"].includes(c.id));
  if (early) return settle(row, { ...common, outcome: "refused", note: `Nicht eröffnet: ${early.text}` });
  const noCandles = failed.find((c) => c.id === "kerzen");
  if (noCandles) {
    wait(row, noCandles.text);
    return null;
  }
  if (!run.decision?.ok) return settle(row, { ...common, outcome: "refused", note: `Nicht eröffnet: ${failed[0]?.text ?? "die Regeln sagen Nein."}` });
  const res = usePaper.getState().openFrom(signal);
  if (res === "opened") return settle(row, { ...common, outcome: "opened", note: `Papier-Position eröffnet (${industryName(signal.branche)}), nichts gesendet.` });
  if (res === "duplicate") return settle(row, { ...common, outcome: "duplicate", note: "Dieses Signal hat schon eine Papier-Position: es wurde keine zweite eröffnet." });
  const after = usePaper.getState().checks[signal.signalId]?.decision?.checks.find((c) => !c.ok);
  return settle(row, { ...common, outcome: "refused", note: `Nicht eröffnet: ${after?.text ?? "die Regeln sagen Nein."}` });
}

let inflight: Promise<BridgeEntry[]> | null = null;

/**
 * Settles the received Branchen-Signale that are still open, oldest first. One run at a time (a second call returns the running one).
 * Returns the entries settled by THIS run.
 */
export function runBridge(received: readonly ReceivedSignal[]): Promise<BridgeEntry[]> {
  if (inflight) return inflight;
  const todo = pendingSignals(received, handledIdsOf(useBridge.getState().log));
  if (!todo.length) return Promise.resolve([]);
  useBridge.setState({ running: true });
  inflight = (async () => {
    const done: BridgeEntry[] = [];
    try {
      for (const row of todo) {
        try {
          const e = await one(row);
          if (e) done.push(e);
        } catch {
          wait(row, "Die Brücke konnte dieses Signal gerade nicht verarbeiten.");
        }
      }
    } finally {
      inflight = null;
      useBridge.setState({ running: false });
    }
    return done;
  })();
  return inflight;
}

/** Tests: back to the stored state. */
export function resetBridgeForTests(): void {
  inflight = null;
  useBridge.setState({ log: logOfStored(readJson<unknown>(LOG_KEY, null)), running: false, waiting: {} });
}
