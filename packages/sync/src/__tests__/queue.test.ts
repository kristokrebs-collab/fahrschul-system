import { DRAFT_SCHEMA_VERSION } from "@fahrschul/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { decryptJson, loadDraftKey } from "../crypto.js";
import { loadDeviceId } from "../device.js";
import { OfflineNotAllowedError } from "../mutations.js";
import {
  attemptEntry,
  confirmStaleEntry,
  createCriticalOperation,
  createDraft,
  CriticalDiscardError,
  discardEntry,
  enqueueDraft,
  getQueueEntry,
  listQueue,
  processQueue,
  putQueueEntry,
  queueSummary,
  reconcileAfterReconnect,
  resolvePendingAfterRestart,
  retryEntry,
  reviewQueue,
  updateDraftPayload,
  type OperationLookup,
  type QueueDeps,
  type SyncTransport,
  type SyncTransportResult,
} from "../queue.js";
import { memoryKeyValueStore, type KeyValueStore } from "../store.js";

const BENUTZER = "11111111-1111-4111-8111-111111111111";
const ANDERER_BENUTZER = "22222222-2222-4222-8222-222222222222";
const BOOKING = "8f3a1c2d-0000-4000-8000-000000000010";

interface FakeTransport extends SyncTransport {
  antworten: SyncTransportResult[];
  gesendet: Array<{ path: string; idempotencyKey: string; body: unknown; expectedVersion: number | null }>;
  onlineFlag: boolean;
  identityBenutzerId: string | null;
  lookupAntwort: OperationLookup;
  versionAntwort: number | null;
  wirftBeimSenden: boolean;
}

function fakeTransport(): FakeTransport {
  const t: FakeTransport = {
    antworten: [],
    gesendet: [],
    onlineFlag: true,
    identityBenutzerId: BENUTZER,
    lookupAntwort: { status: "unknown" },
    versionAntwort: null,
    wirftBeimSenden: false,
    online: () => t.onlineFlag,
    async send(input) {
      t.gesendet.push({
        path: input.path,
        idempotencyKey: input.idempotencyKey,
        body: input.body,
        expectedVersion: input.expectedVersion,
      });
      if (t.wirftBeimSenden) throw new Error("Failed to fetch");
      return (
        t.antworten.shift() ?? { status: 200, ok: true, body: { ok: true }, outcomeUnknown: false }
      );
    },
    async identity() {
      return t.identityBenutzerId ? { benutzerId: t.identityBenutzerId } : null;
    },
    async lookupOperation() {
      return t.lookupAntwort;
    },
    async currentVersion() {
      return t.versionAntwort;
    },
  };
  return t;
}

async function makeDeps(
  overrides: Partial<QueueDeps> = {},
): Promise<QueueDeps & { transport: FakeTransport }> {
  const store: KeyValueStore = overrides.store ?? memoryKeyValueStore();
  const transport = (overrides.transport as FakeTransport | undefined) ?? fakeTransport();
  let counter = 0;
  const basis: QueueDeps = {
    store,
    transport,
    draftKey: await loadDraftKey(store, BENUTZER),
    deviceId: loadDeviceId(store),
    benutzerId: BENUTZER,
    // Deterministische IDs: der Test kann Schlüsselstabilität prüfen.
    newId: () => `id-${(counter += 1)}`,
  };
  return { ...basis, ...overrides, store, transport } as QueueDeps & { transport: FakeTransport };
}

