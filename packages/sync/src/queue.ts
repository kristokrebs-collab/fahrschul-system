import {
  DRAFT_SCHEMA_VERSION,
  DRAFT_STALE_AFTER_MS,
  type OfflineDraftKind,
  type SyncState,
} from "@fahrschul/domain";
import type { ErrorClass } from "@fahrschul/events/src/retry.js";
import {
  decryptJson,
  encryptJson,
  isEncryptedBlob,
  DecryptionError,
  type EncryptedBlob,
} from "./crypto.js";
import { requestHash } from "./hash.js";
import { classifyMutation, isOfflineDraftKind, OfflineNotAllowedError } from "./mutations.js";
import { needsHumanDecision, planClientRetry, type ClientRetryPlan } from "./retry-client.js";
import type { KeyValueStore } from "./store.js";

/**
 * PROMPT -1 §7 + §8 + §9(Client) – EINE persistente Vorgangsliste.
 *
 * Bewusst EIN Mechanismus für beides, nicht zwei:
 *   - §8 Offline-Outbox: Entwürfe, die offline entstehen dürfen.
 *   - §7 kritische Vorgänge: Buchung, Storno, Zahlung, … die NIE offline
 *     entstehen, aber trotzdem einen dauerhaften Zustand brauchen, damit ein
 *     Absturz mitten im Absenden auflösbar ist.
 * Beide brauchen genau dieselben Pflichtfelder (§8) und dieselben neun
 * Zustände (§7); zwei getrennte Listen wären zwei Fehlerquellen.
 *
 * ## Die harten Regeln, die hier durchgesetzt werden
 *
 *  1. **Ein kritischer Vorgang gilt erst nach SERVERBESTÄTIGUNG als
 *     erfolgreich.** `status` wird nur auf `synced` gesetzt, wenn eine 2xx-
 *     Antwort vorliegt. Es gibt keinen Codepfad, der optimistisch bestätigt.
 *  2. **Unbekannter Ausgang ist NIE Erfolg.** `outcomeUnknown` führt zur
 *     Anzeige "Status wird geprüft" (siehe labels.ts) und wird ausschließlich
 *     durch eine SERVERANTWORT aufgelöst – über den Idempotenzschlüssel.
 *  3. **Kritische Konflikte werden NICHT automatisch aufgelöst.** Sie landen
 *     im Zustand `conflict` und damit in der Prüf-Warteschlange
 *     (`reviewQueue`). Ein automatischer "letzter gewinnt" wäre hier
 *     Datenverlust mit Geldbezug.
 *  4. **Nicht-kritische Fehlschläge darf der Benutzer wiederholen ODER
 *     verwerfen** (`retryEntry` / `discardEntry`). Kritische Vorgänge können
 *     nicht stillschweigend verworfen werden (`discardEntry` verlangt
 *     `force`) – sonst verschwindet eine möglicherweise gebuchte Zahlung
 *     aus der Ansicht, ohne aus der Welt zu sein.
 *  5. **Nichts wird still verworfen.** Erschöpfte Versuche enden in `failed`
 *     MIT vollem Kontext (letzter Fehler, Versuchszähler, Fehlerklasse,
 *     Zeitpunkte) und einem manuellen Wiederaufnahmepfad.
 */

export interface ConflictInfo {
  errorClass: ErrorClass;
  status: number | null;
  /** Fehlercode des Servers, z. B. "version_conflict", "vehicle_blocked". */
  error: string | null;
  /** Aus der Phase-1-Konfliktantwort (§4-Seam) – erlaubt eine Diff-Ansicht ohne Nachfrage. */
  currentVersion: number | null;
  conflictFields: string[];
  current: unknown;
  message: string | null;
  detectedAt: string;
}

export interface SyncQueueEntry {
  // ---- §8: die acht Pflichtfelder ----------------------------------------
  /** Operation-ID */
  operationId: string;
  /** Erstellzeit */
  createdAt: string;
  /** Benutzer */
  benutzerId: string;
  /** Device-ID */
  deviceId: string;
  /** Schema-Version */
  schemaVersion: number;
  /** Request-Hash (SHA-256, identische Kanonisierung wie der Server) */
  requestHash: string;
  /** Retry-Zähler */
  retryCount: number;
  /** letzter Fehler */
  lastError: string | null;

