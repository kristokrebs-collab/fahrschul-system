# Integration Gaps

## Fehlende Referenzdatei

`finanzen-1.html` ist im Repository **nicht vorhanden**. Prompt 4 (Finanzen/
Flotte) kann daher nicht wie die anderen Prompts "aus einer bestehenden Datei
umgebaut" werden. Stattdessen wird `apps/finance` direkt aus dem in Prompt 0
definierten Datenmodell (Rechnung, Zahlung, Banktransaktion, Fahrzeug,
Fahrzeugmangel) und den KPI-Anforderungen entwickelt. Das ist im
Abschlussbericht von Prompt 4 explizit zu vermerken.

## Integrationen ohne echten Zugang in dieser Sitzung

Für keine der folgenden Integrationen liegen in dieser Umgebung echte
Zugangsdaten, Sandbox-Accounts oder Netzwerkfreigaben vor. Sie werden als
**Adapter mit `mock`-Modus** implementiert (Interface + In-Memory/Fixture-
Implementierung), `sandbox`- und `live`-Modus bleiben als Konfigurationsoption
vorbereitet, aber **nicht funktionsfähig**, bis echte Zugänge bereitgestellt
werden:

| Integration | Zweck | Status |
|---|---|---|
| Fahrschulverwaltungssoftware (z. B. FahrschulPlus/FahrSys) | Stammdaten-Abgleich | Kein Zugang – Mock only |
| "Fahren Lernen" (Theorie-Lernplattform) | Theorie-Fortschritt | Kein offizielles API bekannt – Mock only, **kein Scraping** |
| Simulator-Hersteller-Schnittstelle | Simulatorstunden-Import | Kein Zugang – Mock only |
| E-Mail/Push-Versand (z. B. Postmark/SES, FCM/APNs) | Benachrichtigungen | Kein Account – Mock-Adapter, versandbereit für echten Provider |
| Kalender (CalDAV/Google/Outlook) | Terminexport für Fahrlehrer/Schüler | Kein Zugang – Mock only |
| Bank/Buchhaltung (z. B. FinTS/EBICS, DATEV) | Bankabgleich | Kein Zugang – Mock-Transaktionsfeed für Tests |
| Dokumentenspeicher (z. B. S3-kompatibel) | Sichere Uploads | Kein Bucket/Credentials in dieser Umgebung – lokaler
verschlüsselter Stub mit identischem Interface |
| Website/CRM (Lead-Erfassung) | Lead→Schüler-Fluss | Kein Zugang – Mock-Webhook-Endpoint |

## Konsequenz für FOUNDATION-Status

Da zentrale Non-Negotiables ("keine behauptete Live-Schnittstelle ohne echten
Test") nicht erfüllbar sind, können Integrationen in dieser Sitzung nicht als
LIVE getestet werden. Der Abschlussstatus von Prompt 0 wird daher
**FOUNDATION READY mit Einschränkung** sein: Architektur, Datenmodell, Auth,
Rollen und interne Abläufe sind testbar und werden getestet; externe
Live-Integrationen bleiben bis zur Bereitstellung echter Zugänge im
`mock`-Modus und sind **nicht** production-live.

## Infrastruktur-Annahmen dieser Sitzung

- PostgreSQL wird lokal (z. B. via Docker) für Migrations-/Repository-Tests
  angenommen; kein verwalteter Cloud-DB-Zugang vorhanden.
- Kein Deployment-Ziel (Server/Hosting) angebunden – Ergebnis dieser Sitzung
  ist lauffähiger, getesteter Code, kein produktiv deployter Dienst.
- MFA für Mitarbeitende wird als TOTP (serverseitig, ohne externen Anbieter)
  umgesetzt, da das ohne zusätzliche Zugangsdaten testbar ist. Passkey/WebAuthn
  wird als Interface vorbereitet, Browser-Flow ohne echtes HTTPS-Origin nicht
  vollständig E2E-testbar.
