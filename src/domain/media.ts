/**
 * Medienarchiv mit Rechte- und Einwilligungssteuerung.
 *
 * Zwei Ideen tragen dieses Modul:
 *
 * 1. `UNKNOWN` ist der Default. Die blosse Existenz einer Datei ist keine
 *    Einwilligung und kein Nutzungsrecht. Ein Asset wird erst
 *    veroeffentlichungsfaehig, wenn ein Mensch beides ausdruecklich gesetzt hat.
 *
 * 2. Suche ist erklaerbar, nicht magisch. Statt einer Blackbox interpretiert
 *    `parseMediaQuery` natuerlichsprachliche Anfragen in explizite
 *    Bedingungen (Themenbegriffe, Ausschluesse, Zeitfenster, Attribute) und
 *    kombiniert sie mit dem FTS5-Index. Jede Trefferliste kann begruendet
 *    werden. Der Anschluss eines Embedding-Modells ist in `rankResults`
 *    vorgesehen, aber nicht vorgetaeuscht.
 */
import { all, get, run, nowIso, parseJson, tx } from '../db/index.js';
import { newId } from '../security/crypto.js';
import { recordEvent } from '../observability/logger.js';

export type ConsentStatus =
  | 'UNKNOWN'
  | 'NOT_REQUIRED'
  | 'PENDING'
  | 'CLEARED'
  | 'REFUSED'
  | 'WITHDRAWN';

export type RightsStatus =
  | 'UNKNOWN'
  | 'OWNED'
  | 'LICENSED'
  | 'PLATFORM_AUTHORIZED'
  | 'RESTRICTED'
  | 'FORBIDDEN';

export interface MediaAsset {
  id: string;
  source: string;
  source_ref: string | null;
  kind: 'image' | 'video' | 'audio';
  url: string | null;
  local_path: string | null;
  mime: string | null;
  width: number | null;
  height: number | null;
  duration_s: number | null;
  orientation: string | null;
  capture_date: string | null;
  capture_location: string | null;
  quality_score: number;
  consent_status: ConsentStatus;
  rights_status: RightsStatus;
  licence: string | null;
  licence_expires_at: string | null;
  plate_visible: string;
  minors_present: string;
  faces_present: string;
  people_json: string;
  tags_json: string;
  search_text: string;
  restriction_notes: string | null;
  checksum: string | null;
  review_status: 'QUEUED' | 'IN_REVIEW' | 'APPROVED' | 'BLOCKED';
  indexed_at: string | null;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
  use_count: number;
}

export interface IngestInput {
  source: string;
  sourceRef?: string | null;
  kind: MediaAsset['kind'];
  url?: string | null;
  localPath?: string | null;
  mime?: string | null;
  width?: number | null;
  height?: number | null;
  durationS?: number | null;
  captureDate?: string | null;
  captureLocation?: string | null;
  tags?: string[];
  searchText?: string;
  qualityScore?: number;
  restrictionNotes?: string | null;
  actor: string;
}

function orientationOf(w?: number | null, h?: number | null): string | null {
  if (!w || !h) return null;
  if (Math.abs(w - h) / Math.max(w, h) < 0.05) return 'square';
  return w > h ? 'landscape' : 'portrait';
}

/**
 * Nimmt ein Asset auf. Rechte/Einwilligung bleiben UNKNOWN und der
 * Review-Status auf QUEUED - der Datenschutz-Reviewer muss zuerst ran.
 */