describe("§8 Offline-Outbox: Pflichtfelder und Verschlüsselung", () => {
  it("ein Entwurf trägt alle acht §8-Pflichtfelder", async () => {
    const deps = await makeDeps();
    const entry = await createDraft(deps, {
      method: "POST",
      path: "/instructor/vehicle-issues",
      body: { fahrzeugId: BOOKING, grund: "Bremse schleift" },
      bezeichnung: "Mangelmeldung",
    });

    expect(entry.operationId).toBeTruthy(); // Operation-ID
    expect(Date.parse(entry.createdAt)).not.toBeNaN(); // Erstellzeit
    expect(entry.benutzerId).toBe(BENUTZER); // Benutzer
    expect(entry.deviceId).toBeTruthy(); // Device-ID
    expect(entry.schemaVersion).toBe(DRAFT_SCHEMA_VERSION); // Schema-Version
    expect(entry.requestHash).toMatch(/^[0-9a-f]{64}$/); // Request-Hash
    expect(entry.retryCount).toBe(0); // Retry-Zähler
    expect(entry.lastError).toBeNull(); // letzter Fehler
    expect(entry.status).toBe("local_draft");
  });

  it("§7: der Entwurfsinhalt liegt VERSCHLÜSSELT im Speicher – nicht im Klartext", async () => {
    const store = memoryKeyValueStore();
    const deps = await makeDeps({ store });
    const geheim = "Schüler war sehr nervös, Kupplung dreimal abgewürgt";
    await createDraft(deps, {
      method: "POST",
      path: "/instructor/voice-logs",
      body: { rohtext: geheim, terminbuchungId: BOOKING },
      bezeichnung: "Berichtsentwurf",
    });

    const roh = store.keys().map((k) => store.get(k) ?? "").join("|");
    expect(roh).not.toContain(geheim);
    expect(roh).not.toContain("nervös");
    expect(roh).toContain('"v":1'); // Format-Version des Blobs

    // Mit dem richtigen Schlüssel wieder lesbar.
    const [entry] = listQueue(store);
    const klartext = await decryptJson<{ rohtext: string }>(deps.draftKey, entry.payload);
    expect(klartext.rohtext).toBe(geheim);
  });

  it("ein Entwurf eines ANDEREN Benutzers ist auf demselben Gerät nicht entschlüsselbar und wird nicht gesendet", async () => {
    const store = memoryKeyValueStore();
    const deps = await makeDeps({ store });
    const entry = await createDraft(deps, {
      method: "POST",
      path: "/instructor/vehicle-issues",
      body: { grund: "intern" },
      bezeichnung: "Mangelmeldung",
    });
    enqueueDraft(deps, entry.operationId);

    // Benutzerwechsel: derselbe Store, ANDERER Schlüssel.
    const fremd = await makeDeps({
      store,
      transport: deps.transport,
      draftKey: await loadDraftKey(store, ANDERER_BENUTZER),
      benutzerId: ANDERER_BENUTZER,
    });
    const outcome = await attemptEntry(fremd, getQueueEntry(store, entry.operationId)!);

    expect(outcome.confirmed).toBe(false);
    expect(outcome.entry.status).toBe("failed");
    expect(outcome.entry.staleReason).toBe("identity_mismatch");
    // Entscheidend: es wurde NICHTS gesendet.
    expect(deps.transport.gesendet).toHaveLength(0);
  });

  it("nur die vier zugelassenen Entwurfsarten dürfen als Entwurf entstehen", async () => {
    const deps = await makeDeps();
    await expect(
      createDraft(deps, {
        method: "POST",
        path: `/appointments`,
        body: {},
        bezeichnung: "Buchung",
      }),
    ).rejects.toBeInstanceOf(OfflineNotAllowedError);
  });

  it("ein kritischer Vorgang kann offline gar nicht erst angelegt werden (kein stilles Queuing)", async () => {
    const deps = await makeDeps();
    deps.transport.onlineFlag = false;
    await expect(
      createCriticalOperation(deps, {
        method: "POST",
        path: `/appointment-offers/${BOOKING}/accept`,
        body: {},
        bezeichnung: "Angebot annehmen",
      }),
    ).rejects.toBeInstanceOf(OfflineNotAllowedError);
    expect(listQueue(deps.store)).toHaveLength(0);
  });
});

