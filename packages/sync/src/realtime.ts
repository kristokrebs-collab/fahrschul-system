import type { SyncDataType } from "@fahrschul/domain";
import { computeBackoffMs } from "./retry-client.js";
import type { KeyValueStore } from "./store.js";

/**
 * PROMPT -1 §6 – CLIENTSEITE des Echtzeitkanals.
 *
 * ## Die einzige Annahme, die dieser Client macht
 *
 * **Keine.** Konkret: er nimmt NICHT an, dass Ereignisse ankommen, dass sie
 * genau einmal ankommen oder dass sie in Reihenfolge ankommen. Er ist korrekt,
 * weil er aus einer Meldung ausschließlich ableitet: "Thema X könnte veraltet
 * sein – lade es neu." Der Zustand kommt danach aus der autorisierten
 * Serverantwort, nie aus der Meldung.
 *
 * Daraus folgt Zeile für Zeile:
 *
 *  - **Verlorene Ereignisse** sind unschädlich, weil (a) der Cursor dicht ist
 *    und eine Lücke erkennbar macht, (b) der Heartbeat einen toten Kanal
 *    entdeckt und (c) `refreshAll()` bei jedem (Wieder-)Verbinden läuft.
 *  - **Doppelte Ereignisse** sind unschädlich, weil `seenEventIds` sie
 *    ausfiltert UND weil ein doppeltes Neuladen dasselbe Ergebnis hat.
 *  - **Vertauschte Ereignisse** sind unschädlich, weil der Cursor nur
 *    VORWÄRTS gesetzt wird (`Math.max`) und ein Thema ohnehin komplett neu
 *    geladen wird – es gibt kein inkrementelles Anwenden von Deltas, das
 *    Reihenfolge bräuchte.
 *  - **Kanal ganz weg** ist unschädlich, weil nach `maxStreamFailures`
 *    fehlgeschlagenen Verbindungen automatisch auf Polling umgeschaltet wird
 *    (`GET /sync/changes`). Die Konvergenz ist identisch, nur langsamer.
 *
 * ## SEAM Phase 3 (§18 Degraded-Operation-UX)
 * `mode` ("stream" | "polling" | "down") ist bewusst nach außen gegeben. Der
 * eingeschränkte Betrieb braucht keinen neuen Mechanismus, nur eine Anzeige.
 */

export interface RealtimeChangeMessage {
  cursor: number;
  eventId: string;
  eventType: string;
  dataType: SyncDataType;
}

export type RealtimeMode = "stream" | "polling" | "down";

export interface RealtimeStatus {
  mode: RealtimeMode;
  connected: boolean;
  cursor: number;
  /** Zeitpunkt des letzten Lebenszeichens (Heartbeat, Hello oder Änderung). */
  lastSignalAt: string | null;
  /** Anzahl aufeinanderfolgender fehlgeschlagener Stream-Verbindungen. */
  streamFailures: number;
  /** Wie oft eine Vollsynchronisation angeordnet wurde. */
  resyncs: number;
  lastResyncReason: string | null;
}

/**
 * Abstraktion über EventSource/fetch, damit die Logik ohne echten Server
 * testbar ist – und damit ein Umschalten auf WebSocket später nur diese
 * Schnittstelle betrifft.
 */
export interface RealtimeStreamHandle {
  close(): void;
}

export interface RealtimeTransport {
  /**
   * Öffnet den Stream. Meldet über die Rückrufe; ein `error` bedeutet
   * "Verbindung weg", NICHT "Ereignis verloren".
   */
  openStream(input: {
    cursor: number;
    onHello: (data: { cursor: number; resyncRequired: boolean; resyncReason: string | null }) => void;
    onChange: (change: RealtimeChangeMessage) => void;
    onResync: (data: { reason: string | null; cursor: number }) => void;
    onHeartbeat: () => void;
    onError: (err: unknown) => void;
  }): RealtimeStreamHandle;
  /** Polling-Fallback – derselbe Lesepfad, ohne langlebige Verbindung. */
  poll(cursor: number): Promise<{
    changes: RealtimeChangeMessage[];
    cursor: number;
    latestCursor: number;
    resyncRequired: boolean;
    resyncReason: string | null;
    hasMore: boolean;
  }>;
  online(): boolean;
}