export function ingestAsset(input: IngestInput): MediaAsset {
  const now = nowIso();
  const id = newId('ast');
  const tags = input.tags ?? [];
  const searchText = [input.searchText ?? '', tags.join(' '), input.captureLocation ?? '']
    .join(' ')
    .trim();

  return tx(() => {
    const existing = input.sourceRef
      ? get<MediaAsset>(
          'SELECT * FROM media_assets WHERE source = ? AND source_ref = ?',
          input.source,
          input.sourceRef,
        )
      : undefined;
    if (existing) return existing;

    run(
      `INSERT INTO media_assets
        (id, source, source_ref, kind, url, local_path, mime, width, height, duration_s,
         orientation, capture_date, capture_location, quality_score, tags_json, search_text,
         restriction_notes, review_status, indexed_at, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'QUEUED',?,?,?)`,
      id,
      input.source,
      input.sourceRef ?? null,
      input.kind,
      input.url ?? null,
      input.localPath ?? null,
      input.mime ?? null,
      input.width ?? null,
      input.height ?? null,
      input.durationS ?? null,
      orientationOf(input.width, input.height),
      input.captureDate ?? null,
      input.captureLocation ?? null,
      input.qualityScore ?? 50,
      JSON.stringify(tags),
      searchText,
      input.restrictionNotes ?? null,
      now,
      now,
      now,
    );
    run('INSERT INTO media_fts (asset_id, search_text, tags) VALUES (?,?,?)', id, searchText, tags.join(' '));

    recordEvent({
      kind: 'media.ingested',
      actor: input.actor,
      entityType: 'media_asset',
      entityId: id,
      message: `Asset aufgenommen (${input.kind}, Quelle ${input.source}). Rechte und Einwilligung stehen auf UNKNOWN.`,
    });
    return get<MediaAsset>('SELECT * FROM media_assets WHERE id = ?', id)!;
  });
}

export function getAsset(id: string): MediaAsset | undefined {
  return get<MediaAsset>('SELECT * FROM media_assets WHERE id = ?', id);
}

// --- Automatische Datenschutzpruefung ---------------------------------------

export interface PrivacyFinding {
  code: string;
  message: string;
  blocking: boolean;
}

/**
 * Heuristische Vorpruefung. Sie ersetzt keine menschliche Sichtung, sondern
 * fuellt die Review-Warteschlange und begruendet, warum ein Asset dort liegt.
 * Sie darf niemals selbst eine Einwilligung setzen.
 */
export function autoPrivacyCheck(asset: MediaAsset): PrivacyFinding[] {
  const findings: PrivacyFinding[] = [];
  const haystack = `${asset.search_text} ${asset.tags_json} ${asset.restriction_notes ?? ''}`.toLowerCase();

  const peopleWords = ['person', 'schueler', 'schüler', 'fahrlehrer', 'gesicht', 'face', 'people', 'portrait', 'team', 'kunde'];
  if (peopleWords.some((w) => haystack.includes(w)) || asset.faces_present === 'YES') {
    findings.push({
      code: 'PRIVACY_FACES',
      message:
        'Hinweis auf abgebildete Personen. Einwilligung und Zweckbindung muessen dokumentiert vorliegen, bevor veroeffentlicht wird.',
      blocking: true,
    });
  }
  const minorWords = ['minderjaehrig', 'minderjährig', 'kind', 'jugendlich', '16 jahre', '17 jahre', 'bf17'];
  if (minorWords.some((w) => haystack.includes(w)) || asset.minors_present === 'YES') {
    findings.push({
      code: 'PRIVACY_MINORS',
      message:
        'Moeglicher Bezug zu Minderjaehrigen. Einwilligung der Erziehungsberechtigten erforderlich; im Zweifel nicht veroeffentlichen.',
      blocking: true,
    });
  }
  const plateWords = ['kennzeichen', 'nummernschild', 'licence plate', 'license plate', 'plate', 'fu-', 'hef-'];
  if (plateWords.some((w) => haystack.includes(w)) || asset.plate_visible === 'YES') {
    findings.push({
      code: 'PRIVACY_PLATE',
      message: 'Moeglicherweise lesbares Kennzeichen. Unkenntlich machen oder Freigabe dokumentieren.',
      blocking: true,
    });
  }
  const docWords = ['fuehrerschein', 'führerschein', 'ausweis', 'dokument', 'pruefungsbogen', 'prüfungsbogen', 'rechnung', 'vertrag'];
  if (docWords.some((w) => haystack.includes(w))) {
    findings.push({
      code: 'PRIVACY_DOCUMENT',
      message: 'Moeglicherweise personenbezogenes Dokument im Bild. Vor Verwendung pruefen und schwaerzen.',
      blocking: true,
    });
  }
  const unsafeWords = ['handy am steuer', 'ohne gurt', 'ueberholen', 'überholen', 'drift', 'rasen', 'burnout', 'wheelie'];
  if (unsafeWords.some((w) => haystack.includes(w))) {
    findings.push({
      code: 'SAFETY_DEPICTION',
      message:
        'Moegliche Darstellung unsicheren Fahrverhaltens. Fuer eine Fahrschule reputationskritisch - nur mit klarer Einordnung verwenden.',
      blocking: true,
    });
  }
  const musicWords = ['song', 'musik', 'track', 'audio ', 'soundtrack', 'radio'];
  if (asset.kind !== 'image' && musicWords.some((w) => haystack.includes(w))) {
    findings.push({
      code: 'RIGHTS_MUSIC',
      message:
        'Moegliche Hintergrundmusik. Lizenz oder plattformseitig autorisierte Audiobibliothek nachweisen.',
      blocking: false,
    });
  }
  if (asset.rights_status === 'UNKNOWN') {
    findings.push({
      code: 'RIGHTS_UNKNOWN',
      message: 'Nutzungsrechte sind nicht dokumentiert.',
      blocking: true,
    });
  }
  if (asset.consent_status === 'UNKNOWN') {
    findings.push({
      code: 'CONSENT_UNKNOWN',
      message:
        'Einwilligungsstatus ist nicht dokumentiert. Falls keine Personen erkennbar sind, ausdruecklich auf NOT_REQUIRED setzen.',
      blocking: true,
    });
  }
  return findings;
}

