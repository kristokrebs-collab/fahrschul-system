import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";

/**
 * PROMPT -1 §17 – CSRF-Schutz.
 *
 * ## Warum es hier überhaupt nötig ist
 *
 * Die Sitzung hängt an einem httpOnly-Cookie (bewusst: kein Token im
 * JS-Zugriff, siehe Phase-0-Entscheidung und routes/sync.ts). Genau diese
 * Entscheidung macht CSRF relevant – der Browser schickt das Cookie bei jeder
 * Anfrage mit, auch bei einer, die eine fremde Seite ausgelöst hat.
 *
 * ## Die gewählte Strategie
 *
 * Die Aufgabenstellung erlaubt „SameSite plus Token" ODER „Origin-Prüfung".
 * Beide einzeln haben eine erklärbare Lücke, deshalb sind hier ALLE Lagen
 * aktiv. Die Regel ist eine Zeile:
 *
 *   **Ein zustandsändernder Aufruf muss mindestens EINEN positiven Beweis
 *   liefern, dass er von der eigenen Anwendung stammt – und darf KEINEN
 *   Beweis liefern, dass er es nicht tut.**
 *
 * Als positiver Beweis gilt:
 *
 *  1. `Origin` (oder aus `Referer` abgeleitet) steht auf derselben Allowlist,
 *     die auch CORS benutzt. Moderne Browser senden `Origin` bei JEDEM
 *     POST/PUT/PATCH/DELETE – auch same-origin.
 *  2. `Sec-Fetch-Site: same-origin` oder `same-site`. Von allen aktuellen
 *     Browsern gesetzt und vom Seiteninhalt NICHT fälschbar (verbotener
 *     Header).
 *  3. Ein Double-Submit-Token, das per HMAC an DIESE Sitzung gebunden ist.
 *
 * Als Gegenbeweis (führt zu **403**) gilt:
 *
 *  - `Origin`/`Referer` vorhanden, aber nicht auf der Allowlist,
 *  - `Sec-Fetch-Site: cross-site` oder `same-site`-Verstoß,
 *  - Token vorhanden, aber falsch oder nicht zu dieser Sitzung gehörend.
 *
 * ## Der Fall „gar kein Signal" – ehrlich benannt
 *
 * Fehlen `Origin`, `Referer`, `Sec-Fetch-Site` UND Token vollständig, dann
 * stammt der Aufruf nicht aus einem Browser: jeder Browser seit ~2020 sendet
 * bei einem zustandsändernden Aufruf mindestens `Origin` oder
 * `Sec-Fetch-Site`. Ein Nicht-Browser-Client (Skript, Integration,
 * Testharness) kann per Definition nicht CSRF-geopfert werden – niemand kann
 * ihn zum unbeabsichtigten Senden verleiten, weil er keine Fremdseite lädt und
 * keine Cookies automatisch anhängt. Solche Aufrufe werden daher
 * **durchgelassen und protokolliert** (`csrf: "kein Browsersignal"`).
 *
 * Das ist eine bewusste Entscheidung mit einem benannten Restrisiko: ein SEHR
 * alter Browser (vor Origin-auf-same-origin-POST, vor `Sec-Fetch-*`), der
 * zusätzlich `SameSite` ignoriert, käme hier durch. Dagegen wirkt die dritte
 * Lage, die unabhängig davon aktiv ist: **das Sitzungscookie ist
 * `SameSite=Lax`**, ein fremdinitiierter POST bekommt es also gar nicht
 * mitgeschickt und ist dann unauthentifiziert (401). Die Alternative –
 * signalfreie Aufrufe pauschal ablehnen – würde jede Server-zu-Server-
 * Integration und jeden Betriebsskript aussperren, ohne die Angriffsfläche
 * gegenüber SameSite messbar zu verkleinern.
 *
 * ## Warum ein HMAC-gebundenes Double-Submit und kein reines Random-Paar
 *
 * Reines Double-Submit („Cookie-Wert == Header-Wert") ist gegen eine
 * Subdomain, die Cookies für die Hauptdomain setzen kann, wirkungslos: der
 * Angreifer setzt beide Seiten selbst. Deshalb ist der Token hier
 * `nonce.HMAC(nonce, sessionToken)` – nur gültig für GENAU DIESE Sitzung. Wer
 * Cookies setzen kann, kann den HMAC nicht bilden, weil er das
 * Sitzungsgeheimnis nicht kennt (httpOnly).
 *
 * ## Was NICHT geschützt wird und warum
 *
 *  - `GET`/`HEAD`/`OPTIONS`: keine Seiteneffekte. Ein Wächtertest
 *    (`security.test.ts`) prüft, dass keine GET-Route schreibt.
 *  - `POST /auth/login`: es gibt noch keine Sitzung, an die ein Token gebunden
 *    werden könnte. Hier wirken Origin-/`Sec-Fetch-Site`-Prüfung, SameSite und
 *    der Brute-Force-Schutz. „Login-CSRF" (jemandem eine fremde Sitzung
 *    unterschieben) wird durch die Origin-Prüfung abgedeckt.
 */

