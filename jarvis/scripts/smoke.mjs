#!/usr/bin/env node
/**
 * End-to-end smoke test against a running JARVIS.
 *
 * Checks the promises that matter operationally: auth works, CSRF is enforced,
 * retrieval returns cited passages, the chat stream completes, and the status
 * endpoint reports component health honestly.
 *
 *   node scripts/smoke.mjs [baseUrl] [user] [password]
 */

const BASE = process.argv[2] ?? 'http://127.0.0.1:8787'
const USER = process.argv[3] ?? process.env.JARVIS_OWNER_USERNAME ?? 'michael'
const PASS = process.argv[4] ?? process.env.JARVIS_OWNER_PASSWORD

let cookie = ''
let pass = 0
let fail = 0

function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`) }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`) }
}

async function call(path, init = {}) {
  const res = await fetch(BASE + path, {
    ...init,
    headers: {
      'content-type': 'application/json',
      'x-jarvis-client': 'smoke',
      ...(cookie ? { cookie } : {}),
      ...(init.headers ?? {}),
    },
  })
  const setCookie = res.headers.get('set-cookie')
  if (setCookie) cookie = setCookie.split(';')[0]
  const text = await res.text()
  let body = null
  try { body = text ? JSON.parse(text) : null } catch { body = text }
  return { status: res.status, body }
}

console.log(`JARVIS Smoke-Test gegen ${BASE}\n`)

const health = await call('/api/health')
check('Health erreichbar', health.status === 200, `v${health.body?.version}`)
if (health.status !== 200) {
  console.log('\nServer nicht erreichbar. Läuft "npm start"?')
  process.exit(1)
}

const unauth = await call('/api/status')
check('Status ohne Anmeldung abgelehnt', unauth.status === 401)

const noCsrf = await fetch(BASE + '/api/auth/login', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: 'x', password: 'y' }),
})
check('CSRF-Schutz greift', noCsrf.status === 403)

const badLogin = await call('/api/auth/login', {
  method: 'POST', body: JSON.stringify({ username: USER, password: 'definitiv-falsch-xyz' }),
})
check('Falsches Passwort abgelehnt', badLogin.status === 401)

if (!PASS) {
  console.log('\n  … Übersprungen: kein Passwort angegeben (Argument 3 oder JARVIS_OWNER_PASSWORD).')
  console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`)
  process.exit(fail ? 1 : 0)
}

const login = await call('/api/auth/login', {
  method: 'POST', body: JSON.stringify({ username: USER, password: PASS }),
})
check('Anmeldung', login.status === 200, login.body?.user?.role)
if (login.status !== 200) { console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`); process.exit(1) }

const status = await call('/api/status')
check('Status abrufbar', status.status === 200)
if (status.body?.status) {
  for (const c of status.body.status.components) {
    console.log(`      ${c.status.padEnd(15)} ${c.name}`)
  }
  check('Audit-Hash-Kette intakt', status.body.status.audit.chain_valid === true)
}

const search = await call('/api/search', {
  method: 'POST', body: JSON.stringify({ query: 'Fahrstunde Preis', limit: 5 }),
})
check('Suche liefert Ergebnis', search.status === 200,
  `${search.body?.citations?.length ?? 0} Treffer, Abdeckung ${search.body?.coverage}`)
if (search.body?.citations?.length) {
  check('Jede Fundstelle hat eine Ortsangabe',
    search.body.citations.every((c) => typeof c.loc === 'string' && c.loc.length > 2))
}

// Chat stream: the whole point is that it terminates with a `done` event.
const chatRes = await fetch(BASE + '/api/chat', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-jarvis-client': 'smoke', cookie },
  body: JSON.stringify({ message: 'Was kostet eine Fahrstunde?', mode: 'concise', allow_web: false, language: 'de' }),
})
let sawDone = false, sawText = false, sawCitations = false
if (chatRes.body) {
  const reader = chatRes.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let i
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const frame = buf.slice(0, i); buf = buf.slice(i + 2)
      for (const line of frame.split('\n')) {
        if (!line.startsWith('data: ')) continue
        try {
          const e = JSON.parse(line.slice(6))
          if (e.type === 'text') sawText = true
          if (e.type === 'citations') sawCitations = true
          if (e.type === 'done') sawDone = true
        } catch { /* partial */ }
      }
    }
  }
}
check('Chat-Stream liefert Text', sawText)
check('Chat-Stream liefert Zitate', sawCitations)
check('Chat-Stream endet sauber', sawDone)

const actions = await call('/api/actions')
check('Freigaben abrufbar', actions.status === 200, `${actions.body?.pending?.length ?? 0} offen`)

const tools = await call('/api/tools')
check('Werkzeugliste abrufbar', tools.status === 200, `${tools.body?.tools?.length ?? 0} Werkzeuge`)
if (tools.body?.tools) {
  const email = tools.body.tools.find((t) => t.name === 'send_email')
  check('send_email ist als external_comm klassifiziert', email?.risk === 'external_comm')
}

await call('/api/auth/logout', { method: 'POST' })
const afterLogout = await call('/api/status')
check('Sitzung nach Abmeldung ungültig', afterLogout.status === 401)

console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`)
process.exit(fail ? 1 : 0)
