# Betrieb

Für den Betreiber: was du täglich ansiehst, was du bei einem Problem tust und was ehrlich noch nicht abgedeckt ist.
Stand: C4 (Release-Check, Betreiber-Status, Notfall-Schalter) und B1 (Konto produktiv). Nichts hier wurde gegen ein echtes
Supabase-, Stripe-, Resend- oder Twilio-Konto ausgeführt – ausdrücklich getrennt je Abschnitt („geprüft mit Mock“ / „nicht geprüft“).

## 1. Vor dem Deploy: Release-Check

```
node scripts/releaseCheck.mjs                       # Umgebung des aktuellen Prozesses
node scripts/releaseCheck.mjs --env-file .env       # plus eine Datei (nur Namen und „gesetzt/leer“, nie Werte)
node scripts/releaseCheck.mjs --require billing,mail   # diese Bereiche MÜSSEN eingerichtet sein
```

- Pro Bereich: `eingerichtet` · `teilweise` · `nicht eingerichtet`, mit den fehlenden **Namen** und dem Verhalten ohne sie.
- Exit 1, wenn ein **Kern-Bereich** (Supabase, Adresse der Seite) unvollständig ist, ein Bereich nur **teilweise** gesetzt ist
  (z. B. Stripe-Schlüssel ohne Webhook-Secret), ein verlangter Bereich fehlt oder ein Name wie ein Tippfehler aussieht
  (`STRIPE_SECRET_KY`).
- „Nicht eingerichtet“ heißt: der Bereich **läuft nicht** und sagt das. Er heißt nie „frei“.
- Alle Variablen: [`ENV.md`](./ENV.md) (Name · Zweck · Pflicht · Scope · ohne sie → Verhalten).

## 2. Betreiber-Status (live)

`GET /api/v1/ops/status` mit `Authorization: Bearer <OPS_TOKEN>`. Ohne `OPS_TOKEN` (oder kürzer als 24 Zeichen) antwortet die
Funktion 503 „nicht eingerichtet“ und gibt nichts preis; ein falsches Token ist immer dieselbe 401; 10 Fehlversuche je Adresse in
10 Minuten sperren sie (pro Funktionsinstanz – die Seite muss auch gehen, wenn Supabase ausfällt).

```
curl -H "Authorization: Bearer $OPS_TOKEN" "$SITE/api/v1/ops/status"                 # Bereiche, Funktionen, Schalter, Tippfehler
curl -H "Authorization: Bearer $OPS_TOKEN" "$SITE/api/v1/ops/status?probe=1&stats=1" # + Erreichbarkeit + Zahlen der letzten 24 h
```

- `probe=1`: je **eingerichtetem** Dienst eine lesende Anfrage (Supabase Auth-Health, Stripe-Guthaben lesen, Resend-Domains lesen,
  Twilio-Konto lesen). Nicht eingerichtete Dienste stehen als „nicht geprüft“. „Erreichbar“ heißt: der Host hat geantwortet;
  „berechtigt“ nur bei 2xx. Ein reiner Sende-Schlüssel bei Resend oder ein eingeschränkter Stripe-Schlüssel antwortet 401/403 – das ist normal und steht so in der Notiz.
- `stats=1`: nur Zahlen. Eine Tabelle, die es noch nicht gibt (die Jobs-Tabelle der Alarm-Migration), steht als **unbekannt**, nicht als 0.
- Die Seite zeigt die Notfall-Schalter, wie die **laufenden** Funktionen sie sehen. Netlify übernimmt geänderte Variablen mit dem nächsten Deploy.

## 3. Monitoring-Liste (täglich / wöchentlich)

