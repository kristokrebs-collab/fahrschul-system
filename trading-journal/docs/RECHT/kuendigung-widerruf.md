> **[ANWALT]** ENTWURF – Prüfung durch Anwalt nötig. Das ist die Beschreibung, wie die App Kündigung (§ 312k BGB) und Widerruf (§ 356a BGB) technisch löst, und warum sie diesen Weg gewählt hat. Keine Rechtsberatung, keine Aussage, dass der Weg rechtskonform ist.

# Kündigen und Widerrufen in der App (Entwurf)

## Zwei Wege standen zur Wahl

1. **Direkter Weg ins Kundenportal nach Login, mit Rückkehr.** Einfach zu bauen (Stripe-Portal, `returnTo`). Aber: Wer sich zuerst anmelden muss, hat die Kündigung nicht „ohne Hürde“ – die von der Checkliste zitierte Rechtsprechung (OLG Nürnberg 3 U 2214/23; OLG Düsseldorf 20 UKl 3/23) verlangt den Zugang ohne Login; die Gegenansicht (CMS-Beitrag zu OLG Nürnberg) hält den Login für zulässig. Beide sind Sekundärquellen und nicht abschließend geprüft.
2. **Öffentliche Seite mit E-Mail-Bestätigung (gewählt).** Etwas mehr Bau, dafür der vorsichtigere Weg: erreichbar ohne Konto-Login, aus jedem Fußbereich und dem Menü.

Gewählt ist Weg 2. Grund: Er verträgt beide Rechtsansichten. Wenn der Login zulässig wäre, schadet der login-freie Weg nicht; wenn er unzulässig wäre, fehlt nichts.

## Ablauf (identisch für Kündigung und Widerruf)

| Schritt | Kündigung („Verträge hier kündigen“) | Widerruf („Vertrag widerrufen“) |
|---|---|---|
| 1. Einstieg | Link in Menü und Konto, im Fußbereich jeder Seite außer Übersicht und Cockpit; Link `/?kuendigen`; Schaltfläche in Konto › Abo und auf der Preisseite | Link im Menü, in Konto; `/?widerruf`; Schaltfläche in „Abo verwalten“ während der 14 Tage |
| 2. Angaben | E-Mail-Adresse des Kontos | E-Mail-Adresse, Name, optional Angabe zum Vertrag |
| 3. Bestätigungsseite | Schaltfläche **„Jetzt kündigen“** (`BUTTON_LABELS.cancelConfirm`); davor **kein** Grund, **kein** Angebot | Schaltfläche **„Widerruf bestätigen“** (`BUTTON_LABELS.withdrawConfirm`) |
| 4. Speichern | Der Server speichert die Erklärung mit Eingangszeit (Serveruhr) in `contract_requests`; die Adresse nur als gesalzener Hash | dasselbe |
| 5. Eingangsbestätigung | E-Mail mit Link (Resend); der Link gilt 24 Stunden | dasselbe |
| 6. Ausführung | Nach dem Klick auf den Link: `cancel_at_period_end` bei Stripe; Bestätigungs-Mail mit Inhalt, Datum und Uhrzeit des Eingangs, Ende des Vertrags | Nach dem Klick auf den Link: sofortiges Ende des Abos (nur innerhalb von 14 Tagen seit Vertragsschluss, sonst „Frist abgelaufen“, Vertrag besteht weiter); Bestätigungs-Mail |
| Angemeldet als diese Adresse | Schritt 5 entfällt: der Login belegt die Adresse, es wird sofort ausgeführt, die Bestätigungs-Mail folgt | dasselbe |

Eingehalten sind: Bestätigungsseite mit eigener Schaltfläche, keine Zwischenstufe vor der Bestätigung, Eingangsbestätigung mit Datum/Uhrzeit auf einem dauerhaften Datenträger (E-Mail), Inhalt der Erklärung in der Bestätigung. **Nach** der Kündigung (im App-Dialog) kommen die freiwillige Begründung (an Stripe als `cancellation_details`) und das Angebot, zu Pro zu wechseln – sie ändern die Kündigung nicht.

## Warum der Bestätigungslink

Ohne ihn könnte jeder, der eine fremde Adresse kennt, deren Vertrag beenden. Der Link beweist, dass die Erklärung vom Postfach des Konto-Inhabers kommt. Die Antwort der Seite ist für bekannte und unbekannte Adressen **dieselbe** (niemand kann prüfen, wer einen Vertrag hat); an unbekannte Adressen geht keine Mail.

**Offen / Anwalt:**
- Gilt die Kündigung schon mit dem Klick auf „Jetzt kündigen“ (Eingang) oder erst mit dem Klick auf den Link (Ausführung)? Die App speichert den Eingang mit Zeit und führt aus, sobald die Adresse bestätigt ist; sie sagt das in der Mail. Wo die Verlängerung zwischen Eingang und Bestätigung liegt, entscheidet der Betreiber manuell.
- Ist die Verifikation per Link mit dem Verbot von Hürden vereinbar?
- Ohne E-Mail-Versand (`RESEND_API_KEY` / `ALERT_FROM` fehlen) wird die Erklärung gespeichert, aber **nicht** ausgeführt (nur durch eine angemeldete Person); die Seite sagt das ehrlich. Ist das für den Betrieb zulässig oder muss der Versand Voraussetzung für den Verkauf sein?
- Wertersatz und Erstattung beim Widerruf (§ 357a BGB) laufen **nicht** automatisch; die Mail kündigt eine getrennte Mitteilung an. Der Betreiber muss Beträge von Hand in Stripe erstatten.
- Aufbewahrung: `consents` und `contract_requests` hängen am Konto (`on delete cascade` bzw. `set null`); bei einer Kontolöschung verschwindet der Zustimmungsnachweis mit. Aufbewahrungsfrist gegen Art. 17 DSGVO abwägen.

## Zustimmung zum sofortigen Beginn

Zwei getrennte, nicht vorangekreuzte Kästchen in der Bestellübersicht (AGB / Widerrufsbelehrung / Datenschutz; sofortiger Beginn mit Wertersatz-Hinweis, Wortlaut `IMMEDIATE_START_CONSENT`). Der Server prüft vor der Stripe-Sitzung beide Kästchen und den **Hash des gezeigten Wortlauts**, schreibt Konto, Zeit, Wortlaut, Hash und Fassung in `consents` (Migration `0016_consents.sql`) und in die Metadaten der Stripe-Sitzung. Ohne Nachweis kein Checkout (Fail-closed, auch wenn die Migration fehlt). Die Bestellübersicht fragt das Kästchen für alle Tarife ab, auch Team (Unternehmer haben kein Widerrufsrecht – ob man sie trennen kann, ist offen).

## Button-Beschriftung bei Stripe

Der Button der Bestellübersicht heißt genau „Zahlungspflichtig bestellen“. Stripes eigener Button lässt sich in Checkout nicht auf diesen Wortlaut setzen (`submit_type: "pay"`, bei Testphase „Testversion starten“). Die App setzt deshalb `custom_text.submit` neben den Button („Mit dem Klick auf den Button gibst du eine zahlungspflichtige Bestellung ab …“). Ob das genügt, ist Anwaltsfrage 7.
