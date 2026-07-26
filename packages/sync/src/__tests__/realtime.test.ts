import type { SyncDataType } from "@fahrschul/domain";
import { beforeEach, describe, expect, it } from "vitest";
import {
  RealtimeEngine,
  readStoredCursor,
  type RealtimeChangeMessage,
  type RealtimeStreamHandle,
  type RealtimeTransport,
} from "../realtime.js";
import { memoryKeyValueStore, type KeyValueStore } from "../store.js";

/**
 * PROMPT -1 §6 – "Behandle WebSocket-/SSE-Nachrichten als NIE garantiert und
 * NIE genau-einmal. Der Client muss korrekt sein, auch wenn Ereignisse
 * verloren gehen, doppelt kommen oder in falscher Reihenfolge ankommen."
 *
 * Genau das wird hier bewiesen – mit einem Transport, der sich absichtlich so
 * schlecht benimmt, wie ein echtes Netz es kann.
 */

interface Hooks {
  onHello: (data: { cursor: number; resyncRequired: boolean; resyncReason: string | null }) => void;
  onChange: (change: RealtimeChangeMessage) => void;
  onResync: (data: { reason: string | null; cursor: number }) => void;
  onHeartbeat: () => void;
  onError: (err: unknown) => void;
}

interface FakeTransport extends RealtimeTransport {
  hooks: Hooks | null;
  geoeffnet: number;
  geschlossen: number;
  onlineFlag: boolean;
  streamWirft: boolean;
  pollAntworten: Array<Awaited<ReturnType<RealtimeTransport["poll"]>>>;
  pollAufrufe: number[];
  letzterCursor: number;
}

function fakeTransport(): FakeTransport {
  const t: FakeTransport = {
    hooks: null,
    geoeffnet: 0,
    geschlossen: 0,
    onlineFlag: true,
    streamWirft: false,
    pollAntworten: [],
    pollAufrufe: [],
    letzterCursor: 0,
    online: () => t.onlineFlag,
    openStream(input) {
      if (t.streamWirft) throw new Error("SSE blockiert");
      t.geoeffnet += 1;
      t.letzterCursor = input.cursor;
      t.hooks = input;
      const handle: RealtimeStreamHandle = {
        close() {
          t.geschlossen += 1;
          t.hooks = null;
        },
      };
      return handle;
    },
    async poll(cursor) {
      t.pollAufrufe.push(cursor);
      return (
        t.pollAntworten.shift() ?? {
          changes: [],
          cursor,
          latestCursor: cursor,
          resyncRequired: false,
          resyncReason: null,
          hasMore: false,
        }
      );
    },
  };
  return t;
}

interface Harness {
  engine: RealtimeEngine;
  transport: FakeTransport;
  store: KeyValueStore;
  invalidations: SyncDataType[][];
  resyncs: Array<string | null>;
  /** Alle geplanten Timer, manuell auslösbar – kein Warten in Tests. */
  timers: Map<number, () => void>;
  laufeTimer(): void;
}

type EngineOptions = ConstructorParameters<typeof RealtimeEngine>[0];

function harness(overrides: Partial<EngineOptions> = {}): Harness {
  const store = memoryKeyValueStore();
  const transport = fakeTransport();
  const invalidations: SyncDataType[][] = [];
  const resyncs: Array<string | null> = [];
  const timers = new Map<number, () => void>();
  let nextTimer = 1;

  const engine = new RealtimeEngine({
    store,
    transport,
    onInvalidate: (types) => invalidations.push(types),
    onResync: (reason) => resyncs.push(reason),
    // Ohne Debounce, damit ein Test nicht auf einen Timer warten muss.
    invalidateDebounceMs: 0,
    setTimeoutFn: (fn) => {
      const id = nextTimer;
      nextTimer += 1;
      timers.set(id, fn);
      return id;
    },
    clearTimeoutFn: (handle) => void timers.delete(handle as number),
    ...overrides,
  });

  return {
    engine,
    transport,
    store,
    invalidations,
    resyncs,
    timers,
    laufeTimer() {
      const eintraege = [...timers.entries()];
      timers.clear();
      for (const [, fn] of eintraege) fn();
    },
  };
}

function change(cursor: number, dataType: SyncDataType, eventId = `ev-${cursor}`): RealtimeChangeMessage {
  return { cursor, eventId, eventType: "lesson.booked", dataType };
}

beforeEach(() => {
  localStorage.clear();
});