export function runPrivacyReview(assetId: string, actor: string): PrivacyFinding[] {
  const asset = getAsset(assetId);
  if (!asset) throw new Error(`Asset ${assetId} nicht gefunden.`);
  const findings = autoPrivacyCheck(asset);
  const blocking = findings.some((f) => f.blocking);

  run(
    'UPDATE media_assets SET review_status = ?, updated_at = ? WHERE id = ?',
    blocking ? 'IN_REVIEW' : 'APPROVED',
    nowIso(),
    assetId,
  );
  run(
    `INSERT INTO media_reviews (id, asset_id, reviewer_agent, decision, findings_json, note, at)
     VALUES (?,?,?,?,?,?,?)`,
    newId('mrv'),
    assetId,
    'privacy_consent_reviewer',
    blocking ? 'NEEDS_INFO' : 'APPROVED',
    JSON.stringify(findings),
    blocking
      ? 'Automatische Vorpruefung hat offene Punkte gefunden. Menschliche Sichtung erforderlich.'
      : 'Automatische Vorpruefung ohne blockierende Punkte.',
    nowIso(),
  );
  recordEvent({
    kind: 'media.privacy_reviewed',
    actor,
    entityType: 'media_asset',
    entityId: assetId,
    severity: blocking ? 'warn' : 'info',
    message: `Datenschutz-Vorpruefung: ${findings.length} Befund(e), ${blocking ? 'blockierend' : 'nicht blockierend'}.`,
    detail: { findings },
  });
  return findings;
}

export interface ClearanceInput {
  assetId: string;
  consent: ConsentStatus;
  rights: RightsStatus;
  licence?: string | null;
  licenceExpiresAt?: string | null;
  platesVisible?: 'UNKNOWN' | 'YES' | 'NO' | 'BLURRED';
  minorsPresent?: 'UNKNOWN' | 'YES' | 'NO';
  facesPresent?: 'UNKNOWN' | 'YES' | 'NO';
  people?: { name: string; consentRef: string }[];
  note?: string | null;
  actorUserId: string;
  actor: string;
}

/**
 * Nur ein Mensch setzt Rechte und Einwilligung. Diese Funktion ist der
 * einzige Weg dorthin und protokolliert jede Entscheidung.
 */
