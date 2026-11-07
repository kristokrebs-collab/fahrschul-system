# Umgebungsvariablen

Eine Zeile je Variable: **Name · Zweck · Pflicht? · ohne sie**. Grundsatz: fehlende Konfiguration blockiert nie still und gibt nie „alles frei“ – die
App sagt ehrlich „nicht eingerichtet“. Server-Werte (Netlify: *Secret*, Scope *Functions*) tragen **nie** ein `VITE_`-Präfix; `VITE_`-Werte werden in die
Seite eingebaut und sind öffentlich. Die vollständige Vorlage steht in `.env.example`, die Einrichtung in `SETUP.md`.

Dieses Dokument wird von mehreren Paketen ergänzt; hier stehen zunächst die Variablen des Pakets **Verbindungen** (Binance, TradingView, Partnerlinks) und
die, die sie voraussetzen.

## Verbindungen (Binance, TradingView, Partnerlinks)

| Name | Zweck | Pflicht? | Ohne sie |
|---|---|---|---|
| `EXCHANGE_ENC_KEY_V1` (weitere `_V2` …) | 32 Byte base64 (`openssl rand -base64 32`): verschlüsselt die Börsen-Schlüssel der Nutzer (AES-256-GCM, je Nutzer und Verbindung gebunden); Rotation durch eine höhere Versionsnummer | **Ja** für jede Börsen-Verbindung (Bitunix und Binance) | Der Server antwortet 503 „Börsen-Sync nicht eingerichtet“, nichts wird gespeichert; der Platzhalter zeigt „Nicht eingerichtet“ |
| `BINANCE_EGRESS_IP` | Die **feste** ausgehende IP-Adresse der Server-Funktionen (z. B. über einen Proxy/VPN mit fester Adresse). Der Dialog zeigt sie als IP-Whitelist-Eintrag für den Binance-Key | Nein | Der Dialog erklärt den Weg „Key ohne IP-Bindung, nur Leserechte“ (Netlify-Funktionen haben keine feste Adresse) |
| `BINANCE_SPOT_BASE` | Alternative Basisadresse (`https://…`, ohne Pfad) für die Binance-Spot-API, z. B. ein Proxy in einer erlaubten Region | Nein | `https://api.binance.com` |
| `BINANCE_FUTURES_BASE` | Dasselbe für die USDⓈ-M-Futures-API | Nein | `https://fapi.binance.com` |
| `SITE_ORIGIN` | Öffentliche Adresse der Seite (`https://…`, ohne Schrägstrich am Ende); der TradingView-Assistent baut daraus die Zieladresse | Empfohlen | Der Assistent nimmt die Adresse, unter der die Seite gerade geöffnet ist |
| `SYNC_CRON_ENABLED` | `false` stoppt den automatischen Abgleich alle 30 Minuten | Nein | Der Abgleich läuft (sofern ein Tarif ihn enthält) |
| `VITE_PARTNER_TRADINGVIEW_REF` | Vollständiger `https`-Link des TradingView-Partnerprogramms (öffentlich, **kein Geheimnis**) | Nein | Kein Partnerlink, der Dialog sieht aus wie ohne |
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

## Weitere Variablen

Siehe `.env.example` (Supabase, Stripe, Resend, Anthropic, SEC …). Ergänzungen der anderen Pakete folgen in diesem Dokument.
