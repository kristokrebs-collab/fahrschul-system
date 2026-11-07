# Aufgaben für den Betreiber (Checkliste)

Stand: 07.11.2026. Das hier kannst nur du erledigen: Konten, Einstellungen in fremden Oberflächen, Entscheidungen. Der Code kann das nicht für dich tun und nicht prüfen, ob du es getan hast. Er sagt nur ehrlich „nicht eingerichtet“, wenn etwas fehlt.

**So liest du die Liste:** von oben nach unten, die Reihenfolge ist Absicht. Haken setzen: ☐ wird ☑. Zu jedem Punkt steht: was, wo du klickst oder einträgst, wofür es gut ist und wo es genauer steht. Die Verweise: `SETUP.md` (Schritt für Schritt), `docs/ENV.md` (alle Variablen), `docs/BETRIEB.md` (laufender Betrieb). Pfade sind relativ zu `trading-journal/`.

**Wichtig vorab:**

- Nichts hier ist eine Rechtsberatung. Rechtstexte sind Entwürfe: „Entwurf – Anwalt prüft“.
- Geheimnisse (Schlüssel, Tokens) kommen **nur** in Netlify, Bereich Functions, mit „Contains secret values“. Nie in `VITE_…`, nie ins Repo, nie in den Chat.
- Änderst du eine Variable in Netlify, **musst du neu deployen**. Vorher gilt der alte Wert.
- Was ohne dich nicht prüfbar ist (Live-Test gegen echte Dienste, echte Geräte), steht in `docs/ABNAHME-40.md` und `docs/PRODUKTABGLEICH.md`.

## Reihenfolge auf einen Blick

1. Netlify-Site anlegen (nur die Adresse brauchst du zuerst)
2. Supabase
3. Netlify-Variablen
4. Stripe
5. Resend und Domain
6. Twilio
7. Anthropic
8. Binance
9. TradingView
10. Deploy und Prüfung
11. Geräte-Tests
12. Anwalt
13. Freigaben E8 und E10
14. Aufbewahrungsfristen bestätigen

## 1. Netlify-Site anlegen

| ☐ | Was | Wo klicken / einstellen | Wofür | Verweis |
| --- | --- | --- | --- | --- |
| ☐ | Site aus dem GitHub-Repo anlegen | Netlify › Add new site › Import an existing project › GitHub. Build-Einstellungen **nicht** von Hand setzen, `netlify.toml` macht das. | Die Seite und die Functions laufen hier | `SETUP.md` §1 |
| ☐ | Die Adresse notieren (oder eigene Domain verbinden) | Netlify › Domain management | Sie heißt später `SITE_ORIGIN`, ohne `/` am Ende; Supabase, Stripe, Twilio und TradingView brauchen sie | `SETUP.md` §1 |
| ☐ | Functions-Region auf einen EU-Standort stellen (falls Binance „HTTP 451“ meldet) | Netlify › Site configuration › Functions › Region | Binance lehnt Anfragen aus manchen Ländern ab | `SETUP.md` §6.1 Punkt 4, `docs/ENV-HINWEISE.md` |

## 2. Supabase

