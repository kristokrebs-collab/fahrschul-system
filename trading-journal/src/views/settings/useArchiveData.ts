/**
 * Datenarchiv view (F26) – reads the store for the card: the rows (series × symbol) with count and range, then – row by
 * row, between two tasks – the gaps of each. Its own connection to the database (the collector keeps its own); a
 * browser without IndexedDB ends in `unavailable`.
 */
import { useEffect, useRef, useState } from "react";
import { findGaps, seriesDef } from "@/domain/archive";
import { openArchiveDb, storageEstimate, type ArchiveDb } from "@/market/archive/db";
import type { RowView } from "./archiveModel";

export interface ArchiveData {
  phase: "loading" | "ready" | "unavailable";
  rows: RowView[];
  /** the browser's numbers for the whole site, `null` when it does not tell */
  storage: { usage: number; quota: number } | null;
  db: () => ArchiveDb | null;
}

const yieldTask = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

export function useArchiveData(rev: number): ArchiveData {
  const dbRef = useRef<ArchiveDb | null>(null);
  const [opened, setOpened] = useState<"loading" | "ready" | "unavailable">("loading");
  const [rows, setRows] = useState<RowView[]>([]);
  const [storage, setStorage] = useState<ArchiveData["storage"]>(null);

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
        const [overview, ticks] = await Promise.all([db.overview(), db.ticks()]);
        if (!alive) return;
        let current: RowView[] = overview.map((info) => ({ info, gaps: null }));
        setRows(current);
        void storageEstimate().then((e) => alive && setStorage(e));
        for (const info of overview) {
          await yieldTask();
          if (!alive) return;
          const times = await db.times(info.series, info.symbol);
          const gaps = findGaps(seriesDef(info.series), info.symbol, times, ticks);
          current = current.map((r) => (r.info.series === info.series && r.info.symbol === info.symbol ? { ...r, gaps } : r));
          setRows(current);
        }
      } catch {
        /* a closed connection (unmounted) or a failing read: the rows stay as they are */
      }
    })();
    return () => {
      alive = false;
    };
  }, [opened, rev]);

  return { phase: opened, rows, storage, db: () => dbRef.current };
}
