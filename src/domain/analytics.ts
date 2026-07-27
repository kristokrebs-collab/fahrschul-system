/**
 * Kennzahlenerfassung und die beiden getrennten Bewertungen.
 *
 * Der Auftrag verlangt ausdruecklich zwei Zahlen, nicht eine:
 *
 *   Virality Score  - Verbreitung: Reichweite, Bindung, Teilen, Speichern, Wachstum
 *   Business Impact - Geschaeft: qualifizierte Gespraeche, Termine, Anmeldungen, Umsatz
 *
 * Ein Beitrag mit 100.000 Aufrufen und null Anfragen bekommt hier einen hohen
 * Virality Score und einen Business Impact nahe null. Genau so soll es sein.
 * Es gibt bewusst keine Gesamtnote, die beide vermischt.
 *
 * Jede Bewertung traegt eine Konfidenz. Fehlen die Daten fuer die Haelfte der
 * Bestandteile, steht dort `low` und der Wert ist mit Vorsicht zu lesen.
 */
import { all, get, run, nowIso, parseJson } from '../db/index.js';
import { newId } from '../security/crypto.js';
import { recordEvent, log } from '../observability/logger.js';
import { getContentItem } from './content.js';
import { adapterFor } from '../integrations/registry.js';
import { SANDBOX_NOTE } from '../integrations/sandbox.js';

export type MetricWindow = 't2h' | 't24h' | 't72h' | 't7d' | 'manual';

export const WINDOW_OFFSETS_MS: Record<Exclude<MetricWindow, 'manual'>, number> = {
  t2h: 2 * 3600_000,
  t24h: 24 * 3600_000,
  t72h: 72 * 3600_000,
  t7d: 7 * 24 * 3600_000,
};

/**
 * Kanonische Kennzahlen. Die Plattformen benennen dasselbe unterschiedlich;
 * hier wird uebersetzt, damit Vergleiche ueberhaupt moeglich sind.
 */
export interface CanonicalMetrics {
  reach?: number;
  impressions?: number;
  followerReach?: number;
  nonFollowerReach?: number;
  avgWatchTimeS?: number;
  threeSecondViews?: number;
  completionRate?: number;
  replays?: number;
  likes?: number;
  comments?: number;
  saved?: number;
  shares?: number;
  profileVisits?: number;
  linkClicks?: number;
  dms?: number;
  follows?: number;
}

const ALIASES: Record<string, keyof CanonicalMetrics> = {
  reach: 'reach',
  impressions: 'impressions',
  post_impressions: 'impressions',
  post_impressions_unique: 'reach',
  plays: 'impressions',
  post_video_views: 'impressions',
  follower_reach: 'followerReach',
  non_follower_reach: 'nonFollowerReach',
  ig_reels_avg_watch_time: 'avgWatchTimeS',
  avg_watch_time_s: 'avgWatchTimeS',
  avg_watch_time: 'avgWatchTimeS',
  replays: 'replays',
  likes: 'likes',
  comments: 'comments',
  saved: 'saved',
  shares: 'shares',
  profile_visits: 'profileVisits',
  post_clicks: 'linkClicks',
  link_clicks: 'linkClicks',
  follows: 'follows',
  post_engaged_users: 'likes',
};

export function normalize(raw: Record<string, number>): CanonicalMetrics {
  const out: CanonicalMetrics = {};
  for (const [key, value] of Object.entries(raw)) {
    const canonical = ALIASES[key];
    if (canonical && typeof value === 'number' && Number.isFinite(value)) {
      // Bei mehreren Quellen fuer dieselbe Kennzahl den groesseren Wert nehmen
      // (Meta liefert reach teils doppelt unter verschiedenen Namen).
      out[canonical] = Math.max(out[canonical] ?? 0, value);
    }
  }
  if (out.impressions && out.reach && out.impressions >= out.reach) {
    out.replays = out.replays ?? out.impressions - out.reach;
  }
  return out;
}

export interface IngestResult {
  window: MetricWindow;
  source: string;
  metrics: CanonicalMetrics;
  missing: string[];
  note: string | null;
}

