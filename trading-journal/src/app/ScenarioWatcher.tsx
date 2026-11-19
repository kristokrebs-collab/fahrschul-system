import { useEffect, useRef } from "react";
import { LAGE_MEANING, LAGE_STATE_WORD, lageSettingsOf, type LageState } from "@/domain/lage";
import { lastClosed4h, useLage, type Candle, type Stamped } from "@/market";
import { useJournal } from "@/store/journalStore";
import { readJson, storageKey, writeJson } from "@/store/storage";
import { useUi } from "@/store/uiStore";

/**
 * `tj2-lage-last`: the last Lage the watcher announced (share edition: `tj2share-lage-last`), so a reload never toasts
 * again. The former manual-level key (`tj2-trigger-last`) is no longer read or written (it stays stored untouched).
 */
export const LAGE_LAST_KEY: string = storageKey("lage-last");
/** Toast time (the former scenario toast's 5.2 s). */
export const LAGE_TOAST_MS = 5200;
/**
 * Red ↔ amber hangs on live values (U1 = the price around the 1D-EMA 21) and can flip back and forth within minutes:
 * such a change is announced at most this often. A change of the daily trend (to or from green) always is.
 */
export const LAGE_AMBER_TOAST_GAP_MS = 4 * 60 * 60_000;

interface LageLast {
  state: Exclude<LageState, "none">;
  at: number;
}

export interface Closed4h {
  /** close time, ms */
  t: number;
  /** close price */
  c: number;
}

/**
 * Last closed 4h bar as primitives. The closed bar is always among the last few bars, so only the tail is scanned
 * (the feed holds hundreds of bars and publishes per kline tick).
 */
export function selectClosed4h(v: Stamped<Candle[]> | undefined): Closed4h | null {
  const closed = v ? lastClosed4h(v.data.slice(-4)) : null;
  return closed ? { t: closed.t, c: closed.c } : null;
}

export const sameClosed4h = (a: Closed4h | null, b: Closed4h | null): boolean => a === b || (a !== null && b !== null && a.t === b.t && a.c === b.c);

/** Whether a change `prev → next` at `now` is announced (pure; see `LAGE_AMBER_TOAST_GAP_MS`). */
export function lageToastDue(prev: LageLast | null, next: Exclude<LageState, "none">, now: number): boolean {
  if (!prev || prev.state === next) return false;
  if (prev.state === "green" || next === "green") return true;
  return now - prev.at >= LAGE_AMBER_TOAST_GAP_MS;
}

/**
 * Toast on a change of the Lage-Ampel (decision 23; replaces the manual-level scenario toast "Neues Szenario: …"):
 * `Lage: Fällt noch · abwarten` / `Lage: Umkehr bildet sich · 2 von 4` / `Lage: Umkehr bestätigt`, once per change,
 * never on the first load (the first state is only remembered) and never twice after a reload. Off while the Ampel is
 * switched off; `keine Daten` is no state. Renders only when the published Lage changes (≤ 1/s, on shown values).
 */
export function ScenarioWatcher() {
  const { lage } = useLage();
  const on = useJournal((s) => lageSettingsOf(s.settings.signals).on);
  const mode = useJournal((s) => lageSettingsOf(s.settings.signals).mode);
  const pushToast = useUi((s) => s.pushToast);
  const state = lage && lage.state !== "none" ? lage.state : null;
  const title = lage?.title ?? "";
  // last persisted value, read once and kept here (no localStorage read per render)
  const last = useRef<LageLast | null | undefined>(undefined);

  useEffect(() => {
    if (!on || !state) return;
    if (last.current === undefined) last.current = readJson<LageLast | null>(LAGE_LAST_KEY, null);
    const prev = last.current;
    const now = Date.now();
    const next: LageLast = { state, at: now };
    if (prev && prev.state === state) return;
    if (prev && !lageToastDue(prev, state, now)) return;
    if (prev) {
      const meaning = mode === "warn" && state !== "green" ? "Kaufsignale zählen trotzdem (nur Warnung)." : LAGE_MEANING[state];
      pushToast({ kind: "signal", title: `Lage: ${title}`, value: LAGE_STATE_WORD[state], valueTone: state === "green" ? "win" : "loss", detail: meaning, duration: LAGE_TOAST_MS });
    }
    last.current = next;
    writeJson(LAGE_LAST_KEY, next);
  }, [on, state, title, mode, pushToast]);

  return null;
}
