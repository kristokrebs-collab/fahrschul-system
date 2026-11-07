# Umgebungsvariablen (Name · Zweck · Pflicht? · ohne sie)

Gemeinsame Datei: jedes Paket ergänzt seinen Abschnitt, additiv. Die vollständige Liste mit Kommentaren steht in `.env.example`, die Einrichtung in `SETUP.md`. Fehlende Konfiguration blockiert nie still und gibt nie „alles frei“: die App sagt ehrlich „nicht eingerichtet“.

## Rechtliches (Paket G, öffentlich: `VITE_` landet im Bundle, keine Geheimnisse)

Quelle der Wahrheit für die Namen: `LEGAL_ENV_VARS` in `src/legal/config.ts` (ein Unit-Test prüft, dass `.env.example`, `src/env.d.ts`, `SETUP.md` und die Entwürfe in `docs/RECHT/` dieselbe Liste nennen). Alles ist „Entwurf – Prüfung durch Anwalt nötig“.

| Name | Zweck | Pflicht? | Ohne sie |
|---|---|---|---|
| `VITE_LEGAL_OPERATOR` | Name/Firma des Anbieters (Impressum, Entwürfe) | ja* | markierter Platzhalter „[Platzhalter: VITE_LEGAL_OPERATOR]“ |
| `VITE_LEGAL_ADDRESS` | Anschrift, Zeilen mit `\|` getrennt | ja* | markierter Platzhalter |
| `VITE_LEGAL_EMAIL` | Kontakt-E-Mail | ja* | markierter Platzhalter |
| `VITE_LEGAL_PHONE` | Telefon (zweiter Kommunikationsweg) | empfohlen | markierter Platzhalter in den Entwürfen; im Impressum entfällt die Zeile |
| `VITE_LEGAL_REPRESENTATIVE` | vertretungsberechtigte Person | je Rechtsform | Platzhalter in den Entwürfen, im Impressum keine Zeile |
| `VITE_LEGAL_REGISTER` | Registergericht und -nummer | je Rechtsform | wie oben |
| `VITE_LEGAL_VAT_ID` | Umsatzsteuer-ID | falls vorhanden | wie oben |
| `VITE_LEGAL_RESPONSIBLE` | Verantwortlicher für den Inhalt (§ 18 MStV) | je Inhalt | wie oben |
| `VITE_LEGAL_IMPRESSUM_URL` | eigene Impressum-Seite (https oder Pfad dieser Site) | nein | Ansicht aus den Betreiberdaten |
| `VITE_LEGAL_DATENSCHUTZ_URL` | eigene Datenschutzerklärung | ja | der Entwurf aus `docs/RECHT/datenschutz.md`, markiert „Entwurf – Prüfung durch Anwalt nötig“, plus Hinweis auf die Variable |
| `VITE_LEGAL_AGB_URL` | eigene AGB | ja | Entwurf `docs/RECHT/agb.md`, markiert |
| `VITE_LEGAL_WIDERRUF_URL` | eigene Widerrufsbelehrung | nein | steht sie in den AGB (AGB-URL gesetzt): Hinweis darauf; sonst Entwurf `docs/RECHT/widerruf.md`, markiert |
| `VITE_LEGAL_DRAFTS_REVIEWED` | `true` = der Betreiber erklärt, dass ein Anwalt die In-App-Entwürfe geprüft hat; blendet die Entwurfs-Leiste aus | nein | die Leiste „Entwurf – Prüfung durch Anwalt nötig“ steht über jedem Entwurf. Die App prüft die Erklärung nicht |

\* Entfällt, wenn `VITE_LEGAL_IMPRESSUM_URL` gesetzt ist.

Links aus diesen Variablen werden nur als `https:` oder als Pfad der eigenen Site übernommen (`safeLegalUrl`); alles andere wird verworfen.

Bezug zu Steuern (nicht Teil dieses Pakets, aber rechtlich relevant): `STRIPE_AUTOMATIC_TAX` (Standard aus; ohne sie berechnet Stripe Checkout keine Steuer), siehe `docs/RECHT/preisangaben.md`.

## Verbindungen (Binance, TradingView, Partnerlinks)

