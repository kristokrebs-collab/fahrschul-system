# Umgebungsvariablen (Server)

Name · Zweck · Pflicht? · was ohne sie passiert. Alle Werte stehen nur in Netlify (Environment variables, Scope „Functions“, Schlüssel als „secret“), nie im Code oder Chat, nie mit `VITE_`-Präfix. Die vollständige Liste mit Einrichtung steht in `SETUP.md`, die Vorlage in `.env.example`. Dieses Dokument führt die Variablen der späteren Pakete einzeln auf; es wird von jedem Paket ergänzt.

## Vier Alarme und Telefon (C2)

| Name | Zweck | Pflicht? | Ohne sie |
|---|---|---|---|
| `TWILIO_ACCOUNT_SID` | Twilio-Konto (`AC…`) für Anrufe und Nummernprüfung | nur für das Telefon | Kein Anruf, die App sagt „Einrichtung nötig“; E-Mail und Browser laufen weiter |
| `TWILIO_AUTH_TOKEN` | Zugriff auf Twilio; prüft auch die Signatur der Status-Rückmeldung (`/api/v1/alerts/twilio/status`) | nur für das Telefon | wie oben; die Status-Rückmeldung antwortet 503 |
| `TWILIO_FROM` | Absendernummer (E.164, Twilio-Nummer oder verifizierte Anrufer-ID) | nur für das Telefon | wie oben |
| `TWILIO_VERIFY_SERVICE_SID` | Twilio-Verify-Dienst (`VA…`): schickt und prüft den SMS-Code der Nummernprüfung | nur für das Telefon | Keine Nummer lässt sich bestätigen, also wird nie angerufen („Einrichtung nötig“) |
| `EXCHANGE_ENC_KEY_V1` (bestehend) | verschlüsselt die Telefonnummer (AES-GCM) und bildet den Schlüssel-Hash der Nummer | für das Telefon nötig | Das Telefon ist nicht möglich (503 `phone_unavailable`) |
| `SITE_ORIGIN` (bestehend) | Adresse der Site: Link in Mails, Ziel der Twilio-Status-Rückmeldung, Ausweichweg zu Binance | für das Telefon nötig (Status-Rückmeldung) | Anrufe gehen, aber der Status kommt nur über das Nachfragen bei Twilio (alle 5 Minuten) |
| `ALERT_PHONE_DAILY_MAX` | Kostenbremse: Anrufe pro Tag über ALLE Konten (Vorgabe 50) | nein | Vorgabe 50; danach „Kostenbremse des Servers erreicht“ im Zustellprotokoll |
| `ALERT_PHONE_USER_DAILY_MAX` | Anrufe pro Konto und Tag, Testanrufe eingerechnet (Vorgabe 5) | nein | Vorgabe 5 |
| `ALERTS_CRON_ENABLED` | `0` schaltet den Zeitplan `alerts-cron` ab | nein | Vorgabe: an |
| `RESEND_API_KEY`, `ALERT_FROM` (bestehend) | E-Mail-Zustellung (auch der vier Alarme) | nur für E-Mail | E-Mail-Kanal „Einrichtung nötig“ |

Hinweise: Das Monatskontingent kommt nicht aus der Umgebung, sondern aus dem Tarifvertrag (`src/billing/plans.ts`: `phoneCallsPerMonth` 0 / 0 / 30 / 60). Solange Zahlungen nicht eingerichtet sind, gelten die Werte von Premium (ein Anruf kostet Geld, „offen“ heißt nicht „unbegrenzt“). Migration: `supabase/migrations/0014_alerts.sql`.
