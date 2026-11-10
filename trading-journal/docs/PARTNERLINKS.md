# Partnerlinks (Verbindungen)

Stand: 07.11.2026. Dieses Dokument beschreibt, **wie** Partnerlinks technisch eingebunden sind und worauf der Betreiber achten muss. Es ist
keine Rechtsberatung und behauptet keine Rechtskonformität in irgendeinem Land – die Texte und Pflichten prüft der Betreiber (mit Jurist), siehe
Launch-Plan E9.

**Entscheidung des Betreibers (07.11.2026):** Partnerlinks bleiben **aus**, bis er eigene Partnerkonten und -Links hat (heute gibt es keine). Der Zielmarkt ist
**weltweit** – deshalb nennt weder die App noch der Hinweistext ein Land oder ein Gesetz.

## Was die App tut – und was nicht

- **Standardmäßig aus.** Ohne gesetzte Umgebungsvariable erscheint nirgends ein Partnerlink, der Dialog sieht aus wie ohne diese Funktion. Heute ist keine
  Variable gesetzt – es erscheint **kein** Partnerlink.
- **Der Betreiber trägt seinen eigenen, vollständigen Link ein.** Die App erfindet **keine** Kennungen, Provisionssätze oder Programme und baut keinen
  Link aus Bausteinen zusammen. Ob es ein Partnerprogramm von TradingView, Binance oder Bitunix gibt, welche Bedingungen es hat und ob es mit dem
  Produkt vereinbar ist, klärt der Betreiber selbst und schließt den Vertrag selbst.
- **Der Link wird unverändert verwendet.** Es wird nichts angehängt: keine Nutzer-ID, keine E-Mail-Adresse, kein Tarif, kein Zeitstempel, kein Land, keine
  Sprache. Es gibt keinen Zwischenserver, keine Weiterleitung über die App und kein Zählen der Klicks.
- **Gekennzeichnet, in einfachen Worten.** Neben jedem Link steht sichtbar: „Partnerlink – wir bekommen eventuell eine Provision, für dich ändert sich nichts.“
  Der Text ist **eine** Konstante (`PARTNER_NOTICE` in `src/connect/partners.ts`): keine Abkürzung, kein Rechtsbegriff, kein Land – er lässt sich an
  einer Stelle ändern oder übersetzen. Der Anker trägt `rel="sponsored noopener noreferrer"` und `target="_blank"` (kein Referrer, kein `window.opener`).
  Wenn ein Programm dem Nutzer einen eigenen Vorteil oder Preisnachlass gibt, stimmt „für dich ändert sich nichts“ nicht mehr – dann den Satz anpassen.
- **Nur im Verbindungs-Dialog**, unter „Noch kein Konto?“ – dort, wo jemand ohnehin ein Konto beim Anbieter braucht (TradingView-Assistent,
  Binance-Anleitung, Bitunix-Hinweis). Nicht auf der Übersicht, nicht im Cockpit, nicht in Meldungen.
- Ein Partnerlink beeinflusst **nie** eine Auswertung, einen Hinweis oder eine Reihenfolge.
- **Keine Ausspielung nach Land.** Alle Nutzer sehen denselben Link. Ob ein Anbieter in einem Land überhaupt angeboten werden darf (viele Börsen schließen
  Länder aus) und ob dort für ihn geworben werden darf, entscheidet der Betreiber – solange das offen ist, bleibt die Variable leer.

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

## Kennzeichnung – Stichworte je Zielmarkt (keine Rechtsberatung, ohne Gewähr, nicht vollständig)

Wer für einen Hinweis auf ein Angebot eine Gegenleistung erhält, macht in den meisten Ländern **kommerzielle Kommunikation**, die als solche erkennbar sein
muss. Die Regeln unterscheiden sich je Land; bei weltweitem Angebot gilt grundsätzlich, was am Ort der Nutzer gilt. Zum Nachschlagen und Prüfen lassen
(Beispiele, kein Anspruch auf Vollständigkeit oder Richtigkeit):

- **Deutschland:** UWG (Gesetz gegen den unlauteren Wettbewerb – Werbung muss erkennbar sein, keine verdeckte Werbung), DDG (Digitale-Dienste-Gesetz –
  Anbieterkennzeichnung, Erkennbarkeit kommerzieller Kommunikation).
- **EU:** Richtlinie über unlautere Geschäftspraktiken (2005/29/EG – u. a. getarnte Werbung), Regeln zur kommerziellen Kommunikation im
  E-Commerce, nationale Umsetzungen; für Krypto-Dienste zusätzlich die Marketing-Vorgaben der Krypto-Aufsicht (Stichwort MiCA) – je Land prüfen.
- **USA:** FTC „Endorsement Guides“ (Offenlegung materieller Verbindungen, z. B. Provisionen), dazu Regeln zu Finanz- und Krypto-Werbung.
- **Vereinigtes Königreich:** Werbe-Aufsicht (ASA/CAP-Code) und Verbraucherschutz (CMA) zu Affiliate-Hinweisen; Finanzwerbung für Kryptowerte unterliegt
  einem eigenen Regime der Finanzaufsicht (FCA).
- **Andere Märkte:** jeweils die Werbe-, Verbraucher- und Finanzmarktregeln des Landes; manche Länder verbieten Werbung für bestimmte Börsen oder
  Derivate ganz oder verlangen Lizenzen.
- **Finanzprodukte allgemein:** Börsen und Derivate sind erklärungsbedürftig; Stichworte: Risikohinweise, Anlageempfehlung vs. allgemeine Information.
  Die App empfiehlt keine Börse und keine Produkte – der Link steht neben einer Anleitung, nicht in einer Empfehlung. Ob das im jeweiligen Zielland genügt,
  prüft der Betreiber.
- **Bedingungen des Partnerprogramms:** viele verbieten bestimmte Werbewege, Länder oder Zielgruppen oder verlangen eigene Hinweise – dort nachlesen.
- **Steuern:** Provisionen sind Einnahmen des Betreibers.

## Datenschutz (Stichworte, ebenfalls je Zielmarkt zu prüfen)

- Die App überträgt beim Anzeigen **nichts** an den Anbieter; erst der Klick des Nutzers öffnet dessen Seite (neuer Tab, ohne Referrer).
- Die App speichert nicht, ob oder welchen Link jemand angeklickt hat, und setzt dafür keine Cookies und kein Skript.
- Auf der Zielseite gelten Datenschutz und Cookies **des Anbieters**; das gehört in die Datenschutzerklärung des Betreibers (Verweis auf externe Links,
  Partnerprogramm).
- Die Provisionsabrechnung läuft beim Anbieter über dessen Kennung im Link; die App sieht davon nichts.
- Wer die Funktion einschaltet, ergänzt die Datenschutzerklärung und das Impressum um einen Hinweis auf Partnerlinks (`VITE_LEGAL_*`, siehe `SETUP.md`).

## Technik

`src/connect/partners.ts` (Konfiguration, Prüfung, Kennzeichnungstext), `src/connect/PartnerBox.tsx` (Darstellung),
Tests in `tests/unit/connect.state.test.ts` („partner links“) und `tests/unit/connect.ui.test.tsx` („partner box“).