/** Holt die Kennzahlen beim Anbieter und legt einen Schnappschuss ab. */
export async function ingestMetrics(
  itemId: string,
  window: MetricWindow,
  actor: string,
): Promise<IngestResult> {
  const item = getContentItem(itemId);
  if (!item) throw new Error(`Content-Item ${itemId} nicht gefunden.`);

  const job = get<{ external_post_id: string | null; platform: string }>(
    `SELECT external_post_id, platform FROM publish_jobs
     WHERE content_item_id = ? AND state = 'succeeded' ORDER BY verified_at DESC LIMIT 1`,
    itemId,
  );
  if (!job?.external_post_id) {
    throw new Error(
      'Fuer diesen Beitrag gibt es keine bestaetigte Veroeffentlichung, daher auch keine Kennzahlen.',
    );
  }

  const adapter = adapterFor(job.platform);
  const result = await adapter.fetchMetrics(job.external_post_id);
  const metrics = normalize(result.metrics);

  run(
    `INSERT INTO metric_snapshots
      (id, content_item_id, platform, external_post_id, window_key, collected_at, source, metrics_json)
     VALUES (?,?,?,?,?,?,?,?)
     ON CONFLICT(content_item_id, window_key, source) DO UPDATE SET
       collected_at = excluded.collected_at, metrics_json = excluded.metrics_json`,
    newId('met'),
    itemId,
    job.platform,
    job.external_post_id,
    window,
    nowIso(),
    result.source,
    JSON.stringify({ canonical: metrics, raw: result.metrics, missing: result.missing }),
  );

  recordEvent({
    kind: 'analytics.ingested',
    actor,
    entityType: 'content_item',
    entityId: itemId,
    message: `Kennzahlen erfasst (${window}, Quelle ${result.source}). ${result.missing.length} Kennzahl(en) nicht verfuegbar.`,
    detail: { missing: result.missing },
  });

  computeAndStoreScores(itemId, window);

  return {
    window,
    source: result.source,
    metrics,
    missing: result.missing,
    note: result.source === 'sandbox' ? SANDBOX_NOTE : null,
  };
}

/** Manueller Import, wenn eine Plattform keine API-Kennzahlen liefert. */
export function importManualMetrics(
  itemId: string,
  metrics: Record<string, number>,
  actor: string,
): CanonicalMetrics {
  const item = getContentItem(itemId);
  if (!item) throw new Error(`Content-Item ${itemId} nicht gefunden.`);
  const canonical = normalize(metrics);
  run(
    `INSERT INTO metric_snapshots
      (id, content_item_id, platform, external_post_id, window_key, collected_at, source, metrics_json)
     VALUES (?,?,?,?,'manual',?,'manual_import',?)
     ON CONFLICT(content_item_id, window_key, source) DO UPDATE SET
       collected_at = excluded.collected_at, metrics_json = excluded.metrics_json`,
    newId('met'),
    itemId,
    item.platform,
    null,
    nowIso(),
    JSON.stringify({ canonical, raw: metrics, missing: [] }),
  );
  recordEvent({
    kind: 'analytics.manual_import',
    actor,
    entityType: 'content_item',
    entityId: itemId,
    message: `Kennzahlen manuell importiert (${Object.keys(metrics).length} Werte).`,
  });
  computeAndStoreScores(itemId, 'manual');
  return canonical;
}

export function latestMetrics(itemId: string): { window: MetricWindow; metrics: CanonicalMetrics; source: string } | null {
  const row = get<any>(
    `SELECT window_key, source, metrics_json FROM metric_snapshots
     WHERE content_item_id = ? ORDER BY collected_at DESC LIMIT 1`,
    itemId,
  );
  if (!row) return null;
  const parsed = parseJson<{ canonical: CanonicalMetrics }>(row.metrics_json, { canonical: {} });
  return { window: row.window_key, metrics: parsed.canonical, source: row.source };
}

// ---------------------------------------------------------------------------
// Bewertung
// ---------------------------------------------------------------------------

export interface ScoreComponent {
  key: string;
  label: string;
  value: number | null;
  normalized: number | null;
  weight: number;
  contribution: number;
  explanation: string;
}

export interface ScoreResult {
  score: number | null;
  confidence: 'none' | 'low' | 'medium' | 'high';
  components: ScoreComponent[];
  summary: string;
}

/** Saettigungskurve: der erste Anteil zaehlt stark, danach flacht es ab. */
function saturate(value: number, reference: number): number {
  if (reference <= 0) return 0;
  return Math.min(100, 100 * (1 - Math.exp(-value / reference)));
}

/**
 * Virality Score - misst ausschliesslich Verbreitung.
 * Bezugswerte sind fuer eine lokale Fahrschule kalibriert, nicht fuer einen
 * nationalen Account. Sie sind ueber `kv` anpassbar.
 */
