/**
 * Posteingang (Kommentare und Direktnachrichten) und Lead-Pipeline.
 *
 * Datenschutz ist hier keine Fussnote:
 *  - Der Handle des Absenders wird nur als HMAC gespeichert. Damit lassen sich
 *    wiederkehrende Personen erkennen, ohne eine durchsuchbare Namensliste
 *    anzulegen.
 *  - Der Anzeigename wird nach Ablauf der Aufbewahrungsfrist geloescht,
 *    der Nachrichtentext ebenfalls. Die Lead-Kennzahlen bleiben anonym erhalten.
 *  - Es werden keine Rueckschluesse auf Gesundheit, Herkunft, finanzielle Lage
 *    oder aehnliche sensible Merkmale gezogen, auch wenn der Text sie nahelegt.
 *
 * Antworten werden entworfen, aber nie ohne Freigabe gesendet.
 */
import { all, get, run, nowIso } from '../db/index.js';
import { newId, signPayload } from '../security/crypto.js';
import { recordEvent } from '../observability/logger.js';
import { config } from '../config/env.js';

export type MessageClass =
  | 'general_question'
  | 'pricing_availability'
  | 'licence_class'
  | 'complaint'
  | 'urgent_safety'
  | 'spam'
  | 'partnership'
  | 'high_value_lead';

export interface InboxMessage {
  id: string;
  platform: string;
  account_id: string | null;
  external_id: string;
  thread_id: string | null;
  kind: 'comment' | 'dm' | 'mention';
  author_handle_hash: string;
  author_display: string | null;
  body: string;
  received_at: string;
  classification: MessageClass | null;
  confidence: number | null;
  lead_score: number | null;
  status: 'new' | 'triaged' | 'answered' | 'ignored' | 'escalated';
  content_item_id: string | null;
  redacted_at: string | null;
}

/**
 * Klassifikationsregeln. Reihenfolge ist bedeutsam: Sicherheit und
 * Beschwerden schlagen kommerzielle Einordnung, damit ein dringender Fall
 * nicht als "Preisanfrage" in der Warteschlange verschwindet.
 */
const CLASSIFIERS: { cls: MessageClass; weight: number; patterns: RegExp[] }[] = [
  {
    cls: 'urgent_safety',
    weight: 1.0,
    patterns: [/unfall/i, /verletz/i, /notfall/i, /gefaehrl|gefährl/i, /polizei/i, /ist etwas passiert/i],
  },
  {
    cls: 'complaint',
    weight: 0.95,
    patterns: [/beschwerd/i, /unzufrieden/i, /aergerlich|ärgerlich/i, /geld zurueck|geld zurück/i, /anwalt/i, /unfreundlich/i, /nie wieder/i],
  },
  {
    cls: 'partnership',
    weight: 0.85,
    patterns: [/kooperation/i, /zusammenarbeit/i, /partnerschaft/i, /werbung schalten/i, /influencer/i, /pressetermin/i],
  },
  {
    cls: 'spam',
    weight: 0.9,
    patterns: [/follow.?back/i, /gratis follower/i, /krypto/i, /investier/i, /whatsapp \+\d/i, /https?:\/\/bit\.ly/i, /\bseo\b.*\bangebot\b/i],
  },
  {
    cls: 'licence_class',
    weight: 0.8,
    patterns: [/\bklasse\s?[abcdelt]\w*/i, /\bbf\s?17\b/i, /\bb\s?196\b/i, /\bb\s?197\b/i, /motorrad/i, /lkw/i, /\bbus\b/i, /anhaenger|anhänger/i, /berufskraftfahrer/i, /\bbkf\b/i],
  },
  {
    cls: 'pricing_availability',
    weight: 0.8,
    patterns: [/was kostet/i, /preis/i, /kosten/i, /guenstig|günstig/i, /wann.*(frei|termin|platz)/i, /noch plaetze|noch plätze/i, /ab wann/i, /wie lange dauert/i],
  },
  {
    cls: 'general_question',
    weight: 0.4,
    patterns: [/\?/],
  },
];

