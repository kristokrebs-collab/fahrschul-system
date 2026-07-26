import type { SyncDataType } from "@fahrschul/domain";
import { useSyncOptional, useSyncRevision } from "@fahrschul/ui";
import { useCallback, useEffect, useState } from "react";
import { apiGet, OfflineError } from "../api/client.js";

export interface UseApiGetResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  offline: boolean;
  fromCache: boolean;
  cachedAt: string | null;
  /** §1: ETag/Version des angezeigten Stands. */
  version: string | null;
  refresh: () => void;
}

/**
 * PROMPT -1 §6 (Phase 2) – der Refetch-Punkt.
 *
 * Der Realtime-Kanal liefert NUR "Thema X hat sich geändert". Genau hier wird
 * daraus ein Neuladen über den normalen, autorisierten GET: `dataTypes` sind
 * die Themen, für die diese Ansicht zuständig ist; ändert sich deren
 * Revisionszähler (oder wird eine Vollsynchronisation angeordnet), läuft der
 * Effekt erneut.
 *
 * Es gibt bewusst KEINEN Pfad, der Daten aus einer Kanalnachricht übernimmt.
 * Deshalb sind verlorene, doppelte und vertauschte Ereignisse harmlos: ein
 * verlorenes Ereignis wird beim nächsten Verbinden nachgeholt, ein doppeltes
 * erzeugt höchstens einen zweiten Refetch mit identischem Ergebnis.
 */
export function useApiGet<T>(path: string | null, ...dataTypes: SyncDataType[]): UseApiGetResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [version, setVersion] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const sync = useSyncOptional();
  const revision = useSyncRevision(...dataTypes);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setOffline(false);
    apiGet<T>(path)
      .then((res) => {
        if (cancelled) return;
        setData(res.data);
        setFromCache(res.fromCache);
        setCachedAt(res.cachedAt);
        setVersion(res.version);
        // §1: Datenalter der Statuszeile bezieht sich auf den letzten
        // BESTÄTIGTEN Serverstand – ein Treffer aus dem Cache zählt nicht.
        if (!res.fromCache) sync?.reportFresh();
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof OfflineError) {
          setOffline(true);
        } else {
          setError(err instanceof Error ? err.message : "Unbekannter Fehler");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, tick, revision]);

  return { data, loading, error, offline, fromCache, cachedAt, version, refresh };
}
