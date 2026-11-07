# Umgebungsvariablen

> Diese Datei wird aus `netlify/functions/_lib/envSpec.ts` erzeugt (`node scripts/envDoc.mjs --write`). Ein Test prüft, dass sie
> dazu passt. Dieselbe Liste speist `node scripts/releaseCheck.mjs` und die Betreiber-Seite `/api/v1/ops/status`.

**Grundregel:** Eine fehlende Variable heißt „nicht eingerichtet“ – der Bereich läuft dann nicht und sagt das. Sie heißt nie „frei“
und schaltet nie etwas auf, was bezahlt oder geschützt sein soll. (Einzige Ausnahme, bewusst: ohne Stripe sind alle Funktionen
zugänglich, weil es dann keine Tarife gibt – die Konto-Seite sagt „Zahlungen noch nicht eingerichtet“.)

Alle Werte stehen nur in Netlify (Site configuration → Environment variables), Server-Werte mit „Contains secret values“, **nie** mit
`VITE_`-Vorsatz und nie im Repo. Vorlage: `.env.example`. Prüfung vor dem Deploy: `node scripts/releaseCheck.mjs`.

**Spalten:** Name · Zweck · Pflicht? · Scope · ohne sie → Verhalten. „Geheim“ = Netlify-Secret, nie in Logs. „(geplant)“ = der Name ist
vereinbart, der Code liest ihn in diesem Stand noch nicht.

## Konto & Cloud (Supabase)

Hängt daran: Login, Sync, Konto, jede Funktion mit Anmeldung. **Kern-Bereich** – ohne ihn schlägt der Release-Check fehl.

| Name | Zweck | Pflicht? | Scope | Ohne sie → Verhalten |
| --- | --- | --- | --- | --- |
| `VITE_SUPABASE_URL` | Projekt-Adresse für den Browser (öffentlich) | Pflicht | Browser-Build (Scope Builds, öffentlich) | Die App läuft nur lokal: kein Login, kein Sync, Konto-Seite sagt „Cloud nicht eingerichtet“. |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Veröffentlichbarer Schlüssel (sb_publishable_…) für den Browser | Pflicht | Browser-Build (Scope Builds, öffentlich) | Wie oben: nur lokal. |
| `VITE_SUPABASE_OAUTH_PROVIDERS` | Komma-Liste der Anmelde-Anbieter (google,github,apple,discord) | Optional | Browser-Build (Scope Builds, öffentlich) | Kein Knopf „Mit … anmelden“; Passwort und Magic Link bleiben. |
| `SUPABASE_URL` | Projekt-Adresse für die Server-Funktionen | Pflicht | Funktionen (Netlify, Scope Functions) | Jede Funktion mit Anmeldung antwortet 500 „Der Server ist nicht vollständig eingerichtet.“ |
| `SUPABASE_SECRET_KEY` | Service-Schlüssel (sb_secret_…) – umgeht RLS, nur in Funktionen | Pflicht · geheim | Funktionen (Netlify, Scope Functions) | Wie oben; auch Export, Löschen, Backups und Raten-Begrenzung laufen nicht. |
| `IP_HASH_PEPPER` | Geheimer Schlüssel für IP-Pseudonyme in Audit-Log und Raten-Begrenzung (openssl rand -base64 32) | Optional · geheim | Funktionen (Netlify, Scope Functions) | Der Schlüssel wird aus SUPABASE_SECRET_KEY abgeleitet. |
| `LOG_SAMPLE_RATE` | Anteil gespeicherter Fehlerberichte, 0–1 (Standard 1) | Optional | Funktionen (Netlify, Scope Functions) | Alle Berichte (nur mit Einwilligung des Nutzers). |

## Adresse der Seite

Hängt daran: Links in E-Mails, Weiterleitungen, Proxy-Rückfall. **Kern-Bereich** – ohne ihn schlägt der Release-Check fehl.

