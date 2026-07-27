/**
 * Kleine DOM-Bausteine.
 *
 * Bewusst ohne Framework: die Oberflaeche hat zwoelf Ansichten und muss auf
 * einem Tablet in der Fahrschule sofort da sein. Kein Build-Schritt, kein
 * Bundle, keine Hydration - der erste sinnvolle Bildschirm kommt aus einer
 * Datei von wenigen Kilobyte.
 *
 * `h()` erzeugt Elemente und setzt Text ueber textContent. Damit ist der
 * gesamte Renderpfad frei von innerHTML und HTML-Einschleusung aus API-Daten
 * ist ausgeschlossen.
 */

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'style' && typeof value === 'object') Object.assign(el.style, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'dataset') {
      Object.assign(el.dataset, value);
    } else if (value === true) {
      el.setAttribute(key, '');
    } else {
      el.setAttribute(key, String(value));
    }
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

export const frag = (...children) => {
  const f = document.createDocumentFragment();
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    f.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return f;
};

export function card(title, note, ...body) {
  return h(
    'section',
    { class: 'card' },
    title ? h('div', { class: 'card-head' }, h('h2', {}, title), note ? h('span', { class: 'card-note' }, note) : null) : null,
    ...body,
  );
}

export function stat(value, label, sub, attention = false) {
  return h(
    'div',
    { class: `stat${attention ? ' attention' : ''}` },
    h('div', { class: 'stat-value' }, value),
    h('div', { class: 'stat-label' }, label),
    sub ? h('div', { class: 'stat-sub' }, sub) : null,
  );
}

export function badge(text, kind = '') {
  return h('span', { class: `badge ${kind}`.trim() }, text);
}

export function notice(text, kind = 'info') {
  return h('div', { class: `notice ${kind}` }, text);
}

export function empty(text) {
  return h('div', { class: 'empty' }, text);
}

export function loading(text = 'Wird geladen …') {
  return h('div', { class: 'loading' }, h('div', { class: 'spinner' }), text);
}

export function row(title, meta, side, onClick) {
  return h(
    'div',
    { class: `row${onClick ? ' clickable' : ''}`, ...(onClick ? { onClick } : {}) },
    h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, title), meta ? h('div', { class: 'row-meta' }, meta) : null),
    side ? h('div', { class: 'row-side' }, ...(Array.isArray(side) ? side : [side])) : null,
  );
}

export function field(label, input, hint) {
  return h('div', { class: 'field' }, h('label', {}, label), input, hint ? h('div', { class: 'field-hint' }, hint) : null);
}

export function table(headers, rows) {
  return h(
    'div',
    { class: 'table-wrap' },
    h(
      'table',
      {},
      h('thead', {}, h('tr', {}, headers.map((x) => h('th', { class: x.num ? 'num' : '' }, x.label ?? x)))),
      h(
        'tbody',
        {},
        rows.map((r) =>
          h('tr', {}, r.map((cell, i) => h('td', { class: headers[i]?.num ? 'num' : '' }, cell))),
        ),
      ),
    ),
  );
}

export function scoreBar(kind, value) {
  const pct = value === null || value === undefined ? 0 : Math.max(0, Math.min(100, value));
  return h('div', { class: `score-bar ${kind}` }, h('span', { style: { width: `${pct}%` } }));
}

