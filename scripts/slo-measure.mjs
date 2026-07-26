/**
 * PROMPT -1 §21 (Phase 4) – SLO-Messung gegen den ECHTEN Server.
 *
 * ## Warum ein eigenes Skript und nicht ein Test
 *
 * §21 verlangt Zahlen, nicht Zusicherungen. Ein vitest-Lauf mit `app.inject()`
 * würde den HTTP-Stack überspringen und damit genau den Teil weglassen, der die
 * Latenz erzeugt (Parsen, Kopfzeilen, Serialisierung, Socket). Dieses Skript
 * startet deshalb den echten `buildApp`-Server auf einem Port und misst über
 * `fetch` – dieselbe Strecke, die ein Browser nimmt.
 *
 * ## Was gemessen wird, und mit welcher Methode
 *
 * | SLO (§21) | Methode | Stichprobe |
 * |---|---|---|
 * | p50/p95/p99-Latenz je Endpunkt | Einzelanfragen über `fetch`, `performance.now()` | je Endpunkt konfigurierbar (Standard 200) |
 * | max. Synchronisationsverzögerung | Commit -> `realtime_deliveries.created_at` | je Buchung |
 * | max. Warteschlangenverzögerung | `jobs.created_at` -> `jobs.finished_at` | alle Jobs eines Durchlaufs |
 * | Buchungsfehlerquote | Anteil 5xx an allen Buchungsversuchen | alle Versuche |
 * | Wiederherstellzeit nach Reconnect | `GET /sync/changes` mit altem Cursor | 20 Wiederholungen |
 *
 * ## Was NICHT gemessen werden kann, und warum
 *
 * **Verfügbarkeit** braucht Beobachtung über Zeit aus mehreren Netzen – ein
 * Einzelprozess kann sie nicht messen, nur behaupten. **RPO/RTO** kommen aus dem
 * Wiederherstellungstest (§14), nicht von hier. Beides steht im
 * `docs/slo-dashboard.md` ausdrücklich als „braucht Produktionstelemetrie".
 *
 * ## Ehrlichkeit über die Umgebung
 *
 * Die Zahlen stammen aus EINER Sandbox mit lokalem Postgres auf derselben
 * Maschine, ohne Netzlatenz, ohne konkurrierende Nutzer und ohne TLS. Sie sind
 * eine Untergrenze für die Serverarbeit, KEINE Vorhersage der Nutzererfahrung.
 * Genau so gehören sie in den Bericht.
 *
 * Benutzung:
 *   DATABASE_URL=... node --experimental-strip-types scripts/slo-measure.mjs
 *   (bzw. `npx tsx scripts/slo-measure.mjs`)
 */
import { randomUUID } from "node:crypto";
import { buildApp } from "../apps/api/src/app.ts";
import { createRawClient, runMigrations } from "../packages/database/src/index.ts";
import { generateTotpSecret, generateTotpToken, hashPassword } from "../packages/auth/src/index.ts";
import { createScheduler } from "../apps/api/src/workers/scheduler.ts";
import { getDb } from "../apps/api/src/db.ts";
import { createNotificationsAdapter } from "../packages/integrations/src/index.ts";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL fehlt");
const PORT = Number(process.env.SLO_PORT ?? 4599);
const N = Number(process.env.SLO_SAMPLES ?? 200);
const BOOKINGS = Number(process.env.SLO_BOOKINGS ?? 120);
const BASE = `http://127.0.0.1:${PORT}`;

function quantile(sorted, q) {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[idx];
}
function stats(values) {
  const s = [...values].sort((a, b) => a - b);
  return {
    n: s.length,
    min: +(s[0] ?? 0).toFixed(2),
    p50: +(quantile(s, 0.5) ?? 0).toFixed(2),
    p95: +(quantile(s, 0.95) ?? 0).toFixed(2),
    p99: +(quantile(s, 0.99) ?? 0).toFixed(2),
    max: +(s[s.length - 1] ?? 0).toFixed(2),
    mittel: +(s.reduce((a, b) => a + b, 0) / (s.length || 1)).toFixed(2),
  };
}

