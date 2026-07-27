/**
 * Die zwoelf Ansichten der Kommandozentrale.
 *
 * Jede Ansicht ist eine async-Funktion, die ein DOM-Fragment liefert.
 * Reihenfolge in jeder Ansicht: zuerst das, was eine Entscheidung verlangt,
 * danach der Kontext. Keine dekorativen Kacheln vor der eigentlichen Arbeit.
 */
import {
  h, frag, card, stat, badge, notice, empty, row, field, table,
  scoreBar, stateBadge, label, fmtDate, fmtRelative, fmtEur, toast, confirmDialog,
} from './ui.js';

let api;
let navigate;
export function bindViews(apiClient, navigateFn) {
  api = apiClient;
  navigate = navigateFn;
}

const asArray = (x) => (Array.isArray(x) ? x : []);

/* ========================================================================
   1. Heute
   ===================================================================== */
export async function todayView() {
  const data = await api.get('/api/today');
  const n = data.needsAttention;

  const attention = [];
  if (n.approvalsWaiting > 0) {
    attention.push(stat(n.approvalsWaiting, 'warten auf Freigabe', 'Nichts geht ohne dich raus', true));
  }
  if (n.approvalsBlocked > 0) attention.push(stat(n.approvalsBlocked, 'blockiert', 'Pruefung nicht bestanden', true));
  if (n.deadLetterJobs > 0) attention.push(stat(n.deadLetterJobs, 'Zustellung gescheitert', 'Manuell pruefen', true));
  if (n.mediaAwaitingClearance > 0) attention.push(stat(n.mediaAwaitingClearance, 'Medien ungeklaert', 'Rechte + Einwilligung', true));
  if (n.newMessages > 0) attention.push(stat(n.newMessages, 'neue Nachrichten', 'Im Posteingang', true));
  if (n.unverifiedFacts > 0) attention.push(stat(n.unverifiedFacts, 'unbestaetigte Fakten', 'Nicht verwendbar', false));
  if (n.openAlerts > 0) attention.push(stat(n.openAlerts, 'offene Alarme', 'Systemzustand', true));

  return frag(
    h('h1', {}, 'Heute'),
    data.llmMode !== 'anthropic'
      ? notice(
          'Die generativen Agenten laufen im deterministischen Modus: es sind keine LLM-Zugangsdaten ' +
            'hinterlegt. Entwuerfe werden aus der Markendatenbank komponiert statt frei formuliert. ' +
            'Die pruefenden Agenten sind davon nicht betroffen - sie sind ohnehin Regelwerke.',
          'warn',
        )
      : null,

    attention.length
      ? card('Braucht deine Aufmerksamkeit', null, h('div', { class: 'grid three' }, ...attention))
      : notice('Nichts Offenes. Warteschlange, Freigaben und Medienarchiv sind aktuell.', 'ok'),

    asArray(data.alerts).length
      ? card(
          'Alarme',
          `${data.alerts.length} offen`,
          h(
            'div',
            { class: 'list' },
            ...data.alerts.slice(0, 6).map((a) =>
              row(a.message, `${a.code} · ${fmtDate(a.at)}`, [
                badge(a.severity, a.severity === 'critical' ? 'danger' : a.severity === 'error' ? 'danger' : 'warn'),
                h('button', {
                  class: 'sm ghost',
                  onClick: async () => {
                    await api.post(`/api/alerts/${a.id}/ack`);
                    toast('Alarm quittiert.', 'ok');
                    navigate('today');
                  },
                }, 'Quittieren'),
              ]),
            ),
          ),
        )
      : null,

    card(
      'Freigabe-Warteschlange',
      `${data.approvals.length} von ${n.approvalsWaiting}`,
      data.approvals.length
        ? h(
            'div',
            { class: 'list' },
            ...data.approvals.map((c) =>
              row(
                c.item.title,
                `${c.platform} · ${c.item.format} · ${c.publishAt ? fmtDate(c.publishAt) : 'ohne Termin'}`,
                [
                  c.canApprove ? badge('bereit', 'ok') : badge(`${c.blockingReasons.length} blockiert`, 'danger'),
                  !c.accountIsPublic ? badge('Testziel', 'info') : null,
                ],
                () => navigate('approvals', { id: c.item.id }),
              ),
            ),
          )
        : empty('Keine Beitraege warten auf Freigabe.'),
    ),

    card(
      'Als naechstes geplant',
      null,
      asArray(data.upcoming).length
        ? h(
            'div',
            { class: 'list' },
            ...data.upcoming.map((u) =>
              row(u.title, `${u.platform} · ${u.format} · ${fmtDate(u.scheduled_for)} (${fmtRelative(u.scheduled_for)})`,
                stateBadge(u.state),
                () => navigate('production', { id: u.id })),
            ),
          )
        : empty('Nichts eingeplant.'),
    ),

    card(
      'Warteschlange',
      null,
      h(
        'div',
        { class: 'grid three' },
        stat(data.queue.queued, 'wartend'),
        stat(data.queue.succeeded, 'erfolgreich'),
        stat(data.queue.dead_letter, 'gescheitert', null, data.queue.dead_letter > 0),
      ),
    ),
  );
}

/* ========================================================================
   2. Ideen
   ===================================================================== */
