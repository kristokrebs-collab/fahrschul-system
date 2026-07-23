import { useCallback, useEffect, useState } from "react";
import { apiGet, ApiError } from "../api/client.js";

export interface ApiGetState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/** Einfacher Live-Fetch-Hook (kein Offline-Fallback, siehe api/client.ts). */
export function useApiGet<T>(path: string | null, deps: unknown[] = []): ApiGetState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

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
        if (!cancelled) setData(body);
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
  }, [path, tick, ...deps]);

  return { data, loading, error, reload };
}