async function timed(fn) {
  const t0 = performance.now();
  const res = await fn();
  return { ms: performance.now() - t0, res };
}

const schritt = (text) => process.stderr.write(`[slo] ${text}\n`);

const sql = createRawClient(DATABASE_URL);
schritt("Migrationen prüfen");
await runMigrations(DATABASE_URL);

// ---------------------------------------------------------------------------
// Messumgebung: eigene Organisation, damit die Messung von Seed-Daten
// unabhängig ist und wiederholbar bleibt.
// ---------------------------------------------------------------------------
/** Alle Messungen beziehen sich ausschließlich auf Daten AB diesem Zeitpunkt. */
const laufBeginn = new Date();
const marker = randomUUID().slice(0, 8);
const password = "SLO-Messung-2026!";
const passwordHash = await hashPassword(password);
const bueroSecret = generateTotpSecret();

const [org] = await sql`insert into organisationen (name) values (${`SLO-${marker}`}) returning id`;
const [standort] = await sql`insert into standorte (organisation_id, name) values (${org.id}, ${`SLO-${marker}`}) returning id`;
const [lehrerUser] = await sql`
  insert into benutzer (standort_id, email, password_hash, rolle, vorname, nachname)
  values (${standort.id}, ${`slo-fl-${marker}@test.local`}, ${passwordHash}, 'fahrlehrer', 'SLO', 'Lehrer')
  returning id`;
const [schuelerUser] = await sql`
  insert into benutzer (standort_id, email, password_hash, rolle, vorname, nachname)
  values (${standort.id}, ${`slo-sch-${marker}@test.local`}, ${passwordHash}, 'schueler', 'SLO', 'Schuelerin')
  returning id`;
const [bueroUser] = await sql`
  insert into benutzer (standort_id, email, password_hash, rolle, vorname, nachname, mfa_enabled, mfa_secret)
  values (${standort.id}, ${`slo-bu-${marker}@test.local`}, ${passwordHash}, 'buero', 'SLO', 'Buero', true, ${bueroSecret})
  returning id`;
const [lehrer] = await sql`
  insert into fahrlehrer (standort_id, benutzer_id, vorname, nachname, klassen)
  values (${standort.id}, ${lehrerUser.id}, 'SLO', 'Lehrer', '["B"]'::jsonb) returning id`;
const [schueler] = await sql`
  insert into schueler (standort_id, benutzer_id, vorname, nachname)
  values (${standort.id}, ${schuelerUser.id}, 'SLO', 'Schuelerin') returning id`;
await sql`insert into ausbildungen (standort_id, schueler_id, klasse) values (${standort.id}, ${schueler.id}, 'B')`;
const [fahrzeug] = await sql`
  insert into fahrzeuge (standort_id, kennzeichen, klasse, bezeichnung)
  values (${standort.id}, ${`SLO-${marker}`}, 'B', 'SLO-Wagen') returning id`;

// ---------------------------------------------------------------------------
// Der echte Server. Bewusst OHNE Scheduler: die Worker-Läufe werden einzeln
// getrieben, damit die Sync-Verzögerung MESSBAR und nicht vom Zufall des
// Taktes abhängig ist.
// ---------------------------------------------------------------------------
/**
 * ## Warum die Ratenbegrenzung für die LATENZMESSUNG weit gestellt ist
 *
 * Mit den Produktionsvorgaben (`write`: 5/s, Stoß 60) laufen 120
 * aufeinanderfolgende Buchungen in HTTP 429. Eine 429 ist billig – sie wird im
 * `onRequest`-Hook abgewiesen, ohne jede Datenbankarbeit. Gemessene Latenzen
 * wären damit eine Mischung aus echter Serverarbeit und schnellen Ablehnungen
 * und würden die Wahrheit VERSCHÖNERN.
 *
 * Deshalb zwei getrennte Aussagen, die nicht vermischt werden:
 *   1. LATENZ = Serverarbeit, gemessen mit weit gestellten Kontingenten (hier).
 *   2. DURCHSATZOBERGRENZE = die konfigurierten Kontingente selbst. Sie sind
 *      Konfiguration, keine Messgröße, und werden weiter unten mit einer
 *      eigenen Sonde nur BESTÄTIGT (`ergebnis.grenzen`).
 */
