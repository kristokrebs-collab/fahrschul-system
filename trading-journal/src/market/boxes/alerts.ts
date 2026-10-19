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
import { BOX_TF_LABEL, boxesCfgOf, PHASE_LABEL, type BoxesCfg, type BoxPhase, type BoxTf } from "@/domain/boxes";
import { useJournal } from "@/store/journalStore";
import { readJson, storageKey, writeJson } from "@/store/storage";
import { pushToast } from "@/store/uiStore";
import { fmt } from "@/chart/format";
import { getBoxes, retainBoxes, subscribeBoxes, type BoxesView } from "./store";
import { getScan, retainScanner, subscribeScan, type ScanRow } from "./scanner";
import { logExternalDelivery } from "../keylevels/deliveryLog";
import { recordSignalEvent } from "../signalArchive";

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
  /** F32: what kind of alert and which way it points, for the signal archive (`setup` / `scan` are entries) */
  kind?: "breakout" | "retest" | "failed" | "target" | "setup" | "scan";
  side?: "long" | "short";
  tf?: BoxTf;
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
  /** the settings subscription of the running host */
  offs: Array<() => void>;
  /** retain + subscription of the box store while `on` and `alerts` are set (else the host keeps nothing running) */
  boxOffs: Array<() => void> | null;
  /** retain + subscription of the scanner while `alerts` and `scanner` are set and the plan includes the scanner */
  scanOffs: Array<() => void> | null;
  settingsRaw: unknown;
  /**
   * The plan includes the watchlist scanner (`boxScanner`, Pro). The candle-close alerts of the Markt symbol are free
   * like the box chart itself (Review F03: the whole host used to sit behind the scanner gate, so a Free trader saw
   * "Alarm bei Kerzenschluss" ON and never got one).
   */
  scanAllowed: boolean;
}

const recentListeners = new Set<() => void>();
const fresh = (): AlertCtl => ({ refs: 0, seen: [], closed: new Map(), seeded: false, scanSeeded: false, recent: [], offs: [], boxOffs: null, scanOffs: null, settingsRaw: undefined, scanAllowed: true });
const ctl: AlertCtl = fresh();
const settingsBoxes = (s: unknown): unknown => (s && typeof s === "object" ? (s as { boxes?: unknown }).boxes : undefined);
const cfgNow = (): BoxesCfg => boxesCfgOf(settingsBoxes(useJournal.getState().settings));

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
      kind: "breakout",
      side: up ? "long" : "short",
      tf,
    };
  }
  if (st.phase === "retest") return { title: `Retest der Kante · ${where}`, detail: `Kante ${priceText(st.dir > 0 ? b.top : b.bottom)} wird getestet${t1 ? ` · Ziel ${priceText(t1.price)}` : ""}`, tone: st.dir > 0 ? "win" : "loss", kind: "retest", side: st.dir > 0 ? "long" : "short", tf };
  if (st.phase === "failed") return { title: `Fehlausbruch · ${where}`, detail: `Zurück in der Box ${priceText(b.bottom)} – ${priceText(b.top)}`, tone: "fg", kind: "failed", tf };
  if (st.phase === "target") return { title: `Ziel erreicht · ${where}`, detail: t1 ? `${t1.label} bei ${priceText(t1.price)}` : PHASE_LABEL.target, tone: st.dir > 0 ? "win" : "loss", kind: "target", side: st.dir > 0 ? "long" : "short", tf };
  return null;
}

function canNotify(): boolean {
  return typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted";
}

