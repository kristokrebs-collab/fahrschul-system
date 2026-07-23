import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { apiMutate, API_BASE, ApiError } from "../api/client.js";

export interface SessionUser {
  id: string;
  email: string;
  rolle: string;
  vorname: string;
  nachname: string;
  standortId: string | null;
}

interface SessionContextValue {
  user: SessionUser | null;
  loading: boolean;
  login: (email: string, password: string, totpToken?: string) => Promise<void>;
  logout: () => Promise<void>;
  logoutAll: () => Promise<number>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/me`, { credentials: "include" });
      if (res.ok) {
        const body = await res.json();
        setUser(body.user);
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const login = useCallback(async (email: string, password: string, totpToken?: string) => {
    const body = await apiMutate<{ user: SessionUser }>("/auth/login", "POST", { email, password, totpToken });
    setUser(body.user);
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiMutate("/auth/logout", "POST");
    } catch (err) {
      if (!(err instanceof ApiError)) {
        // Netzwerkfehler beim Logout: Client-Session trotzdem verwerfen.
      }
    }
    setUser(null);
  }, []);

  /** Remote-Logout: invalidiert ALLE Sessions dieses Benutzers, nicht nur die aktuelle. */
  const logoutAll = useCallback(async () => {
    const res = await apiMutate<{ revokedSessions: number }>("/auth/logout-all", "POST");
    setUser(null);
    return res.revokedSessions;
  }, []);

  const value = useMemo(() => ({ user, loading, login, logout, logoutAll }), [user, loading, login, logout, logoutAll]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within SessionProvider");
  return ctx;
}
