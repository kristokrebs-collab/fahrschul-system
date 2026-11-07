> **[ANWALT]** ENTWURF – Prüfung durch Anwalt nötig. Vorlage nach Art. 13 DSGVO, aus dem Code des Projekts abgeleitet (Stand der Mechanik: siehe docs/RECHT-CHECKLISTE.md). Keine Rechtsberatung, kein Gütesiegel. Jede Zeile `{{TODO: …}}` muss der Betreiber klären; was nicht zutrifft (z. B. Telefonie, KI), muss vor Veröffentlichung gestrichen werden.

## Datenschutzerklärung

Stand: {{TODO: Datum der Veröffentlichung}}

### 1. Verantwortlicher

Verantwortlich für die Verarbeitung personenbezogener Daten auf dieser Seite ist {{VITE_LEGAL_OPERATOR}}, {{VITE_LEGAL_ADDRESS}}, E-Mail {{VITE_LEGAL_EMAIL}}.

Datenschutzbeauftragte(r): {{TODO: Name und Kontakt, falls benannt – sonst Absatz streichen}}

### 2. Kurzfassung

- Das Trading-Journal arbeitet zuerst lokal: Ohne Konto bleiben deine Trades, Notizen und Einstellungen in deinem Browser auf deinem Gerät. Wir sehen sie nicht.
- Mit Konto (optional) werden Journal-Daten verschlüsselt übertragen und bei unserem Datenbank-Anbieter gespeichert, damit sie auf mehreren Geräten da sind.
- Wir setzen keine Cookies und keine Tracker ein: kein Werbe-, Analyse- oder Social-Media-Dienst, keine Schriftarten oder Skripte von fremden Servern.
- Marktdaten rufen wir von Börsen ab. Dabei erhält die Börse die IP-Adresse deines Geräts (siehe Abschnitt 5).

### 3. Bereitstellung der Seite (Hosting)

Die Seite wird bei Netlify gehostet ({{TODO: Netlify Inc., USA – Vertragspartner und Server-Region prüfen}}). Beim Aufruf verarbeitet der Hoster technisch notwendige Verbindungsdaten (IP-Adresse, Datum und Uhrzeit, abgerufene Adresse, Browserkennung, übertragene Datenmenge) in Server-Protokollen, um die Seite auszuliefern, Missbrauch abzuwehren und die Sicherheit zu gewährleisten. Rechtsgrundlage: Art. 6 Abs. 1 lit. f DSGVO (berechtigtes Interesse am sicheren, stabilen Betrieb). Mit dem Hoster besteht ein Auftragsverarbeitungsvertrag nach Art. 28 DSGVO {{TODO: AVV abgeschlossen? Speicherdauer der Protokolle beim Hoster}}.

Dieselbe Infrastruktur führt unsere Server-Funktionen aus (Konto, Abos, Börsen-Sync, Alarme). Sie verarbeiten Anfragen mit deiner Anmeldung; IP-Adressen werden dort nur pseudonymisiert (Hash mit geheimem Schlüssel) für Sicherheitsprotokoll und Rate-Limits gespeichert.

### 4. Speicherung im Browser (lokal)

Die App speichert Daten auf deinem Gerät: im Local Storage (Journal, Einstellungen, Oberfläche, Anmelde-Sitzung des Kontos), in IndexedDB (Bilder und Marktdaten-Zwischenspeicher, Archiv) und im Session Storage (einmalige Animationen je Sitzung). Das ist technisch erforderlich, damit der von dir ausdrücklich gewünschte Dienst (dein Journal) funktioniert; eine Einwilligung ist dafür nicht erforderlich (§ 25 Abs. 2 Nr. 2 TDDDG). Wir verwenden keine Cookies und lesen nichts zu Werbe- oder Analysezwecken aus. Diese Daten verlassen dein Gerät nur, wenn du ein Konto mit Cloud-Sync nutzt oder selbst exportierst. Du kannst sie jederzeit in den Browser-Einstellungen oder in der App (Einstellungen › Daten) löschen.

> **[ANWALT]** Einzelne reine Komfort-Merker (z. B. „Einführung gesehen“, „Animation in dieser Sitzung gezeigt“) sind streng genommen nicht „unbedingt erforderlich“. Risiko gering (keine Auslesung durch Dritte, kein Personenbezug), aber bitte bewerten – oder einen Hinweis aufnehmen, dass sie Nutzerwahl bzw. Teil der gewünschten Oberfläche sind.

### 5. Marktdaten von Börsen und öffentlichen Quellen