export async function ideasView() {
  const items = await api.get('/api/opportunities');

  const research = h('button', {
    class: 'primary',
    onClick: async (e) => {
      e.target.disabled = true;
      e.target.textContent = 'Recherche laeuft …';
      try {
        const r = await api.post('/api/opportunities/research', { limit: 10 });
        toast(`${r.created} neue Chancen (${r.mode}).`, 'ok');
        navigate('ideas');
      } catch (err) {
        toast(err.message, 'danger');
        e.target.disabled = false;
        e.target.textContent = 'Themen recherchieren';
      }
    },
  }, 'Themen recherchieren');

  const kindLabels = {
    durable_brand_topic: 'Dauerthema',
    local_opportunity: 'Lokale Gelegenheit',
    platform_trend: 'Plattformformat',
    short_lived_trend: 'Kurzlebiger Trend',
    regulatory_topic: 'Regulatorisch',
  };

  return frag(
    h('h1', {}, 'Ideen'),
    h('div', { class: 'btn-row', style: { marginBottom: '.85rem' } }, research),
    notice(
      'Bewertet auf zehn Dimensionen. Aufwand, Rechte- und Reputationsrisiko werden abgezogen; ' +
        'die erwartete Anfragewirkung wiegt am schwersten.',
      'info',
    ),
    items.length
      ? h(
          'div',
          { class: 'list' },
          ...items.map((o) =>
            h(
              'div',
              { class: 'row' },
              h(
                'div',
                { class: 'row-main' },
                h('div', { class: 'row-title' }, o.title),
                h('div', { class: 'row-meta' }, o.summary),
                h(
                  'div',
                  { class: 'row-meta', style: { marginTop: '.3rem' } },
                  ...Object.entries(o.scores || {}).slice(0, 6).map(([k, v]) => badge(`${k}: ${v}`)),
                ),
                o.requires_verification
                  ? h('div', { class: 'row-meta' }, badge('Faktenpruefung noetig', 'warn'))
                  : null,
              ),
              h(
                'div',
                { class: 'row-side' },
                badge(String(o.total_score), 'crimson'),
                badge(kindLabels[o.kind] ?? o.kind),
                badge(label(o.status)),
              ),
            ),
          ),
        )
      : empty('Noch keine Themenchancen erfasst.'),
  );
}

/* ========================================================================
   3. Kalender / Plan
   ===================================================================== */
export async function calendarView() {
  const data = await api.get('/api/plan');
  const items = asArray(data.items);

  const generate = h('button', {
    class: 'primary',
    onClick: async (e) => {
      e.target.disabled = true;
      try {
        const r = await api.post('/api/plan/generate', { count: 7 });
        toast(`${r.created} Planpositionen erstellt.`, 'ok');
        navigate('calendar');
      } catch (err) {
        toast(err.message, 'danger');
        e.target.disabled = false;
      }
    },
  }, 'Wochenplan erzeugen');

  const byDay = new Map();
  for (const it of items) {
    const day = (it.proposed_publish_at || '').slice(0, 10);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(it);
  }

  const saturation = data.saturation || {};
  const targets = asArray(data.pillarTargets);

  return frag(
    h('h1', {}, 'Kalender'),
    h('div', { class: 'btn-row', style: { marginBottom: '.85rem' } }, generate),

    card(
      'Themensaettigung',
      'Ist-Anteil gegen Zielanteil der letzten 30 Tage',
      targets.length
        ? table(
            [{ label: 'Saeule' }, { label: 'Ziel', num: true }, { label: 'Ist', num: true }, { label: 'Abweichung', num: true }],
            targets.map((t) => {
              const actual = saturation[t.key] ?? 0;
              const delta = actual - t.target;
              return [
                t.name,
                `${Math.round(t.target * 100)} %`,
                `${Math.round(actual * 100)} %`,
                h('span', { class: Math.abs(delta) > 0.12 ? 'badge warn' : 'badge ok' },
                  `${delta > 0 ? '+' : ''}${Math.round(delta * 100)} %`),
              ];
            }),
          )
        : empty('Keine Saeulen definiert.'),
    ),

    ...[...byDay.entries()].map(([day, dayItems]) =>
      card(
        day ? new Date(day).toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: 'long' }) : 'Ohne Termin',
        `${dayItems.length} Position(en)`,
        h(
          'div',
          { class: 'list' },
          ...dayItems.map((it) =>
            row(
              it.hook,
              `${it.platform} · ${it.format} · ${it.pillar} · ${it.audience_segment} · ${fmtDate(it.proposed_publish_at)}`,
              [
                badge(label(it.status)),
                it.status === 'planned'
                  ? h('button', {
                      class: 'sm primary',
                      onClick: async (e) => {
                        e.stopPropagation();
                        e.target.disabled = true;
                        e.target.textContent = 'Produziere …';
                        try {
                          const r = await api.post(`/api/plan/${it.id}/produce`, {});
                          toast(
                            r.review.passed
                              ? 'Produziert und geprueft. Wartet auf Freigabe.'
                              : `Produziert, aber ${r.review.blocking.length} blockierende Befunde.`,
                            r.review.passed ? 'ok' : 'danger',
                          );
                          navigate('production', { id: r.itemId });
                        } catch (err) {
                          toast(err.message, 'danger');
                          e.target.disabled = false;
                          e.target.textContent = 'Produzieren';
                        }
                      },
                    }, 'Produzieren')
                  : null,
              ],
            ),
          ),
        ),
      ),
    ),
    items.length === 0 ? empty('Kein Plan vorhanden. Erzeuge einen Wochenplan.') : null,
  );
}

/* ========================================================================
   4. Medienarchiv
   ===================================================================== */
