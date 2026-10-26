/**
 * Squeeze card (F07) – reads the archive for the card: which symbols have funding / price rows (collected or loaded from the
 * exchange's history), and the series of the chosen one (30 days) – the collected ones and, separately, the loaded history.
 * Its own connection to the store; reloads whenever the collector finished a tick or a history load ended (`status.rev`).
 * The „now“ of the freshness rule is taken here, in the effect – never during render.
 */
import { useEffect, useRef, useState } from "react";
import { openArchiveDb, type ArchiveDb } from "@/market/archive/db";
import { loadHistoryData, loadSqueezeData, type HistorySnapshot, type SqueezeSnapshot } from "@/market/squeeze/read";

export interface SqueezeLoad {
  phase: "loading" | "ready" | "unavailable";
  /** symbols that have a funding / price row in the archive, collected or loaded (alphabetical) */
  symbols: string[];
  /** the symbol shown: the user's pick, else the live symbol when it is archived, else the first archived one */
  symbol: string | null;
  /** what the app collected itself */
  snapshot: SqueezeSnapshot | null;
  /** what was loaded from the exchange's history – a separate data set, `null` when nothing was loaded for this symbol */
  history: HistorySnapshot | null;
  /** device time of the load */
  at: number;
}

const EMPTY: SqueezeLoad = { phase: "loading", symbols: [], symbol: null, snapshot: null, history: null, at: 0 };
const UNAVAILABLE: SqueezeLoad = { ...EMPTY, phase: "unavailable" };

export function useSqueezeData(picked: string | null, live: string | null, rev: number): SqueezeLoad {
  const dbRef = useRef<ArchiveDb | null>(null);
  const [opened, setOpened] = useState<"loading" | "ready" | "unavailable">("loading");
  const [state, setState] = useState<SqueezeLoad>(EMPTY);

  useEffect(() => {
    let alive = true;
    openArchiveDb()
      .then((db) => {
        if (!alive) return db.close();
        dbRef.current = db;
        setOpened("ready");
      })
      .catch(() => alive && setOpened("unavailable"));
    return () => {
      alive = false;
      dbRef.current?.close();
      dbRef.current = null;
    };
  }, []);

  useEffect(() => {
    const db = dbRef.current;
    if (opened !== "ready" || !db) return;
    let alive = true;
    void (async () => {
      try {
        const overview = await db.overview();
        const symbols = [...new Set(overview.filter((r) => r.series === "premium" || r.series === "markHist").map((r) => r.symbol))].sort();
        const chosen = picked && symbols.includes(picked) ? picked : live && symbols.includes(live) ? live : (symbols[0] ?? null);
        const at = Date.now();
        const hasHistory = !!chosen && overview.some((r) => r.symbol === chosen && r.series === "markHist");
        const snapshot = chosen ? await loadSqueezeData(db, chosen, at) : null;
        const history = chosen && hasHistory ? await loadHistoryData(db, chosen, at) : null;
        if (alive) setState({ phase: "ready", symbols, symbol: chosen, snapshot, history, at });
      } catch {
        /* a closed connection (unmounted) or a failing read: the card keeps what it shows */
      }
    })();
    return () => {
      alive = false;
    };
  }, [opened, picked, live, rev]);

  return opened === "unavailable" ? UNAVAILABLE : state;
}
