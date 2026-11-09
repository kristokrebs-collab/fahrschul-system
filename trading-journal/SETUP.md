# Einrichtung – Trading-Journal mit Cloud, Abos und Börsen-Sync

Diese Anleitung bringt das Journal Schritt für Schritt von „läuft lokal im Browser“ zu „läuft auf Netlify mit Login,
Sync, Abos und Bitunix-Sync“. Jeder Schritt ist für sich nützlich: ohne Supabase bleibt die App rein lokal (alles im
Browser, keine Konten), ohne Stripe gibt es Login und Sync ohne Bezahlschranke, ohne `EXCHANGE_ENC_KEY_V1` bleibt der
CSV-Import der Weg für Börsen-Trades. Die App sagt in jedem dieser Fälle ehrlich, was fehlt.

| Baustein | wofür | ohne ihn |
|---|---|---|
| Netlify | Website (`/` persönlich, `/teilen/` Teilen-Ausgabe), Functions unter `/api/v1/…`, geplante Jobs | – |
| Supabase (EU) | Login, 2FA, Sync zwischen Geräten, Backups, Screenshots, Community | App bleibt lokal, Konto/Preise/Community ausgeblendet |
| Stripe | Abos (Pro, Premium, Team), Testphase, Kundenportal, Empfehlungen | alle Funktionen frei, keine Preise/Abos |
| Bitunix (nur Lesen) | Trades kommen von selbst ins Journal | CSV-Import (neun Formate) |
| Anthropic (optional) | „Mit KI formulieren“ im Coach (nur berechnete Fakten werden gesendet) | Coach formuliert selbst |

> Zeitbedarf: ca. 60–90 Minuten für alles. Reihenfolge einhalten – die Supabase-Werte müssen vor dem Build in Netlify
> stehen, weil Vite sie beim Bauen in die App schreibt.

---

## 0. Voraussetzungen