export async function mediaView(params = {}) {
  const q = params.q ?? '';
  const onlyPublishable = params.all !== '1';

  const input = h('input', {
    type: 'search',
    value: q,
    placeholder: 'z. B. "authentisches LKW-Material bei Nacht, nicht in den letzten 60 Tagen benutzt"',
  });
  const runSearch = () => navigate('media', { q: input.value, all: onlyPublishable ? '1' : '0' });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') navigate('media', { q: input.value, all: params.all ?? '0' });
  });

  const [result, queue] = await Promise.all([
    api.get(`/api/media/search?q=${encodeURIComponent(q)}&onlyPublishable=${onlyPublishable}&limit=40`),
    api.get('/api/media/queue'),
  ]);

  const clearanceForm = (asset) => {
    const consent = h('select', {}, ...['NOT_REQUIRED', 'CLEARED', 'PENDING', 'REFUSED', 'WITHDRAWN', 'UNKNOWN']
      .map((v) => h('option', { value: v, selected: v === asset.consent }, label(v))));
    const rights = h('select', {}, ...['OWNED', 'LICENSED', 'PLATFORM_AUTHORIZED', 'RESTRICTED', 'FORBIDDEN', 'UNKNOWN']
      .map((v) => h('option', { value: v, selected: v === asset.rights }, label(v))));
    const plates = h('select', {}, ...['NO', 'BLURRED', 'YES', 'UNKNOWN']
      .map((v) => h('option', { value: v }, label(v))));
    const minors = h('select', {}, ...['NO', 'YES', 'UNKNOWN'].map((v) => h('option', { value: v }, label(v))));
    const note = h('input', { type: 'text', placeholder: 'Woher stammt die Einwilligung?' });

    return h(
      'div',
      { style: { marginTop: '.5rem' } },
      field('Einwilligung', consent),
      field('Nutzungsrechte', rights),
      field('Kennzeichen sichtbar', plates),
      field('Minderjaehrige abgebildet', minors),
      field('Nachweis / Notiz', note),
      h('button', {
        class: 'primary sm',
        onClick: async (e) => {
          e.target.disabled = true;
          try {
            const r = await api.post(`/api/media/${asset.id}/clearance`, {
              consent: consent.value,
              rights: rights.value,
              platesVisible: plates.value,
              minorsPresent: minors.value,
              note: note.value || null,
            });
            toast(
              r.blockers.length === 0
                ? 'Asset ist jetzt veroeffentlichungsfaehig.'
                : `Weiterhin gesperrt: ${r.blockers.join(' | ')}`,
              r.blockers.length === 0 ? 'ok' : 'danger',
            );
            navigate('media', params);
          } catch (err) {
            toast(err.message, 'danger');
            e.target.disabled = false;
          }
        },
      }, 'Rechte setzen'),
    );
  };

  return frag(
    h('h1', {}, 'Medienarchiv'),
    card(
      'Suche',
      `${result.results.length} Treffer`,
      input,
      h('div', { class: 'btn-row', style: { marginTop: '.5rem' } },
        h('button', { class: 'primary sm', onClick: runSearch }, 'Suchen'),
        h('button', {
          class: 'sm ghost',
          onClick: () => navigate('media', { q: input.value, all: onlyPublishable ? '1' : '0' }),
        }, onlyPublishable ? 'Auch gesperrte zeigen' : 'Nur freigegebene zeigen'),
      ),
      result.interpretedQuery
        ? h('div', { class: 'field-hint', style: { marginTop: '.4rem' } },
            `So verstanden: Begriffe [${result.interpretedQuery.terms.join(', ') || '-'}]` +
            (result.interpretedQuery.exclude.length ? ` · ohne [${result.interpretedQuery.exclude.join(', ')}]` : '') +
            (result.interpretedQuery.kind ? ` · Typ ${result.interpretedQuery.kind}` : '') +
            (result.interpretedQuery.orientation ? ` · ${result.interpretedQuery.orientation}` : '') +
            (result.interpretedQuery.unusedForDays ? ` · seit ${result.interpretedQuery.unusedForDays} Tagen unbenutzt` : ''))
        : null,
    ),

    queue.length
      ? card(
          'Wartet auf Rechteklaerung',
          `${queue.length} Asset(s)`,
          notice(
            'Die blosse Existenz einer Datei ist keine Einwilligung. Solange hier nichts gesetzt ist, ' +
              'kann kein Beitrag mit diesem Material veroeffentlicht werden.',
            'warn',
          ),
          h(
            'div',
            { class: 'list' },
            ...queue.slice(0, 12).map((a) =>
              h(
                'div',
                { class: 'row', style: { flexDirection: 'column', alignItems: 'stretch' } },
                h(
                  'div',
                  { style: { display: 'flex', gap: '.6rem' } },
                  a.url && a.kind === 'image'
                    ? h('div', { class: 'media-thumb blocked', style: { backgroundImage: `url("${a.url}")` } },
                        h('span', { class: 'kind' }, a.kind))
                    : h('div', { class: 'media-thumb blocked' }, h('span', { class: 'kind' }, a.kind)),
                  h('div', { class: 'row-main' },
                    h('div', { class: 'row-title' }, a.tags.slice(0, 5).join(', ') || a.id),
                    h('div', { class: 'row-meta' }, a.blockers.join(' | ')),
                    h('div', { class: 'row-meta' },
                      stateBadge(a.consent), ' ', stateBadge(a.rights), ' ', stateBadge(a.reviewStatus)),
                  ),
                ),
                clearanceForm(a),
              ),
            ),
          ),
        )
      : null,

    card(
      'Treffer',
      null,
      result.results.length
        ? h(
            'div',
            { class: 'list' },
            ...result.results.map((r) =>
              h(
                'div',
                { class: 'row' },
                r.url && r.kind === 'image'
                  ? h('div', { class: `media-thumb${r.blockers.length ? ' blocked' : ''}`, style: { backgroundImage: `url("${r.url}")` } },
                      h('span', { class: 'kind' }, r.kind))
                  : h('div', { class: `media-thumb${r.blockers.length ? ' blocked' : ''}` }, h('span', { class: 'kind' }, r.kind)),
                h(
                  'div',
                  { class: 'row-main' },
                  h('div', { class: 'row-title' }, r.tags.slice(0, 6).join(', ') || r.id),
                  h('div', { class: 'row-meta' }, `Bewertung ${r.score} · ${r.reasons.slice(0, 3).join(' · ')}`),
                  h('div', { class: 'row-meta' }, `Verwendet: ${r.useCount}× · zuletzt ${r.lastUsedAt ? fmtRelative(r.lastUsedAt) : 'nie'}`),
                  r.blockers.length ? h('div', { class: 'row-meta' }, badge(r.blockers[0], 'danger')) : null,
                ),
                h('div', { class: 'row-side' }, stateBadge(r.consent), stateBadge(r.rights)),
              ),
            ),
          )
        : empty(q ? 'Keine Treffer.' : 'Suchbegriff eingeben.'),
    ),
  );
}

/* ========================================================================
   5. Produktion
   ===================================================================== */
export async function productionView(params = {}) {
  if (params.id) return contentDetail(params.id);
  const items = await api.get('/api/content?limit=60');
  return frag(
    h('h1', {}, 'Produktion'),
    items.length
      ? h(
          'div',
          { class: 'list' },
          ...items.map((it) =>
            row(
              it.title,
              `${it.platform} · ${it.format} · v${it.version} · ${fmtDate(it.updated_at)}`,
              stateBadge(it.state),
              () => navigate('production', { id: it.id }),
            ),
          ),
        )
      : empty('Noch keine Beitraege produziert.'),
  );
}