Kurse, Kerzen und Kennzahlen ruft dein Browser direkt von öffentlichen Schnittstellen ab (zuerst Binance Futures, bei Ausfall Bybit, dann OKX; ersatzweise über unseren eigenen Weiterleitungs-Server). Dabei erhält der jeweilige Anbieter technisch zwingend deine IP-Adresse und Verbindungsdaten. Es werden keine Konto- oder Journal-Daten übermittelt. Rechtsgrundlage: Art. 6 Abs. 1 lit. b DSGVO (Bereitstellung der von dir genutzten Live-Daten) bzw. lit. f (berechtigtes Interesse an einer funktionierenden Kursanzeige). Die Anbieter sitzen außerhalb der EU ({{TODO: Sitz und Rechtsgrundlage der Übermittlung je Anbieter prüfen}}). In den Einstellungen (Live-Daten) kannst du den Weg über unseren Weiterleitungs-Server wählen; dann sehen die Börsen nur den Server.

> **[ANWALT]** Die Verbindung zu Binance wird beim Laden der Seite vorbereitet und die Marktdaten werden beim Start abgerufen – ohne vorherige Auswahl. Bitte prüfen, ob eine Information genügt (berechtigtes Interesse) oder eine Voreinstellung über den eigenen Server nötig ist.

Aktien- und Branchendaten (Yahoo Finance, Nasdaq Trader, SEC EDGAR, Datenbibliothek von Kenneth French, House Clerk) holen unsere Server-Funktionen ab; dorthin gehen nur Börsenkürzel, nie Personendaten. Der Branchen-Trend und weitere Tabellen liegen als Dateien auf unserem Server.

### 6. Konto und Cloud-Sync (optional)

Wenn du ein Konto anlegst, verarbeiten wir E-Mail-Adresse, ein Passwort (nur als Hash), ggf. Einmalcodes und das Gerät für die Zwei-Faktor-Anmeldung sowie die Sitzungsdaten. Mit Cloud-Sync speichern wir deine Journal-Daten (Trades, Tagesnotizen, Einstellungen, Screenshots) und Sicherungskopien. Einen Teil davon legst du selbst an; wir werten sie nicht für andere Zwecke aus. Rechtsgrundlage: Art. 6 Abs. 1 lit. b DSGVO (Vertrag bzw. Nutzungsverhältnis). Anbieter ist Supabase ({{TODO: Supabase Inc., Region des Projekts – möglichst EU, z. B. Frankfurt; AVV prüfen}}). Du kannst alle Daten in der App exportieren (Art. 15, 20 DSGVO) und dein Konto samt Cloud-Daten löschen (Art. 17 DSGVO); lokale Daten bleiben in deinem Browser, bis du sie dort löschst.

Sicherungskopien: nächtlich, 14 Tage aufbewahrt (die neueste immer). Fehlerberichte nur mit deiner Zustimmung (Voreinstellung aus), 30 Tage. Sicherheitsprotokoll (Anmeldung, Export, Löschung, Abo-Änderung): {{TODO: Speicherdauer des audit_log festlegen}}.

### 7. Abos und Zahlung (Stripe)

Für kostenpflichtige Tarife leiten wir dich zu Stripe weiter. Stripe verarbeitet Zahlungsdaten (Karte, SEPA o. Ä.), Name, Rechnungsadresse und ggf. Steuer-ID als eigener Verantwortlicher für Zahlungsabwicklung und Betrugsprävention und teilweise in unserem Auftrag ({{TODO: Stripe Payments Europe Ltd., Irland; Stripe, Inc., USA – Rollen laut Stripe-Vereinbarung prüfen}}). Wir sehen deine Kartendaten nie; wir erhalten Status, Tarif, Zeiträume und Rechnungen. Rechtsgrundlage: Art. 6 Abs. 1 lit. b und lit. c DSGVO (Vertrag; steuer- und handelsrechtliche Pflichten). Rechnungsdaten bewahren wir nach den gesetzlichen Fristen auf (derzeit bis zu 8 bzw. 10 Jahre, § 147 AO, § 257 HGB) {{TODO: Fristen prüfen}}.

### 8. E-Mails

Anmelde- und Konto-E-Mails versenden wir über {{TODO: SMTP-/E-Mail-Dienst des Supabase-Projekts}}. Wenn du E-Mail-Alarme einschaltest, versenden wir sie über Resend ({{TODO: Resend, Inc., USA – AVV und Übermittlungsgrundlage prüfen}}). Rechtsgrundlage: Art. 6 Abs. 1 lit. b DSGVO.

### 9. Telefon-Alarme (nur wenn eingeschaltet)

Telefon-Anrufe sind nur vorgesehen, wenn du sie ausdrücklich aktivierst und deine Nummer bestätigst. Dann verarbeitet Twilio die Nummer und das Gesprächsprotokoll ({{TODO: Twilio Inc., USA – nur aufnehmen, wenn die Funktion live ist; sonst Abschnitt streichen}}). Rechtsgrundlage: Einwilligung, Art. 6 Abs. 1 lit. a DSGVO; Widerruf jederzeit in den Einstellungen.

### 10. KI-Funktionen (optional)

