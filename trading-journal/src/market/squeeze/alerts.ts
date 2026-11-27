/**
 * Squeeze observation (F07), the alert – only after the user switched it on (`settings.squeeze.alerts`, default off) and
 * only while the archive runs (it reads the archive, so it has nothing to say without it). It uses the alert path the box
 * alerts use: a toast (`kind: "signal"`, the ToastIsland is the one live region), a line in the Zustellprotokoll, and – when
 * the box alerts' browser notification is on and the tab is in the background – a system notification.
 *
 * It speaks when the observation BEGINS for a symbol and side (not while it holds), at most once per symbol and side in six
 * hours, and the first check after a start only remembers what is already true (no alert storm). The text is an observation
 * with the numbers – „Beobachtung, kein Signal“ – never an instruction.
 */
import { useEffect } from "react";
import { crowdedText, evaluateNow, situationOf, squeezeOfSettings, type BoxCtx, type SqueezeReading, type SqueezeSide } from "@/domain/squeeze";
import { boxesCfgOf } from "@/domain/boxes";
import { useJournal } from "@/store/journalStore";
import { readJson, storageKey, writeJson } from "@/store/storage";
import { pushToast } from "@/store/uiStore";
import { openArchiveDb, type ArchiveDb } from "../archive/db";
import { getArchiveStatus, subscribeArchiveStatus } from "../archive/store";
import { getBoxes } from "../boxes/store";
import { logExternalDelivery } from "../keylevels/deliveryLog";
import { loadSqueezeData } from "./read";

export const SQUEEZE_ALERTS_KEY = storageKey("squeeze-alerts");
/** At most one alert per symbol and side in this time. */
export const ALERT_COOLDOWN_MS = 6 * 3_600_000;

interface Memory {
  v: 1;
  /** `SYMBOL|side` → true while the observation holds */
  active: Record<string, boolean>;
  /** `SYMBOL|side` → time of the last alert */
  last: Record<string, number>;
}

const loadMemory = (): Memory => {
  const raw = readJson<unknown>(SQUEEZE_ALERTS_KEY, null) as Partial<Memory> | null;
  return { v: 1, active: raw && typeof raw.active === "object" && raw.active ? { ...raw.active } : {}, last: raw && typeof raw.last === "object" && raw.last ? { ...raw.last } : {} };
};

/** The box phases of the live symbol (for the context sentence), `[]` when the box analysis is not running. */
export function boxContextOf(symbol: string): BoxCtx[] {
  const view = getBoxes();
  if (view.state !== "ok" || view.symbol !== symbol) return [];
  return (["4h", "1d", "1w"] as const).flatMap((tf): BoxCtx[] => {
    const a = view.tfs[tf].analysis;
    if (!a?.box.box) return [];
    const dir = a.box.phase === "failed" ? a.box.box.brk : a.box.dir;
    return [{ tf, phase: a.box.phase, dir }];
  });
}

/** Title and detail of an alert (exported for the test). */
export function alertText(symbol: string, r: SqueezeReading, side: SqueezeSide, ctx: readonly BoxCtx[]): { title: string; detail: string } {
  const bits = r.signals.filter((s) => s.met !== null).map((s) => s.text);
  const sit = situationOf(side, ctx);
  return { title: `Squeeze-Beobachtung · ${symbol} · ${crowdedText(side)}`, detail: `${bits.join(" · ")}${sit ? ` · ${sit.text}` : ""} – Beobachtung, kein Signal.` };
}

function notify(title: string, detail: string): void {
  const boxes = boxesCfgOf((useJournal.getState().settings as { boxes?: unknown }).boxes);
  if (!boxes.notify || typeof window === "undefined" || !("Notification" in window) || Notification.permission !== "granted") return;
  if (typeof document !== "undefined" && document.visibilityState === "visible") return;
  try {
    new Notification(title, { body: detail, tag: `squeeze|${title}`, silent: false });
  } catch {
    /* some browsers allow notifications only from a service worker */
  }
}

export interface AlertRunner {
  check(): Promise<number>;
  stop(): void;
}

/** One check over the archived symbols; returns how many alerts were raised. `seeded` is the runner's own state. */
export function createAlertRunner(open: () => Promise<ArchiveDb> = () => openArchiveDb(), now: () => number = () => Date.now()): AlertRunner {
  let db: ArchiveDb | null = null;
  let seeded = false;
  const mem = loadMemory();
  let busy = false;

  async function check(): Promise<number> {
    if (busy) return 0;
    busy = true;
    try {
      const cfg = squeezeOfSettings(useJournal.getState().settings);
      if (!cfg.alerts) {
        seeded = false; // switched off: turning it on again seeds silently first
        return 0;
      }
      db ??= await open();
      const t = now();
      const rows = (await db.overview()).filter((r) => r.series === "premium");
      let raised = 0;
      for (const row of rows) {
        const { data, ivMin } = await loadSqueezeData(db, row.symbol, t);
        const r = evaluateNow(data, cfg, t, ivMin);
        for (const side of ["long", "short"] as const) {
          const key = `${row.symbol}|${side}`;
          const holds = r.state === "watch" && r.side === side;
          const was = mem.active[key] === true;
          mem.active[key] = holds;
          if (!holds || was || !seeded) continue;
          if (t - (mem.last[key] ?? 0) < ALERT_COOLDOWN_MS) continue;
          mem.last[key] = t;
          const { title, detail } = alertText(row.symbol, r, side, boxContextOf(row.symbol));
          pushToast({ kind: "signal", title, detail });
          logExternalDelivery("box", title, detail);
          notify(title, detail);
          raised += 1;
        }
      }
      seeded = true;
      writeJson(SQUEEZE_ALERTS_KEY, mem);
      return raised;
    } catch {
      return 0;
    } finally {
      busy = false;
    }
  }

  return {
    check,
    stop() {
      db?.close();
      db = null;
    },
  };
}

/** Starts the watcher: a check after every archive tick (and once at the start). Returns the stop. */
export function startSqueezeAlerts(runner: AlertRunner = createAlertRunner()): () => void {
  let rev = getArchiveStatus().rev;
  const off = subscribeArchiveStatus(() => {
    const st = getArchiveStatus();
    if (st.rev === rev) return;
    rev = st.rev;
    void runner.check();
  });
  void runner.check();
  return () => {
    off();
    runner.stop();
  };
}

export function useSqueezeAlerts(): void {
  useEffect(() => startSqueezeAlerts(), []);
}