  // ---- Ausführungsdaten ---------------------------------------------------
  kind: "draft" | "critical";
  draftKind: OfflineDraftKind | null;
  /** Idempotenz-Operationsname des Servers (falls eine der zehn §2-Operationen). */
  operation: string | null;
  /** Idempotenzschlüssel – wird VOR dem ersten Senden vergeben und NIE geändert. */
  idempotencyKey: string;
  method: "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  /** Zielobjekt für den Hash (Server nutzt dasselbe Feld). */
  target: string;
  /** §7: Entwurfsinhalt liegt VERSCHLÜSSELT vor. */
  payload: EncryptedBlob;
  /** §4-Grundlage: gelesene Version des betroffenen Datensatzes. */
  baseVersion: number | null;
  baseRecordId: string | null;
  /** Kurzer, nicht-personenbezogener Text für die Warteschlangenanzeige. */
  bezeichnung: string;

  // ---- Zustand ------------------------------------------------------------
  status: SyncState;
  /** true = Ausgang unbekannt -> "Status wird geprüft", NIE Erfolg. */
  outcomeUnknown: boolean;
  nextAttemptAt: string | null;
  lastAttemptAt: string | null;
  errorClass: ErrorClass | null;
  conflict: ConflictInfo | null;
  resultStatus: number | null;
  staleReason: "schema_version" | "record_moved_on" | "draft_too_old" | "identity_mismatch" | null;
  confirmedAt: string | null;
}

export interface SyncTransportResult {
  /** 0 = keine Antwort erhalten (Netzwerkabbruch). */
  status: number;
  ok: boolean;
  body: unknown;
  retryAfter?: string | null;
  /** true, wenn die Anfrage abgesetzt wurde, aber keine Antwort ankam. */
  outcomeUnknown?: boolean;
}

export type OperationLookup =
  | { status: "completed"; responseStatus: number | null; responseBody: unknown }
  | { status: "in_progress" }
  | { status: "unknown" };

export interface SyncTransport {
  online(): boolean;
  send(input: {
    method: string;
    path: string;
    body: unknown;
    idempotencyKey: string;
    expectedVersion: number | null;
  }): Promise<SyncTransportResult>;
  /** §8: Identität nach Wiederverbindung erneut prüfen. */
  identity(): Promise<{ benutzerId: string } | null>;
  /** §7: offenen Vorgang über den gespeicherten Idempotenzschlüssel auflösen. */
  lookupOperation(operation: string, key: string): Promise<OperationLookup>;
  /** §8: erkennen, ob sich der zugrundeliegende Datensatz weiterbewegt hat. */
  currentVersion?(input: { recordId: string; path: string }): Promise<number | null>;
}

export interface QueueDeps {
  store: KeyValueStore;
  transport: SyncTransport;
  /** Schlüssel für die Entwurfsverschlüsselung (siehe crypto.ts). */
  draftKey: CryptoKey;
  deviceId: string;
  benutzerId: string;
  now?: () => Date;
  /** Deterministische IDs für Tests. */
  newId?: () => string;
}

const PREFIX = "queue:";

function nowOf(deps: QueueDeps): Date {
  return deps.now ? deps.now() : new Date();
}