/** Signale, die auf eine tatsaechlich bevorstehende Anmeldung hindeuten. */
const INTENT_SIGNALS: { re: RegExp; points: number; label: string }[] = [
  { re: /\banmeld|\banmelden|\bstarten\b|\banfangen\b/i, points: 30, label: 'Anmeldeabsicht genannt' },
  { re: /\bwann kann ich\b|\bnaechster kurs|\bnächster kurs|\btermin\b/i, points: 25, label: 'Nach Termin gefragt' },
  { re: /\bklasse\s?[abcdelt]\w*|\bbf\s?17\b|\bb\s?196\b/i, points: 20, label: 'Konkrete Fuehrerscheinklasse genannt' },
  { re: /\bfulda\b|\bbad hersfeld\b|\bhersfeld\b/i, points: 15, label: 'Standortbezug' },
  { re: /was kostet|preis|kosten/i, points: 15, label: 'Preisfrage - typisch kurz vor Entscheidung' },
  { re: /\bich\b.*\b(brauche|moechte|möchte|will)\b/i, points: 10, label: 'Persoenliche Absicht formuliert' },
];

export function classify(body: string): { classification: MessageClass; confidence: number; leadScore: number; signals: string[] } {
  let best: { cls: MessageClass; score: number } = { cls: 'general_question', score: 0.2 };
  for (const c of CLASSIFIERS) {
    const hits = c.patterns.filter((p) => p.test(body)).length;
    if (hits === 0) continue;
    const score = c.weight * Math.min(1, 0.6 + hits * 0.2);
    if (score > best.score) best = { cls: c.cls, score };
  }

  const signals: string[] = [];
  let leadScore = 0;
  for (const s of INTENT_SIGNALS) {
    if (s.re.test(body)) {
      leadScore += s.points;
      signals.push(s.label);
    }
  }
  leadScore = Math.min(100, leadScore);

  // Hoher Absichtswert + kommerzielle Einordnung = hochwertiger Lead.
  let classification = best.cls;
  if (leadScore >= 55 && ['pricing_availability', 'licence_class', 'general_question'].includes(best.cls)) {
    classification = 'high_value_lead';
  }
  if (classification === 'spam') leadScore = 0;

  return { classification, confidence: Math.round(best.score * 100) / 100, leadScore, signals };
}

export function ingestMessage(input: {
  platform: string;
  accountId?: string | null;
  externalId: string;
  threadId?: string | null;
  kind: 'comment' | 'dm' | 'mention';
  authorHandle: string;
  authorDisplay?: string | null;
  body: string;
  receivedAt?: string;
  contentItemId?: string | null;
  actor: string;
}): InboxMessage {
  const existing = get<InboxMessage>(
    'SELECT * FROM inbox_messages WHERE platform = ? AND external_id = ?',
    input.platform,
    input.externalId,
  );
  if (existing) return existing;

  const { classification, confidence, leadScore, signals } = classify(input.body);
  const id = newId('msg');

  run(
    `INSERT INTO inbox_messages
      (id, platform, account_id, external_id, thread_id, kind, author_handle_hash, author_display,
       body, received_at, classification, confidence, lead_score, status, content_item_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'new',?)`,
    id,
    input.platform,
    input.accountId ?? null,
    input.externalId,
    input.threadId ?? null,
    input.kind,
    signPayload(`handle:${input.platform}:${input.authorHandle.toLowerCase()}`),
    input.authorDisplay ?? null,
    input.body,
    input.receivedAt ?? nowIso(),
    classification,
    confidence,
    leadScore,
    input.contentItemId ?? null,
  );

  recordEvent({
    kind: 'inbox.message_received',
    actor: input.actor,
    entityType: 'inbox_message',
    entityId: id,
    severity: classification === 'urgent_safety' ? 'warn' : 'info',
    message: `Nachricht eingegangen (${input.kind}, ${classification}, Lead-Wert ${leadScore}).`,
    detail: { signals },
  });

  if (classification === 'urgent_safety' || classification === 'complaint') {
    run('UPDATE inbox_messages SET status = ? WHERE id = ?', 'escalated', id);
  }
  if (leadScore >= 40 && classification !== 'spam') {
    createLead(id, input.contentItemId ?? null, input.body, input.actor);
  }
  return get<InboxMessage>('SELECT * FROM inbox_messages WHERE id = ?', id)!;
}