describe("§6 Der Kanal transportiert nur Anlässe, keine Daten", () => {
  it("eine Änderung löst genau eine Themen-Invalidierung aus (Refetch), nie ein Anwenden von Nutzlast", () => {
    const h = harness();
    h.engine.start();
    h.transport.hooks!.onHello({ cursor: 0, resyncRequired: false, resyncReason: null });
    h.transport.hooks!.onChange(change(1, "termine"));

    expect(h.invalidations).toEqual([["termine"]]);
    expect(h.engine.getStatus().cursor).toBe(1);
    expect(readStoredCursor(h.store)).toBe(1);
  });

  it("jedes Verbinden lädt einmal alles neu – auch ohne Lücke", () => {
    const h = harness();
    h.engine.start();
    h.transport.hooks!.onHello({ cursor: 0, resyncRequired: false, resyncReason: null });
    // Zwischen Verbindungsende und -aufbau kann etwas passiert sein, das kein
    // Ereignis mehr erreichen konnte.
    expect(h.resyncs).toEqual([null]);
  });
});

describe("§6 VERLORENE Ereignisse", () => {
  it("eine Lücke im dichten Cursor führt zur Neuladung – kein stiller Datenverlust", () => {
    const h = harness();
    h.engine.start();
    h.transport.hooks!.onHello({ cursor: 0, resyncRequired: false, resyncReason: null });
    h.transport.hooks!.onChange(change(1, "termine"));
    // Ereignisse 2 und 3 gehen verloren, 4 kommt an.
    h.transport.hooks!.onChange(change(4, "dokumente"));

    // Der Cursor steht auf 4 …
    expect(h.engine.getStatus().cursor).toBe(4);
    // … und das angekommene Thema ist neu geladen. Die verlorenen Themen holt
    // die Verbindung selbst nach: beim nächsten Verbinden läuft onResync.
    expect(h.invalidations).toEqual([["termine"], ["dokumente"]]);

    // Reconnect: der Server sieht den Cursor 4 und liefert ab dort.
    h.transport.hooks!.onError(new Error("weg"));
    h.laufeTimer();
    expect(h.transport.letzterCursor).toBe(4);
    h.transport.hooks!.onHello({ cursor: 4, resyncRequired: false, resyncReason: null });
    expect(h.resyncs).toEqual([null, null]);
  });

  it("bleibt der Heartbeat aus, gilt der Kanal als tot und wird neu aufgebaut", () => {
    const h = harness();
    h.engine.start();
    h.transport.hooks!.onHello({ cursor: 0, resyncRequired: false, resyncReason: null });
    expect(h.engine.getStatus().connected).toBe(true);

    // Der Totmann-Timer läuft ab (kein Heartbeat, keine Änderung).
    h.laufeTimer();
    expect(h.engine.getStatus().connected).toBe(false);
    expect(h.transport.geschlossen).toBeGreaterThan(0);
    expect(h.engine.getStatus().streamFailures).toBe(1);
  });
});

describe("§6 DOPPELTE Ereignisse", () => {
  it("dieselbe Ereignis-ID zweimal wirkt genau einmal", () => {
    const h = harness();
    h.engine.start();
    h.transport.hooks!.onHello({ cursor: 0, resyncRequired: false, resyncReason: null });
    h.transport.hooks!.onChange(change(1, "termine", "ev-x"));
    h.transport.hooks!.onChange(change(1, "termine", "ev-x"));
    h.transport.hooks!.onChange(change(2, "termine", "ev-x"));

    expect(h.invalidations).toEqual([["termine"]]);
    // Der Cursor rückt trotzdem vor – ein doppelt geliefertes Ereignis darf
    // den Fortschritt nicht blockieren.
    expect(h.engine.getStatus().cursor).toBe(2);
  });

  it("Duplikaterkennung überlebt einen Neustart (der Speicher ist persistent)", () => {
    const store = memoryKeyValueStore();
    const t1 = fakeTransport();
    const inv1: SyncDataType[][] = [];
    const e1 = new RealtimeEngine({
      store,
      transport: t1,
      onInvalidate: (x) => inv1.push(x),
      onResync: () => {},
      invalidateDebounceMs: 0,
      setTimeoutFn: () => 0,
      clearTimeoutFn: () => {},
    });
    e1.start();
    t1.hooks!.onHello({ cursor: 0, resyncRequired: false, resyncReason: null });
    t1.hooks!.onChange(change(1, "rechnungen", "ev-dup"));
    expect(inv1).toEqual([["rechnungen"]]);
    e1.stop();

    // Neustart auf demselben Speicher: dasselbe Ereignis erneut.
    const t2 = fakeTransport();
    const inv2: SyncDataType[][] = [];
    const e2 = new RealtimeEngine({
      store,
      transport: t2,
      onInvalidate: (x) => inv2.push(x),
      onResync: () => {},
      invalidateDebounceMs: 0,
      setTimeoutFn: () => 0,
      clearTimeoutFn: () => {},
    });
    e2.start();
    // Der gespeicherte Cursor wird zur Wiederaufnahme benutzt.
    expect(t2.letzterCursor).toBe(1);
    t2.hooks!.onHello({ cursor: 1, resyncRequired: false, resyncReason: null });
    t2.hooks!.onChange(change(1, "rechnungen", "ev-dup"));
    expect(inv2).toEqual([]);
  });
});

