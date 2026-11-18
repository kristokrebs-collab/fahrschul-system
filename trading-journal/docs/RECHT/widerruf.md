> **[ANWALT]** ENTWURF – Prüfung durch Anwalt nötig. Vorlage für Verbraucher in der EU/Deutschland (§§ 312g, 355, 356, 357a BGB; Art. 246a § 1 Abs. 2 EGBGB mit Anlage 1 und 2). Die amtlichen Muster sind in der jeweils geltenden Fassung wörtlich zu übernehmen; dieser Entwurf lehnt sich an sie an, ist aber nicht ihr Wortlaut. Das Widerrufsrecht gilt nur für Verbraucher, nicht für Unternehmer.

## Widerrufsbelehrung

### Widerrufsrecht

Du hast das Recht, binnen vierzehn Tagen ohne Angabe von Gründen diesen Vertrag zu widerrufen. Die Widerrufsfrist beträgt vierzehn Tage ab dem Tag des Vertragsabschlusses.

Um dein Widerrufsrecht auszuüben, musst du uns ({{VITE_LEGAL_OPERATOR}}, {{VITE_LEGAL_ADDRESS}}, E-Mail {{VITE_LEGAL_EMAIL}}, Telefon {{VITE_LEGAL_PHONE}}) mittels einer eindeutigen Erklärung (z. B. ein mit der Post versandter Brief oder eine E-Mail) über deinen Entschluss, diesen Vertrag zu widerrufen, informieren. Du kannst dafür das beigefügte Muster-Widerrufsformular verwenden, das jedoch nicht vorgeschrieben ist{{TODO: erst aufnehmen, wenn die Widerrufsfunktion gebaut ist: „oder – solange die Widerrufsfrist läuft – die Schaltfläche ‚Vertrag widerrufen‘ in der App“}}.

Zur Wahrung der Widerrufsfrist reicht es aus, dass du die Mitteilung über die Ausübung des Widerrufsrechts vor Ablauf der Widerrufsfrist absendest.

### Folgen des Widerrufs

Wenn du diesen Vertrag widerrufst, haben wir dir alle Zahlungen, die wir von dir erhalten haben, unverzüglich und spätestens binnen vierzehn Tagen ab dem Tag zurückzuzahlen, an dem die Mitteilung über deinen Widerruf dieses Vertrags bei uns eingegangen ist. Für diese Rückzahlung verwenden wir dasselbe Zahlungsmittel, das du bei der ursprünglichen Transaktion eingesetzt hast; in keinem Fall werden dir wegen dieser Rückzahlung Entgelte berechnet.

Hast du verlangt, dass die Dienstleistung während der Widerrufsfrist beginnen soll, so hast du uns einen angemessenen Betrag zu zahlen, der dem Anteil der bis zu dem Zeitpunkt, zu dem du uns von der Ausübung des Widerrufsrechts hinsichtlich dieses Vertrags unterrichtest, bereits erbrachten Dienstleistungen im Vergleich zum Gesamtumfang der im Vertrag vorgesehenen Dienstleistungen entspricht.

### Vorzeitiges Erlöschen des Widerrufsrechts

Das Widerrufsrecht erlischt bei einem Vertrag über die Erbringung von Dienstleistungen, wenn wir die Dienstleistung vollständig erbracht haben und mit der Ausführung erst begonnen haben, nachdem du dazu deine ausdrückliche Zustimmung gegeben hast und gleichzeitig deine Kenntnis davon bestätigt hast, dass du dein Widerrufsrecht bei vollständiger Vertragserfüllung durch uns verlierst.

> **[ANWALT]** Ein laufendes Abo wird nie „vollständig“ erbracht, solange es läuft; das Erlöschen greift praktisch nur bei beendeter Laufzeit. Maßgeblich ist daher der Wertersatz (§ 357a BGB). Prüfen, ob Dienst (Dienstleistung) oder digitales Produkt (§ 327 BGB) vorliegt und welche Erlöschensregel (§ 356 BGB; Absatzzählung gegen die aktuelle Fassung prüfen) und welcher Mustertext passt. Bei Testphase: beginnt die Widerrufsfrist mit Vertragsschluss (Start der Testphase) – bitte klären.

### Muster-Widerrufsformular

(Wenn du den Vertrag widerrufen willst, dann fülle bitte dieses Formular aus und sende es zurück.)

An {{VITE_LEGAL_OPERATOR}}, {{VITE_LEGAL_ADDRESS}}, E-Mail {{VITE_LEGAL_EMAIL}}:

Hiermit widerrufe(n) ich/wir (*) den von mir/uns (*) abgeschlossenen Vertrag über die Erbringung der folgenden Dienstleistung: {{TODO: Tarif und Abrechnungszeitraum, z. B. Pro monatlich}}

Bestellt am (*) / erhalten am (*): …

Name des/der Verbraucher(s): …

Anschrift des/der Verbraucher(s): …

Unterschrift des/der Verbraucher(s) (nur bei Mitteilung auf Papier): …

Datum: …

(*) Unzutreffendes streichen.

### Zustimmung zum sofortigen Beginn (Wortlaut für die Bestellung)

Der Tarif wird sofort nach der Bestellung freigeschaltet. Damit das vor Ablauf der Widerrufsfrist rechtmäßig geschieht, wird vor der Bestellung ein eigenes Kästchen bestätigt (nicht vorangekreuzt, nicht in den AGB-Kästchen versteckt):

> Ich verlange ausdrücklich, dass der Anbieter vor Ablauf der Widerrufsfrist mit der Bereitstellung meines Tarifs beginnt. Mir ist bekannt, dass ich bei einem Widerruf für die bis dahin erbrachten Leistungen einen angemessenen Betrag zahlen muss und dass mein Widerrufsrecht erlischt, sobald der Anbieter die Leistung vollständig erbracht hat.

Die Bestätigung wird mit Zeitpunkt, Konto und Fassung der Texte serverseitig gespeichert (Nachweis, `consents`, Migration 0016). Dieser Wortlaut steht im Code (`IMMEDIATE_START_CONSENT` in `src/legal/consentTexts.ts`) und ist in der Bestellübersicht eingebaut (Paket B4).

### Widerrufsfunktion in der App (seit 19. Juni 2026)

Wer online einen Vertrag mit Widerrufsrecht schließt, muss ihn auch online widerrufen können (§ 356a BGB; Richtlinie (EU) 2023/2673). Vorgesehener Ablauf: Schaltfläche „Vertrag widerrufen“ (während der gesamten Widerrufsfrist erreichbar, ohne Login) → Name, Vertragsangabe und Kontaktweg angeben → Schaltfläche „Widerruf bestätigen“ → unverzügliche Eingangsbestätigung mit Inhalt, Datum und Uhrzeit auf einem dauerhaften Datenträger (E-Mail). Beschriftungen als Konstanten in `src/legal/consentTexts.ts`. Gebaut in Paket B4 (öffentliche Seite `/?widerruf` mit E-Mail-Bestätigungsweg, Schaltfläche in „Abo verwalten“); Beschreibung und offene Punkte: `kuendigung-widerruf.md`.
