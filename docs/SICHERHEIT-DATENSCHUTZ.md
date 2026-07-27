# Sicherheits- und Datenschutzprüfung

Stand: Auslieferung Version 1.0.0

---

## Zusammenfassung

| Bereich | Bewertung | Anmerkung |
|---|---|---|
| Secrets im Frontend | **bestanden** | Verifiziert: keine Secrets in ausgelieferten Assets |
| Pfad-Traversal | **bestanden** | Sechs Angriffsmuster geprüft, alle abgewehrt |
| HTML-Einschleusung | **bestanden** | Kein `innerHTML` im gesamten Frontend |
| SQL-Einschleusung | **bestanden** | Ausschließlich parametrisierte Abfragen |
| Passwortspeicherung | **bestanden** | scrypt (N=32768) mit Salt |
| Sitzungen | **bestanden** | Nur als SHA-256-Hash gespeichert |
| Rollentrennung | **bestanden** | Getestet: Editor kann nicht freigeben |
| Protokollintegrität | **bestanden** | Trigger verbietet UPDATE/DELETE |
| Abhängigkeiten | **bestanden** | `npm audit`: 0 Schwachstellen |
| Token-Erneuerung | **offen** | Kein OAuth-Refresh, nur Warnung vor Ablauf |
| Externe Prüfung | **nicht erfolgt** | Kein Penetrationstest durchgeführt |

---

## Nachgewiesene Kontrollen

### Secrets verlassen den Server nicht

Es gibt genau eine Stelle, die Secrets liest: `src/config/env.ts`. Die einzige
Funktion, die Konfiguration nach außen gibt, ist `publicConfig()` — eine
**Allowlist** mit vier Feldern (Anwendungsname, Umgebung, Basis-URL, Version).
Neue Felder müssen dort ausdrücklich ergänzt werden; ein versehentliches
Durchreichen ist strukturell ausgeschlossen.

Verifiziert gegen den laufenden Dienst: `/`, `/app.js`, `/ui.js`, `/views.js`,
`/app.css`, `/manifest.webmanifest`, `/sw.js` — keine Fundstelle für
`ENCRYPTION_KEY`, `SESSION_SECRET`, `META_ACCESS_TOKEN`, `sk-ant-` oder das
Bootstrap-Passwort.

Ein automatisierter Test prüft zusätzlich, dass `publicConfig()` keine
verdächtigen Schlüsselnamen enthält (`security-media.test.ts`).

### Pfad-Traversal

Die statische Auslieferung kanonisiert jeden Pfad mit `resolve()` und prüft,
dass das Ergebnis innerhalb des `web/`-Verzeichnisses liegt. Unbekannte Pfade
liefern die Anwendungshülle (SPA-Verhalten), nie eine Datei außerhalb.

Geprüft gegen den laufenden Dienst:

```
/../.env            → sicher (liefert index.html)
/%2e%2e/.env        → sicher
/..%2f.env          → sicher
/web/../.env        → sicher
/./../../.env       → sicher
/../package.json    → sicher
```

Zur Erinnerung: `@fastify/static` wurde bewusst **entfernt**, weil es eine
bekannte Pfad-Traversal-Schwachstelle im Directory-Listing hatte. Die eigene
Implementierung ist kleiner und hat kein Directory-Listing.

### HTML- und SQL-Einschleusung

**Frontend:** Der gesamte Renderpfad läuft über `h()` in `web/ui.js`, das
ausschließlich `document.createElement` und `textContent` verwendet. Es gibt
keine einzige Verwendung von `innerHTML`, `outerHTML`, `insertAdjacentHTML`
oder `document.write`. Ein Beitragstext, der HTML enthält, wird als Text
angezeigt — nicht ausgeführt.

**Backend:** Alle Datenbankzugriffe laufen über `prepare()` mit Parametern.
Die einzigen Stellen mit zusammengesetztem SQL sind Spaltenlisten aus fest
codierten Allowlists (`MUTABLE_FIELDS` in `domain/content.ts`,
`COUNTED_TABLES` in `cli/backup.ts`) — nie aus Nutzereingaben.

### Content Security Policy

```
default-src 'self'; img-src 'self' data: https:; media-src 'self' https:;
style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self';
font-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'
```

`script-src 'self'` ohne `unsafe-inline` und ohne `unsafe-eval`. Dazu
`x-content-type-options: nosniff`, `x-frame-options: DENY`,
`referrer-policy: same-origin` und in Produktion HSTS.

`style-src` erlaubt `unsafe-inline`, weil einzelne Fortschrittsbalken ihre
Breite über ein Style-Attribut setzen. Das ist die schwächste Stelle der
Richtlinie; sie erlaubt keine Skriptausführung.

