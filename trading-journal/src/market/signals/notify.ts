/**
 * Notification on a NEW valid entry of the live check (edge, once per base-timeframe bar and side):
 *
 * - The first evaluation after start (or a config change) is the baseline: an entry that is already valid then
 *   does not notify (the other journal's `useSignalAlerts` behaved the same).
 * - Repaint guard: the entry must stay valid for `SIGNAL_HOLD_MS` (the running candle repaints, like on
 *   TradingView); a flicker back to invalid restarts the wait.
 * - Once per bar: the last notified `{ barOpen, strength }` per side is persisted under `tj2-signal-last`
 *   (edition-namespaced via `storageKey`), so a reload or a second tab does not repeat it.
 * - Delivery: the existing toast island (`pushToast`, kind `signal`, 5.2 s) and — only when the user enabled it
 *   (`settings.signals.notify`), the permission is granted and the page is not in front — a system notification.
 */
import { strengthText } from "@/domain/signals";
import type { Side, Signals, SignalCfg } from "@/domain/signals";
import { pushToast } from "@/store/uiStore";
import { readJson, storageKey, writeJson } from "@/store/storage";

export const SIGNAL_LAST_KEY = storageKey("signal-last");
export const SIGNAL_TOAST_MS = 5200;
export const SIGNAL_HOLD_MS = 60_000;

interface Notified {
  /** open time (ms) of the base-timeframe bar the entry belongs to */
  barOpen: number;
  strength: number;
  /** ms */
  at: number;
}
type LastNotified = Partial<Record<Side, Notified>>;

interface Pending {
  since: number;
  barOpen: number;
}

interface NotifyState {
  prev: Record<Side, boolean> | null;
  pending: Partial<Record<Side, Pending>>;
  latest: (Signals & { cfg: SignalCfg }) | null;
  timer: ReturnType<typeof setTimeout> | null;
}

const st: NotifyState = { prev: null, pending: {}, latest: null, timer: null };
const SIDES: readonly Side[] = ["long", "short"];

function baseBarOpen(s: Signals): number {
  const c = s.checks[0];
  return c ? c.closeAt * 1000 : 0;
}

/** Feeds one live evaluation into the edge detector (called by the engine, ≤ 1/s). */
export function noteSignals(s: Signals & { cfg: SignalCfg }, now: number = Date.now()): void {
  st.latest = s;
  const valid: Record<Side, boolean> = { long: s.long.valid, short: s.short.valid };
  if (!st.prev) {
    st.prev = valid;
    return;
  }
  const barOpen = baseBarOpen(s);
  for (const side of SIDES) {
    if (!valid[side]) {
      delete st.pending[side];
      continue;
    }
    if (!st.prev[side] && !st.pending[side]) st.pending[side] = { since: now, barOpen };
  }
  st.prev = valid;
  flushPending(now);
}

function flushPending(now: number): void {
  let next = Infinity;
  for (const side of SIDES) {
    const p = st.pending[side];
    if (!p) continue;
    if (now - p.since >= SIGNAL_HOLD_MS) {
      delete st.pending[side];
      if (st.latest?.[side].valid) fire(side, st.latest, now);
    } else next = Math.min(next, p.since + SIGNAL_HOLD_MS);
  }
  if (st.timer) clearTimeout(st.timer);
  st.timer = null;
  if (next < Infinity) {
    st.timer = setTimeout(() => {
      st.timer = null;
      flushPending(Date.now());
    }, Math.max(0, next - now));
  }
}

function fire(side: Side, s: Signals & { cfg: SignalCfg }, now: number): void {
  const v = s[side];
  const barOpen = baseBarOpen(s);
  const last = readJson<LastNotified | null>(SIGNAL_LAST_KEY, null) ?? {};
  const prev = last[side];
  if (prev && prev.barOpen >= barOpen) return; // once per bar (also across reloads and tabs)
  const detail = `${strengthText(v.strength)} · ${v.tiers} von ${s.cfg.ladder.length} Timeframes`;
  pushToast({ kind: "signal", title: v.label, value: `Score ${v.score}`, valueTone: side === "long" ? "win" : "loss", detail, duration: SIGNAL_TOAST_MS });
  if (s.cfg.notify) systemNotification(v.label, `Score ${v.score} · ${detail}`);
  writeJson(SIGNAL_LAST_KEY, { ...last, [side]: { barOpen, strength: v.strength, at: now } satisfies Notified });
}

function systemNotification(title: string, body: string): void {
  try {
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    const inFront = typeof document !== "undefined" && !document.hidden && (typeof document.hasFocus !== "function" || document.hasFocus());
    if (inFront) return; // the toast island already shows it
    new Notification(title, { body, tag: "tj-signal" });
  } catch {
    /* blocked (file://, iframe, private mode): the toast is enough */
  }
}

export type NotifyPermission = "granted" | "denied" | "default" | "unsupported";

/** Current permission of the Notification API (`unsupported` when the browser / page has none). */
export function signalNotifyPermission(): NotifyPermission {
  try {
    return typeof Notification === "undefined" ? "unsupported" : (Notification.permission as NotifyPermission);
  } catch {
    return "unsupported";
  }
}

/** Asks for the permission; call it from the click that enables `settings.signals.notify`. */
export async function requestSignalNotifyPermission(): Promise<NotifyPermission> {
  try {
    if (typeof Notification === "undefined") return "unsupported";
    if (Notification.permission !== "default") return Notification.permission as NotifyPermission;
    return (await Notification.requestPermission()) as NotifyPermission;
  } catch {
    return "unsupported";
  }
}

/** Forget the baseline and pending entries (config change, symbol change, tests). Keeps the persisted last key. */
export function resetSignalNotifier(): void {
  if (st.timer) clearTimeout(st.timer);
  st.timer = null;
  st.prev = null;
  st.pending = {};
  st.latest = null;
}
