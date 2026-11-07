# Partnerlinks (Verbindungen)

Stand: 06.11.2026. Dieses Dokument beschreibt, **wie** Partnerlinks technisch eingebunden sind und worauf der Betreiber achten muss. Es ist
keine Rechtsberatung und behauptet keine Rechtskonformität – die Texte und Pflichten prüft der Betreiber (mit Jurist), siehe Launch-Plan E9.

## Was die App tut – und was nicht

- **Standardmäßig aus.** Ohne gesetzte Umgebungsvariable erscheint nirgends ein Partnerlink, der Dialog sieht aus wie ohne diese Funktion.
- **Der Betreiber trägt seinen eigenen, vollständigen Link ein.** Die App erfindet **keine** Kennungen, Provisionssätze oder Programme und baut keinen
  Link aus Bausteinen zusammen. Ob es ein Partnerprogramm von TradingView, Binance oder Bitunix gibt, welche Bedingungen es hat und ob es mit dem
  Produkt vereinbar ist, klärt der Betreiber selbst und schließt den Vertrag selbst.
- **Der Link wird unverändert verwendet.** Es wird nichts angehängt: keine Nutzer-ID, keine E-Mail-Adresse, kein Tarif, kein Zeitstempel. Es gibt
  keinen Zwischenserver, keine Weiterleitung über die App und kein Zählen der Klicks.
- **Gekennzeichnet.** Neben jedem Link steht sichtbar: „Partnerlink – wir erhalten ggf. eine Provision, für dich ändert sich nichts.“ Der Anker trägt
  `rel="sponsored noopener noreferrer"` und `target="_blank"` (kein Referrer, kein `window.opener`).
- **Nur im Verbindungs-Dialog**, unter „Noch kein Konto?“ – dort, wo jemand ohnehin ein Konto beim Anbieter braucht (TradingView-Assistent,
  Binance-Anleitung, Bitunix-Hinweis). Nicht auf der Übersicht, nicht im Cockpit, nicht in Meldungen.
- Ein Partnerlink beeinflusst **nie** eine Auswertung, einen Hinweis oder eine Reihenfolge.

## Einrichtung

Drei Variablen, jede ein vollständiger `https`-Link, wie ihn das Partnerprogramm ausgibt (siehe auch `docs/ENV.md`):

| Variable | Anbieter |
|---|---|
| `VITE_PARTNER_TRADINGVIEW_REF` | TradingView |
| `VITE_PARTNER_BINANCE_REF` | Binance (Spot und Futures) |
| `VITE_PARTNER_BITUNIX_REF` | Bitunix |

1. Partnerprogramm des Anbieters prüfen und beitreten (Betreiber, auf eigene Verantwortung).
2. Den ausgegebenen Link **unverändert** in Netlify unter *Site configuration → Environment variables* eintragen (Scope: Builds; `VITE_`-Werte werden
   beim Bauen in die Seite eingebaut und sind öffentlich sichtbar – das ist bei einem Werbelink gewollt, **keine Geheimnisse hier**).
3. Neu bauen (Deploy). Danach erscheint „Noch kein Konto?“ im jeweiligen Dialog.
4. Prüfen: Dialog öffnen, Kennzeichnung lesen, Link anklicken, auf dem Zielsystem ansehen, dass nichts über den Nutzer im Link steckt.

Ungültige Werte werden **ignoriert** (dann bleibt der Block weg): kein `https`, Zugangsdaten im Link (`https://nutzer:pw@…`), Leerzeichen, mehr als
500 Zeichen, ein Host ohne Punkt. Die App prüft nicht, ob der Link zum Anbieter gehört – das ist Sache des Betreibers.

Entfernen: Variable löschen, neu bauen.

## Kennzeichnungspflicht – Stichworte (keine Rechtsberatung)

Wer für einen Hinweis auf ein Angebot eine Gegenleistung erhält, macht in der Regel kommerzielle Kommunikation. Für den Betreiber relevant, zu prüfen:

- **UWG** (Gesetz gegen den unlauteren Wettbewerb): Werbung muss als solche erkennbar sein; verdeckte Werbung ist unzulässig. Stichworte: § 5a
  (Verschleiern des kommerziellen Zwecks), Anhang zu § 3 Abs. 3 (Nr. 11: redaktionell getarnte Werbung).
- **DDG** (Digitale-Dienste-Gesetz, löst das Telemediengesetz ab): Informationspflichten für digitale Dienste; kommerzielle Kommunikation muss klar als
  solche erkennbar sein, der Auftraggeber identifizierbar. Stichworte: Anbieterkennzeichnung (Impressum), Erkennbarkeit kommerzieller Kommunikation.
- **Finanzprodukte**: Börsen und Derivate sind erklärungsbedürftig; Werbung dafür unterliegt zusätzlichen Regeln (Stichworte: Risikohinweise,
  Marktmanipulation/Anlageempfehlung, je nach Land). Die App empfiehlt keine Börse und keine Produkte – der Link steht neben einer Anleitung, nicht in
  einer Empfehlung. Ob das für den Betreiber ausreicht, prüft der Betreiber.
- **Bedingungen des Partnerprogramms**: viele verbieten bestimmte Werbewege oder verlangen eigene Hinweise – dort nachlesen.
- **Steuern**: Provisionen sind Einnahmen des Betreibers.

## Datenschutz (Stichworte)

- Die App überträgt beim Anzeigen **nichts** an den Anbieter; erst der Klick des Nutzers öffnet dessen Seite (neuer Tab, ohne Referrer).
- Die App speichert nicht, ob oder welchen Link jemand angeklickt hat, und setzt dafür keine Cookies und kein Skript.
- Auf der Zielseite gelten Datenschutz und Cookies **des Anbieters**; das gehört in die Datenschutzerklärung des Betreibers (Verweis auf externe Links,
  Partnerprogramm).
- Die Provisionsabrechnung läuft beim Anbieter über dessen Kennung im Link; die App sieht davon nichts.
- Wer die Funktion einschaltet, ergänzt die Datenschutzerklärung und das Impressum um einen Hinweis auf Partnerlinks (`VITE_LEGAL_*`, siehe `SETUP.md`).

## Technik

`src/connect/partners.ts` (Konfiguration, Prüfung, Kennzeichnungstext), `src/connect/PartnerBox.tsx` (Darstellung),
Tests in `tests/unit/connect.state.test.ts` („partner links“) und `tests/unit/connect.ui.test.tsx` („partner box“).