export const CSRF_COOKIE_NAME = "fahrschul_csrf";
export const CSRF_HEADER_NAME = "x-csrf-token";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Routen, die ohne CSRF-Token auskommen MÜSSEN, weil zum Zeitpunkt des
 * Aufrufs keine Sitzung existiert. Bewusst eine geschlossene Liste – eine
 * neue Route ist standardmäßig geschützt.
 */
export const CSRF_EXEMPT_PATHS: readonly string[] = ["/auth/login", "/health", "/health/deep"];

export function isCsrfExempt(method: string, url: string): boolean {
  if (SAFE_METHODS.has(method.toUpperCase())) return true;
  const path = url.split("?")[0];
  return CSRF_EXEMPT_PATHS.includes(path);
}

function hmac(nonce: string, sessionToken: string, secret: string): string {
  return createHmac("sha256", secret).update(`${nonce}.${sessionToken}`).digest("base64url");
}

/** Erzeugt einen an die Sitzung gebundenen Token. */
export function issueCsrfToken(sessionToken: string, secret: string): string {
  const nonce = randomBytes(16).toString("base64url");
  return `${nonce}.${hmac(nonce, sessionToken, secret)}`;
}

export function verifyCsrfToken(token: string, sessionToken: string, secret: string): boolean {
  const dot = token.indexOf(".");
  if (dot <= 0) return false;
  const nonce = token.slice(0, dot);
  const provided = token.slice(dot + 1);
  const expected = hmac(nonce, sessionToken, secret);
  if (provided.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
  } catch {
    return false;
  }
}

export type CsrfFailureReason =
  | "origin_not_allowed"
  | "cross_site_request"
  | "token_mismatch"
  | "token_cookie_mismatch";

export type CsrfProof = "origin" | "sec_fetch_site" | "token" | "kein_browsersignal";

export interface CsrfCheckResult {
  ok: boolean;
  reason?: CsrfFailureReason;
  /** Welcher Beweis die Anfrage getragen hat (für das Zugriffsprotokoll). */
  proof?: CsrfProof;
  /** Zur Diagnose in Logs (redaktionssicher: nur der Origin, kein Token). */
  origin?: string | null;
}

function headerValue(request: FastifyRequest, name: string): string | null {
  const raw = request.headers[name];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === "string" && value.length > 0 ? value : null;
}

function originOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return null;
  }
}

/**
 * Lage 1: Origin-/Referer-Prüfung gegen dieselbe Allowlist, die auch CORS
 * benutzt. Bewusst dieselbe Liste, damit es nicht zwei Wahrheiten gibt.
 */