async function contentDetail(id) {
  const d = await api.get(`/api/content/${id}`);
  const p = d.preview;

  const editable = ['caption', 'cta', 'altText', 'script'];
  const inputs = {};
  const editForm = h(
    'div',
    {},
    ...editable.map((key) => {
      const value = key === 'altText' ? p.altText : p[key] ?? '';
      const el = key === 'caption' || key === 'script'
        ? h('textarea', {}, value)
        : h('input', { type: 'text', value });
      inputs[key] = el;
      return field(
        { caption: 'Begleittext', cta: 'Handlungsaufruf', altText: 'Alternativtext', script: 'Skript' }[key],
        el,
      );
    }),
    h('button', {
      class: 'primary sm',
      onClick: async (e) => {
        e.target.disabled = true;
        try {
          const patch = {};
          for (const k of editable) patch[k] = inputs[k].value;
          const r = await api.patch(`/api/content/${id}`, { patch, changeSummary: 'Manuelle Bearbeitung' });
          toast(
            r.approvalInvalidated
              ? 'Gespeichert. Die bestehende Freigabe wurde dadurch entwertet - erneute Freigabe erforderlich.'
              : 'Gespeichert.',
            r.approvalInvalidated ? 'danger' : 'ok',
          );
          navigate('production', { id });
        } catch (err) {
          toast(err.message, 'danger');
          e.target.disabled = false;
        }
      },
    }, 'Speichern'),
  );

  const scores = asArray(d.scores);

  return frag(
    h('div', { class: 'btn-row', style: { marginBottom: '.6rem' } },
      h('button', { class: 'sm ghost', onClick: () => navigate('production') }, '← Uebersicht')),
    h('h1', {}, d.item.title),
    h('div', { class: 'btn-row', style: { marginBottom: '.85rem' } },
      stateBadge(d.item.state), badge(d.item.platform), badge(d.item.format), badge(`v${d.item.version}`)),

    asArray(d.findings).length
      ? card(
          'Pruefbefunde',
          `${d.findings.filter((f) => f.blocking).length} blockierend`,
          h('div', { class: 'list' },
            ...d.findings.map((f) =>
              row(f.message, `${f.agent} · ${f.code}`, badge(f.blocking ? 'blockierend' : f.severity, f.blocking ? 'danger' : f.severity === 'warn' ? 'warn' : '')),
            )),
        )
      : notice('Keine offenen Pruefbefunde.', 'ok'),

    card('Bearbeiten', 'Jede Aenderung erzeugt eine neue Version', editForm),

    card(
      'Vorschau',
      null,
      h('div', { class: 'approval-preview' },
        h('div', { class: 'approval-caption' }, p.caption || '(kein Text)'),
        h('div', { class: 'row-meta', style: { marginTop: '.5rem' } }, asArray(p.hashtags).join(' ')),
      ),
      h('div', { class: 'small muted' }, `Alternativtext: ${p.altText || '(fehlt)'}`),
      h('div', { class: 'small muted' }, `Handlungsaufruf: ${p.cta || '(fehlt)'}`),
      h('div', { class: 'small muted' }, `Untertitel: ${p.subtitles ? 'vorhanden' : 'fehlen'}`),
    ),

    scores.length
      ? card(
          'Bewertungen',
          'bewusst getrennt',
          ...scores.map((s) =>
            h('div', { style: { marginBottom: '.6rem' } },
              h('div', { class: 'small muted' }, `Zeitfenster ${s.window}`),
              h('div', { class: 'small' }, `Virality ${s.viralityScore ?? '-'} (${s.viralityConfidence})`),
              scoreBar('virality', s.viralityScore),
              h('div', { class: 'small' }, `Business Impact ${s.businessScore ?? '-'} (${s.businessConfidence})`),
              scoreBar('business', s.businessScore),
            ),
          ),
        )
      : null,

    card(
      'Versionen',
      null,
      table(
        [{ label: 'v', num: true }, { label: 'Aenderung' }, { label: 'Wann' }, { label: 'Wer' }],
        asArray(d.versions).map((v) => [v.version, v.change_summary, fmtDate(v.created_at), v.created_by]),
      ),
    ),

    d.item.state === 'awaiting_approval'
      ? h('div', { class: 'btn-row' },
          h('button', { class: 'primary', onClick: () => navigate('approvals', { id }) }, 'Zur Freigabe →'))
      : null,
  );
}

/* ========================================================================
   6. Freigaben
   ===================================================================== */
export async function approvalsView(params = {}) {
  if (params.id) return approvalCard(params.id);
  const cards = await api.get('/api/approvals');
  return frag(
    h('h1', {}, 'Freigaben'),
    notice('Ohne deine ausdrueckliche Entscheidung wird nichts veroeffentlicht.', 'info'),
    cards.length
      ? h('div', { class: 'list' },
          ...cards.map((c) =>
            row(
              c.item.title,
              `${c.platform} · ${c.item.format} · ${c.publishAt ? fmtDate(c.publishAt) : 'kein Termin'} · ${c.accountLabel}`,
              [
                c.canApprove ? badge('bereit', 'ok') : badge(`${c.blockingReasons.length} blockiert`, 'danger'),
                !c.accountIsPublic ? badge('Testziel', 'info') : null,
              ],
              () => navigate('approvals', { id: c.item.id }),
            )))
      : empty('Nichts wartet auf Freigabe.'),
  );
}

