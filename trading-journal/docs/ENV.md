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
| `IP_HASH_PEPPER` | Geheimer Schlüssel (Version 1) für IP-Pseudonyme in Audit-Log und Raten-Begrenzung, für den gesalzenen Hash der E-Mail-Adresse in `contract_requests`, für die Wiederherstellungscodes der Zwei-Faktor-Anmeldung und für die Testphasen-Sperre (openssl rand -base64 32). PFLICHT in Produktion: ohne ihn gibt es dort keine neuen Wiederherstellungscodes, und `ops-status` meldet „unvollständig“ | Pflicht · geheim | Funktionen (Netlify, Scope Functions) | Der Schlüssel wird aus SUPABASE_SECRET_KEY abgeleitet (nur zum Prüfen alter Codes); in Produktion gibt es keine neuen Wiederherstellungscodes. |
| `IP_HASH_PEPPER_V2` | Zweite Version des Pepper-Schlüssels (Rotation; `…_V3` bis `…_V9` ebenso): neue Hashes und Codes nutzen die höchste vorhandene Version, ältere bleiben zum Prüfen gültig – die alte Version erst entfernen, wenn kein Wiederherstellungscode und keine Testphasen-Sperre damit mehr gebraucht wird | Optional · geheim | Funktionen (Netlify, Scope Functions) | Version 1 (`IP_HASH_PEPPER`) bleibt der Schlüssel. |
| `LOG_SAMPLE_RATE` | Anteil gespeicherter Fehlerberichte, 0–1 (Standard 1) | Optional | Funktionen (Netlify, Scope Functions) | Alle Berichte (nur mit Einwilligung des Nutzers). |

## Adresse der Seite

Hängt daran: Links in E-Mails, Weiterleitungen, Proxy-Rückfall. **Kern-Bereich** – ohne ihn schlägt der Release-Check fehl.

