import type { OperationLookup, SyncTransport, SyncTransportResult } from "./queue.js";

/**
 * PROMPT -1 §7/§9 – der Standardtransport der Vorgangsliste gegen apps/api.
 *
 * Drei Dinge macht er, die keine der vier Apps selbst machen darf:
 *
 *  1. **`Idempotency-Key` immer mitsenden.** Nicht "wenn der Aufrufer daran
 *     denkt" – der Schlüssel steckt im Vorgang und wird hier gesetzt. Damit
 *     ist die Voraussetzung erfüllt, die Phase 1 für die Pflichtmachung der
 *     sechs offenen Operationen genannt hat.
 *  2. **`If-Match` aus der gelesenen Version setzen.** Damit greift §4 auch
 *     dort, wo der Endpunkt die Version nur prüft, WENN sie kommt.
 *  3. **Den mehrdeutigen Fall ehrlich melden.** `fetch` unterscheidet nicht
 *     zwischen "nie abgesendet" und "abgesendet, Antwort verloren". Ist der
 *     Browser vor dem Senden offline, war es sicher nichts (`outcomeUnknown:
 *     false`). Bricht die Verbindung im Flug ab, ist der Ausgang UNBEKANNT
 *     (`outcomeUnknown: true`) – und §7 verlangt dafür "Status wird geprüft",
 *     nicht "fehlgeschlagen".
 */
export interface HttpTransportOptions {
  apiBase: string;
  /** Für Tests injizierbar. */
  fetchFn?: typeof fetch;
  onlineFn?: () => boolean;
}

async function parseJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

export function createHttpSyncTransport(options: HttpTransportOptions): SyncTransport {
  const doFetch = options.fetchFn ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const online = options.onlineFn ?? (() => (typeof navigator === "undefined" ? true : navigator.onLine));

  return {
    online,

    async send(input): Promise<SyncTransportResult> {
      if (!online()) {
        // Gar nicht abgesendet -> Ausgang ist BEKANNT (nichts passiert).
        return { status: 0, ok: false, body: null, outcomeUnknown: false, retryAfter: null };
      }
      const headers: Record<string, string> = {
        "content-type": "application/json",
        "idempotency-key": input.idempotencyKey,
      };
      if (input.expectedVersion !== null && input.expectedVersion !== undefined) {
        headers["if-match"] = `W/"${input.expectedVersion}"`;
      }
      let res: Response;
      try {
        res = await doFetch(`${options.apiBase}${input.path}`, {
          method: input.method,
          credentials: "include",
          headers,
          body: JSON.stringify(input.body ?? {}),
        });
      } catch {
        // Abgesendet, keine Antwort -> Ausgang UNBEKANNT.
        return { status: 0, ok: false, body: null, outcomeUnknown: true, retryAfter: null };
      }
      const body = await parseJson(res);
      return {
        status: res.status,
        ok: res.ok,
        body,
        retryAfter: res.headers.get("retry-after"),
        outcomeUnknown: false,
      };
    },

    async identity() {
      const res = await doFetch(`${options.apiBase}/me`, { credentials: "include" });
      if (!res.ok) return null;
      const body = (await parseJson(res)) as { user?: { id?: string } };
      return body.user?.id ? { benutzerId: body.user.id } : null;
    },

    async lookupOperation(operation, key): Promise<OperationLookup> {
      const res = await doFetch(
        `${options.apiBase}/sync/operations/${encodeURIComponent(operation)}/${encodeURIComponent(key)}`,
        { credentials: "include" },
      );
      if (!res.ok) {
        // 404 heißt hier "kein (eigener) Eintrag" -> hat nicht gewirkt.
        if (res.status === 404) return { status: "unknown" };
        throw new Error(`sync/operations HTTP ${res.status}`);
      }
      const body = (await parseJson(res)) as {
        status: "completed" | "in_progress" | "unknown";
        responseStatus?: number | null;
        responseBody?: unknown;
      };
      if (body.status === "completed") {
        return {
          status: "completed",
          responseStatus: body.responseStatus ?? null,
          responseBody: body.responseBody ?? null,
        };
      }
      if (body.status === "in_progress") return { status: "in_progress" };
      return { status: "unknown" };
    },
  };
}
