# Sicherheitsarchitektur (PROMPT -1 §17)

Stand: Phase 3 (Defense in Depth, Beobachtbarkeit, degradierter Betrieb).
Branch `claude/driving-school-admin-tcz2cx`. Dieses Dokument beschreibt, was
**tatsächlich implementiert und getestet** ist – nicht, was vorgesehen wäre.
Jede Zusage nennt die Datei, die sie umsetzt, und den Test, der sie beweist.
Was Mock ist, steht als Mock hier (Abschnitt 12).

Begleitdokumente: `docs/failure-modes.md` (§11/§18),
`docs/sync-architecture.md` (§1–§10, §13, §19, Teil 3),
`docs/security-risks.md` (die Prototyp-Befunde, gegen die hier gearbeitet wird),
`docs/role-permission-matrix.md` (Rollen), `docs/integration-gaps.md` (kein
echter Anbieter in dieser Umgebung).

---

## 1. Bedrohungsmodell

Kein generisches OWASP-Abschreiben, sondern die Angreifer, die für **eine
Fahrschule mit vier Apps, einem Postgres und einer Handvoll Mitarbeitenden**
realistisch sind – mit der jeweils wirksamen Maßnahme und ihrer Grenze.

| # | Angreifer / Szenario | Was er erreichen will | Wirksame Maßnahme | Bekannte Grenze |
|---|---|---|---|---|
| A1 | **Fremder im Internet** ohne Konto | Zugriff auf Schülerdaten | Serverseitige Autorisierung auf JEDER Route (`requireAuth` + `requirePermission`, Wächtertest in `code-guards.test.ts`), keine öffentliche Downloadroute, Rate Limiting | Kein WAF, kein DDoS-Schutz – gehört auf die Infrastrukturebene |
| A2 | **Passwortraten** gegen ein bekanntes Konto | Übernahme eines Büro-/Fahrlehrerkontos | Progressive Verzögerung + zeitlich begrenzte Kontosperre + harte IP-Sperre (`lib/brute-force.ts`, persistiert in `auth_throttle`), MFA für alle Mitarbeitendenrollen | Kein Geräte-/Standort-Fingerprint; ein verteilter Angriff über viele IPs bremst nur am Kontozweig |
| A3 | **Denial-of-Service gegen EINEN Menschen** ("sperr die Büroleiterin aus") | Betriebsstörung | Der Kontozweig sperrt **kurz** (15 Min.) und läuft von selbst ab; die harte Sperre hängt an der **IP** des Angreifers; Entsperrpfad `POST /auth/unlock` | Ein hartnäckiger Angreifer kann ein Konto in 15-Minuten-Fenstern wiederholt sperren. Bewusst akzeptiert – die Alternative (dauerhafte Sperre) wäre schlimmer. Siehe Abschnitt 3. |
| A4 | **Fremde Webseite**, die den Browser eines eingeloggten Nutzers benutzt | Schreibvorgang im Namen des Opfers (CSRF) | `SameSite=Lax`-Sitzungscookie + Origin-/`Sec-Fetch-Site`-Prüfung + HMAC-gebundenes Double-Submit-Token (`lib/csrf.ts`) | Ein Aufruf ganz ohne Browsersignale wird durchgelassen (siehe Abschnitt 4) |
| A5 | **XSS** (eingeschleustes Skript in einer der vier Apps) | Sitzungsübernahme, Auslesen der **verschlüsselten lokalen Entwürfe** | CSP ohne `unsafe-inline`/`unsafe-eval` für Skripte, als HTTP-Kopfzeile UND als `<meta>` in allen vier `index.html` (`lib/security-headers.ts`) | Die AES-Verschlüsselung der Entwürfe schützt **nicht** gegen XSS – das war Phase 2s dokumentierte Lücke, und die CSP ist genau ihre Gegenmaßnahme. Ein CSP-Bypass in einer Browserversion bleibt möglich. |
| A6 | **Kompromittierter Client** (echtes Konto, manipulierte App) | Fremde Datensätze lesen/ändern | Jede Ressource wird gegen die **Datenbank** aufgelöst, nicht gegen eine Client-Angabe; `own`-Scope über `getOwnSchuelerId`/`getOwnFahrlehrerId`; Standortfilter serverseitig | – (getestet: `security.test.ts`, Abschnitt „Ein kompromittierter Client…") |
| A7 | **Unbeaufsichtigtes Bürogerät** | Hochwirksame Aktion mit fremder Sitzung | **Step-up-Authentisierung** für sieben Aktionen (Abschnitt 6) | Alles außerhalb der sieben bleibt ohne zweite Hürde – bewusst, siehe Abschnitt 6 |
| A8 | **Insider**, der eine Spur beseitigen will | Audit-Log ändern/löschen | `audit_events` ist append-only (Trigger, SQLSTATE FS008) **und** hash-verkettet (`prev_hash`/`row_hash`) | Das Löschen eines Kettenblattes ist mit der Hash-Kette allein nicht erkennbar – dagegen wirkt der Trigger. Siehe Abschnitt 8. |
| A9 | **Bösartiger Upload** | Schadcode ausliefern, Speicher füllen | Magic-Byte-Prüfung, Quarantäne zuerst, Freigabe nur nach saubere Scan, Prüfsumme, Größenlimit, `Content-Disposition: attachment`, `nosniff` | Der Malware-Scanner ist ein **Mock** (Abschnitt 12) – die Kette ist echt, der Scanner nicht |
| A10 | **Mitlesen des Netzverkehrs** | Sitzungscookie, Dokumente | `Secure`-Cookie + HSTS, sobald HTTPS gemeldet ist (`cookieSecure`/`https`) | Kein TLS in dieser Umgebung – Terminierung ist Betriebssache |
| A11 | **Log-/Metrikleck** | Personenbezogene Daten aus Betriebsdaten gewinnen | Redaktion vor dem Schreiben, pseudonymisierte Akteurs-IDs, geschlossene Label-Menge (`lib/observability.ts`, `lib/metrics.ts`) | `/metrics` verrät Betriebs**volumen** (Geschäftsgeheimnis, kein Personenbezug) – gehört ins interne Netz |
| A12 | **Weitergegebener Download-Link** | Fremdes Dokument sehen | Signatur ist an `benutzerId` gebunden, kurzlebig (5 Min.), und der Endpunkt prüft Sitzung + Eigentum **zusätzlich** gegen die DB | Eine ausgegebene Signatur ist vor Ablauf nicht widerrufbar; `logout-all` wirkt trotzdem sofort, weil der Endpunkt eine Sitzung verlangt |

**Ausdrücklich nicht im Modell:** physischer Zugriff auf den Datenbankserver,
ein bösartiger Datenbankadministrator mit Dateisystemzugriff, und
Lieferkettenangriffe auf npm-Pakete jenseits des Abhängigkeitsscans
(Abschnitt 11).

---

## 2. Rate Limiting

**Vorher gab es keines.** Die unabhängige Prompt-5-Review hat das als Bedingung
Nr. 1 vor Produktivbetrieb festgehalten (`docs/final-release-report.md` §7).

**Datei:** `apps/api/src/lib/rate-limit.ts`, verdrahtet in
`apps/api/src/middleware/security.ts`.

### Mechanismus

**Token-Bucket**, nicht Festfenster. Grund: ein Festfenster wirft genau am
Fensterrand legitime Stöße weg. Zwei Stöße sind in diesem System ausdrücklich
legitim und werden getestet:

- **Chaos-Szenario 2** (Phase 4): „dieselbe Anfrage zehnmal" – der
  Idempotenzbeweis. Getestet in `security.test.ts` („lässt einen LEGITIMEN Stoß
  durch"): zehn identische `POST /appointments` mit demselben Schlüssel, **kein
  429**, genau eine Buchung.
- **Chaos-Szenario 3**: „zwei Schüler nehmen gleichzeitig denselben Slot" –
  beide Anfragen müssen den Server erreichen, damit der `EXCLUDE`-Constraint
  entscheidet und nicht der Limiter.

### Zwei Dimensionen

| Dimension | Schlüssel | Hook | Warum |
|---|---|---|---|
| IP | `ip:<politik>:<request.ip>` | `onRequest` (vor dem Sitzungs-Lookup) | Ein Angriffsversuch soll keine DB-Abfrage kosten |
| Konto | `acct:<politik>:<benutzerId>` (Eimer ×1,5) | `preHandler` (nach dem Sitzungs-Lookup) | In einer Fahrschule sitzen Büro und Fahrlehrer hinter **einer** NAT-IP; ein reines IP-Limit wäre entweder wirkungslos oder eine Selbstsperre |

Jede Dimension wird **genau einmal** je Anfrage belastet (`checkIp` /
`checkAccount`).

### Politiken

| Politik | Standard | Gilt für |
|---|---|---|
| `login` | 0,2/s, Stoß 10 | `POST /auth/login`, `POST /auth/step-up` |
| `write` | 5/s, Stoß 60 | alles Schreibende (Standard für **neue** Routen) |
| `read` | 20/s, Stoß 200 | alles Lesende |
| `stream` | 0,5/s, Stoß 12 | `GET /sync/stream` – **eigene** Politik, weil eine langlebige Verbindung mit Kontingenten für kurze Anfragen nichts zu tun hat (Phase-2-Übergabe) |
| `expensive` | 0,5/s, Stoß 15 | `POST /finance/exports`, `POST /ops/consistency/run` |

Alle Werte sind über Umgebungsvariablen konfigurierbar
(`RATE_LIMIT_LOGIN_RPS`, `…_BURST`, `RATE_LIMIT_MULTIPLIER`), abschaltbar über
`RATE_LIMIT_ENABLED=0`. **Kein Zahlenwert steht in einer Route.**

### Antwortvertrag

HTTP **429** mit `Retry-After` (Sekunden, immer ≥ 1),
`X-RateLimit-Policy/-Scope/-Remaining`. Phase 2s Client liest genau diesen
Header (`parseRetryAfterMs` in `packages/sync/src/retry-client.ts`) und
klassifiziert 429 als `RATE_LIMITED` = transient-wiederholbar
(`packages/events/src/retry.ts`). **Server und Client sind ohne zweite
Absprache konsistent** – das war die ausdrückliche Anforderung.

### Ehrliche Einschränkung

Die Zähler liegen im **Prozessspeicher**. Bei mehreren API-Instanzen gilt das
Limit je Instanz. Ein gemeinsamer Speicher (Redis) existiert in dieser
Umgebung nicht; `InMemoryRateLimitStore` ist der Einhängepunkt, seine
Schnittstelle ist bewusst so schmal, dass eine Redis-Variante keine
Aufrufstelle ändert. **Die Sicherheitsaussage hängt nicht daran:** der
Brute-Force-Schutz ist separat und persistiert (Abschnitt 3).

### <a id="runbook-rate-limiting"></a>Runbook: Rate-Limit-Flut

1. `GET /metrics` → `fahrschul_rate_limited_total{scope,route}`. Steigt eine
   einzelne Route stark, ist meist ein **Limit falsch gesetzt**, nicht ein
   Angriff.
2. Betroffene Route und Geltungsbereich ablesen. Bei `scope="account"`: ein
   Client in einer Schleife (Bug), nicht ein Angreifer.
3. Kurzfristig lockern: `RATE_LIMIT_MULTIPLIER=3` und Neustart. Das skaliert
   **alle** Politiken – gezielt geht es über die einzelne Variable.
4. Keine automatische Eskalation. Zuständig: Rolle `systemdienst`.

---

## 3. Brute-Force-Schutz – und die Abwägung, die dahintersteht

**Datei:** `apps/api/src/lib/brute-force.ts`, Tabelle `auth_throttle`
(Migration 0009).

### Das Problem mit dem Standardvorschlag

Eine harte Kontosperre nach N Fehlversuchen ist der Standardvorschlag – und
gleichzeitig ein fertiger **Denial-of-Service gegen einen bekannten Menschen**.
Wer die E-Mail der Büroleiterin kennt, sperrt sie mit fünf falschen Passwörtern
aus, jeden Morgen um 7:55. In einer Fahrschule mit einer Handvoll
Mitarbeitenden ist das der **wahrscheinlichere** Angriff als das Passwortraten
selbst.

### Die Entscheidung: zwei asymmetrische Zweige

| Zweig | Mechanismus | Wirkt gegen | Kollateralschaden |
|---|---|---|---|
| **Konto** (E-Mail) | progressive Verzögerung ab dem 4. Fehlversuch (0,5 s → 1 s → 2 s → 4 s, gekappt); **kurze** Sperre erst ab dem 12. Fehlversuch, dann 15 Minuten | verteiltes Raten auf ein Konto | begrenzt: Sperre ≤ 15 Min., läuft von selbst ab |
| **IP** | harte, **exponentiell wachsende** Sperre ab dem 20. Fehlversuch: 15 Min. → 30 → 60 … bis 24 h | ein Angreifer, der viel probiert | trifft nur seine eigene Herkunft |

**Warum Verzögerung statt Sperre der Hauptmechanismus ist:** sie senkt den
Durchsatz eines Online-Rateangriffs um Größenordnungen (aus 1000 Versuchen/Min.
werden 15) und kostet den echten Nutzer maximal vier Sekunden. Eine Sperre
kostet ihn 15 Minuten und den Angreifer fast nichts.

**Warum die Sperre trotzdem existiert:** Passwortprüfung ist absichtlich teuer
(argon2). Ohne Obergrenze wäre der Login ein Rechenzeit-Verstärker.

**Weitere Eigenschaften:**

- **Erfolg löscht den Kontozähler sofort** – nicht den IP-Zähler. Ein
  Angreifer, der zufällig ein gültiges Konto trifft, setzt damit sein
  IP-Budget nicht zurück.
- **Fenster, keine Lebenszeitsumme:** nach 15 Minuten ohne Fehlversuch beginnt
  die Zählung neu.
- **Kein Enumerationsorakel:** `registerLoginFailure` läuft auch für
  unbekannte E-Mails, und die Sperrantwort ist für existierende und nicht
  existierende Konten identisch (`429 account_temporarily_locked` +
  `Retry-After`). Getestet.
- **Die Prüfung steht VOR der Passwortverifikation** – der Angreifer soll die
  argon2-Kosten nicht beliebig oft auslösen können.
- **Persistiert, nicht im Prozessspeicher:** ein Neustart darf einen laufenden
  Angriff nicht zurücksetzen, und mehrere Instanzen brauchen eine Sicht.
- **`POST /auth/step-up` zählt in denselben Zähler.** Ein Step-up-Endpunkt ohne
  Sperre wäre ein Passwort-Orakel mit gültiger Sitzung.

### Entsperrpfad (drei Wege, absteigend nach Selbstbedienung)

1. **Warten.** Jede Sperre hat ein Ende; die Antwort nennt es über
   `Retry-After`.
2. **Anderes Netz/Gerät.** Weil die harte Sperre am IP-Zweig hängt und die
   Kontosperre kurz ist, ist niemand dauerhaft ausgeschlossen.
3. **`POST /auth/unlock`** durch die Rolle `systemdienst`
   (`users:manage`) **mit Step-up**, auditiert. Der Audit-Eintrag enthält
   bewusst **nicht** die E-Mail im Klartext (nur Geltungsbereich und Anzahl) –
   ein Audit-Log ist kein zweiter Ort für personenbezogene Daten.

Betriebsansichten: `GET /auth/locks` und `GET /ops/auth/locks`.

### <a id="runbook-brute-force"></a>Runbook: Brute-Force / Anmeldesperren

1. Alarm `brute_force_lockout` (Katalog: `workers/alarm.ts`). Schwelle: > 5
   Sperren derselben IP in einer Stunde.
2. `GET /ops/auth/locks` → welche Geltungsbereiche sind gesperrt, wie oft
   (`lock_count`), seit wann.
3. `GET /metrics` → `fahrschul_login_failures_total{reason}`.
   `reason="unknown_account"` in Masse = Enumerationsversuch;
   `reason="wrong_password"` auf **ein** Konto = zielgerichteter Angriff.
4. Bei zielgerichtetem Angriff auf ein Konto: die betroffene Person
   informieren, Passwortwechsel veranlassen, **nicht** entsperren, solange der
   Angriff läuft.
5. Bei Fehlalarm (Mitarbeitende hat sich vertippt und wartet):
   `POST /auth/unlock` mit `scope: "account"`.
6. Eskalation nach drei Wiederholungen an die Geschäftsführung.
7. Aufräumen abgelaufener Zeilen: `POST /ops/auth/locks/purge` (Step-up).

---

## 4. CSRF

**Datei:** `apps/api/src/lib/csrf.ts`.

Die Sitzung hängt an einem httpOnly-Cookie (bewusste Phase-0-Entscheidung: kein
Token im JS-Zugriff). Genau diese Entscheidung macht CSRF relevant.

### Die Regel in einem Satz

> Ein zustandsändernder Aufruf muss **mindestens einen positiven Beweis**
> liefern, dass er von der eigenen Anwendung stammt – und darf **keinen
> Gegenbeweis** liefern.

**Positive Beweise** (einer genügt):

1. `Origin` (oder aus `Referer` abgeleitet) auf derselben Allowlist, die auch
   CORS benutzt. Moderne Browser senden `Origin` bei **jedem**
   POST/PUT/PATCH/DELETE, auch same-origin.
2. `Sec-Fetch-Site: same-origin` oder `same-site` – von allen aktuellen
   Browsern gesetzt und vom Seiteninhalt **nicht fälschbar** (verbotener
   Header).
3. Double-Submit-Token, per HMAC an **diese** Sitzung gebunden
   (`nonce.HMAC(nonce, sessionToken)`).

**Gegenbeweise** (führen zu **403**, und sie schlagen jeden positiven Beweis –
sonst könnte ein Angreifer einen gültigen Beweis „dazulegen"):

- `Origin`/`Referer` vorhanden, aber nicht auf der Allowlist (`origin` = `null`
  aus einem sandboxed iframe gilt ebenfalls als nicht erlaubt),
- `Sec-Fetch-Site: cross-site`,
- Token vorhanden, aber Cookie ≠ Header oder HMAC passt nicht zur Sitzung.

### Warum HMAC-gebunden und nicht „Cookie == Header"

Reines Double-Submit ist gegen eine Subdomain, die Cookies für die Hauptdomain
setzen kann, wirkungslos – der Angreifer setzt beide Seiten selbst. Der Token
hier ist nur gültig, wenn er zu **genau dieser** Sitzung gehört; das
Sitzungsgeheimnis ist httpOnly und für ihn unerreichbar. Getestet.

### Der Fall „gar kein Signal" – ehrlich benannt

Fehlen `Origin`, `Referer`, `Sec-Fetch-Site` **und** Token vollständig, stammt
der Aufruf nicht aus einem Browser (jeder Browser seit ~2020 sendet bei einem
zustandsändernden Aufruf mindestens eines der ersten beiden). Ein
Nicht-Browser-Client kann per Definition nicht CSRF-geopfert werden. Solche
Aufrufe werden **durchgelassen und protokolliert** (`csrfProof:
"kein_browsersignal"` in jeder Zugriffszeile – damit dieser Pfad nicht
unbemerkt zur Regel wird).

**Restrisiko:** ein sehr alter Browser ohne `Origin`-auf-same-origin-POST, ohne
`Sec-Fetch-*` **und** ohne SameSite-Unterstützung käme hier durch. Dagegen
wirkt die dritte, unabhängige Lage: das Sitzungscookie ist `SameSite=Lax`, ein
fremdinitiierter POST bekommt es gar nicht mitgeschickt und ist dann
unauthentifiziert (401). Die Alternative – signalfreie Aufrufe pauschal
ablehnen – würde jede Server-zu-Server-Integration und jedes Betriebsskript
aussperren, ohne die Angriffsfläche gegenüber SameSite messbar zu verkleinern.

**Ausnahmen:** `GET/HEAD/OPTIONS` (keine Seiteneffekte – ein Wächtertest prüft,
dass keine GET-Route schreibt), `POST /auth/login` (es gibt noch keine Sitzung,
an die ein Token gebunden werden könnte; hier tragen Origin-Prüfung, SameSite
und der Brute-Force-Schutz).

**Token abholen:** `GET /auth/csrf` (auch direkt in der Login-Antwort
enthalten). `POST /auth/logout-all` macht jeden ausgegebenen Token ungültig,
weil er an den Sitzungstoken gebunden ist. Getestet.

---

## 5. Content Security Policy

**Datei:** `apps/api/src/lib/security-headers.ts` (Kopfzeile) und
`apps/{student,office,instructor,finance}/index.html` (`<meta http-equiv>`).

### Warum das hier die wichtigste Maßnahme ist

Phase 2 speichert lokale Entwürfe AES-256-GCM-verschlüsselt (Schlüssel je
Gerät + Benutzer). Das schützt gegen Speicherinspektion, Backups und
Support-Exporte – und **ausdrücklich nicht gegen XSS**: Code, der in der Seite
läuft, hat denselben Schlüsselzugriff wie die App. Diese Lücke steht so in
`docs/sync-architecture.md`. Die CSP ist der dort benannte, bis Phase 3 offene
Seam.

### Die Politik

```
default-src 'none';
script-src 'self'; script-src-attr 'none';
style-src 'self' 'unsafe-inline'; style-src-elem 'self'; style-src-attr 'unsafe-inline';
img-src 'self' data: blob:; font-src 'self' data:;
connect-src 'self' <CORS-Allowlist>;
manifest-src 'self'; worker-src 'self' blob:; media-src 'self' blob:;
object-src 'none'; frame-src 'none'; child-src 'none'; frame-ancestors 'none';
base-uri 'none'; form-action 'self';
[upgrade-insecure-requests bei HTTPS]
```

**Kein `unsafe-inline`, kein `unsafe-eval` für Skripte** – kein
Escape-Ventil, das die CSP wertlos machen würde. Das ist keine Annahme:
`apps/*/dist/index.html` enthält nach dem Vite-Build genau **ein** Element,
`<script type="module" crossorigin src="/assets/index-<hash>.js">`, und kein
Inline-Skript. Nach dem Build erneut geprüft (Abschnitt „Definition of done").

**Zwei begründete Ausnahmen:**

1. `style-src 'unsafe-inline'` bzw. präziser `style-src-attr 'unsafe-inline'`:
   vier Dateien (`apps/finance/src/App.tsx`, `…/routes/Login.tsx`,
   `…/routes/Cockpit.tsx`, `apps/student/src/components/Tacho.tsx`) benutzen
   React-`style={{…}}`, was zu Inline-Style-**Attributen** wird. Ein
   Style-Attribut führt keinen Code aus; das Restrisiko ist CSS-basierte
   Exfiltration und Umgestaltung, nicht Skriptausführung. Ein eingeschleustes
   `<style>`-**Element** bleibt durch `style-src-elem 'self'` verboten. Die
   Alternative (Nonce-Verwaltung im Vite-Build für vier Apps oder Umschreiben
   aller Inline-Styles) steht in keinem Verhältnis.
2. `connect-src` enthält die API-Origins – ohne sie könnte die App ihren
   eigenen Server nicht erreichen (Frontend und API laufen auf verschiedenen
   Ports). Die Liste ist **dieselbe** wie die CORS-Allowlist; es gibt genau
   eine Wahrheit dafür (`buildApp`, `corsOrigins`).

### Zwei Auslieferungsorte

- **API-Antworten**: als Kopfzeile im `onRequest`-Hook, also **auch auf
  Fehlerantworten** (429/401/403/404). Für JSON fast wirkungslos, aber nicht
  umsonst: zusammen mit `X-Content-Type-Options: nosniff` verhindert es, dass
  eine reflektierte Fehlermeldung als HTML interpretiert wird.
- **Die vier Frontends**: als `<meta http-equiv>`, damit die CSP auch ohne
  konfigurierten Reverse Proxy wirkt. Das ist die schwächere Form –
  `frame-ancestors` und `report-uri` wirken per Meta-Tag **nicht** und sind
  dort weggelassen statt eine Wirkung zu behaupten.

**Deployment-Vorgabe:** Der Reverse Proxy, der die vier Apps ausliefert, muss
dieselbe CSP als **HTTP-Kopfzeile** setzen (`buildCspHeader`) – nur dann wirkt
`frame-ancestors 'none'`, das die `postMessage`-Brücke aus
`docs/security-risks.md` #6 endgültig schließt. Bis dahin trägt
`X-Frame-Options: DENY` auf der API und das Meta-Tag im Frontend.

**Einführungshilfe:** `buildApp({ cspReportOnly: true })` schaltet auf
`Content-Security-Policy-Report-Only`.

### Weitere Kopfzeilen und ihr jeweiliger Grund

| Kopfzeile | Grund |
|---|---|
| `X-Content-Type-Options: nosniff` | JSON-Fehler darf nicht als HTML interpretiert werden |
| `Referrer-Policy: no-referrer` | ein Download-Link mit Token in der Query (Finance-Export, Dokumentsignatur) darf den Token nicht weitergeben – kein Formalismus, sondern der Schutz genau dieser URLs |
| `X-Frame-Options: DENY` | Altbrowser-Äquivalent zu `frame-ancestors` |
| `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-site` | trennt den Browsing-Context |
| `Permissions-Policy: camera=(), microphone=(), geolocation=(), …` | die App braucht nichts davon; das Sprachprotokoll arbeitet mit diktiertem **Text**, nicht mit Mikrofonaufnahme |
| `Strict-Transport-Security` | nur bei `https: true` – sonst sperrt man sich lokal aus |
| `Cache-Control: no-store` (alles außer `/health*`, `/metrics`) | personenbezogene Antworten dürfen nicht in einen Proxy- oder Browsercache |

---

## 6. Step-up-Authentisierung

**Datei:** `apps/api/src/lib/step-up.ts`. Zustand an der **Sitzung**
(`sessions.step_up_verified_at`, `sessions.step_up_scope`, Migration 0009).

Mitarbeitende haben seit Phase 0 TOTP-MFA, aber die MFA-Prüfung passiert
**einmal** beim Anmelden und gilt dann für die ganze Sitzungsdauer (12 h). Ein
unbeaufsichtigter Rechner im Büro ist damit ein Vollzugriff. Step-up schließt
genau diese Lücke: für eine kurze Liste hochwirksamer Aktionen muss eine
**frische** Wiederanmeldung vorliegen (Passwort **und** TOTP, maximal 5 Minuten
alt, `STEP_UP_TTL_MS`).

### Aufnahmekriterium

Eine Aktion kommt nur auf die Liste, wenn sie mindestens eines erfüllt:
**(a)** sie bewegt Geld, **(b)** sie hebt eine Sicherheitssperre auf,
**(c)** sie verändert, wer was darf, **(d)** sie gibt personenbezogene Daten
aus dem System heraus.

Eine zu lange Liste ist kontraproduktiv: sie führt dazu, dass Menschen ihr
Gerät entsperrt liegen lassen, um arbeiten zu können.

### Die sieben Aktionen

| Aktion (`STEP_UP_ACTIONS`) | Kriterium | Endpunkt | Bedingt? |
|---|---|---|---|
| `exam.clearance.override` | b | `POST /pruefungen/:id/transition` | **ja** – nur für den Übergang `voraussetzungen_fehlen → fahrlehrer_go`, also den Sprung über eine unvollständige Voraussetzungskette. Die reguläre Freigabe ist Alltagsarbeit und bleibt ohne Step-up. |
| `finance.payment.reassign` | a | `POST /finance/bank/:id/resolve` | **ja** – nur wenn schon eine nicht stornierte Zahlung dieser Transaktion auf eine **andere** Rechnung existiert. Bewusst nicht „irgendeine Zahlung existiert": das würde den idempotenten Wiederholversuch (§2) und die erlaubte Teilzahlung auf dieselbe Rechnung treffen. |
| `resources.vehicle.unblock` | b | `PATCH /resources/fahrzeuge/:id` (→ `verfuegbar`), `POST /resources/fahrzeugmaengel/:id/beheben` | **ja** für PATCH (nur wenn vorher gesperrt), nein für „beheben" (das entsperrt immer). Das **Sperren** verlangt bewusst keinen Step-up – die vorsichtige Richtung darf nie durch Reibung verzögert werden. |
| `users.role.change` | c | `PATCH /users/:id/role` | nein (immer) |
| `finance.export.sensitive` | d | `POST /finance/exports` | **ja** – nur für Berichte aus `SENSIBLE_BERICHTE` (`offene-posten`, `mahnliste`, `schuelerkonten`, `zahlungseingaenge-detail`, `datev-export`, `banktransaktionen-detail`) oder wenn ein Parameter personenbezogen ist. Aggregierte Betriebszahlen bleiben frei. |
| `auth.throttle.unlock` | b | `POST /auth/unlock`, `POST /ops/auth/locks/purge` | nein (immer) |
| `system.security_flag.change` | c | reserviert für Feature-Flags mit Sicherheitswirkung | – |

**Nicht auf der Liste, und das ist Absicht:** die reguläre Prüfungsfreigabe.
Es gibt weiterhin **keine automatische** Prüfungsfreigabe (Non-Negotiable), und
die reguläre Freigabe ist die alltägliche Arbeit eines Fahrlehrers.

### Eigenschaften

- **Antwort auf fehlenden Step-up:** HTTP **403** mit `error:
  "step_up_required"`, `action`, `ttlSeconds`. Bewusst 403 und nicht 401 (die
  Sitzung ist gültig) und nicht ein exotischer Status: Phase 2s Client
  klassifiziert 403 als `PERMISSION` und wiederholt **nicht** automatisch –
  genau richtig, denn hier muss ein Mensch etwas tun.
- **Endet mit der Sitzung.** Der Zustand hängt an der Sitzungszeile, also
  entzieht `POST /auth/logout-all` ihn sofort.
- **Enger Geltungsbereich möglich:** `scope` beim Step-up begrenzt die Freigabe
  auf eine Aktion (`step_up_scope_mismatch` für alle anderen).
- **Fehlversuche zählen in den Brute-Force-Zähler** (siehe Abschnitt 3).
- Kennzahl: `fahrschul_step_up_challenges_total{outcome}`.

---

## 7. Rollenänderung – die geschlossene Lücke

`users:manage` existierte seit Prompt 0 in der Rollenmatrix, hatte aber
**keinen Endpunkt**. Eine Rolle zu ändern hätte Roh-SQL bedeutet – also ganz
ohne Audit. `apps/api/src/routes/users.ts` schließt das mit vier Schranken:

1. `users:manage` (nur `systemdienst`),
2. **Step-up**,
3. **§4-Version PFLICHT** (zwei gleichzeitige Änderungen überschreiben sich
   nicht still),
4. **kein Selbst-Upgrade** – der eigene Datensatz ist über diese Route
   unerreichbar. Sonst wäre `systemdienst → geschaeftsfuehrung` ein Ein-Klick-Weg
   zu Fachdaten und die Zusage „systemdienst hat nur technische Rechte" wertlos.

**Nebenwirkung, die Absicht ist:** eine Rollenänderung löscht **alle
Sitzungen** des betroffenen Kontos. Ein Rechteentzug, der erst in zwölf Stunden
greift, ist kein Rechteentzug. Getestet (der alte Cookie liefert danach 401).

---

## 8. Manipulationssicheres Audit

**Migration 0009**, Prüfung in `apps/api/src/services/audit-chain.ts`.

Zwei unabhängige Schichten, weil sie unterschiedliche Angreifer abdecken:

### Schicht 1: Append-only-Wächter

Zwei Trigger (`audit_events_no_update_trg`, `audit_events_no_delete_trg`)
verbieten UPDATE und DELETE mit **SQLSTATE FS008** – für jede Rolle, auch für
den Tabelleneigentümer, mit dem diese Anwendung verbindet. Ein reines
`revoke update, delete` würde beim Eigentümer nicht greifen.

**Deployment-Vorgabe (Least Privilege der Datenbankrollen):** im echten Betrieb
zusätzlich

```sql
-- Anwendungsrolle: darf einfügen und lesen, nie ändern oder löschen
revoke update, delete, truncate on audit_events from fahrschul_app;
grant insert, select on audit_events to fahrschul_app;
-- Migrationen laufen unter einer getrennten Rolle
```

Das ist in dieser Umgebung nicht eingerichtet (eine Datenbankrolle, siehe
`docs/integration-gaps.md`) und daher als Vorgabe dokumentiert, nicht als
umgesetzt behauptet.

### Schicht 2: Hash-Kette

Jede Zeile trägt `row_hash = sha256(kanonischer Inhalt ‖ prev_hash)`, gesetzt
von einem BEFORE-INSERT-Trigger. Damit wird auch eine Manipulation erkannt, die
die Trigger umgeht: `alter table … disable trigger`, ein Restore einer
manipulierten Sicherung, oder Schreiben auf Dateiebene.

`POST /ops/audit/verify` (Recht `audit:read`, also Geschäftsführung und
Systemdienst) und der tägliche Job `audit.verify` melden drei Befundarten:

| Befund | Bedeutung |
|---|---|
| `inhalt_veraendert` | `row_hash` passt nicht zum Inhalt – die Zeile wurde bearbeitet |
| `vorgaenger_fehlt` | `prev_hash` zeigt auf einen Hash, den es nicht mehr gibt – eine Zeile wurde gelöscht |
| `mehrere_genesis` | mehr als eine Zeile ohne `prev_hash` – der Kettenanfang wurde entfernt |

Zusätzlich meldet die Prüfung, ob die Append-only-Trigger überhaupt **aktiv**
sind (`appendOnlyTriggersActive`) – ein deaktivierter Wächter ist selbst ein
Vorfall.

### Ehrliche Einschränkung: die Kette ist ein Baum

`prev_hash` wird **ohne Sperre** aus dem sichtbaren Kettenkopf gelesen. Zwei
gleichzeitige Transaktionen können denselben Vorgänger referenzieren – die
Kette ist ein Baum, keine Linie. Das ist Absicht: die Alternative (Advisory-Lock
oder Kopfzeile mit `UPDATE … RETURNING`) würde **jede auditierte Transaktion
serialisieren** und damit gegen die bestehenden Nebenläufigkeitszusagen
arbeiten (EXCLUDE-Constraint gegen Doppelbuchung, „zwei Schüler nehmen dasselbe
Angebot an").

**Was der Baum erkennt:** jede Änderung an einer Zeile (Inhaltshash) und das
Löschen jeder Zeile, auf die eine andere zeigt. **Was er nicht erkennt:** das
Löschen eines Kettenblattes – dagegen wirkt Schicht 1, und die Prüfung meldet
den Zeilenzähler mit, damit ein Rückgang gegenüber dem Vorlauf auffällt.

Die Verifikation läuft in **SQL** und benutzt dieselbe Funktion
(`fs_audit_event_canonical`) wie der Insert. Eine zweite Implementierung in
TypeScript würde bei jeder Kanonisierungsabweichung Fehlalarme erzeugen und
wäre damit wertlos.

### <a id="runbook-audit-manipulation"></a>Runbook: Manipulationsverdacht im Audit-Log

1. Alarm `audit_tamper`, Schwere **kritisch**. Zuständig: Geschäftsführung
   **und** Systemdienst **gemeinsam** – bewusst kein Alleingang.
2. `POST /ops/audit/verify` (ohne `limit` für den vollen Lauf). Ergebnis
   sichern (Datum, `geprueft`, `maxChainSeq`, Befundliste) – **bevor** irgendetwas
   verändert wird.
3. `appendOnlyTriggersActive: false`? Dann hat jemand die Wächter deaktiviert.
   Das ist der schwerere Fall: sofort `pg_stat_activity` und die
   Postgres-Logs sichern.
4. Befund `inhalt_veraendert`: die betroffene `audit_event_id` notieren. Der
   ursprüngliche Inhalt ist aus der letzten unverfälschten Sicherung
   rekonstruierbar (§14, Phase 4).
5. Befund `vorgaenger_fehlt`: es fehlt mindestens eine Zeile. Die Lücke liegt
   zwischen den `chain_seq`-Werten der Nachbarn.
6. **Keine stille Reparatur.** Ein Audit-Log wird nicht „korrigiert". Der
   Vorfall ist als meldepflichtig zu behandeln (Art. 33 DSGVO prüfen, wenn
   personenbezogene Verarbeitung betroffen ist).
7. Erst nach der Sicherung: Ursache beheben, Trigger reaktivieren, Lauf
   wiederholen und das Ergebnis dokumentieren.

---

## 9. Dateiuploads (§12) – Sicherheitsseite

Vollständig in `docs/failure-modes.md` (Verhalten) und hier nur die
Sicherheitszusagen:

| Zusage | Umsetzung | Test |
|---|---|---|
| Der **tatsächliche** Dateityp entscheidet | `lib/file-validation.ts`, Magic Bytes für JPEG/PNG/PDF; Widerspruch zum behaupteten Typ = 415 | „WEIST EINE DATEI AB, DIE ÜBER IHREN TYP LÜGT" |
| Gefährliche Inhalte werden **benannt** | Signaturen für PE/ELF/Mach-O/Java-Class/ZIP-Container/Shell-Script, plus HTML/SVG-Erkennung | `sniffMimeType`-Tests |
| Prüfsumme gespeichert | `dokumente.checksum_sha256` (SHA-256) | „speichert SHA-256, Größe und beide MIME-Typen" |
| Quarantäne **zuerst** | `uploaded → quarantined`, Freigabe nur über `services/document-pipeline.ts` | Übergangskette geprüft |
| Nie „geprüft" ohne sauberen Scan | Anwendungsprüfung **und** DB-Invariante **FS009** | „das Büro kann ein Dokument in Quarantäne NICHT freigeben" (auch per Roh-SQL) |
| Keine öffentliche URL | `GET /documents/:id/content?sig=…` verlangt Sitzung **und** Signatur | „ohne Sitzung ist die Signatur wertlos" |
| Signatur an den Benutzer gebunden | HMAC über `resource|id|benutzerId|purpose|exp` | „die Signatur von Schüler A ist für Schüler B NICHT verwendbar" |
| Kurzlebig | 5 Minuten (`DOCUMENT_ACCESS_TTL_MS`); abgelaufen = 410 | „eine ABGELAUFENE Signatur liefert 410" |
| Rechteprüfung bei **jedem** Abruf | Reihenfolge: Sitzung → Eigentum/Standort gegen die DB → Signatur | „Schüler B sieht Schüler A's Dokumente nicht" |
| Jeder Abruf auditiert | `document.accessed`, nur Metadaten (kein Dateiname, kein Inhalt) | „jeder Abruf wird auditiert – ohne Dateiname und ohne Inhalt" |
| Inhalt nie in der Datenbank | nur `speicher_referenz` + Prüfsumme; ein Test prüft, dass keine Inhaltsspalte existiert | „speichert NIEMALS den Dateiinhalt in der Datenbank" |

---

## 10. Least Privilege (Abgleich mit `docs/role-permission-matrix.md`)

**Phase 3 führt keine neue Berechtigung und keine neue Rolle ein.** Alle neuen
Endpunkte hängen an bereits vorhandenen Rechten:

| Neuer Endpunkt | Recht | Zusätzlich |
|---|---|---|
| `PATCH /users/:id/role`, `GET /users` | `users:manage` (systemdienst) | Step-up, §4, kein Selbst-Upgrade |
| `POST /auth/unlock`, `GET /auth/locks` | `users:manage` | Step-up |
| `POST /ops/audit/verify` | `audit:read` (geschaeftsfuehrung, systemdienst) | – |
| `GET /ops/integrations`, `…/error-queue`, `GET /ops/alerts/catalog`, `GET /ops/traces`, `GET /ops/auth/locks` | `ops:reliability:read` | – |
| `POST /ops/integrations/*`, `POST /ops/uploads/cleanup` | `ops:jobs:manage` | – |
| `POST /uploads`, `PUT /uploads/:id/chunk`, `POST /uploads/:id/complete`, `DELETE /uploads/:id`, `GET /uploads/:id` | `documents:upload:own` | fremde Sitzung = 404 |
| `GET /documents` (Liste fürs Büro) | `documents:read:any` | serverseitiger Standortfilter |
| `GET /documents/:id/content` | `requireAuth` + Eigentumsprüfung gegen die DB | Signatur |
| `GET /metrics`, `GET /health/deep` | offen bzw. `METRICS_TOKEN` | siehe Abschnitt 11 |

Automatisch geprüft (`security.test.ts`, Abschnitt „Least Privilege"):

- `systemdienst` hat ausschließlich technische Rechte (`users:manage`,
  `audit:read`, `system:admin`, `ops:*`) – **keine** fachliche Berechtigung.
- `schueler` hat ausschließlich `own`-Scope.
- Alle von Phase 3 benutzten Rechte existieren in der Matrix.

---

## 11. Sekundäre Kontrollen

### Sichere Cookie-Flags (Audit)

| Cookie | HttpOnly | SameSite | Secure | Ablauf | Begründung |
|---|---|---|---|---|---|
| `fahrschul_session` | **ja** | Lax | bei `COOKIE_SECURE=true` | 12 h (`sessionExpiryFromNow`) | kein Token im JS-Zugriff |
| `fahrschul_csrf` | **nein, bewusst** | Lax | bei `COOKIE_SECURE=true` | Sitzung | Double-Submit braucht JS-Lesbarkeit; der Token allein öffnet keine Sitzung |

Getestet (`security.test.ts`, „Sichere Cookie-Flags").
**`SameSite=Strict` wurde geprüft und verworfen:** die vier Apps laufen auf
anderen Ports als die API, also ist jeder Aufruf technisch cross-site;
`Strict` würde die Anwendung unbenutzbar machen. `Lax` + Origin-Prüfung +
Token ist die tragfähige Kombination.

### Eingabevalidierung – Abdeckungsaudit

`code-guards.test.ts` zählt **alle** POST/PUT/PATCH/DELETE-Routen und verlangt
für jede entweder `zod` (`safeParse`/`parse`) oder `validateUpload` (Multipart) –
oder einen Eintrag auf einer **geschlossenen, begründeten** Liste von
Endpunkten ohne Body. Ein zweiter Test verhindert, dass diese Liste zu einem
toten Freibrief verwächst (jeder Eintrag muss eine existierende Route sein).

**Befund dieses Audits:** `POST /finance/bank/sync` las `sinceIso` ohne Schema
und gab den Wert an `new Date(...)` und in einen Idempotenzschlüssel weiter.
Behoben (`z.string().datetime()`).

Ein dritter Test verlangt für jede Schreibroute einen `preHandler` mit
`requireAuth` – Ausnahme nur `POST /auth/login`.

### Parametrisierte Abfragen – Wächter statt Momentaufnahme

Die Prompt-5-Review hat „keine SQL-String-Verkettung" festgestellt. Das war
eine Momentaufnahme. `code-guards.test.ts` macht daraus einen Wächter:

- kein `.unsafe(` in `apps/api/src` (der einzige erlaubte Aufruf ist
  `tx.unsafe(content)` im Migrationsläufer – eine Migrationsdatei ist kein
  Benutzereingabekanal),
- kein SQL-Schlüsselwort in einem verketteten String oder in einem
  **nicht-getaggten** Template,
- kein `eval`, kein `new Function`, kein `child_process`,
- kein `rejectUnauthorized: false`, kein `NODE_TLS_REJECT_UNAUTHORIZED`.

**Warum ein Test und keine ESLint-Regel:** es gibt in diesem Repository keine
ESLint-Konfiguration und keinen CI-Lauf, der eine Lint-Regel ausführen würde.
Ein Test läuft mit `pnpm -r test` garantiert mit. Der Preis: Textanalyse statt
AST-Analyse – deshalb ist die Prüfung konservativ (sie schlägt bei Verdacht an
und verlangt eine bewusste Ausnahme) statt clever.

### Secret-Rotation

Es gibt in dieser Umgebung **keinen Secret-Store** (`docs/integration-gaps.md`).
Der Mechanismus ist deshalb dokumentiert und im Code vorbereitet, nicht
behauptet:

| Secret | Verwendung | Rotation |
|---|---|---|
| `SESSION_SECRET` | Signiert CSRF-Token und Dokument-URLs; Salz für die Akteurs-Pseudonymisierung | **Bruchrotation.** Nach dem Wechsel sind ausgegebene CSRF-Token und Dokumentsignaturen ungültig (der Client holt beide neu; die Dokument-URLs leben 5 Minuten) und Akteurs-Pseudonyme ändern sich, d. h. eine Auswertung über den Rotationszeitpunkt hinweg verliert die Verkettung. Vorgehen: außerhalb der Geschäftszeiten wechseln, Wechselzeitpunkt notieren. Für eine überlappende Rotation wären zwei Schlüssel (aktiv + akzeptiert) nötig – **nicht implementiert**, bewusst offen. |
| `benutzer.password_hash` | Anmeldung | Pro Konto, argon2id. `POST /auth/logout-all` beendet alle Sitzungen. |
| `benutzer.mfa_secret` | TOTP | Pro Konto neu erzeugen (`generateTotpSecret`) und neu einrichten. |
| `METRICS_TOKEN` | `GET /metrics` | Freie Rotation, keine Nebenwirkung außer einem fehlgeschlagenen Scrape bis zur Anpassung. |
| `ALARM_WEBHOOK_URL` | Alarmierung | Freie Rotation. Ohne Wert: kein Webhook-Sink (keine erfundene Anbindung). |
| Datenbankzugangsdaten | Postgres | Betriebsseitig; die Anwendung liest sie nur aus `DATABASE_URL`. |

**Nirgends im Repository liegt ein echtes Secret.** `.env` enthält
ausschließlich Entwicklungswerte mit sprechenden Platzhaltern
(`change-me-in-real-env-…`), `.gitignore` schließt `.env` aus.
`setActorPseudonymSalt` erlaubt den Wechsel zur Laufzeit (für einen
Rotationstest oder eine getrennte Auswertungsumgebung).

### Abhängigkeitsscan – Ergebnis, unverändert

`pnpm audit` schlägt in dieser Umgebung mit einem Protokollfehler fehl
(`Unexpected token …is not valid JSON`): der Agent-Proxy liefert die
Advisory-Antwort gzip-komprimiert aus, und pnpm 10.9.0 dekomprimiert sie nicht.
`npm audit` scheitert an der fehlenden `package-lock.json` (dies ist ein
pnpm-Workspace).

Der Scan wurde deshalb **manuell gegen dieselbe Quelle** gefahren: die 197
aufgelösten Versionen aus `pnpm-lock.yaml` gegen
`https://registry.npmjs.org/-/npm/v1/security/advisories/bulk`.
Ergebnis (Abrufdatum 2026-07-26), **unverändert und vollständig**:

| Paket | Installiert | Schwere | Advisory | Betroffen? | Bewertung |
|---|---|---|---|---|---|
| `drizzle-orm` | 0.36.4 | **high** | GHSA-gpj5-g38j-94v9 – SQL-Injection über unzureichend escapte SQL-**Identifier** (< 0.45.2) | **ja** | Angreifbar nur, wenn ein Tabellen-/Spaltenname aus Benutzereingabe kommt. Das ist hier ausgeschlossen und durch den Wächtertest abgesichert: alle Bezeichner sind statische Schema-Importe, es gibt kein `.unsafe(`. **Bewertung: nicht ausnutzbar, Aktualisierung trotzdem empfohlen** (Sprung 0.36 → 0.45 ist eine Major-Änderung und gehört in einen eigenen Vorgang, nicht in Phase 3). |
| `vitest` | 2.1.9 | **critical** | GHSA-5xrq-8626-4rwp – Vitest-UI-Server liest/ausführt beliebige Dateien (< 3.2.6) | **nein** | Betrifft ausschließlich `vitest --ui`. Wird hier nie benutzt (`vitest run`), und `vitest` ist eine reine devDependency. **Bewertung: nicht anwendbar.** |
| `vite` | 5.4.21 | high + moderate ×2 | GHSA-fx2h-pf6j-xcff (`server.fs.deny`-Bypass auf Windows), GHSA-4w7w-66w2-5vf9 (Path Traversal in `.map`), GHSA-v6wh-96g9-6wx3 (`launch-editor` NTLM auf Windows) | teilweise | Alle drei betreffen den **Entwicklungsserver**, nicht das gebaute Artefakt. Zwei sind Windows-spezifisch. **Bewertung: kein Produktionsrisiko** (ausgeliefert werden statische Dateien), Aktualisierung mit dem nächsten Toolchain-Vorgang. |
| `esbuild` | 0.18.20 / 0.19.12 / 0.21.5 / 0.28.1 | moderate | GHSA-67mh-4wv8-2f99 – jede Webseite kann Anfragen an den Dev-Server senden (≤ 0.24.2) | teilweise (drei der vier Versionen) | Nur Entwicklungsserver, transitive Abhängigkeit von vite/tsx. **Bewertung: kein Produktionsrisiko.** |
| `react-router`, `react-router-dom` | 6.30.4 | moderate ×3 | GHSA-wrjc-x8rr-h8h6 (Open Redirect über Backslash), GHSA-337j-9hxr-rhxg (Constructor Injection in `deserializeErrors()`, nur SSR-Hydration), GHSA-jjmj-jmhj-qwj2 (Open Redirect → XSS) | **ja** für die beiden Open-Redirect-Advisories | Es gibt hier **kein SSR** (das dritte Advisory ist damit nicht anwendbar). Die Open-Redirect-Advisories setzen ein `<Link>`/`useNavigate` mit einem Ziel aus Benutzereingabe voraus; alle vier Apps navigieren ausschließlich zu **statischen** Pfaden. Die Behebung erfordert React Router 7 (Major). **Bewertung: nicht ausnutzbar im aktuellen Code**, muss aber vor jeder Einführung dynamischer Navigationsziele behoben werden. |

**Ehrliche Zusammenfassung:** neun Advisories in sechs Paketen, davon
**keines im aktuellen Code ausnutzbar**, aber zwei (`drizzle-orm`,
`react-router`) mit einem Produktionspaket und einer Major-Aktualisierung als
Behebung. Das ist eine offene Bedingung für den Go-Live, kein Phase-3-Fix:
ein Major-Sprung von drizzle-orm oder React Router mitten in einer
Sicherheitsphase wäre ein unkontrollierbares Risiko. **Phase 4 muss diesen
Punkt in die Bedingungsliste übernehmen.**

Reproduktion:

```bash
# Payload aus dem Lockfile bauen (Name -> [Versionen])
# und gegen die npm-Advisory-API prüfen:
curl -sS --compressed -X POST \
  https://registry.npmjs.org/-/npm/v1/security/advisories/bulk \
  -H 'content-type: application/json' --data-binary @audit-payload.json
```

### `/metrics` und `/health/deep` – Zugriffsentscheidung

`GET /metrics` ist offen, **wenn** `METRICS_TOKEN` nicht gesetzt ist; mit
gesetztem Token wird es verlangt (Bearer oder `?token=`). Begründung: ein
Prometheus-Scraper hat keine Sitzung, und ein Betrieb ohne Secret-Store soll
nicht ohne Kennzahlen dastehen. Die ausgelieferten Daten sind ausschließlich
Aggregate mit **geschlossener Label-Menge** – keine Schüler-ID, keine E-Mail,
keine Fahrlehrer-Notiz (getestet). Verraten wird Betriebs**volumen**; das ist
ein Geschäftsgeheimnis, kein personenbezogenes Datum. **Deployment-Vorgabe:**
`METRICS_TOKEN` setzen und den Endpunkt ins interne Netz legen.

`GET /health/deep` ist offen und liefert bewusst **200** auch bei
ausgefallenen Integrationen (nur eine unerreichbare Datenbank ergibt 503).
Begründung in `docs/failure-modes.md`: ein Loadbalancer, der die Instanz wegen
einer degradierten Schnittstelle aus dem Verkehr nimmt, macht aus der
Degradation einen Totalausfall.

---

## 12. Was echt ist und was Mock ist

| Baustein | Status | Anmerkung |
|---|---|---|
| Rate Limiting | **echt**, getestet | Zähler im Prozessspeicher (siehe Abschnitt 2) |
| Brute-Force-Schutz | **echt**, persistiert, getestet | – |
| CSRF (3 Lagen) | **echt**, getestet | – |
| CSP | **echt** gesetzt (Kopfzeile + Meta), Kompatibilität gegen die Builds geprüft | Kein Browser-Test (Playwright ist Phase 4) |
| Step-up + TOTP | **echt** (serverseitiges TOTP aus Phase 0) | – |
| Append-only-Audit + Hash-Kette | **echt**, Manipulation nachweislich erkannt | Baum statt Linie (Abschnitt 8) |
| Magic-Byte-Prüfung, Prüfsumme, Quarantäne | **echt**, getestet | – |
| **Malware-Scanner** | **MOCK** (`mock-always-clean`) | Die Kette (Quarantäne → Scan → Freigabe) und der **Ausfallpfad** sind echt und getestet; der Scanner meldet immer „sauber". Ohne echten AV-Anbieter kein Produktivbetrieb. |
| **Dokumentenspeicher** | **MOCK** (In-Memory) | Interface identisch zu S3-kompatibel; die Referenz-Semantik ist echt |
| Circuit Breaker / Zeitlimit / Puffer / Fehlerwarteschlange | **echt**, getestet gegen absichtlich fehlerhafte Adapter | Die **Anbieter** sind Mocks |
| Alarmierung | **echt** als Sink-Kette (stderr + strukturiertes Log + Kennzahl); Webhook-Sink implementiert, standardmäßig **nicht registriert** | Kein Alarmkanal in dieser Umgebung |
| Tracing | **echt** als Korrelations-ID + Spannen im Prozess; kein OpenTelemetry-Collector | `setTraceSink` ist der Exporter-Einhängepunkt |
| Secret-Store | **fehlt** | Rotation dokumentiert, überlappende Rotation nicht implementiert |
| TLS/HSTS | **fehlt** in dieser Umgebung | Kopfzeilen und Cookie-Flags schalten korrekt um, sobald HTTPS gemeldet wird |
| Least-Privilege-**Datenbankrollen** | **fehlt** (eine Rolle) | `revoke`-Vorgabe dokumentiert (Abschnitt 8) |

---

## 13. Bekannte Lücken dieser Phase (§17)

1. **Rate-Limit-Zähler nicht instanzübergreifend** (Abschnitt 2). Der
   Brute-Force-Schutz ist deshalb separat persistiert.
2. **Keine überlappende Secret-Rotation** für `SESSION_SECRET` – ein Wechsel
   ist eine Bruchrotation (Abschnitt 11).
3. **CSRF lässt signalfreie Aufrufe durch** (Abschnitt 4), abgedeckt durch
   SameSite. Bewusst, begründet, protokolliert.
4. **Hash-Kette ist ein Baum**, das Löschen eines Blattes ist ohne Trigger
   nicht erkennbar (Abschnitt 8).
5. **Kein Browser-Test der CSP.** Die Politik ist gegen die gebauten
   `index.html` geprüft (keine Inline-Skripte), aber nicht in einem echten
   Browser ausgeführt – das ist ein Playwright-Szenario und gehört zu §20
   (Phase 4).
6. **Zwei Produktionsabhängigkeiten mit offenen Advisories**
   (`drizzle-orm`, `react-router`), im aktuellen Code nicht ausnutzbar,
   Behebung nur per Major-Aktualisierung (Abschnitt 11).
7. **`system.security_flag.change`** ist als Step-up-Aktion definiert, hat aber
   noch keinen Endpunkt – es gibt derzeit kein Feature-Flag mit
   Sicherheitswirkung. Bewusst vorbereitet, nicht behauptet.
8. **Der Malware-Scanner bleibt Mock** (Abschnitt 12).
