/**
 * Sandbox-Ziel: ein kontrolliertes, NICHT oeffentliches Veroeffentlichungsziel.
 *
 * Zweck: den kompletten Weg (Freigabe -> Warteschlange -> Zustellung ->
 * Zustellpruefung -> Kennzahlen -> Lernbericht) durchgehend testen zu koennen,
 * ohne dass etwas oeffentlich wird.
 *
 * Bewusste Ehrlichkeit an drei Stellen:
 *  - `isPublic = false`; Oberflaeche und Freigabekarte weisen das aus.
 *  - Kennzahlen tragen `source: 'sandbox'` und werden bei der Bewertung
 *    ausdruecklich als nicht aussagekraeftig gekennzeichnet. Sie sind
 *    deterministisch aus der Beitrags-ID abgeleitet, nicht zufaellig, und
 *    stellen keinerlei Erfolg dar.
 *  - Die abgelegte Datei liegt sichtbar im Dateisystem und kann geprueft werden.
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { PROJECT_ROOT } from '../config/env.js';
import { publishRelevantView } from '../domain/content.js';
import {
  PublishAdapter,
  PublishInput,
  PublishOutput,
  VerifyOutput,
  MetricsOutput,
} from './types.js';

const SANDBOX_DIR = resolve(PROJECT_ROOT, 'data', 'sandbox-posts');

export class SandboxAdapter implements PublishAdapter {
  readonly platform = 'sandbox';
  readonly isPublic = false;

  isConfigured(): boolean {
    return true;
  }

  async checkConnection() {
    if (!existsSync(SANDBOX_DIR)) mkdirSync(SANDBOX_DIR, { recursive: true });
    return {
      ok: true,
      detail:
        `Kontrolliertes Testziel unter ${SANDBOX_DIR}. Es wird nichts oeffentlich. ` +
        'Kennzahlen aus diesem Ziel sind ausdruecklich keine Leistungsdaten.',
      expiresAt: null,
    };
  }

  async publish(input: PublishInput): Promise<PublishOutput> {
    if (!existsSync(SANDBOX_DIR)) mkdirSync(SANDBOX_DIR, { recursive: true });
    const id = `sandbox_${input.idempotencyKey.slice(0, 24)}`;
    const file = join(SANDBOX_DIR, `${id}.json`);

    // Idempotenz auch hier: eine zweite Zustellung darf keine zweite Datei erzeugen.
    if (existsSync(file)) {
      const prior = JSON.parse(readFileSync(file, 'utf8'));
      return {
        externalPostId: prior.externalPostId,
        externalUrl: `file://${file}`,
        raw: { deduplicated: true },
      };
    }

    const record = {
      externalPostId: id,
      isPublic: false,
      deliveredAt: new Date().toISOString(),
      platform: 'sandbox',
      idempotencyKey: input.idempotencyKey,
      content: publishRelevantView(input.item),
      assets: input.assets.map((a) => ({ id: a.id, kind: a.kind, url: a.url })),
    };
    writeFileSync(file, JSON.stringify(record, null, 2), 'utf8');

    return { externalPostId: id, externalUrl: `file://${file}`, raw: { file } };
  }

  async verify(externalPostId: string): Promise<VerifyOutput> {
    const file = join(SANDBOX_DIR, `${externalPostId}.json`);
    if (!existsSync(file)) {
      return {
        exists: false,
        url: null,
        publishedAt: null,
        detail: 'Keine Sandbox-Ablage unter dieser ID gefunden.',
      };
    }
    const record = JSON.parse(readFileSync(file, 'utf8'));
    return {
      exists: true,
      url: `file://${file}`,
      publishedAt: record.deliveredAt,
      detail: 'Zustellung im kontrollierten Testziel bestaetigt (nicht oeffentlich).',
    };
  }

  /**
   * Deterministisch aus der ID abgeleitet - identische ID liefert identische
   * Werte. Kein Zufall, keine Erfolgssimulation. Die Werte existieren nur,
   * damit die Auswertungs- und Lernstrecke technisch durchlaufen kann.
   */
  async fetchMetrics(externalPostId: string): Promise<MetricsOutput> {
    const h = createHash('sha256').update(externalPostId).digest();
    const at = (i: number, max: number) => (h[i] / 255) * max;
    return {
      source: 'sandbox',
      metrics: {
        reach: Math.round(at(0, 400) + 50),
        impressions: Math.round(at(1, 600) + 60),
        likes: Math.round(at(2, 40)),
        comments: Math.round(at(3, 8)),
        saved: Math.round(at(4, 12)),
        shares: Math.round(at(5, 6)),
        profile_visits: Math.round(at(6, 20)),
        follower_reach: Math.round(at(7, 200)),
        non_follower_reach: Math.round(at(8, 200)),
        avg_watch_time_s: Math.round(at(9, 12) * 10) / 10,
      },
      missing: [],
    };
  }
}

export const SANDBOX_NOTE =
  'Sandbox-Kennzahlen sind deterministisch aus der Beitrags-ID abgeleitet und stellen ' +
  'keine Leistung dar. Sie dienen ausschliesslich dem technischen Durchlauf der Auswertungsstrecke.';