/** Antwortbausteine je Kategorie. Sie nennen nie einen Preis und keinen Termin. */
const REPLY_TEMPLATES: Record<MessageClass, string> = {
  general_question:
    'Danke fuer deine Nachricht. Damit wir dir konkret antworten koennen: um welche Fuehrerscheinklasse geht es, und bist du eher in Fulda oder Bad Hersfeld unterwegs?',
  pricing_availability:
    'Danke fuer die Anfrage. Die Kosten haengen von der Klasse und der Zahl der Fahrstunden ab, deshalb nennen wir dir ungern eine Zahl ins Blaue. Schreib uns kurz deine Wunschklasse und deinen Standort, dann bekommst du von uns eine belastbare Aufstellung.',
  licence_class:
    'Danke fuer deine Nachricht. Die Klasse bilden wir in Fulda und Bad Hersfeld aus. Sag uns kurz, wann du starten moechtest, dann melden wir uns mit den naechsten Schritten.',
  complaint:
    'Danke, dass du dich meldest - das klingt nach etwas, das wir klaeren sollten. Schreib uns bitte kurz, worum es genau ging und wann. Wir sehen uns das an und melden uns persoenlich.',
  urgent_safety:
    'Danke fuer die Nachricht. Bitte melde dich direkt telefonisch bei uns, damit wir das sofort besprechen koennen.',
  spam: '',
  partnership:
    'Danke fuer das Interesse. Schreib uns bitte kurz, was genau du dir vorstellst und in welchem Zeitraum. Wir schauen es uns an.',
  high_value_lead:
    'Danke fuer deine Nachricht - das klingt so, als koenntest du zeitnah starten. Sag uns kurz deine Wunschklasse und ob Fulda oder Bad Hersfeld besser passt, dann halten wir dir einen Platz frei und schicken dir die naechsten Schritte.',
};

export function draftReply(messageId: string, actor: string): { id: string; body: string } {
  const msg = get<InboxMessage>('SELECT * FROM inbox_messages WHERE id = ?', messageId);
  if (!msg) throw new Error(`Nachricht ${messageId} nicht gefunden.`);
  if (msg.classification === 'spam') {
    throw new Error('Fuer Spam wird kein Antwortentwurf erzeugt.');
  }

  const body = REPLY_TEMPLATES[msg.classification ?? 'general_question'];
  const id = newId('rpl');
  run(
    `INSERT INTO reply_drafts (id, message_id, body, created_by_agent, state, created_at)
     VALUES (?,?,?,?,'awaiting_approval',?)`,
    id,
    messageId,
    body,
    'community_lead_analyst',
    nowIso(),
  );
  run('UPDATE inbox_messages SET status = ? WHERE id = ? AND status = ?', 'triaged', messageId, 'new');
  recordEvent({
    kind: 'inbox.reply_drafted',
    actor,
    entityType: 'inbox_message',
    entityId: messageId,
    message: 'Antwortentwurf erstellt. Wartet auf Freigabe - es wird nichts automatisch gesendet.',
  });
  return { id, body };
}

/**
 * Freigabe einer Antwort. Das Senden selbst ist bewusst nicht implementiert,
 * solange kein Konto mit Schreibrecht auf Kommentare/Nachrichten verbunden ist -
 * ein Adapter, der so tut als haette er gesendet, waere schlimmer als keiner.
 */
export function approveReply(replyId: string, userId: string, actor: string): void {
  const reply = get<any>('SELECT * FROM reply_drafts WHERE id = ?', replyId);
  if (!reply) throw new Error(`Antwortentwurf ${replyId} nicht gefunden.`);
  run(
    `UPDATE reply_drafts SET state = 'approved', approved_by = ?, approved_at = ? WHERE id = ?`,
    userId,
    nowIso(),
    replyId,
  );
  recordEvent({
    kind: 'inbox.reply_approved',
    actor,
    severity: 'warn',
    entityType: 'reply_draft',
    entityId: replyId,
    message:
      'Antwort freigegeben. Versand erfolgt erst, wenn ein Konto mit Schreibberechtigung auf ' +
      'Kommentare/Nachrichten verbunden ist; bis dahin bitte manuell senden.',
  });
}

export function listInbox(filter?: { status?: string; classification?: string; limit?: number }) {
  const clauses: string[] = ['1=1'];
  const params: any[] = [];
  if (filter?.status) {
    clauses.push('status = ?');
    params.push(filter.status);
  }
  if (filter?.classification) {
    clauses.push('classification = ?');
    params.push(filter.classification);
  }
  params.push(filter?.limit ?? 100);
  return all<InboxMessage>(
    `SELECT * FROM inbox_messages WHERE ${clauses.join(' AND ')} ORDER BY
       CASE classification WHEN 'urgent_safety' THEN 0 WHEN 'complaint' THEN 1
         WHEN 'high_value_lead' THEN 2 ELSE 3 END,
       received_at DESC LIMIT ?`,
    ...params,
  );
}

// ---------------------------------------------------------------------------
// Leads
// ---------------------------------------------------------------------------