| ☐ | Was | Wo klicken / einstellen | Wofür | Verweis |
| --- | --- | --- | --- | --- |
| ☐ | Projekt anlegen, Region **Central EU (Frankfurt)**, starkes Datenbank-Passwort | supabase.com › New project | Konto, Sync, Dateien, Community | `SETUP.md` §2 |
| ☐ | Auftragsverarbeitungsvertrag (AVV/DPA) abschließen | Organization › Legal Documents | Datenschutz | `SETUP.md` §2 Punkt 2 |
| ☐ | Drei Werte notieren: Project URL, Publishable key (`sb_publishable_…`), Secret key (`sb_secret_…`) | Project Settings › API Keys | Kommen in Schritt 3 nach Netlify | `SETUP.md` §2 Punkt 3 |
| ☐ | **Migrationen 0001 bis 0019** ausführen, in dieser Reihenfolge, **jede genau einmal**, nie eine angewendete ändern | SQL Editor › New query › Datei einfügen › Run (oder `supabase db push`) | Tabellen, Rechte (RLS), Kontingente, Alarme, Kaufnachweise | `SETUP.md` §2.1 (Tabelle aller Dateien) |
| ☐ | Kontrolle nach den Migrationen | Table Editor: überall „RLS enabled“. Storage: Buckets `screenshots` und `backups` **privat**, vier Regeln für `screenshots`. Database › Publications › `supabase_realtime`: `journal_docs` angehakt | Kein Datenleck zwischen Nutzern | `SETUP.md` §2.1 „Kontrolle danach“ |
| ☐ | Site URL und Redirect URLs eintragen | Authentication › URL Configuration | Anmelde-Links führen zurück in die App | `SETUP.md` §2.2 |
| ☐ | **E-Mail-Bestätigung an** („Confirm email“) | Authentication › Sign In / Providers › Email | Ohne sie kann ein Skript beliebig viele Konten anlegen | `SETUP.md` §2.2 (Einstellungen, die nur du treffen kannst) |
| ☐ | **Anonyme Logins aus** („Allow anonymous sign-ins“) | Authentication › Sign In / Providers | Sonst bekommt jeder Besucher ein gültiges Token | `SETUP.md` §2.2 |
| ☐ | **JWT-Laufzeit höchstens 3600 Sekunden** (gern 900) | Project Settings › JWT Keys oder Authentication › Sessions („JWT expiry limit“) | Ein gestohlenes Token läuft früher ab | `SETUP.md` §2.2 |
| ☐ | **Upload-Limit für Storage** mindestens so hoch wie das Bucket-Limit (Backups bis 512 MiB) | Project Settings › Storage › Upload file size limit | Sonst scheitern große nächtliche Backups | `SETUP.md` §2.2 |
| ☐ | **Eigener SMTP-Server** eintragen | Authentication › Emails › SMTP Settings | Der eingebaute Mailversand ist stark begrenzt | `SETUP.md` §2.2 |
| ☐ | E-Mail-Vorlagen auf Deutsch übersetzen | Authentication › Emails › Templates | Die App ist deutsch | `SETUP.md` §2.2 |
| ☐ | 2FA (TOTP) aktivieren | Authentication › Multi-Factor | Zwei-Faktor-Anmeldung in der App | `SETUP.md` §2.2 |
| ☐ | Auth-Raten-Limits prüfen | Authentication › Rate Limits | Bremst Mail-Flut bei Registrierung | `SETUP.md` §2.2 |
| ☐ | **CAPTCHA jetzt NICHT einschalten** | (nichts tun) | Die App sendet noch kein CAPTCHA-Token; mit CAPTCHA scheitern Registrierung, Magic Link und Passwort-Reset. Erst einschalten, wenn der Client das Token mitschickt (offen, siehe `docs/PRODUKTABGLEICH.md` K8) | `SETUP.md` §2.2 |
| ☐ | **Backups einschalten**, Aufbewahrung notieren (Point-in-Time-Recovery kostet extra) | Database › Backups | Die App sichert Journale, nicht die Datenbank selbst | `docs/BETRIEB.md` §4 |
| ☐ | **Zwei echte Testkonten** A und B anlegen und prüfen, dass B nichts von A sieht | In der App registrieren; in Supabase gegenprüfen | Der Test der Richtlinien lief nur gegen einen Nachbau | `docs/BETRIEB.md` §9, `docs/ABNAHME-40.md` Punkt 2 |

## 3. Netlify-Variablen

Netlify › Site configuration › Environment variables › Add a variable. `VITE_…` gehören in den Bereich **Builds** und sind öffentlich (nicht als secret markieren). Alles andere in den Bereich **Functions**, Geheimnisse mit „Contains secret values“. Nach dem Eintragen: Deploys › Trigger deploy › **Clear cache and deploy site**.

