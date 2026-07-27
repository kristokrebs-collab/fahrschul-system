/**
 * Anwendungsrahmen: API-Client, Anmeldung, Router, Navigation.
 */
import { h, frag, card, field, notice, loading, toast } from './ui.js';
import { VIEWS, bindViews } from './views.js';

/* --- API-Client ---------------------------------------------------------- */
class ApiError extends Error {
  constructor(message, status, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const api = {
  async request(method, path, body) {
    let res;
    try {
      res = await fetch(path, {
        method,
        headers: body !== undefined ? { 'content-type': 'application/json' } : {},
        body: body !== undefined ? JSON.stringify(body) : undefined,
        credentials: 'same-origin',
      });
    } catch {
      throw new ApiError('Server nicht erreichbar. Verbindung pruefen.', 0);
    }
    const text = await res.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = { error: text.slice(0, 200) };
    }
    if (!res.ok) {
      const message = payload?.error ?? `Fehler ${res.status}`;
      const details = payload?.details ? ` (${payload.details.join('; ')})` : '';
      throw new ApiError(message + details, res.status, payload?.details);
    }
    return payload;
  },
  get: (p) => api.request('GET', p),
  post: (p, b) => api.request('POST', p, b ?? {}),
  patch: (p, b) => api.request('PATCH', p, b ?? {}),
};

/* --- Zustand ------------------------------------------------------------- */
let currentUser = null;
const app = document.getElementById('app');

/* --- Routing ------------------------------------------------------------- */
function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [name, query] = raw.split('?');
  const params = {};
  if (query) {
    for (const [k, v] of new URLSearchParams(query)) params[k] = v;
  }
  return { name: VIEWS[name] ? name : 'today', params };
}

function navigate(name, params = {}) {
  const query = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== null && v !== undefined && v !== ''),
  ).toString();
  const target = `#/${name}${query ? `?${query}` : ''}`;
  if (location.hash === target) render();
  else location.hash = target;
}

bindViews(api, navigate);

/* --- Navigation ---------------------------------------------------------- */
const PRIMARY_TABS = ['today', 'approvals', 'calendar', 'inbox', 'settings'];

function buildSideNav(active, counts) {
  const groups = new Map();
  for (const [key, v] of Object.entries(VIEWS)) {
    if (!groups.has(v.group)) groups.set(v.group, []);
    groups.get(v.group).push([key, v]);
  }
  return h(
    'nav',
    { class: 'sidenav', 'aria-label': 'Hauptnavigation' },
    ...[...groups.entries()].flatMap(([group, entries]) => [
      h('div', { class: 'group-label' }, group),
      ...entries.map(([key, v]) =>
        h(
          'button',
          {
            'aria-current': key === active ? 'page' : null,
            onClick: () => navigate(key),
          },
          h('span', { class: 'ico', 'aria-hidden': 'true' }, v.icon),
          v.label,
          counts[key] ? h('span', { class: 'count' }, String(counts[key])) : null,
        ),
      ),
    ]),
  );
}

function buildTabBar(active, counts) {
  return h(
    'nav',
    { class: 'tabbar', 'aria-label': 'Hauptnavigation' },
    ...PRIMARY_TABS.map((key) => {
      const v = VIEWS[key];
      return h(
        'button',
        { 'aria-current': key === active ? 'page' : null, onClick: () => navigate(key) },
        h('span', { class: 'ico', 'aria-hidden': 'true' }, v.icon),
        v.label,
        counts[key] ? h('span', { class: 'more-badge' }, String(counts[key])) : null,
      );
    }),
  );
}