| Was | Wo | Normal | Auffällig → tun |
| --- | --- | --- | --- |
| Registrierungen | `stats.registrations` (24 h / 7 Tage) | schwankt | plötzlich 0 bei laufender Werbung → Supabase Auth → Logs, E-Mail-Zustellung (SMTP) prüfen |
| Sync (Börsen) | `stats.syncRuns` (gesamt / Fehler / teilweise) | Fehler < 10 % | viele Fehler → Netlify → Logs → `exchange-sync-cron`, Börsen-Status (Bitunix) |
| Hintergrund-Jobs | `stats.jobs` (nach der Alarm-Migration) und `stats.alertWatch` (letzter Lauf, ok, Code) | letzter Lauf < 10 Min | `alertWatch.ok = false` oder alt → Logs `alert-watch-cron`, Resend prüfen |
| Webhooks | `stats.webhooks` (empfangen / fehlgeschlagen, letzter Eingang) | fehlgeschlagen = 0 | Fehler → Stripe → Entwickler → Webhooks → Lieferungen; Signatur-Secret prüfen |
| Billing-Fehler | `stats.billing.pastDueOrUnpaid` | klein | steigt → Stripe → Zahlungen; Kundenhinweis über Stripe-Mails |
| Fehlerberichte | `stats.appErrors` (nur mit Einwilligung der Nutzer) | klein | Anstieg nach Deploy → Rollback (Netlify → Deploys → Publish deploy) |
| Notfall-Schalter | `switches` | alle `false` | `true` heißt: Bereich ist aus – gewollt? |
| Erreichbarkeit | `probe=1` | alle erreichbar | `reachable: false` → Status-Seite des Dienstes |

Nicht eingebaut (ehrlich): kein automatischer Alarm an dich, keine Historie der Zahlen. Wer das braucht, ruft die Seite von einem
Uptime-Dienst mit Header auf und alarmiert bei `verdict != "bereit"` oder `reachable: false`.

## 4. Backup und Restore

**Was gesichert wird**
- Nutzer-Journal: nächtlich `backups/<user>/<Tag>.json` (14 Tage, das neueste immer), `backup-nightly`; wiederherstellbar in Konto → Deine Daten.
- Datenbank selbst: **Supabase** (Pro-Tarif: tägliche Sicherungen; Point-in-Time-Recovery ist eine Betreiber-Einstellung und kostet extra). Das
  ist **nicht** Teil dieses Repos und wurde hier **nicht geprüft** – im Supabase-Dashboard unter Database → Backups einschalten und die Aufbewahrung notieren.

**Restore-Probe (geprüft mit Mock)**
```
node scripts/restoreProbe.mjs                                   # echter Export-Code gegen einen Supabase-Mock (läuft in CI)
node scripts/restoreProbe.mjs trade-journal-konto-2026-11-07.json   # ein ECHTER Export (Konto → Deine Daten → Exportieren)
```
Der Export wird in ein **frisches, leeres Profil** zurückgespielt (derselbe Weg wie „Backup importieren“); jeder Datensatz wird per Hash
verglichen: nichts darf fehlen, sich ändern oder dazukommen; die Screenshot-Hashliste muss zu den Trades passen. Exit 0 = vollständig.
Sie beweist, dass das **Exportformat** zurückspielbar ist. Sie beweist nicht, dass ein Supabase-Backup funktioniert – dafür einmal im
Quartal ein Supabase-Backup in ein Testprojekt zurückspielen und dort `releaseCheck` + eine Anmeldung prüfen (nicht automatisiert).

## 5. Kostenbudget

Die Kosten entstehen an drei Stellen. Grenzen, die im Code stehen:

| Posten | Bremse | Wo |
| --- | --- | --- |
| KI (Anthropic) | je Tarif pro Tag: Coach/Strategie/Assistent teilen `coachAiPerDay` (Free 0, Pro 0, Premium 50, Team 50), Screenshot-Import `shotExtractPerDay` (0/0/20/20); je Nutzer 10 Anfragen / 10 Min; Körper ≤ 8 KiB; ohne Schlüssel: aus | `src/billing/plans.ts`, `coach-ask`, `shot-extract`, `strategy-compile`, `assistant-route` |
| E-Mail (Resend) | höchstens eine Mail je Konto und Lauf, `maxPerDay` 3/6/12/24 je Konto, 10 Min Abstand, Backoff nach Fehlern; Testmail 3 / 10 Min und 10 / Tag | `alert-watch-cron`, `alert-test` |
| Telefon (Twilio) | Tageslimit global `ALERT_PHONE_DAILY_MAX` (Standard 50), je Konto `ALERT_PHONE_USER_DAILY_MAX` (Standard 5), Monatslimit je Tarif (0/0/30/60, `src/billing/plans.ts`); ein Anruf wird VOR dem Wählen festgeschrieben. Notfall-Schalter `KILL_CALLS` (siehe unten) | `alerts-cron`, `alerts-phone` |
| Supabase / Netlify | Rate-Limits je Funktion (`rate_hit`), Screenshots ≤ 5 MB je Bild, 14 Tage Backups | Funktionen, Migration 0007 |