const MESS_RATE_LIMIT = {
  enabled: true,
  policies: {
    login: { name: "login", ratePerSecond: 500, burst: 5000 },
    write: { name: "write", ratePerSecond: 2000, burst: 20000 },
    read: { name: "read", ratePerSecond: 5000, burst: 50000 },
    stream: { name: "stream", ratePerSecond: 500, burst: 5000 },
    expensive: { name: "expensive", ratePerSecond: 500, burst: 5000 },
  },
};

/**
 * `forceCloseConnections`: `fetch` (undici) hält Verbindungen per keep-alive
 * offen. Fastify wartet beim Schließen darauf – ein Messskript würde am Ende
 * scheinbar hängen. Das ist eine Eigenschaft DIESES Werkzeugs, nicht des
 * Servers: im Betrieb ist das Warten auf offene Verbindungen richtig.
 */
const app = buildApp({
  databaseUrl: DATABASE_URL,
  cookieSecure: false,
  logger: false,
  accessLog: false,
  startWorkers: false,
  corsOrigins: [BASE],
  rateLimit: MESS_RATE_LIMIT,
  forceCloseConnections: true,
});
schritt(`Messserver auf Port ${PORT} starten`);
await app.listen({ port: PORT, host: "127.0.0.1" });

async function login(email, totpSecret) {
  const body = { email, password };
  if (totpSecret) body.totpToken = generateTotpToken(totpSecret);
  const res = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`login ${email}: ${res.status} ${await res.text()}`);
  return res.headers.getSetCookie()[0].split(";")[0];
}

const ergebnis = { umgebung: {}, latenz: {}, sync: {}, warteschlange: {}, fehlerquote: {}, reconnect: {} };

const lehrerCookie = await login(`slo-fl-${marker}@test.local`);
const schuelerCookie = await login(`slo-sch-${marker}@test.local`);
const bueroCookie = await login(`slo-bu-${marker}@test.local`, bueroSecret);

// ---------------------------------------------------------------------------
// 1. Latenz je Endpunkt
// ---------------------------------------------------------------------------
const leseEndpunkte = [
  ["GET /health", "/health", null],
  ["GET /health/ready", "/health/ready", null],
  ["GET /me", "/me", schuelerCookie],
  ["GET /appointments/mine", "/appointments/mine", schuelerCookie],
  ["GET /documents/mine", "/documents/mine", schuelerCookie],
  ["GET /sync/cursor", "/sync/cursor", schuelerCookie],
  ["GET /sync/changes", "/sync/changes?cursor=0", schuelerCookie],
  ["GET /office/heute", "/office/heute", bueroCookie],
  ["GET /health/deep", "/health/deep", null],
  ["GET /metrics", "/metrics", null],
];

schritt("1. Leselatenz");
for (const [name, pfad, cookie] of leseEndpunkte) {
  const werte = [];
  const codes = {};
  // Aufwärmen: der erste Aufruf trägt JIT- und Verbindungsaufbau und würde p99
  // verfälschen.
  for (let i = 0; i < 5; i += 1) await fetch(`${BASE}${pfad}`, { headers: cookie ? { cookie } : {} });
  for (let i = 0; i < N; i += 1) {
    const { ms, res } = await timed(() => fetch(`${BASE}${pfad}`, { headers: cookie ? { cookie } : {} }));
    await res.text();
    werte.push(ms);
    codes[res.status] = (codes[res.status] ?? 0) + 1;
  }
  ergebnis.latenz[name] = { ...stats(werte), codes };
  process.stderr.write(`  ${name}: p95=${ergebnis.latenz[name].p95} ms\n`);
}