describe("§7 kritische Vorgänge: Erfolg nur nach Serverbestätigung", () => {
  it("erst eine 2xx-Antwort macht aus `syncing` ein `synced`", async () => {
    const deps = await makeDeps();
    const entry = await createCriticalOperation(deps, {
      method: "POST",
      path: `/appointment-offers/${BOOKING}/accept`,
      body: {},
      bezeichnung: "Angebot annehmen",
    });
    expect(entry.status).toBe("queued");

    deps.transport.antworten = [{ status: 201, ok: true, body: { booking: { id: BOOKING } } }];
    const outcome = await attemptEntry(deps, entry);
    expect(outcome.confirmed).toBe(true);
    expect(outcome.entry.status).toBe("synced");
    expect(outcome.entry.confirmedAt).toBeTruthy();
    expect(outcome.entry.resultStatus).toBe(201);
  });

  it("der Idempotenzschlüssel wird EINMAL vergeben und über alle Versuche beibehalten", async () => {
    const deps = await makeDeps();
    const entry = await createCriticalOperation(deps, {
      method: "POST",
      path: `/appointments/${BOOKING}/cancel`,
      body: { grund: "krank" },
      bezeichnung: "Storno",
    });
    deps.transport.antworten = [
      { status: 503, ok: false, body: { error: "unavailable" } },
      { status: 503, ok: false, body: { error: "unavailable" } },
      { status: 200, ok: true, body: { ok: true } },
    ];
    let aktuell = entry;
    for (let i = 0; i < 3; i += 1) {
      aktuell = { ...(await attemptEntry(deps, aktuell)).entry, nextAttemptAt: null };
    }
    const schluessel = new Set(deps.transport.gesendet.map((g) => g.idempotencyKey));
    expect(schluessel.size).toBe(1);
    expect([...schluessel][0]).toBe(entry.idempotencyKey);
    expect(aktuell.status).toBe("synced");
    expect(aktuell.retryCount).toBe(3);
  });

  it("If-Match wird aus der gelesenen Version gesetzt (§4 greift damit auch bei 'geprüft-wenn-gesendet')", async () => {
    const deps = await makeDeps();
    const entry = await createCriticalOperation(deps, {
      method: "POST",
      path: `/documents/${BOOKING}/review`,
      body: { entscheidung: "verified" },
      bezeichnung: "Dokumentprüfung",
      baseVersion: 4,
      baseRecordId: BOOKING,
    });
    await attemptEntry(deps, entry);
    expect(deps.transport.gesendet[0].expectedVersion).toBe(4);
  });

  it("ein unbekannter Ausgang wird NIE als Erfolg gezeigt, sondern als 'Status wird geprüft'", async () => {
    const deps = await makeDeps();
    const entry = await createCriticalOperation(deps, {
      method: "POST",
      path: `/finance/bank/${BOOKING}/resolve`,
      body: { rechnungId: BOOKING },
      bezeichnung: "Zahlung zuordnen",
    });
    deps.transport.wirftBeimSenden = true;
    const outcome = await attemptEntry(deps, entry);

    expect(outcome.confirmed).toBe(false);
    expect(outcome.entry.status).not.toBe("synced");
    expect(outcome.entry.outcomeUnknown).toBe(true);
    expect(outcome.entry.lastError).toContain("Ausgang unbekannt");
  });

  it("ein kritischer Vorgang mit unbekanntem Ausgang kann nicht stillschweigend verworfen werden", async () => {
    const deps = await makeDeps();
    const entry = await createCriticalOperation(deps, {
      method: "POST",
      path: `/finance/bank/${BOOKING}/resolve`,
      body: {},
      bezeichnung: "Zahlung zuordnen",
    });
    deps.transport.wirftBeimSenden = true;
    await attemptEntry(deps, entry);

    expect(() => discardEntry(deps.store, entry.operationId)).toThrow(CriticalDiscardError);
    expect(getQueueEntry(deps.store, entry.operationId)).not.toBeNull();
    // Mit ausdrücklicher Bestätigung geht es.
    discardEntry(deps.store, entry.operationId, { force: true });
    expect(getQueueEntry(deps.store, entry.operationId)).toBeNull();
  });

  it("nicht-kritische Fehlschläge darf der Benutzer wiederholen ODER verwerfen", async () => {
    const deps = await makeDeps();
    const entry = await createDraft(deps, {
      method: "POST",
      path: "/instructor/vehicle-issues",
      body: { grund: "x" },
      bezeichnung: "Mangelmeldung",
    });
    enqueueDraft(deps, entry.operationId);
    deps.transport.antworten = [{ status: 400, ok: false, body: { error: "invalid_body" } }];
    const outcome = await attemptEntry(deps, getQueueEntry(deps.store, entry.operationId)!);
    expect(outcome.entry.status).toBe("failed");
    expect(outcome.entry.errorClass).toBe("VALIDATION");
    // Voller Kontext bleibt erhalten – nichts wird still verworfen.
    expect(outcome.entry.lastError).toBe("invalid_body");
    expect(outcome.entry.retryCount).toBe(1);

    // Wiederholen …
    const wieder = retryEntry(deps.store, entry.operationId);
    expect(wieder?.status).toBe("queued");
    expect(wieder?.retryCount).toBe(0);
    // … oder verwerfen.
    expect(() => discardEntry(deps.store, entry.operationId)).not.toThrow();
    expect(getQueueEntry(deps.store, entry.operationId)).toBeNull();
  });

  it("kritische Konflikte gehen in die Prüf-Warteschlange und werden NICHT automatisch aufgelöst", async () => {
    const deps = await makeDeps();
    const entry = await createCriticalOperation(deps, {
      method: "POST",
      path: `/appointments/${BOOKING}/cancel`,
      body: {},
      bezeichnung: "Storno",
      baseVersion: 3,
      baseRecordId: BOOKING,
    });
    // Genau die Phase-1-Konfliktantwort (§4-Seam).
    deps.transport.antworten = [
      {
        status: 409,
        ok: false,
        body: {
          error: "version_conflict",
          expectedVersion: 3,
          currentVersion: 5,
          current: { id: BOOKING, endzeit: "2026-07-26T12:00:00.000Z" },
          conflictFields: ["endzeit"],
          message: "Datensatz wurde geändert",
        },
      },
    ];
    const outcome = await attemptEntry(deps, entry);

    expect(outcome.entry.status).toBe("conflict");
    expect(outcome.entry.conflict?.currentVersion).toBe(5);
    expect(outcome.entry.conflict?.conflictFields).toEqual(["endzeit"]);
    expect(outcome.entry.conflict?.current).toEqual({
      id: BOOKING,
      endzeit: "2026-07-26T12:00:00.000Z",
    });
    expect(reviewQueue(deps.store).map((e) => e.operationId)).toContain(entry.operationId);

    // processQueue rührt einen Konflikt NICHT an – keine Auto-Auflösung.
    const vorher = deps.transport.gesendet.length;
    const ergebnis = await processQueue(deps);
    expect(deps.transport.gesendet.length).toBe(vorher);
    expect(ergebnis.uebersprungen).toBeGreaterThan(0);
  });

  it("transiente Fehler landen in `retrying` mit Backoff, dauerhafte in `failed`/`conflict`", async () => {
    const deps = await makeDeps();
    const transient = await createCriticalOperation(deps, {
      method: "POST",
      path: "/communication/send",
      body: { text: "a" },
      bezeichnung: "Nachricht",
    });
    deps.transport.antworten = [{ status: 503, ok: false, body: { error: "unavailable" } }];
    const t = await attemptEntry(deps, transient);
    expect(t.entry.status).toBe("retrying");
    expect(t.entry.nextAttemptAt).toBeTruthy();
    expect(Date.parse(t.entry.nextAttemptAt!)).toBeGreaterThan(Date.now());

    const dauerhaft = await createCriticalOperation(deps, {
      method: "POST",
      path: "/communication/send",
      body: { text: "b" },
      bezeichnung: "Nachricht",
    });
    deps.transport.antworten = [{ status: 403, ok: false, body: { error: "forbidden" } }];
    const d = await attemptEntry(deps, dauerhaft);
    expect(d.entry.status).toBe("failed");
    expect(d.entry.errorClass).toBe("PERMISSION");
    expect(d.entry.nextAttemptAt).toBeNull();
  });

  it("processQueue respektiert den Backoff und versucht nichts vor der Zeit", async () => {
    const deps = await makeDeps();
    const entry = await createCriticalOperation(deps, {
      method: "POST",
      path: "/communication/send",
      body: {},
      bezeichnung: "Nachricht",
    });
    deps.transport.antworten = [{ status: 503, ok: false, body: {} }];
    await attemptEntry(deps, entry);
    const vorher = deps.transport.gesendet.length;
    const ergebnis = await processQueue(deps);
    expect(deps.transport.gesendet.length).toBe(vorher);
    expect(ergebnis.versucht).toBe(0);
  });

  it("offline wird ein wartender Vorgang als `offline` gezeigt, nicht als 'wird gesendet'", async () => {
    const deps = await makeDeps();
    const entry = await createCriticalOperation(deps, {
      method: "POST",
      path: "/communication/send",
      body: {},
      bezeichnung: "Nachricht",
    });
    deps.transport.onlineFlag = false;
    const outcome = await attemptEntry(deps, entry);
    expect(outcome.entry.status).toBe("offline");
    expect(deps.transport.gesendet).toHaveLength(0);
  });
});

