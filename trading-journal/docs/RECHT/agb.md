> **[ANWALT]** ENTWURF – Prüfung durch Anwalt nötig. Vorlage (Verbraucher und Unternehmer gemischt), keine Rechtsberatung. §§ 305 ff. BGB (AGB-Kontrolle), §§ 312 ff. BGB und § 309 BGB sind zu beachten; Klauseln, die der Betreiber nicht abbilden kann (Funktionen, Preise, Fristen), anpassen. Technische Grundlagen: docs/TARIFE.md (Tarifvertrag), src/billing/plans.ts.

## Allgemeine Geschäftsbedingungen

Stand: {{TODO: Datum}}

### 1. Anbieter und Geltung

Anbieter ist {{VITE_LEGAL_OPERATOR}}, {{VITE_LEGAL_ADDRESS}}, E-Mail {{VITE_LEGAL_EMAIL}} („Anbieter“). Diese Bedingungen gelten für die Nutzung des Trading-Journals („Dienst“) durch Verbraucher und Unternehmer („Nutzer“). Abweichende Bedingungen des Nutzers gelten nur, wenn der Anbieter sie ausdrücklich bestätigt.

### 2. Leistung

Der Dienst ist eine Software zum Führen eines Trading-Journals mit Auswertungen, Simulationen und Hilfen zur Planung. Der Funktionsumfang richtet sich nach dem gewählten Tarif (Free, Pro, Premium, Team) wie auf der Seite „Preise“ beschrieben. Der Anbieter darf Funktionen weiterentwickeln, ändern und, wenn zumutbar, einstellen; wesentliche Einschränkungen eines bezahlten Tarifs kündigt er mit angemessener Frist an. {{TODO: Änderungsrecht nach § 327r BGB (digitale Produkte) prüfen}}

Der Dienst ist **kein** Finanzdienstleister: Er erteilt keine Anlageberatung, spricht keine Anlage- oder Handelsempfehlungen aus, vermittelt keine Geschäfte und führt keine Order aus. Kennzahlen, Ampeln, Signale, Simulationen und Auswertungen sind Berechnungen aus deinen Daten und historischen Kursen und keine Prognose. Siehe Risikohinweis.

### 3. Vertragsschluss, Konto, Alter

Der Dienst kann ohne Konto lokal genutzt werden (Free). Ein Konto ist für Cloud-Sync und Abos nötig. Die Registrierung ist nur für volljährige und voll geschäftsfähige Personen gedacht {{TODO: Altersgrenze und Prüfung}}. Der Vertrag über einen bezahlten Tarif kommt zustande, wenn der Nutzer die Bestellung am Ende des Bestellvorgangs abschickt und der Anbieter sie durch Freischaltung bestätigt. Zugangsdaten sind geheim zu halten; ein Konto ist nicht übertragbar.

### 4. Preise, Testphase, Zahlung

Es gelten die Preise zum Zeitpunkt der Bestellung. Preise gegenüber Verbrauchern verstehen sich einschließlich gesetzlicher Umsatzsteuer; Näheres und die Darstellung im Ausland regeln die Preisangaben. Die Zahlung erfolgt über Stripe im Voraus je Abrechnungszeitraum (monatlich oder jährlich). Eine Testphase ist kostenlos; endet sie ohne Kündigung, beginnt das bezahlte Abo und der angegebene Preis wird fällig. Bei fehlgeschlagener Zahlung kann der Anbieter den bezahlten Tarif nach Mahnung sperren. {{TODO: Testphase-Länge, Mahnung, Rücklastschriftkosten festlegen}}

### 5. Laufzeit, Verlängerung, Kündigung

Ein bezahlter Tarif läuft für den gewählten Abrechnungszeitraum (einen Monat oder ein Jahr) und verlängert sich automatisch um denselben Zeitraum, wenn er nicht vorher gekündigt wird. Der Nutzer kann jederzeit zum Ende des laufenden Zeitraums kündigen – in der App über die Schaltfläche „Verträge hier kündigen“ oder im Stripe-Kundenportal. Bis zum Ende bleibt der Tarif freigeschaltet; danach fällt das Konto auf Free zurück, das Journal bleibt erhalten. Das Recht zur außerordentlichen Kündigung aus wichtigem Grund bleibt unberührt. Der Anbieter kann Free-Konten bei Verstoß gegen diese Bedingungen sperren.

> **[ANWALT]** Verlängerung und Kündigung gegenüber Verbrauchern: § 309 Nr. 9 BGB (Laufzeit und stillschweigende Verlängerung: nach Erstlaufzeit höchstens monatlich kündbar – bei Jahrestarifen prüfen!). Der Kündigungsbutton nach § 312k BGB muss ohne Login erreichbar sein – siehe Checkliste, Kaufstrecke.

### 6. Widerruf

Verbrauchern steht ein gesetzliches Widerrufsrecht zu; Belehrung, Muster-Formular und die Zustimmung zum sofortigen Beginn stehen in der Widerrufsbelehrung.