/** Zustaende in Klartext statt technischer Bezeichner. */
const STATE_LABELS = {
  draft: 'Entwurf',
  in_review: 'In Pruefung',
  rejected: 'Abgelehnt',
  awaiting_approval: 'Wartet auf Freigabe',
  approved: 'Freigegeben',
  scheduled: 'Eingeplant',
  publishing: 'Wird gesendet',
  published: 'Veroeffentlicht',
  failed: 'Fehlgeschlagen',
  cancelled: 'Abgebrochen',
  queued: 'In Warteschlange',
  running: 'Laeuft',
  awaiting_verification: 'Zustellung wird geprueft',
  succeeded: 'Erfolgreich',
  dead_letter: 'Endgueltig fehlgeschlagen',
  QUEUED: 'Neu',
  IN_REVIEW: 'Zur Sichtung',
  APPROVED: 'Freigegeben',
  BLOCKED: 'Gesperrt',
  UNKNOWN: 'Ungeklaert',
  NOT_REQUIRED: 'Nicht erforderlich',
  PENDING: 'Angefragt',
  CLEARED: 'Erteilt',
  REFUSED: 'Verweigert',
  WITHDRAWN: 'Zurueckgezogen',
  OWNED: 'Eigenrecht',
  LICENSED: 'Lizenziert',
  PLATFORM_AUTHORIZED: 'Plattformlizenz',
  RESTRICTED: 'Eingeschraenkt',
  FORBIDDEN: 'Untersagt',
  VERIFIED: 'Belegt',
  NEEDS_OWNER_CONFIRMATION: 'Unbestaetigt',
  EXPIRED: 'Abgelaufen',
  connected: 'Verbunden',
  unconfigured: 'Nicht eingerichtet',
  token_expired: 'Token abgelaufen',
  error: 'Fehler',
  disabled: 'Deaktiviert',
  new: 'Neu',
  triaged: 'Gesichtet',
  answered: 'Beantwortet',
  escalated: 'Eskaliert',
  ignored: 'Ignoriert',
  qualified: 'Qualifiziert',
  appointment: 'Termin',
  registered: 'Angemeldet',
  lost: 'Verloren',
};

export const label = (key) => STATE_LABELS[key] ?? key ?? '-';

const STATE_KIND = {
  published: 'ok', succeeded: 'ok', approved: 'ok', APPROVED: 'ok', CLEARED: 'ok',
  OWNED: 'ok', LICENSED: 'ok', PLATFORM_AUTHORIZED: 'ok', NOT_REQUIRED: 'ok',
  VERIFIED: 'ok', connected: 'ok', registered: 'ok',
  awaiting_approval: 'crimson', scheduled: 'info', in_review: 'warn', publishing: 'info',
  IN_REVIEW: 'warn', QUEUED: 'warn', PENDING: 'warn', NEEDS_OWNER_CONFIRMATION: 'warn',
  queued: 'info', running: 'info', awaiting_verification: 'info', new: 'crimson',
  failed: 'danger', dead_letter: 'danger', rejected: 'danger', cancelled: 'danger',
  BLOCKED: 'danger', REFUSED: 'danger', WITHDRAWN: 'danger', FORBIDDEN: 'danger',
  UNKNOWN: 'warn', EXPIRED: 'danger', token_expired: 'danger', error: 'danger',
  escalated: 'danger', unconfigured: 'warn', lost: 'danger',
};

export const stateBadge = (key) => badge(label(key), STATE_KIND[key] ?? '');

export function fmtDate(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString('de-DE', {
    day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

export function fmtRelative(iso) {
  if (!iso) return '-';
  const diff = new Date(iso).getTime() - Date.now();
  const abs = Math.abs(diff);
  const mins = Math.round(abs / 60000);
  if (mins < 60) return diff < 0 ? `vor ${mins} Min` : `in ${mins} Min`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return diff < 0 ? `vor ${hours} Std` : `in ${hours} Std`;
  const days = Math.round(hours / 24);
  return diff < 0 ? `vor ${days} Tagen` : `in ${days} Tagen`;
}

export const fmtEur = (cents) =>
  cents === null || cents === undefined ? '-' : `${(cents / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

let toastHost = null;
export function toast(message, kind = '') {
  if (!toastHost) {
    toastHost = h('div', { class: 'toast-host' });
    document.body.append(toastHost);
  }
  const el = h('div', { class: `toast ${kind}`.trim() }, message);
  toastHost.append(el);
  setTimeout(() => el.remove(), kind === 'danger' ? 9000 : 4500);
}

export function confirmDialog(message) {
  return window.confirm(message);
}