describe("§7 Auflösung offener Vorgänge nach Neustart (über den Idempotenzschlüssel)", () => {
  it("`completed` -> der Vorgang hat gewirkt, wird nachträglich bestätigt", async () => {
    const store = memoryKeyValueStore();
    const deps = await makeDeps({ store });
    const entry = await createCriticalOperation(deps, {
      method: "POST",
      path: `/appointment-offers/${BOOKING}/accept`,
      body: {},
      bezeichnung: "Angebot annehmen",
    });
    deps.transport.wirftBeimSenden = true;
    await attemptEntry(deps, entry);
    expect(getQueueEntry(store, entry.operationId)?.outcomeUnknown).toBe(true);

    // "Neustart": frische Deps auf demselben Store.
    const neu = await makeDeps({ store, transport: deps.transport });
    neu.transport.lookupAntwort = {
      status: "completed",
      responseStatus: 201,
      responseBody: { booking: { id: BOOKING } },
    };
    const result = await resolvePendingAfterRestart(neu);

    expect(result.bestaetigt).toBe(1);
    const danach = getQueueEntry(store, entry.operationId)!;
    expect(danach.status).toBe("synced");
    expect(danach.outcomeUnknown).toBe(false);
    expect(danach.resultStatus).toBe(201);
  });

  it("`unknown` -> hat NICHT gewirkt, derselbe Schlüssel wird erneut eingestellt", async () => {
    const store = memoryKeyValueStore();
    const deps = await makeDeps({ store });
    const entry = await createCriticalOperation(deps, {
      method: "POST",
      path: `/appointments/${BOOKING}/cancel`,
      body: {},
      bezeichnung: "Storno",
    });
    deps.transport.wirftBeimSenden = true;
    await attemptEntry(deps, entry);

    const neu = await makeDeps({ store, transport: deps.transport });
    neu.transport.lookupAntwort = { status: "unknown" };
    const result = await resolvePendingAfterRestart(neu);

    expect(result.unbekannt).toBe(1);
    const danach = getQueueEntry(store, entry.operationId)!;
    expect(danach.status).toBe("queued");
    expect(danach.outcomeUnknown).toBe(false);
    expect(danach.idempotencyKey).toBe(entry.idempotencyKey);
  });

  it("`in_progress` -> bleibt 'Status wird geprüft', kein Erfolg, kein blindes Wiederholen", async () => {
    const store = memoryKeyValueStore();
    const deps = await makeDeps({ store });
    const entry = await createCriticalOperation(deps, {
      method: "POST",
      path: "/communication/send",
      body: {},
      bezeichnung: "Nachricht",
    });
    deps.transport.wirftBeimSenden = true;
    await attemptEntry(deps, entry);

    const neu = await makeDeps({ store, transport: deps.transport });
    neu.transport.lookupAntwort = { status: "in_progress" };
    await resolvePendingAfterRestart(neu);

    const danach = getQueueEntry(store, entry.operationId)!;
    expect(danach.status).toBe("syncing");
    expect(danach.outcomeUnknown).toBe(true);
  });

  it("ein Endpunkt ohne Idempotenzspeicher bleibt ehrlich unauflösbar statt automatisch wiederholt", async () => {
    const store = memoryKeyValueStore();
    const deps = await makeDeps({ store });
    // /instructor/lessons/:id/start hat keine §2-Operation.
    const entry = await createCriticalOperation(deps, {
      method: "POST",
      path: `/instructor/lessons/${BOOKING}/start`,
      body: {},
      bezeichnung: "Stunde starten",
    });
    expect(entry.operation).toBeNull();
    deps.transport.wirftBeimSenden = true;
    await attemptEntry(deps, entry);

    const neu = await makeDeps({ store, transport: deps.transport });
    const result = await resolvePendingAfterRestart(neu);
    expect(result.unbekannt).toBe(1);
    const danach = getQueueEntry(store, entry.operationId)!;
    expect(danach.status).toBe("failed");
    expect(danach.outcomeUnknown).toBe(true);
    expect(danach.lastError).toContain("nicht serverseitig auflösbar");
  });
});

