# Umgebungsvariablen: Hinweise der Pakete

> Von Hand gepflegt, **nicht** erzeugt. Die Tabellen mit Name, Zweck, Pflicht, Scope und „ohne sie“ stehen in `docs/ENV.md` (erzeugt aus
> `netlify/functions/_lib/envSpec.ts`, `node scripts/envDoc.mjs --write`); diese Datei hängt `scripts/envDoc.mjs` unverändert an `docs/ENV.md` an.
> Hier steht, was in eine Tabellenzeile nicht passt: Hintergründe, Fundstellen, offene Fragen der Betreiber und der Blick einer Funktion auf mehrere Variablen.
> Eine neue Variable gehört in `envSpec.ts`, nicht hierher.


## Rechtliches (Paket G, öffentlich: `VITE_` landet im Bundle, keine Geheimnisse)

Quelle der Wahrheit für die Namen: `LEGAL_ENV_VARS` in `src/legal/config.ts` (ein Unit-Test prüft, dass `.env.example`, `src/env.d.ts`, `SETUP.md` und die Entwürfe in `docs/RECHT/` dieselbe Liste nennen). Alles ist „Entwurf – Prüfung durch Anwalt nötig“.

\* Entfällt, wenn `VITE_LEGAL_IMPRESSUM_URL` gesetzt ist.

Links aus diesen Variablen werden nur als `https:` oder als Pfad der eigenen Site übernommen (`safeLegalUrl`); alles andere wird verworfen.

Bezug zu Steuern (nicht Teil dieses Pakets, aber rechtlich relevant): `STRIPE_AUTOMATIC_TAX` (Standard aus; ohne sie berechnet Stripe Checkout keine Steuer), siehe `docs/RECHT/preisangaben.md`.


Zu den Variablen `VITE_LEGAL_*` (Tabelle „Rechtliches & Sonstiges“ in `docs/ENV.md`): `VITE_LEGAL_OPERATOR`, `VITE_LEGAL_ADDRESS` und `VITE_LEGAL_EMAIL` sind Pflicht, außer `VITE_LEGAL_IMPRESSUM_URL` ist gesetzt (`ja*`); `VITE_LEGAL_DATENSCHUTZ_URL` und `VITE_LEGAL_AGB_URL` sind Pflicht zum Verkaufen; `VITE_LEGAL_PHONE` ist empfohlen; `REPRESENTATIVE`, `REGISTER`, `VAT_ID`, `RESPONSIBLE` gelten je nach Rechtsform bzw. Inhalt.

## Verbindungen (Binance, TradingView, Partnerlinks)

Hinweise:

- **Region.** Binance lehnt Anfragen aus manchen Ländern ab (HTTP 451, u. a. USA). Läuft die Netlify-Funktion in so einer Region, meldet die App „Binance lehnt
  Anfragen von diesem Server-Standort ab“ und gibt dem Nutzer **nicht** die Schuld. Abhilfe des Betreibers: Funktions-Region ändern oder
  `BINANCE_SPOT_BASE` / `BINANCE_FUTURES_BASE` auf einen Proxy in erlaubter Region setzen.
- **Feste IP.** Ohne feste Ausgangsadresse kann der Nutzer die IP-Bindung des Keys nicht nutzen; Keys **mit Auszahlungs-, Transfer- oder Handelsrecht werden
  abgelehnt** (die App liest die Rechte bei Binance, bevor sie etwas speichert), daher ist „ohne IP-Bindung, nur Lesen“ vertretbar.
- **Partnerlinks:** Einrichtung, Kennzeichnung und Datenschutz in `docs/PARTNERLINKS.md`.
- **Migration:** `supabase/migrations/0012_connections.sql` (Empfangsprotokoll des TradingView-Webhooks). Ohne sie nimmt der Webhook Testsignale an, der
  Assistent zeigt aber keinen Empfang und sagt das.

## TradingView: Signal-Empfänger und MCP-Verbindung (Paket B3)

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


## Kaufstrecke (Paket B4: Tarife, Bestellung, Stripe, Kündigung, Widerruf)

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


## Vier Alarme und Telefon (C2)

Hinweise: Das Monatskontingent kommt nicht aus der Umgebung, sondern aus dem Tarifvertrag (`src/billing/plans.ts`: `phoneCallsPerMonth` 0 / 0 / 30 / 60). Solange Zahlungen nicht eingerichtet sind, gelten die Werte von Premium (ein Anruf kostet Geld, „offen“ heißt nicht „unbegrenzt“). Migration: `supabase/migrations/0014_alerts.sql`.