| Name | Zweck | Pflicht? | Scope | Ohne sie → Verhalten |
| --- | --- | --- | --- | --- |
| `SITE_ORIGIN` | Öffentliche Adresse der Seite (https://…, ohne Schrägstrich am Ende): Links in E-Mails und Bestätigungs-Mails, Rücksprung-Adressen der Kaufstrecke (mit gesetzter Variable wird jeder andere Ursprung abgelehnt – kein offener Redirect), Binance-Proxy-Rückfall des Alarm-Crons, Zieladresse des TradingView-Assistenten, Rücksprung der TradingView-MCP-Verbindung (<SITE_ORIGIN>/api/v1/connections/tradingview/mcp/callback, bei TradingView genau so eintragen) und Ziel der Twilio-Status-Rückmeldung | Pflicht | Funktionen (Netlify, Scope Functions) | Rücksprung nach dem Bezahlen und Links in E-Mails nehmen den Ursprung der Anfrage; der Binance-Proxy-Rückfall des Alarm-Crons ist aus; der TradingView-Assistent nimmt die Adresse, unter der die Seite gerade geöffnet ist; die TradingView-MCP-Verbindung startet nicht; Anrufe gehen, der Status kommt nur über das Nachfragen bei Twilio (alle 5 Minuten). |
| `VITE_SHOWROOM` | `1` = Showroom-Build (Paket S, docs/SHOWROOM.md): Mock-Backend im Browser, Demo-Banner, „Neu in dieser Version“. Setzt nur das npm-Skript `build:showroom` (lokale Demo) – kein Netlify-Kontext baut ihn (auch Deploy-Previews bauen die echte App), nie im Netlify-Menü | Optional | Build | Normaler Build: kein Showroom-Code im Bundle (Test `showroom.bundle`). |

## Abos (Stripe)

Hängt daran: Kaufstrecke, Kundenportal, Webhook, Tarif-Freischaltung.

| Name | Zweck | Pflicht? | Scope | Ohne sie → Verhalten |
| --- | --- | --- | --- | --- |
| `STRIPE_SECRET_KEY` | Stripe-Schlüssel (sk_… / rk_…): Checkout-Sitzung, Portal, Preise | Pflicht für den Bereich · geheim | Funktionen (Netlify, Scope Functions) | „Zahlungen sind noch nicht eingerichtet“: `billing-status` meldet `enabled: false`, `billing-checkout` antwortet 503 – kein Fake-Kauf; alle Funktionen sind frei zugänglich (Betreiber-Entscheidung, siehe Konto-Seite). |
| `VITE_STRIPE_PUBLISHABLE_KEY` | Veröffentlichbarer Stripe-Schlüssel (pk_test_… / pk_live_…) für das Bezahlfenster (Paket V): Kartenfelder von Stripe (Elements) in der App, die Nummer geht vom Browser direkt zu Stripe | Optional | Browser-Build (Scope Builds, öffentlich) | Das Bezahlfenster gibt die Bestellung wie bisher an Stripe Checkout weiter (Weiterleitung); Stripe.js wird nie geladen. |
| `STRIPE_WEBHOOK_SECRET` | Signatur-Geheimnis des Stripe-Webhooks (whsec_…); NUR der Webhook schaltet einen Tarif frei | Pflicht für den Bereich · geheim | Funktionen (Netlify, Scope Functions) | Der Webhook antwortet 503 und lehnt jede Meldung ab: bezahlte Tarife werden nie freigeschaltet; die Ergebnisseite bleibt bei „Wir warten noch auf die Bestätigung von Stripe“. |
| `STRIPE_PRICE_PRO_MONTHLY` | Preis-ID Pro, monatlich | Pflicht für den Bereich | Funktionen (Netlify, Scope Functions) | Dieser Tarif/Intervall ist nicht kaufbar. |
| `STRIPE_PRICE_PRO_YEARLY` | Preis-ID Pro, jährlich | Pflicht für den Bereich | Funktionen (Netlify, Scope Functions) | Dieser Tarif/Intervall ist nicht kaufbar. |
| `STRIPE_PRICE_PREMIUM_MONTHLY` | Preis-ID Premium, monatlich | Pflicht für den Bereich | Funktionen (Netlify, Scope Functions) | Dieser Tarif/Intervall ist nicht kaufbar. |
| `STRIPE_PRICE_PREMIUM_YEARLY` | Preis-ID Premium, jährlich | Pflicht für den Bereich | Funktionen (Netlify, Scope Functions) | Dieser Tarif/Intervall ist nicht kaufbar. |
| `STRIPE_PRICE_TEAM_MONTHLY` | Preis-ID Team je Sitz, monatlich | Pflicht für den Bereich | Funktionen (Netlify, Scope Functions) | Dieser Tarif/Intervall ist nicht kaufbar. |
| `STRIPE_PRICE_TEAM_YEARLY` | Preis-ID Team je Sitz, jährlich | Pflicht für den Bereich | Funktionen (Netlify, Scope Functions) | Dieser Tarif/Intervall ist nicht kaufbar. |
| `TRIAL_DAYS` | Länge der Testphase in Tagen (Standard 14); die Bestellübersicht nennt den Preis NACH der Testphase und das Datum der ersten Zahlung | Optional | Funktionen (Netlify, Scope Functions) | 14 Tage. |
| `STRIPE_TRIAL_CARDLESS` | Testphase ohne Karte (true/false, Standard false) | Optional | Funktionen (Netlify, Scope Functions) | Testphase nur mit Zahlungsmittel. |
| `STRIPE_AUTOMATIC_TAX` | Stripe Tax im Checkout (true/false, Standard false; Betreiberentscheidung mit dem Steuerberater, docs/RECHT/preisangaben.md): Anschrift Pflicht, Steuer-ID abfragbar | Optional | Funktionen (Netlify, Scope Functions) | Die Bestellübersicht sagt „Stripe Tax ist beim Betreiber nicht eingeschaltet“; mit `true`: „Steuer wird im nächsten Schritt von Stripe berechnet“. Nie ein erfundener Betrag. |
| `REFERRAL_TRIAL_DAYS` | Testphase über einen Einladungslink in Tagen (Standard 30) | Optional | Funktionen (Netlify, Scope Functions) | 30 Tage. |
| `REFERRAL_REWARD_CENTS` | Gutschrift je zahlendem Geworbenen in Cent (Standard 1000) | Optional | Funktionen (Netlify, Scope Functions) | 1000 Cent. |
| `REFERRAL_HOLD_DAYS` | Tage, die eine Empfehlungs-Gutschrift wartet, bevor sie auf das Stripe-Guthaben kommt (Standard 14): in dieser Zeit kommt eine Erstattung oder Rückbuchung der ersten Zahlung noch an; danach schreibt `billing-reconcile` sie gut. Eine Gutschrift gibt es nur für eine echte Zahlung mindestens in Höhe der Gutschrift | Optional | Funktionen (Netlify, Scope Functions) | 14 Tage. |
| `ALLOW_UNGATED` | `true` = in PRODUKTION dürfen alle Funktionen ohne Stripe-Einrichtung frei laufen (Telefon, SMS, KI, Hintergrund-Sync, Teams). Ohne diese Variable sperrt eine Produktion ohne Stripe-Schlüssel oder Preis-IDs ZU (jedes Konto zählt als Free) – statt für alle kostenlos zu werden. Nur für Betreiber, die bewusst gar nichts verkaufen und die Kosten selbst tragen; in Vorschau-Deploys und lokal ist alles ohnehin frei | Optional | Funktionen (Netlify, Scope Functions) | Produktion ohne Stripe: geschlossen (Free-Rechte für alle); `ops-status` meldet es. |

## Börsen-Sync

Hängt daran: Börsen-Verbindung (Schlüssel verschlüsselt speichern), Sync, Cron.

| Name | Zweck | Pflicht? | Scope | Ohne sie → Verhalten |
| --- | --- | --- | --- | --- |
| `EXCHANGE_ENC_KEY_V1` | AES-256-Schlüssel (base64, 32 Byte, `openssl rand -base64 32`): verschlüsselt die Börsen-API-Schlüssel (Bitunix und Binance; je Nutzer und Verbindung gebunden), die Telefonnummer des Telefon-Alarms (AES-GCM) und die Token der TradingView-MCP-Verbindung; weitere Versionen V2… für die Rotation (höhere Versionsnummer) | Pflicht für den Bereich · geheim | Funktionen (Netlify, Scope Functions) | 503 „Der Börsen-Sync ist auf diesem Server noch nicht eingerichtet.“ – es wird kein Börsen-Schlüssel gespeichert; das Telefon ist nicht möglich (503 phone_unavailable); die TradingView-MCP-Verbindung scheitert mit „nicht eingerichtet“. |
| `SYNC_CRON_ENABLED` | Geplanter Börsen-Sync alle 30 Minuten an/aus (`false` stoppt ihn) | Optional | Funktionen (Netlify, Scope Functions) | An (sofern ein Tarif den Abgleich enthält). |

## E-Mail-Alarm (Resend)

Hängt daran: E-Mail-Alarm bei geschlossener App, Test-Mail.

| Name | Zweck | Pflicht? | Scope | Ohne sie → Verhalten |
| --- | --- | --- | --- | --- |
| `RESEND_API_KEY` | Resend-Schlüssel für Alarm-Mails (auch der vier Alarme) und für die Bestätigungs-Mails zu Kündigung (§ 312k BGB) und Widerruf (§ 356a BGB) ohne Login | Pflicht für den Bereich · geheim | Funktionen (Netlify, Scope Functions) | Der Alarm-Cron tut nichts, die App zeigt „Einrichtung nötig“, kein Testmail; Kündigung/Widerruf ohne Login: die Erklärung wird gespeichert, die Seite sagt „E-Mail-Versand nicht eingerichtet“ und verspricht keine Mail (ausgeführt wird dann nur bei angemeldeter Person). |
| `ALERT_FROM` | Absender („Name <alarm@deine-domain>“, Domain bei Resend geprüft) | Pflicht für den Bereich | Funktionen (Netlify, Scope Functions) | Wie RESEND_API_KEY. |

## Telefon-Alarm (Twilio)

Hängt daran: Anruf-Alarm, Testanruf, Nummernprüfung (SMS-Code), Status-Rückmeldung von Twilio.

| Name | Zweck | Pflicht? | Scope | Ohne sie → Verhalten |
| --- | --- | --- | --- | --- |
| `TWILIO_ACCOUNT_SID` | Twilio-Konto (AC…) für Anrufe und Nummernprüfung | Pflicht für den Bereich | Funktionen (Netlify, Scope Functions) | Kein Telefon-Alarm: „Einrichtung nötig“, kein Testanruf; E-Mail und Browser laufen weiter. |
| `TWILIO_AUTH_TOKEN` | Zugriff auf Twilio; prüft auch die Signatur der Status-Rückmeldung (/api/v1/alerts/twilio/status) | Pflicht für den Bereich · geheim | Funktionen (Netlify, Scope Functions) | Wie TWILIO_ACCOUNT_SID; die Status-Rückmeldung antwortet 503. |
| `TWILIO_FROM` | Absendernummer (E.164, Twilio-Nummer oder verifizierte Anrufer-ID) | Pflicht für den Bereich | Funktionen (Netlify, Scope Functions) | Wie TWILIO_ACCOUNT_SID. |
| `TWILIO_VERIFY_SERVICE_SID` | Twilio-Verify-Dienst (VA…): schickt und prüft den SMS-Code der Nummernprüfung | Pflicht für den Bereich | Funktionen (Netlify, Scope Functions) | Keine Nummer lässt sich bestätigen, also wird nie angerufen („Einrichtung nötig“). |
| `PHONE_ALLOWED_COUNTRIES` | Länder-Vorwahlen, an die Codes und Anrufe gehen (Komma-Liste, z. B. `49,43,41`); Premium- und Sondernummern sind immer gesperrt | Optional | Funktionen (Netlify, Scope Functions) | Standardliste: Deutschland, Österreich, Schweiz, übrige EU / EWR, Vereinigtes Königreich, USA und Kanada (+1 ohne die Karibik-Vorwahlen). |
| `PHONE_HASH_KEY` | Eigener, NIE gedrehter Schlüssel (`openssl rand -base64 32`) für den Hash der Telefonnummer („eine bestätigte Nummer pro Nummer“). Setzen, BEVOR ein alter `EXCHANGE_ENC_KEY_V<n>` entfernt wird: bisher hing der Hash am ältesten Verschlüsselungsschlüssel | Optional · geheim | Funktionen (Netlify, Scope Functions) | Der Hash nutzt den ältesten `EXCHANGE_ENC_KEY_V<n>` (altes Verhalten); wird der entfernt, ändern sich alle Hashes. |

## TradingView-MCP-Verbindung

Hängt daran: Verbindung pro Nutzer (OAuth 2.1 mit PKCE, nur lesend) in Einstellungen → Verbindungen; braucht außerdem SITE_ORIGIN und EXCHANGE_ENC_KEY_V1.

| Name | Zweck | Pflicht? | Scope | Ohne sie → Verhalten |
| --- | --- | --- | --- | --- |
| `TV_MCP_CLIENT_ID` | OAuth-Client-ID der App bei TradingView (Betreiber-Einrichtung; ob ein Betreiber dort für dieses Produkt registrieren darf, ist nicht belegt – siehe Hinweise unten) | Pflicht für den Bereich | Funktionen (Netlify, Scope Functions) | Die Karte zeigt „Einrichtung nötig (Betreiber)“, nichts wird gestartet. |
| `TV_MCP_CLIENT_SECRET` | Nur für einen vertraulichen OAuth-Client | Optional · geheim | Funktionen (Netlify, Scope Functions) | Öffentlicher Client mit PKCE. |
| `TV_MCP_URL` | Adresse des TradingView-MCP-Servers | Optional | Funktionen (Netlify, Scope Functions) | https://mcp.tradingview.com/mcp |
| `TV_MCP_SCOPES` | Angeforderte OAuth-Scopes | Optional | Funktionen (Netlify, Scope Functions) | mcp:read mcp:tools |

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

## Vier Alarme: Zeitplan & Kostenbremse

| Name | Zweck | Pflicht? | Scope | Ohne sie → Verhalten |
| --- | --- | --- | --- | --- |
| `ALERTS_CRON_ENABLED` | Zeitplan der vier Alarme (`alerts-cron`, alle 5 Minuten) an/aus; `0` schaltet ihn ab | Optional | Funktionen (Netlify, Scope Functions) | An. |
| `ALERT_PHONE_DAILY_MAX` | Kostenbremse: Anrufe pro Tag über ALLE Konten (Standard 50) | Optional | Funktionen (Netlify, Scope Functions) | 50; danach „Kostenbremse des Servers für heute erreicht“ im Zustellprotokoll. |
| `ALERT_PHONE_USER_DAILY_MAX` | Anrufe pro Konto und Tag, Testanrufe eingerechnet (Standard 5) | Optional | Funktionen (Netlify, Scope Functions) | 5. |
| `ALERT_SMS_DAILY_MAX` | Kostenbremse: Bestätigungs-SMS (Twilio Verify) pro Tag über ALLE Konten (Standard 100); schützt vor SMS-Pumping | Optional | Funktionen (Netlify, Scope Functions) | 100; danach „Für heute sind keine weiteren Bestätigungs-SMS mehr möglich“. |
| `AI_DAILY_MAX` | Kostenbremse: KI-Aufrufe (Coach, Screenshot-Import, Strategie-Übersetzer, Assistent) pro Tag über ALLE Konten (Standard 2000) | Optional | Funktionen (Netlify, Scope Functions) | 2000; danach „Die KI hat heute ihr Tageskontingent erreicht“. |

## Binance-Anbindung (alles optional)

| Name | Zweck | Pflicht? | Scope | Ohne sie → Verhalten |
| --- | --- | --- | --- | --- |
| `BINANCE_EGRESS_IP` | Die FESTE ausgehende IP-Adresse der Server-Funktionen (z. B. über einen Proxy/VPN mit fester Adresse); der Dialog zeigt sie als IP-Whitelist-Eintrag für den Binance-Key | Optional | Funktionen (Netlify, Scope Functions) | Der Dialog erklärt den Weg „Key ohne IP-Bindung, nur Leserechte“ (Netlify-Funktionen haben keine feste Adresse); Keys mit Auszahlungs-, Transfer- oder Handelsrecht werden immer abgelehnt. |
| `BINANCE_SPOT_BASE` | Alternative Basisadresse (https://…, ohne Pfad) der Binance-Spot-API, z. B. ein Proxy in einer erlaubten Region (HTTP 451 aus manchen Ländern, u. a. USA) | Optional | Funktionen (Netlify, Scope Functions) | https://api.binance.com |
| `BINANCE_FUTURES_BASE` | Dasselbe für die USDⓈ-M-Futures-API | Optional | Funktionen (Netlify, Scope Functions) | https://fapi.binance.com |

## Partnerlinks (Client, öffentlich)

| Name | Zweck | Pflicht? | Scope | Ohne sie → Verhalten |
| --- | --- | --- | --- | --- |
| `VITE_PARTNER_TRADINGVIEW_REF` | Vollständiger https-Link des TradingView-Partnerprogramms (öffentlich, KEIN Geheimnis; Einrichtung und Kennzeichnung in docs/PARTNERLINKS.md). Heute leer lassen: der Betreiber hat noch keine Partnerkonten | Optional | Browser-Build (Scope Builds, öffentlich) | Kein Partnerlink, der Dialog sieht aus wie ohne. |
| `VITE_PARTNER_BINANCE_REF` | Dasselbe für Binance | Optional | Browser-Build (Scope Builds, öffentlich) | Wie oben. |
| `VITE_PARTNER_BITUNIX_REF` | Dasselbe für Bitunix | Optional | Browser-Build (Scope Builds, öffentlich) | Wie oben. |

## Notfall-Schalter

| Name | Zweck | Pflicht? | Scope | Ohne sie → Verhalten |
| --- | --- | --- | --- | --- |
| `KILL_SYNC` | Notfall-Schalter: Cloud-Sync und Börsen-Sync aus (true) | Optional | Funktionen (Netlify, Scope Functions) | Aus (Sync läuft). |
| `KILL_CALLS` | Notfall-Schalter: keine Telefon-Anrufe (true) | Optional | Funktionen (Netlify, Scope Functions) | Aus (Anrufe erlaubt, sobald Twilio eingerichtet ist). |
| `KILL_AI` | Notfall-Schalter: keine KI-Aufrufe (true) | Optional | Funktionen (Netlify, Scope Functions) | Aus (KI läuft, sobald ein Schlüssel da ist). |
| `KILL_CHECKOUT` | Notfall-Schalter: Kaufstrecke zu (true) – neue Käufe gehen nicht, bestehende Abos und das Kundenportal bleiben | Optional | Funktionen (Netlify, Scope Functions) | Aus (Kauf läuft, sobald Stripe eingerichtet ist). |
| `KILL_MAIL` | Notfall-Schalter: kein E-Mail-Versand (true) – Alarm-Mails, Test-Mails und die Bestätigungs-Mails zu Kündigung und Widerruf | Optional | Funktionen (Netlify, Scope Functions) | Aus (Mails gehen, sobald Resend eingerichtet ist). |

## Rechtliches & Sonstiges (Client)

| Name | Zweck | Pflicht? | Scope | Ohne sie → Verhalten |
| --- | --- | --- | --- | --- |
| `VITE_LEGAL_OPERATOR` | Impressum: Name/Firma des Anbieters (öffentlich, landet im Bundle; auch für die Functions der Kaufstrecke in Netlify setzen: Scope Builds UND Functions) | Optional | Browser-Build (Scope Builds, öffentlich) | Markierter Platzhalter „[Platzhalter: VITE_LEGAL_OPERATOR]“, nichts wird erfunden; ohne Betreiber + Anschrift + E-Mail (oder eine Impressum-URL) bleibt die Kaufstrecke gesperrt (`purchase_closed`). |
| `VITE_LEGAL_ADDRESS` | Impressum: Anschrift (Zeilen mit \| getrennt) | Optional | Browser-Build (Scope Builds, öffentlich) | Markierter Platzhalter; Kaufstrecke gesperrt (siehe VITE_LEGAL_OPERATOR). |
| `VITE_LEGAL_EMAIL` | Impressum: Kontakt-E-Mail | Optional | Browser-Build (Scope Builds, öffentlich) | Markierter Platzhalter; Kaufstrecke gesperrt (siehe VITE_LEGAL_OPERATOR). |
| `VITE_LEGAL_PHONE` | Impressum: Telefon (zweiter Kommunikationsweg, empfohlen) | Optional | Browser-Build (Scope Builds, öffentlich) | Markierter Platzhalter in den Entwürfen; im Impressum entfällt die Zeile. |
| `VITE_LEGAL_REPRESENTATIVE` | Impressum: vertretungsberechtigte Person (je Rechtsform) | Optional | Browser-Build (Scope Builds, öffentlich) | Platzhalter in den Entwürfen, im Impressum keine Zeile. |
| `VITE_LEGAL_REGISTER` | Impressum: Registergericht und -nummer (je Rechtsform) | Optional | Browser-Build (Scope Builds, öffentlich) | Wie VITE_LEGAL_REPRESENTATIVE. |
| `VITE_LEGAL_VAT_ID` | Impressum: USt-IdNr. (falls vorhanden) | Optional | Browser-Build (Scope Builds, öffentlich) | Wie VITE_LEGAL_REPRESENTATIVE. |
| `VITE_LEGAL_RESPONSIBLE` | Impressum: Verantwortlicher für den Inhalt (§ 18 MStV, je Inhalt) | Optional | Browser-Build (Scope Builds, öffentlich) | Wie VITE_LEGAL_REPRESENTATIVE. |
| `VITE_LEGAL_IMPRESSUM_URL` | Eigene Impressum-Seite (https oder Pfad dieser Site; ersetzt die In-App-Seite und die Pflicht für Betreiber/Anschrift/E-Mail) | Optional | Browser-Build (Scope Builds, öffentlich) | In-App-Impressum aus den Betreiberdaten. |
| `VITE_LEGAL_DATENSCHUTZ_URL` | Eigene Datenschutzerklärung (Pflicht zum Verkaufen) | Optional | Browser-Build (Scope Builds, öffentlich) | Der Entwurf aus docs/RECHT/datenschutz.md, markiert „Entwurf – Prüfung durch Anwalt nötig“, plus Hinweis auf die Variable; Kaufstrecke gesperrt. |
| `VITE_LEGAL_AGB_URL` | Eigene AGB (Pflicht zum Verkaufen) | Optional | Browser-Build (Scope Builds, öffentlich) | Entwurf docs/RECHT/agb.md, markiert; Kaufstrecke gesperrt. |
| `VITE_LEGAL_WIDERRUF_URL` | Eigene Widerrufsbelehrung | Optional | Browser-Build (Scope Builds, öffentlich) | Steht sie in den AGB (AGB-URL gesetzt): Hinweis darauf; sonst Entwurf docs/RECHT/widerruf.md, markiert. |
| `VITE_LEGAL_DRAFTS_REVIEWED` | `true` = der Betreiber erklärt, dass ein Anwalt die In-App-Entwürfe (docs/RECHT/) geprüft hat; blendet die Entwurfs-Leiste aus. Die App prüft die Erklärung nicht | Optional | Browser-Build (Scope Builds, öffentlich) | Die Leiste „Entwurf – Prüfung durch Anwalt nötig“ steht über jedem Entwurf. |
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
| `billing-reconcile` | (täglich) | Konto & Cloud (Supabase), Abos (Stripe) | – |
| `billing-status` | /api/v1/billing/status | Konto & Cloud (Supabase) | – |
| `billing-checkout` | /api/v1/billing/checkout | Konto & Cloud (Supabase), Abos (Stripe), Adresse der Seite | `KILL_CHECKOUT` |
| `billing-subscribe` | /api/v1/billing/subscribe | Konto & Cloud (Supabase), Abos (Stripe) | `KILL_CHECKOUT` |
| `billing-portal` | /api/v1/billing/portal | Konto & Cloud (Supabase), Abos (Stripe) | – |
| `billing-code` | /api/v1/billing/code | Konto & Cloud (Supabase), Abos (Stripe) | – |
| `billing-referral` | /api/v1/billing/referral | Konto & Cloud (Supabase), Abos (Stripe) | – |
| `billing-contract` | /api/v1/billing/contract (+ /confirm) | Konto & Cloud (Supabase), E-Mail-Alarm (Resend), Adresse der Seite | `KILL_MAIL` |
| `stripe-webhook` | /api/v1/stripe/webhook | Konto & Cloud (Supabase), Abos (Stripe) | – |
| `exchange-connect` | /api/v1/exchange/connect | Konto & Cloud (Supabase), Börsen-Sync | `KILL_SYNC` |
| `exchange-disconnect` | /api/v1/exchange/disconnect | Konto & Cloud (Supabase), Börsen-Sync | – |
| `exchange-sync` | /api/v1/exchange/sync | Konto & Cloud (Supabase), Börsen-Sync | `KILL_SYNC` |
| `exchange-positions` | /api/v1/exchange/positions | Konto & Cloud (Supabase), Börsen-Sync | `KILL_SYNC` |
| `exchange-backfill-background` | /api/v1/exchange/backfill | Konto & Cloud (Supabase), Börsen-Sync | `KILL_SYNC` |
| `exchange-sync-cron` | (alle 30 Min) | Konto & Cloud (Supabase), Börsen-Sync | `KILL_SYNC` |
| `alert-watch-cron` | (alle 5 Min) | Konto & Cloud (Supabase), E-Mail-Alarm (Resend), Adresse der Seite | `KILL_MAIL` |
| `alert-test` | /api/v1/alerts/test | Konto & Cloud (Supabase), E-Mail-Alarm (Resend) | `KILL_MAIL` |
| `alerts-cron` | (alle 5 Min) | Konto & Cloud (Supabase), E-Mail-Alarm (Resend), Adresse der Seite | `KILL_MAIL` |
| `alerts-prefs` | /api/v1/alerts/prefs | Konto & Cloud (Supabase) | – |
| `alerts-feed` | /api/v1/alerts/feed | Konto & Cloud (Supabase) | – |
| `alerts-email-test` | /api/v1/alerts/email-test | Konto & Cloud (Supabase), E-Mail-Alarm (Resend) | `KILL_MAIL` |
| `alerts-phone` | /api/v1/alerts/phone | Konto & Cloud (Supabase), Telefon-Alarm (Twilio), Börsen-Sync | `KILL_CALLS` |
| `alerts-twilio-status` | /api/v1/alerts/twilio/status | Konto & Cloud (Supabase), Telefon-Alarm (Twilio), Adresse der Seite | – |
| `coach-ask` | /api/v1/coach/ask | Konto & Cloud (Supabase), KI (Anthropic) | `KILL_AI` |
| `shot-extract` | /api/v1/shot-extract | Konto & Cloud (Supabase), KI (Anthropic) | `KILL_AI` |
| `strategy-compile` | /api/v1/strategy/compile | Konto & Cloud (Supabase), KI (Anthropic) | `KILL_AI` |
| `assistant-route` | /api/v1/assistant/route | Konto & Cloud (Supabase), KI (Anthropic) | `KILL_AI` |
| `sec-facts` | /api/v1/sec/facts | Konto & Cloud (Supabase), SEC EDGAR | – |
| `sec-filings` | /api/v1/sec/filings | Konto & Cloud (Supabase), SEC EDGAR | – |
| `hooks-tradingview` | /api/v1/hooks/tradingview/:token | Konto & Cloud (Supabase) | – |
| `signals-receive` | /api/v1/signals/:token | Konto & Cloud (Supabase) | – |
| `connections-tradingview` | /api/v1/connections/tradingview | Konto & Cloud (Supabase), Adresse der Seite | – |
| `connections-tradingview-mcp` | /api/v1/connections/tradingview/mcp | Konto & Cloud (Supabase), TradingView-MCP-Verbindung, Adresse der Seite, Börsen-Sync | – |
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


## Hinweise der Pakete

Von Hand gepflegt in `docs/ENV-HINWEISE.md` und hier unverändert angehängt.




### Rechtliches (Paket G, öffentlich: `VITE_` landet im Bundle, keine Geheimnisse)

Quelle der Wahrheit für die Namen: `LEGAL_ENV_VARS` in `src/legal/config.ts` (ein Unit-Test prüft, dass `.env.example`, `src/env.d.ts`, `SETUP.md` und die Entwürfe in `docs/RECHT/` dieselbe Liste nennen). Alles ist „Entwurf – Prüfung durch Anwalt nötig“.

\* Entfällt, wenn `VITE_LEGAL_IMPRESSUM_URL` gesetzt ist.

Links aus diesen Variablen werden nur als `https:` oder als Pfad der eigenen Site übernommen (`safeLegalUrl`); alles andere wird verworfen.

Bezug zu Steuern (nicht Teil dieses Pakets, aber rechtlich relevant): `STRIPE_AUTOMATIC_TAX` (Standard aus; ohne sie berechnet Stripe Checkout keine Steuer), siehe `docs/RECHT/preisangaben.md`.


Zu den Variablen `VITE_LEGAL_*` (Tabelle „Rechtliches & Sonstiges“ in `docs/ENV.md`): `VITE_LEGAL_OPERATOR`, `VITE_LEGAL_ADDRESS` und `VITE_LEGAL_EMAIL` sind Pflicht, außer `VITE_LEGAL_IMPRESSUM_URL` ist gesetzt (`ja*`); `VITE_LEGAL_DATENSCHUTZ_URL` und `VITE_LEGAL_AGB_URL` sind Pflicht zum Verkaufen; `VITE_LEGAL_PHONE` ist empfohlen; `REPRESENTATIVE`, `REGISTER`, `VAT_ID`, `RESPONSIBLE` gelten je nach Rechtsform bzw. Inhalt.

### Verbindungen (Binance, TradingView, Partnerlinks)

Hinweise:

- **Region.** Binance lehnt Anfragen aus manchen Ländern ab (HTTP 451, u. a. USA). Läuft die Netlify-Funktion in so einer Region, meldet die App „Binance lehnt
  Anfragen von diesem Server-Standort ab“ und gibt dem Nutzer **nicht** die Schuld. Abhilfe des Betreibers: Funktions-Region ändern oder
  `BINANCE_SPOT_BASE` / `BINANCE_FUTURES_BASE` auf einen Proxy in erlaubter Region setzen.
- **Feste IP.** Ohne feste Ausgangsadresse kann der Nutzer die IP-Bindung des Keys nicht nutzen; Keys **mit Auszahlungs-, Transfer- oder Handelsrecht werden
  abgelehnt** (die App liest die Rechte bei Binance, bevor sie etwas speichert), daher ist „ohne IP-Bindung, nur Lesen“ vertretbar.
- **Partnerlinks:** Einrichtung, Kennzeichnung und Datenschutz in `docs/PARTNERLINKS.md`.
- **Migration:** `supabase/migrations/0012_connections.sql` (Empfangsprotokoll des TradingView-Webhooks). Ohne sie nimmt der Webhook Testsignale an, der
  Assistent zeigt aber keinen Empfang und sagt das.

### TradingView: Signal-Empfänger und MCP-Verbindung (Paket B3)

**Signal-Empfänger** (`POST /api/v1/signals/:token`, dieselbe Zieladresse wie `/api/v1/hooks/tradingview/:token`): braucht **keine** neue Variable, nur die
Migration `0013_signals.sql` (Tabelle `signals`). Ohne die Migration antwortet er 503 „nicht eingerichtet“ und nimmt nichts an (ohne Tabelle ließe sich nichts
gegen Doppelte schützen). Der Webhook `hooks-tradingview` bleibt wie er war (Journal-Trades aus `open` / `close`, Testsignal) und nimmt zusätzlich `signal/1` und
`branchen-trend/1` an.

**MCP-Verbindung** (pro Nutzer, OAuth 2.1 mit PKCE gegen den offiziellen TradingView-MCP, nur lesend). **Betreiber-Einrichtung nötig**, sonst zeigt die Karte „Einrichtung nötig (Betreiber)“. Die Variablen (`TV_MCP_CLIENT_ID` Pflicht, `TV_MCP_CLIENT_SECRET`, `TV_MCP_URL`, `TV_MCP_SCOPES` optional; dazu `SITE_ORIGIN` und `EXCHANGE_ENC_KEY_V1`) stehen in `docs/ENV.md`, Bereich „TradingView-MCP-Verbindung“.

**Fundstellen (am 07.11.2026 abgerufen, nichts erfunden):**

- Dokumentation: <https://www.tradingview.com/mcp/docs> – Server `https://mcp.tradingview.com/mcp`, „Authentication is OAuth 2.1“, „Included in Essential and above; trial
  plans don't include MCP access“, „Tool calls are rate-limited to ~100 requests per minute per user“, 35 Werkzeuge, je als „Read-only“ oder „Write“ markiert. Die Seite nennt **keine**
  Endpunkte, **keine** Scopes und **keine** Nutzungsbedingungen für eigene Anwendungen.
- Der Server selbst sagt es maschinenlesbar: `https://mcp.tradingview.com/.well-known/oauth-protected-resource/mcp` (RFC 9728: Anmelde-Server `https://www.tradingview.com`) und
  `https://www.tradingview.com/.well-known/oauth-authorization-server` (RFC 8414: `authorization_endpoint` …/mcp/oauth/authorize, `token_endpoint` …/mcp/oauth/token, `revocation_endpoint`
  …/mcp/oauth/revoke, `registration_endpoint` …/mcp/oauth/register, `code_challenge_methods_supported: ["S256"]`, `scopes_supported: ["mcp:read","mcp:tools"]`,
  `token_endpoint_auth_methods_supported: ["none","client_secret_basic","client_secret_post"]`). Der Client **liest diese Adressen zur Laufzeit** (RFC 9728 → RFC 8414), prüft sie (https, Aussteller
  stimmt, alle Endpunkte auf dessen Herkunft, PKCE S256 vorhanden) und sendet `resource` (RFC 8707).
- TradingView-Hilfe zu Webhooks <https://www.tradingview.com/support/solutions/43000529348-about-webhooks/>: „webhook alerts are only allowed when 2-factor authentication is enabled“; gültiges JSON kommt als
  `application/json`, alles andere als `text/plain`; nur Port 80 und 443; **nach 3 Sekunden bricht TradingView die Anfrage ab**; feste Absender-Adressen werden genannt; keine Zugangsdaten im Body. Welche **Tarife**
  Webhooks erlauben, steht dort **nicht** – die App sagt „laut Hilfe von TradingView zu prüfen“.

**Was nur gegen einen Mock geprüft ist:** der gesamte OAuth-/MCP-Ablauf (Entdeckung, PKCE, State, Token-Tausch, Erneuerung, Widerruf, Lese-Test) läuft in den Tests gegen einen nachgebauten Server in der Form der
oben genannten Beschreibung. Gegen das echte TradingView wurde **nichts** angemeldet (kein Client, kein Konto). Gelesen wurden nur die zwei öffentlichen Beschreibungsdokumente.

**Offen (Betreiber):** (1) Darf ein Betreiber für ein eigenes Produkt einen Client registrieren, und unter welchen Bedingungen (Nutzungsbedingungen, kommerzielle Nutzung, Datenrechte)? Die Dokumentation sagt dazu nichts.
(2) Die Client-ID wird einmalig beantragt; die App registriert nichts selbst. (3) Die App ruft ausschließlich die als „Read-only“ markierten Werkzeuge `list_watchlists`, `get_watchlist`, `get_active_watchlist`, `search_symbols`, `get_ohlcv`,
`get_symbol_data`, `get_technicals_rating`, `list_alerts`, `get_alerts` auf (Allowlist in `netlify/functions/_lib/tvmcp/mcpClient.ts`); heute nutzt nur der Lese-Test davon `list_watchlists`.


### Kaufstrecke (Paket B4: Tarife, Bestellung, Stripe, Kündigung, Widerruf)

Keine neue Variable: die Kaufstrecke liest die vorhandenen. Hier steht, **was sie tun und was ohne sie passiert** (Name · Zweck · Pflicht? · ohne sie). Alles bleibt „Entwurf – Prüfung durch Anwalt nötig“.

| Name | Zweck für die Kaufstrecke | Pflicht? | Ohne sie |
|---|---|---|---|
| `STRIPE_SECRET_KEY` | Stripe-Zugang der Functions (Checkout-Sitzung, Portal, Preise) | Ja, zum Verkaufen | `billing-status` meldet `enabled: false`; die Oberfläche sagt „Zahlungen noch nicht eingerichtet“; `billing-checkout` antwortet 503 – **kein Fake-Kauf** |
| `STRIPE_WEBHOOK_SECRET` | prüft die Signatur der Stripe-Ereignisse (`/api/v1/stripe/webhook`); **nur der Webhook schaltet einen Tarif frei** | Ja, zum Verkaufen | Webhook antwortet 503; die Ergebnisseite bleibt bei „Wir warten noch auf die Bestätigung von Stripe“ |
| `STRIPE_PRICE_PRO_MONTHLY` / `_YEARLY`, `STRIPE_PRICE_PREMIUM_MONTHLY` / `_YEARLY`, `STRIPE_PRICE_TEAM_MONTHLY` / `_YEARLY` | Preis-IDs (`price_…`); Team = Preis **pro Sitz** | Mindestens eine | der Tarif ist „Noch nicht buchbar“; ein Intervall ohne Preis-ID wird nicht verkauft |
| `STRIPE_AUTOMATIC_TAX` | `true` = Stripe Tax im Checkout, Anschrift Pflicht, Steuer-ID abfragbar. Standard aus | Nein (Betreiberentscheidung, Steuerberater) | die Bestellübersicht sagt „Stripe Tax ist beim Betreiber nicht eingeschaltet: Stripe berechnet im nächsten Schritt keine Steuer zusätzlich“; mit `true`: „Steuer wird im nächsten Schritt von Stripe berechnet“. Nie ein erfundener Betrag |
| `TRIAL_DAYS`, `REFERRAL_TRIAL_DAYS`, `STRIPE_TRIAL_CARDLESS` | Testphase; die Bestellübersicht nennt den **Preis nach** der Testphase und das Datum der ersten Zahlung | Nein | 14 / 30 Tage, mit Karte |
| `SITE_ORIGIN` | Ursprung der Rücksprung-Adressen; mit gesetzter Variable wird **jeder andere Ursprung abgelehnt** (kein offener Redirect), Links in Bestätigungs-Mails | Empfohlen | der Ursprung der Anfrage |
| `VITE_LEGAL_IMPRESSUM_URL` **oder** `VITE_LEGAL_OPERATOR` + `VITE_LEGAL_ADDRESS` + `VITE_LEGAL_EMAIL`, dazu `VITE_LEGAL_DATENSCHUTZ_URL`, `VITE_LEGAL_AGB_URL` | **Sperre der Kaufstrecke:** solange eines davon fehlt, ist die Bestellung gesperrt (`config.purchaseOpen: false`, Server: `purchase_closed`). Dieselbe Regel wie `legalComplete()` im Browser; in Netlify für **Builds und Functions** setzen | Ja, zum Verkaufen | „Bestellung noch nicht möglich: Impressum, AGB und Datenschutz des Betreibers fehlen“ – alle Funktionen bleiben freigeschaltet |
| `RESEND_API_KEY` + `ALERT_FROM` | Bestätigungs-Mails zu Kündigung (§ 312k BGB) und Widerruf (§ 356a BGB) und der Bestätigungslink der Erklärung ohne Login (derselbe Versand wie der E-Mail-Alarm) | Ja, für die Kündigung ohne Login | die Erklärung wird gespeichert, die Seite sagt „E-Mail-Versand nicht eingerichtet“ und verspricht keine Mail; ausgeführt wird dann nur bei angemeldeter Person |
| `IP_HASH_PEPPER` | gesalzener Hash der E-Mail-Adresse in `contract_requests` (die Adresse selbst wird nicht gespeichert) | Empfohlen | wird aus `SUPABASE_SECRET_KEY` abgeleitet |

Migration: `supabase/migrations/0016_consents.sql` (Zustimmungsnachweis `consents`, Erklärungen `contract_requests`). **Ohne sie bleibt die Kaufstrecke gesperrt**: ohne Nachweis wird nichts bestellt.


### Vier Alarme und Telefon (C2)

Hinweise: Das Monatskontingent kommt nicht aus der Umgebung, sondern aus dem Tarifvertrag (`src/billing/plans.ts`: `phoneCallsPerMonth` 0 / 0 / 30 / 60). Solange Zahlungen nicht eingerichtet sind, gelten die Werte von Premium (ein Anruf kostet Geld, „offen“ heißt nicht „unbegrenzt“). Migration: `supabase/migrations/0014_alerts.sql`.