function fire(alert: BoxAlert, notify: boolean): void {
  pushToast({ kind: "signal", title: alert.title, detail: alert.detail });
  logExternalDelivery("box", alert.title, alert.detail);
  // F32: the setups (and the scanner's A+ rows) are entries one could have taken; the phases are context
  if (alert.kind) recordSignalEvent({ key: `box|${alert.id}`, at: alert.at, source: "box", kind: alert.kind, entry: alert.kind === "setup" || alert.kind === "scan", symbol: alert.symbol, side: alert.side ?? null, tf: alert.tf ?? null, label: alert.title, detail: alert.detail, strength: null, score: null, ref: alert.id });
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
      kind: "setup",
      side: s.side === "long" ? "long" : "short",
      tf: b.tf,
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

/**
 * Dedup key of a scanner alert: the row id (symbol, timeframe, side, kind, box start) – NOT the bar time, so a setup
 * that stays A+ over the next scans (every 4h close) alerts once; a new box or another kind is a new alert.
 */
export const scanAlertKey = (r: Pick<ScanRow, "id">): string => `x:${r.id}`;

function onScan(): void {
  const scan = getScan();
  const cfg = cfgNow();
  if (scan.state !== "ok" && scan.state !== "scanning") return;
  const seeding = !ctl.scanSeeded;
  for (const r of scan.rows) {
    if (r.setup.grade !== "A+") continue;
    const key = scanAlertKey(r);
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
        kind: "scan",
        side: r.setup.side === "long" ? "long" : "short",
        tf: r.tf,
      },
      cfg.notify,
    );
  }
  if (scan.state === "ok") ctl.scanSeeded = true;
}

const release = (offs: Array<() => void> | null): null => {
  for (const off of offs ?? []) off();
  return null;
};

/**
 * Keeps the box store / the scanner running only while their alerts are wanted: `alerts` off (or the analysis off) →
 * the host releases them, so nothing is fetched for alerts nobody gets (the Markt page retains its own). Turning them
 * on again seeds silently first.
 */
function syncHost(): void {
  const cfg = cfgNow();
  const wantBoxes = cfg.on && cfg.alerts;
  const wantScan = cfg.alerts && cfg.scanner && ctl.scanAllowed;
  if (wantBoxes && !ctl.boxOffs) {
    ctl.seeded = false;
    ctl.closed.clear();
    ctl.boxOffs = [retainBoxes(), subscribeBoxes(onBoxes)];
    onBoxes();
  } else if (!wantBoxes && ctl.boxOffs) ctl.boxOffs = release(ctl.boxOffs);
  if (wantScan && !ctl.scanOffs) {
    ctl.scanSeeded = false;
    ctl.scanOffs = [retainScanner(), subscribeScan(onScan)];
    onScan();
  } else if (!wantScan && ctl.scanOffs) ctl.scanOffs = release(ctl.scanOffs);
}

/**
 * Starts the alert watcher (ref-counted). While `settings.boxes.alerts` is on it keeps the box store (analysis on) and
 * the scanner (scanner on) running. Returns the stop.
 */
export function startBoxAlerts(): () => void {
  ctl.refs += 1;
  if (ctl.refs === 1) {
    ctl.seen = loadSeen();
    ctl.settingsRaw = settingsBoxes(useJournal.getState().settings);
    ctl.offs = [
      useJournal.subscribe((st) => {
        const raw = settingsBoxes(st.settings);
        if (raw === ctl.settingsRaw) return;
        ctl.settingsRaw = raw;
        syncHost();
      }),
    ];
    syncHost();
  }
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    ctl.refs -= 1;
    if (ctl.refs === 0) {
      ctl.offs = release(ctl.offs) ?? [];
      ctl.boxOffs = release(ctl.boxOffs);
      ctl.scanOffs = release(ctl.scanOffs);
    }
  };
}

/** Whether the scanner part may run (the plan gate `boxScanner`); re-evaluates the running host. */
export function setBoxScannerAllowed(allowed: boolean): void {
  if (ctl.scanAllowed === allowed) return;
  ctl.scanAllowed = allowed;
  if (ctl.refs > 0) syncHost();
}

/**
 * Leaf host (mount once in the app, `data-layer` per the hosts contract): runs the alerts, renders nothing. The
 * candle-close alerts of the Markt symbol always run (while `settings.boxes.alerts` is on); the scanner alerts only with
 * `scanner` (the plan's `boxScanner`).
 */
export function BoxAlertHost({ scanner = true }: { scanner?: boolean } = {}): null {
  useEffect(() => startBoxAlerts(), []);
  useEffect(() => setBoxScannerAllowed(scanner), [scanner]);
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
  release(ctl.offs);
  release(ctl.boxOffs);
  release(ctl.scanOffs);
  Object.assign(ctl, fresh());
  recentListeners.clear();
}
