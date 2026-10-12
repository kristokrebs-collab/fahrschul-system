/**
 * Box-zu-Box alerts: a toast (`kind: "signal"`, the ToastIsland is the one live region) and – when allowed – a browser
 * notification when
 * - a timeframe's box changes phase at a candle CLOSE into breakout, retest, failed breakout or target reached;
 * - a new setup reaches the minimum grade (A+ / A) on the live symbol;
 * - the watchlist scanner finds a new A+ setup.
 * Deduplicated per box id and phase (setup id / scan row id), remembered across reloads (`storageKey("box-alerts")`,
 * the newest 200), so a reload or a symbol switch back never repeats an alert. The first evaluation after a start only
 * seeds (no alert storm for what was already true). `settings.boxes.alerts` off → nothing; `notify` adds the browser
 * notification while the tab is in the background (permission asked from the settings card, never here).
 *
 * `BoxAlertHost` is the leaf the app mounts once (P14, next to the other hosts); `useRecentBoxAlerts()` lists what fired
 * (Markt page marquee).
 */
import { useEffect, useSyncExternalStore } from "react";
import { BOX_TF_LABEL, PHASE_LABEL, type BoxPhase, type BoxTf } from "@/domain/boxes";
import { readJson, storageKey, writeJson } from "@/store/storage";
import { pushToast } from "@/store/uiStore";
import { fmt } from "@/chart/format";
import { getBoxes, retainBoxes, subscribeBoxes, type BoxesView } from "./store";
import { getScan, retainScanner, subscribeScan } from "./scanner";

export const BOX_ALERTS_KEY = storageKey("box-alerts");
const MAX_SEEN = 200;
const RECENT_MAX = 12;
/** Phases that alert at a candle close. */
export const ALERT_PHASES: ReadonlySet<BoxPhase> = new Set<BoxPhase>(["breakout", "retest", "failed", "target"]);

export interface BoxAlert {
  id: string;
  title: string;
  detail: string;
  tone: "win" | "loss" | "fg";
  /** device time it fired */
  at: number;
  symbol: string;
}

interface AlertCtl {
  refs: number;
  seen: string[];
  /** `${symbol}:${tf}` → newest closed bar time seen (seeding) */
  closed: Map<string, number>;
  /** keys that existed at start (never alerted) */
  seeded: boolean;
  scanSeeded: boolean;
  recent: BoxAlert[];
  offs: Array<() => void>;
}

const recentListeners = new Set<() => void>();
const ctl: AlertCtl = { refs: 0, seen: [], closed: new Map(), seeded: false, scanSeeded: false, recent: [], offs: [] };

function loadSeen(): string[] {
  const raw = readJson<unknown>(BOX_ALERTS_KEY, []);
  return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string").slice(-MAX_SEEN) : [];
}

function markSeen(key: string): boolean {
  if (ctl.seen.includes(key)) return false;
  ctl.seen = [...ctl.seen, key].slice(-MAX_SEEN);
  writeJson(BOX_ALERTS_KEY, ctl.seen);
  return true;
}

const priceText = (p: number): string => fmt.price(p);
const dirArrow = (d: number): string => (d > 0 ? "↑" : d < 0 ? "↓" : "");

/** German title / detail / tone of a phase alert. */
export function phaseAlertText(symbol: string, tf: BoxTf, v: BoxesView["tfs"][BoxTf]): Omit<BoxAlert, "id" | "at" | "symbol"> | null {
  const a = v.analysis;
  const b = a?.box.box;
  if (!a || !b) return null;
  const st = a.box;
  const where = `${symbol} ${BOX_TF_LABEL[tf]}`;
  const t1 = st.targets[0];
  if (st.phase === "breakout") {
    const up = st.dir > 0;
    return {
      title: `Ausbruch ${dirArrow(st.dir)} · ${where}`,
      detail: `Schluss ${up ? "über" : "unter"} ${priceText(up ? b.top : b.bottom)}${t1 ? ` · Ziel ${priceText(t1.price)} (${t1.label})` : ""}`,
      tone: up ? "win" : "loss",
    };
  }
  if (st.phase === "retest") return { title: `Retest der Kante · ${where}`, detail: `Kante ${priceText(st.dir > 0 ? b.top : b.bottom)} wird getestet${t1 ? ` · Ziel ${priceText(t1.price)}` : ""}`, tone: st.dir > 0 ? "win" : "loss" };
  if (st.phase === "failed") return { title: `Fehlausbruch · ${where}`, detail: `Zurück in der Box ${priceText(b.bottom)} – ${priceText(b.top)}`, tone: "fg" };
  if (st.phase === "target") return { title: `Ziel erreicht · ${where}`, detail: t1 ? `${t1.label} bei ${priceText(t1.price)}` : PHASE_LABEL.target, tone: st.dir > 0 ? "win" : "loss" };
  return null;
}

function canNotify(): boolean {
  return typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted";
}

function fire(alert: BoxAlert, notify: boolean): void {
  pushToast({ kind: "signal", title: alert.title, detail: alert.detail });
  ctl.recent = [alert, ...ctl.recent].slice(0, RECENT_MAX);
  for (const l of [...recentListeners]) l();
  if (notify && canNotify() && typeof document !== "undefined" && document.visibilityState !== "visible") {
    try {
      new Notification(alert.title, { body: alert.detail, tag: alert.id, silent: false });
    } catch {
      /* some browsers allow notifications only from a service worker */
    }
  }
}