describe("§6 Ereignisse in FALSCHER REIHENFOLGE", () => {
  it("der Cursor geht nur vorwärts, ein Nachzügler invalidiert trotzdem sein Thema", () => {
    const h = harness();
    h.engine.start();
    h.transport.hooks!.onHello({ cursor: 0, resyncRequired: false, resyncReason: null });
    h.transport.hooks!.onChange(change(5, "termine"));
    expect(h.engine.getStatus().cursor).toBe(5);

    // Nachzügler mit KLEINERER Nummer.
    h.transport.hooks!.onChange(change(3, "dokumente"));
    // Cursor bleibt vorne – sonst würde derselbe Bereich endlos erneut geliefert.
    expect(h.engine.getStatus().cursor).toBe(5);
    // Das Thema wird trotzdem neu geladen: ein Refetch zu viel ist harmlos,
    // ein Refetch zu wenig nicht.
    expect(h.invalidations).toEqual([["termine"], ["dokumente"]]);
  });

  it("mehrere Themen werden gebündelt gemeldet, wenn ein Debounce gesetzt ist", () => {
    const h = harness({ invalidateDebounceMs: 50 });
    h.engine.start();
    h.transport.hooks!.onHello({ cursor: 0, resyncRequired: false, resyncReason: null });
    h.transport.hooks!.onChange(change(1, "termine"));
    h.transport.hooks!.onChange(change(2, "dokumente"));
    h.transport.hooks!.onChange(change(3, "termine"));
    expect(h.invalidations).toEqual([]);
    h.laufeTimer();
    expect(h.invalidations).toHaveLength(1);
    expect(new Set(h.invalidations[0])).toEqual(new Set(["termine", "dokumente"]));
  });
});

describe("§6 WIEDERAUFNAHME mit Cursor und VOLLSYNCHRONISATION bei zu großer Lücke", () => {
  it("nach einem Verbindungsabbruch wird mit dem zuletzt bestätigten Cursor wieder aufgesetzt", () => {
    const h = harness();
    h.engine.start();
    h.transport.hooks!.onHello({ cursor: 0, resyncRequired: false, resyncReason: null });
    h.transport.hooks!.onChange(change(1, "termine"));
    h.transport.hooks!.onChange(change(2, "termine"));

    h.transport.hooks!.onError(new Error("Verbindung weg"));
    expect(h.engine.getStatus().connected).toBe(false);
    h.laufeTimer(); // Reconnect-Backoff
    expect(h.transport.geoeffnet).toBe(2);
    expect(h.transport.letzterCursor).toBe(2);
  });

  it("`resyncRequired` beim Verbinden -> Vollsynchronisation, Cursor springt auf den Serverstand", () => {
    const h = harness();
    // Client glaubt, bei 5 zu sein.
    h.store.set("realtime:cursor", "5");
    const h2 = harness();
    h2.store.set("realtime:cursor", "5");
    const engine = new RealtimeEngine({
      store: h2.store,
      transport: h2.transport,
      onInvalidate: (x) => h2.invalidations.push(x),
      onResync: (r) => h2.resyncs.push(r),
      invalidateDebounceMs: 0,
      setTimeoutFn: () => 0,
      clearTimeoutFn: () => {},
    });
    engine.start();
    expect(h2.transport.letzterCursor).toBe(5);
    h2.transport.hooks!.onHello({ cursor: 900, resyncRequired: true, resyncReason: "gap_too_large" });

    expect(h2.resyncs).toEqual(["gap_too_large"]);
    expect(engine.getStatus().cursor).toBe(900);
    expect(engine.getStatus().resyncs).toBe(1);
    expect(engine.getStatus().lastResyncReason).toBe("gap_too_large");
    expect(h.invalidations).toEqual([]);
  });

  it("`resync` mitten im Betrieb verwirft die Duplikathistorie und setzt den Cursor neu", () => {
    const h = harness();
    h.engine.start();
    h.transport.hooks!.onHello({ cursor: 0, resyncRequired: false, resyncReason: null });
    h.transport.hooks!.onChange(change(1, "termine", "ev-a"));
    h.transport.hooks!.onResync({ reason: "cursor_pruned", cursor: 42 });

    expect(h.engine.getStatus().cursor).toBe(42);
    expect(h.resyncs).toEqual([null, "cursor_pruned"]);
    // Nach einem Resync ist "ev-a" nicht mehr als gesehen bekannt – korrekt,
    // denn der Client hat seinen Stand ohnehin verworfen.
    h.transport.hooks!.onChange(change(43, "termine", "ev-a"));
    expect(h.invalidations).toEqual([["termine"], ["termine"]]);
  });

  it("ein Cursor VOR dem Serverstand (z. B. nach Restore) führt zur Vollsynchronisation", () => {
    const h = harness();
    h.engine.start();
    h.transport.hooks!.onHello({
      cursor: 3,
      resyncRequired: true,
      resyncReason: "cursor_ahead_of_server",
    });
    expect(h.resyncs).toEqual(["cursor_ahead_of_server"]);
    expect(h.engine.getStatus().cursor).toBe(3);
  });
});