// ---------------------------------------------------------------------------
// 2. Schreiblatenz + Buchungsfehlerquote (der kritische Pfad)
// ---------------------------------------------------------------------------
schritt("2. Schreiblatenz + Buchungsfehlerquote");
const schreibWerte = [];
const buchungCodes = {};
const buchungsIds = [];
for (let i = 0; i < BOOKINGS; i += 1) {
  const tag = 1 + (i % 27);
  const monat = 1 + Math.floor(i / 27);
  const beginn = new Date(Date.UTC(2027, monat, tag, 8 + (i % 8), 0, 0)).toISOString();
  const ende = new Date(Date.UTC(2027, monat, tag, 9 + (i % 8), 0, 0)).toISOString();
  const { ms, res } = await timed(() =>
    fetch(`${BASE}/appointments`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: lehrerCookie, "idempotency-key": `slo-${marker}-${i}` },
      body: JSON.stringify({
        schuelerId: schueler.id,
        fahrlehrerId: lehrer.id,
        fahrzeugId: fahrzeug.id,
        beginnAt: beginn,
        endeAt: ende,
        art: "Übungsstunde",
        klasse: "B",
      }),
    }),
  );
  const koerper = await res.json().catch(() => ({}));
  schreibWerte.push(ms);
  buchungCodes[res.status] = (buchungCodes[res.status] ?? 0) + 1;
  if (res.status === 201 && koerper.booking) buchungsIds.push(koerper.booking.id);
}
ergebnis.latenz["POST /appointments"] = { ...stats(schreibWerte), codes: buchungCodes };
const gesamtBuchungen = Object.values(buchungCodes).reduce((a, b) => a + b, 0);
const fuenfxx = Object.entries(buchungCodes)
  .filter(([c]) => Number(c) >= 500)
  .reduce((a, [, n]) => a + n, 0);
const vierNullNeun = buchungCodes["409"] ?? 0;
ergebnis.fehlerquote = {
  buchungsversuche: gesamtBuchungen,
  erfolgreich: buchungCodes["201"] ?? 0,
  fachlicheKonflikte409: vierNullNeun,
  technischeFehler5xx: fuenfxx,
  technischeFehlerquote: +((fuenfxx / gesamtBuchungen) * 100).toFixed(4),
};
process.stderr.write(`  POST /appointments: p95=${ergebnis.latenz["POST /appointments"].p95} ms, 5xx=${fuenfxx}\n`);

// ---------------------------------------------------------------------------
// 3. Synchronisationsverzögerung: Commit -> Realtime-Zustellzeile
// ---------------------------------------------------------------------------
const scheduler = createScheduler(
  { db: getDb(DATABASE_URL), notifications: createNotificationsAdapter("mock") },
  { batchLimit: 200 },
);

schritt("3. Synchronisationsverzögerung");
// Rückstände aus früheren Läufen zuerst abarbeiten – sonst mischt sich ihre
// Wartezeit in die Messung dieses Laufs.
{
  let aufraeumen = 0;
  for (;;) {
    const offen = await sql`select count(*)::int as n from event_outbox
                             where status = 'pending' and created_at < ${laufBeginn}`;
    if (offen[0].n === 0 || aufraeumen > 40) break;
    await scheduler.runWorkTick();
    aufraeumen += 1;
  }
  if (aufraeumen > 0) schritt(`  (${aufraeumen} Aufräumdurchläufe für Altbestand)`);
}
const outboxVorher = await sql`select count(*)::int as n from event_outbox where status = 'pending'`;
const t0 = performance.now();
let durchlaeufe = 0;
for (;;) {
  await scheduler.runWorkTick();
  durchlaeufe += 1;
  const offen = await sql`select count(*)::int as n from event_outbox where status = 'pending'`;
  if (offen[0].n === 0 || durchlaeufe > 40) break;
}
const zustellDauerMs = performance.now() - t0;