/** Evaluates a published box view: phase changes at a close and new best setups. */
export function evaluateBoxes(view: BoxesView, now = Date.now()): BoxAlert[] {
  const out: BoxAlert[] = [];
  const symbol = view.symbol;
  if (!symbol || view.state !== "ok") return out;
  const seeding = !ctl.seeded;
  for (const tf of ["1w", "1d", "4h"] as const) {
    const v = view.tfs[tf];
    const a = v.analysis;
    if (!a || v.closedAt == null) continue;
    const ck = `${symbol}:${tf}`;
    const prevClosed = ctl.closed.get(ck);
    ctl.closed.set(ck, v.closedAt);
    const closedNow = prevClosed !== undefined && v.closedAt > prevClosed;
    // phase at the close
    if (ALERT_PHASES.has(a.box.phase) && v.boxId) {
      const key = `p:${symbol}:${v.boxId}:${a.box.phase}`;
      if (seeding || prevClosed === undefined || !closedNow) {
        // already true when we started / not a close: remember silently, never alert later for it
        if (seeding || prevClosed === undefined) markSeen(key);
      } else if (markSeen(key)) {
        const t = phaseAlertText(symbol, tf, v);
        if (t) out.push({ id: key, at: now, symbol, ...t });
      }
    }
  }
  for (const b of view.best) {
    const key = `s:${symbol}:${b.id}:${b.setup.grade}`;
    if (seeding) {
      markSeen(key);
      continue;
    }
    if (!markSeen(key)) continue;
    const s = b.setup;
    out.push({
      id: key,
      at: now,
      symbol,
      title: `${s.grade}-Setup · ${s.title} · ${symbol} ${BOX_TF_LABEL[b.tf]}`,
      detail: `Einstieg ${priceText(s.entry)} · Stop ${priceText(s.stop)}${s.rr != null ? ` · CRV ${s.rr.toFixed(1).replace(".", ",")}` : ""}`,
      tone: s.side === "long" ? "win" : "loss",
    });
  }
  ctl.seeded = true;
  return out;
}

function onBoxes(): void {
  const view = getBoxes();
  if (!view.cfg.on || !view.cfg.alerts) {
    // keep the seed current, so turning alerts on later does not replay old states
    if (view.state === "ok") ctl.seeded = false;
    return;
  }
  for (const a of evaluateBoxes(view)) fire(a, view.cfg.notify);
}

function onScan(): void {
  const scan = getScan();
  const cfg = getBoxes().cfg;
  if (scan.state !== "ok" && scan.state !== "scanning") return;
  const seeding = !ctl.scanSeeded;
  for (const r of scan.rows) {
    if (r.setup.grade !== "A+") continue;
    const key = `x:${r.id}:${r.at}`;
    if (seeding || !cfg.alerts || !cfg.scanner) {
      markSeen(key);
      continue;
    }
    if (!markSeen(key)) continue;
    fire(
      {
        id: key,
        at: Date.now(),
        symbol: r.symbol,
        title: `Scanner: A+ · ${r.setup.title} · ${r.symbol} ${BOX_TF_LABEL[r.tf]}`,
        detail: `Einstieg ${priceText(r.setup.entry)} · Stop ${priceText(r.setup.stop)}${r.setup.rr != null ? ` · CRV ${r.setup.rr.toFixed(1).replace(".", ",")}` : ""}`,
        tone: r.setup.side === "long" ? "win" : "loss",
      },
      cfg.notify,
    );
  }
  if (scan.state === "ok") ctl.scanSeeded = true;
}

/** Starts the alert watcher (ref-counted; keeps the box store and the scanner running). Returns the stop. */
export function startBoxAlerts(): () => void {
  ctl.refs += 1;
  if (ctl.refs === 1) {
    ctl.seen = loadSeen();
    ctl.seeded = false;
    ctl.scanSeeded = false;
    ctl.closed.clear();
    ctl.offs = [retainBoxes(), subscribeBoxes(onBoxes), retainScanner(), subscribeScan(onScan)];
    onBoxes();
  }
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    ctl.refs -= 1;
    if (ctl.refs === 0) {
      for (const off of ctl.offs) off();
      ctl.offs = [];
    }
  };
}

/** Leaf host (mount once in the app, `data-layer` per the hosts contract): runs the alerts, renders nothing. */
export function BoxAlertHost(): null {
  useEffect(() => startBoxAlerts(), []);
  return null;
}

const subscribeRecent = (cb: () => void) => {
  recentListeners.add(cb);
  return () => void recentListeners.delete(cb);
};
const getRecent = (): readonly BoxAlert[] => ctl.recent;

/** Alerts fired in this session, newest first (≤ 12). */
export function useRecentBoxAlerts(): readonly BoxAlert[] {
  return useSyncExternalStore(subscribeRecent, getRecent, getRecent);
}

/** Tests: forget everything. */
export function __resetBoxAlerts(): void {
  for (const off of ctl.offs) off();
  Object.assign(ctl, { refs: 0, seen: [], closed: new Map(), seeded: false, scanSeeded: false, recent: [], offs: [] });
  recentListeners.clear();
}
