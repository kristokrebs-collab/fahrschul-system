import { STALE_AFTER_MS, type SyncDataType, type SyncState } from "@fahrschul/domain";
import {
  createHttpRealtimeTransport,
  createHttpSyncTransport,
  describeDataAge,
  loadDeviceId,
  loadDraftKey,
  localKeyValueStore,
  persistenceHealthy,
  processQueue,
  queueSummary,
  reconcileAfterReconnect,
  resolvePendingAfterRestart,
  reviewQueue as leseReviewQueue,
  listQueue,
  retryEntry,
  discardEntry,
  confirmStaleEntry,
  createCriticalOperation,
  createDraft,
  enqueueDraft,
  readEntryPayload,
  updateDraftPayload,
  RealtimeEngine,
  type CreateEntryInput,
  type DataAge,
  type KeyValueStore,
  type QueueDeps,
  type QueueSummary,
  type RealtimeStatus,
  type RealtimeTransport,
  type SyncQueueEntry,
  type SyncTransport,
} from "@fahrschul/sync";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

/**
 * PROMPT -1 §1/§6/§7/§8 – die REACT-Verdrahtung des Synchronisationskerns.
 *
 * Hier liegt sie, weil alle vier Frontends dieselbe brauchen. Die Logik selbst
 * steckt in `@fahrschul/sync` (rahmenlos, unit-testbar); dieses Modul ist
 * ausschließlich der Lebenszyklus: Kanal starten/stoppen, Online-Wechsel
 * beobachten, Warteschlange treiben, Zustand für die Anzeige bereitstellen.
 *
 * ## Wie eine Änderung im Frontend ankommt (§6, wörtlich der geforderte Weg)
 *
 *   Server committet -> Outbox -> Kanal meldet Ereignis-ID + Thema
 *     -> `revisionOf(thema)` erhöht sich
 *     -> jede Ansicht, die dieses Thema liest, lädt über ihren normalen,
 *        AUTORISIERTEN GET neu
 *     -> UI zeigt den Serverzustand.
 *
 * Es gibt bewusst KEINEN Pfad, der Daten aus einer Kanalnachricht in den
 * Zustand schreibt. Deshalb ist ein verlorenes, doppeltes oder vertauschtes
 * Ereignis harmlos.
 */

export interface SyncContextValue {
  ready: boolean;
  online: boolean;
  realtime: RealtimeStatus;
  summary: QueueSummary;
  entries: SyncQueueEntry[];
  /** §7: kritische Konflikte und veraltete Entwürfe – nie automatisch aufgelöst. */
  reviewQueue: SyncQueueEntry[];
  /** §1: Alter des angezeigten Serverstands. */
  dataAge: DataAge | null;
  /** Zusammengefasster Zustand für die Statuszeile. */
  status: SyncState;
  /** true, wenn der lokale Speicher NICHT schreibt (Privatmodus o. ä.). */
  persistenceHealthy: boolean;

  /** Zählt hoch, sobald das Thema laut Kanal veraltet ist -> Refetch-Auslöser. */
  revisionOf: (dataType: SyncDataType) => number;
  /** Zählt bei jeder Vollsynchronisation hoch. */
  resyncRevision: number;
  /** Von Ansichten aufzurufen, wenn ein GET erfolgreich war (§1 Datenalter). */
  reportFresh: (at?: Date) => void;

  /** §8: Entwurf anlegen (nur die vier erlaubten Arten, auch offline). */
  createDraft: (input: CreateEntryInput) => Promise<SyncQueueEntry>;
  /** §7: kritischer Vorgang (nie offline). */
  createCritical: (input: CreateEntryInput) => Promise<SyncQueueEntry>;
  updateDraft: (operationId: string, body: unknown) => Promise<SyncQueueEntry | null>;
  readPayload: <T>(entry: SyncQueueEntry) => Promise<T>;
  submitDraft: (operationId: string) => void;
  retry: (operationId: string) => void;
  discard: (operationId: string, options?: { force?: boolean }) => void;
  confirmStale: (operationId: string) => void;
  /** Warteschlange sofort abarbeiten (z. B. nach einer Benutzeraktion). */
  flush: () => Promise<void>;
  /** Kanal sofort abfragen (Polling-Modus / Fenster wieder aktiv). */
  pollNow: () => Promise<void>;
}

const SyncContext = createContext<SyncContextValue | null>(null);

export interface SyncProviderProps {
  apiBase: string;
  /** `null` = nicht angemeldet: der Kanal läuft nicht, die Liste ruht. */
  benutzerId: string | null;
  /** Speicherpräfix je App, damit sich vier Apps auf einem Origin nicht mischen. */
  storagePrefix: string;
  children: ReactNode;
  /** Testnähte – im Betrieb wird der HTTP-Transport benutzt. */
  realtimeTransport?: RealtimeTransport;
  syncTransport?: SyncTransport;
  store?: KeyValueStore;
  /** Aus Tests: Kanal nicht automatisch starten. */
  autoStart?: boolean;
  queueIntervalMs?: number;
}

