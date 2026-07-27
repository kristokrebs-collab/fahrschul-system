/**
 * Vertrag fuer alle Veroeffentlichungsziele.
 *
 * Grundsaetze:
 *  - Es gibt keinen Adapter, der Erfolg vortaeuscht. Fehlen Zugangsdaten,
 *    wirft der Adapter einen `IntegrationError` mit `retryable=false` und
 *    einer Klartext-Ursache. Ein Job faellt dann sichtbar in den
 *    Fehlerzustand, statt still "erfolgreich" zu sein.
 *  - Der Sandbox-Adapter ist das einzige Ziel ohne echte Reichweite. Er ist
 *    ueber `isPublic=false` gekennzeichnet und wird in Oberflaeche,
 *    Audit-Log und Kennzahlen als nicht-oeffentlich gefuehrt.
 *  - Jeder Adapter muss `verify()` anbieten. Nach dem Absenden wird geprueft,
 *    ob der Beitrag beim Anbieter tatsaechlich existiert.
 */
import { ContentItem } from '../domain/content.js';
import { MediaAsset } from '../domain/media.js';

export type ErrorClass =
  | 'missing_credentials'
  | 'auth_expired'
  | 'rate_limited'
  | 'validation'
  | 'media_processing'
  | 'network'
  | 'provider_error'
  | 'unsupported';

export class IntegrationError extends Error {
  constructor(
    message: string,
    public readonly errorClass: ErrorClass,
    public readonly retryable: boolean,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'IntegrationError';
  }
}

export interface PublishInput {
  item: ContentItem;
  assets: MediaAsset[];
  /** Eindeutiger Schluessel des Jobs. Adapter geben ihn an den Anbieter weiter, wo moeglich. */
  idempotencyKey: string;
}

export interface PublishOutput {
  externalPostId: string;
  externalUrl: string | null;
  raw?: Record<string, unknown>;
}

export interface VerifyOutput {
  exists: boolean;
  url: string | null;
  publishedAt: string | null;
  detail: string;
}

export interface MetricsOutput {
  source: 'platform_api' | 'sandbox';
  metrics: Record<string, number>;
  missing: string[];
}

export interface PublishAdapter {
  readonly platform: string;
  /** false = kein oeffentliches Ziel (Sandbox). */
  readonly isPublic: boolean;
  /** Zugangsdaten vorhanden und formal plausibel? Keine Netzwerkanfrage. */
  isConfigured(): boolean;
  /** Echte Anfrage gegen den Anbieter, um Konto und Berechtigungen zu pruefen. */
  checkConnection(): Promise<{ ok: boolean; detail: string; expiresAt?: string | null }>;
  publish(input: PublishInput): Promise<PublishOutput>;
  verify(externalPostId: string): Promise<VerifyOutput>;
  fetchMetrics(externalPostId: string): Promise<MetricsOutput>;
}

/** Fehlerklassen, bei denen ein erneuter Versuch sinnvoll ist. */
export const RETRYABLE_CLASSES: ErrorClass[] = ['rate_limited', 'network', 'media_processing', 'provider_error'];

/** HTTP-Aufruf mit Zeitlimit und einheitlicher Fehlerklassifikation. */
export async function httpJson(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<any> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), init.timeoutMs ?? 30_000);
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    const e = err as Error;
    throw new IntegrationError(
      e.name === 'AbortError'
        ? `Zeitueberschreitung beim Aufruf von ${new URL(url).host}.`
        : `Netzwerkfehler beim Aufruf von ${new URL(url).host}: ${e.message}`,
      'network',
      true,
    );
  } finally {
    clearTimeout(timeout);
  }

  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text.slice(0, 500) };
  }

  if (!res.ok) {
    const providerMessage =
      body?.error?.message ?? body?.error?.error_description ?? body?.message ?? body?.raw ?? res.statusText;

    if (res.status === 401 || res.status === 403) {
      throw new IntegrationError(
        `Zugriff verweigert (${res.status}): ${providerMessage}. Token abgelaufen oder Berechtigung fehlt.`,
        'auth_expired',
        false,
      );
    }
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get('retry-after') ?? '60');
      throw new IntegrationError(
        `Ratenlimit erreicht: ${providerMessage}`,
        'rate_limited',
        true,
        Number.isNaN(retryAfter) ? 60 : retryAfter,
      );
    }
    if (res.status >= 500) {
      throw new IntegrationError(
        `Anbieterfehler ${res.status}: ${providerMessage}`,
        'provider_error',
        true,
      );
    }
    throw new IntegrationError(
      `Anfrage abgelehnt (${res.status}): ${providerMessage}`,
      'validation',
      false,
    );
  }
  return body;
}