| Name | Zweck | Pflicht? | Scope | Ohne sie → Verhalten |
| --- | --- | --- | --- | --- |
| `SITE_ORIGIN` | Adresse der Seite (https://…) für Links in E-Mails, Weiterleitungen und den Proxy-Rückfall | Pflicht | Funktionen (Netlify, Scope Functions) | Weiterleitungen nach dem Bezahlen und Links in E-Mails fehlen; der Binance-Proxy-Rückfall des Alarm-Crons ist aus. |

## Abos (Stripe)

Hängt daran: Kaufstrecke, Kundenportal, Webhook, Tarif-Freischaltung.

| Name | Zweck | Pflicht? | Scope | Ohne sie → Verhalten |
| --- | --- | --- | --- | --- |
| `STRIPE_SECRET_KEY` | Stripe-Schlüssel (sk_… / rk_…) | Pflicht für den Bereich · geheim | Funktionen (Netlify, Scope Functions) | „Zahlungen sind noch nicht eingerichtet“: kein Kauf; alle Funktionen sind frei zugänglich (Betreiber-Entscheidung, siehe Konto-Seite). |
| `STRIPE_WEBHOOK_SECRET` | Signatur-Geheimnis des Stripe-Webhooks (whsec_…) | Pflicht für den Bereich · geheim | Funktionen (Netlify, Scope Functions) | Der Webhook lehnt jede Meldung ab: bezahlte Tarife werden nie freigeschaltet. |
| `STRIPE_PRICE_PRO_MONTHLY` | Preis-ID Pro, monatlich | Pflicht für den Bereich | Funktionen (Netlify, Scope Functions) | Dieser Tarif/Intervall ist nicht kaufbar. |
| `STRIPE_PRICE_PRO_YEARLY` | Preis-ID Pro, jährlich | Pflicht für den Bereich | Funktionen (Netlify, Scope Functions) | Dieser Tarif/Intervall ist nicht kaufbar. |
| `STRIPE_PRICE_PREMIUM_MONTHLY` | Preis-ID Premium, monatlich | Pflicht für den Bereich | Funktionen (Netlify, Scope Functions) | Dieser Tarif/Intervall ist nicht kaufbar. |
| `STRIPE_PRICE_PREMIUM_YEARLY` | Preis-ID Premium, jährlich | Pflicht für den Bereich | Funktionen (Netlify, Scope Functions) | Dieser Tarif/Intervall ist nicht kaufbar. |
| `STRIPE_PRICE_TEAM_MONTHLY` | Preis-ID Team je Sitz, monatlich | Pflicht für den Bereich | Funktionen (Netlify, Scope Functions) | Dieser Tarif/Intervall ist nicht kaufbar. |
| `STRIPE_PRICE_TEAM_YEARLY` | Preis-ID Team je Sitz, jährlich | Pflicht für den Bereich | Funktionen (Netlify, Scope Functions) | Dieser Tarif/Intervall ist nicht kaufbar. |
| `TRIAL_DAYS` | Länge der Testphase in Tagen (Standard 14) | Optional | Funktionen (Netlify, Scope Functions) | 14 Tage. |
| `STRIPE_TRIAL_CARDLESS` | Testphase ohne Karte (true/false, Standard false) | Optional | Funktionen (Netlify, Scope Functions) | Testphase nur mit Zahlungsmittel. |
| `STRIPE_AUTOMATIC_TAX` | Stripe Tax im Checkout (true/false, Standard false) | Optional | Funktionen (Netlify, Scope Functions) | Keine automatische Steuerberechnung durch Stripe. |
| `REFERRAL_TRIAL_DAYS` | Testphase über einen Einladungslink in Tagen (Standard 30) | Optional | Funktionen (Netlify, Scope Functions) | 30 Tage. |
| `REFERRAL_REWARD_CENTS` | Gutschrift je zahlendem Geworbenen in Cent (Standard 1000) | Optional | Funktionen (Netlify, Scope Functions) | 1000 Cent. |

## Börsen-Sync

Hängt daran: Börsen-Verbindung (Schlüssel verschlüsselt speichern), Sync, Cron.

| Name | Zweck | Pflicht? | Scope | Ohne sie → Verhalten |
| --- | --- | --- | --- | --- |
| `EXCHANGE_ENC_KEY_V1` | AES-256-Schlüssel (base64, 32 Byte) für Börsen-API-Schlüssel; weitere Versionen V2… für die Rotation | Pflicht für den Bereich · geheim | Funktionen (Netlify, Scope Functions) | 503 „Der Börsen-Sync ist auf diesem Server noch nicht eingerichtet.“ – es wird kein Börsen-Schlüssel gespeichert. |
| `SYNC_CRON_ENABLED` | Geplanter Börsen-Sync an/aus (true/false) | Optional | Funktionen (Netlify, Scope Functions) | An. |

## E-Mail-Alarm (Resend)

Hängt daran: E-Mail-Alarm bei geschlossener App, Test-Mail.

| Name | Zweck | Pflicht? | Scope | Ohne sie → Verhalten |
| --- | --- | --- | --- | --- |
| `RESEND_API_KEY` | Resend-Schlüssel für Alarm-Mails | Pflicht für den Bereich · geheim | Funktionen (Netlify, Scope Functions) | Der Alarm-Cron tut nichts, die App zeigt „Einrichtung nötig“, kein Testmail. |
| `ALERT_FROM` | Absender („Name <alarm@deine-domain>“, Domain bei Resend geprüft) | Pflicht für den Bereich | Funktionen (Netlify, Scope Functions) | Wie RESEND_API_KEY. |

## Telefon-Alarm (Twilio)

Hängt daran: Anruf-Alarm, Testanruf, Nummernprüfung.

| Name | Zweck | Pflicht? | Scope | Ohne sie → Verhalten |
| --- | --- | --- | --- | --- |
| `TWILIO_ACCOUNT_SID` | Twilio-Konto (AC…) | Pflicht für den Bereich · (geplant) | Funktionen (Netlify, Scope Functions) | Kein Telefon-Alarm: „Einrichtung nötig“, kein Testanruf. |
| `TWILIO_AUTH_TOKEN` | Twilio-Auth-Token | Pflicht für den Bereich · geheim · (geplant) | Funktionen (Netlify, Scope Functions) | Wie TWILIO_ACCOUNT_SID. |
| `TWILIO_FROM` | Verifizierte Absendernummer (E.164) | Pflicht für den Bereich · (geplant) | Funktionen (Netlify, Scope Functions) | Wie TWILIO_ACCOUNT_SID. |

## KI (Anthropic)

Hängt daran: Coach-Formulierung, Screenshot-Import, Strategie-Übersetzer, Assistent.

| Name | Zweck | Pflicht? | Scope | Ohne sie → Verhalten |
| --- | --- | --- | --- | --- |
| `ANTHROPIC_API_KEY` | Anthropic-Schlüssel (nur Server) | Pflicht für den Bereich · geheim | Funktionen (Netlify, Scope Functions) | Coach-Formulierung, Screenshot-Import per KI, Strategie-Übersetzer und Assistent melden „nicht verfügbar“; die App rechnet alles andere lokal. |
| `COACH_MODEL` | Modell des Coachs (Standard claude-opus-5-5) | Optional | Funktionen (Netlify, Scope Functions) | Standardmodell. |
| `ROUTER_MODEL` | Modell des Assistenten-Routers | Optional | Funktionen (Netlify, Scope Functions) | Standardmodell. |
| `VISION_MODEL` | Modell des Screenshot-Imports (Standard = COACH_MODEL) | Optional | Funktionen (Netlify, Scope Functions) | COACH_MODEL. |

## SEC EDGAR

Hängt daran: Quartalszahlen, DCF, Thesen-Monitor.

| Name | Zweck | Pflicht? | Scope | Ohne sie → Verhalten |
| --- | --- | --- | --- | --- |
| `SEC_USER_AGENT` | Kontakt im User-Agent („Name kontakt@domain“) – die SEC verlangt ihn | Pflicht für den Bereich | Funktionen (Netlify, Scope Functions) | Die SEC-Funktionen melden „Einrichtung nötig“ und rufen die SEC nicht auf. |

## Betreiber-Status

Hängt daran: /api/v1/ops/status.

| Name | Zweck | Pflicht? | Scope | Ohne sie → Verhalten |
| --- | --- | --- | --- | --- |
| `OPS_TOKEN` | Betreiber-Token für /api/v1/ops/status (mindestens 24 Zeichen, zufällig) | Pflicht für den Bereich · geheim | Funktionen (Netlify, Scope Functions) | Die Statusseite antwortet 503 „nicht eingerichtet“ und gibt nichts preis. |

## Notfall-Schalter

| Name | Zweck | Pflicht? | Scope | Ohne sie → Verhalten |
| --- | --- | --- | --- | --- |
| `KILL_SYNC` | Notfall-Schalter: Cloud-Sync und Börsen-Sync aus (true) | Optional | Funktionen (Netlify, Scope Functions) | Aus (Sync läuft). |
| `KILL_CALLS` | Notfall-Schalter: keine Telefon-Anrufe (true) | Optional | Funktionen (Netlify, Scope Functions) | Aus (Anrufe erlaubt, sobald Twilio eingerichtet ist). |
| `KILL_AI` | Notfall-Schalter: keine KI-Aufrufe (true) | Optional | Funktionen (Netlify, Scope Functions) | Aus (KI läuft, sobald ein Schlüssel da ist). |
| `KILL_CHECKOUT` | Notfall-Schalter: Kaufstrecke zu (true) – neue Käufe gehen nicht, bestehende Abos und das Kundenportal bleiben | Optional | Funktionen (Netlify, Scope Functions) | Aus (Kauf läuft, sobald Stripe eingerichtet ist). |

## Rechtliches & Sonstiges (Client)

| Name | Zweck | Pflicht? | Scope | Ohne sie → Verhalten |
| --- | --- | --- | --- | --- |
| `VITE_LEGAL_OPERATOR` | Impressum: Betreiber | Optional | Browser-Build (Scope Builds, öffentlich) | Markierter Platzhalter statt Angabe; nichts wird erfunden. |
| `VITE_LEGAL_ADDRESS` | Impressum: Anschrift (Zeilen mit \| getrennt) | Optional | Browser-Build (Scope Builds, öffentlich) | Markierter Platzhalter. |
| `VITE_LEGAL_EMAIL` | Impressum: E-Mail | Optional | Browser-Build (Scope Builds, öffentlich) | Markierter Platzhalter. |
| `VITE_LEGAL_PHONE` | Impressum: Telefon | Optional | Browser-Build (Scope Builds, öffentlich) | Markierter Platzhalter. |
| `VITE_LEGAL_REPRESENTATIVE` | Impressum: Vertretungsberechtigte | Optional | Browser-Build (Scope Builds, öffentlich) | Markierter Platzhalter. |
| `VITE_LEGAL_REGISTER` | Impressum: Registereintrag | Optional | Browser-Build (Scope Builds, öffentlich) | Markierter Platzhalter. |
| `VITE_LEGAL_VAT_ID` | Impressum: USt-IdNr. | Optional | Browser-Build (Scope Builds, öffentlich) | Markierter Platzhalter. |
| `VITE_LEGAL_RESPONSIBLE` | Impressum: Verantwortlicher für Inhalte | Optional | Browser-Build (Scope Builds, öffentlich) | Markierter Platzhalter. |
| `VITE_LEGAL_IMPRESSUM_URL` | Eigene Impressum-Seite (ersetzt die In-App-Seite) | Optional | Browser-Build (Scope Builds, öffentlich) | In-App-Impressum aus den Angaben oben. |
| `VITE_LEGAL_DATENSCHUTZ_URL` | Eigene Datenschutzerklärung | Optional | Browser-Build (Scope Builds, öffentlich) | Markierter Platzhalter. |
| `VITE_LEGAL_AGB_URL` | Eigene AGB | Optional | Browser-Build (Scope Builds, öffentlich) | Markierter Platzhalter. |
| `VITE_LEGAL_WIDERRUF_URL` | Eigene Widerrufsbelehrung | Optional | Browser-Build (Scope Builds, öffentlich) | Die Widerrufsbelehrung ist Teil der AGB. |
| `HYBLOCK_API_KEY` | Hyblock (optional, derzeit nicht gelesen) | Optional · geheim · (geplant) | Funktionen (Netlify, Scope Functions) | Hyblock-Werte werden von Hand eingetragen. |
| `HYBLOCK_BASE_URL` | Hyblock (optional, derzeit nicht gelesen) | Optional · (geplant) | Funktionen (Netlify, Scope Functions) | Wie HYBLOCK_API_KEY. |
| `HYBLOCK_AUTH_HEADER` | Hyblock (optional, derzeit nicht gelesen) | Optional · (geplant) | Funktionen (Netlify, Scope Functions) | Wie HYBLOCK_API_KEY. |

## Welche Funktion braucht welchen Bereich

Aus `FUNCTION_ENV` in `envSpec.ts`; `/api/v1/ops/status` zeigt dasselbe live („eingerichtet“ / „teilweise“ / „nicht eingerichtet“).

| Funktion | Route | Bereiche | Notfall-Schalter |
| --- | --- | --- | --- |
| `account-export` | /api/v1/account/export | Konto & Cloud (Supabase) | – |
| `account-delete` | /api/v1/account/delete | Konto & Cloud (Supabase) | – |
| `account-backups` | /api/v1/account/backups | Konto & Cloud (Supabase) | – |
| `account-mfa-recovery` | /api/v1/account/mfa-recovery | Konto & Cloud (Supabase) | – |
| `audit` | /api/v1/audit | Konto & Cloud (Supabase) | – |
| `log` | /api/v1/log | Konto & Cloud (Supabase) | – |
| `backup-nightly` | (täglich) | Konto & Cloud (Supabase) | – |
| `billing-status` | /api/v1/billing/status | Konto & Cloud (Supabase) | – |
| `billing-checkout` | /api/v1/billing/checkout | Konto & Cloud (Supabase), Abos (Stripe), Adresse der Seite | `KILL_CHECKOUT` |
| `billing-portal` | /api/v1/billing/portal | Konto & Cloud (Supabase), Abos (Stripe) | – |
| `billing-code` | /api/v1/billing/code | Konto & Cloud (Supabase), Abos (Stripe) | – |
| `billing-referral` | /api/v1/billing/referral | Konto & Cloud (Supabase), Abos (Stripe) | – |
| `stripe-webhook` | /api/v1/stripe/webhook | Konto & Cloud (Supabase), Abos (Stripe) | – |
| `exchange-connect` | /api/v1/exchange/connect | Konto & Cloud (Supabase), Börsen-Sync | `KILL_SYNC` |
| `exchange-disconnect` | /api/v1/exchange/disconnect | Konto & Cloud (Supabase), Börsen-Sync | – |
| `exchange-sync` | /api/v1/exchange/sync | Konto & Cloud (Supabase), Börsen-Sync | `KILL_SYNC` |
| `exchange-positions` | /api/v1/exchange/positions | Konto & Cloud (Supabase), Börsen-Sync | `KILL_SYNC` |
| `exchange-backfill-background` | /api/v1/exchange/backfill | Konto & Cloud (Supabase), Börsen-Sync | `KILL_SYNC` |
| `exchange-sync-cron` | (alle 30 Min) | Konto & Cloud (Supabase), Börsen-Sync | `KILL_SYNC` |
| `alert-watch-cron` | (alle 5 Min) | Konto & Cloud (Supabase), E-Mail-Alarm (Resend), Adresse der Seite | – |
| `alert-test` | /api/v1/alerts/test | Konto & Cloud (Supabase), E-Mail-Alarm (Resend) | – |
| `coach-ask` | /api/v1/coach/ask | Konto & Cloud (Supabase), KI (Anthropic) | `KILL_AI` |
| `shot-extract` | /api/v1/shot-extract | Konto & Cloud (Supabase), KI (Anthropic) | `KILL_AI` |
| `strategy-compile` | /api/v1/strategy/compile | Konto & Cloud (Supabase), KI (Anthropic) | `KILL_AI` |
| `assistant-route` | /api/v1/assistant/route | Konto & Cloud (Supabase), KI (Anthropic) | `KILL_AI` |
| `sec-facts` | /api/v1/sec/facts | Konto & Cloud (Supabase), SEC EDGAR | – |
| `sec-filings` | /api/v1/sec/filings | Konto & Cloud (Supabase), SEC EDGAR | – |
| `hooks-tradingview` | /api/v1/hooks/tradingview/:token | Konto & Cloud (Supabase) | – |
| `trades-api` | /api/v1/trades | Konto & Cloud (Supabase) | – |
| `social-share` | /api/v1/social/share | Konto & Cloud (Supabase) | – |
| `social-shared` | /api/v1/social/shared/:token | Konto & Cloud (Supabase) | – |
| `social-groups` | /api/v1/social/groups | Konto & Cloud (Supabase) | – |
| `social-leaderboard` | /api/v1/social/leaderboard | Konto & Cloud (Supabase) | – |
| `social-aggregate` | (täglich) | Konto & Cloud (Supabase) | – |
| `feedback` | /api/v1/feedback | Konto & Cloud (Supabase) | – |
| `ops-status` | /api/v1/ops/status | Betreiber-Status | – |
| `ops-flags` | /api/v1/flags | keine (öffentliche Daten) | – |
| `congress-index` | /api/v1/congress/index | keine (öffentliche Daten) | – |
| `congress-ptr` | /api/v1/congress/ptr | keine (öffentliche Daten) | – |
| `industry-daily` | /api/v1/industry/daily | keine (öffentliche Daten) | – |
| `klines-proxy` | /api/v1/klines | keine (öffentliche Daten) | – |
| `stock-bars` | /api/v1/stocks/bars | keine (öffentliche Daten) | – |
| `stock-news` | /api/v1/stocks/news | keine (öffentliche Daten) | – |
| `stock-quote` | /api/v1/stocks/quote | keine (öffentliche Daten) | – |
| `stock-symbols` | /api/v1/stocks/symbols | keine (öffentliche Daten) | – |