async function approvalCard(id) {
  const c = await api.get(`/api/approvals/${id}`);

  const decideBtn = (decision, text, cls) =>
    h('button', {
      class: cls,
      disabled: !c.canApprove && ['approve_once', 'schedule', 'publish_now'].includes(decision),
      onClick: async (e) => {
        if (['publish_now', 'approve_once', 'schedule'].includes(decision)) {
          const target = c.accountIsPublic
            ? `OEFFENTLICH auf ${c.accountLabel}`
            : `auf das nicht-oeffentliche Testziel ${c.accountLabel}`;
          if (!confirmDialog(`"${c.item.title}"\n\nwird ${target} veroeffentlicht.\n\nFortfahren?`)) return;
        }
        e.target.disabled = true;
        try {
          await api.post(`/api/approvals/${id}/decide`, {
            decision,
            seenHash: c.contentHash,
            scheduledFor: decision === 'schedule' ? c.publishAt : null,
          });
          toast('Entscheidung gespeichert.', 'ok');
          navigate('approvals');
        } catch (err) {
          toast(err.message, 'danger');
          e.target.disabled = false;
        }
      },
    }, text);

  return frag(
    h('div', { class: 'btn-row', style: { marginBottom: '.6rem' } },
      h('button', { class: 'sm ghost', onClick: () => navigate('approvals') }, '← Warteschlange')),
    h('h1', {}, 'Freigabe'),

    h(
      'section',
      { class: `card approval${c.canApprove ? '' : ' blocked'}` },
      h('div', { class: 'card-head' },
        h('h2', {}, c.item.title),
        h('div', {}, stateBadge(c.item.state))),

      h('div', { class: 'small muted' }, `Ziel: ${c.accountLabel} (${c.platform})`),
      !c.accountIsPublic
        ? notice('Dieses Ziel ist NICHT oeffentlich. Es dient dem kontrollierten Test.', 'info')
        : notice('Dieses Ziel ist oeffentlich. Nach der Freigabe ist der Beitrag fuer alle sichtbar.', 'warn'),
      h('div', { class: 'small muted' }, `Geplant: ${c.publishAt ? `${fmtDate(c.publishAt)} (${fmtRelative(c.publishAt)})` : 'ohne Termin'}`),
      c.objective ? h('div', { class: 'small muted' }, `Ziel des Beitrags: ${c.objective}`) : null,

      asArray(c.assets).length
        ? h('div', { class: 'media-strip', style: { marginTop: '.6rem' } },
            ...c.assets.map((a) =>
              a.url
                ? h('div', { class: `media-thumb${a.blockers.length ? ' blocked' : ''}`, style: { backgroundImage: `url("${a.url}")` } },
                    h('span', { class: 'kind' }, a.kind))
                : h('div', { class: `media-thumb${a.blockers.length ? ' blocked' : ''}` }, h('span', { class: 'kind' }, a.kind))))
        : notice('Kein Medium zugeordnet.', 'danger'),

      h('div', { class: 'approval-preview' },
        h('div', { class: 'approval-caption' }, c.preview.caption || '(kein Text)'),
        h('div', { class: 'row-meta', style: { marginTop: '.5rem' } }, asArray(c.preview.hashtags).join(' '))),

      h('h3', {}, 'Rechte und Fakten'),
      h('div', { class: 'check-list' },
        ...[...asArray(c.rightsChecks), ...asArray(c.factChecks)].map((chk) =>
          h('div', { class: `check ${chk.ok ? 'ok' : 'bad'}` },
            h('span', { class: 'mark' }, chk.ok ? '✓' : '✗'),
            h('span', {}, h('strong', {}, chk.label), h('span', { class: 'check-detail' }, ` — ${chk.detail}`))))),

      asArray(c.unresolvedRisks).length
        ? frag(
            h('h3', {}, 'Offene Risiken'),
            h('div', { class: 'list' },
              ...c.unresolvedRisks.map((r) =>
                row(r.message, r.code, badge(r.blocking ? 'blockierend' : r.severity, r.blocking ? 'danger' : 'warn')))))
        : null,

      !c.canApprove
        ? notice(`Freigabe nicht moeglich:\n${c.blockingReasons.join('\n')}`, 'danger')
        : null,

      h('h3', {}, 'Entscheidung'),
      h('div', { class: 'btn-row' },
        decideBtn('approve_once', 'Einmalig freigeben', 'primary'),
        decideBtn('schedule', 'Einplanen', ''),
        decideBtn('publish_now', 'Jetzt senden', ''),
        decideBtn('return_to_concept', 'Zurueck zum Konzept', 'ghost'),
        decideBtn('reject', 'Ablehnen', 'danger'),
        decideBtn('cancel', 'Abbrechen', 'ghost')),

      h('h3', { style: { marginTop: '1rem' } }, 'Versionsverlauf'),
      table([{ label: 'v', num: true }, { label: 'Aenderung' }, { label: 'Wann' }],
        asArray(c.versionHistory).map((v) => [v.version, v.change_summary, fmtDate(v.created_at)])),

      h('div', { class: 'mono', style: { marginTop: '.5rem' } }, `Inhalts-Hash: ${c.contentHash}`),
      h('div', { class: 'field-hint' },
        'Die Freigabe gilt genau fuer diesen Hash. Jede Aenderung an Medium, Aussage, Handlungsaufruf, ' +
        'Plattform oder Zeitpunkt entwertet sie automatisch.'),
    ),
  );
}

/* ========================================================================
   7. Veroeffentlichung
   ===================================================================== */
export async function publishingView() {
  const d = await api.get('/api/jobs?limit=60');
  const s = d.stats;
  return frag(
    h('h1', {}, 'Veroeffentlichung'),
    h('div', { class: 'grid three', style: { marginBottom: '.85rem' } },
      stat(s.queued, 'wartend'),
      stat(s.running + s.awaiting_verification, 'laufend'),
      stat(s.succeeded, 'erfolgreich'),
      stat(s.dead_letter, 'gescheitert', null, s.dead_letter > 0),
      stat(s.cancelled, 'abgebrochen')),

    h('div', { class: 'btn-row', style: { marginBottom: '.85rem' } },
      h('button', {
        onClick: async (e) => {
          e.target.disabled = true;
          try {
            const r = await api.post('/api/jobs/tick', {});
            toast(`${r.processed} Job(s) bearbeitet, ${r.recovered} wieder aufgenommen.`, 'ok');
            navigate('publishing');
          } catch (err) { toast(err.message, 'danger'); e.target.disabled = false; }
        },
      }, 'Warteschlange jetzt abarbeiten')),

    asArray(d.jobs).length
      ? h('div', { class: 'list' },
          ...d.jobs.map((j) =>
            h('div', { class: 'row' },
              h('div', { class: 'row-main' },
                h('div', { class: 'row-title' }, `${j.platform} · ${j.id}`),
                h('div', { class: 'row-meta' },
                  `Geplant ${fmtDate(j.run_at)} · Versuche ${j.attempts}/${j.max_attempts}` +
                  (j.verified_at ? ` · bestaetigt ${fmtDate(j.verified_at)}` : '')),
                j.last_error ? h('div', { class: 'row-meta' }, badge(j.last_error.slice(0, 140), 'danger')) : null,
                j.external_url ? h('div', { class: 'row-meta mono' }, j.external_url) : null),
              h('div', { class: 'row-side' },
                stateBadge(j.state),
                j.state === 'dead_letter' || j.state === 'cancelled'
                  ? h('button', {
                      class: 'sm',
                      onClick: async (e) => {
                        e.target.disabled = true;
                        try {
                          await api.post(`/api/jobs/${j.id}/requeue`, {});
                          toast('Job wieder eingereiht.', 'ok');
                          navigate('publishing');
                        } catch (err) { toast(err.message, 'danger'); e.target.disabled = false; }
                      },
                    }, 'Erneut versuchen')
                  : null)))
        )
      : empty('Keine Jobs.'),
  );
}