| ☐ | Was | Wo klicken / einstellen | Wofür | Verweis |
| --- | --- | --- | --- | --- |
| ☐ | `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` (Builds); `SUPABASE_URL`, `SUPABASE_SECRET_KEY` (Functions, secret) | Werte aus Schritt 2 | Ohne sie läuft die App nur lokal, ohne Konto. **Vor** dem Build eintragen: Vite schreibt sie beim Bauen ein | `SETUP.md` §3, `docs/ENV.md` (Konto & Cloud) |
| ☐ | `SITE_ORIGIN` = `https://<deine-site>` ohne `/` am Ende | Functions | Links in Mails, Rücksprung nach dem Bezahlen, Twilio- und TradingView-Rücksprung. Ohne sie nimmt der Code die Adresse der Anfrage | `docs/ENV.md` (Adresse der Seite) |
| ☐ | **`IP_HASH_PEPPER`** setzen (`openssl rand -base64 32`) | Functions, secret | **Pflicht in Produktion**: schützt IP-Pseudonyme, Wiederherstellungscodes und die Testphasen-Sperre. Ohne ihn gibt es dort keine neuen Wiederherstellungscodes | `SETUP.md` §3, `docs/BETRIEB.md` §7a |
| ☐ | `EXCHANGE_ENC_KEY_V1` setzen (`openssl rand -base64 32`) und **nie verlieren oder ändern** | Functions, secret | Verschlüsselt Börsen-Keys, Telefonnummern und TradingView-Tokens. Ohne ihn sind gespeicherte Verbindungen unlesbar | `SETUP.md` §5.1 |
| ☐ | **`PHONE_HASH_KEY`** setzen (`openssl rand -base64 32`), **bevor** ein alter `EXCHANGE_ENC_KEY_V<n>` entfernt wird | Functions, secret | Eigener, nie gedrehter Schlüssel für den Hash der Telefonnummer | `docs/BETRIEB.md` §7a, `docs/ENV.md` |
| ☐ | `OPS_TOKEN` setzen (mindestens 24 Zeichen) | Functions, secret | Schaltet die Betreiber-Statusseite frei. Ohne ihn antwortet sie „nicht eingerichtet“ | `SETUP.md` §7, `docs/BETRIEB.md` §2 |
| ☐ | `VITE_LEGAL_OPERATOR`, `VITE_LEGAL_ADDRESS`, `VITE_LEGAL_EMAIL` (oder `VITE_LEGAL_IMPRESSUM_URL`), `VITE_LEGAL_DATENSCHUTZ_URL`, `VITE_LEGAL_AGB_URL` | Builds **und** Functions | Ohne diese Angaben ist die Kaufstrecke gesperrt (kein Fake-Kauf). Fehlende Angaben zeigt die App als markierte Platzhalter. Nichts erfinden | `SETUP.md` §4.2, `docs/ENV.md` (Rechtliches & Sonstiges) |
| ☐ | **Entscheidung `ALLOW_UNGATED`**: leer lassen, wenn du verkaufst (empfohlen) | Functions | Ohne Stripe läuft Produktion **geschlossen** (jedes Konto = Free). `true` macht alles gratis, auch Telefon, SMS und KI, **auf deine Kosten**. Nur setzen, wenn du bewusst nichts verkaufst | `docs/BETRIEB.md` §7a, `docs/ENV.md` (Abos) |
| ☐ | **`KILL_SYNC`, `KILL_CALLS`, `KILL_AI`, `KILL_CHECKOUT`, `KILL_MAIL`**: leer lassen. Nur im Notfall auf `true`, dann neu deployen | Functions | Notaus je Bereich. Löscht nichts; Kündigen und Konto löschen gehen weiter. Wirkt erst nach dem nächsten Deploy | `docs/BETRIEB.md` §6 |
| ☐ | **Kostenbremsen prüfen oder anpassen**: `AI_DAILY_MAX` (Vorgabe 2000 KI-Aufrufe je Tag), `ALERT_PHONE_DAILY_MAX` (50 Anrufe je Tag), `ALERT_PHONE_USER_DAILY_MAX` (5 je Konto), `ALERT_SMS_DAILY_MAX` (100 SMS je Tag), `PHONE_ALLOWED_COUNTRIES` (Vorgabe DACH, EU/EWR, UK, USA, Kanada) | Functions | Der Code begrenzt Anfragen, nicht Euro. Die Euro-Grenze setzt du beim Anbieter (Schritte 6 und 7) | `docs/BETRIEB.md` §5, `docs/ENV.md` (Vier Alarme: Zeitplan & Kostenbremse) |
| ☐ | Prüfen, ob die **geplanten Functions von außen per Internet erreichbar** sind, und das Ergebnis festhalten | Auf einem veröffentlichten Deploy: `curl -i https://<site>/.netlify/functions/billing-reconcile` | Im Repo nicht belegt; ein anonymer Aufruf könnte Last und Kosten auslösen | `docs/BETRIEB.md` §7a |
| ☐ | Später: Supabase-Eintrag in der CSP enger stellen (`<ref>.supabase.co` statt `*.supabase.co`) | Entwicklerauftrag, Datei `netlify.toml` | Weniger erlaubte Hosts | `SETUP.md` §7 |