Einige Premium-Funktionen (Coach-Formulierung, Screenshot-Import, Strategie aus Text) können einen KI-Dienst von Anthropic nutzen, nur wenn der Betreiber ihn eingerichtet hat und du die Funktion aufrufst. Dabei gehen die dafür nötigen Inhalte (berechnete Kennzahlen, hochgeladene Bilder bzw. dein Strategietext) serverseitig an Anthropic ({{TODO: Anthropic PBC, USA – Auftragsverarbeitung, Speicherung und Übermittlungsgrundlage prüfen; Abschnitt streichen, wenn nicht aktiviert}}). Rechtsgrundlage: Art. 6 Abs. 1 lit. b DSGVO. Die OCR für Screenshots läuft lokal in deinem Browser und sendet nichts.

### 11. Börsen-Verbindung

Wenn du eine Börse verbindest, speichern wir den von dir erzeugten lesenden API-Schlüssel verschlüsselt und rufen deine Trades ab. Trenne die Verbindung in der App, wird der Schlüssel gelöscht und der Abruf endet. Rechtsgrundlage: Art. 6 Abs. 1 lit. b DSGVO (dein Auftrag).

### 12. Community und Teilen (optional)

Gruppen, Ranglisten und geteilte Auswertungen sind nur mit deiner ausdrücklichen Zustimmung sichtbar; Ranglisten und Verteilungen werden erst ab einer Mindestgröße der Gruppe (k ≥ 10) angezeigt. Rechtsgrundlage: Art. 6 Abs. 1 lit. a DSGVO; Widerruf jederzeit in den Datenschutz-Einstellungen im Konto.

### 13. Empfänger und Auftragsverarbeiter

Wir geben Daten nur an folgende Empfänger weiter, soweit oben beschrieben: Hosting (Netlify), Datenbank und Anmeldung (Supabase), Zahlungsabwicklung (Stripe), E-Mail-Versand (Resend, ggf. weiterer Dienst), ggf. Telefonie (Twilio), ggf. KI (Anthropic), Börsen als Datenquellen (Binance, Bybit, OKX) und Behörden, wenn wir gesetzlich verpflichtet sind. Eine Weitergabe zu Werbezwecken findet nicht statt.

### 14. Übermittlung in Drittländer

Einige Empfänger sitzen in den USA oder anderen Drittländern. Grundlage ist, soweit der Empfänger zertifiziert ist, der Angemessenheitsbeschluss der EU-Kommission zum EU-US Data Privacy Framework vom 10. Juli 2023; das Gericht der EU hat ihn am 3. September 2025 (T-553/23) bestätigt, ein Rechtsmittel ist anhängig. Andernfalls nutzen wir Standardvertragsklauseln (Durchführungsbeschluss (EU) 2021/914) mit zusätzlichen Maßnahmen. {{TODO: je Empfänger: DPF-Zertifizierung am Veröffentlichungstag auf dataprivacyframework.gov prüfen, SCC abschließen; für Börsen-Marktdaten Rechtsgrundlage klären}}

### 15. Speicherdauer

Lokale Daten: bis du sie löschst. Konto- und Cloud-Daten: bis zur Löschung des Kontos. Zahlungs- und Rechnungsdaten: nach den gesetzlichen Aufbewahrungsfristen. Server-Protokolle des Hosters: {{TODO: Speicherdauer laut Hoster eintragen}}. Sicherungskopien: 14 Tage. Fehlerberichte: 30 Tage.

### 16. Deine Rechte

Du hast das Recht auf Auskunft (Art. 15), Berichtigung (Art. 16), Löschung (Art. 17), Einschränkung (Art. 18), Datenübertragbarkeit (Art. 20) und Widerspruch gegen Verarbeitung auf Grundlage berechtigter Interessen (Art. 21 DSGVO). Eine Einwilligung kannst du jederzeit mit Wirkung für die Zukunft widerrufen (Art. 7 Abs. 3). Export und Löschung findest du im Konto; sonst schreibe an {{VITE_LEGAL_EMAIL}}. Du kannst dich bei einer Datenschutz-Aufsichtsbehörde beschweren (Art. 77 DSGVO), z. B. der für deinen Wohnort zuständigen oder {{TODO: für den Betreiber zuständige Aufsichtsbehörde}}.

### 17. Pflicht zur Bereitstellung, automatisierte Entscheidungen

Für die lokale Nutzung musst du keine Daten angeben. Für Konto und Abo sind E-Mail und (für Zahlungen) die Zahlungsdaten nötig. Es gibt keine automatisierte Entscheidungsfindung mit rechtlicher Wirkung (Art. 22 DSGVO); Kennzahlen, Ampeln und Signale sind Berechnungen, die du selbst bewertest.

### 18. Alter

Die Nutzung ist für Personen ab 18 Jahren gedacht. {{TODO: Altersgrenze und Prüfung festlegen (siehe Checkliste)}}

### 19. Änderungen

Wir passen diese Erklärung an, wenn sich Funktionen oder Rechtslage ändern. Die aktuelle Fassung steht in der App unter Einstellungen › Rechtliches.