/* ========================================================================
   8. Posteingang und Leads
   ===================================================================== */
export async function inboxView() {
  const [messages, leads] = await Promise.all([api.get('/api/inbox?limit=50'), api.get('/api/leads')]);

  const classLabels = {
    general_question: 'Allgemeine Frage',
    pricing_availability: 'Preis / Verfuegbarkeit',
    licence_class: 'Fuehrerscheinklasse',
    complaint: 'Beschwerde',
    urgent_safety: 'Dringend / Sicherheit',
    spam: 'Spam',
    partnership: 'Kooperation',
    high_value_lead: 'Hochwertige Anfrage',
  };

  return frag(
    h('h1', {}, 'Posteingang'),
    notice('Antworten werden entworfen, aber nie ohne deine Freigabe gesendet.', 'info'),

    card('Lead-Pipeline', null,
      h('div', { class: 'grid three' },
        ...asArray(leads.pipeline).map((p) => stat(p.count, label(p.stage), p.revenueCents ? fmtEur(p.revenueCents) : null)))),

    asArray(leads.bySource).length
      ? card('Beste Quellen', 'welcher Beitrag bringt tatsaechlich Anmeldungen',
          table([{ label: 'Beitrag' }, { label: 'Leads', num: true }, { label: 'Anmeldungen', num: true }, { label: 'Umsatz', num: true }],
            leads.bySource.map((s) => [s.title, s.leads, s.registrations, fmtEur(s.revenue_cents)])))
      : null,

    card('Nachrichten', `${messages.length}`,
      messages.length
        ? h('div', { class: 'list' },
            ...messages.map((m) =>
              h('div', { class: 'row' },
                h('div', { class: 'row-main' },
                  h('div', { class: 'row-title' }, m.body.slice(0, 200)),
                  h('div', { class: 'row-meta' },
                    `${m.kind} · ${m.platform} · ${fmtDate(m.received_at)} · Lead-Wert ${m.lead_score ?? 0}`)),
                h('div', { class: 'row-side' },
                  badge(classLabels[m.classification] ?? m.classification ?? '-',
                    m.classification === 'urgent_safety' || m.classification === 'complaint' ? 'danger'
                    : m.classification === 'high_value_lead' ? 'crimson' : ''),
                  stateBadge(m.status),
                  m.classification !== 'spam'
                    ? h('button', {
                        class: 'sm',
                        onClick: async (e) => {
                          e.target.disabled = true;
                          try {
                            const r = await api.post(`/api/inbox/${m.id}/draft`, {});
                            toast(`Entwurf: ${r.body.slice(0, 120)}…`, 'ok');
                            navigate('inbox');
                          } catch (err) { toast(err.message, 'danger'); e.target.disabled = false; }
                        },
                      }, 'Antwort entwerfen')
                    : null))))
        : empty('Keine Nachrichten.')),
  );
}

/* ========================================================================
   9. Analyse
   ===================================================================== */
export async function analyticsView() {
  const d = await api.get('/api/analytics');
  const memory = asArray(d.memory);

  return frag(
    h('h1', {}, 'Analyse'),
    notice(
      'Zwei getrennte Bewertungen. Ein Beitrag mit hoher Reichweite und null Anfragen ist ' +
        'unterhaltsam, aber kein Akquiseerfolg - deshalb gibt es hier bewusst keine Gesamtnote.',
      'info',
    ),

    card('Beitraege', `${memory.length}`,
      memory.length
        ? h('div', { class: 'list' },
            ...memory.map((m) =>
              h('div', { class: 'row clickable', onClick: () => navigate('production', { id: m.id }) },
                h('div', { class: 'row-main' },
                  h('div', { class: 'row-title' }, m.title),
                  h('div', { class: 'row-meta' }, `${m.platform} · ${m.format} · ${m.pillar ?? '-'} · ${fmtDate(m.scheduled_for)}`),
                  h('div', { class: 'small', style: { marginTop: '.35rem' } }, `Virality ${m.virality_score ?? '-'}`),
                  scoreBar('virality', m.virality_score),
                  h('div', { class: 'small' }, `Business Impact ${m.business_score ?? '-'}`),
                  scoreBar('business', m.business_score),
                  (m.virality_score ?? 0) > 40 && (m.business_score ?? 0) < 12
                    ? h('div', { class: 'row-meta' }, badge('viel gesehen, nichts bewirkt', 'warn'))
                    : null))))
        : empty('Noch keine veroeffentlichten Beitraege mit Kennzahlen.')),

    card('Lead-Pipeline', null,
      h('div', { class: 'grid three' },
        ...asArray(d.pipeline).map((p) => stat(p.count, label(p.stage), p.revenueCents ? fmtEur(p.revenueCents) : null)))),
  );
}

/* ========================================================================
   10. Lernen
   ===================================================================== */