export interface RealtimeEngineOptions {
  store: KeyValueStore;
  transport: RealtimeTransport;
  /** Wird mit den betroffenen Themen aufgerufen – DER Refetch-Auslöser. */
  onInvalidate: (dataTypes: SyncDataType[]) => void;
  /** Vollsynchronisation: alles verwerfen und neu laden. */
  onResync: (reason: string | null) => void;
  onStatusChange?: (status: RealtimeStatus) => void;
  /** Ab wie vielen fehlgeschlagenen Stream-Verbindungen auf Polling umschalten. */
  maxStreamFailures?: number;
  pollIntervalMs?: number;
  /** Ohne Lebenszeichen länger als das gilt der Stream als tot. */
  heartbeatTimeoutMs?: number;
  /** Themen werden gesammelt und gebündelt gemeldet, statt pro Ereignis. */
  invalidateDebounceMs?: number;
  now?: () => Date;
  setTimeoutFn?: (fn: () => void, ms: number) => unknown;
  clearTimeoutFn?: (handle: unknown) => void;
}

const CURSOR_KEY = "realtime:cursor";
const SEEN_KEY = "realtime:seen";
const SEEN_LIMIT = 200;

export function readStoredCursor(store: KeyValueStore): number {
  const raw = store.get(CURSOR_KEY);
  const value = raw === null ? 0 : Number(raw);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

export function writeStoredCursor(store: KeyValueStore, cursor: number): void {
  store.set(CURSOR_KEY, String(Math.max(0, Math.floor(cursor))));
}

export function clearRealtimeState(store: KeyValueStore): void {
  store.remove(CURSOR_KEY);
  store.remove(SEEN_KEY);
}

export class RealtimeEngine {
  private readonly options: RealtimeEngineOptions;
  private handle: RealtimeStreamHandle | null = null;
  private pollTimer: unknown = null;
  private watchdog: unknown = null;
  private stopped = true;
  private pending = new Set<SyncDataType>();
  private flushTimer: unknown = null;
  private seen: string[];
  private status: RealtimeStatus;

  constructor(options: RealtimeEngineOptions) {
    this.options = options;
    this.seen = this.loadSeen();
    this.status = {
      mode: "down",
      connected: false,
      cursor: readStoredCursor(options.store),
      lastSignalAt: null,
      streamFailures: 0,
      resyncs: 0,
      lastResyncReason: null,
    };
  }

  getStatus(): RealtimeStatus {
    return { ...this.status };
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.closeStream();
    this.clear(this.pollTimer);
    this.clear(this.watchdog);
    this.clear(this.flushTimer);
    this.pollTimer = null;
    this.watchdog = null;
    this.flushTimer = null;
    this.setStatus({ connected: false, mode: "down" });
  }

  // -------------------------------------------------------------------------
  private connect(): void {
    if (this.stopped) return;
    if (!this.options.transport.online()) {
      // Offline ist kein Fehler des Kanals – nicht als Fehlversuch zählen.
      this.setStatus({ connected: false, mode: "down" });
      this.scheduleReconnect(this.backoff(1));
      return;
    }

    const maxFailures = this.options.maxStreamFailures ?? 3;
    if (this.status.streamFailures >= maxFailures) {
      this.startPolling();
      return;
    }

    try {
      this.handle = this.options.transport.openStream({
        cursor: this.status.cursor,
        onHello: (data) => {
          this.setStatus({
            connected: true,
            mode: "stream",
            streamFailures: 0,
            lastSignalAt: this.nowIso(),
          });
          if (data.resyncRequired) {
            this.applyResync(data.resyncReason, data.cursor);
          } else {
            // Auch ohne Lücke einmal alles neu laden: zwischen Verbindungsende
            // und Wiederaufbau kann etwas passiert sein, das kein Ereignis mehr
            // erreichen konnte.
            this.options.onResync(null);
          }
          this.armWatchdog();
        },
        onChange: (change) => this.applyChange(change),
        onResync: (data) => this.applyResync(data.reason, data.cursor),
        onHeartbeat: () => {
          this.setStatus({ lastSignalAt: this.nowIso() });
          this.armWatchdog();
        },
        onError: () => this.handleStreamFailure(),
      });
    } catch {
      this.handleStreamFailure();
    }
  }

  private handleStreamFailure(): void {
    this.closeStream();
    const failures = this.status.streamFailures + 1;
    const maxFailures = this.options.maxStreamFailures ?? 3;
    this.setStatus({ connected: false, streamFailures: failures, mode: "down" });
    if (this.stopped) return;
    if (failures >= maxFailures) {
      // §6 Polling-Fallback. Bewusst KEIN endloses Reconnect-Karussell: ein
      // Proxy, der SSE blockiert, wird nicht durch Wiederholen freundlicher.
      this.startPolling();
      return;
    }
    this.scheduleReconnect(this.backoff(failures));
  }

  private startPolling(): void {
    if (this.stopped) return;
    this.closeStream();
    this.clear(this.watchdog);
    this.setStatus({ mode: "polling", connected: false });
    const intervalMs = this.options.pollIntervalMs ?? 15_000;
    const tick = async () => {
      if (this.stopped) return;
      if (this.options.transport.online()) {
        try {
          const result = await this.options.transport.poll(this.status.cursor);
          this.setStatus({ lastSignalAt: this.nowIso(), connected: true });
          if (result.resyncRequired) {
            this.applyResync(result.resyncReason, result.latestCursor);
          } else {
            for (const change of result.changes) this.applyChange(change);
          }
        } catch {
          this.setStatus({ connected: false });
        }
      } else {
        this.setStatus({ connected: false });
      }
      if (!this.stopped) this.pollTimer = this.later(() => void tick(), intervalMs);
    };
    void tick();
  }

  /** Von außen aufrufbar: sofort einmal nachfragen (z. B. Fenster wieder aktiv). */
  async pollNow(): Promise<void> {
    if (!this.options.transport.online()) return;
    const result = await this.options.transport.poll(this.status.cursor);
    this.setStatus({ lastSignalAt: this.nowIso() });
    if (result.resyncRequired) {
      this.applyResync(result.resyncReason, result.latestCursor);
      return;
    }
    for (const change of result.changes) this.applyChange(change);
  }

  /** Zurück zum Stream versuchen (z. B. nachdem das Netz wieder da ist). */
  retryStream(): void {
    if (this.stopped) return;
    this.clear(this.pollTimer);
    this.pollTimer = null;
    this.setStatus({ streamFailures: 0 });
    this.connect();
  }

  // -------------------------------------------------------------------------
  private applyChange(change: RealtimeChangeMessage): void {
    this.setStatus({ lastSignalAt: this.nowIso() });
    this.armWatchdog();

    // DUPLIKATE: dieselbe Ereignis-ID zweimal ist erlaubt und wirkungslos.
    if (this.seen.includes(change.eventId)) {
      // Der Cursor darf trotzdem vorrücken – sonst würde ein wiederholt
      // geliefertes Ereignis den Fortschritt blockieren.
      this.advanceCursor(change.cursor);
      return;
    }
    this.remember(change.eventId);

    // REIHENFOLGE: der Cursor geht nur vorwärts. Ein "alter" Nachzügler
    // invalidiert sein Thema trotzdem – ein Refetch zu viel ist harmlos, ein
    // Refetch zu wenig nicht.
    this.advanceCursor(change.cursor);
    this.pending.add(change.dataType);
    this.scheduleFlush();
  }

  private applyResync(reason: string | null, cursor: number): void {
    this.seen = [];
    this.options.store.set(SEEN_KEY, "[]");
    this.advanceCursor(cursor, { force: true });
    this.setStatus({
      resyncs: this.status.resyncs + 1,
      lastResyncReason: reason,
      lastSignalAt: this.nowIso(),
    });
    this.pending.clear();
    this.clear(this.flushTimer);
    this.flushTimer = null;
    this.options.onResync(reason);
  }

  private advanceCursor(cursor: number, options: { force?: boolean } = {}): void {
    const next = options.force ? cursor : Math.max(this.status.cursor, cursor);
    if (next === this.status.cursor) return;
    this.status.cursor = next;
    writeStoredCursor(this.options.store, next);
    this.options.onStatusChange?.(this.getStatus());
  }

  private scheduleFlush(): void {
    const debounce = this.options.invalidateDebounceMs ?? 100;
    if (debounce <= 0) {
      this.flush();
      return;
    }
    this.clear(this.flushTimer);
    this.flushTimer = this.later(() => this.flush(), debounce);
  }

  private flush(): void {
    this.flushTimer = null;
    if (this.pending.size === 0) return;
    const themen = [...this.pending];
    this.pending.clear();
    this.options.onInvalidate(themen);
  }

  /**
   * Totmann-Erkennung. Ein TCP-Socket kann "offen" aussehen, obwohl nichts
   * mehr durchkommt (Mobilfunk-NAT, schlafender Proxy). Ohne Lebenszeichen
   * innerhalb des Fensters wird der Kanal als tot behandelt.
   */
  private armWatchdog(): void {
    this.clear(this.watchdog);
    const timeout = this.options.heartbeatTimeoutMs ?? 45_000;
    this.watchdog = this.later(() => {
      if (this.stopped) return;
      this.handleStreamFailure();
    }, timeout);
  }

  private scheduleReconnect(delayMs: number): void {
    this.clear(this.pollTimer);
    this.pollTimer = this.later(() => this.connect(), delayMs);
  }

  private backoff(attempt: number): number {
    // Dieselbe Kurve wie §9 – kein zweites Backoff-Gesetz im Projekt.
    return computeBackoffMs(attempt, { baseMs: 1000, capMs: 30_000, jitterRatio: 0.3 });
  }

  private closeStream(): void {
    try {
      this.handle?.close();
    } catch {
      // schon zu
    }
    this.handle = null;
  }

  private setStatus(patch: Partial<RealtimeStatus>): void {
    this.status = { ...this.status, ...patch };
    this.options.onStatusChange?.(this.getStatus());
  }

  private nowIso(): string {
    return (this.options.now ? this.options.now() : new Date()).toISOString();
  }

  private later(fn: () => void, ms: number): unknown {
    const set = this.options.setTimeoutFn ?? ((f, m) => setTimeout(f, m));
    return set(fn, ms);
  }

  private clear(handle: unknown): void {
    if (handle === null || handle === undefined) return;
    const clear = this.options.clearTimeoutFn ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
    clear(handle);
  }

  private loadSeen(): string[] {
    try {
      const raw = this.options.store.get(SEEN_KEY);
      const parsed = raw ? (JSON.parse(raw) as unknown) : [];
      return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
    } catch {
      return [];
    }
  }

  private remember(eventId: string): void {
    this.seen.push(eventId);
    if (this.seen.length > SEEN_LIMIT) this.seen = this.seen.slice(-SEEN_LIMIT);
    this.options.store.set(SEEN_KEY, JSON.stringify(this.seen));
  }
}

/**
 * Standardtransport gegen apps/api: SSE über `EventSource`, Polling über
 * `fetch`. `EventSource` schickt das httpOnly-Sitzungscookie mit, sobald
 * `withCredentials: true` gesetzt ist – deshalb braucht der Kanal kein Token
 * im Query-String (das wäre in Logs und Referrern sichtbar).
 */
export function createHttpRealtimeTransport(apiBase: string): RealtimeTransport {
  return {
    online: () => (typeof navigator === "undefined" ? true : navigator.onLine),
    openStream({ cursor, onHello, onChange, onResync, onHeartbeat, onError }) {
      const url = `${apiBase}/sync/stream?cursor=${encodeURIComponent(String(cursor))}`;
      const source = new EventSource(url, { withCredentials: true });
      const parse = <T>(event: MessageEvent): T | null => {
        try {
          return JSON.parse(event.data) as T;
        } catch {
          return null;
        }
      };
      source.addEventListener("hello", (event) => {
        const data = parse<{ cursor: number; resyncRequired: boolean; resyncReason: string | null }>(
          event as MessageEvent,
        );
        if (data) onHello(data);
      });
      source.addEventListener("change", (event) => {
        const data = parse<RealtimeChangeMessage>(event as MessageEvent);
        if (data) onChange(data);
      });
      source.addEventListener("resync", (event) => {
        const data = parse<{ reason: string | null; cursor: number }>(event as MessageEvent);
        if (data) onResync(data);
      });
      source.addEventListener("heartbeat", () => onHeartbeat());
      source.addEventListener("error", (event) => {
        // EventSource meldet auch zwischenzeitliche Reconnects als `error`.
        // Nur ein endgültig geschlossener Kanal ist ein Fehlversuch.
        if (source.readyState === EventSource.CLOSED) onError(event);
      });
      return {
        close() {
          source.close();
        },
      };
    },
    async poll(cursor) {
      const res = await fetch(`${apiBase}/sync/changes?cursor=${encodeURIComponent(String(cursor))}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`sync/changes HTTP ${res.status}`);
      return (await res.json()) as Awaited<ReturnType<RealtimeTransport["poll"]>>;
    },
  };
}