export function viralityScore(m: CanonicalMetrics, followerBase: number): ScoreResult {
  const reach = m.reach ?? m.impressions ?? null;
  const nonFollower = m.nonFollowerReach ?? null;
  const saves = m.saved ?? null;
  const shares = m.shares ?? null;
  const watch = m.avgWatchTimeS ?? null;
  const follows = m.follows ?? null;

  const base = Math.max(followerBase, 200);

  const components: ScoreComponent[] = [
    {
      key: 'reach',
      label: 'Reichweite im Verhaeltnis zur Followerzahl',
      value: reach,
      normalized: reach === null ? null : saturate(reach, base),
      weight: 0.3,
      contribution: 0,
      explanation:
        reach === null
          ? 'Keine Reichweitendaten verfuegbar.'
          : `${reach} erreichte Konten bei ${base} Followern (Bezugsgroesse).`,
    },
    {
      key: 'nonFollowerShare',
      label: 'Anteil Nicht-Follower',
      value: nonFollower,
      normalized:
        nonFollower === null || !reach || reach === 0 ? null : Math.min(100, (nonFollower / reach) * 100 * 1.4),
      weight: 0.22,
      contribution: 0,
      explanation:
        nonFollower === null
          ? 'Aufteilung Follower/Nicht-Follower nicht verfuegbar.'
          : `${Math.round((nonFollower / (reach || 1)) * 100)} % der Reichweite kam von ausserhalb der Followerschaft.`,
    },
    {
      key: 'saves',
      label: 'Gespeichert',
      value: saves,
      normalized: saves === null ? null : saturate(saves, Math.max(base * 0.02, 5)),
      weight: 0.2,
      contribution: 0,
      explanation:
        saves === null
          ? 'Speicherungen nicht verfuegbar.'
          : `${saves} Speicherungen - das staerkste Signal fuer nuetzlichen Inhalt.`,
    },
    {
      key: 'shares',
      label: 'Geteilt',
      value: shares,
      normalized: shares === null ? null : saturate(shares, Math.max(base * 0.01, 3)),
      weight: 0.16,
      contribution: 0,
      explanation:
        shares === null ? 'Weiterleitungen nicht verfuegbar.' : `${shares} Weiterleitungen.`,
    },
    {
      key: 'watchTime',
      label: 'Durchschnittliche Wiedergabedauer',
      value: watch,
      normalized: watch === null ? null : Math.min(100, (watch / 15) * 100),
      weight: 0.07,
      contribution: 0,
      explanation:
        watch === null
          ? 'Wiedergabedauer nicht verfuegbar (nur bei Videoformaten).'
          : `${watch} Sekunden im Schnitt.`,
    },
    {
      key: 'follows',
      label: 'Neue Follower aus diesem Beitrag',
      value: follows,
      normalized: follows === null ? null : saturate(follows, Math.max(base * 0.005, 2)),
      weight: 0.05,
      contribution: 0,
      explanation: follows === null ? 'Follower-Zuwachs nicht verfuegbar.' : `${follows} neue Follower.`,
    },
  ];

  return finalize(components, 'Virality');
}

/**
 * Business Impact Score - misst ausschliesslich Geschaeftswirkung.
 * Fehlt die Umsatzangabe, weil der Inhaber sie nicht gepflegt hat, sinkt
 * die Konfidenz, nicht heimlich der Wert.
 */