export function checkOrigin(
  request: FastifyRequest,
  allowedOrigins: readonly string[],
): { ok: boolean; origin: string | null; present: boolean } {
  const origin = headerValue(request, "origin");
  const referer = headerValue(request, "referer");
  // "null" ist der Origin einer sandboxed iframe / eines data:-Dokuments und
  // gilt ausdrücklich NICHT als erlaubt.
  const candidate = origin && origin !== "null" ? origin : referer ? originOf(referer) : null;
  if (!candidate) return { ok: false, origin: origin, present: Boolean(origin) };
  return { ok: allowedOrigins.includes(candidate), origin: candidate, present: true };
}

export interface CsrfGuardOptions {
  secret: string;
  allowedOrigins: readonly string[];
  /** Der rohe Sitzungstoken aus dem Cookie (nicht der Hash). */
  sessionToken: string | null;
}

export function checkCsrf(request: FastifyRequest, options: CsrfGuardOptions): CsrfCheckResult {
  const origin = checkOrigin(request, options.allowedOrigins);
  const secFetchSite = headerValue(request, "sec-fetch-site");
  const headerToken = headerValue(request, CSRF_HEADER_NAME);
  const cookieToken = request.cookies[CSRF_COOKIE_NAME] ?? null;

  // --- Gegenbeweise zuerst: ein widersprechendes Signal schlägt jeden
  //     positiven Beweis. Ein Angreifer könnte sonst einen gültigen Beweis
  //     "dazulegen" und den Gegenbeweis überstimmen.
  if (origin.present && !origin.ok) {
    return { ok: false, reason: "origin_not_allowed", origin: origin.origin };
  }
  if (secFetchSite === "cross-site") {
    return { ok: false, reason: "cross_site_request", origin: origin.origin };
  }
  if (headerToken && cookieToken && headerToken !== cookieToken) {
    return { ok: false, reason: "token_cookie_mismatch", origin: origin.origin };
  }
  if (headerToken && options.sessionToken && !verifyCsrfToken(headerToken, options.sessionToken, options.secret)) {
    return { ok: false, reason: "token_mismatch", origin: origin.origin };
  }

  // --- Positive Beweise.
  if (origin.present && origin.ok) return { ok: true, proof: "origin", origin: origin.origin };
  if (secFetchSite === "same-origin" || secFetchSite === "same-site") {
    return { ok: true, proof: "sec_fetch_site", origin: origin.origin };
  }
  if (headerToken && cookieToken && options.sessionToken) {
    // Der HMAC wurde oben schon geprüft (sonst wären wir nicht hier).
    return { ok: true, proof: "token", origin: origin.origin };
  }

  // --- Kein Browsersignal: Nicht-Browser-Client. Siehe Modulkommentar.
  return { ok: true, proof: "kein_browsersignal", origin: origin.origin };
}

export function sendCsrfFailure(reply: FastifyReply, result: CsrfCheckResult): FastifyReply {
  return reply.code(403).send({
    error: "csrf_failed",
    reason: result.reason,
    hinweis:
      "Diese Anfrage wurde als möglicherweise fremdinitiiert abgewiesen (§17). Ein Browser-Client muss von einem erlaubten Origin kommen; ein Nicht-Browser-Client kann den Token aus GET /auth/csrf im Header " +
      CSRF_HEADER_NAME +
      " mitschicken.",
  });
}

/**
 * Setzt das CSRF-Cookie. NICHT httpOnly – das ist der Sinn eines
 * Double-Submit-Tokens: der eigene JS-Code muss ihn lesen können, um ihn in
 * den Header zu schreiben. Der Token allein ist wertlos, weil er ohne das
 * httpOnly-Sitzungscookie keine Sitzung öffnet.
 */
export function setCsrfCookie(reply: FastifyReply, token: string, secure: boolean): void {
  reply.setCookie(CSRF_COOKIE_NAME, token, {
    httpOnly: false,
    secure,
    sameSite: "lax",
    path: "/",
  });
}
