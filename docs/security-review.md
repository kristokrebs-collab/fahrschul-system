# Sicherheit und Datenschutz

## Kontaktformular

Umgesetzt als Next.js Server Action (`src/app/kontakt/actions.ts`), nicht als
Attrappe.

**Validierung.** Zod-Schema, serverseitig erzwungen. Die Clientseite dient nur
der Bequemlichkeit; maßgeblich ist ausschließlich die Serverprüfung. Längen
sind nach oben begrenzt, die Telefonnummer über eine Zeichenklasse eingegrenzt,
die Einwilligung ist Pflicht.

**Spam.** Honeypot-Feld namens `website` — außerhalb des Sichtbereichs
positioniert statt `display: none`, damit Bots, die berechnete Stile prüfen, es
trotzdem ausfüllen. Ist es gefüllt, meldet die Antwort Erfolg, **ohne**
zuzustellen: der Bot lernt nichts.

**Ratenbegrenzung.** Fünf Absendevorgänge je IP in zehn Minuten, mit
opportunistischer Bereinigung der Map. Der Speicher liegt im Prozess — das
genügt für eine Instanz. Hinter mehreren Instanzen oder auf einer
Serverless-Plattform muss er in einen gemeinsamen Speicher wandern; die Logik
ist genau deshalb in einer einzigen Funktion isoliert.

**Kein falscher Erfolg.** Ist kein Zustellweg konfiguriert, sagt das Formular
das offen und verweist auf Telefon und E-Mail. Es zeigt **nie** eine
Erfolgsmeldung, wenn nichts verschickt wurde. Ein Playwright-Test sichert genau
das ab — eine vorgetäuschte Erfolgsmeldung ist der Weg, auf dem echte Anfragen
lautlos verlorengehen.

**Fehlerbehandlung.** Transportfehler werden abgefangen; nach außen geht nie ein
Stacktrace oder eine Endpunkt-Adresse.

### Für den Livegang

```bash
CONTACT_WEBHOOK_URL=https://…      # nimmt JSON per POST entgegen
CONTACT_WEBHOOK_TOKEN=…            # optional, wird als Bearer gesendet
```

Nutzbar ist jeder Endpunkt, der JSON annimmt — Mail-Relay, CRM-Eingang,
Automatisierungsdienst. Gesendet werden Name, E-Mail, Telefon, Thema, Standort,
Nachricht und Zeitstempel. Ohne diese Variablen bleibt das Formular im ehrlichen
Fehlerzustand.

## Kopfzeilen

Gesetzt in `next.config.ts` für alle Pfade:

```
Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline';
  style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:;
  font-src 'self' data:; connect-src 'self'; frame-ancestors 'self';
  form-action 'self'; base-uri 'self'; object-src 'none'
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
X-Frame-Options: SAMEORIGIN
Permissions-Policy: camera=(), microphone=(), geolocation=(), interest-cohort=()
```

`'unsafe-eval'` wird **nur im Entwicklungsmodus** ergänzt, weil der
Entwicklungsbuild von React es für seine Debug-Funktionen braucht. Im
Produktionsbuild ist es nicht enthalten — dort, wo die Richtlinie zählt.

`'unsafe-inline'` bei `script-src` ist nötig, weil Next.js Bootstrap-Skripte
inline einfügt. Wer es loswerden will, braucht eine Nonce über Middleware; das
ist der nächste sinnvolle Schritt, aber kein Blocker.

## Datenschutz

**Kein Tracking.** Keine Analyse, keine Werbenetzwerke, keine Profilbildung,
keine Drittanbieter-Einbettung. Deshalb **kein Cookie-Banner** — es gibt nichts
einzuwilligen.

**Schriften selbst ausgeliefert.** `next/font` holt Archivo und Instrument Sans
zur Build-Zeit und legt sie neben die Anwendung. Zur Laufzeit besteht keine
Verbindung zu Google — das ist der Punkt, an dem deutsche Websites regelmäßig
abgemahnt werden.

**Keine Karten, keine Videos von Dritten.** Anfahrt wird beschrieben statt
eingebettet.

**Keine echten Personendaten im Bundle.** Die Cockpit-Demo nutzt eine erfundene
Person und ist als Demo gekennzeichnet. Aus `dashboard.html` wurden ausdrücklich
**nur die Regeln** übernommen, keine Datensätze.

**Keine Geheimnisse im Frontend.** Die einzigen Umgebungsvariablen werden
serverseitig gelesen und nie an den Client gegeben.

## Offen

- CSP-Nonce statt `'unsafe-inline'` bei `script-src`.
- Ratenbegrenzung in einen gemeinsamen Speicher, sobald mehrere Instanzen laufen.
- `Strict-Transport-Security` setzen, sobald die Domain unter HTTPS läuft
  (gehört zur Hosting-Ebene, nicht in die Anwendung).
- Datenschutzerklärung juristisch prüfen und um Hoster, Speicherfristen und
  gegebenenfalls Auftragsverarbeiter für den Formularversand ergänzen.
- Impressum durch das Unternehmen freigeben (USt-IdNr., Aufsichtsbehörde).
