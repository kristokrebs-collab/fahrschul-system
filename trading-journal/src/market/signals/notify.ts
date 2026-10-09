/**
 * Notification on a NEW valid entry of the live check (edge, once per signal bar and side). Since decision 6 an entry
 * is valid only once its base candle has CLOSED with the signal ("bestätigt"): a provisional entry on the forming
 * candle never notifies, and the dedupe key is the base signal's own (closed) bar, so the same signal never repeats
 * while it stays lit in the lookback window.
 *
 * - The first evaluation after start (or a config change) is the baseline: an entry that is already valid then
 *   does not notify (the other journal's `useSignalAlerts` behaved the same).
 * - Repaint guard: the entry must stay valid for `SIGNAL_HOLD_MS` (the running candle repaints, like on
 *   TradingView); a flicker back to invalid restarts the wait.
 * - Once per bar: the last notified `{ barOpen, strength }` per side is persisted under `tj2-signal-last`
 *   (edition-namespaced via `storageKey`), so a reload or a second tab does not repeat it.
 * - Minimum strength ("Hinweis ab Stärke", `settings.signals.notifyMinStrength` 1–4, absent = 1): an entry counts as
 *   valid for the notifier only from that strength on, so a weaker entry neither notifies nor arms the edge; it
 *   notifies once it reaches the minimum.
 * - Text: label, score, strength, timeframes, the state (`bestätigt` / `stark bestätigt`) and the graded parts that
 *   hold (`Top-Trader 3/4`, `Divergenz 1h`, `Support + Platz`).
 * - Delivery: the existing toast island (`pushToast`, kind `signal`, 5.2 s) and — only when the user enabled it
 *   (`settings.signals.notify`), the permission is granted and the page is not in front — a system notification.
 */
import { STATE_TEXT, strengthText, tfSeconds, WHALE_TITLE } from "@/domain/signals";
import type { GradedPart, Side, Signals, SignalCfg } from "@/domain/signals";
import { pushToast } from "@/store/uiStore";
import { readJson, storageKey, writeJson } from "@/store/storage";

export const SIGNAL_LAST_KEY = storageKey("signal-last");
export const SIGNAL_TOAST_MS = 5200;
export const SIGNAL_HOLD_MS = 60_000;

interface Notified {
  /** open time (ms) of the base-timeframe bar the entry's signal fired on */
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

/**
 * `settings.signals.notifyMinStrength` (1 … 4, rounded); 1 (every valid entry, the behaviour before the setting
 * existed) when absent or not a number. `sanitizeSignalCfg` keeps the raw key, so it is read off the config here.
 */
export function signalNotifyMinStrength(cfg: SignalCfg): number {
  const v = (cfg as SignalCfg & { notifyMinStrength?: unknown }).notifyMinStrength;
  return typeof v === "number" && Number.isFinite(v) ? Math.min(4, Math.max(1, Math.round(v))) : 1;
}

/** Valid for the notifier: a valid entry at or above the minimum strength. */
function notifiable(s: Signals & { cfg: SignalCfg }, side: Side): boolean {
  return s[side].valid && s[side].strength >= signalNotifyMinStrength(s.cfg);
}

/**
 * Open time (ms) of the base rung's signal bar for `side`: the closed event that confirms the entry (its `barsAgo`
 * counted back from the newest bar). Without candle-close data (hand-built input): the newest bar.
 */
export function signalBarOpen(s: Signals, side: Side): number {
  const c = s.checks[0];
  if (!c) return 0;
  const conf = c.conf?.[side];
  const e = conf?.closed ?? conf?.event ?? null;
  return (c.closeAt - (e ? e.barsAgo : 0) * tfSeconds(c.tf)) * 1000;
}

/** Feeds one live evaluation into the edge detector (called by the engine, ≤ 1/s). */
export function noteSignals(s: Signals & { cfg: SignalCfg }, now: number = Date.now()): void {
  st.latest = s;
  const valid: Record<Side, boolean> = { long: notifiable(s, "long"), short: notifiable(s, "short") };
  if (!st.prev) {
    st.prev = valid;
    return;
  }
  for (const side of SIDES) {
    if (!valid[side]) {
      delete st.pending[side];
      continue;
    }
    if (!st.prev[side] && !st.pending[side]) st.pending[side] = { since: now, barOpen: signalBarOpen(s, side) };
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
      if (st.latest && notifiable(st.latest, side)) fire(side, st.latest, now);
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

/** Short note of a part that holds (notification text). */
function partNote(p: GradedPart): string {
  if (p.id === "traders") return `Top-Trader ${p.met ?? 0}/4`;
  if (p.id === "div") return `Divergenz${p.tf ? ` ${p.tf}` : ""}`;
  return p.side === "long" ? "Support + Platz" : "Widerstand + Platz";
}

/** Detail line of the notification (`Stark · 2 von 4 Timeframes · bestätigt · Top-Trader 3/4`). */
export function signalNotifyDetail(s: Signals & { cfg: SignalCfg }, side: Side): string {
  const v = s[side];
  const whale = v.whale?.ok ? ` · ${WHALE_TITLE[side]}` : "";
  const state = v.state ? ` · ${STATE_TEXT[v.state]}` : "";
  const parts = (v.parts ?? []).filter((p) => p.ok).map((p) => ` · ${partNote(p)}`).join("");
  // `nur Warnung` (decision 23): the entry counts, the Lage warning rides along (a blocked entry never notifies)
  const lage = v.lage && !v.lage.blocked ? ` · ${v.lage.label}` : "";
  return `${strengthText(v.strength)} · ${v.tiers} von ${s.cfg.ladder.length} Timeframes${state}${parts}${whale}${lage}`;
}

function fire(side: Side, s: Signals & { cfg: SignalCfg }, now: number): void {
  const v = s[side];
  const barOpen = signalBarOpen(s, side);
  const last = readJson<LastNotified | null>(SIGNAL_LAST_KEY, null) ?? {};
  const prev = last[side];
  if (prev && prev.barOpen >= barOpen) return; // once per signal bar (also across reloads and tabs)
  const detail = signalNotifyDetail(s, side);
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