## 4. Stripe (zuerst im Testmodus)

| ☐ | Was | Wo klicken / einstellen | Wofür | Verweis |
| --- | --- | --- | --- | --- |
| ☐ | **Drei Produkte mit sechs Preisen** anlegen: Pro 12 € / 120 €, Premium 24 € / 240 €, Team 19 € / 190 € **pro Platz** (Preismodell „pro Einheit“), alle EUR, inkl. MwSt. | Stripe › Produktkatalog › Produkt hinzufügen | Die Kaufstrecke verkauft nur Tarife, deren Preis-ID gesetzt ist | `SETUP.md` §4 Punkt 2, `docs/TARIFE.md` |
| ☐ | Die sechs `price_…` und den geheimen Schlüssel eintragen: `STRIPE_PRICE_PRO_MONTHLY`, `…_YEARLY`, `STRIPE_PRICE_PREMIUM_MONTHLY`, `…_YEARLY`, `STRIPE_PRICE_TEAM_MONTHLY`, `…_YEARLY`, `STRIPE_SECRET_KEY` | Entwickler › API-Schlüssel; Netlify (Schritt 3) | Ohne Schlüssel „Zahlungen noch nicht eingerichtet“, kein Fake-Kauf | `SETUP.md` §3, §4 |
| ☐ | **Webhook** anlegen: URL `https://<site>/api/v1/stripe/webhook`; Ereignisse: `checkout.session.completed`, `customer.subscription.created`, `…updated`, `…deleted`, `…paused`, `…resumed`, `…trial_will_end`, `invoice.paid`, `invoice.payment_failed` und zusätzlich **`charge.refunded`** und **`charge.dispute.created`**. Das Signatur-Geheimnis `whsec_…` als `STRIPE_WEBHOOK_SECRET` eintragen | Entwickler › Webhooks › Endpunkt hinzufügen | Nur der Webhook schaltet einen Tarif frei. Ohne die zwei letzten Ereignisse bleibt eine Empfehlungs-Gutschrift trotz Erstattung oder Rückbuchung stehen | `SETUP.md` §4 Punkt 4, `docs/BETRIEB.md` §7a |
| ☐ | **Kundenportal**: Kündigung zum Periodenende erlauben, Zahlungsmethode ändern, Rechnungsverlauf, **Planwechsel zwischen den sechs Preisen** erlauben, Mengenänderung bewusst entscheiden, Links zu AGB und Datenschutz | Einstellungen › Billing › Kundenportal | Verwaltung durch den Kunden; die Team-Sitze folgen jeder Änderung automatisch | `SETUP.md` §4 Punkt 5, `docs/BETRIEB.md` §7a |
| ☐ | **Steuer entscheiden** (Stripe Tax ja oder nein) mit deinem Steuerberater; bei „ja“ `STRIPE_AUTOMATIC_TAX=true` | Stripe › Steuern; Netlify | Ohne die Variable berechnet Stripe keine Steuer zusätzlich; die Bestellübersicht sagt das ehrlich | `SETUP.md` §4 Punkt 6, `docs/RECHT/preisangaben.md` |
| ☐ | Testkauf mit Testkarte `4242 4242 4242 4242` | App › Preise › Weiter zur Bestellung | Prüft die ganze Strecke; der Webhook muss **200** antworten | `SETUP.md` §4 „Test“, `docs/ABNAHME-40.md` Punkt 5 |
| ☐ | Öffentliche Details: Links zu AGB und Datenschutz | Einstellungen › Öffentliche Details | Rechtliche Pflichtangaben im Checkout | `SETUP.md` §4.2 |
| ☐ | **Live gehen**: alles noch einmal im Live-Modus (Produkte, Preise, Webhook, Portal), dann `sk_live_…`, neues `whsec_…` und die Live-Preis-IDs eintragen, neu deployen | Stripe Live-Modus; Netlify | Echte Zahlungen. **Erst nach** Rechtstexten und Anwalt (Schritt 12) | `SETUP.md` §4 „Live gehen“ |

## 5. Resend und Domain