export function businessImpactScore(
  m: CanonicalMetrics,
  leads: { qualified: number; appointments: number; registrations: number; revenueCents: number | null },
): ScoreResult {
  const dms = m.dms ?? null;
  const profileVisits = m.profileVisits ?? null;
  const linkClicks = m.linkClicks ?? null;
  const reach = m.reach ?? m.impressions ?? null;

  const components: ScoreComponent[] = [
    {
      key: 'qualifiedLeads',
      label: 'Qualifizierte Gespraeche',
      value: leads.qualified,
      normalized: saturate(leads.qualified, 3),
      weight: 0.3,
      contribution: 0,
      explanation: `${leads.qualified} Gespraech(e) mit erkennbarer Absicht, dieser Quelle zugeordnet.`,
    },
    {
      key: 'appointments',
      label: 'Vereinbarte Termine',
      value: leads.appointments,
      normalized: saturate(leads.appointments, 2),
      weight: 0.24,
      contribution: 0,
      explanation: `${leads.appointments} Termin(e) aus diesem Beitrag.`,
    },
    {
      key: 'registrations',
      label: 'Anmeldungen',
      value: leads.registrations,
      normalized: saturate(leads.registrations, 1.5),
      weight: 0.26,
      contribution: 0,
      explanation: `${leads.registrations} Anmeldung(en) - das eigentliche Ziel.`,
    },
    {
      key: 'revenue',
      label: 'Zurechenbarer Umsatz',
      value: leads.revenueCents,
      normalized:
        leads.revenueCents === null ? null : saturate(leads.revenueCents / 100, 1500),
      weight: 0.1,
      contribution: 0,
      explanation:
        leads.revenueCents === null
          ? 'Kein Umsatz hinterlegt. Der Inhaber muss den Wert nachtragen, damit dieser Anteil zaehlt.'
          : `${(leads.revenueCents / 100).toFixed(2)} EUR zugeordnet.`,
    },
    {
      key: 'intentSignals',
      label: 'Absichtssignale (Profilbesuche, Klicks, Nachrichten)',
      value: (profileVisits ?? 0) + (linkClicks ?? 0) + (dms ?? 0),
      normalized:
        profileVisits === null && linkClicks === null && dms === null
          ? null
          : saturate((profileVisits ?? 0) + (linkClicks ?? 0) * 2 + (dms ?? 0) * 4, 25),
      weight: 0.1,
      contribution: 0,
      explanation:
        profileVisits === null && linkClicks === null && dms === null
          ? 'Keine Absichtssignale verfuegbar.'
          : `${profileVisits ?? 0} Profilbesuche, ${linkClicks ?? 0} Klicks, ${dms ?? 0} Nachrichten.`,
    },
  ];

  const result = finalize(components, 'Business Impact');

  // Der Kernsatz aus dem Auftrag, hier als ausgegebene Bewertung.
  if (reach && reach > 1000 && leads.qualified === 0 && (result.score ?? 0) < 15) {
    result.summary +=
      ` Der Beitrag hatte mit ${reach} erreichten Konten spuerbare Reichweite, aber keine ` +
      'einzige qualifizierte Anfrage. Unterhaltsam, aber kein Akquiseerfolg.';
  }
  return result;
}

function finalize(components: ScoreComponent[], label: string): ScoreResult {
  let weightSum = 0;
  let scoreSum = 0;
  for (const c of components) {
    if (c.normalized === null) continue;
    c.contribution = Math.round(c.normalized * c.weight * 10) / 10;
    scoreSum += c.normalized * c.weight;
    weightSum += c.weight;
  }
  if (weightSum === 0) {
    return {
      score: null,
      confidence: 'none',
      components,
      summary: `${label}: keine Daten verfuegbar, daher keine Bewertung.`,
    };
  }
  // Auf die tatsaechlich vorhandenen Bestandteile normieren, damit fehlende
  // Daten den Wert nicht kuenstlich druecken - dafuer sinkt die Konfidenz.
  const score = Math.round((scoreSum / weightSum) * 10) / 10;
  const coverage = weightSum;
  const confidence: ScoreResult['confidence'] =
    coverage >= 0.85 ? 'high' : coverage >= 0.6 ? 'medium' : 'low';

  const missing = components.filter((c) => c.normalized === null).map((c) => c.label);
  return {
    score,
    confidence,
    components,
    summary:
      `${label}: ${score} von 100 (Konfidenz ${confidence}, ${Math.round(coverage * 100)} % der ` +
      `Bewertungsbestandteile mit Daten belegt).` +
      (missing.length ? ` Ohne Daten: ${missing.join(', ')}.` : ''),
  };
}

function followerBaseFor(platform: string): number {
  const row = get<{ value: string }>('SELECT value FROM kv WHERE key = ?', `follower_base:${platform}`);
  return row ? Number(row.value) || 500 : 500;
}

