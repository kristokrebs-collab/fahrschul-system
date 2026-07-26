import type { SyncDataType } from "@fahrschul/domain";
import { useSyncOptional, useSyncRevision } from "@fahrschul/ui";
import { useCallback, useEffect, useState } from "react";
import { apiGet, ApiError } from "../api/client.js";

export interface ApiGetState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/**
 * Einfacher Live-Fetch-Hook (kein Offline-Fallback, siehe api/client.ts).
 *
 * PROMPT -1 §6 (Phase 2): `dataTypes` sind die Themen, für die diese Ansicht
 * zuständig ist. Meldet der Realtime-Kanal eine Änderung an einem dieser
 * Themen (oder eine Vollsynchronisation), läuft der Effekt erneut und die
 * Ansicht lädt über ihren normalen, AUTORISIERTEN GET neu. Es gibt bewusst
 * keinen Pfad, der Daten aus der Kanalnachricht übernimmt.
 */
export function useApiGet<T>(
  path: string | null,
  deps: unknown[] = [],
  dataTypes: SyncDataType[] = [],
): ApiGetState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const sync = useSyncOptional();
  const revision = useSyncRevision(...dataTypes);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!path) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiGet<T>(path)
      .then((body) => {
        if (cancelled) return;
        setData(body);
        // §1: Datenalter der Statuszeile bezieht sich auf den letzten
        // bestätigten Serverstand.
        sync?.reportFresh();
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : "Netzwerkfehler");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, tick, revision, ...deps]);

  return { data, loading, error, reload };
}