- Node **22** (wie auf Netlify, `NODE_VERSION = "22"` in `netlify.toml`), npm 10.
- Konten: GitHub (Repo), Netlify, Supabase, Stripe; für den Börsen-Sync ein Bitunix-Konto.
- Optional: [Supabase CLI](https://supabase.com/docs/guides/cli), [Stripe CLI](https://docs.stripe.com/stripe-cli),
  [Netlify CLI](https://docs.netlify.com/cli/get-started/) (`netlify dev` für Functions lokal), `openssl`.

Lokal starten (ohne Cloud):

```bash
cd trading-journal
npm ci
npm run dev          # http://localhost:5173 – rein lokal, solange .env.local keine Supabase-Werte hat
```

Prüfbefehle (dieselben wie in der CI): `npm run typecheck && npm run lint && npm test && npm run build && npm run build:share`.

---

## 1. Netlify-Site anlegen

1. Netlify → **Add new site → Import an existing project** → GitHub → dieses Repository.
2. Build-Einstellungen **nicht** von Hand setzen – `netlify.toml` im Repo-Root regelt alles:
   Basisverzeichnis `trading-journal`, Befehl `npm ci && npm run build && npm run build:share`, Ausgabe `dist`,
   Functions aus `trading-journal/netlify/functions`, Node 22, Sicherheits-Header (CSP) und die Binance-Weiterleitungen.
3. Ersten Deploy laufen lassen. Ergebnis: die lokale App unter `https://<deine-site>.netlify.app` (noch ohne Konto).
4. Die Adresse notieren – sie wird gleich als **Site-URL** gebraucht (`SITE_ORIGIN`, Supabase-Redirects, Stripe-Webhook).
   Eigene Domain? Dann jetzt unter **Domain management** verbinden und überall diese Domain verwenden.

---

## 2. Supabase-Projekt

1. [supabase.com](https://supabase.com) → **New project**, Region **Central EU (Frankfurt)**, starkes DB-Passwort
   (im Passwortmanager ablegen).
2. **Organization → Legal Documents**: den Auftragsverarbeitungsvertrag (DPA/AVV) abschließen (DSGVO).
3. **Project Settings → API Keys** notieren:
   - **Project URL** (`https://<ref>.supabase.co`) → `VITE_SUPABASE_URL` **und** `SUPABASE_URL`
   - **Publishable key** (`sb_publishable_…`) → `VITE_SUPABASE_PUBLISHABLE_KEY` (öffentlich, landet im Bundle)
   - **Secret key** (`sb_secret_…`) → `SUPABASE_SECRET_KEY` (**nur** für die Functions, niemals mit `VITE_`-Präfix)

### 2.1 Migrationen 0001 → 0019

Die Dateien liegen in `trading-journal/supabase/migrations/` und werden **genau einmal, in dieser Reihenfolge**
ausgeführt (nie eine angewendete Migration ändern – Änderungen kommen als neue Datei):

| Datei | Inhalt |
|---|---|
| `0001_core.sql` | Profile, Journal-Dokumente (+ Realtime), Rate-Limits, Audit-Log, Fehlerberichte, Börsen-Verbindungen, 2FA-Regel, Buckets `screenshots` / `backups` |
| `0002_billing.sql` | Stripe-Kunden, Abos, Team-Plätze, Empfehlungscodes, Gutschriften, Webhook-Idempotenz |
| `0003_exchange.sql` | Sync-Läufe, Sync-Cursor, API-Tokens, `upsert_synced_trade(s)` |
| `0004_social.sql` | Gruppen, Mitglieder, Pseudonyme, Einladungen, Reviews, Kommentare, Ziele, Teilen-Links, Bestenlisten (k ≥ 10) |
| `0005_mfa_everywhere.sql` | 2FA-Regel überall: mit aktiver 2FA sieht eine Sitzung ohne Code-Eingabe weder Screenshots noch Audit-Log, Abo-, Teilen-, Token- oder Community-Daten |
| `0006_sync_schedule.sql` | Faire Warteschlange für den automatischen Börsen-Sync (`next_sync_at`, `sync_failures`): fehlschlagende oder nicht mehr berechtigte Verbindungen blockieren zahlende Trader nicht mehr |
| `0007_seats_screenshots.sql` | Team-Plätze unter Sperre vergeben (gleichzeitige Beitritte überschreiten nie die bezahlte Anzahl); Bucket `screenshots` mit 5 MB / PNG, JPEG, WebP, GIF und Upload nur mit Tarif „Screenshots in der Cloud“, sobald Zahlungen aktiv sind (Lesen und Löschen bleiben nach einem Downgrade erlaubt) |
| `0008_alert_watch.sql` | E-Mail-Alarm bei geschlossener App (F21): die zwei Funktionen `alert_watch_candidates()` (welche Konten den Schalter an haben – liest nur Regeln und Schalter) und `set_server_alerts()` (schreibt nur `data.serverAlerts` der Einstellungen, abgesichert über `rev`), dazu ein Teilindex auf den Schalter. Nur für den Server (service role), kein Client erreicht sie. Ohne diese Migration tut `alert-watch-cron` nichts und meldet „Migration 0008 fehlt“ |
| `0009_proofs_boards.sql` | Ergebnisbeleg (F57) und Ranglisten (F50 / F71): Freigaben bekommen die vierte Art „proof“ (die vollständige Liste der geschlossenen Trades eines Zeitraums in R – ohne Geld, Kontogröße, Paar und Uhrzeiten; bis 64 KB), Ranglisten tragen den tiefsten Rücksetzer der R-Summe und die Datenherkunft (Börse, Datei, Hand, Bot, gemischt). Gleiche Einwilligung, gleiche Pseudonyme, gleiche Rechte wie zuvor. **Vor dem Deploy ausführen**: Funktion und Rangliste schreiben die neuen Spalten |
| `0010_cases.sql` | Chartfälle mit Hypothese vorab (F47): öffentliche Kursstrecke bis zur Ankerkerze, je Mitglied eine Hypothese, die nach dem Speichern niemand mehr ändert; andere sehen sie erst nach dem Schließen (Mentor-Gruppen: Schüler sehen Mentoren und die eigene). Das Ergebnis wird nie gespeichert, jedes Gerät rechnet es aus öffentlichen Kerzen. Ohne diese Migration antworten neue Fälle mit „cases_not_ready“, der Rest läuft weiter |
| `0011_simulations.sql` | Zeitmaschine: gespeicherte Simulationen (Tabelle `simulations`, nur eigene Zeilen, 2FA-Regel, Größenprüfung in der Datenbank). Ohne sie bleibt die Simulation auf dem Gerät (IndexedDB), nur der Cloud-Abgleich fehlt |
| `0012_connections.sql` | Verbindungen: Empfangsprotokoll des TradingView-Webhooks (`webhook_receipts`, höchstens 30 Zeilen je Nutzer, ohne Alarmtext, Token und IP). Binance braucht keine Schema-Änderung. Ohne sie zeigt der Assistent keinen Empfangsbeleg |
| `0013_signals.sql` | TradingView-Signal-Empfänger (B3): Tabelle `signals` (jede Zustellung mit Ausgang verarbeitet / doppelt / abgelehnt samt Grund, nur eigene Zeilen lesbar, eindeutiger Schlüssel je Nutzer + Quelle + Signal-ID gegen Doppelte, ohne Rohtext, Token und IP) sowie `tv_mcp_states` und `tv_mcp_connections` für die OAuth-Verbindung zum offiziellen TradingView-MCP (Tokens verschlüsselt, für Clients gar nicht lesbar). Ohne sie antwortet `/api/v1/signals/:token` mit 503 „nicht eingerichtet“ und nimmt nichts an; die Karte zeigt dann den Empfangsbeleg aus 0012 |
| `0014_alerts.sql` | Vier Alarme + Zustellung (C2): Alarm-Einstellungen (`alert_prefs`), Telefon-Einwilligung und -Status ohne Nummer (`alert_phones`), die verschlüsselte Nummer (`alert_phone_secrets`, kein Zugriff für Clients), Gedächtnis der Alarm-Engine (`alert_state`), Ereignisse mit eindeutigem Dedup-Schlüssel (`alert_events`), Zustellprotokoll (`alert_deliveries`) und die Job-Warteschlange mit Lease, Wiederholung und Dead-Letter (`jobs`), dazu die Server-Funktionen `alert_enqueue`, `jobs_claim`, `alert_phone_reserve` (Anruf wird VOR dem Wählen festgeschrieben) u. a. Clients dürfen nur eigene Zeilen lesen, schreiben nur die Functions. Läuft nach 0001, 0005 und 0008 (0011–0013 gehören anderen Paketen und sind unabhängig). Ohne sie meldet `alerts-cron` „migration“ und tut nichts; `supabase/tests/0014_alerts.test.sql` prüft die Regeln gegen eine Scratch-Datenbank |
| `0015_mfa_recovery.sql` | Wiederherstellungscodes der 2FA (B1): eigene Tabelle `mfa_recovery_codes` (nur HMAC-Hashes, je Nutzer eine Zeile, Kaskade auf `auth.users`, RLS an, **kein** Client-Recht), dazu eine Korrektur zu 0014: `jobs` ist für den Browser nicht lesbar (Lease-Token). Bestehende Sätze in `app_config` (`mfa-recovery:<id>`) funktionieren weiter, neue Sätze landen in der Tabelle. Ohne die Migration schreiben die Functions weiter nach `app_config` |
| `0016_consents.sql` | Kaufstrecke: Zustimmungsnachweis (`consents`: wer, wann, welcher Wortlaut + Hash je Bestellung – geschrieben VOR der Stripe-Sitzung, nur eigene Zeilen lesbar, 2FA-Regel) und Kündigungs-/Widerrufserklärungen ohne Login (`contract_requests`, Adresse nur als gesalzener Hash). **Ohne sie bleibt die Kaufstrecke gesperrt** („Zustimmung kann nicht gespeichert werden“) – nie ein Kauf ohne Nachweis |
| `0017_contract_grants.sql` | Korrektur zu 0016: der Browser liest von `contract_requests` keine Hash-Spalten (`email_hash`, `token_hash`) mehr; gelesen wird dort ohnehin nur in den Functions. Richtlinien und Schreibwege bleiben, ohne sie läuft alles weiter (nur das Recht wäre weiter als nötig) |
| `0018_quotas_visibility.sql` | Sicherheitsrunde 11: Kontingente prüft jetzt die Datenbank selbst, nicht nur App und Functions – Journal (höchstens 100 000 Datensätze und 256 MiB je Konto, Zähler in `user_usage`), Simulationen (neue je Tag nach Tarif: Free 20, Pro 200, Premium/Team höchstens 2 000; höchstens 5 000 gespeicherte), Screenshot-Bucket (Summe je Konto nach Tarif: Pro 2 GB, Premium/Team 20 GB; die Datei, die gerade hochgeladen wird, zählt erst danach mit – die Summe kann also um diese eine Datei (höchstens 5 MB) überschritten werden) und Backup-Bucket (höchstens 512 MiB je Datei). Dazu sehen Schüler in Mentor-Gruppen die anderen Schüler weder in `group_members` noch in `social_profiles`, und `cloud_shots_allowed()` beantwortet nur noch die Frage nach dem eigenen Tarif. Die Zahlen ohne Gegenstück im Tarifdokument sind Vorschläge, die du bestätigst (E8, `docs/TARIFE.md`). Ohne die Migration funktioniert alles wie vorher – nur ohne diese Obergrenzen |
| `0019_trial_tombstones.sql` | Sicherheits-Fixpaket Runde 11 (Paket A): `trial_tombstones` – wenn ein Konto mit Testphase gelöscht wird, bleibt nur der Schlüssel-Hash (HMAC mit `IP_HASH_PEPPER`) der Adresse zurück, damit dieselbe Adresse nicht am nächsten Tag die nächste Testphase bekommt; dazu Indizes für die Aufbewahrungsfristen (`audit_log (at)`, `contract_requests (received_at)`). Ohne sie läuft alles weiter, nur ohne die Testphasen-Sperre über Kontolöschungen hinweg |

**Variante A – SQL-Editor (ohne CLI):** Supabase → **SQL Editor → New query** → Inhalt von `0001_core.sql` einfügen →
**Run** → „Success“ abwarten. Dann `0002` bis `0018` (die Nummern dazwischen, die es gibt) genauso.

**Variante B – CLI:**

```bash
cd trading-journal
supabase login
supabase link --project-ref <ref>
supabase db push            # wendet supabase/migrations/* in Reihenfolge an
```

**Kontrolle danach:**

- **Table Editor**: u. a. `profiles`, `journal_docs`, `subscriptions`, `sync_runs`, `groups` sind da, überall „RLS enabled“.
- **Storage**: Buckets `screenshots` und `backups`, beide **privat**, und unter **Storage → Policies** vier Regeln
  „screenshots: read / insert / update / delete own“ (nur der eigene Ordner `<auth.uid()>/…`). Auf Supabase legt
  0001 beides an. Fehlt etwas: Buckets von Hand anlegen (Name exakt, „Public bucket“ aus) und die vier Policies aus
  `0001_core.sql` (Abschnitt „Storage“) im SQL-Editor nachziehen. `backups` bekommt **keine** Client-Policy.
- **Database → Publications → `supabase_realtime`**: `journal_docs` ist enthalten (sonst hier anhaken).

### 2.2 Auth

**Authentication → URL Configuration**

- **Site URL**: `https://<deine-site>.netlify.app` (bzw. die eigene Domain)
- **Redirect URLs**: `https://<deine-site>.netlify.app/`, `https://<deine-site>.netlify.app/teilen/` und für
  Deploy-Previews `https://*--<deine-site>.netlify.app/**`; für lokale Tests zusätzlich `http://localhost:5173/`.
- **Vorgewählte Bestellung im Link (Paket B, AUTH-06):** Wer auf „Pro auswählen“ klickt und sich dann registriert, soll
  nach dem Klick auf den Bestätigungs-Link wieder bei seiner Auswahl landen. Dafür hängt die App an den Link der Mail
  `?order=<plan>.<intervall>.<sitze>` (z. B. `/?order=premium.year.1` – nie einen Preis). Supabase nimmt diese Adresse
  nur an, wenn sie in der Redirect-Liste steht: trage deshalb **`https://<deine-site>.netlify.app/**`** (mit `/**`)
  ein, nicht nur `https://<deine-site>.netlify.app/`. Fehlt der Eintrag, schickt Supabase auf die **Site URL** zurück,
  die Auswahl im Link geht verloren und nur die Notiz im selben Browser (60 Minuten, `localStorage`) trägt sie noch.
  Der Server verlässt sich nie auf diesen Wert: Plan, Intervall und Sitze (Team 2–50) werden beim Öffnen und beim
  Bestellen erneut geprüft, der Preis kommt immer aus Stripe. Mit einem echten Supabase-Projekt ist das **noch nicht
  geprüft** (die Tests laufen gegen Mocks).

**Authentication → Sign In / Providers**

- E-Mail aktiv lassen („Confirm email“ an). Für den Echtbetrieb einen eigenen SMTP-Server eintragen
  (**Authentication → Emails → SMTP Settings**) – der eingebaute Versand ist stark begrenzt.
- Optional OAuth (Google, GitHub, Apple, Discord): Provider hier aktivieren und dieselben Namen kommagetrennt in
  `VITE_SUPABASE_OAUTH_PROVIDERS` eintragen (z. B. `google,github`). Nur eingetragene Provider zeigen einen Knopf.

**Authentication → Multi-Factor**: **TOTP** aktivieren. Sobald jemand 2FA einrichtet, verlangen Journal und
Börsen-Verbindungen eine 2FA-Sitzung (Regel aus 0001).

**Authentication → Emails → Templates**: Bestätigung, Magic Link, Passwort zurücksetzen und E-Mail-Änderung auf
Deutsch übersetzen (die App selbst ist komplett deutsch).

#### Einstellungen, die nur du im Supabase-Dashboard treffen kannst (Sicherheitsrunde 11)

Die Datenbank-Kontingente aus 0018 greifen nur, wenn nicht beliebig viele Konten entstehen. Das Repo kann diese Schalter
nicht setzen und nicht prüfen – bitte einmal selbst kontrollieren und abhaken:

- **Anonyme Anmeldungen aus**: **Authentication → Sign In / Providers → „Allow anonymous sign-ins“** auf **aus**. Die App
  braucht sie nicht; sind sie an, bekommt jeder Besucher ein gültiges Token (Rolle `authenticated`) und damit Schreibrechte
  auf die eigenen Zeilen.
- **E-Mail-Bestätigung an**: **Sign In / Providers → Email → „Confirm email“** an (steht oben schon so; hier die Kontrolle,
  dass es nach dem Anlegen des Projekts nicht abgeschaltet wurde). Ohne Bestätigung kann ein Skript beliebig viele Konten
  anlegen.
- **CAPTCHA (Bot-Schutz)**: **Authentication → Attack Protection → „Enable Captcha protection“** (Cloudflare Turnstile oder
  hCaptcha). **Achtung, heute noch nicht einschalten:** Die App sendet bisher kein CAPTCHA-Token mit (`captchaToken` fehlt in
  `src/cloud/client.ts`); mit eingeschaltetem CAPTCHA würden Registrierung, Magic Link und Passwort-Zurücksetzen mit
  `captcha_failed` scheitern. Einschalten erst, wenn die Anmeldemaske das Token mitschickt (offener Punkt, nicht Teil von 0018).
- **JWT-Laufzeit kurz halten**: **„JWT expiry limit“** (je nach Dashboard-Version unter **Project Settings → JWT Keys** oder **Authentication → Sessions**) auf höchstens **3600 s (1 h)**,
  gern 900 s. Die Functions prüfen das Token lokal; ein gestohlenes oder abgemeldetes Token bleibt bis zu diesem Ablauf
  gültig. Kürzer = kleineres Zeitfenster (Preis: etwas mehr Token-Erneuerungen).
- **Globale Dateigrößen-Grenze für Storage**: **Project Settings → Storage → „Upload file size limit“** mindestens so hoch wie
  das Bucket-Limit (Backups bis 512 MiB), sonst gilt die kleinere Zahl (auf dem Free-Tarif von Supabase 50 MB). Größere
  nächtliche Backups schlagen dann fehl, das Journal selbst ist nicht betroffen.
- **Auth-Raten-Limits** (**Authentication → Rate Limits**) und ein eigener SMTP-Server (siehe oben) bleiben Pflicht für den
  Echtbetrieb; sie bremsen Mail-Flut bei Registrierung und Magic Link.

---

## 3. Umgebungsvariablen in Netlify

Netlify → **Site configuration → Environment variables → Add a variable**. Zwei Arten, streng getrennt:

- `VITE_*` sind **öffentlich** und werden beim **Build** in die App geschrieben → Scope **Builds** (nicht als
  „secret“ markieren, sonst schlägt Netlifys Secret-Scan beim Build an, weil der Wert absichtlich im Bundle steht).
- Alles andere sind **Server-Geheimnisse** → Scope **Functions**, „Contains secret values“ an, **nie** mit `VITE_`.

| Variable | Wert | Scope |
|---|---|---|
| `VITE_SUPABASE_URL` | Project URL | Builds |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_…` | Builds |
| `VITE_SUPABASE_OAUTH_PROVIDERS` | optional, z. B. `google,github` | Builds |
| `VITE_LEGAL_*` | Impressum-Daten und Links zu Datenschutz / AGB / Widerruf – siehe 4.2 | Builds |
| `SUPABASE_URL` | Project URL (gleicher Wert) | Functions |
| `SUPABASE_SECRET_KEY` | `sb_secret_…` | Functions, secret |
| `SITE_ORIGIN` | `https://<deine-site>.netlify.app` (ohne `/` am Ende) | Functions |
| `STRIPE_SECRET_KEY` | `sk_test_…` (Schritt 4) | Functions, secret |
| `VITE_STRIPE_PUBLISHABLE_KEY` | optional `pk_test_…` / `pk_live_…` (Schritt 4, Punkt 3): das Bezahlfenster nimmt die Karte **in der App** (Stripe Elements, die Nummer geht vom Browser direkt zu Stripe). Leer = die Bestellung geht wie bisher zu Stripe Checkout. Öffentlich (landet im Bundle) – nie den geheimen Schlüssel; der Build bricht ab, wenn der Wert nicht mit `pk_` beginnt | Builds |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` (Schritt 4) | Functions, secret |
| `STRIPE_PRICE_PRO_MONTHLY` / `_YEARLY` | `price_…` | Functions |
| `STRIPE_PRICE_PREMIUM_MONTHLY` / `_YEARLY` | `price_…` | Functions |
| `STRIPE_PRICE_TEAM_MONTHLY` / `_YEARLY` | `price_…` (pro Platz) | Functions |
| `TRIAL_DAYS` | optional, Standard `14` | Functions |
| `STRIPE_TRIAL_CARDLESS` | optional `true` = Testphase ohne Karte (Standard `false`) | Functions |
| `STRIPE_AUTOMATIC_TAX` | optional `true` = Stripe Tax im Checkout (Standard `false`). Die Bestellübersicht sagt ehrlich, welcher Fall gilt: an = „Steuer wird im nächsten Schritt von Stripe berechnet“, aus = „Stripe berechnet keine Steuer zusätzlich“ | Functions |
| `REFERRAL_TRIAL_DAYS` | optional, Standard `30` | Functions |
| `REFERRAL_REWARD_CENTS` | optional, Standard `1000` (10 €). Eine Gutschrift gibt es nur für eine echte Zahlung mindestens in dieser Höhe | Functions |
| `REFERRAL_HOLD_DAYS` | optional, Standard `14`: so viele Tage wartet eine Empfehlungs-Gutschrift, bevor `billing-reconcile` sie auf das Stripe-Guthaben schreibt; eine Erstattung oder Rückbuchung der ersten Zahlung nimmt sie vorher oder danach wieder zurück | Functions |
| `ALLOW_UNGATED` | optional, `true` = in **Produktion** darf alles ohne Stripe-Einrichtung frei laufen (Telefon, SMS, KI, Hintergrund-Sync, Teams – auf deine Kosten). **Ohne diese Variable sperrt eine Produktion ohne Stripe-Schlüssel / Preis-IDs zu** (jedes Konto zählt als Free); Vorschau-Deploys und lokale Läufe sind immer offen | Functions |
| `EXCHANGE_ENC_KEY_V1` | `openssl rand -base64 32` (Schritt 5) | Functions, secret |
| `SYNC_CRON_ENABLED` | optional `false` stoppt den 30-Minuten-Sync | Functions |
| `LOG_SAMPLE_RATE` | optional `0`–`1`, Anteil gespeicherter Fehlerberichte (Standard `1`) | Functions |
| `RESEND_API_KEY` | optional, E-Mail-Alarm bei geschlossener App (6.1): API-Schlüssel von Resend (`re_…`). Ohne ihn (oder ohne `ALERT_FROM`) tut der Zeitplan nichts und die App sagt „Einrichtung nötig“ | Functions, secret |
| `ALERT_FROM` | optional, Absender der Alarm-Mails, z. B. `Trading Journal <alarm@deine-domain.de>` – die Domain muss bei Resend verifiziert sein | Functions |
| `TWILIO_ACCOUNT_SID` | optional, Telefon-Alarm (6.2): Account-SID (`AC…`) von Twilio. Ohne SID, Token und Absender wird nie angerufen, die App sagt „Einrichtung nötig“ | Functions |
| `TWILIO_AUTH_TOKEN` | optional, Telefon-Alarm: Auth-Token von Twilio; prüft auch die Signatur der Status-Rückmeldung | Functions, secret |
| `TWILIO_FROM` | optional, Telefon-Alarm: Absendernummer im Format E.164 (eine Twilio-Nummer oder verifizierte Anrufer-ID) | Functions |
| `TWILIO_VERIFY_SERVICE_SID` | optional, Telefon-Alarm: Twilio-Verify-Dienst (`VA…`) für die Nummernprüfung per SMS-Code. Ohne ihn lässt sich keine Nummer bestätigen, also wird auch nicht angerufen | Functions |
| `ALERT_PHONE_DAILY_MAX` | optional, Kostenbremse: höchstens so viele Anrufe pro Tag über ALLE Konten (Vorgabe 50); danach „Kostenbremse des Servers erreicht“ im Protokoll | Functions |
| `ALERT_PHONE_USER_DAILY_MAX` | optional: höchstens so viele Anrufe pro Konto und Tag, Testanrufe eingerechnet (Vorgabe 5) | Functions |
| `ALERT_SMS_DAILY_MAX` | optional, Kostenbremse gegen SMS-Pumping: höchstens so viele Bestätigungs-SMS pro Tag über ALLE Konten (Vorgabe 100) | Functions |
| `PHONE_ALLOWED_COUNTRIES` | optional, Komma-Liste von Länder-Vorwahlen, an die Codes und Anrufe gehen (z. B. `49,43,41`). Vorgabe: Deutschland, Österreich, Schweiz, übrige EU / EWR, Vereinigtes Königreich, USA und Kanada. Premium- und Sondernummern sind immer gesperrt | Functions |
| `PHONE_HASH_KEY` | optional, empfohlen: `openssl rand -base64 32` – eigener, **nie gedrehter** Schlüssel für den Hash der Telefonnummer. **Setzen, bevor ein alter `EXCHANGE_ENC_KEY_V<n>` entfernt wird** (der Hash hing bisher am ältesten Verschlüsselungsschlüssel) | Functions, secret |
| `AI_DAILY_MAX` | optional, Kostenbremse: höchstens so viele KI-Aufrufe (Coach, Screenshot-Import, Strategie-Übersetzer, Assistent) pro Tag über ALLE Konten (Vorgabe 2000) | Functions |
| `ALERTS_CRON_ENABLED` | optional, `0` schaltet den Alarm-Zeitplan `alerts-cron` ab (Vorgabe: an) | Functions |
| `IP_HASH_PEPPER` | **Pflicht in Produktion**, `openssl rand -base64 32`: geheimer Schlüssel (Version 1) der IP-Pseudonyme in Audit-Log und Rate-Limits, der Wiederherstellungscodes der Zwei-Faktor-Anmeldung und der Testphasen-Sperre (HMAC). Ohne ihn gibt es in Produktion keine neuen Wiederherstellungscodes und `ops-status` meldet „unvollständig“ (alte Codes gelten weiter, sie werden mit dem aus `SUPABASE_SECRET_KEY` abgeleiteten Schlüssel geprüft). Die rohe IP wird nie gespeichert | Functions, secret |
| `IP_HASH_PEPPER_V2` | optional, Rotation des Schlüssels (`…_V3` bis `…_V9` ebenso): neue Hashes und Codes nutzen die höchste Version, ältere bleiben zum Prüfen gültig. Die alte Version erst entfernen, wenn kein Wiederherstellungscode und keine Testphasen-Sperre sie mehr braucht | Functions, secret |
| `ANTHROPIC_API_KEY` | optional, KI-Formulierung im Coach und **Screenshot-Import** (Premium). Ohne den Schlüssel ist der Screenshot-Import aus: „Aus Screenshot übernehmen“ erscheint nicht, die Einstellungen → Daten nennen den Grund. Ein abgelehnter Schlüssel zeigt sich erst beim Auslesen („Der KI-Schlüssel auf dem Server wurde abgelehnt“). Ohne Schlüssel verkauft die Preisseite keinen „KI-Coach“: Premium-Highlight, Vergleichstabelle und Upgrade-Dialog lassen ihn weg (`billing/status` meldet `coachAi: false`) | Functions, secret |
| `TV_MCP_CLIENT_ID` | optional, **Betreiber-Einrichtung**: OAuth-Client-ID der App beim offiziellen TradingView-MCP (Registrierung siehe `docs/ENV.md`). Ohne sie (oder ohne `SITE_ORIGIN`) zeigt die Verbindungen-Karte „Einrichtung nötig (Betreiber)“ und startet nichts | Functions |
| `TV_MCP_CLIENT_SECRET` | optional, nur für einen vertraulichen Client; ein öffentlicher Client (PKCE) lässt es leer | Functions, secret |
| `TV_MCP_URL` | optional, Standard `https://mcp.tradingview.com/mcp` (die Adresse aus TradingViews eigener Dokumentation); die Anmelde-Adressen werden daraus zur Laufzeit gelesen | Functions |
| `TV_MCP_SCOPES` | optional, Standard `mcp:read mcp:tools` (die zwei Scopes, die der Server nennt) | Functions |
| `COACH_MODEL` | optional, Standard `claude-opus-5-5` | Functions |
| `ROUTER_MODEL` | optional, Standard = `COACH_MODEL` – Sprach-Router des Assistenten (`/api/v1/assistant/route`) und KI-Hilfe des Strategie-Studios (`/api/v1/strategy/compile`), nutzen denselben `ANTHROPIC_API_KEY` | Functions |
| `VISION_MODEL` | optional, Modell des Screenshot-Imports (F29, braucht denselben `ANTHROPIC_API_KEY`); Standard: `COACH_MODEL`, sonst `claude-opus-5-5`. Ohne Schlüssel erscheint „Aus Screenshot übernehmen“ nicht, die Preisseite verkauft den Import dann nicht (`coachAi: false`) | Functions |
| `SEC_USER_AGENT` | optional, für die **Aktien-Module** (Zahlen-Analyst, DCF-Zahlen, Kaufthese-Prüfung; Funktionen `sec-facts` / `sec-filings`): Name und Kontakt des Betreibers, z. B. „Firmenname kontakt@deine-domain.de“ – die SEC verlangt das in jedem Abruf. Ohne einen brauchbaren Wert (kein `@`, ein Platzhalter) antworten die Funktionen „Einrichtung nötig“ und rufen die SEC **nicht** auf; die App zeigt den Grund. Wird nie ans Frontend geschickt | Functions |

`.env.example` listet dieselben Namen (ein Test stellt sicher, dass dort jede Variable steht, die App oder Functions
lesen). Die `HYBLOCK_*`-Zeilen sind reserviert und werden derzeit von keiner Function gelesen.

Danach: **Deploys → Trigger deploy → Clear cache and deploy site.** Erst dieser neue Build enthält die Supabase-Werte.

**Kontrolle:** Seite neu laden → in der Kopfzeile erscheint „Anmelden“, in der Navigation (Menü bzw. ⌘K) gibt es
**Konto**, **Preise** und **Community**. Registrieren, Bestätigungsmail anklicken, anmelden, einen Trade anlegen, auf einem zweiten Gerät
anmelden – der Trade kommt dort ohne Neuladen an (Realtime). In Supabase steht er in `journal_docs`.

---

## 4. Stripe (zuerst im Testmodus)

Solange `STRIPE_SECRET_KEY` fehlt, meldet der Server „Zahlungen sind noch nicht eingerichtet“ – dann gibt es keine
Bezahlschranke, alle Funktionen sind frei. **Sobald Stripe eingerichtet ist, gelten die Pläne aus
`src/billing/plans.ts`** (Free sieht bei Analyse-Pro, Risiko, Coach, Berichten, Labor, Wachstum und Cockpit die
Upgrade-Karte).

1. Stripe-Dashboard, oben **Testmodus** einschalten.
2. **Produktkatalog → Produkt hinzufügen**, je ein Produkt mit zwei wiederkehrenden Preisen (EUR, inkl. MwSt.;
   die Listenpreise der App stehen in `LIST_PRICES` – die Preisseite zeigt aber immer die echten Stripe-Preise):

   | Produkt | monatlich | jährlich | Variablen |
   |---|---|---|---|
   | Pro | 12 € | 120 € | `STRIPE_PRICE_PRO_MONTHLY`, `STRIPE_PRICE_PRO_YEARLY` |
   | Premium | 24 € | 240 € | `STRIPE_PRICE_PREMIUM_MONTHLY`, `STRIPE_PRICE_PREMIUM_YEARLY` |
   | Team | 19 € **pro Platz** | 190 € **pro Platz** | `STRIPE_PRICE_TEAM_MONTHLY`, `STRIPE_PRICE_TEAM_YEARLY` |

   Team: Preismodell „pro Einheit“ (die App schickt die Anzahl Plätze, 2–50). Die sechs `price_…`-IDs kopieren.
3. **Entwickler → API-Schlüssel**: geheimer Schlüssel `sk_test_…` → `STRIPE_SECRET_KEY` (nur Netlify, Scope Functions, geheim).
   Optional der **veröffentlichbare** Schlüssel `pk_test_…` → `VITE_STRIPE_PUBLISHABLE_KEY` (Scope Builds): dann zahlt man im
   Bezahlfenster der App (Stripe Elements, 3-D Secure im Fenster von Stripe; Testphase → SetupIntent, ohne Testphase → Abo mit
   `payment_behavior: default_incomplete`, Function `billing-subscribe`). Ohne ihn – und immer mit `STRIPE_AUTOMATIC_TAX=true`, weil nur
   Stripe Checkout die Rechnungsadresse abfragt – geht die Bestellung wie bisher zu Stripe Checkout. „Aktiv“ schreibt in beiden Fällen
   nur der Webhook.
4. **Entwickler → Webhooks → Endpunkt hinzufügen**: URL `https://<deine-site>.netlify.app/api/v1/stripe/webhook`,
   Ereignisse:
   `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`,
   `customer.subscription.deleted`, `customer.subscription.paused`, `customer.subscription.resumed`,
   `customer.subscription.trial_will_end`, `invoice.paid`, `invoice.payment_failed`,
   **neu (Runde 11):** `charge.refunded` und `charge.dispute.created` – eine volle Erstattung oder Rückbuchung nimmt die Empfehlungs-Gutschrift
   der ersten Zahlung zurück; ohne diese beiden Ereignisse bleibt die Gutschrift stehen.
   **Neu (Paket V):** `setup_intent.succeeded` – die Testphase des Bezahlfensters: Stripe hat die Karte bestätigt, der Webhook legt das
   Abo an, falls die Bestätigung der App nicht ankommt (beide Wege erzeugen dasselbe Abo, ein Schlüssel pro Bestellung).
   Signatur-Geheimnis `whsec_…` → `STRIPE_WEBHOOK_SECRET`.
5. **Einstellungen → Billing → Kundenportal**: Kündigung erlauben (zum Periodenende, mit Gründen),
   Zahlungsmethode ändern, Rechnungsverlauf, **Abo wechseln zwischen den sechs Preisen** (der Knopf „Wechseln“ in der
   App springt genau dorthin). Links zu AGB und Datenschutz eintragen.
6. Optional: **Gutscheine / Aktionscodes** anlegen (die Preisseite prüft Codes live), **Steuern** (Stripe Tax, dann
   `STRIPE_AUTOMATIC_TAX=true`), Rechnungseinstellungen (deutsche Rechnungen, Firmendaten).
7. Variablen in Netlify eintragen (Schritt 3) und neu deployen.

**Kaufstrecke gesperrt, bis alles da ist:** Bestellt werden kann erst, wenn Stripe (Secret Key + mindestens ein Preis) **und** die Rechtstexte des Betreibers eingerichtet sind: Impressum (`VITE_LEGAL_IMPRESSUM_URL` oder `VITE_LEGAL_OPERATOR` + `VITE_LEGAL_ADDRESS` + `VITE_LEGAL_EMAIL`), `VITE_LEGAL_DATENSCHUTZ_URL` und `VITE_LEGAL_AGB_URL`. Die `VITE_LEGAL_*`-Variablen müssen in Netlify für **Builds und Functions** gelten (die Functions prüfen dieselbe Regel wie der Browser). Fehlt etwas, sagt die App „Bestellung noch nicht möglich“ und der Server antwortet `purchase_closed` – kein Fake-Kauf. Die Bestätigungs-Mails zu Kündigung und Widerruf brauchen `RESEND_API_KEY` und `ALERT_FROM` (Abschnitt 6.1); ohne sie sagt die Seite ehrlich „nicht eingerichtet“.

**Test:** In der App **Preise** → bei Pro **Weiter zur Bestellung** → beide Kästchen ankreuzen → **Zahlungspflichtig bestellen** → Stripe-Checkout mit Testkarte `4242 4242 4242 4242`,
beliebiges künftiges Datum, beliebige Prüfziffer. Zurück in der App zeigt **Konto** den Plan Pro mit laufender Testphase. Im
Stripe-Dashboard hat der Webhook mit **200** geantwortet; in Supabase steht das Abo in `subscriptions`, der Plan in
`profiles.plan`.

Webhooks lokal testen (Functions über die Netlify CLI):

```bash
cd trading-journal
netlify dev                                   # App + Functions auf http://localhost:8888
stripe listen --forward-to localhost:8888/api/v1/stripe/webhook
# das ausgegebene whsec_… als STRIPE_WEBHOOK_SECRET in .env eintragen, netlify dev neu starten
stripe trigger checkout.session.completed
```

Eigenen Zugang ohne Abo (z. B. für den Betreiber), im SQL-Editor:

```sql
update profiles set plan = 'premium' where id = '<user-uuid>';   -- bleibt, bis ein Webhook für diesen Nutzer ihn neu setzt
```

### 4.1 Affiliates verwalten (SQL, es gibt dafür keine Admin-Seite in der App)

Jeder Nutzer bekommt unter **Konto → Empfehlen** einen Code (er entsteht beim ersten Öffnen der Karte). Ein normaler
Code bringt dem Werbenden eine einmalige Gutschrift auf seine Stripe-Rechnung (`REFERRAL_REWARD_CENTS`). Zum Affiliate
wird ein Code erst, wenn der Betreiber eine Provision setzt – dann bucht der Webhook für jede bezahlte Rechnung der
geworbenen Kunden 12 Monate lang eine Provision als `pending` in `affiliate_ledger` (Beträge in Cent). Ausgezahlt wird
außerhalb der App; danach markierst du die Einträge als bezahlt. Alles im Supabase-SQL-Editor:

```sql
-- Affiliate freischalten (Provision in Prozent, erlaubt: über 0 bis 50)
update referral_codes set commission_pct = 25 where code = 'ABCD2345';

-- offene Provisionen je Affiliate (in Euro)
select c.code, l.referrer_id, l.currency, count(*) as rechnungen, sum(l.amount) / 100.0 as offen
from affiliate_ledger l join referral_codes c on c.user_id = l.referrer_id
where l.kind = 'commission' and l.status = 'pending'
group by c.code, l.referrer_id, l.currency
order by offen desc;

-- nach der Auszahlung als bezahlt markieren
update affiliate_ledger set status = 'paid'
where referrer_id = '<user-uuid>' and kind = 'commission' and status = 'pending';

-- eine Provision zu einer erstatteten Rechnung stornieren
update affiliate_ledger set status = 'void' where stripe_invoice_id = 'in_…' and kind = 'commission';

-- Affiliate wieder zum normalen Empfehlungscode machen
update referral_codes set commission_pct = null where code = 'ABCD2345';
```

Der Affiliate sieht seine Provisionen (offen / bezahlt) selbst in der Karte **Empfehlen**. Wer eine Oberfläche mit
Auszahlungen braucht, kann statt dessen einen externen Affiliate-Dienst mit Stripe-Anbindung nutzen – der ist in der App
nicht eingebaut.

**Live gehen:** dieselben Produkte, Preise, Webhook und Portal-Einstellungen im Live-Modus anlegen, `sk_live_…`,
das neue `whsec_…` und die Live-`price_…`-IDs in Netlify eintragen, neu deployen. Vorher Impressum, AGB, Widerruf und
Datenschutzerklärung bereitstellen und eintragen (Abschnitt 4.2).

### 4.2 Rechtliches (Impressum, Datenschutz, AGB, Widerruf)

Die App erfindet weder Betreiber noch Anschrift, Steuernummer oder Rechtstexte. Sie zeigt nur, was du als Betreiber
in Netlify unter **Environment variables** (Scope **Builds**, öffentlich – keine Geheimnisse) einträgst, und markiert
alles Fehlende sichtbar als **„Platzhalter – vom Betreiber auszufüllen“**. Nach jeder Änderung neu deployen (Vite
übernimmt `VITE_*` beim Build).

| Variable | Pflicht | Inhalt |
|---|---|---|
| `VITE_LEGAL_OPERATOR` | ja* | Name bzw. Firma des Anbieters |
| `VITE_LEGAL_ADDRESS` | ja* | ladungsfähige Anschrift, Zeilen mit `|` getrennt, z. B. `Musterstraße 1|12345 Musterstadt` |
| `VITE_LEGAL_EMAIL` | ja* | Kontakt-E-Mail |
| `VITE_LEGAL_PHONE` | nein | Telefon |
| `VITE_LEGAL_REPRESENTATIVE` | je nach Rechtsform | vertretungsberechtigte Person (z. B. Geschäftsführer) |
| `VITE_LEGAL_REGISTER` | je nach Rechtsform | Registergericht und -nummer |
| `VITE_LEGAL_VAT_ID` | falls vorhanden | Umsatzsteuer-ID |
| `VITE_LEGAL_RESPONSIBLE` | je nach Inhalt | Verantwortlicher für den Inhalt |
| `VITE_LEGAL_IMPRESSUM_URL` | nein | eigene Impressum-Seite statt der App-Ansicht (*dann entfallen die drei Pflichtfelder) |
| `VITE_LEGAL_DATENSCHUTZ_URL` | ja | deine Datenschutzerklärung (https-Link oder Pfad auf dieser Site) |
| `VITE_LEGAL_AGB_URL` | ja | deine AGB |
| `VITE_LEGAL_WIDERRUF_URL` | nein | eigene Widerrufsbelehrung; ohne sie verweist die App auf die AGB |
| `VITE_LEGAL_DRAFTS_REVIEWED` | nein | `true` nur, wenn ein Anwalt die Entwurfstexte der App (`docs/RECHT/`) geprüft hat; blendet die Leiste „Entwurf – Prüfung durch Anwalt nötig“ aus. Eigene Erklärung des Betreibers, die App prüft nichts |
| `VITE_SHOWROOM` | nein, **nie setzen** | Build-Schalter des Showrooms (`1`): setzt nur das Skript `build:showroom` (lokale Demo, Ausgabe `dist-showroom/`). Kein Netlify-Kontext baut ihn – Produktion, Branch-Deploys und Deploy-Previews bauen die echte App ohne Showroom-Code. Siehe `docs/SHOWROOM.md` |

Wo die Links erscheinen: im Footer jeder Seite, auf **Konto**, im Rechtshinweis der **Preise**, bei der Registrierung
(Pflicht-Häkchen „Ich akzeptiere die AGB und habe die Datenschutzerklärung gelesen“ – auch vor einer Registrierung über
Google & Co.) und vor jedem Stripe-Checkout (Pflicht-Häkchen zu AGB, Widerrufsbelehrung und Datenschutzerklärung im
Upgrade-Dialog). Direkte Links für Stripe, E-Mails oder die Website: `https://<deine-site>/?rechtliches=impressum`
(ebenso `datenschutz`, `agb`, `widerruf`). In Stripe unter **Einstellungen → Öffentliche Details** die Links zu AGB und
Datenschutz eintragen. Innerhalb von claude.ai (persönliches Journal) wird nichts verkauft – dort bleiben die Links aus.

Die Texte selbst (Datenschutzerklärung mit Supabase/Netlify/Stripe/Binance als Empfänger, AGB mit Laufzeit und Kündigung,
Widerrufsbelehrung für digitale Abos, ggf. AVV) musst du als Betreiber erstellen bzw. von einem Anwalt oder
Rechtstext-Dienst prüfen lassen – die App liefert dafür keine Vorlage, die als fertig gelten könnte.

Als Ausgangspunkt für das Gespräch mit dem Anwalt liegen **Entwürfe** in `docs/RECHT/` (Impressum, Datenschutz, AGB,
Widerruf mit Muster-Formular und Zustimmung zum sofortigen Beginn, Preise und Steuern, Risikohinweis, Partnerlinks,
Marken) und die Liste der offenen Anwaltsfragen. Die App zeigt diese Entwürfe unter **Einstellungen › Rechtliches** (und
über die Links im Fußbereich), solange du keine eigene Seite hinterlegt hast – immer mit der Leiste „Entwurf – Prüfung
durch Anwalt nötig“ und gelb markierten Platzhaltern für alles, was du ausfüllen musst. Die Checkliste mit dem Stand der
Mechanik (Kaufstrecke, Speicher, Länder-Hinweise) steht in `docs/RECHT-CHECKLISTE.md`. Das ist keine Rechtsberatung.

---

## 5. Börsen-Sync mit Bitunix (nur Lesen)

### 5.1 Server vorbereiten

```bash
openssl rand -base64 32
```

Ergebnis als `EXCHANGE_ENC_KEY_V1` (Scope Functions, secret) eintragen und neu deployen. Damit werden API-Schlüssel
und -Geheimnis AES-256-GCM-verschlüsselt gespeichert; der Browser sieht nach dem Verbinden nur noch die letzten vier
Zeichen. **Diesen Schlüssel nie verlieren oder ändern** – ohne ihn sind gespeicherte Verbindungen unlesbar.
Rotation: `EXCHANGE_ENC_KEY_V2` zusätzlich anlegen und neu deployen. Alte Verbindungen werden weiter entschlüsselt
und mit V2 neu verschlüsselt – sofort bei jedem Sync und jeder Positionsabfrage, alle übrigen (auch ungültige oder
pausierte) durch den 30-Minuten-Job, 50 pro Lauf. Im Function-Log von `exchange-sync-cron` steht danach
`"keys":{"rotated":…,"failed":…,"remaining":…}`; erst bei `"remaining":0` darf `EXCHANGE_ENC_KEY_V1` entfernt werden.
`failed` zählt Verbindungen, die sich nicht entschlüsseln lassen (Schlüssel fehlt) – diese müssen neu verbunden werden.

### 5.2 API-Schlüssel bei Bitunix anlegen

1. Bitunix → Profil → **API-Verwaltung** → **API erstellen**.
2. Berechtigungen: **nur Lesen**. **Kein** Trading, **keine** Auszahlung, keine Übertragung.
3. **Keine IP-Bindung** – Netlify Functions haben keine festen IP-Adressen; mit Bindung lehnt Bitunix jeden Aufruf ab
   (die App meldet das als „IP-Bindung“).
4. API-Key und Secret Key kopieren (das Secret zeigt Bitunix nur einmal).

Der Server ruft ohnehin nur eine feste Liste von Lese-Endpunkten auf (`READ_PATHS` in
`netlify/functions/_lib/exchanges/bitunix.ts`) – selbst ein falsch berechtigter Schlüssel könnte über diesen Code keine
Order platzieren. Trotzdem: nur Lesen.

### 5.3 Verbinden und erster Probelauf

1. In der App anmelden → **Konto** → Karte **Börse** → **Bitunix verbinden**.
2. Key und Secret einfügen, Journal-Konto wählen (Makro / Scalp), „nur Lesen“ bestätigen → **Verbinden**. Der Server
   prüft den Schlüssel mit einem signierten Leseaufruf und zeigt das Guthaben.
3. Im folgenden Dialog **Erstimport** zuerst **Erst Probelauf** wählen (nicht gleich importieren; später jederzeit
   über **Probelauf** auf der Karte). Der Probelauf (`POST /api/v1/exchange/sync?dryRun=1`)
   zeigt, was im Journal landen würde, **ohne etwas zu speichern** und ohne den Sync-Stand zu bewegen.
4. Im Probelauf zwei, drei Positionen mit der **Positionshistorie in Bitunix** vergleichen:
   - **Zeiten**: Ein- und Ausstieg stimmen in deiner Zeitzone (der Server rechnet Bitunix-Millisekunden in die
     Zeitzone des Browsers um).
   - **Netto-P&L** = realisierter Gewinn − Gebühr + Funding. Die Zeile „Gebühren geprüft: Bitunix meldet den Gewinn ohne
     Gebühren (n Positionen nachgerechnet)“ zeigt, welche Konvention erkannt wurde; Gebühren werden nie doppelt abgezogen.
   - **Funding**: gezahltes Funding mindert den Gewinn, erhaltenes erhöht ihn.
   - **Ende des Zeitraums**: die jüngste geschlossene Position ist dabei.
   Weicht etwas ab: nicht importieren, sondern den Probelauf (Screenshot, ohne Schlüssel) an den Entwickler geben.
5. Passt alles: Zeitraum wählen (30 / 90 / 180 Tage, 1 Jahr) → **Erstimport starten**. Er läuft als Hintergrund-Function
   (`exchange-backfill-background`, bis 15 Minuten); die Karte zeigt den Fortschritt.
6. Ab jetzt synchronisiert `exchange-sync-cron` alle 30 Minuten (nur auf **veröffentlichten** Deploys, nicht in
   Previews), dazu „Jetzt synchronisieren“ in der App. Was die Börse nicht weiß (Setup, Stop, Gefühl), ergänzt der
   Karte **Zu prüfen** (importierte Trades ohne Setup, Stop oder Gefühl). Von Hand getippte Stops oder Notizen überschreibt der Sync nie.

**Kontrolle:** Netlify → **Logs → Functions** → `exchange-sync-cron` zeigt alle 30 Minuten einen Lauf; Supabase →
`sync_runs` enthält die Läufe mit Zählern (`fetched`, `inserted`, `updated`, `unchanged`) und ggf. einer deutschen
Fehlermeldung.

Ohne Bitunix: **Einstellungen → Daten → Backup importieren → CSV importieren** (oder **CSV importieren** auf der
Karte Börse) liest die Exporte von Bitunix, Binance, Bybit und weiteren Plattformen
(auch ganz ohne Cloud).

---

### 5.4 Binance, TradingView und Partnerlinks (Paket Verbindungen)

- **Binance (nur Lesen, Spot und Futures als zwei getrennte Verbindungen):** Binance erlaubt Schlüssel nur mit fester IP-Freigabe. Die Ausgangs-IP des Servers muss deshalb feststehen (fester Proxy oder feste Function-Region); trage sie als `BINANCE_EGRESS_IP` ein – sie wird den Nutzern in der Anleitung gezeigt. Ohne diese Angabe bleibt der Binance-Platzhalter bei „nicht eingerichtet“. `BINANCE_SPOT_BASE` und `BINANCE_FUTURES_BASE` sind nur Test-Überschreibungen (https), im Normalbetrieb leer. Der Verschlüsselungsschlüssel `EXCHANGE_ENC_KEY_V1` (Abschnitt 5.1) wird auch für Binance-Schlüssel gebraucht.
- **TradingView-Assistent und Signal-Empfänger (B3):** braucht `SITE_ORIGIN` (für die Zieladresse des Webhooks) und die Migrationen `0012_connections.sql` (Empfangsbeleg) und `0013_signals.sql` (Signale mit Ausgang verarbeitet / doppelt / abgelehnt; ohne sie nimmt `POST /api/v1/signals/:token` nichts an). Die Zieladresse liest nichts aus dem TradingView-Konto. Optional und getrennt davon: die OAuth-/MCP-Verbindung zum offiziellen TradingView-MCP (nur Lesen) mit `TV_MCP_CLIENT_ID` (+ `SITE_ORIGIN`, `EXCHANGE_ENC_KEY_V1`); ohne die Client-ID sagt die Oberfläche „Einrichtung nötig (Betreiber)“. Fundstellen, offene Fragen und was nur gegen einen Mock geprüft ist: `docs/ENV.md`.
- **Partnerlinks:** `VITE_PARTNER_TRADINGVIEW_REF`, `VITE_PARTNER_BINANCE_REF`, `VITE_PARTNER_BITUNIX_REF` sind leer (= aus). Trage nur eigene, vom Anbieter vergebene Empfehlungs-IDs ein; sie erscheinen dann gekennzeichnet als „Partnerlink“ (siehe `docs/PARTNERLINKS.md`, `docs/RECHT/partnerlinks.md`). Vorher die Bedingungen des jeweiligen Programms prüfen.

## 6. Geplante Functions und Logs

| Function | Zeitplan | Aufgabe |
|---|---|---|
| `exchange-sync-cron` | alle 30 min | Bitunix-Sync aller Verbindungen mit Auto-Sync (`SYNC_CRON_ENABLED=false` schaltet ab) |
| `backup-nightly` | täglich | Server-Backup jedes geänderten Journals nach `backups/<user>/<tag>.json`, 14 Tage aufbewahrt |
| `billing-reconcile` | täglich | Runde 11: tägliche Gegenprobe mit Stripe – offene Abos neu lesen, Profile mit bezahltem Tarif neu berechnen, überzählige Team-Plätze entfernen, abgelaufene Wartezeiten der Empfehlungs-Gutschriften (`REFERRAL_HOLD_DAYS`) ausbuchen. Das Netz hinter dem Webhook: ein verpasstes Ereignis hält keinen Tarif mehr für immer |
| `social-aggregate` | täglich | Bestenlisten-Schnappschüsse und Community-Verteilungen (nur Opt-ins, mindestens 10 Personen) |
| `alert-watch-cron` | alle 5 min | E-Mail-Alarm bei geschlossener App (F21): prüft die Schlüsselmarken der Konten mit eingeschaltetem Schalter und mailt eine Sammelmail (siehe 6.1). Ohne `RESEND_API_KEY` / `ALERT_FROM` und Migration 0008 passiert nichts |
| `alerts-cron` | alle 5 min | Vier Alarme (C2): liest die Quellen (Branchen-Trend, Top-Trader-Umschlag, Schlüsselmarken), entscheidet die Ereignisse, stellt per E-Mail / Telefon zu (Jobs mit Lease, Wiederholung mit Wartezeit, Dead-Letter) und gleicht Anrufstatus ab. Ohne Migration 0014 passiert nichts; `ALERTS_CRON_ENABLED=0` schaltet ab |

Netlify → **Functions** listet sie mit „Scheduled“ und dem nächsten Lauf. Zeitpläne stehen im Code der Functions
(`export const config = { schedule }`), `netlify.toml` dokumentiert sie.

### 6.1 E-Mail-Alarm bei geschlossener App einrichten (optional)

Ohne diese Schritte bleibt der Schalter in der App auf „Einrichtung nötig“; sonst ändert sich nichts.

1. **Resend** (resend.com): Domain hinzufügen und verifizieren (DNS-Einträge), API-Schlüssel anlegen.
2. Netlify → Environment variables: `RESEND_API_KEY` (Functions, secret) und `ALERT_FROM` (z. B. `Trading Journal <alarm@deine-domain.de>`)
   setzen; `SITE_ORIGIN` muss gesetzt sein (Link in der Mail, Ausweich-Weg zu Binance). **Neu deployen.**
3. Migration `0008_alert_watch.sql` ausführen (2.1).
4. Falls Binance den Server sperrt (im Status der App steht dann „HTTP 451“): Netlify → Site configuration → Functions →
   **Region** auf einen EU-Standort stellen. Der Zeitplan versucht Binance erst direkt und dann über `/api/binance` der eigenen Site.
5. In der App (Markt → Alarme & Zustellprotokoll → „E-Mail-Alarm bei geschlossener App“): „Testmail senden“, dann den Schalter einschalten
   und bei einer Schlüsselmarke den Alarm einschalten. Voraussetzungen: Konto mit bestätigter E-Mail, Cloud-Sync an, Tarif Pro (Gate wie der
   Box-Scanner; ohne Stripe-Einrichtung nicht geschaltet).

**Kontrolle:** Netlify → **Logs → Functions** → `alert-watch-cron`: alle 5 Minuten eine Zeile `[fn] alert-watch-cron {…}` mit Zählern
(`accounts`, `watched`, `symbols`, `requests`, `fires`, `mails`, `waiting`, `failed`, `code`) – nie eine Adresse. Gar keine Zeile heißt:
nicht veröffentlicht (Zeitpläne laufen nur auf veröffentlichten Deploys) oder die Function-Region/Quota. Die App zeigt „zuletzt geprüft“ aus
`app_config` (`alert-watch`). Der Zeitplan läuft ohne Konto mit Schalter an nur eine Abfrage lang.

---


### 6.2 Vier Alarme und Telefon einrichten (optional)

Die vier Alarme (Grün-/Rot-Vorwarnung, Grün-/Rot-Bestätigung) laufen im Browser und per E-Mail ohne weitere Einrichtung außer Migration `0014_alerts.sql`
und dem Zeitplan `alerts-cron`. Das **Telefon** braucht zusätzlich:

1. **Twilio** (twilio.com): Konto, eine Rufnummer mit Sprachfunktion (oder verifizierte Anrufer-ID) und einen **Verify-Dienst** anlegen.
2. Netlify → Environment variables: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` (secret), `TWILIO_FROM` (E.164), `TWILIO_VERIFY_SERVICE_SID`;
   `EXCHANGE_ENC_KEY_V1` und `SITE_ORIGIN` müssen gesetzt sein (die Nummer wird verschlüsselt gespeichert, Twilio meldet den Anrufstatus an
   `SITE_ORIGIN/api/v1/alerts/twilio/status`). Optional die Kostenbremsen `ALERT_PHONE_DAILY_MAX` / `ALERT_PHONE_USER_DAILY_MAX` (Anrufe) und `ALERT_SMS_DAILY_MAX` (Bestätigungs-SMS über alle Konten),
   die Länderliste `PHONE_ALLOWED_COUNTRIES` und den eigenen Hash-Schlüssel `PHONE_HASH_KEY`. **Neu deployen.**
3. Die Nutzer bestätigen ihre Nummer selbst (SMS-Code) und willigen ausdrücklich ein; Anrufe gibt es nur ab Premium (30 pro Monat, Team 60).
4. **Betreiber-Aufgaben bei Twilio (nicht im Code lösbar, gegen SMS-Pumping und Rufnummern-Betrug):** in der Twilio-Konsole **Geo Permissions** auf die Länder
   beschränken, die du wirklich brauchst (Voice **und** SMS/Verify), im Verify-Dienst **Fraud Guard** einschalten und ein **Nutzungslimit (Spend Limit)**
   für das Konto setzen. Der Code sperrt Premium-/Sondernummern und nicht freigegebene Länder, zählt eine Tagesgrenze über alle Konten und schickt die
   Bestätigungs-SMS nur an Konten mit bezahltem Premium- oder Team-Tarif – die Twilio-Einstellungen sind die zweite Linie, nicht überflüssig.
5. Ehrlich: ohne Twilio-Konto ist kein echter Anruf möglich – alles dahinter ist gegen Fakes getestet, nicht gegen das echte Netz.

## 7. Sicherheit nach der Einrichtung

- **CSP enger stellen:** `netlify.toml` erlaubt `https://*.supabase.co` und `wss://*.supabase.co`, weil die
  Projekt-Ref nicht im Repo steht. Nach der Einrichtung beide Einträge (in `connect-src` und `img-src`) durch
  `https://<ref>.supabase.co` bzw. `wss://<ref>.supabase.co` ersetzen. Die CSP gilt nur auf Netlify – nach dem Deploy
  in der Browser-Konsole prüfen, dass keine „Content Security Policy“-Meldung erscheint (Login, Sync, Screenshot
  hochladen, Markt-Seite mit Live-Daten).
- **2FA** für das eigene Konto einrichten (Konto → Sicherheit).
- **Supabase → Auth → Rate Limits** prüfen; die Functions haben eigene Limits (`rate_hit()`).
- Geheimnisse nur in Netlify (Scope Functions) – nie in `VITE_*`, nie ins Repo. `.env` / `.env.local` sind
  git-ignoriert.
- **Betrieb (C4):** `OPS_TOKEN` setzen (mindestens 24 Zeichen, `openssl rand -base64 32`), dann zeigt
  `curl -H "Authorization: Bearer $OPS_TOKEN" "$SITE/api/v1/ops/status?probe=1&stats=1"` pro Funktion, welche Variablen
  fehlen („nicht eingerichtet“ heißt: läuft nicht, nie „frei“). Vor dem Deploy: `node scripts/releaseCheck.mjs`.
  Notfall-Schalter `KILL_SYNC`, `KILL_CALLS`, `KILL_AI`, `KILL_CHECKOUT`, `KILL_MAIL` (`true` = Bereich aus; **Netlify wendet geänderte
  Variablen erst mit dem nächsten Deploy an** – nach dem Setzen neu deployen, `ops-status` zeigt, was die laufenden Functions sehen).
  Für Produktion zeigt `ops-status` zusätzlich, wenn Stripe fehlt (die Functions laufen dann **geschlossen**, siehe `ALLOW_UNGATED`) oder
  `IP_HASH_PEPPER` nicht gesetzt ist.
  Alle Variablen mit Zweck und Verhalten ohne sie: `docs/ENV.md`; Überwachung, Backup-Probe, Kostenbudget, Notfall und
  Löschfristen: `docs/BETRIEB.md`.

---

## 8. CI und Tests

`.github/workflows/ci.yml` (Repo-Root) läuft bei jedem Push und Pull Request:

- **check**: `npm ci`, `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `npm run budget`
  (Größe der Erstladung, `scripts/bundleBudget.mjs`), `npm run build:share`.
- **e2e** (nur Pull Requests): installiert Chromium (`npx playwright install --with-deps chromium`) und führt die
  Playwright-Specs gegen den Produktions-Build (`vite preview`) aus – mobil und Desktop. Zwei Server: der normale Build
  (ohne Cloud, Port 4173) und eine Cloud-Ausgabe gegen den Supabase-Mock der Tests (`npm run build:e2e-cloud`, Port 4174)
  für Konto, Preise, Börse und Community.

Lokal:

```bash
npm run e2e -- --project=mobile --project=desktop   # baut alles und startet vite preview auf :4173 und :4174
# gegen schon laufende Preview-Server:
PW_BASE_URL=http://127.0.0.1:4173 PW_CLOUD_BASE_URL=http://127.0.0.1:4174 \
  npx playwright test tests/e2e/pages.spec.ts --project=mobile --project=desktop
```

Die Specs laufen ohne echtes Supabase / Stripe / Bitunix (Netzwerk wird in den Tests nachgebildet). Den echten
Durchstich (Schritte 3–5) einmal von Hand mit Testkonten prüfen.

## Vorschau pro Pull Request

Netlify baut eine Vorschau (`https://deploy-preview-<Nummer>--<deine-site>.netlify.app`) nur für Pull Requests, die auf den
Produktionszweig der Seite zielen. Zielt ein PR auf einen anderen Zweig (zum Beispiel auf den eines früheren PR), gibt es
keine Vorschau; dann die Basis des PR auf den Produktionszweig stellen und einmal pushen. Der erste Build danach dauert
etwa 2 bis 5 Minuten, den Link schreibt Netlify als Kommentar in den PR.

**Netlify deploy-preview = die echte App.** Die Vorschau eines Pull Requests baut genau wie die Produktion (`netlify.toml`, Kontext `deploy-preview`:
`npm ci && npm run build && npm run build:share`) – mit deinem Supabase-Projekt, Stripe im Testmodus und der Konto-Pflicht. Die Werte der Vorschau setzt du in
Netlify mit dem Bereich „Deploy Previews“: `SITE_ORIGIN` (die `deploy-preview-<Nummer>--…`-Adresse), das `STRIPE_WEBHOOK_SECRET` des Vorschau-Endpunkts; die
Vorschau-Adresse muss in Supabase unter Authentication → URL Configuration in den Redirect-URLs stehen (`https://*--<deine-site>.netlify.app/**`, siehe 2.2), sonst
landen Bestätigungs- und Reset-Links auf der Site-URL. Kein „Neu in dieser Version“, kein Demo-Banner, kein Mock-Backend in irgendeinem Deploy
(`tests/unit/showroom.bundle.test.ts`). Der Showroom (Paket S) ist nur noch eine **lokale** Demo: `npm run build:showroom`, Details in `docs/SHOWROOM.md`.

**Konto-Pflicht.** In jedem Build mit `VITE_SUPABASE_URL` + `VITE_SUPABASE_PUBLISHABLE_KEY` (Produktion, Vorschau) sieht ein nicht angemeldeter Besucher zuerst
das Anmelde-/Registrierfenster als ganze Seite (`src/cloud/gate.ts`, `src/app/gate/EntryGate.tsx`): beim ersten Besuch „Konto erstellen“, wer in diesem Browser
schon angemeldet war, „Anmelden“. Nach der Bestätigungs-Mail ist man in der App auf Free; ein Journal, das schon in diesem Browser lag, geht durch die
Datenübernahme beim ersten Login (nichts geht verloren). Ohne Anmeldung erreichbar: Impressum, Datenschutz, AGB, Widerruf, Hinweise (`?rechtliches=…`),
„Verträge hier kündigen“ (`?kuendigen`, § 312k BGB) und „Vertrag widerrufen“ (`?widerruf`, § 356a BGB) samt den Token-Links der Mails, `#preise` (nur lesen –
jeder Kaufknopf führt zur Registrierung, die Auswahl kommt nach dem Login zurück), die geteilte Ansicht `#share/<token>` und die Teilen-Edition `/teilen/`.
Abmelden, Leerlauf-Abmeldung und eine abgelaufene Sitzung führen zurück zum Tor. Builds ohne Cloud (lokal, `npm run dev`, die Standard-e2e) haben kein Tor.