/**
 * WICHTIG: nur Ereignisse DIESES Laufs. Ein früheres Fenster
 * (`now() - interval '30 minutes'`) fängt auch Ereignisse ein, die aus einem
 * abgebrochenen Lauf stammen und stundenlang unzugestellt lagen – der p95 wäre
 * dann eine Aussage über den Abbruch, nicht über die Zustellzeit. Ein
 * gemessener Wert, der die falsche Frage beantwortet, ist schlimmer als keiner.
 */
const verzoegerungen = await sql`
  select extract(epoch from (d.created_at - o.created_at)) * 1000 as ms
    from realtime_deliveries d join event_outbox o on o.id = d.event_id
   where o.created_at >= ${laufBeginn}`;
const werteMs = verzoegerungen.map((r) => Number(r.ms)).filter((n) => Number.isFinite(n));
ergebnis.sync = {
  ereignisseAmAnfang: outboxVorher[0].n,
  workerDurchlaeufe: durchlaeufe,
  zustellungGesamtMs: +zustellDauerMs.toFixed(0),
  verzoegerungCommitBisZustellzeileMs: stats(werteMs),
  hinweis:
    "Gemessen wird Commit -> realtime_deliveries.created_at. Die Zeit bis zum CLIENT " +
    "kommt zusätzlich hinzu: bei laufendem Stream <= pollIntervalMs (1 s), " +
    "im Polling-Rückfall <= dessen Intervall. Der dominierende Anteil ist der " +
    "Worker-Takt (Standard 5 s), nicht die Zustellarbeit.",
};

// ---------------------------------------------------------------------------
// 4. Warteschlangenverzögerung: Job angelegt -> Job beendet
// ---------------------------------------------------------------------------
schritt("4. Warteschlangenverzögerung");
await scheduler.runScheduleTick();
const jobT0 = performance.now();
for (let i = 0; i < 6; i += 1) await scheduler.runWorkTick();
const jobDauerMs = performance.now() - jobT0;
const jobVerzoegerungen = await sql`
  select job_type, extract(epoch from (finished_at - created_at)) * 1000 as ms
    from jobs where finished_at is not null and created_at >= ${laufBeginn}`;
ergebnis.warteschlange = {
  gemesseneJobs: jobVerzoegerungen.length,
  abarbeitungGesamtMs: +jobDauerMs.toFixed(0),
  verzoegerungAnlageBisEndeMs: stats(jobVerzoegerungen.map((r) => Number(r.ms)).filter(Number.isFinite)),
  jobTypen: [...new Set(jobVerzoegerungen.map((r) => r.job_type))].sort(),
  hinweis:
    "Enthält die Wartezeit auf den nächsten Takt. Bei getriebenen Takten (hier) " +
    "ist das nahe null; im Betrieb kommt bis zu einem Arbeitstakt (Standard 5 s) hinzu.",
};

// ---------------------------------------------------------------------------
// 5. Wiederherstellzeit nach Reconnect
// ---------------------------------------------------------------------------
schritt("5. Reconnect");
const cursorRes = await fetch(`${BASE}/sync/cursor`, { headers: { cookie: schuelerCookie } });
const { cursor: aktuellerCursor } = await cursorRes.json();
const reconnectWerte = [];
let nachgeholt = 0;
for (let i = 0; i < 20; i += 1) {
  const { ms, res } = await timed(() =>
    fetch(`${BASE}/sync/changes?cursor=0`, { headers: { cookie: schuelerCookie } }),
  );
  const body = await res.json();
  nachgeholt = body.changes?.length ?? 0;
  reconnectWerte.push(ms);
}
ergebnis.reconnect = {
  cursorStand: aktuellerCursor,
  nachgeholteAenderungenProAbruf: nachgeholt,
  dauerMs: stats(reconnectWerte),
  hinweis:
    "Reine Serverzeit für die Aufholabfrage ab Cursor 0. Die vollständige " +
    "Erholung im Client umfasst zusätzlich das Nachladen der betroffenen Themen " +
    "(je Thema ein autorisierter GET) – deren Latenz steht oben je Endpunkt.",
};