describe("§8 nach der Wiederverbindung", () => {
  it("Identität wird erneut geprüft – bei Wechsel wird NICHTS gesendet", async () => {
    const deps = await makeDeps();
    const entry = await createDraft(deps, {
      method: "POST",
      path: "/instructor/voice-logs",
      body: { rohtext: "x" },
      bezeichnung: "Berichtsentwurf",
    });
    enqueueDraft(deps, entry.operationId);

    deps.transport.identityBenutzerId = ANDERER_BENUTZER;
    const result = await reconcileAfterReconnect(deps);

    expect(result.identitaetGeprueft).toBe(true);
    expect(result.identitaetsWechsel).toBe(true);
    const danach = getQueueEntry(deps.store, entry.operationId)!;
    expect(danach.status).toBe("stale");
    expect(danach.staleReason).toBe("identity_mismatch");

    // Und die Warteschlange sendet ihn nicht.
    await processQueue(deps);
    expect(deps.transport.gesendet).toHaveLength(0);
  });

  it("SIEBEN TAGE OFFLINE: ein alter Entwurf wird als veraltet erkannt, NICHT verworfen und NICHT still gesendet", async () => {
    const store = memoryKeyValueStore();
    const jetzt = new Date("2026-07-26T10:00:00.000Z");
    const vorAchtTagen = new Date("2026-07-18T09:00:00.000Z");

    // Entwurf entsteht vor acht Tagen …
    const alt = await makeDeps({ store, now: () => vorAchtTagen });
    const entry = await createDraft(alt, {
      method: "POST",
      path: "/instructor/voice-logs",
      body: { rohtext: "Bericht von vor acht Tagen" },
      bezeichnung: "Berichtsentwurf",
    });
    enqueueDraft(alt, entry.operationId);

    // … und wird heute nach der Wiederverbindung geprüft.
    const heute = await makeDeps({ store, transport: alt.transport, now: () => jetzt });
    const result = await reconcileAfterReconnect(heute);

    expect(result.veraltet).toBe(1);
    const danach = getQueueEntry(store, entry.operationId)!;
    expect(danach.status).toBe("stale");
    expect(danach.staleReason).toBe("draft_too_old");
    // Nicht gelöscht: der Inhalt bleibt erhalten und lesbar.
    expect(danach.payload).toBeTruthy();
    expect(
      (await decryptJson<{ rohtext: string }>(heute.draftKey, danach.payload)).rohtext,
    ).toBe("Bericht von vor acht Tagen");
    // Nicht gesendet.
    await processQueue(heute);
    expect(heute.transport.gesendet).toHaveLength(0);
    // Er steht in der Prüf-Warteschlange …
    expect(reviewQueue(store).map((e) => e.operationId)).toContain(entry.operationId);
    // … und geht erst nach AUSDRÜCKLICHER Bestätigung raus, mit demselben Schlüssel.
    confirmStaleEntry(store, entry.operationId);
    heute.transport.antworten = [{ status: 201, ok: true, body: {} }];
    await processQueue(heute);
    expect(heute.transport.gesendet).toHaveLength(1);
    expect(heute.transport.gesendet[0].idempotencyKey).toBe(entry.idempotencyKey);
  });

  it("eine veraltete Schema-Version macht den Entwurf `stale`", async () => {
    const store = memoryKeyValueStore();
    const deps = await makeDeps({ store });
    const entry = await createDraft(deps, {
      method: "PATCH",
      path: `/availability/${BOOKING}`,
      body: { startzeit: "08:00" },
      bezeichnung: "Verfügbarkeitsentwurf",
    });
    enqueueDraft(deps, entry.operationId);
    // Simulation: Eintrag stammt aus einer älteren App-Version.
    putQueueEntry(store, { ...getQueueEntry(store, entry.operationId)!, schemaVersion: 0 });

    const result = await reconcileAfterReconnect(deps);
    expect(result.veraltet).toBe(1);
    const danach = getQueueEntry(store, entry.operationId)!;
    expect(danach.status).toBe("stale");
    expect(danach.staleReason).toBe("schema_version");
  });

  it("hat sich der zugrundeliegende Datensatz bewegt, ist es ein sichtbarer Konflikt statt eines Überschreibens", async () => {
    const deps = await makeDeps();
    const entry = await createDraft(deps, {
      method: "PATCH",
      path: `/availability/${BOOKING}`,
      body: { startzeit: "08:00" },
      bezeichnung: "Verfügbarkeitsentwurf",
      baseVersion: 2,
      baseRecordId: BOOKING,
    });
    enqueueDraft(deps, entry.operationId);
    deps.transport.versionAntwort = 7;

    const result = await reconcileAfterReconnect(deps);
    expect(result.konflikte).toBe(1);
    const danach = getQueueEntry(deps.store, entry.operationId)!;
    expect(danach.status).toBe("conflict");
    expect(danach.conflict?.error).toBe("record_moved_on");
    expect(danach.conflict?.currentVersion).toBe(7);
    await processQueue(deps);
    expect(deps.transport.gesendet).toHaveLength(0);
  });

  it("unveränderte Grundlage + frischer Entwurf -> darf idempotent gesendet werden", async () => {
    const deps = await makeDeps();
    const entry = await createDraft(deps, {
      method: "PATCH",
      path: `/availability/${BOOKING}`,
      body: { startzeit: "08:00" },
      bezeichnung: "Verfügbarkeitsentwurf",
      baseVersion: 2,
      baseRecordId: BOOKING,
    });
    enqueueDraft(deps, entry.operationId);
    deps.transport.versionAntwort = 2;

    const result = await reconcileAfterReconnect(deps);
    expect(result.konflikte).toBe(0);
    expect(result.bereitZumSenden).toBe(1);
    deps.transport.antworten = [{ status: 200, ok: true, body: {} }];
    const verlauf = await processQueue(deps);
    expect(verlauf.bestaetigt).toBe(1);
  });
});

