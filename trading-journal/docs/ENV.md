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

## Weitere Variablen

Siehe `.env.example` (Supabase, Stripe, Resend, Anthropic, SEC …). Ergänzungen der anderen Pakete folgen in diesem Dokument.