| ☐ | Was | Wo klicken / einstellen | Wofür | Verweis |
| --- | --- | --- | --- | --- |
| ☐ | Domain hinzufügen und **verifizieren** (DNS-Einträge setzen), API-Schlüssel anlegen | resend.com › Domains, API Keys | Absender für Alarm-Mails und für die Bestätigungs-Mails zu Kündigung und Widerruf | `SETUP.md` §6.1 |
| ☐ | `RESEND_API_KEY` (secret) und `ALERT_FROM` (z. B. `Trading Journal <alarm@deine-domain.de>`) eintragen | Netlify (Schritt 3) | Ohne sie sagt die App „Einrichtung nötig“; die Kündigung ohne Login verspricht dann keine Mail | `SETUP.md` §3, `docs/ENV.md` (E-Mail-Alarm) |
| ☐ | **Ausgabelimit und Alarm** bei 50 und 80 % im Konto setzen | Resend-Konto | Der Code begrenzt Mails, nicht Euro | `docs/BETRIEB.md` §5 |
| ☐ | In der App „Testmail senden“, dann den Schalter einschalten | Markt › Alarme & Zustellprotokoll | Zeigt, ob alles ankommt | `SETUP.md` §6.1 Punkt 5, `docs/ABNAHME-40.md` Punkt 32 |

## 6. Twilio (nur nötig für Telefon-Alarme)