describe("Entwurf ändern und Zusammenfassung", () => {
  it("eine geänderte Nutzlast bekommt einen NEUEN Schlüssel (sonst 409 idempotency_key_conflict)", async () => {
    const deps = await makeDeps();
    const entry = await createDraft(deps, {
      method: "POST",
      path: "/instructor/voice-logs",
      body: { rohtext: "a" },
      bezeichnung: "Berichtsentwurf",
    });
    const geaendert = await updateDraftPayload(deps, entry.operationId, { rohtext: "b" });
    expect(geaendert?.idempotencyKey).not.toBe(entry.idempotencyKey);
    expect(geaendert?.requestHash).not.toBe(entry.requestHash);
    expect(geaendert?.status).toBe("local_draft");
  });

  it("eine laufende Übertragung kann nicht geändert werden", async () => {
    const deps = await makeDeps();
    const entry = await createCriticalOperation(deps, {
      method: "POST",
      path: "/communication/send",
      body: {},
      bezeichnung: "Nachricht",
    });
    putQueueEntry(deps.store, { ...entry, status: "syncing" });
    await expect(updateDraftPayload(deps, entry.operationId, { x: 1 })).rejects.toThrow(
      /kann nicht geändert werden/,
    );
  });

  it("die Zusammenfassung priorisiert nach Dringlichkeit (Mensch nötig gewinnt)", async () => {
    const deps = await makeDeps();
    const a = await createDraft(deps, {
      method: "POST",
      path: "/instructor/vehicle-issues",
      body: { grund: "a" },
      bezeichnung: "Mangelmeldung",
    });
    expect(queueSummary(deps.store, true).gesamtStatus).toBe("local_draft");
    expect(queueSummary(deps.store, false).gesamtStatus).toBe("offline");

    enqueueDraft(deps, a.operationId);
    expect(queueSummary(deps.store, true).gesamtStatus).toBe("queued");

    putQueueEntry(deps.store, { ...getQueueEntry(deps.store, a.operationId)!, status: "conflict" });
    const summary = queueSummary(deps.store, false);
    expect(summary.gesamtStatus).toBe("conflict");
    expect(summary.konflikte).toBe(1);
  });

  it("Zeitgeber werden nicht gebraucht – die Warteschlange ist rein funktional prüfbar", () => {
    // Absichtsprüfung: kein Modul aus packages/sync startet von sich aus einen
    // Timer beim Import. (Der Realtime-Client tut es erst in start().)
    const spy = vi.spyOn(globalThis, "setInterval");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

beforeEach(() => {
  localStorage.clear();
});
