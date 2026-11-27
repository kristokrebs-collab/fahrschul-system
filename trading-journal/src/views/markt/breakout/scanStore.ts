/**
 * Der Lauf des Scanners „Wer bricht aus?“ (im Speicher des Tabs): zwölf Märkte, je eine Seite 5-Minuten-Kerzen, drei Abrufe
 * gleichzeitig. Jede Karte füllt sich, sobald IHRE Kerzen da sind – der Zähler „Geprüft 7/12“ ist der echte Stand, nichts wird
 * abgespielt oder hinausgezögert. Ein Sitzungswechsel rechnet auf denselben Kerzen neu, solange sie frisch sind (60 s); sonst
 * wird neu geladen. Fällt ein Markt aus, steht sein Grund auf seiner Karte; fällt alles aus, sagt die Seite es – ohne Ersatzdaten.
 */
import { create } from "zustand";
import { analyzeBreakout, BREAKOUT_SYMBOLS, rankReads, type BreakoutRead, type BreakoutSessionId } from "@/domain/breakout";
import { breakoutLoader, type BreakoutSource } from "@/market/breakout/candles";
import type { Candle } from "@/market/types";

export type Row =
  | { state: "pending"; symbol: string }
  | { state: "ok"; symbol: string; read: BreakoutRead; source: BreakoutSource; fetchedAt: number }
  | { state: "error"; symbol: string; message: string };

export type ScanPhase = "idle" | "scanning" | "done";

interface ScanState {
  phase: ScanPhase;
  session: BreakoutSessionId;
  /** by symbol */
  rows: Record<string, Row>;
  /** the order the cards stand in: the fixed list while scanning, the ranking once done */
  order: readonly string[];
  /** when the newest candles of the run arrived */
  fetchedAt: number | null;
  selected: string | null;
  /** every market failed: the reason (the page shows it instead of the list) */
  failure: string | null;
  start(opts?: { session?: BreakoutSessionId; fresh?: boolean }): Promise<void>;
  select(symbol: string): void;
}

/** Candles are reused for a session switch while they are this fresh. */
export const REUSE_MS = 60_000;
const PARALLEL = 3;

const cache = new Map<string, { candles: Candle[]; source: BreakoutSource; fetchedAt: number }>();
let run: AbortController | null = null;
let clock: () => number = () => Date.now();

/** The viewer's zone: the clock times in the words are the ones his own clock shows (like the "Abruf" line under the cards). */
const zone = (): string | undefined => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
};

const pendingRows = (): Record<string, Row> => Object.fromEntries(BREAKOUT_SYMBOLS.map((s) => [s, { state: "pending", symbol: s } as Row]));

function finish(rows: Record<string, Row>): Pick<ScanState, "order" | "selected" | "failure" | "phase"> {
  const ok = Object.values(rows).filter((r): r is Extract<Row, { state: "ok" }> => r.state === "ok");
  const ranked = rankReads(ok.map((r) => r.read)).map((r) => r.symbol);
  const rest = BREAKOUT_SYMBOLS.filter((s) => !ranked.includes(s));
  const firstError = Object.values(rows).find((r): r is Extract<Row, { state: "error" }> => r.state === "error");
  return { phase: "done", order: [...ranked, ...rest], selected: ranked[0] ?? null, failure: ok.length === 0 ? (firstError?.message ?? "Keine Kerzen erhalten.") : null };
}

export const useBreakoutScan = create<ScanState>()((set, get) => ({
  phase: "idle",
  session: "newyork",
  rows: pendingRows(),
  order: BREAKOUT_SYMBOLS,
  fetchedAt: null,
  selected: null,
  failure: null,
  select: (symbol) => set({ selected: symbol }),
  async start(opts = {}) {
    const session = opts.session ?? get().session;
    run?.abort();
    const ctrl = new AbortController();
    run = ctrl;
    const now = clock();
    const fresh = !opts.fresh && BREAKOUT_SYMBOLS.every((s) => {
      const c = cache.get(s);
      return c && now - c.fetchedAt < REUSE_MS;
    });
    if (fresh) {
      // the same candles, read for the other session: no request, no waiting
      const rows: Record<string, Row> = {};
      for (const s of BREAKOUT_SYMBOLS) {
        const c = cache.get(s)!;
        rows[s] = { state: "ok", symbol: s, read: analyzeBreakout({ symbol: s, candles: c.candles, sessionId: session, now, timeZone: zone() }), source: c.source, fetchedAt: c.fetchedAt };
      }
      set({ session, rows, ...finish(rows) });
      return;
    }
    set({ phase: "scanning", session, rows: pendingRows(), order: BREAKOUT_SYMBOLS, selected: null, failure: null });
    const loader = breakoutLoader();
    loader.reset();
    const queue = [...BREAKOUT_SYMBOLS];
    const worker = async (): Promise<void> => {
      for (;;) {
        const symbol = queue.shift();
        if (!symbol || ctrl.signal.aborted) return;
        const r = await loader.load(symbol, ctrl.signal);
        if (ctrl.signal.aborted) return;
        let row: Row;
        if (r.ok) {
          cache.set(symbol, { candles: r.candles, source: r.source, fetchedAt: r.fetchedAt });
          row = { state: "ok", symbol, read: analyzeBreakout({ symbol, candles: r.candles, sessionId: session, now: r.fetchedAt, timeZone: zone() }), source: r.source, fetchedAt: r.fetchedAt };
        } else {
          cache.delete(symbol);
          row = { state: "error", symbol, message: r.message };
        }
        set((s) => ({ rows: { ...s.rows, [symbol]: row }, fetchedAt: r.ok ? r.fetchedAt : s.fetchedAt }));
      }
    };
    await Promise.all(Array.from({ length: PARALLEL }, worker));
    if (ctrl.signal.aborted) return;
    set((s) => finish(s.rows));
  },
}));

/** How many markets have an answer (a reading or a reason). */
export const checkedCount = (rows: Record<string, Row>): number => Object.values(rows).filter((r) => r.state !== "pending").length;

/** Tests: empty state, an own clock. */
export function __resetBreakoutScan(now?: () => number): void {
  run?.abort();
  run = null;
  cache.clear();
  clock = now ?? (() => Date.now());
  useBreakoutScan.setState({ phase: "idle", session: "newyork", rows: pendingRows(), order: BREAKOUT_SYMBOLS, fetchedAt: null, selected: null, failure: null });
}