`img-src` und `media-src` erlauben `https:`, weil die Medienvorschauen von den
CDN-Adressen des Archivs kommen.

### Authentifizierung

- **Passwörter:** scrypt mit N=32768, r=8, p=1, 64 Byte Ausgabe, zufälliges
  16-Byte-Salt. Vergleich in konstanter Zeit über `timingSafeEqual`.
  Minimum 12 Zeichen, erzwungen.
- **Sitzungen:** 32 Byte aus dem CSPRNG. In der Datenbank liegt **nur der
  SHA-256-Hash**. Ein Datenbankleck gibt keine gültigen Sitzungstoken preis.
  Laufzeit 12 Stunden.
- **Cookie:** `HttpOnly`, `SameSite=Lax`, in Produktion `Secure`.
- **Nutzeraufzählung:** Bei unbekannter E-Mail wird trotzdem eine
  scrypt-Verifikation gegen einen Referenzwert ausgeführt, damit die
  Antwortzeit nicht verrät, ob das Konto existiert.
- **Passwortwechsel** beendet alle bestehenden Sitzungen.

### Verschlüsselung von Integrations-Tokens

AES-256-GCM mit zufälligem IV. Das Feld `aad` bindet den Chiffretext an seinen
Verwendungskontext — ein kopierter Datenbankwert lässt sich nicht in einem
anderen Feld wiederverwenden. Getestet.

### Rollentrennung

| Rolle | Freigeben | Rechte setzen | Fakten bestätigen | Änderungen anwenden |
|---|---|---|---|---|
| owner | ✓ | ✓ | ✓ | ✓ |
| editor | ✗ | ✗ | ✗ | ✗ |
| viewer | ✗ | ✗ | ✗ | ✗ |

Verifiziert gegen den laufenden Dienst: ein Editor erhält bei
`approve_once` die Antwort *„Nur der Inhaber darf Inhalte freigeben"* mit Code
`FORBIDDEN_ROLE`. Zusätzlich als Test abgedeckt.

### Protokollintegrität

`events` ist per Trigger unveränderlich: `UPDATE` und `DELETE` werden mit
`RAISE(ABORT)` abgelehnt. Freigabe-Entscheidungen ebenfalls — der vorgesehene
Weg ist Widerruf (`revoked_at`), nicht Löschung. Beides getestet.

### Redaction in Logs

Jede Logzeile und jedes Ereignisdetail läuft durch `redact()`. Erkannt und
maskiert werden Meta-Tokens (`EAA…`), TikTok-Tokens (`act.…`),
Google-OAuth-Tokens (`ya29.…`), 64-stellige Hex-Werte und
Schlüssel/Wert-Paare wie `access_token=…`, `password=…`, `api_key=…`.

Zusätzlich unterdrückt Fastify `req.headers.cookie` und
`req.headers.authorization`.

### Rate-Limiting

- **Global:** 300 Anfragen pro Minute pro IP, `/api/health` ausgenommen.
- **Anmeldung:** 10 Versuche pro 5 Minuten pro IP, als Routen-Konfiguration
  auf `/api/auth/login`.

Verifiziert gegen den laufenden Dienst: zwölf Anmeldeversuche mit falschem
Passwort ergeben `401 401 401 401 401 401 401 401 401 401 429 429` — ab dem
elften Versuch greift die Sperre.

Bei Betrieb im offenen Netz empfiehlt sich zusätzlich eine Sperre auf
Reverse-Proxy-Ebene (fail2ban oder Äquivalent), da IP-basierte Limits allein
gegen verteilte Versuche wenig ausrichten.

---

## Datenschutz (DSGVO)

### Rechtsgrundlagen — Annahmen, die zu prüfen sind

> Dieser Abschnitt ist eine technische Einschätzung, **keine Rechtsberatung.**
> Die Punkte unter *Rechtliche Prüfung erforderlich* gehören vor dem
> Produktivbetrieb zu einer Fachanwältin oder einem Fachanwalt.

| Verarbeitung | Angenommene Grundlage | Umsetzung |
|---|---|---|
| Nutzerkonten des Betriebs | Art. 6 Abs. 1 lit. b (Vertrag) | Minimal: E-Mail, Name, Rolle |
| Medien mit erkennbaren Personen | Art. 6 Abs. 1 lit. a (Einwilligung) | `consent_status` muss auf `CLEARED` stehen; Nachweis im Feld `people_json` |
| Kommentare und Direktnachrichten | Art. 6 Abs. 1 lit. f (berechtigtes Interesse) | Handle nur als HMAC; automatische Löschung nach 180 Tagen |
| Lead-Daten | Art. 6 Abs. 1 lit. b (Vertragsanbahnung) | Nur Klasse, Standort, Stufe — keine Kontaktdaten im System |
| Ereignisprotokoll | Art. 6 Abs. 1 lit. c und f | Unveränderlich, Nachweispflicht |

