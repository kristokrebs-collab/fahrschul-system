import { useCallback, useEffect, useState } from "react";
import { apiGet, OfflineError } from "../api/client.js";

export interface UseApiGetResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  offline: boolean;
  fromCache: boolean;
  cachedAt: string | null;
  refresh: () => void;
}

export function useApiGet<T>(path: string | null): UseApiGetResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

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
  }, [path, tick]);

  return { data, loading, error, offline, fromCache, cachedAt, refresh };
}