Empfehlung: in Anthropic, Resend, Twilio und Stripe **eigene Ausgabenlimits** setzen – der Code begrenzt Anfragen, keine Euro. Dort
auch Alarm bei 50 / 80 % des Monatsbudgets einstellen.

## 6. Notfall-Schalter

Vier Umgebungsvariablen in Netlify (Site configuration → Environment variables), Wert `true` schaltet den Bereich ab, **danach neu deployen**:

| Variable | Wirkt auf | Nutzer sehen |
| --- | --- | --- |
| `KILL_SYNC` | Börsen-Verbindung, manueller Sync, Positionen, Backfill, Cron; **und** der Cloud-Sync des Browsers (`/api/v1/flags`) | „Der Sync ist gerade abgeschaltet. Dein Journal bleibt in diesem Browser.“ – die App läuft lokal weiter, nichts geht verloren |
| `KILL_CALLS` | jeden Anruf (Twilio): `alerts-phone` (SMS-Code der Nummernprüfung, Testanruf) antwortet 503 `switched_off`; im Anruf-Pfad der Alarme wird die Zustellung als „Übersprungen: Notschalter (Anrufe) des Betreibers ist an“ protokolliert, ohne Budget zu verbrauchen und ohne Wiederholung; zusätzlich prüft `createCall` ihn als letzten Schritt vor Twilio. E-Mail und Browser laufen weiter, die Abmeldung der Nummer bleibt möglich, Status-Rückmeldungen laufender Anrufe werden weiter angenommen | „Anrufe sind gerade abgeschaltet.“ |
| `KILL_AI` | Coach-Formulierung, Screenshot-Import per KI, Strategie-Übersetzer, Assistent | KI-Knöpfe verschwinden, Antworten 503 „abgeschaltet“; alles lokal Gerechnete bleibt |
| `KILL_CHECKOUT` | **neue** Käufe (`billing-checkout`) | „Neue Käufe sind gerade pausiert.“ Bestehende Abos, Kundenportal, Kündigung und Webhook laufen weiter |

Abschalten **gelöscht** nichts. Kündigen und Konto löschen bleiben immer möglich. Zustand prüfen: `/api/v1/flags` (öffentlich, vier Booleans) oder die Betreiber-Seite.

## 7. Konto: Löschung, Abo-Ende, 2FA-Verlust

**Abo beenden ≠ Konto löschen** (so steht es auch in der App, Reihenfolge fest):
1. Abo-Status prüfen (Konto → Deine Daten → Löschen zeigt: läuft / endet am … / Zahlungsproblem).
2. Export anbieten (Download vor dem Löschen).
3. Löschen mit Bestätigungswort `LÖSCHEN`; läuft ein Abo, verlangt der **Server** zusätzlich die ausdrückliche Bestätigung, dass es **sofort** endet (keine anteilige Erstattung).
4. Serverseitig: Stripe-Abos beenden → Sitze lösen → Dateien in `screenshots` **und** `backups` löschen und **erneut lesen** (bleibt etwas übrig: Abbruch, Konto bleibt, der Nutzer versucht es erneut) → Wiederherstellungscodes → Auth-Nutzer löschen (löscht alle Tabellen per Cascade) → Kontrolle der Tabellen (`leftovers` im Ergebnis, leer = vollständig).
5. Rechnungen bleiben bei Stripe (gesetzliche Aufbewahrung – Frist vom Steuerberater bestätigen lassen).

**Zwei-Faktor verloren**
- Der Nutzer hat 8 Wiederherstellungscodes (Konto → Sicherheit, einmal angezeigt, nur Hashes gespeichert). Mit Passwort-Anmeldung + einem Code wird der Faktor entfernt, danach 2FA neu einrichten.
- Ohne Codes: **keine automatische Umgehung**. Identität des Nutzers außerhalb der App prüfen (z. B. Antwort auf die Kontomail plus Nachweis, was nur der Inhaber weiß), dann im Supabase-Dashboard → Authentication → Users → Nutzer → „Remove MFA factor“. Das ist eine bewusste Handarbeit; die App kann Identität nicht prüfen.
- Ablage der Codes: Tabelle `mfa_recovery_codes` (Migration `0015_mfa_recovery.sql`: eine Zeile je Nutzer, nur HMAC-Hashes, Kaskade auf `auth.users`, RLS an und **kein** Client-Recht). Sätze, die vor der Migration entstanden sind (`app_config`-Zeile `mfa-recovery:<user-id>`), werden weiter angenommen und dort verbraucht; ein NEUER Satz landet immer in der Tabelle und entfernt die alte Zeile. Ohne die Migration schreiben die Functions weiter nach `app_config` (nichts bricht, solange sie aussteht).

