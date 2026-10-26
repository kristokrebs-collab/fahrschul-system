/**
 * Squeeze card (F07) – reads the archive for the card: which symbols have funding / price rows, and the series of the chosen
 * one (30 days). Its own connection to the store; reloads whenever the collector finished a tick (`status.rev`). The „now“
 * of the freshness rule is taken here, in the effect – never during render.
 */
import { useEffect, useRef, useState } from "react";
import { openArchiveDb, type ArchiveDb } from "@/market/archive/db";
import { loadSqueezeData, type SqueezeSnapshot } from "@/market/squeeze/read";

export interface SqueezeLoad {
  phase: "loading" | "ready" | "unavailable";
  /** symbols that have a funding / price row in the archive (alphabetical) */
  symbols: string[];
  /** the symbol shown: the user's pick, else the live symbol when it is archived, else the first archived one */
  symbol: string | null;
  snapshot: SqueezeSnapshot | null;
  /** device time of the load */
  at: number;
}

const EMPTY: SqueezeLoad = { phase: "loading", symbols: [], symbol: null, snapshot: null, at: 0 };
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
        const symbols = [...new Set((await db.overview()).filter((r) => r.series === "premium").map((r) => r.symbol))].sort();
        const chosen = picked && symbols.includes(picked) ? picked : live && symbols.includes(live) ? live : (symbols[0] ?? null);
        const at = Date.now();
        const snapshot = chosen ? await loadSqueezeData(db, chosen, at) : null;
        if (alive) setState({ phase: "ready", symbols, symbol: chosen, snapshot, at });
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