export async function learningView() {
  const d = await api.get('/api/learning');

  return frag(
    h('h1', {}, 'Lernen'),
    notice(
      'Eine Aenderung geht nur diesen Weg: Evidenz → Vorschlag → Tests → keine Regression → ' +
        'deine Freigabe. Vorschlaege, die Schutzmechanismen abschwaechen wuerden, werden automatisch abgewiesen.',
      'info',
    ),

    h('div', { class: 'btn-row', style: { marginBottom: '.85rem' } },
      h('button', {
        class: 'primary',
        onClick: async (e) => {
          e.target.disabled = true;
          try { await api.post('/api/learning/reports', { days: 7 }); toast('Lernbericht erstellt.', 'ok'); navigate('learning'); }
          catch (err) { toast(err.message, 'danger'); e.target.disabled = false; }
        },
      }, 'Lernbericht erzeugen'),
      h('button', {
        onClick: async (e) => {
          e.target.disabled = true;
          try {
            const r = await api.post('/api/learning/regression', {});
            const failed = r.filter((x) => !x.passed);
            toast(failed.length ? `${failed.length} Test(s) fehlgeschlagen.` : `Alle ${r.length} Tests bestanden.`,
              failed.length ? 'danger' : 'ok');
          } catch (err) { toast(err.message, 'danger'); }
          e.target.disabled = false;
        },
      }, 'Regressionstests laufen lassen')),

    card('Aenderungsvorschlaege', `${asArray(d.proposals).length}`,
      asArray(d.proposals).length
        ? h('div', { class: 'list' },
            ...d.proposals.map((p) =>
              h('div', { class: 'row' },
                h('div', { class: 'row-main' },
                  h('div', { class: 'row-title' }, p.title),
                  h('div', { class: 'row-meta' }, p.rationale),
                  h('div', { class: 'row-meta mono' }, `${p.target_kind}:${p.target_ref}`)),
                h('div', { class: 'row-side' },
                  badge(p.state, p.state === 'applied' ? 'ok' : p.state === 'rejected' ? 'danger' : ''),
                  badge(`Risiko ${p.risk_class}`, p.risk_class === 'forbidden' ? 'danger' : p.risk_class === 'high' ? 'warn' : ''),
                  p.state === 'proposed'
                    ? h('button', { class: 'sm', onClick: async (e) => {
                        e.target.disabled = true;
                        try { const r = await api.post(`/api/learning/proposals/${p.id}/test`, {});
                          toast(r.passed ? 'Tests bestanden.' : 'Tests fehlgeschlagen.', r.passed ? 'ok' : 'danger');
                          navigate('learning');
                        } catch (err) { toast(err.message, 'danger'); e.target.disabled = false; }
                      } }, 'Testen')
                    : null,
                  p.state === 'ready_for_owner'
                    ? h('button', { class: 'sm primary', onClick: async (e) => {
                        if (!confirmDialog(`"${p.title}" anwenden?`)) return;
                        e.target.disabled = true;
                        try { await api.post(`/api/learning/proposals/${p.id}/apply`, {}); toast('Angewandt.', 'ok'); navigate('learning'); }
                        catch (err) { toast(err.message, 'danger'); e.target.disabled = false; }
                      } }, 'Anwenden')
                    : null,
                  p.state === 'applied'
                    ? h('button', { class: 'sm danger', onClick: async (e) => {
                        e.target.disabled = true;
                        try { await api.post(`/api/learning/proposals/${p.id}/rollback`, {}); toast('Zurueckgerollt.', 'ok'); navigate('learning'); }
                        catch (err) { toast(err.message, 'danger'); e.target.disabled = false; }
                      } }, 'Zurueckrollen')
                    : null))))
        : empty('Keine Vorschlaege.')),

    card('Lernberichte', null,
      asArray(d.reports).length
        ? h('div', { class: 'list' },
            ...d.reports.map((r) =>
              row(`${r.period_start.slice(0, 10)} bis ${r.period_end.slice(0, 10)}`, fmtDate(r.created_at),
                h('button', { class: 'sm', onClick: async () => {
                  const full = await api.get(`/api/learning/reports/${r.id}`);
                  const box = document.getElementById(`report-${r.id}`);
                  if (box) { box.remove(); return; }
                  const pre = h('pre', { id: `report-${r.id}` }, full.markdown);
                  document.querySelector('main').append(pre);
                  pre.scrollIntoView({ behavior: 'smooth' });
                } }, 'Anzeigen'))))
        : empty('Noch kein Bericht.')),

    card('Postmortems', null,
      asArray(d.postmortems).length
        ? h('div', { class: 'list' },
            ...d.postmortems.slice(0, 20).map((p) =>
              row(p.wrong_assumptions, `${p.failure_class} · ${p.contributing_component} · ${fmtDate(p.created_at)}`,
                badge(p.failure_class, p.failure_class === 'none' ? 'ok' : 'warn'))))
        : empty('Noch keine Postmortems.')),

    card('Agenten-Prompts', 'versioniert und rueckrollbar',
      table([{ label: 'Agent' }, { label: 'v', num: true }, { label: 'Aktiv' }, { label: 'Aenderung' }],
        asArray(d.prompts).map((p) => [p.agent_key, p.version, p.active ? '✓' : '', p.change_summary]))),
  );
}

/* ========================================================================
   11. Systemzustand
   ===================================================================== */
export async function healthView() {
  const d = await api.get('/api/health/detail');
  return frag(
    h('h1', {}, 'Systemzustand'),
    h('div', { class: 'grid three', style: { marginBottom: '.85rem' } },
      stat(d.counts.contentItems, 'Beitraege'),
      stat(d.counts.publishedItems, 'veroeffentlicht'),
      stat(d.counts.mediaAssets, 'Medien'),
      stat(d.counts.events, 'Protokolleintraege')),

    d.llmMode !== 'anthropic'
      ? notice('Generative Agenten im deterministischen Modus (keine LLM-Zugangsdaten).', 'warn')
      : notice('Generative Agenten nutzen Claude.', 'ok'),

    asArray(d.alerts).length
      ? card('Offene Alarme', `${d.alerts.length}`,
          h('div', { class: 'list' },
            ...d.alerts.map((a) => row(a.message, `${a.code} · ${fmtDate(a.at)}`, badge(a.severity, 'danger')))))
      : notice('Keine offenen Alarme.', 'ok'),

    card('Agenten', `${d.agents.length} Rollen`,
      table([{ label: 'Rolle' }, { label: 'Zustaendigkeit' }, { label: 'Veto' }, { label: 'Zustand' }],
        d.agents.map((a) => [
          a.name, a.responsibility, a.veto ? '✓' : '',
          h('span', { class: `badge ${a.active ? 'ok' : 'warn'}` }, a.active ? 'aktiv' : 'eingeschraenkt'),
        ]))),

    card('Integrationen', null,
      table([{ label: 'Plattform' }, { label: 'Eingerichtet' }, { label: 'Berechtigung' }, { label: 'Konten' }],
        d.integrations.map((i) => [
          i.platform + (i.isPublic ? '' : ' (nicht oeffentlich)'),
          h('span', { class: `badge ${i.configured ? 'ok' : 'warn'}` }, i.configured ? 'ja' : 'nein'),
          i.permissionLevel,
          i.accounts.map((a) => `@${a.handle}: ${label(a.status)}`).join(', ') || '-',
        ]))),

    card('Warteschlange', null,
      table([{ label: 'Zustand' }, { label: 'Anzahl', num: true }],
        Object.entries(d.queue).map(([k, v]) => [label(k), v]))),

    card('Schema', null,
      table([{ label: 'Version', num: true }, { label: 'Name' }, { label: 'Angewandt' }],
        d.migrations.map((m) => [m.version, m.name, fmtDate(m.applied_at)]))),
  );
}