## 8. Datenschutz-Löschfristen (Ist-Stand, ehrlich)

| Daten | Frist heute | Automatisch? |
| --- | --- | --- |
| Konto, Journal, Verbindungen, Simulationen, Gruppen … | bis zur Kontolöschung (sofort, Cascade) | ja, bei Löschung |
| Dateien (Screenshots, Backups) | bis zur Kontolöschung; Backups 14 Tage rollierend (das neueste bleibt) | ja |
| Zwischenablage des Exports (große Exporte in `backups/<id>/exports/`) | 1 Stunde / bei der nächsten Liste, 24 h Link-Gültigkeit | ja |
| Fehlerberichte (`app_errors`) | 30 Tage, nur mit Einwilligung | ja (`backup-nightly`) |
| Raten-Zähler (`rate_hits`) | 2 Tage | ja (in `rate_hit`) |
| Audit-Log (`audit_log`) | **keine** automatische Frist; bei Kontolöschung bleiben die Zeilen ohne Nutzer-ID (IP nur als Pseudonym) | **nein – Betreiber-Entscheidung offen** (Vorschlag 12 Monate) |
| Stripe-Ereignisse (`stripe_events`) | Migration sagt „älter als 90 Tage dürfen weg“, **keine** automatische Löschung | **nein** |
| Wiederherstellungscodes | bis zur Nutzung, Neuerzeugung oder Kontolöschung | ja |
| Stripe (Rechnungen, Kunden) | gesetzliche Aufbewahrung beim Zahlungsdienstleister | nicht in der App |

Manuell bis zur Entscheidung (Supabase → SQL Editor, einmal im Monat):
```sql
delete from public.stripe_events where received_at < now() - interval '90 days';
delete from public.audit_log where at < now() - interval '12 months';   -- Frist selbst festlegen
```
Rechtliche Würdigung (Auftragsverarbeitung, Fristen, Verzeichnis der Verarbeitungstätigkeiten) ist nicht Teil der App und von einer Fachperson zu prüfen.

## 9. Zwei-Nutzer-Isolation: was geprüft ist

- **Statisch** (`tests/unit/supabase.audit.test.ts`): liest **jede** Datei in `supabase/migrations` (neue Migrationen werden ohne Änderung am Test mitgeprüft) und führt sie auf einem echten Postgres (PGlite) aus. Regeln: RLS an jeder Tabelle; `anon` ohne Recht; je Recht des Browsers eine Richtlinie, die die Zeile an `auth.uid()` bindet; die aal2-Regel überall; Schreibrechte des Browsers nur auf einer Liste; Storage-Richtlinien je Bucket und Eigentümerordner, alle Buckets privat; `SECURITY DEFINER` mit festem `search_path`; jede Fremdschlüssel-Beziehung zu `auth.users` mit Cascade; jede nutzereigene Tabelle im Export oder in einer begründeten Ausnahmeliste.
- **Real mit zwei Nutzern** (`tests/unit/supabase.isolation.test.ts`): zwei Rollen mit JWT-Claims gegen dieselben Migrationen; B liest nur B, ändert/löscht/übergibt nichts von A; Gruppen, Mitglieder-Sichtbarkeit, Sitzungsliste, Storage-Ordner, nur-Server-Funktionen.
- **Funktionen** (`tests/unit/functions.audit.test.ts`): jede Datei in `netlify/functions` ist klassifiziert (Nutzer / öffentlich / Token / Webhook / Cron) und zeigt das Muster ihrer Klasse; Ausnahmen mit Grund.
- **Nicht geprüft:** das echte Supabase-Produktionsprojekt (Auth-Dienst, PostgREST-JWT-Prüfung, Realtime, Projekt-Einstellungen), echte E-Mail-Zustellung. Vor dem Start: zwei echte Testkonten anlegen und die Schritte aus `SETUP.md` §2 durchgehen.