export function setClearance(input: ClearanceInput): MediaAsset {
  const asset = getAsset(input.assetId);
  if (!asset) throw new Error(`Asset ${input.assetId} nicht gefunden.`);

  return tx(() => {
    run(
      `UPDATE media_assets
       SET consent_status = ?, rights_status = ?, licence = ?, licence_expires_at = ?,
           plate_visible = COALESCE(?, plate_visible),
           minors_present = COALESCE(?, minors_present),
           faces_present = COALESCE(?, faces_present),
           people_json = COALESCE(?, people_json),
           restriction_notes = COALESCE(?, restriction_notes),
           review_status = ?, updated_at = ?
       WHERE id = ?`,
      input.consent,
      input.rights,
      input.licence ?? null,
      input.licenceExpiresAt ?? null,
      input.platesVisible ?? null,
      input.minorsPresent ?? null,
      input.facesPresent ?? null,
      input.people ? JSON.stringify(input.people) : null,
      input.note ?? null,
      isPublishable({ ...asset, consent_status: input.consent, rights_status: input.rights } as MediaAsset)
        ? 'APPROVED'
        : 'BLOCKED',
      nowIso(),
      input.assetId,
    );
    run(
      `INSERT INTO media_reviews (id, asset_id, reviewer_user_id, decision, findings_json, note, at)
       VALUES (?,?,?,?,?,?,?)`,
      newId('mrv'),
      input.assetId,
      input.actorUserId,
      input.consent === 'REFUSED' || input.consent === 'WITHDRAWN' || input.rights === 'FORBIDDEN'
        ? 'BLOCKED'
        : 'APPROVED',
      JSON.stringify([]),
      input.note ?? null,
      nowIso(),
    );
    recordEvent({
      kind: 'media.clearance.set',
      actor: input.actor,
      entityType: 'media_asset',
      entityId: input.assetId,
      message: `Rechteklaerung gesetzt: Einwilligung=${input.consent}, Rechte=${input.rights}`,
      detail: {
        previous: { consent: asset.consent_status, rights: asset.rights_status },
      },
    });
    return getAsset(input.assetId)!;
  });
}

/** Harte Gate-Funktion: darf dieses Asset veroeffentlicht werden? */
export function isPublishable(asset: MediaAsset, at: Date = new Date()): boolean {
  return publishBlockers(asset, at).length === 0;
}

export function publishBlockers(asset: MediaAsset, at: Date = new Date()): string[] {
  const blockers: string[] = [];
  if (!['NOT_REQUIRED', 'CLEARED'].includes(asset.consent_status)) {
    blockers.push(`Einwilligung nicht geklaert (Status ${asset.consent_status}).`);
  }
  if (!['OWNED', 'LICENSED', 'PLATFORM_AUTHORIZED'].includes(asset.rights_status)) {
    blockers.push(`Nutzungsrechte nicht geklaert (Status ${asset.rights_status}).`);
  }
  if (asset.licence_expires_at && new Date(asset.licence_expires_at) < at) {
    blockers.push(`Lizenz ist am ${asset.licence_expires_at} abgelaufen.`);
  }
  if (asset.plate_visible === 'YES') {
    blockers.push('Lesbares Kennzeichen sichtbar - unkenntlich machen erforderlich.');
  }
  if (asset.minors_present === 'YES' && asset.consent_status !== 'CLEARED') {
    blockers.push('Minderjaehrige abgebildet ohne dokumentierte Einwilligung.');
  }
  if (asset.review_status === 'BLOCKED') {
    blockers.push('Asset wurde in der Sichtung gesperrt.');
  }
  return blockers;
}

// --- Suche ------------------------------------------------------------------

export interface MediaQuery {
  terms: string[];
  exclude: string[];
  kind?: MediaAsset['kind'];
  orientation?: 'portrait' | 'landscape' | 'square';
  unusedForDays?: number;
  onlyPublishable: boolean;
  minQuality?: number;
  limit: number;
}

const KIND_WORDS: Record<string, MediaAsset['kind']> = {
  video: 'video',
  videos: 'video',
  clip: 'video',
  clips: 'video',
  aufnahme: 'video',
  aufnahmen: 'video',
  footage: 'video',
  bild: 'image',
  bilder: 'image',
  foto: 'image',
  fotos: 'image',
  image: 'image',
  photo: 'image',
  audio: 'audio',
  ton: 'audio',
};

const ORIENTATION_WORDS: Record<string, 'portrait' | 'landscape' | 'square'> = {
  hochkant: 'portrait',
  vertical: 'portrait',
  vertikal: 'portrait',
  portrait: 'portrait',
  quer: 'landscape',
  horizontal: 'landscape',
  landscape: 'landscape',
  quadratisch: 'square',
  square: 'square',
};

const STOPWORDS = new Set([
  'finde','find','suche','zeig','zeige','mir','ein','eine','einen','der','die','das','den','dem',
  'und','oder','mit','von','aus','fuer','für','bei','auf','in','im','am','the','a','an','of','for',
  'me','show','with','and','or','not','nicht','kein','keine','ohne','without','last','letzten',
  'tagen','days','benutzt','verwendet','used','material','materialien','clean','sauber',
]);