/* ========================================================================
   12. Einstellungen
   ===================================================================== */
export async function settingsView() {
  const [brand, integrations, accounts] = await Promise.all([
    api.get('/api/brand'),
    api.get('/api/integrations'),
    api.get('/api/accounts'),
  ]);

  const nextQ = brand.nextQuestion;
  const answerInput = h('textarea', { placeholder: 'Konkret antworten - mit Zahl, Ort oder Beispiel.' });

  return frag(
    h('h1', {}, 'Einstellungen'),

    nextQ
      ? card('Onboarding-Interview', 'eine Frage nach der anderen',
          h('p', {}, nextQ.question),
          nextQ.challenge_note ? notice(nextQ.challenge_note, 'warn') : null,
          answerInput,
          h('button', {
            class: 'primary sm', style: { marginTop: '.5rem' },
            onClick: async (e) => {
              e.target.disabled = true;
              try {
                const r = await api.post('/api/brand/onboarding', { questionKey: nextQ.question_key, answer: answerInput.value });
                toast(r.accepted ? 'Antwort gespeichert.' : `Nachgehakt: ${r.challenge}`, r.accepted ? 'ok' : 'warn');
                navigate('settings');
              } catch (err) { toast(err.message, 'danger'); e.target.disabled = false; }
            },
          }, 'Antworten'))
      : notice('Onboarding-Interview abgeschlossen.', 'ok'),

    card('Marken-Tatsachen', `${brand.facts.length}`,
      notice('Nur Eintraege mit Status "Belegt" duerfen in Beitraegen behauptet werden. Der Fact Verifier blockiert alles andere.', 'warn'),
      table([{ label: 'Bereich' }, { label: 'Angabe' }, { label: 'Status' }, { label: 'Quelle' }],
        brand.facts.map((f) => [
          `${f.category}/${f.fact_key}`,
          f.value,
          h('span', { class: `badge ${f.verification_status === 'VERIFIED' ? 'ok' : 'warn'}` }, label(f.verification_status)),
          f.source,
        ]))),

    card('Inhaltssaeulen', null,
      table([{ label: 'Saeule' }, { label: 'Zielanteil', num: true }, { label: 'Beschreibung' }],
        brand.pillars.map((p) => [p.name, `${Math.round(p.target_share * 100)} %`, p.description]))),

    card('Zielgruppen', null,
      h('div', { class: 'list' },
        ...brand.segments.map((s) =>
          row(s.name, `${s.description} · Einwaende: ${s.objections.join(' | ')}`)))),

    card('Verbotene Formulierungen', null,
      h('div', { class: 'btn-row' },
        ...brand.phrases.filter((p) => p.kind === 'forbidden').map((p) => badge(p.text, 'danger')))),

    card('Integrationen', 'Zugangsdaten liegen ausschliesslich serverseitig',
      h('div', { class: 'btn-row', style: { marginBottom: '.6rem' } },
        h('button', {
          onClick: async (e) => {
            e.target.disabled = true;
            try { const r = await api.post('/api/integrations/refresh', {}); toast(`${r.length} Konten geprueft.`, 'ok'); navigate('settings'); }
            catch (err) { toast(err.message, 'danger'); e.target.disabled = false; }
          },
        }, 'Verbindungen jetzt pruefen')),
      table([{ label: 'Plattform' }, { label: 'Konto' }, { label: 'Status' }, { label: 'Zuletzt geprueft' }, { label: 'Fehler' }],
        accounts.map((a) => [
          a.platform + (a.is_public ? '' : ' (Testziel)'),
          `@${a.handle}`,
          stateBadge(a.status),
          fmtDate(a.last_check_at),
          a.last_check_error ?? '-',
        ]))),

    card('Brand Voice', brand.voice ? `Version ${brand.voice.version}` : 'nicht gesetzt',
      brand.voice ? h('pre', {}, brand.voice.markdown) : empty('Noch kein Dokument.')),
  );
}

export const VIEWS = {
  today: { label: 'Heute', icon: '◉', render: todayView, group: 'Ueberblick' },
  approvals: { label: 'Freigaben', icon: '✓', render: approvalsView, group: 'Ueberblick' },
  ideas: { label: 'Ideen', icon: '✦', render: ideasView, group: 'Planung' },
  calendar: { label: 'Kalender', icon: '▤', render: calendarView, group: 'Planung' },
  media: { label: 'Medien', icon: '▣', render: mediaView, group: 'Planung' },
  production: { label: 'Produktion', icon: '✎', render: productionView, group: 'Produktion' },
  publishing: { label: 'Versand', icon: '↗', render: publishingView, group: 'Produktion' },
  inbox: { label: 'Posteingang', icon: '✉', render: inboxView, group: 'Wirkung' },
  analytics: { label: 'Analyse', icon: '◫', render: analyticsView, group: 'Wirkung' },
  learning: { label: 'Lernen', icon: '↻', render: learningView, group: 'Wirkung' },
  health: { label: 'System', icon: '⚙', render: healthView, group: 'Betrieb' },
  settings: { label: 'Einstellungen', icon: '⚑', render: settingsView, group: 'Betrieb' },
};