function idOf(deps: QueueDeps): string {
  if (deps.newId) return deps.newId();
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `op-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// ---------------------------------------------------------------------------
// Persistenz
// ---------------------------------------------------------------------------
export function putQueueEntry(store: KeyValueStore, entry: SyncQueueEntry): void {
  store.set(PREFIX + entry.operationId, JSON.stringify(entry));
}

export function getQueueEntry(store: KeyValueStore, operationId: string): SyncQueueEntry | null {
  const raw = store.get(PREFIX + operationId);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as SyncQueueEntry;
    if (!parsed?.operationId || !isEncryptedBlob(parsed.payload)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function removeQueueEntry(store: KeyValueStore, operationId: string): void {
  store.remove(PREFIX + operationId);
}

/** Alle Einträge, älteste zuerst – die Reihenfolge, in der gesendet wird. */
export function listQueue(store: KeyValueStore): SyncQueueEntry[] {
  const out: SyncQueueEntry[] = [];
  for (const key of store.keys()) {
    if (!key.startsWith(PREFIX)) continue;
    const entry = getQueueEntry(store, key.slice(PREFIX.length));
    if (entry) out.push(entry);
  }
  return out.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
}

/** §7: die Prüf-Warteschlange. Kritische Konflikte werden hier NUR gesammelt. */
export function reviewQueue(store: KeyValueStore): SyncQueueEntry[] {
  return listQueue(store).filter((e) => e.status === "conflict" || e.staleReason !== null);
}

// ---------------------------------------------------------------------------
// Anlegen
// ---------------------------------------------------------------------------
export interface CreateEntryInput {
  method: "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  body: unknown;
  bezeichnung: string;
  target?: string;
  baseVersion?: number | null;
  baseRecordId?: string | null;
  /** Erzwingt die Einstufung; sonst wird sie aus method+path abgeleitet. */
  draftKind?: OfflineDraftKind;
}

/**
 * §8 – Entwurf anlegen. Erlaubt auch offline, aber NUR für die vier
 * ausdrücklich zugelassenen Entwurfsarten. Alles andere wirft.
 */
export async function createDraft(
  deps: QueueDeps,
  input: CreateEntryInput,
): Promise<SyncQueueEntry> {
  const klasse = classifyMutation(input.method, input.path);
  const draftKind = input.draftKind ?? klasse.offlineDraftKind;
  if (!draftKind || !isOfflineDraftKind(draftKind)) {
    throw new OfflineNotAllowedError(klasse.offlineForbidden, klasse.kritisch);
  }
  return anlegen(deps, input, {
    kind: "draft",
    draftKind,
    operation: klasse.operation,
    status: "local_draft",
  });
}

/**
 * §7 – kritischer Vorgang. Wird VOR dem Senden persistiert (mit
 * Idempotenzschlüssel!), damit ein Absturz zwischen Absenden und Antwort
 * auflösbar bleibt. Offline ist das Anlegen VERBOTEN – kein stilles Queuing
 * einer Buchung.
 */
export async function createCriticalOperation(
  deps: QueueDeps,
  input: CreateEntryInput,
): Promise<SyncQueueEntry> {
  if (!deps.transport.online()) {
    const klasse = classifyMutation(input.method, input.path);
    throw new OfflineNotAllowedError(klasse.offlineForbidden, true);
  }
  const klasse = classifyMutation(input.method, input.path);
  return anlegen(deps, input, {
    kind: "critical",
    draftKind: null,
    operation: klasse.operation,
    status: "queued",
  });
}

async function anlegen(
  deps: QueueDeps,
  input: CreateEntryInput,
  meta: {
    kind: "draft" | "critical";
    draftKind: OfflineDraftKind | null;
    operation: string | null;
    status: SyncState;
  },
): Promise<SyncQueueEntry> {
  const jetzt = nowOf(deps);
  const target = input.target ?? input.path;
  const entry: SyncQueueEntry = {
    operationId: idOf(deps),
    createdAt: jetzt.toISOString(),
    benutzerId: deps.benutzerId,
    deviceId: deps.deviceId,
    schemaVersion: DRAFT_SCHEMA_VERSION,
    requestHash: await requestHash(meta.operation ?? input.path, target, input.body),
    retryCount: 0,
    lastError: null,
    kind: meta.kind,
    draftKind: meta.draftKind,
    operation: meta.operation,
    // Der Idempotenzschlüssel wird EINMAL vergeben und über alle Wiederholungen
    // hinweg beibehalten. Ein pro Versuch neu erzeugter Schlüssel wäre das
    // genaue Gegenteil von Idempotenz.
    idempotencyKey: idOf(deps),
    method: input.method,
    path: input.path,
    target,
    payload: await encryptJson(deps.draftKey, input.body),
    baseVersion: input.baseVersion ?? null,
    baseRecordId: input.baseRecordId ?? null,
    bezeichnung: input.bezeichnung,
    status: meta.status,
    outcomeUnknown: false,
    nextAttemptAt: null,
    lastAttemptAt: null,
    errorClass: null,
    conflict: null,
    resultStatus: null,
    staleReason: null,
    confirmedAt: null,
  };
  putQueueEntry(deps.store, entry);
  return entry;
}

/** Entwurf abschicken heißt: aus `local_draft` in die Warteschlange. */
export function enqueueDraft(deps: QueueDeps, operationId: string): SyncQueueEntry | null {
  const entry = getQueueEntry(deps.store, operationId);
  if (!entry) return null;
  const updated: SyncQueueEntry = { ...entry, status: "queued", nextAttemptAt: null };
  putQueueEntry(deps.store, updated);
  return updated;
}

export async function readEntryPayload<T = unknown>(
  deps: QueueDeps,
  entry: SyncQueueEntry,
): Promise<T> {
  return decryptJson<T>(deps.draftKey, entry.payload);
}

/** Entwurf ändern, solange er noch nicht gesendet wurde. */
export async function updateDraftPayload(
  deps: QueueDeps,
  operationId: string,
  body: unknown,
): Promise<SyncQueueEntry | null> {
  const entry = getQueueEntry(deps.store, operationId);
  if (!entry) return null;
  if (entry.status !== "local_draft" && entry.status !== "failed" && entry.status !== "conflict") {
    // Eine Nutzlast zu ändern, während gesendet wird, würde den
    // Request-Hash gegen den bereits reservierten Idempotenzschlüssel
    // laufen lassen -> serverseitig 409. Deshalb verboten.
    throw new Error(`Entwurf im Zustand "${entry.status}" kann nicht geändert werden.`);
  }
  const updated: SyncQueueEntry = {
    ...entry,
    payload: await encryptJson(deps.draftKey, body),
    requestHash: await requestHash(entry.operation ?? entry.path, entry.target, body),
    // Nutzlast geändert = fachlich ein NEUER Vorgang -> neuer Schlüssel,
    // damit der Server ihn nicht als Konflikt mit dem alten Inhalt ablehnt.
    idempotencyKey: idOf(deps),
    status: "local_draft",
    lastError: null,
    errorClass: null,
    conflict: null,
    staleReason: null,
    outcomeUnknown: false,
  };
  putQueueEntry(deps.store, updated);
  return updated;
}

// ---------------------------------------------------------------------------
// Senden
// ---------------------------------------------------------------------------
export interface AttemptResult {
  entry: SyncQueueEntry;
  plan: ClientRetryPlan | null;
  /** true, wenn der Server bestätigt hat (2xx). */
  confirmed: boolean;
}

function conflictFromBody(status: number, body: unknown, errorClass: ErrorClass, jetzt: Date): ConflictInfo {
  const b = (body ?? {}) as Record<string, unknown>;
  return {
    errorClass,
    status,
    error: typeof b.error === "string" ? b.error : null,
    currentVersion: typeof b.currentVersion === "number" ? b.currentVersion : null,
    conflictFields: Array.isArray(b.conflictFields) ? (b.conflictFields as string[]) : [],
    current: b.current ?? null,
    message: typeof b.message === "string" ? b.message : null,
    detectedAt: jetzt.toISOString(),
  };
}

/**
 * EIN Sendeversuch. Der gesamte §9-Entscheidungsbaum steckt hier – und nur
 * hier, damit es keine zweite Meinung darüber gibt, was wiederholt wird.
 */
export async function attemptEntry(deps: QueueDeps, entry: SyncQueueEntry): Promise<AttemptResult> {
  const jetzt = nowOf(deps);

  if (!deps.transport.online()) {
    // §7-Zustand `offline`: sichtbar, nicht als "wird gesendet" getarnt.
    const updated: SyncQueueEntry = { ...entry, status: "offline", nextAttemptAt: null };
    putQueueEntry(deps.store, updated);
    return { entry: updated, plan: null, confirmed: false };
  }

  const laufend: SyncQueueEntry = {
    ...entry,
    status: "syncing",
    lastAttemptAt: jetzt.toISOString(),
    retryCount: entry.retryCount + 1,
  };
  putQueueEntry(deps.store, laufend);

  let body: unknown;
  try {
    body = await readEntryPayload(deps, laufend);
  } catch (err) {
    // Nicht entschlüsselbar (z. B. Benutzerwechsel auf demselben Gerät).
    // NIEMALS senden – der Inhalt ist unbekannt.
    const updated: SyncQueueEntry = {
      ...laufend,
      status: "failed",
      staleReason: "identity_mismatch",
      errorClass: "UNKNOWN_PERMANENT",
      lastError:
        err instanceof DecryptionError
          ? "Entwurf gehört zu einer anderen Anmeldung und kann nicht gesendet werden."
          : String((err as Error)?.message ?? err),
      nextAttemptAt: null,
    };
    putQueueEntry(deps.store, updated);
    return { entry: updated, plan: null, confirmed: false };
  }

  let result: SyncTransportResult;
  try {
    result = await deps.transport.send({
      method: laufend.method,
      path: laufend.path,
      body,
      idempotencyKey: laufend.idempotencyKey,
      expectedVersion: laufend.baseVersion,
    });
  } catch (err) {
    result = {
      status: 0,
      ok: false,
      body: null,
      outcomeUnknown: true,
      retryAfter: null,
    };
    (result as { message?: string }).message = String((err as Error)?.message ?? err);
  }

  if (result.ok) {
    // ERST HIER gilt der Vorgang als erfolgreich (§7).
    const updated: SyncQueueEntry = {
      ...laufend,
      status: "synced",
      outcomeUnknown: false,
      resultStatus: result.status,
      lastError: null,
      errorClass: null,
      conflict: null,
      nextAttemptAt: null,
      confirmedAt: jetzt.toISOString(),
    };
    putQueueEntry(deps.store, updated);
    return { entry: updated, plan: null, confirmed: true };
  }

  const plan = planClientRetry(
    {
      status: result.status === 0 ? undefined : result.status,
      body: result.body,
      retryAfter: result.retryAfter ?? null,
      message: result.status === 0 ? "network" : undefined,
      outcomeUnknown: result.outcomeUnknown === true,
    },
    laufend.retryCount,
    { now: jetzt.getTime() },
  );

  const fehlertext =
    (typeof result.body === "object" && result.body && "error" in (result.body as object)
      ? String((result.body as { error: unknown }).error)
      : null) ??
    (result.status === 0 ? "Verbindung abgebrochen" : `HTTP ${result.status}`);

  let status: SyncState;
  let conflict: ConflictInfo | null = null;
  if (plan.retry) {
    status = "retrying";
  } else if (needsHumanDecision(plan.errorClass)) {
    // §7: kritische Konflikte gehen in die Prüf-Warteschlange, NIE automatisch
    // aufgelöst.
    status = "conflict";
    conflict = conflictFromBody(result.status, result.body, plan.errorClass, jetzt);
  } else {
    status = "failed";
  }

  const updated: SyncQueueEntry = {
    ...laufend,
    status,
    outcomeUnknown: plan.outcomeUnknown,
    resultStatus: result.status || null,
    lastError: plan.outcomeUnknown
      ? `${fehlertext} – Ausgang unbekannt, wird beim Server nachgefragt`
      : fehlertext,
    errorClass: plan.errorClass,
    conflict,
    nextAttemptAt: plan.retry ? new Date(jetzt.getTime() + plan.delayMs).toISOString() : null,
  };
  putQueueEntry(deps.store, updated);
  return { entry: updated, plan, confirmed: false };
}

export interface ProcessQueueResult {
  versucht: number;
  bestaetigt: number;
  wiederholt: number;
  konflikte: number;
  fehlgeschlagen: number;
  offline: number;
  uebersprungen: number;
}

/** Alle fälligen Einträge einmal durchgehen (§9 Backoff wird respektiert). */
export async function processQueue(
  deps: QueueDeps,
  options: { limit?: number } = {},
): Promise<ProcessQueueResult> {
  const jetzt = nowOf(deps);
  const result: ProcessQueueResult = {
    versucht: 0,
    bestaetigt: 0,
    wiederholt: 0,
    konflikte: 0,
    fehlgeschlagen: 0,
    offline: 0,
    uebersprungen: 0,
  };
  const limit = options.limit ?? 20;

  for (const entry of listQueue(deps.store)) {
    if (result.versucht >= limit) break;
    // Nicht sendbar: Entwurf (noch nicht abgeschickt), bereits bestätigt,
    // Konflikt (braucht Menschen), veraltet (braucht Bestätigung),
    // dauerhaft fehlgeschlagen (braucht Benutzeraktion).
    if (
      entry.status === "local_draft" ||
      entry.status === "synced" ||
      entry.status === "conflict" ||
      entry.status === "failed" ||
      entry.status === "stale"
    ) {
      result.uebersprungen += 1;
      continue;
    }
    if (entry.staleReason) {
      result.uebersprungen += 1;
      continue;
    }
    if (entry.nextAttemptAt && Date.parse(entry.nextAttemptAt) > jetzt.getTime()) {
      result.uebersprungen += 1;
      continue;
    }

    const outcome = await attemptEntry(deps, entry);
    result.versucht += 1;
    if (outcome.confirmed) result.bestaetigt += 1;
    else if (outcome.entry.status === "retrying") result.wiederholt += 1;
    else if (outcome.entry.status === "conflict") result.konflikte += 1;
    else if (outcome.entry.status === "offline") result.offline += 1;
    else if (outcome.entry.status === "failed") result.fehlgeschlagen += 1;
  }

  return result;
}

// ---------------------------------------------------------------------------
// §7 Auflösung nach Neustart
// ---------------------------------------------------------------------------
export interface ResolveResult {
  geprueft: number;
  bestaetigt: number;
  offen: number;
  unbekannt: number;
}

/**
 * §7 – "Nach einem Neustart in Arbeit befindliche Vorgänge auflösen, indem der
 * Server mit dem gespeicherten Idempotenzschlüssel gefragt wird."
 *
 * Wird beim App-Start aufgerufen, BEVOR irgendetwas erneut gesendet wird.
 * Genau dafür existiert Phase 1s Idempotenzspeicher.
 *
 * Ein Eintrag ohne §2-Operation (also kein Endpunkt mit Idempotenzspeicher)
 * kann so nicht aufgelöst werden. Er bleibt ehrlich `outcomeUnknown` und wird
 * dem Benutzer als "Status wird geprüft – bitte im Fachbereich nachsehen"
 * angezeigt, statt automatisch wiederholt zu werden. Diese Lücke wird in
 * docs/sync-architecture.md ausdrücklich benannt.
 */
export async function resolvePendingAfterRestart(deps: QueueDeps): Promise<ResolveResult> {
  const result: ResolveResult = { geprueft: 0, bestaetigt: 0, offen: 0, unbekannt: 0 };
  const jetzt = nowOf(deps);

  for (const entry of listQueue(deps.store)) {
    const inArbeit = entry.status === "syncing" || entry.outcomeUnknown;
    if (!inArbeit) continue;
    result.geprueft += 1;

    if (!entry.operation) {
      const updated: SyncQueueEntry = {
        ...entry,
        status: "failed",
        outcomeUnknown: true,
        lastError:
          "Ausgang unbekannt und für diesen Endpunkt nicht serverseitig auflösbar – bitte Fachzustand prüfen.",
      };
      putQueueEntry(deps.store, updated);
      result.unbekannt += 1;
      continue;
    }

    let lookup: OperationLookup;
    try {
      lookup = await deps.transport.lookupOperation(entry.operation, entry.idempotencyKey);
    } catch {
      // Kein Netz: Zustand bleibt unbekannt, wird beim nächsten Start erneut
      // versucht. Kein Erfolg behaupten, kein blindes Wiederholen.
      const updated: SyncQueueEntry = { ...entry, status: "retrying", outcomeUnknown: true };
      putQueueEntry(deps.store, updated);
      result.offen += 1;
      continue;
    }

    if (lookup.status === "completed") {
      const updated: SyncQueueEntry = {
        ...entry,
        status: "synced",
        outcomeUnknown: false,
        resultStatus: lookup.responseStatus ?? 200,
        confirmedAt: jetzt.toISOString(),
        lastError: null,
        errorClass: null,
      };
      putQueueEntry(deps.store, updated);
      result.bestaetigt += 1;
      continue;
    }

    if (lookup.status === "in_progress") {
      const updated: SyncQueueEntry = {
        ...entry,
        status: "syncing",
        outcomeUnknown: true,
        lastError: "Eine Anfrage mit diesem Schlüssel läuft noch.",
      };
      putQueueEntry(deps.store, updated);
      result.offen += 1;
      continue;
    }

    // `unknown` = kein Eintrag im Idempotenzspeicher. Weil fehlgeschlagene
    // Vorgänge ihre Reservierung MIT zurückrollen, hat der Vorgang NICHT
    // gewirkt -> derselbe Schlüssel darf erneut gesendet werden.
    const updated: SyncQueueEntry = {
      ...entry,
      status: "queued",
      outcomeUnknown: false,
      lastError: "Vorgang hat nicht gewirkt (kein Serverbeleg) – wird erneut gesendet.",
      nextAttemptAt: null,
    };
    putQueueEntry(deps.store, updated);
    result.unbekannt += 1;
  }

  return result;
}

// ---------------------------------------------------------------------------
// §8 Nach Wiederverbindung
// ---------------------------------------------------------------------------
export interface ReconcileResult {
  identitaetGeprueft: boolean;
  identitaetsWechsel: boolean;
  veraltet: number;
  konflikte: number;
  bereitZumSenden: number;
}

/**
 * §8 – "Nach der Wiederverbindung: Identität erneut prüfen, veraltete
 * Entwürfe erkennen, Konflikte sichtbar machen, idempotent synchronisieren."
 *
 * Reihenfolge ist wichtig und nicht beliebig:
 *   1. **Identität.** Ist ein anderer Benutzer angemeldet, wird KEIN Entwurf
 *      gesendet. Ein Fahrstundenbericht von Fahrlehrer A darf nicht unter der
 *      Identität von Fahrlehrer B im System landen.
 *   2. **Veraltete Entwürfe.** Zwei Gründe: die lokale Schema-Version passt
 *      nicht mehr, ODER der Entwurf ist älter als sieben Tage. Beides führt
 *      zu `stale` + Bestätigungspflicht, nie zu stillem Senden und nie zu
 *      stillem Verwerfen.
 *   3. **Konflikte.** Hat sich der zugrundeliegende Datensatz bewegt
 *      (Version > gelesene Version), ist der Entwurf ein Konflikt – sichtbar,
 *      nicht überschrieben.
 *   4. Erst dann darf gesendet werden (idempotent, mit dem ursprünglichen
 *      Schlüssel).
 */
export async function reconcileAfterReconnect(deps: QueueDeps): Promise<ReconcileResult> {
  const jetzt = nowOf(deps);
  const result: ReconcileResult = {
    identitaetGeprueft: false,
    identitaetsWechsel: false,
    veraltet: 0,
    konflikte: 0,
    bereitZumSenden: 0,
  };

  const identity = await deps.transport.identity();
  result.identitaetGeprueft = true;
  if (!identity || identity.benutzerId !== deps.benutzerId) {
    result.identitaetsWechsel = true;
    for (const entry of listQueue(deps.store)) {
      if (entry.status === "synced") continue;
      putQueueEntry(deps.store, {
        ...entry,
        status: "stale",
        staleReason: "identity_mismatch",
        lastError:
          "Angemeldete Identität weicht ab – der Vorgang wird nicht gesendet und muss bestätigt werden.",
        nextAttemptAt: null,
      });
    }
    return result;
  }

  for (const entry of listQueue(deps.store)) {
    if (entry.status === "synced" || entry.status === "conflict") continue;

    if (entry.schemaVersion !== DRAFT_SCHEMA_VERSION) {
      putQueueEntry(deps.store, {
        ...entry,
        status: "stale",
        staleReason: "schema_version",
        lastError: `Entwurf wurde mit Schema-Version ${entry.schemaVersion} gespeichert (aktuell ${DRAFT_SCHEMA_VERSION}).`,
        nextAttemptAt: null,
      });
      result.veraltet += 1;
      continue;
    }

    if (jetzt.getTime() - Date.parse(entry.createdAt) > DRAFT_STALE_AFTER_MS) {
      putQueueEntry(deps.store, {
        ...entry,
        status: "stale",
        staleReason: "draft_too_old",
        lastError:
          "Entwurf ist älter als sieben Tage – bitte prüfen und ausdrücklich bestätigen, bevor er gesendet wird.",
        nextAttemptAt: null,
      });
      result.veraltet += 1;
      continue;
    }

    if (entry.baseRecordId && entry.baseVersion !== null && deps.transport.currentVersion) {
      const current = await deps.transport.currentVersion({
        recordId: entry.baseRecordId,
        path: entry.path,
      });
      if (current !== null && current !== entry.baseVersion) {
        putQueueEntry(deps.store, {
          ...entry,
          status: "conflict",
          conflict: {
            errorClass: "STALE_VERSION",
            status: null,
            error: "record_moved_on",
            currentVersion: current,
            conflictFields: [],
            current: null,
            message: `Der Datensatz wurde inzwischen geändert (Version ${entry.baseVersion} → ${current}).`,
            detectedAt: jetzt.toISOString(),
          },
          nextAttemptAt: null,
        });
        result.konflikte += 1;
        continue;
      }
    }

    if (entry.status === "offline" || entry.status === "retrying" || entry.status === "queued") {
      putQueueEntry(deps.store, { ...entry, status: "queued", nextAttemptAt: null });
      result.bereitZumSenden += 1;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Benutzeraktionen
// ---------------------------------------------------------------------------
/** §7/§9: manueller Wiederaufnahmepfad nach erschöpften Versuchen. */
export function retryEntry(store: KeyValueStore, operationId: string): SyncQueueEntry | null {
  const entry = getQueueEntry(store, operationId);
  if (!entry) return null;
  const updated: SyncQueueEntry = {
    ...entry,
    status: "queued",
    retryCount: 0,
    nextAttemptAt: null,
    lastError: null,
    errorClass: null,
    // Ein bestätigter Konflikt/veralteter Entwurf wird bewusst NICHT gelöscht:
    // die Historie bleibt sichtbar, bis der Vorgang durch ist.
  };
  putQueueEntry(store, updated);
  return updated;
}

export class CriticalDiscardError extends Error {
  constructor() {
    super(
      "Ein kritischer Vorgang mit unbekanntem Ausgang darf nicht ohne ausdrückliche Bestätigung verworfen werden.",
    );
    this.name = "CriticalDiscardError";
  }
}

/**
 * §7: nicht-kritische Fehlschläge darf der Benutzer verwerfen. Ein kritischer
 * Vorgang mit UNBEKANNTEM Ausgang darf es nicht ohne `force` – sonst
 * verschwindet eine möglicherweise gebuchte Zahlung aus der Ansicht, ohne aus
 * der Welt zu sein.
 */
export function discardEntry(
  store: KeyValueStore,
  operationId: string,
  options: { force?: boolean } = {},
): void {
  const entry = getQueueEntry(store, operationId);
  if (!entry) return;
  if (entry.kind === "critical" && entry.outcomeUnknown && !options.force) {
    throw new CriticalDiscardError();
  }
  removeQueueEntry(store, operationId);
}

/** Bestätigt einen veralteten Entwurf ausdrücklich und stellt ihn wieder ein. */
export function confirmStaleEntry(store: KeyValueStore, operationId: string): SyncQueueEntry | null {
  const entry = getQueueEntry(store, operationId);
  if (!entry) return null;
  if (entry.staleReason === "identity_mismatch") {
    // Nicht bestätigbar: der Inhalt gehört einer anderen Anmeldung.
    return entry;
  }
  const updated: SyncQueueEntry = {
    ...entry,
    status: "queued",
    staleReason: null,
    retryCount: 0,
    nextAttemptAt: null,
    lastError: null,
  };
  putQueueEntry(store, updated);
  return updated;
}

/** Räumt bestätigte Vorgänge auf (die Historie ist nicht die Wahrheit). */
export function pruneConfirmed(
  store: KeyValueStore,
  options: { olderThanMs?: number; now?: Date } = {},
): number {
  const grenze = (options.now?.getTime() ?? Date.now()) - (options.olderThanMs ?? 24 * 60 * 60 * 1000);
  let removed = 0;
  for (const entry of listQueue(store)) {
    if (entry.status !== "synced" || !entry.confirmedAt) continue;
    if (Date.parse(entry.confirmedAt) < grenze) {
      removeQueueEntry(store, entry.operationId);
      removed += 1;
    }
  }
  return removed;
}

// ---------------------------------------------------------------------------
// Zusammenfassung für die Statusanzeige (§1)
// ---------------------------------------------------------------------------
export interface QueueSummary {
  entwuerfe: number;
  wartend: number;
  laufend: number;
  wiederholend: number;
  konflikte: number;
  fehlgeschlagen: number;
  veraltet: number;
  ausgangUnbekannt: number;
  /** Der zusammengefasste Zustand, der in der Statuszeile angezeigt wird. */
  gesamtStatus: SyncState;
}

/**
 * §1/§7 – EIN zusammengefasster Zustand für die Statuszeile. Die Reihenfolge
 * ist eine Rangfolge nach Dringlichkeit: was ein Mensch tun muss, gewinnt.
 */
export function queueSummary(store: KeyValueStore, online: boolean): QueueSummary {
  const alle = listQueue(store);
  const summary: QueueSummary = {
    entwuerfe: alle.filter((e) => e.status === "local_draft").length,
    wartend: alle.filter((e) => e.status === "queued" || e.status === "offline").length,
    laufend: alle.filter((e) => e.status === "syncing").length,
    wiederholend: alle.filter((e) => e.status === "retrying").length,
    konflikte: alle.filter((e) => e.status === "conflict").length,
    fehlgeschlagen: alle.filter((e) => e.status === "failed").length,
    veraltet: alle.filter((e) => e.status === "stale").length,
    ausgangUnbekannt: alle.filter((e) => e.outcomeUnknown).length,
    gesamtStatus: "synced",
  };

  if (summary.konflikte > 0) summary.gesamtStatus = "conflict";
  else if (summary.fehlgeschlagen > 0) summary.gesamtStatus = "failed";
  else if (summary.veraltet > 0) summary.gesamtStatus = "stale";
  else if (!online) summary.gesamtStatus = "offline";
  else if (summary.laufend > 0) summary.gesamtStatus = "syncing";
  else if (summary.wiederholend > 0) summary.gesamtStatus = "retrying";
  else if (summary.wartend > 0) summary.gesamtStatus = "queued";
  else if (summary.entwuerfe > 0) summary.gesamtStatus = "local_draft";

  return summary;
}
