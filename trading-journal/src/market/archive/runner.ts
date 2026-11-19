/**
 * The archive's clock (F26): opens the store, waits for the first tick, runs one tick per interval while the switch is on
 * and the app is open, and reports the run in `useArchiveStatus()`. A tab that was asleep (hidden, frozen, offline) ticks
 * once on return when a tick is overdue – the time before stays a gap. While `states` is on it keeps the Lage-Ampel and the
 * box analysis of the live symbol running (the same stores the pages read), so their states can be written.
 *
 * `startArchiveRunner()` returns the stop; the host (`./host`) calls it while the switch is on.
 */
import { effectiveSymbols, observedSymbols } from "@/domain/archive";
import { boxesCfgOf } from "@/domain/boxes";
import { useJournal } from "@/store/journalStore";
import { retainBoxes } from "../boxes/store";
import { retainLage } from "../lage";
import { tvSymbolToBinance } from "../symbol";
import { Collector, defaultDeps, type CollectorDeps } from "./collector";
import { openArchiveDb, ArchiveUnavailable, type ArchiveDb } from "./db";
import { readLiveStates } from "./states";
import { getArchiveCfg, getArchiveStatus, patchArchiveStatus, subscribeArchiveCfg } from "./store";

/** After the start the first tick waits this long (the app settles first); sooner never. */
export const START_DELAY_MS = 15_000;
/** A tab that comes back with an overdue tick runs it after this short pause. */
export const RESUME_DELAY_MS = 2_000;

export interface RunnerDeps {
  open: () => Promise<ArchiveDb>;
  collector: (db: ArchiveDb) => Collector;
  now: () => number;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (h: unknown) => void;
  /** the symbols the user watches, live symbol first */
  observed: () => string[];
  liveSymbol: () => string | null;
  /** keeps the Lage-Ampel / box analysis running; returns the release */
  retain: () => () => void;
  startDelayMs: number;
}

const liveSymbolNow = (): string | null => {
  const raw = useJournal.getState().settings.market.symbol;
  const s = tvSymbolToBinance(raw);
  return s || null;
};

export const defaultRunnerDeps = (): RunnerDeps => ({
  open: () => openArchiveDb(),
  collector: (db) => new Collector({ ...defaultDeps(db), readStates: () => readLiveStates(liveSymbolNow()) } satisfies CollectorDeps),
  now: () => Date.now(),
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  observed: () => observedSymbols(liveSymbolNow(), boxesCfgOf((useJournal.getState().settings as { boxes?: unknown }).boxes).watchlist),
  liveSymbol: liveSymbolNow,
  retain: () => {
    const offs = [retainLage(), retainBoxes()];
    return () => offs.forEach((o) => o());
  },
  startDelayMs: START_DELAY_MS,
});

export function startArchiveRunner(over: Partial<RunnerDeps> = {}): () => void {
  const d: RunnerDeps = { ...defaultRunnerDeps(), ...over };
  let stopped = false;
  let timer: unknown = null;
  let due = 0;
  let db: ArchiveDb | null = null;
  let col: Collector | null = null;
  let inflight: Promise<void> | null = null;
  let release: (() => void) | null = null;
  let lastIv = getArchiveCfg().everyMin;

  const clear = () => {
    if (timer !== null) d.clearTimer(timer);
    timer = null;
  };
  const schedule = (ms: number) => {
    clear();
    due = d.now() + ms;
    timer = d.setTimer(() => void run(), ms);
    patchArchiveStatus({ nextTickAt: due });
  };
  const syncStates = () => {
    const want = getArchiveCfg().states;
    if (want && !release) release = d.retain();
    else if (!want && release) {
      release();
      release = null;
    }
  };

  async function run(): Promise<void> {
    timer = null;
    if (stopped || inflight || !col) return;
    const cfg = getArchiveCfg();
    if (!cfg.on) return;
    const symbols = effectiveSymbols(cfg, d.observed());
    const iv = cfg.everyMin * 60_000;
    if (!symbols.length) {
      patchArchiveStatus({ state: "empty", detail: "Kein Symbol zum Archivieren – wähle eines aus.", nextTickAt: null });
      schedule(iv);
      return;
    }
    const started = d.now();
    patchArchiveStatus({ state: "ticking", detail: null, nextTickAt: null });
    inflight = (async () => {
      try {
        const r = await col!.tick(cfg, symbols);
        const st = getArchiveStatus();
        patchArchiveStatus({
          state: r.paused === "quota" ? "quota" : "idle",
          detail: r.paused === "quota" ? "Der Browser-Speicher ist fast voll – das Archiv pausiert, bis wieder Platz ist." : null,
          lastTickAt: r.record.t,
          lastRes: r.record.res,
          route: r.record.route,
          ticks: st.ticks + 1,
          rev: st.rev + 1,
        });
      } catch (e) {
        patchArchiveStatus({ state: "error", detail: e instanceof Error ? e.message : "Unbekannter Fehler beim Archivieren." });
      }
    })();
    await inflight;
    inflight = null;
    if (!stopped && getArchiveCfg().on) schedule(Math.max(1_000, iv - (d.now() - started)));
  }

  /** A tab that was asleep: an overdue tick runs soon, the stretch before stays a gap. */
  const wake = () => {
    if (stopped || inflight || !col) return;
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    const iv = getArchiveCfg().everyMin * 60_000;
    if (d.now() >= due && timer !== null) {
      schedule(RESUME_DELAY_MS);
    } else if (timer === null && d.now() - (col.lastTickAt ?? 0) >= iv) {
      schedule(RESUME_DELAY_MS);
    }
  };

  const offCfg = subscribeArchiveCfg(() => {
    const cfg = getArchiveCfg();
    syncStates();
    if (cfg.on && cfg.everyMin !== lastIv && col && !inflight) {
      lastIv = cfg.everyMin;
      const since = d.now() - (col.lastTickAt ?? d.now());
      schedule(Math.max(RESUME_DELAY_MS, cfg.everyMin * 60_000 - since));
    }
    lastIv = cfg.everyMin;
  });
  const onVisible = () => wake();
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisible);
  if (typeof window !== "undefined") {
    window.addEventListener("online", onVisible);
    window.addEventListener("focus", onVisible);
  }

  patchArchiveStatus({ state: "starting", detail: null });
  syncStates();
  void (async () => {
    try {
      db = await d.open();
    } catch (e) {
      if (!stopped) patchArchiveStatus({ state: "unavailable", detail: e instanceof ArchiveUnavailable ? e.message : "Das Archiv kann in diesem Browser nicht gespeichert werden." });
      return;
    }
    if (stopped) {
      db.close();
      return;
    }
    col = d.collector(db);
    await col.resume();
    if (stopped) return;
    const iv = getArchiveCfg().everyMin * 60_000;
    const last = col.lastTickAt;
    const wait = last === null ? 0 : last + iv - d.now();
    patchArchiveStatus({ state: "idle", lastTickAt: last });
    schedule(Math.max(d.startDelayMs, wait));
  })();

  return () => {
    if (stopped) return;
    stopped = true;
    clear();
    offCfg();
    release?.();
    release = null;
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisible);
    if (typeof window !== "undefined") {
      window.removeEventListener("online", onVisible);
      window.removeEventListener("focus", onVisible);
    }
    // an unfinished tick writes to the open database: close it afterwards
    void (inflight ?? Promise.resolve()).finally(() => db?.close());
    patchArchiveStatus({ state: "off", detail: null, nextTickAt: null });
  };
}