### Datenminimierung im Entwurf

- **Kein Klarname-Speicher im Posteingang.** Der Handle wird als HMAC
  gespeichert (`signPayload`). Wiederkehrende Personen sind erkennbar, eine
  durchsuchbare Namensliste entsteht nicht.
- **Automatische Anonymisierung.** Nach `INBOX_RETENTION_DAYS` (Standard 180)
  ersetzt eine tägliche Aufgabe Nachrichtentext und Anzeigename durch
  `[nach Aufbewahrungsfrist entfernt]`. Die anonymen Kennzahlen bleiben.
- **Keine sensiblen Rückschlüsse.** Der Prompt des Community-Analysten verbietet
  ausdrücklich Rückschlüsse auf Gesundheit, Herkunft oder finanzielle Lage. Der
  regelbasierte Klassifikator wertet nur Absichtssignale aus.
- **Keine Kontaktdaten in Leads.** Ein Lead trägt Klasse, Standort, Stufe und
  optional Umsatz — keine E-Mail, keine Telefonnummer.
- **Erkennung personenbezogener Daten im Beitragstext.** Der Privacy Reviewer
  blockiert Kennzeichen, Telefonnummern, E-Mail-Adressen, Bezüge zu
  Minderjährigen und namentlich genannte Fahrschüler.

### Betroffenenrechte

| Recht | Umsetzung |
|---|---|
| Auskunft (Art. 15) | Über SQL-Abfrage auf `inbox_messages` und `leads` möglich. **Keine fertige Exportfunktion.** |
| Löschung (Art. 17) | `applyRetention()` automatisch; einzelne Löschung per SQL. **Keine Oberflächenfunktion.** |
| Berichtigung (Art. 16) | Leads über die Oberfläche, Nachrichten per SQL |
| Widerspruch (Art. 21) | Asset auf `consent: WITHDRAWN` setzen — stoppt sofort auch eingeplante Beiträge (getestet) |
| Datenübertragbarkeit (Art. 20) | Nicht implementiert |

### Auftragsverarbeitung

Bei Nutzung von Instagram, Facebook, TikTok oder YouTube werden Daten an
Meta Platforms Ireland, TikTok Technology Ireland und Google Ireland
übermittelt. Mit Anbindung eines LLM kommt Anthropic hinzu.

**Erforderlich vor Produktivbetrieb:**
- Auftragsverarbeitungsverträge mit allen genutzten Anbietern
- Eintrag im Verzeichnis von Verarbeitungstätigkeiten (Art. 30)
- Prüfung, ob eine Datenschutz-Folgenabschätzung (Art. 35) nötig ist

---

## Rechtliche Prüfung erforderlich

1. **Bildrechte an Aufnahmen von Fahrschülern.** Kunstwerturheberrecht §§ 22,
   23 und DSGVO. Das System erzwingt eine dokumentierte Einwilligung, aber die
   Gestaltung der Einwilligungserklärung ist eine juristische Frage.
2. **Minderjährige.** BF17-Teilnehmer sind regelmäßig unter 18. Einwilligung
   der Erziehungsberechtigten und Frage der Einsichtsfähigkeit.
3. **Werbliche Aussagen.** Preisangaben unterliegen der PAngV; vergleichende
   Werbung dem UWG. Das System blockiert unbelegte Aussagen, ersetzt aber keine
   wettbewerbsrechtliche Prüfung.
4. **Gewinnspiele.** Werden vom Compliance Reviewer blockiert, weil sie
   rechtssichere Teilnahmebedingungen brauchen.
5. **Aussagen zur Fahrerlaubnisverordnung.** Werden als `FACT_LEGAL` markiert
   und blockiert, bis sie belegt sind.
6. **Impressumspflicht** auf den Social-Media-Profilen (§ 5 DDG).

---

## Empfehlungen für den Produktivbetrieb

**Vor dem ersten öffentlichen Beitrag:**
1. HTTPS mit gültigem Zertifikat, `COOKIE_SECURE=true`
2. Strengeres Login-Rate-Limit auf Reverse-Proxy-Ebene
3. Sicherung eingerichtet und Wiederherstellung **einmal geübt**
4. Auftragsverarbeitungsverträge geschlossen
5. Einwilligungserklärung juristisch geprüft

**Laufend:**
- Token-Ablauf beobachten (das System warnt ab sieben Tagen)
- Offene Alarme unter *System* durchgehen
- Sicherungen auf ein zweites Medium kopieren
- Wiederherstellung quartalsweise üben
- `npm audit` bei jedem Abhängigkeits-Update

**Nicht durchgeführt und empfohlen:**
- Externer Penetrationstest
- Formale WCAG-2.2-Prüfung
- Lasttest