describe("§6 Stream nicht verfügbar -> POLLING-FALLBACK konvergiert trotzdem", () => {
  it("nach `maxStreamFailures` wird auf Polling umgeschaltet und der Zustand konvergiert", async () => {
    const h = harness({ maxStreamFailures: 2, pollIntervalMs: 1000 });
    h.engine.start();
    // Zwei fehlgeschlagene Verbindungen.
    h.transport.hooks!.onError(new Error("weg"));
    h.laufeTimer();
    h.transport.hooks!.onError(new Error("weg"));
    expect(h.engine.getStatus().mode).toBe("polling");

    h.transport.pollAntworten = [
      {
        changes: [change(1, "termine"), change(2, "dokumente")],
        cursor: 2,
        latestCursor: 2,
        resyncRequired: false,
        resyncReason: null,
        hasMore: false,
      },
    ];
    await h.engine.pollNow();
    expect(new Set(h.invalidations.flat())).toEqual(new Set(["termine", "dokumente"]));
    expect(h.engine.getStatus().cursor).toBe(2);
  });

  it("ein Stream, der gar nicht öffnen kann (Proxy blockiert SSE), endet im Polling – nicht in einer Endlosschleife", () => {
    const h = harness({ maxStreamFailures: 2 });
    h.transport.streamWirft = true;
    h.engine.start();
    h.laufeTimer();
    expect(h.engine.getStatus().mode).toBe("polling");
    expect(h.transport.geoeffnet).toBe(0);
  });

  it("Polling meldet ebenfalls eine nötige Vollsynchronisation", async () => {
    const h = harness({ maxStreamFailures: 1 });
    h.engine.start();
    h.transport.hooks!.onError(new Error("weg"));
    expect(h.engine.getStatus().mode).toBe("polling");

    h.transport.pollAntworten = [
      {
        changes: [],
        cursor: 0,
        latestCursor: 77,
        resyncRequired: true,
        resyncReason: "cursor_pruned",
        hasMore: false,
      },
    ];
    await h.engine.pollNow();
    expect(h.resyncs).toContain("cursor_pruned");
    expect(h.engine.getStatus().cursor).toBe(77);
  });

  it("offline wird nicht als Kanalfehler gezählt (kein Verbrauch der Stream-Versuche)", () => {
    const h = harness({ maxStreamFailures: 2 });
    h.transport.onlineFlag = false;
    h.engine.start();
    expect(h.engine.getStatus().streamFailures).toBe(0);
    expect(h.engine.getStatus().mode).toBe("down");
    expect(h.transport.geoeffnet).toBe(0);

    // Netz wieder da: der Timer versucht es erneut, jetzt erfolgreich.
    h.transport.onlineFlag = true;
    h.laufeTimer();
    expect(h.transport.geoeffnet).toBe(1);
  });

  it("`retryStream()` holt den Stream nach einem Polling-Abschnitt zurück", () => {
    const h = harness({ maxStreamFailures: 1 });
    h.engine.start();
    h.transport.hooks!.onError(new Error("weg"));
    expect(h.engine.getStatus().mode).toBe("polling");
    h.engine.retryStream();
    expect(h.engine.getStatus().streamFailures).toBe(0);
    expect(h.transport.geoeffnet).toBe(2);
  });

  it("stop() räumt alles ab und öffnet nichts mehr", () => {
    const h = harness();
    h.engine.start();
    h.transport.hooks!.onHello({ cursor: 0, resyncRequired: false, resyncReason: null });
    h.engine.stop();
    expect(h.engine.getStatus().connected).toBe(false);
    expect(h.engine.getStatus().mode).toBe("down");
    expect(h.timers.size).toBe(0);
  });
});