const LEER_SUMMARY: QueueSummary = {
  entwuerfe: 0,
  wartend: 0,
  laufend: 0,
  wiederholend: 0,
  konflikte: 0,
  fehlgeschlagen: 0,
  veraltet: 0,
  ausgangUnbekannt: 0,
  gesamtStatus: "synced",
};

export function SyncProvider({
  apiBase,
  benutzerId,
  storagePrefix,
  children,
  realtimeTransport,
  syncTransport,
  store: injectedStore,
  autoStart = true,
  queueIntervalMs = 5000,
}: SyncProviderProps) {
  const store = useMemo(
    () => injectedStore ?? localKeyValueStore(storagePrefix),
    [injectedStore, storagePrefix],
  );
  const transport = useMemo(
    () => syncTransport ?? createHttpSyncTransport({ apiBase }),
    [syncTransport, apiBase],
  );
  const channel = useMemo(
    () => realtimeTransport ?? createHttpRealtimeTransport(apiBase),
    [realtimeTransport, apiBase],
  );

  const [ready, setReady] = useState(false);
  const [online, setOnline] = useState(() => transport.online());
  const [revisions, setRevisions] = useState<Partial<Record<SyncDataType, number>>>({});
  const [resyncRevision, setResyncRevision] = useState(0);
  const [realtime, setRealtime] = useState<RealtimeStatus>({
    mode: "down",
    connected: false,
    cursor: 0,
    lastSignalAt: null,
    streamFailures: 0,
    resyncs: 0,
    lastResyncReason: null,
  });
  const [entries, setEntries] = useState<SyncQueueEntry[]>([]);
  const [summary, setSummary] = useState<QueueSummary>(LEER_SUMMARY);
  const [lastFreshAt, setLastFreshAt] = useState<string | null>(null);
  const [jetzt, setJetzt] = useState(() => new Date());
  const depsRef = useRef<QueueDeps | null>(null);
  const engineRef = useRef<RealtimeEngine | null>(null);

  const speicherOk = useMemo(() => persistenceHealthy(store), [store]);

  const refreshQueueState = useCallback(
    (istOnline: boolean) => {
      setEntries(listQueue(store));
      setSummary(queueSummary(store, istOnline));
    },
    [store],
  );

  // ---- Aufbau: Schlüssel laden, offene Vorgänge auflösen, Kanal starten ----
  useEffect(() => {
    if (!benutzerId) {
      depsRef.current = null;
      setReady(false);
      setEntries([]);
      setSummary(LEER_SUMMARY);
      return;
    }
    let abgebrochen = false;
    (async () => {
      const deps: QueueDeps = {
        store,
        transport,
        draftKey: await loadDraftKey(store, benutzerId),
        deviceId: loadDeviceId(store),
        benutzerId,
      };
      if (abgebrochen) return;
      depsRef.current = deps;

      // §7: ZUERST offene Vorgänge auflösen, BEVOR irgendetwas erneut gesendet
      // wird. Ein blindes Wiederholen nach einem Neustart wäre genau der
      // Fehler, den der Idempotenzspeicher verhindern soll.
      try {
        if (transport.online()) await resolvePendingAfterRestart(deps);
      } catch {
        // Kein Netz beim Start: bleibt offen, wird beim nächsten Versuch geklärt.
      }
      if (abgebrochen) return;
      refreshQueueState(transport.online());
      setReady(true);
    })();
    return () => {
      abgebrochen = true;
    };
  }, [benutzerId, store, transport, refreshQueueState]);

  // ---- Online-/Offline-Wechsel ----
  useEffect(() => {
    const goOnline = () => {
      setOnline(true);
      const deps = depsRef.current;
      if (!deps) return;
      // §8: nach der Wiederverbindung erst prüfen (Identität, veraltete
      // Entwürfe, Konflikte), dann senden.
      void (async () => {
        try {
          await reconcileAfterReconnect(deps);
          await processQueue(deps);
        } finally {
          refreshQueueState(true);
        }
      })();
      engineRef.current?.retryStream();
    };
    const goOffline = () => {
      setOnline(false);
      refreshQueueState(false);
    };
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, [refreshQueueState]);

  // ---- Realtime-Kanal ----
  useEffect(() => {
    if (!ready || !benutzerId || !autoStart) return;
    const engine = new RealtimeEngine({
      store,
      transport: channel,
      onInvalidate: (dataTypes) => {
        setRevisions((vorher) => {
          const next = { ...vorher };
          for (const t of dataTypes) next[t] = (next[t] ?? 0) + 1;
          return next;
        });
      },
      onResync: () => setResyncRevision((r) => r + 1),
      onStatusChange: (status) => setRealtime(status),
    });
    engineRef.current = engine;
    engine.start();
    return () => {
      engine.stop();
      engineRef.current = null;
    };
  }, [ready, benutzerId, autoStart, store, channel]);

  // ---- Warteschlange regelmäßig treiben (§9 Backoff wird respektiert) ----
  useEffect(() => {
    if (!ready || queueIntervalMs <= 0) return;
    const timer = setInterval(() => {
      const deps = depsRef.current;
      if (!deps) return;
      void processQueue(deps).finally(() => refreshQueueState(deps.transport.online()));
    }, queueIntervalMs);
    return () => clearInterval(timer);
  }, [ready, queueIntervalMs, refreshQueueState]);

  // ---- Datenalter tickt weiter, auch ohne neue Daten (§1) ----
  useEffect(() => {
    const timer = setInterval(() => setJetzt(new Date()), 15_000);
    return () => clearInterval(timer);
  }, []);

  const requireDeps = useCallback((): QueueDeps => {
    const deps = depsRef.current;
    if (!deps) throw new Error("Synchronisation ist nicht bereit (nicht angemeldet).");
    return deps;
  }, []);

  const value = useMemo<SyncContextValue>(() => {
    const dataAge = describeDataAge(lastFreshAt, { now: jetzt, staleAfterMs: STALE_AFTER_MS });
    // §7: `stale` gewinnt gegen `synced`, sobald der angezeigte Stand alt ist –
    // ein veralteter Stand darf nicht als "aktuell" erscheinen.
    const status: SyncState =
      summary.gesamtStatus === "synced" && dataAge?.stale ? "stale" : summary.gesamtStatus;

    return {
      ready,
      online,
      realtime,
      summary,
      entries,
      reviewQueue: leseReviewQueue(store),
      dataAge,
      status,
      persistenceHealthy: speicherOk,
      revisionOf: (dataType) => revisions[dataType] ?? 0,
      resyncRevision,
      reportFresh: (at) => setLastFreshAt((at ?? new Date()).toISOString()),
      async createDraft(input) {
        const entry = await createDraft(requireDeps(), input);
        refreshQueueState(online);
        return entry;
      },
      async createCritical(input) {
        const entry = await createCriticalOperation(requireDeps(), input);
        refreshQueueState(online);
        return entry;
      },
      async updateDraft(operationId, body) {
        const entry = await updateDraftPayload(requireDeps(), operationId, body);
        refreshQueueState(online);
        return entry;
      },
      readPayload<T>(entry: SyncQueueEntry) {
        return readEntryPayload<T>(requireDeps(), entry);
      },
      submitDraft(operationId) {
        enqueueDraft(requireDeps(), operationId);
        refreshQueueState(online);
      },
      retry(operationId) {
        retryEntry(store, operationId);
        refreshQueueState(online);
      },
      discard(operationId, options) {
        discardEntry(store, operationId, options);
        refreshQueueState(online);
      },
      confirmStale(operationId) {
        confirmStaleEntry(store, operationId);
        refreshQueueState(online);
      },
      async flush() {
        const deps = depsRef.current;
        if (!deps) return;
        await processQueue(deps);
        refreshQueueState(deps.transport.online());
      },
      async pollNow() {
        await engineRef.current?.pollNow();
      },
    };
  }, [
    ready,
    online,
    realtime,
    summary,
    entries,
    store,
    lastFreshAt,
    jetzt,
    revisions,
    resyncRevision,
    speicherOk,
    requireDeps,
    refreshQueueState,
  ]);

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

export function useSync(): SyncContextValue {
  const ctx = useContext(SyncContext);
  if (!ctx) throw new Error("useSync muss innerhalb von <SyncProvider> benutzt werden");
  return ctx;
}

/**
 * Sicherer Zugriff für Komponenten, die auch ohne Provider funktionieren
 * müssen (z. B. der Login-Screen).
 */
export function useSyncOptional(): SyncContextValue | null {
  return useContext(SyncContext);
}

/**
 * Refetch-Auslöser für eine Ansicht: liefert eine Zahl, die sich erhöht, wenn
 * der Kanal für dieses Thema eine Änderung gemeldet hat ODER eine
 * Vollsynchronisation angeordnet wurde. Gehört in die Abhängigkeiten des
 * jeweiligen GET-Hooks.
 */
export function useSyncRevision(...dataTypes: SyncDataType[]): number {
  const ctx = useSyncOptional();
  if (!ctx) return 0;
  return dataTypes.reduce((summe, t) => summe + ctx.revisionOf(t), 0) + ctx.resyncRevision;
}