/* --- Anmeldung ----------------------------------------------------------- */
function renderLogin(message) {
  const email = h('input', { type: 'email', autocomplete: 'username', required: true });
  const password = h('input', { type: 'password', autocomplete: 'current-password', required: true });
  const submit = h('button', { class: 'primary', type: 'submit', style: { width: '100%' } }, 'Anmelden');

  const form = h(
    'form',
    {
      onSubmit: async (e) => {
        e.preventDefault();
        submit.disabled = true;
        submit.textContent = 'Prüfe …';
        try {
          const r = await api.post('/api/auth/login', { email: email.value, password: password.value });
          currentUser = r.user;
          location.hash = '#/today';
          await render();
        } catch (err) {
          submit.disabled = false;
          submit.textContent = 'Anmelden';
          const box = document.getElementById('login-error');
          if (box) box.replaceWith(notice(err.message, 'danger'));
          else form.prepend(notice(err.message, 'danger'));
        }
      },
    },
    field('E-Mail', email),
    field('Passwort', password),
    submit,
  );

  app.replaceChildren(
    h(
      'div',
      { class: 'login-wrap' },
      h(
        'div',
        { class: 'card login-card' },
        h(
          'div',
          { class: 'brand', style: { marginBottom: '1rem' } },
          h('div', { class: 'brand-mark' }),
          h(
            'div',
            { class: 'brand-text' },
            h('div', { class: 'brand-title' }, 'Fahrschule Krebs'),
            h('div', { class: 'brand-sub' }, 'Social Autopilot'),
          ),
        ),
        message ? notice(message, 'warn') : null,
        form,
      ),
    ),
  );
}

/* --- Rahmen -------------------------------------------------------------- */
async function render() {
  const { name, params } = parseHash();

  let counts = {};
  try {
    const today = await api.get('/api/today');
    counts = {
      approvals: today.needsAttention.approvalsWaiting,
      inbox: today.needsAttention.newMessages,
      media: today.needsAttention.mediaAwaitingClearance,
      publishing: today.needsAttention.deadLetterJobs,
      health: today.needsAttention.openAlerts,
    };
  } catch (err) {
    if (err.status === 401) {
      currentUser = null;
      renderLogin();
      return;
    }
  }

  const topbar = h(
    'header',
    { class: 'topbar' },
    h(
      'div',
      { class: 'brand' },
      h('div', { class: 'brand-mark' }),
      h(
        'div',
        { class: 'brand-text' },
        h('div', { class: 'brand-title' }, 'Fahrschule Krebs'),
        h('div', { class: 'brand-sub' }, 'Social Autopilot'),
      ),
    ),
    h('div', { class: 'topbar-spacer' }),
    currentUser
      ? h(
          'div',
          { class: 'topbar-user' },
          h('strong', {}, currentUser.displayName),
          `${currentUser.role} · `,
          h(
            'a',
            {
              href: '#',
              onClick: async (e) => {
                e.preventDefault();
                await api.post('/api/auth/logout');
                currentUser = null;
                renderLogin('Abgemeldet.');
              },
            },
            'abmelden',
          ),
        )
      : null,
  );

  const main = h('main', {}, loading());
  app.replaceChildren(
    topbar,
    h('div', { class: 'layout' }, buildSideNav(name, counts), main),
    buildTabBar(name, counts),
  );

  try {
    const content = await VIEWS[name].render(params);
    main.replaceChildren(content);
    main.scrollTop = 0;
    window.scrollTo(0, 0);
  } catch (err) {
    if (err.status === 401) {
      currentUser = null;
      renderLogin('Sitzung abgelaufen. Bitte erneut anmelden.');
      return;
    }
    main.replaceChildren(
      card('Diese Ansicht konnte nicht geladen werden', null, notice(err.message, 'danger'),
        h('button', { onClick: () => render() }, 'Erneut versuchen')),
    );
  }
}

/* --- Start --------------------------------------------------------------- */
window.addEventListener('hashchange', () => void render());

(async function boot() {
  try {
    const me = await api.get('/api/auth/me');
    currentUser = me.user;
    if (!location.hash) location.hash = '#/today';
    await render();
  } catch (err) {
    if (err.status === 401) renderLogin();
    else {
      app.replaceChildren(
        h('div', { class: 'login-wrap' },
          h('div', { class: 'card login-card' },
            notice(`Start fehlgeschlagen: ${err.message}`, 'danger'),
            h('button', { onClick: () => location.reload() }, 'Neu laden'))),
      );
    }
  }
})();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* Offline-Huelle ist optional - ohne sie funktioniert die App weiterhin. */
    });
  });
}

export { api, navigate };