export function setFollowerBase(platform: string, count: number): void {
  run(
    `INSERT INTO kv (key, value, updated_at) VALUES (?,?,?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    `follower_base:${platform}`,
    String(count),
    nowIso(),
  );
}

function leadsFor(itemId: string) {
  const row = get<any>(
    `SELECT
       COUNT(*) AS qualified,
       SUM(CASE WHEN appointment_at IS NOT NULL THEN 1 ELSE 0 END) AS appointments,
       SUM(CASE WHEN registered_at IS NOT NULL THEN 1 ELSE 0 END) AS registrations,
       SUM(COALESCE(revenue_cents, 0)) AS revenue,
       SUM(CASE WHEN revenue_cents IS NOT NULL THEN 1 ELSE 0 END) AS with_revenue
     FROM leads WHERE source_content_item_id = ?`,
    itemId,
  );
  return {
    qualified: Number(row?.qualified ?? 0),
    appointments: Number(row?.appointments ?? 0),
    registrations: Number(row?.registrations ?? 0),
    revenueCents: Number(row?.with_revenue ?? 0) > 0 ? Number(row?.revenue ?? 0) : null,
  };
}

export interface StoredScores {
  virality: ScoreResult;
  business: ScoreResult;
  window: MetricWindow;
  note: string | null;
}

export function computeAndStoreScores(itemId: string, window: MetricWindow): StoredScores {
  const item = getContentItem(itemId);
  if (!item) throw new Error(`Content-Item ${itemId} nicht gefunden.`);

  const snap = get<any>(
    'SELECT metrics_json, source FROM metric_snapshots WHERE content_item_id = ? AND window_key = ? ORDER BY collected_at DESC LIMIT 1',
    itemId,
    window,
  );
  const metrics = snap
    ? parseJson<{ canonical: CanonicalMetrics }>(snap.metrics_json, { canonical: {} }).canonical
    : {};

  const virality = viralityScore(metrics, followerBaseFor(item.platform));
  const business = businessImpactScore(metrics, leadsFor(itemId));

  run(
    `INSERT INTO scores
      (id, content_item_id, window_key, virality_score, business_score,
       virality_confidence, business_confidence, explanation_json, computed_at)
     VALUES (?,?,?,?,?,?,?,?,?)
     ON CONFLICT(content_item_id, window_key) DO UPDATE SET
       virality_score = excluded.virality_score,
       business_score = excluded.business_score,
       virality_confidence = excluded.virality_confidence,
       business_confidence = excluded.business_confidence,
       explanation_json = excluded.explanation_json,
       computed_at = excluded.computed_at`,
    newId('scr'),
    itemId,
    window,
    virality.score,
    business.score,
    virality.confidence,
    business.confidence,
    JSON.stringify({ virality, business }),
    nowIso(),
  );

  return {
    virality,
    business,
    window,
    note: snap?.source === 'sandbox' ? SANDBOX_NOTE : null,
  };
}

export function getScores(itemId: string) {
  return all<any>(
    'SELECT * FROM scores WHERE content_item_id = ? ORDER BY computed_at DESC',
    itemId,
  ).map((r) => ({
    window: r.window_key,
    viralityScore: r.virality_score,
    businessScore: r.business_score,
    viralityConfidence: r.virality_confidence,
    businessConfidence: r.business_confidence,
    explanation: parseJson<any>(r.explanation_json, {}),
    computedAt: r.computed_at,
  }));
}

/**
 * Faellige Kennzahlenerfassungen. Ein Beitrag wird bei 2h, 24h, 72h und 7d
 * nach bestaetigter Veroeffentlichung abgefragt.
 */
export async function collectDueMetrics(actor = 'system:scheduler'): Promise<number> {
  const published = all<any>(
    `SELECT j.content_item_id, j.verified_at, j.platform
     FROM publish_jobs j
     WHERE j.state = 'succeeded' AND j.verified_at IS NOT NULL
       AND j.verified_at > ?`,
    new Date(Date.now() - 10 * 24 * 3600_000).toISOString(),
  );

  let collected = 0;
  for (const row of published) {
    const publishedAt = new Date(row.verified_at).getTime();
    for (const [window, offset] of Object.entries(WINDOW_OFFSETS_MS) as [
      Exclude<MetricWindow, 'manual'>,
      number,
    ][]) {
      if (Date.now() < publishedAt + offset) continue;
      const existing = get<{ id: string }>(
        'SELECT id FROM metric_snapshots WHERE content_item_id = ? AND window_key = ?',
        row.content_item_id,
        window,
      );
      if (existing) continue;
      try {
        await ingestMetrics(row.content_item_id, window, actor);
        collected++;
      } catch (err) {
        log.warn('Kennzahlenerfassung fehlgeschlagen.', {
          itemId: row.content_item_id,
          window,
          error: (err as Error).message,
        });
      }
    }
  }
  return collected;
}

/** Was hat bei welchem Format, Hook, Thema und Sendezeit funktioniert? */
export function performanceMemory(limit = 100) {
  return all<any>(
    `SELECT c.id, c.title, c.platform, c.format, c.scheduled_for, p.pillar, p.audience_segment,
            s.virality_score, s.business_score, s.window_key
     FROM content_items c
     LEFT JOIN plan_items p ON p.id = c.plan_item_id
     LEFT JOIN scores s ON s.content_item_id = c.id AND s.window_key = 't7d'
     WHERE c.state = 'published'
     ORDER BY c.updated_at DESC LIMIT ?`,
    limit,
  );
}