/**
 * Uebersetzt eine natuerlichsprachliche Anfrage in explizite Bedingungen.
 * Beispiele, die bewusst unterstuetzt werden:
 *   "finde authentisches LKW-Material bei Nacht"
 *   "Simulator-Aufnahmen, die in den letzten 60 Tagen nicht benutzt wurden"
 *   "saubere Fulda-Aussenaufnahme ohne Schueler"
 */
export function parseMediaQuery(raw: string, opts?: Partial<MediaQuery>): MediaQuery {
  const text = raw.toLowerCase().replace(/[",.!?]/g, ' ');
  const query: MediaQuery = {
    terms: [],
    exclude: [],
    onlyPublishable: opts?.onlyPublishable ?? true,
    limit: opts?.limit ?? 30,
    ...(opts ?? {}),
  } as MediaQuery;

  // "nicht in den letzten N Tagen" / "not used in the last N days"
  const unused = text.match(/(?:letzten|last)\s+(\d{1,3})\s*(?:tagen|tage|days)/);
  if (unused && (text.includes('nicht') || text.includes('not') || text.includes('ohne'))) {
    query.unusedForDays = Number.parseInt(unused[1], 10);
  }

  // Ausschluesse: "ohne X" / "without X" / "kein X"
  const excludeMatches = text.matchAll(/(?:ohne|without|kein[e]?)\s+([a-zaeoeueß-]+)/g);
  for (const m of excludeMatches) {
    if (!STOPWORDS.has(m[1])) query.exclude.push(m[1]);
  }

  const tokens = text.split(/[\s/]+/).filter(Boolean);
  for (const tok of tokens) {
    const clean = tok.replace(/[^a-z0-9aeoeueß-]/g, '');
    if (!clean || STOPWORDS.has(clean)) continue;
    if (query.exclude.includes(clean)) continue;
    if (KIND_WORDS[clean] && !query.kind) {
      query.kind = KIND_WORDS[clean];
      continue;
    }
    if (ORIENTATION_WORDS[clean] && !query.orientation) {
      query.orientation = ORIENTATION_WORDS[clean];
      continue;
    }
    if (clean.length >= 3) query.terms.push(clean);
  }
  // Bindestrich-Komposita zusaetzlich aufteilen ("lkw-material" -> "lkw","material")
  for (const t of [...query.terms]) {
    if (t.includes('-')) query.terms.push(...t.split('-').filter((p) => p.length >= 3));
  }
  query.terms = [...new Set(query.terms)];
  return query;
}

export interface SearchHit {
  asset: MediaAsset;
  score: number;
  reasons: string[];
  blockers: string[];
}

export function searchMedia(query: MediaQuery): SearchHit[] {
  const clauses: string[] = ['1=1'];
  const params: any[] = [];

  if (query.kind) {
    clauses.push('a.kind = ?');
    params.push(query.kind);
  }
  if (query.orientation) {
    clauses.push('a.orientation = ?');
    params.push(query.orientation);
  }
  if (query.minQuality !== undefined) {
    clauses.push('a.quality_score >= ?');
    params.push(query.minQuality);
  }
  if (query.unusedForDays !== undefined) {
    const cutoff = new Date(Date.now() - query.unusedForDays * 86400_000).toISOString();
    clauses.push('(a.last_used_at IS NULL OR a.last_used_at < ?)');
    params.push(cutoff);
  }
  if (query.onlyPublishable) {
    clauses.push(`a.consent_status IN ('NOT_REQUIRED','CLEARED')`);
    clauses.push(`a.rights_status IN ('OWNED','LICENSED','PLATFORM_AUTHORIZED')`);
    clauses.push(`a.review_status = 'APPROVED'`);
    clauses.push(`a.plate_visible <> 'YES'`);
    clauses.push(`(a.licence_expires_at IS NULL OR a.licence_expires_at > ?)`);
    params.push(nowIso());
  }

  const candidates = all<MediaAsset>(
    `SELECT a.* FROM media_assets a WHERE ${clauses.join(' AND ')} LIMIT 2000`,
    ...params,
  );

  return rankResults(candidates, query).slice(0, query.limit);
}

/**
 * Erklaerbares Ranking. Jeder Punktbeitrag wird als Begruendung mitgefuehrt,
 * damit im UI sichtbar ist, warum ein Asset vorgeschlagen wird.
 *
 * Erweiterungspunkt: Hier liesse sich eine Vektoraehnlichkeit ergaenzen.
 * Bewusst nicht behauptet, solange kein Embedding-Modell angebunden ist.
 */
function rankResults(assets: MediaAsset[], query: MediaQuery): SearchHit[] {
  const hits: SearchHit[] = [];
  for (const asset of assets) {
    const haystack = `${asset.search_text} ${asset.tags_json} ${asset.capture_location ?? ''}`.toLowerCase();
    const tags = parseJson<string[]>(asset.tags_json, []).map((t) => t.toLowerCase());

    if (query.exclude.some((x) => haystack.includes(x))) continue;

    let score = 0;
    const reasons: string[] = [];

    let matched = 0;
    for (const term of query.terms) {
      const inTag = tags.some((t) => t === term || t.includes(term));
      const inText = haystack.includes(term);
      if (inTag) {
        score += 12;
        matched++;
        reasons.push(`Tag-Treffer "${term}"`);
      } else if (inText) {
        score += 6;
        matched++;
        reasons.push(`Textreffer "${term}"`);
      }
    }
    if (query.terms.length > 0 && matched === 0) continue;
    if (query.terms.length > 0) {
      const coverage = matched / query.terms.length;
      score += coverage * 20;
      reasons.push(`${Math.round(coverage * 100)} % der Suchbegriffe abgedeckt`);
    }

    score += asset.quality_score * 0.15;
    if (asset.quality_score >= 75) reasons.push('Hohe Qualitaetsbewertung');

    // Frische Assets bevorzugen, aber Wiederverwendung nicht verbieten.
    if (!asset.last_used_at) {
      score += 8;
      reasons.push('Noch nie verwendet');
    } else {
      const daysSince = (Date.now() - new Date(asset.last_used_at).getTime()) / 86400_000;
      score += Math.min(daysSince / 10, 8);
      reasons.push(`Zuletzt vor ${Math.round(daysSince)} Tagen verwendet`);
    }
    score -= Math.min(asset.use_count * 2, 12);

    hits.push({ asset, score, reasons, blockers: publishBlockers(asset) });
  }
  return hits.sort((a, b) => b.score - a.score);
}

export function searchMediaNatural(raw: string, opts?: Partial<MediaQuery>): {
  query: MediaQuery;
  hits: SearchHit[];
} {
  const query = parseMediaQuery(raw, opts);
  return { query, hits: searchMedia(query) };
}

export function recordUsage(assetId: string, contentItemId: string): void {
  run(
    'INSERT INTO media_usage (id, asset_id, content_item_id, at) VALUES (?,?,?,?)',
    newId('mus'),
    assetId,
    contentItemId,
    nowIso(),
  );
  run(
    'UPDATE media_assets SET last_used_at = ?, use_count = use_count + 1, updated_at = ? WHERE id = ?',
    nowIso(),
    nowIso(),
    assetId,
  );
}

export function reviewQueue(): MediaAsset[] {
  return all<MediaAsset>(
    `SELECT * FROM media_assets
     WHERE review_status IN ('QUEUED','IN_REVIEW')
     ORDER BY created_at DESC`,
  );
}

export function updateTags(assetId: string, tags: string[], searchText: string, actor: string): void {
  const combined = [searchText, tags.join(' ')].join(' ').trim();
  run(
    'UPDATE media_assets SET tags_json = ?, search_text = ?, updated_at = ? WHERE id = ?',
    JSON.stringify(tags),
    combined,
    nowIso(),
    assetId,
  );
  run('DELETE FROM media_fts WHERE asset_id = ?', assetId);
  run(
    'INSERT INTO media_fts (asset_id, search_text, tags) VALUES (?,?,?)',
    assetId,
    combined,
    tags.join(' '),
  );
  recordEvent({
    kind: 'media.tags.updated',
    actor,
    entityType: 'media_asset',
    entityId: assetId,
    message: `Verschlagwortung aktualisiert (${tags.length} Tags).`,
  });
}
