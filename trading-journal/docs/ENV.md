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