export interface Lead {
  id: string;
  message_id: string | null;
  source_content_item_id: string | null;
  stage: 'new' | 'qualified' | 'appointment' | 'registered' | 'lost';
  licence_class: string | null;
  location: string | null;
  note: string | null;
  appointment_at: string | null;
  registered_at: string | null;
  revenue_cents: number | null;
  created_at: string;
  updated_at: string;
}

function extractLicenceClass(body: string): string | null {
  const m = body.match(/\bklasse\s?([abcdelt]\w*)/i) ?? body.match(/\b(bf\s?17|b\s?196|b\s?197)\b/i);
  return m ? m[1].toUpperCase().replace(/\s+/g, '') : null;
}

function extractLocation(body: string): string | null {
  if (/bad hersfeld|hersfeld/i.test(body)) return 'Bad Hersfeld';
  if (/fulda/i.test(body)) return 'Fulda';
  return null;
}

export function createLead(
  messageId: string | null,
  contentItemId: string | null,
  body: string,
  actor: string,
): Lead {
  const id = newId('led');
  run(
    `INSERT INTO leads
      (id, message_id, source_content_item_id, stage, licence_class, location, created_at, updated_at)
     VALUES (?,?,?,'new',?,?,?,?)`,
    id,
    messageId,
    contentItemId,
    extractLicenceClass(body),
    extractLocation(body),
    nowIso(),
    nowIso(),
  );
  recordEvent({
    kind: 'lead.created',
    actor,
    entityType: 'lead',
    entityId: id,
    message: 'Lead angelegt aus eingehender Nachricht.',
  });
  return get<Lead>('SELECT * FROM leads WHERE id = ?', id)!;
}

export function updateLead(
  id: string,
  patch: Partial<Pick<Lead, 'stage' | 'licence_class' | 'location' | 'note' | 'appointment_at' | 'registered_at' | 'revenue_cents'>>,
  actor: string,
): Lead {
  const fields = Object.entries(patch).filter(([, v]) => v !== undefined);
  if (fields.length === 0) return get<Lead>('SELECT * FROM leads WHERE id = ?', id)!;
  run(
    `UPDATE leads SET ${fields.map(([k]) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`,
    ...fields.map(([, v]) => v),
    nowIso(),
    id,
  );
  recordEvent({
    kind: 'lead.updated',
    actor,
    entityType: 'lead',
    entityId: id,
    message: `Lead aktualisiert: ${fields.map(([k]) => k).join(', ')}.`,
  });
  return get<Lead>('SELECT * FROM leads WHERE id = ?', id)!;
}

export function leadPipeline() {
  const stages = ['new', 'qualified', 'appointment', 'registered', 'lost'];
  const counts = all<{ stage: string; n: number; revenue: number }>(
    'SELECT stage, COUNT(*) AS n, SUM(COALESCE(revenue_cents,0)) AS revenue FROM leads GROUP BY stage',
  );
  const map = new Map(counts.map((c) => [c.stage, c]));
  return stages.map((s) => ({
    stage: s,
    count: Number(map.get(s)?.n ?? 0),
    revenueCents: Number(map.get(s)?.revenue ?? 0),
  }));
}

export function leadsBySource(limit = 50) {
  return all<any>(
    `SELECT c.id, c.title, c.platform,
            COUNT(l.id) AS leads,
            SUM(CASE WHEN l.stage = 'registered' THEN 1 ELSE 0 END) AS registrations,
            SUM(COALESCE(l.revenue_cents,0)) AS revenue_cents
     FROM leads l JOIN content_items c ON c.id = l.source_content_item_id
     GROUP BY c.id ORDER BY revenue_cents DESC, leads DESC LIMIT ?`,
    limit,
  );
}

/**
 * Datenminimierung: Nachrichtentexte und Anzeigenamen werden nach Ablauf der
 * Aufbewahrungsfrist entfernt. Die Kennzahlen bleiben anonym bestehen.
 */
export function applyRetention(actor = 'system:scheduler'): number {
  const cutoff = new Date(Date.now() - config.inboxRetentionDays * 86400_000).toISOString();
  const r = run(
    `UPDATE inbox_messages
     SET body = '[nach Aufbewahrungsfrist entfernt]', author_display = NULL, redacted_at = ?
     WHERE received_at < ? AND redacted_at IS NULL`,
    nowIso(),
    cutoff,
  );
  if (r.changes > 0) {
    recordEvent({
      kind: 'privacy.retention_applied',
      actor,
      message: `${r.changes} Nachricht(en) nach ${config.inboxRetentionDays} Tagen anonymisiert.`,
    });
  }
  return r.changes;
}