| ☐ | Was | Wo klicken / einstellen | Wofür | Verweis |
| --- | --- | --- | --- | --- |
| ☐ | Konto, **Rufnummer mit Sprachfunktion** (oder verifizierte Anrufer-ID) und einen **Verify-Dienst** anlegen | twilio.com › Console | Anrufe und SMS-Code zur Nummernprüfung | `SETUP.md` §6.2 |
| ☐ | Eintragen: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` (secret), `TWILIO_FROM` (E.164), **`TWILIO_VERIFY_SERVICE_SID`** (`VA…`) | Netlify (Schritt 3) | Ohne alle vier wird nie angerufen | `SETUP.md` §3, `docs/ENV.md` (Telefon-Alarm) |
| ☐ | **Geo Permissions** (Voice und SMS) auf die wirklich gebrauchten Länder beschränken | Twilio-Konsole › Geo Permissions (Voice und SMS) | Zweite Linie gegen SMS-Pumping und Rufnummern-Betrug, hinter der Länderliste der App | `docs/BETRIEB.md` §7a, `SETUP.md` §6.2 Punkt 4 |
| ☐ | **Fraud Guard** im Verify-Dienst einschalten | Twilio-Konsole › Verify-Dienst | Wie oben | `SETUP.md` §6.2 Punkt 4 |
| ☐ | **Spend Limit** (Nutzungslimit) für das Konto setzen | Twilio-Konsole (Konto, Nutzungslimit) | Harte Euro-Grenze; der Code zählt nur Anrufe | `docs/BETRIEB.md` §5 und §7a |
| ☐ | Aufbewahrung der Verify- und Anruf-Protokolle prüfen (liegen bei Twilio, nicht in der App löschbar) und Twilio in der Datenschutzerklärung nennen lassen | Twilio-Konsole | Datenschutz | `docs/BETRIEB.md` §8 |
| ☐ | Testanruf mit einer eingewilligten Nummer | App › Alarme › Telefon | Prüft den echten Weg; der Code ist nur gegen einen Nachbau getestet | `docs/ABNAHME-40.md` Punkte 33 und 34 |

## 7. Anthropic (optional: KI-Coach, Screenshot-Import)

| ☐ | Was | Wo klicken / einstellen | Wofür | Verweis |
| --- | --- | --- | --- | --- |
| ☐ | `ANTHROPIC_API_KEY` (secret) eintragen | Netlify (Schritt 3) | Ohne ihn sind KI-Coach und der KI-Weg des Screenshot-Imports aus; die Preisseite verkauft sie dann nicht | `SETUP.md` §3, `docs/ENV.md` (KI) |
| ☐ | **Monatliches Ausgabelimit** im Konto setzen, Alarm bei 50 und 80 % | Anthropic-Konto (Ausgabelimit) | Letzte Grenze hinter den Tageslimits der App (`AI_DAILY_MAX`) | `docs/BETRIEB.md` §5 und §7a |
| ☐ | Mit dem Anwalt klären: AVV, Drittland, ob Zero-Retention möglich ist | Vertrag mit Anthropic | Screenshots und Strategietexte gehen an Anthropic | `docs/RECHT/anwaltsfragen.md` Nr. 21 |

## 8. Binance (lesender Börsen-Sync)

| ☐ | Was | Wo klicken / einstellen | Wofür | Verweis |
| --- | --- | --- | --- | --- |
| ☐ | **Feste Ausgangs-IP** beschaffen (Proxy oder VPN mit fester Adresse) und als `BINANCE_EGRESS_IP` eintragen | Netlify (Schritt 3) | Binance-Keys werden mit fester IP-Freigabe sicherer; die App zeigt die IP in der Anleitung. Ohne sie läuft der Weg „Key ohne IP-Bindung, nur Lesen“ (Keys mit Auszahlungs- oder Handelsrecht lehnt die App immer ab). Hinweis: `SETUP.md` §5.4 sagt „nicht eingerichtet“, `docs/ENV.md` und der Code sagen „optional“ | `docs/ENV.md` (Binance-Anbindung), `SETUP.md` §5.4 |
| ☐ | Bei „HTTP 451“: Functions-Region ändern oder `BINANCE_SPOT_BASE` und `BINANCE_FUTURES_BASE` auf einen Proxy in erlaubter Region setzen | Netlify | Binance sperrt manche Länder (u. a. USA) | `docs/ENV-HINWEISE.md` (Verbindungen) |
| ☐ | Optional: **Fast-API-Freigabe** bei Binance beantragen (dauert, Ausgang ungewiss) | Binance | Zweiter Anbindungsweg; ist **nicht gebaut** und wartet auf die Freigabe | `docs/LAUNCH-PLAN.md` E3 |
| ☐ | Mit einem eigenen **lesenden** Test-Key durchspielen | App › Einstellungen › Verbindungen › Binance | Der Code ist nur gegen einen Nachbau getestet, die Sandbox erreicht Binance nicht | `docs/ABNAHME-40.md` Punkt 9 |

## 9. TradingView

| ☐ | Was | Wo klicken / einstellen | Wofür | Verweis |
| --- | --- | --- | --- | --- |
| ☐ | **Klären**, ob du für dieses Produkt einen OAuth-Client beim offiziellen TradingView-MCP registrieren darfst (kommerzielle Nutzung, Nutzungsbedingungen) | TradingView (Dokumentation und Support) | Die Dokumentation nennt dazu nichts | `docs/ENV-HINWEISE.md` (TradingView), `docs/LAUNCH-PLAN.md` E4 |
| ☐ | **`TV_MCP_CLIENT_ID`** eintragen (`TV_MCP_CLIENT_SECRET` nur bei einem vertraulichen Client); als Rücksprung-Adresse bei TradingView genau `<SITE_ORIGIN>/api/v1/connections/tradingview/mcp/callback` angeben | Netlify (Schritt 3); TradingView | Ohne Client-ID zeigt die Karte „Einrichtung nötig (Betreiber)“ und startet nichts. Nutzer brauchen ein TradingView-Konto ab Essential | `docs/ENV.md` (TradingView-MCP-Verbindung) |
| ☐ | Den Webhook-Weg (ohne Client-ID) selbst einmal von Hand testen: Zieladresse erzeugen, Alarm in TradingView anlegen, Testsignal | App › Verbindungen › TradingView | TradingView verlangt 2FA fürs Webhook und bricht nach 3 Sekunden ab | `docs/ENV-HINWEISE.md`, `docs/ABNAHME-40.md` Punkt 11 |

## 10. Deploy und Prüfung

| ☐ | Was | Wo klicken / einstellen | Wofür | Verweis |
| --- | --- | --- | --- | --- |
| ☐ | Neu deployen (Clear cache and deploy site) | Netlify › Deploys | Neue Variablen gelten erst jetzt | `SETUP.md` §3 |
| ☐ | **Release-Check** ausführen: `node scripts/releaseCheck.mjs --env-file .env --require billing,mail` | Auf deinem Rechner im Ordner `trading-journal` | Zeigt je Bereich „eingerichtet“, „teilweise“ oder „nicht eingerichtet“, mit den fehlenden **Namen** (nie Werten) | `docs/BETRIEB.md` §1 |
| ☐ | **Betreiber-Status** ansehen: `curl -H "Authorization: Bearer $OPS_TOKEN" "$SITE/api/v1/ops/status?probe=1&stats=1"` | Terminal | Zeigt Bereiche, Schalter, Erreichbarkeit und die Zahlen der letzten 24 Stunden | `docs/BETRIEB.md` §2 und §3 |
| ☐ | **Restore-Probe** mit einem echten Export: `node scripts/restoreProbe.mjs <datei.json>` (Ende 0 = vollständig) | Terminal | Beweist das Exportformat, nicht Supabase-Backups | `docs/BETRIEB.md` §4 |
| ☐ | Die 40 Punkte von Hand durchgehen und das Ergebnis eintragen | `docs/ABNAHME-40.md`, Spalte „Wie“ | Das Protokoll sagt, was nur Mock ist | `docs/ABNAHME-40.md` |
| ☐ | Einen Notfall-Schalter einmal ausprobieren (z. B. `KILL_MAIL=true`, neu deployen, Status ansehen, wieder auf leer und neu deployen) | Netlify | Du weißt, dass er wirkt und wie lange es dauert | `docs/BETRIEB.md` §6 |
| ☐ | Täglich oder wöchentlich die Monitoring-Liste ansehen (Registrierungen, Sync, Jobs, Webhooks, Zahlungsfehler) | Betreiber-Status | Es gibt **keinen** automatischen Alarm an dich | `docs/BETRIEB.md` §3 |
| ☐ | Einmal im Monat im SQL Editor alte Stripe-Ereignisse löschen: `delete from public.stripe_events where received_at < now() - interval '90 days';` | Supabase › SQL Editor | Keine automatische Löschung | `docs/BETRIEB.md` §8 |

## 11. Geräte-Tests (E7)

| ☐ | Was | Wo klicken / einstellen | Wofür | Verweis |
| --- | --- | --- | --- | --- |
| ☐ | Zugang besorgen: BrowserStack **oder** ein echtes Android-Telefon und ein Android-Tablet, dazu ein Testkonto | – | Ohne echte Geräte bleibt der Gerätetest „nicht durchgeführt“ | `docs/LAUNCH-PLAN.md` E7 |
| ☐ | Durchgehen: Android-Telefon, Android-Tablet, iPhone oder iPad, Desktop in Chrome, Firefox, Safari. Dazu Tastatur, Touch und am Gerät „Bewegung reduzieren“ | Gerät | Die automatischen Läufe emulieren nur in Chromium | `docs/ABNAHME-40.md` Punkte 24, 26, 27, 29 |
| ☐ | **Einstellungen bei 1024 px** öffnen und warten: die Seite wächst heute um etwa 126 px (bekannt, nicht behoben) | Browser mit 1024 px Breite | Zeigt, ob es auf echten Tablets stört | `docs/PRODUKTABGLEICH.md` K1 |
| ☐ | Leistung auf ruhiger Maschine messen (LCP ≤ 2,5 s, INP ≤ 200 ms, CLS ≤ 0,1) | Chrome DevTools › Lighthouse | Die bisherigen Messwerte entstanden unter Last | `docs/LAUNCH-PLAN.md` Welle D |

## 12. Anwalt

Alle Texte der App sind Entwürfe. **Nichts davon ist geprüft.** Die Fragen A und B können den Start blockieren.

| ☐ | Was | Wo klicken / einstellen | Wofür | Verweis |
| --- | --- | --- | --- | --- |
| ☐ | Die **Liste der offenen Anwaltsfragen** (31 Fragen) einem Anwalt geben, mit den Entwürfen | `docs/RECHT/anwaltsfragen.md`, `docs/RECHT/*.md` | Aufsichtsrecht (sind Signale eine „Anlageempfehlung“?), Kaufstrecke, Datenschutz, Wettbewerb, Steuern | `docs/RECHT/anwaltsfragen.md`, `docs/RECHT-CHECKLISTE.md` |
| ☐ | Die Marktdaten-Frage mitgeben: Der Browser holt Kurse direkt bei Binance (IP geht an Dritte). Einwilligung oder Weg über den eigenen Server als Standard? | wie oben | Datenschutz | `docs/RECHT/anwaltsfragen.md` Nr. 17, `docs/PRODUKTABGLEICH.md` K2 |
| ☐ | **Zielmarkt entscheiden**: weltweit oder zuerst DACH/EU; gegebenenfalls Länder ausschließen (die App hat kein Geoblocking) | Entscheidung mit dem Anwalt | Aufsichtsrecht in UK, USA und anderen Ländern | `docs/RECHT/anwaltsfragen.md` Nr. 5, `docs/PRODUKTABGLEICH.md` K12 |
| ☐ | Verträge: AVV mit Supabase, Netlify, Stripe, Resend, Twilio, Anthropic; Verzeichnis der Verarbeitungstätigkeiten; Drittland-Regeln | Verträge und Konsolen der Anbieter | Datenschutz | `docs/RECHT/anwaltsfragen.md` Nr. 18, 19 |
| ☐ | Geprüfte Texte in Netlify eintragen (`VITE_LEGAL_*`); **erst nach** der Prüfung `VITE_LEGAL_DRAFTS_REVIEWED=true` setzen | Netlify (Builds und Functions) | Blendet die Leiste „Entwurf – Prüfung durch Anwalt nötig“ aus. Das ist **deine** Erklärung, die App prüft nichts | `SETUP.md` §4.2 |

## 13. Freigaben E8 und E10

| ☐ | Was | Wo klicken / einstellen | Wofür | Verweis |
| --- | --- | --- | --- | --- |
| ☐ | **E8 Kontingente freigeben oder ändern**: Börsen-Verbindungen, Hintergrund-Sync, Alarm-Kanäle, Telefon-Anrufe je Monat, Screenshot-Import je Tag, KI-Coach je Tag, Simulationen je Tag | `docs/TARIFE.md` lesen; Änderungen als Auftrag an die Entwicklung (eine Zahl in `src/billing/plans.ts`) | Alle neuen Zahlen sind **Vorschlag**, nichts ist beschlossen, bis du es sagst | `docs/TARIFE.md`, `docs/LAUNCH-PLAN.md` E8 |
| ☐ | **E10 Produktname, Marke und Logo**: ein Logo als SVG-Pfad liefern (Feld 24 × 24) | Auftrag an die Entwicklung; sie trägt es in `LOGO_MARKS` ein (`src/app/logoSeq.ts`) | Heute zeichnet sich nur das ₿-Zeichen; Name und Logo sind außerdem eine Markenfrage | `docs/LAUNCH-PLAN.md` E10, `docs/RECHT/marken.md` |
| ☐ | Partnerlinks: nur eigene, vom Anbieter vergebene IDs in `VITE_PARTNER_TRADINGVIEW_REF`, `VITE_PARTNER_BINANCE_REF`, `VITE_PARTNER_BITUNIX_REF` eintragen, **vorher** die Bedingungen des Programms prüfen. Leer = aus | Netlify (Builds) | Sie erscheinen dann gekennzeichnet als „Partnerlink“ | `docs/PARTNERLINKS.md`, `docs/RECHT/partnerlinks.md` |

## 14. Aufbewahrungsfristen bestätigen

Diese Fristen sind **Vorschläge im Code**. Bestätige sie oder lass sie ändern (die Zahlen stehen fest in `netlify/functions/_lib/account.ts`; eine Änderung ist ein Auftrag an die Entwicklung). Trage sie in die Datenschutzerklärung ein.

| ☐ | Was | Frist heute | Wofür | Verweis |
| --- | --- | --- | --- | --- |
| ☐ | Sicherheitsprotokoll (`audit_log`), IP nur als Pseudonym | **365 Tage** | Wird nachts automatisch gelöscht | `docs/BETRIEB.md` §8 |
| ☐ | Kündigungs- und Widerrufsanfragen **ohne** Vertrag | **30 Tage** | Anfragen mit Vertrag sind Nachweise und bleiben | `docs/BETRIEB.md` §8 |
| ☐ | Testphasen-Sperre (nur ein Schlüssel-Hash der Adresse nach Löschung eines Kontos mit Testphase) | **730 Tage** (24 Monate) | Verhindert die nächste Gratis-Testphase mit derselben Adresse | `docs/BETRIEB.md` §8 |
| ☐ | Außerdem prüfen: Fehlerberichte 30 Tage (nur mit Einwilligung), Backups 14 Tage, Stripe-Ereignisse 90 Tage (von Hand), Rechnungen bei Stripe (Frist vom Steuerberater), Protokolle bei Twilio | – | Vollständige Liste der Daten und Fristen | `docs/BETRIEB.md` §8 |

## Wenn alles abgehakt ist

Dann ist nur die **Voraussetzung** für eine Startentscheidung erfüllt, nicht die Entscheidung selbst. Danach entscheidest du mit `docs/ABNAHME-40.md` und `docs/PRODUKTABGLEICH.md` in der Hand. „Bereit“ sagt keines dieser Dokumente, solange Live-Prüfungen und Anwaltsfragen offen sind.
