import { useEffect, useId, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useCloudSession } from "@/cloud/session";
import { CsvImportSheet } from "./csv/CsvImportSheet";
import { exchangeEnabled, loadExchangeStatus, pullNow, useExchange } from "./store";
import { ConnectSheet } from "./ui/ConnectSheet";
import { DryRunSheet } from "./ui/DryRunSheet";

/* ------------------------------------------------------------------ one active host */

let hosts: string[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** The first mounted host is the active one; when it unmounts the next takes over (App host + page fallback). */
function useActiveHost(id: string): boolean {
  useEffect(() => {
    hosts = [...hosts, id];
    emit();
    return () => {
      hosts = hosts.filter((h) => h !== id);
      emit();
    };
  }, [id]);
  return useSyncExternalStore(
    subscribe,
    () => hosts[0] === id,
    () => false,
  );
}

/** Pull cadence for devices without cloud sync (the server's cron writes every 30 min). */
export const PULL_EVERY_MS = 10 * 60_000;
const PULL_MIN_GAP_MS = 2 * 60_000;

/**
 * Exchange host (P11). Mount ONCE in `App` (after `SetupEditor`, before `Celebrate`; P14) – `ExchangeSection` also
 * mounts one as a fallback, only the first mounted host is active. It
 * - renders the sheets (Bitunix connect, dry run, CSV import) in a portal on `document.body` (no transformed
 *   ancestor can become their containing block);
 * - when signed in: loads the exchange status once and, for devices WITHOUT cloud sync, pulls the trades the server
 *   wrote (cron, first import, webhook, REST) on start, every 10 min while visible and when the tab comes back.
 * Inert without cloud (the CSV sheet still works – it is local).
 */
export function ExchangeHost() {
  const id = useId();
  const active = useActiveHost(id);
  const enabled = exchangeEnabled();
  const uid = useCloudSession((s) => (s.phase === "signedIn" ? (s.user?.id ?? null) : null));

  useEffect(() => {
    if (!active || !enabled || !uid) return;
    let last = 0;
    const pull = () => {
      const has = useExchange.getState().status?.connections.some((c) => c.status !== "revoked");
      if (!has || Date.now() - last < PULL_MIN_GAP_MS) return;
      last = Date.now();
      void pullNow({ toast: true });
    };
    void loadExchangeStatus().then(pull);
    const timer = setInterval(() => document.visibilityState === "visible" && pull(), PULL_EVERY_MS);
    const onVis = () => document.visibilityState === "visible" && pull();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [active, enabled, uid]);

  if (!active || typeof document === "undefined") return null;
  return createPortal(
    <>
      {enabled && <ConnectSheet />}
      {enabled && <DryRunSheet />}
      <CsvImportSheet />
    </>,
    document.body,
  );
}