// ---------------------------------------------------------------------------
// 6. Durchsatzobergrenze: was lassen die PRODUKTIONSVORGABEN zu?
//
// Eigene Instanz mit den Standardpolitiken (`rateLimitConfigFromEnv`), damit die
// Zahl aus der tatsächlichen Konfiguration kommt und nicht aus einem Kommentar.
// Gemessen wird, wie viele Schreibvorgänge in Folge durchgehen, bevor die erste
// 429 kommt – das ist die Stoßgröße, die ein Client ausnutzen darf.
// ---------------------------------------------------------------------------
schritt("6. Durchsatzobergrenze");
const GRENZ_PORT = PORT + 1;
const GRENZ_BASE = `http://127.0.0.1:${GRENZ_PORT}`;
const grenzApp = buildApp({
  databaseUrl: DATABASE_URL,
  cookieSecure: false,
  logger: false,
  accessLog: false,
  startWorkers: false,
  corsOrigins: [GRENZ_BASE],
  forceCloseConnections: true,
});
await grenzApp.listen({ port: GRENZ_PORT, host: "127.0.0.1" });

let durchgelassen = 0;
let ersteAblehnungNach = null;
let retryAfter = null;
{
  const res0 = await fetch(`${GRENZ_BASE}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: `slo-fl-${marker}@test.local`, password }),
  });
  const cookie = res0.ok ? res0.headers.getSetCookie()[0].split(";")[0] : null;
  for (let i = 0; i < 200 && cookie; i += 1) {
    const res = await fetch(`${GRENZ_BASE}/appointments`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie, "idempotency-key": `grenz-${marker}-${i}` },
      body: JSON.stringify({
        schuelerId: schueler.id,
        fahrlehrerId: lehrer.id,
        fahrzeugId: fahrzeug.id,
        beginnAt: new Date(Date.UTC(2028, 0, 1 + (i % 28), 8, 0, 0)).toISOString(),
        endeAt: new Date(Date.UTC(2028, 0, 1 + (i % 28), 9, 0, 0)).toISOString(),
        art: "Übungsstunde",
        klasse: "B",
      }),
    });
    await res.text();
    if (res.status === 429) {
      ersteAblehnungNach = i;
      retryAfter = res.headers.get("retry-after");
      break;
    }
    durchgelassen += 1;
  }
}
await grenzApp.close();
ergebnis.grenzen = {
  politik: "write (Produktionsvorgabe: 5/s, Stoß 60)",
  aufeinanderfolgendeSchreibvorgaengeBisZur429: ersteAblehnungNach,
  durchgelassen,
  retryAfterSekunden: retryAfter,
  hinweis:
    "Das ist die gewollte Obergrenze, kein Fehler: sie schützt vor einem außer " +
    "Kontrolle geratenen Client. Sie gilt PRO PROZESS (kein gemeinsamer Zähler) – " +
    "bei n Instanzen also n-fach. Siehe docs/security-architecture.md, Abschnitt 2.",
};

// ---------------------------------------------------------------------------
// Umgebungsangaben
// ---------------------------------------------------------------------------
schritt("Umgebung erfassen");
const [pg] = await sql`select version() as v`;
const [groesse] = await sql`select pg_size_pretty(pg_database_size(current_database())) as s`;
ergebnis.umgebung = {
  gemessenAm: new Date().toISOString(),
  postgres: pg.v,
  datenbankGroesse: groesse.s,
  node: process.version,
  cpus: (await import("node:os")).cpus().length,
  stichprobeLesen: N,
  stichprobeSchreiben: BOOKINGS,
  hinweis:
    "Lokaler Postgres auf derselben Maschine, keine Netzlatenz, kein TLS, " +
    "kein Fremdverkehr. Untergrenze der Serverarbeit, keine Nutzerprognose.",
};

schritt("Aufräumen");
await app.close();
await sql.end();
console.log(JSON.stringify(ergebnis, null, 2));
// Undici hält einen Agent-Pool offen; ohne dieses Ende bleibt der Prozess
// hängen, obwohl alle Messungen fertig sind.
process.exit(0);
