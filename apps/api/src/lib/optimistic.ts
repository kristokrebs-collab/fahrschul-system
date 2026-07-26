import type { FastifyReply, FastifyRequest } from "fastify";

/**
 * PROMPT -1 §4 – Optimistische Sperren, tatsächlich verdrahtet.
 *
 * Bisher existierten `version`-Spalten, aber niemand hat sie gelesen. Ab hier:
 *  - Der Client sendet die Version, die er gelesen hat – als `expectedVersion`
 *    im Body ODER als `If-Match`-Header (ETag `W/"<version>"`).
 *  - Hat sich der Datensatz zwischenzeitlich geändert, antwortet der Server
 *    mit **409** und liefert den AKTUELLEN Serverzustand mit, damit die App
 *    einen Diff zeigen und der Mensch entscheiden kann. Kein stilles
 *    Überschreiben, aber auch kein blindes Verwerfen der Eingabe.
 *  - Jede Antwort auf einen versionierten Datensatz trägt einen `ETag`.
 *
 * Die Fortschreibung von `version`/`updated_at` erledigt ein DB-Trigger
 * (`fs_bump_version`, migrations/0007_reliability_core.sql), damit KEIN
 * Codepfad – auch kein Roh-SQL – die Erkennung veralteter Schreibvorgänge
 * umgehen kann.
 *
 * SEAM für Phase 2: die Konfliktantwort ist absichtlich maschinenlesbar
 * (`error`, `expectedVersion`, `currentVersion`, `current`, `conflictFields`),
 * damit die Client-Sync-Zustände (§6-§8) daraus direkt eine Diff-Ansicht
 * bauen können, ohne den Server erneut zu fragen.
 */

export interface VersionedRow {
  id: string;
  version: number;
  updatedAt: Date | string | null;
}

export class VersionConflictError<T extends VersionedRow = VersionedRow> extends Error {
  code = "version_conflict" as const;
  expectedVersion: number;
  current: T;
  constructor(expectedVersion: number, current: T) {
    super(
      `Datensatz ${current.id} wurde zwischenzeitlich geändert (erwartet Version ${expectedVersion}, aktuell ${current.version}).`,
    );
    this.expectedVersion = expectedVersion;
    this.current = current;
  }
}

/** Datensatz existiert nicht (getrennt von "Version veraltet", damit 404 != 409). */
export class RowNotFoundError extends Error {
  code = "not_found" as const;
}

export function etagFor(row: Pick<VersionedRow, "version">): string {
  return `W/"${row.version}"`;
}

/** Setzt ETag + Last-Modified auf eine Antwort mit versioniertem Datensatz. */
export function withVersionHeaders(reply: FastifyReply, row: VersionedRow): FastifyReply {
  reply.header("ETag", etagFor(row));
  if (row.updatedAt) {
    const d = row.updatedAt instanceof Date ? row.updatedAt : new Date(row.updatedAt);
    reply.header("Last-Modified", d.toUTCString());
  }
  return reply;
}

/**
 * Liest die erwartete Version aus `If-Match` oder aus dem Body.
 * `If-Match: *` bedeutet "egal welche Version" und ergibt daher `null`.
 */
export function readExpectedVersion(request: FastifyRequest): number | null {
  const header = request.headers["if-match"];
  const raw = Array.isArray(header) ? header[0] : header;
  if (typeof raw === "string" && raw.trim().length > 0 && raw.trim() !== "*") {
    const match = /(\d+)/.exec(raw);
    if (match) return Number(match[1]);
  }
  const body = request.body as { expectedVersion?: unknown } | undefined;
  if (body && typeof body.expectedVersion === "number" && Number.isInteger(body.expectedVersion)) {
    return body.expectedVersion;
  }
  return null;
}

/**
 * Vergleicht die vom Client gelesene Version mit dem Serverzustand.
 * `null` (keine Version mitgeschickt) wird NICHT als Konflikt behandelt –
 * dann gilt "letzter Schreibvorgang gewinnt" wie bisher. Für die in §4
 * gelisteten Entitäten fordern die Routen die Version verpflichtend an
 * (siehe `requireExpectedVersion`), sodass es dort kein stilles
 * Überschreiben geben kann.
 */
export function assertVersion<T extends VersionedRow>(current: T | undefined, expected: number | null): T {
  if (!current) throw new RowNotFoundError("not_found");
  if (expected !== null && current.version !== expected) {
    throw new VersionConflictError(expected, current);
  }
  return current;
}

/** Wie `assertVersion`, verlangt aber, dass der Client eine Version mitschickt. */
export function requireExpectedVersion(expected: number | null, reply: FastifyReply): number | null {
  if (expected === null) {
    reply.code(428).send({
      error: "precondition_required",
      hinweis:
        'Diese Operation verlangt die gelesene Version: Header If-Match: W/"<version>" oder Feld "expectedVersion".',
    });
    return null;
  }
  return expected;
}

/**
 * Einheitliche 409-Antwort mit dem AKTUELLEN Serverzustand.
 * `conflictFields` nennt die Felder, in denen sich der eingereichte Patch vom
 * Serverzustand unterscheidet – genau das, was eine Diff-Ansicht braucht.
 */
export function sendVersionConflict(
  err: VersionConflictError,
  reply: FastifyReply,
  submittedPatch?: Record<string, unknown>,
): FastifyReply {
  const current = err.current as unknown as Record<string, unknown>;
  const conflictFields = submittedPatch
    ? Object.keys(submittedPatch).filter((k) => {
        if (k === "expectedVersion" || k === "idempotencyKey") return false;
        const a = current[k];
        const b = submittedPatch[k];
        if (a instanceof Date && (typeof b === "string" || b instanceof Date)) {
          return a.getTime() !== new Date(b as string).getTime();
        }
        return JSON.stringify(a ?? null) !== JSON.stringify(b ?? null);
      })
    : [];

  withVersionHeaders(reply, err.current);
  return reply.code(409).send({
    error: "version_conflict",
    expectedVersion: err.expectedVersion,
    currentVersion: err.current.version,
    /** Vollständiger Serverzustand, damit der Client einen Diff zeigen kann. */
    current: err.current,
    conflictFields,
    message: err.message,
  });
}