### 7. Nutzung nur für eigene Daten und eigene Zwecke

Der Dienst ist für das eigene Journal des Nutzers bestimmt. Es ist nicht erlaubt, fremde Konten oder Zugangsdaten ohne Berechtigung zu verbinden, Tarife weiterzuverkaufen oder Zugänge zu teilen (Team-Tarife: nur die gebuchten Sitze), den Dienst automatisiert in einem Umfang abzufragen, der den Betrieb stört, oder Schutzmechanismen zu umgehen. Börsen-Schlüssel sind ausschließlich lesend und ohne Auszahlungsrecht anzulegen. Der Nutzer ist für Inhalte, die er einträgt oder teilt (Notizen, Bilder, Gruppen-Beiträge), verantwortlich und sichert zu, dass er sie nutzen darf.

### 8. Keine Beratung, Risiko

Alle Inhalte dienen der Information und Selbstkontrolle. Handelsentscheidungen trifft der Nutzer allein und auf eigenes Risiko; Handel mit Hebelprodukten kann zum Totalverlust führen. Der Anbieter schuldet keinen Handelserfolg und keine Richtigkeit von Marktdaten Dritter.

### 9. Verfügbarkeit, Datenquellen Dritter

Der Anbieter bemüht sich um hohe Verfügbarkeit, schuldet aber keine unterbrechungsfreie Nutzung; Wartung und Ausfälle von Hoster, Börsen und anderen Quellen sind möglich. Marktdaten stammen von Dritten und werden ohne Gewähr dargestellt; deren Nutzungsbedingungen gelten zusätzlich. {{TODO: Verfügbarkeitszusage ja/nein, SLA nur für Team?}}

### 10. Haftung

Der Anbieter haftet unbeschränkt bei Vorsatz und grober Fahrlässigkeit, bei Verletzung von Leben, Körper und Gesundheit, nach dem Produkthaftungsgesetz und soweit er eine Garantie übernommen hat. Bei leicht fahrlässiger Verletzung wesentlicher Vertragspflichten (Pflichten, deren Erfüllung die ordnungsgemäße Durchführung des Vertrags erst ermöglicht und auf die der Nutzer regelmäßig vertrauen darf) ist die Haftung auf den vorhersehbaren, vertragstypischen Schaden begrenzt. Im Übrigen ist die Haftung bei leichter Fahrlässigkeit ausgeschlossen. Für den Verlust von Daten haftet der Anbieter nur, wenn der Nutzer regelmäßig Sicherungen (Backup-Export) angelegt hat und der Schaden auch dann entstanden wäre.

> **[ANWALT]** Haftungsklausel einschließlich Datenverlust nach §§ 307, 309 Nr. 7 BGB prüfen; bei unentgeltlichem Free-Tarif gelten Haftungsmaßstäbe des Schenkungsrechts bzw. § 327 ff. BGB (digitale Produkte).

### 11. Partnerlinks und Marken Dritter

Links zu Börsen und anderen Anbietern können Partnerlinks sein; sie sind mit „Werbung / Partnerlink“ gekennzeichnet. Namen wie TradingView, Binance, Bybit, OKX oder Bitunix sind Marken ihrer Inhaber; es besteht keine Partnerschaft, solange nicht ausdrücklich angegeben. Siehe die Hinweise.

### 12. Datenschutz

Informationen zur Verarbeitung personenbezogener Daten stehen in der Datenschutzerklärung.

### 13. Änderungen dieser Bedingungen

Der Anbieter kann diese Bedingungen mit Wirkung für die Zukunft ändern, wenn dies aus triftigem Grund (z. B. Rechtsänderung, neue Funktionen) zumutbar ist. Änderungen teilt er mindestens {{TODO: Frist, z. B. 6 Wochen}} vorher in Textform mit; der Nutzer kann widersprechen oder kündigen. {{TODO: Zustimmungsfiktion bei Verbrauchern ist eng begrenzt (BGH XI ZR 26/20) – Verfahren anwaltlich festlegen}}

### 14. Schlussbestimmungen

Es gilt deutsches Recht unter Ausschluss des UN-Kaufrechts; zwingende Verbraucherschutzvorschriften des Staates, in dem der Verbraucher seinen gewöhnlichen Aufenthalt hat, bleiben unberührt. Gerichtsstand für Kaufleute ist {{TODO: Sitz des Anbieters}}. Sollten einzelne Bestimmungen unwirksam sein, bleibt der Rest wirksam. Hinweis zur Verbraucherstreitbeilegung: siehe Impressum.

> **[ANWALT]** Weltweiter Zielmarkt: Rechtswahl, Verbraucherrechte außerhalb der EU (UK Consumer Rights Act, US-Staaten), Verbot von Pauschalausschlüssen je Land und Beschränkung des Angebots (Geo-Blocking, Sanktionslisten) prüfen.