| Name | Zweck | Pflicht? | Ohne sie |
|---|---|---|---|
| `EXCHANGE_ENC_KEY_V1` (weitere `_V2` …) | 32 Byte base64 (`openssl rand -base64 32`): verschlüsselt die Börsen-Schlüssel der Nutzer (AES-256-GCM, je Nutzer und Verbindung gebunden); Rotation durch eine höhere Versionsnummer | **Ja** für jede Börsen-Verbindung (Bitunix und Binance) | Der Server antwortet 503 „Börsen-Sync nicht eingerichtet“, nichts wird gespeichert; der Platzhalter zeigt „Nicht eingerichtet“ |
| `BINANCE_EGRESS_IP` | Die **feste** ausgehende IP-Adresse der Server-Funktionen (z. B. über einen Proxy/VPN mit fester Adresse). Der Dialog zeigt sie als IP-Whitelist-Eintrag für den Binance-Key | Nein | Der Dialog erklärt den Weg „Key ohne IP-Bindung, nur Leserechte“ (Netlify-Funktionen haben keine feste Adresse) |
| `BINANCE_SPOT_BASE` | Alternative Basisadresse (`https://…`, ohne Pfad) für die Binance-Spot-API, z. B. ein Proxy in einer erlaubten Region | Nein | `https://api.binance.com` |
| `BINANCE_FUTURES_BASE` | Dasselbe für die USDⓈ-M-Futures-API | Nein | `https://fapi.binance.com` |
| `SITE_ORIGIN` | Öffentliche Adresse der Seite (`https://…`, ohne Schrägstrich am Ende); der TradingView-Assistent baut daraus die Zieladresse | Empfohlen | Der Assistent nimmt die Adresse, unter der die Seite gerade geöffnet ist |
| `SYNC_CRON_ENABLED` | `false` stoppt den automatischen Abgleich alle 30 Minuten | Nein | Der Abgleich läuft (sofern ein Tarif ihn enthält) |
| `VITE_PARTNER_TRADINGVIEW_REF` | Vollständiger `https`-Link des TradingView-Partnerprogramms (öffentlich, **kein Geheimnis**). **Heute leer lassen:** der Betreiber hat noch keine Partnerkonten; gesetzt wird erst mit eigenen Links | Nein | Kein Partnerlink, der Dialog sieht aus wie ohne |
| `VITE_PARTNER_BINANCE_REF` | Dasselbe für Binance | Nein | dito |
| `VITE_PARTNER_BITUNIX_REF` | Dasselbe für Bitunix | Nein | dito |

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

**MCP-Verbindung** (pro Nutzer, OAuth 2.1 mit PKCE gegen den offiziellen TradingView-MCP, nur lesend). **Betreiber-Einrichtung nötig**, sonst zeigt die Karte „Einrichtung nötig (Betreiber)“:

| Name | Zweck | Pflicht? | Ohne sie |
|---|---|---|---|
| `TV_MCP_CLIENT_ID` | OAuth-Client-ID der App bei TradingView. TradingViews Anmelde-Server nennt in seiner Beschreibung einen Registrierungs-Endpunkt (`registration_endpoint`, dynamische Client-Registrierung); ob und unter welchen Bedingungen ein Betreiber dort eine App für **dieses Produkt** registrieren darf, ist **nicht belegt** (siehe „Offen“) | Ja, für die MCP-Verbindung | „Einrichtung nötig (Betreiber)“, nichts wird gestartet |
| `TV_MCP_CLIENT_SECRET` | nur für einen vertraulichen Client | Nein | öffentlicher Client mit PKCE |
| `TV_MCP_URL` | Server-URL | Nein | `https://mcp.tradingview.com/mcp` |
| `TV_MCP_SCOPES` | angeforderte Scopes | Nein | `mcp:read mcp:tools` |
| `SITE_ORIGIN` | `https`-Adresse der Seite; die Rücksprung-Adresse ist `<SITE_ORIGIN>/api/v1/connections/tradingview/mcp/callback` und muss bei TradingView genau so eingetragen sein | Ja (auch für die MCP-Verbindung) | wie oben |
| `EXCHANGE_ENC_KEY_V1` | verschlüsselt Zugangs- und Erneuerungs-Token (AES-256-GCM, gebunden an Nutzer und Feld) | Ja | Start der Verbindung scheitert mit „nicht eingerichtet“ |

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

## Weitere Variablen

Siehe `.env.example` (Supabase, Stripe, Resend, Anthropic, SEC …). Ergänzungen der anderen Pakete folgen in diesem Dokument.
