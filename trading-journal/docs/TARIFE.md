# Tarifvertrag: wer bekommt was (A1)

Stand: 07.11.2026. **Status: Vorschlag, vom Betreiber freizugeben (Entscheidung E8 im [Launch-Plan](LAUNCH-PLAN.md)).**
Preise und Tarifnamen sind unverändert. Neu sind die Kontingente (Zeilen mit „Vorschlag“ in der Spalte „Herkunft der Zahl“) und die
Zuordnung aller 74 Funktionen zu einem Tarif. Nichts davon ist beschlossen, bis der Betreiber es sagt; ändern heißt eine Zahl in
`src/billing/plans.ts` ändern – danach sagt der Test `tests/unit/billing.tarife.doc.test.ts`, welche Zeilen dieses Dokuments nicht mehr stimmen
(`TARIFE_WRITE=1 npx vitest run tests/unit/billing.tarife.doc.test.ts` schreibt die Tabellen neu).

## Eine Quelle

| Was | Wo | Wer liest es |
|---|---|---|
| Welcher Tarif welche Funktion hat (`PLAN_FEATURES`), wie viel (`PLAN_LIMITS`), Preise (`LIST_PRICES`) | `src/billing/plans.ts` (rein, ohne Browser-Abhängigkeit) | Preisseite, Konto, Sperren im Browser (`useEntitlement`, `useLimit`, `<Gate>`), Server (`requireFeature`, `requireLimit`, `requireExchangeAccess`, `requireAutoSync` in `netlify/functions/_lib/plan.ts`), Cron (`exchange-sync-cron`), Alarm-Cron |
| Welche der 74 Funktionen was braucht (`core` = Kern, `extras` = Teile aus höheren Tarifen, `limits` = Kontingente) | `src/billing/tariff.ts` | Funktionen-Seite, dieses Dokument, Test |
| Welche Stelle der App wirklich gesperrt ist | `gate` / `limit` je Zeile im Funktionsregister `src/app/features.ts` | Funktionen-Seite („Ab Pro“, „nicht in deinem Tarif“) |

Der Test `tests/unit/billing.tariff.test.ts` hält die drei zusammen: jede F-ID hat eine Zeile, das Register stimmt mit `core` / `extras`
überein, und für jeden Tarif liefern Server und Browser für jede Funktion und jedes Kontingent dieselbe Antwort.
Die Tarife werden **nie im Browser entschieden**: der Server liest den Tarif aus `profiles.plan` (nur der Stripe-Webhook schreibt dort),
der Browser spiegelt ihn. Solange Zahlungen nicht eingerichtet sind, ist nichts gesperrt (Server und Browser).

## Was neu ist gegenüber dem Stand davor

- **Free** hat jetzt **eine lesende Börsenverbindung** (Bitunix, nur Lesen) mit **Abgleich von Hand**. Vorher hatte Free keine. Der automatische
  Abgleich im Hintergrund (Cron, Schalter „Auto-Sync“) beginnt mit **Pro**; der Server lehnt das Einschalten in Free mit „Tarif nicht enthalten“ ab,
  und der Cron überspringt Verbindungen ohne Tarif für den Hintergrund-Abgleich.
- **Free** hat **eine TradingView-Verbindung** als Kontingent – die Verbindung selbst gibt es noch nicht (Paket B3), darum steht das Kontingent
  nicht auf der Preisseite.
- Neue Kontingente: Hintergrund-Abgleich, TradingView-Verbindungen, Alarm-Kanäle, Telefon-Anrufe pro Monat, Simulationen pro Tag. Die
  Screenshot-Import-Grenze in Premium und Team sinkt von 30 auf 20 pro Tag (Vorschlag).
- **Geplant** heißt: im Vertrag festgelegt, aber die Funktion dahinter ist noch nicht gebaut. Solche Kontingente werden **nirgends** als Versprechen
  gezeigt (nicht auf der Preisseite, nicht im Konto). Sie werden sichtbar, sobald das Paket sie durchsetzt (`LIMIT_INFO[...].state` auf `live`).
- Die Vergleichsmatrix auf der Preisseite ist nach **Nutzerzielen** gruppiert (dieselben Namen wie die Kacheln der Seite „Funktionen“) und klappbar.

<!-- tarife:start (erzeugt aus src/billing/plans.ts und tariff.ts – nicht von Hand ändern) -->

### Preise (unverändert)

| Tarif | Monat | Jahr |
|---|---|---|
| Free | 0 € | 0 € |
| Pro | 12 € | 120 € |
| Premium | 24 € | 240 € |
| Team (je Sitz, mindestens 2 Sitze) | 19 € | 190 € |

### Funktionen je Tarif (nach Nutzerziel)

| Nutzerziel | Funktion | Free | Pro | Premium | Team |
|---|---|---|---|---|---|
| Trade prüfen & Chart | Box-Scanner | – | ja | ja | ja |
| Aktien beobachten & bewerten | Aktien-Analyse | – | ja | ja | ja |
| Risiko & Disziplin | Monte Carlo & Ruin-Risiko | – | ja | ja | ja |
| Risiko & Disziplin | Live-Risiko | – | ja | ja | ja |
| Strategie entwickeln & testen | Backtest-Labor | – | – | ja | ja |
| Aus Fehlern lernen | Coach | – | ja | ja | ja |
| Aus Fehlern lernen | KI-Coach | – | – | ja | ja |
| Aus Fehlern lernen | Trade-Replay | – | ja | ja | ja |
| Auswerten & Berichte | Profi-Statistik | – | ja | ja | ja |
| Auswerten & Berichte | Berichte | – | ja | ja | ja |
| Auswerten & Berichte | PDF-Export | – | – | ja | ja |
| Üben & Wachsen | Ziele & Gewohnheiten | – | ja | ja | ja |
| Trades eintragen & Daten | Cloud-Sync | ja | ja | ja | ja |
| Trades eintragen & Daten | Screenshots in der Cloud | – | ja | ja | ja |
| Trades eintragen & Daten | Automatischer Börsen-Sync | – | ja | ja | ja |
| Trades eintragen & Daten | CSV-Import | ja | ja | ja | ja |
| Trades eintragen & Daten | API & Webhooks | – | – | ja | ja |
| Trades eintragen & Daten | Screenshot-Import | – | – | ja | ja |
| Community & Teilen | Community | ja | ja | ja | ja |
| Community & Teilen | Mentor-Modus | – | – | ja | ja |
| Konto, Einstellungen & Hilfe | Eigene Dashboards | – | – | ja | ja |

### Kontingente (Team je Sitz)

| Kontingent | Free | Pro | Premium | Team | Zustand | Durchgesetzt durch | Herkunft der Zahl |
|---|---|---|---|---|---|---|---|
| Börsen-Verbindungen | 1 | 1 | 5 | 5 | gebaut | Server: exchange-connect (requireLimit) | Free = Vorgabe des Betreibers (1, lesend, von Hand); Pro / Premium / Team = Vorschlag (5 ab Premium) |
| Automatischer Abgleich im Hintergrund | – | 1 | 5 | 5 | gebaut | Server: exchange-sync-cron (Tarif-Prüfung je Verbindung) | Vorschlag (folgt aus: Auto-Sync ab Pro, so viele wie Verbindungen) |
| TradingView-Verbindungen | 1 | 1 | 5 | 5 | geplant – nicht auf der Preisseite | Paket B3 (TradingView-Verbindung) | Free = Vorgabe des Betreibers (1); Pro / Premium / Team = Vorschlag, nicht abgesprochen |
| Alarm-Kanäle | 1 | 2 | 3 | 3 | geplant – nicht auf der Preisseite | Paket C2 (vier Alarme und Zustellung) | Vorschlag (Browser; plus E-Mail ab Pro; plus Telefon ab Premium) |
| Telefon-Anrufe pro Monat | – | – | 30 | 60 | geplant – nicht auf der Preisseite | Paket C2 (Telefonie) | Vorschlag (0 / 0 / 30 / 60) |
| Screenshot-Speicher | – | 2 GB | 20 GB | 20 GB | gebaut | Datenbank: Speicher-Richtlinien des Buckets screenshots | bestehend (unverändert) |
| Screenshot-Import pro Tag | – | – | 20 | 20 | gebaut | Server: shot-extract (Tageszähler) | Vorschlag (0 / 0 / 20 / 20; bisher 30 in Premium) |
| KI-Coach pro Tag | – | – | 50 | 50 | gebaut | Server: coach-ask, assistant-route, strategy-compile (Tageszähler) | bestehend (0 / 0 / 50 / 50) |
| Simulationen pro Tag | 20 | 200 | ∞ | ∞ | geplant – nicht auf der Preisseite | Paket A3 (Zeitmaschine persistent) | Vorschlag (20 / 200 / ∞ / ∞) |
| Gespeicherte Ansichten | 3 | 25 | ∞ | ∞ | gebaut | Browser: Ansichtenleiste (useLimit) | bestehend (unverändert) |
| Dashboards | 1 | 3 | ∞ | ∞ | gebaut | Browser: Cockpit (useLimit) | bestehend (unverändert) |
| Gruppen | 1 | 3 | 10 | ∞ | gebaut | Server: social-groups (requireLimit) | bestehend (unverändert) |

### Die 74 Funktionen

„Ab“ = der Tarif, ab dem die Funktion in ihrem Kern nutzbar ist; „vollständig ab“ = ab dem auch ihre Teile aus höheren Tarifen dabei sind. Die Kontingente begrenzen die Menge, nicht den Zugang.

**Heute vorbereiten**

| F-ID | Funktion | Ab | Vollständig ab | Free | Pro | Premium | Team | Kontingente |
|---|---|---|---|---|---|---|---|---|
| F01 | Persönliche Marktampel | Free | Free | voll | voll | voll | voll | – |
| F08 | Dynamischer Tages- und Szenarioplan | Free | Free | voll | voll | voll | voll | – |
| F09 | Eigene Schlüsselmarken | Free | Free | voll | voll | voll | voll | – |
| F21 | Überwachung bei geschlossenem Browser | Pro | Pro | – | voll | voll | voll | Alarm-Kanäle, Telefon-Anrufe pro Monat |
| F22 | Mehrstufige, ruhige Alarme | Free | Free | voll | voll | voll | voll | Alarm-Kanäle, Telefon-Anrufe pro Monat |
| F27 | Daten- und Alarmqualität | Free | Pro | Kern | voll | voll | voll | Alarm-Kanäle |
| F36 | Verhaltensmuster und freiwillige Pausen | Pro | Pro | – | voll | voll | voll | – |
| F43 | Ereigniskalender und Strategiefilter | Free | Free | voll | voll | voll | voll | – |
| F61 | Täglicher Check-in beim ersten Öffnen | Pro | Pro | – | voll | voll | voll | – |

**Trade prüfen & Chart**

| F-ID | Funktion | Ab | Vollständig ab | Free | Pro | Premium | Team | Kontingente |
|---|---|---|---|---|---|---|---|---|
| F02 | Chancenmonitor | Free | Pro | Kern | voll | voll | voll | – |
| F03 | Erweiterte Top-Trader-Auswertung | Free | Free | voll | voll | voll | voll | – |
| F04 | Box-zu-Box und relevante Zonen | Free | Free | voll | voll | voll | voll | – |
| F05 | Preis- und RSI-Struktur über Zeiteinheiten | Free | Free | voll | voll | voll | voll | – |
| F06 | Zusätzliche Strategiebausteine | Free | Premium | Kern | Kern | voll | voll | – |
| F07 | Fehlausbruchs- und Squeeze-Monitor | Free | Free | voll | voll | voll | voll | – |
| F10 | Warum handeln oder auslassen? | Free | Free | voll | voll | voll | voll | – |
| F19 | Historisch ähnliche Situationen | Free | Free | voll | voll | voll | voll | – |
| F39 | Positionsgrößenrechner | Free | Pro | Kern | voll | voll | voll | – |
| F62 | Chart umdrehen und den eigenen Bias prüfen | Free | Free | voll | voll | voll | voll | – |
| F63 | Visuelles Labor und Zeichenwerkzeuge | Free | Free | voll | voll | voll | voll | – |

**Aktien beobachten & bewerten**

| F-ID | Funktion | Ab | Vollständig ab | Free | Pro | Premium | Team | Kontingente |
|---|---|---|---|---|---|---|---|---|
| F67 | Intelligenter Branchen- und Vergleichsscreener | Free | Pro | Kern | voll | voll | voll | – |
| F68 | Zahlen-, Erwartungs- und Ereignismonitor | Free | Pro | Kern | voll | voll | voll | – |
| F69 | Langfristige Investmentanalyse und Kaufthese | Free | Free | voll | voll | voll | voll | – |

**Trade planen**

| F-ID | Funktion | Ab | Vollständig ab | Free | Pro | Premium | Team | Kontingente |
|---|---|---|---|---|---|---|---|---|
| F20 | Kosten- und Belastungstest | Pro | Premium | – | Kern | voll | voll | Simulationen pro Tag |
| F41 | Persönliche Verlustlimits | Free | Pro | Kern | voll | voll | voll | – |
| F44 | Praktische Ausführbarkeit | Free | Free | voll | voll | voll | voll | – |
| F65 | Break-even, Stop-Nachziehen und flexible Ausstiege | Free | Premium | Kern | Kern | voll | voll | – |

**Risiko & Disziplin**

| F-ID | Funktion | Ab | Vollständig ab | Free | Pro | Premium | Team | Kontingente |
|---|---|---|---|---|---|---|---|---|
| F40 | Gesamtrisiko und Abhängigkeiten | Pro | Pro | – | voll | voll | voll | – |
| F42 | Margin-, Funding- und Kontraktdetails | Free | Pro | Kern | voll | voll | voll | Börsen-Verbindungen |

**Strategie entwickeln & testen**

| F-ID | Funktion | Ab | Vollständig ab | Free | Pro | Premium | Team | Kontingente |
|---|---|---|---|---|---|---|---|---|
| F11 | Persönlicher Regelbaukasten | Premium | Premium | – | – | voll | voll | – |
| F12 | „Diese Idee testen“ | Premium | Premium | – | – | voll | voll | – |
| F13 | Creator- und Strategieimport | Premium | Premium | – | – | voll | voll | – |
| F14 | TradingView-/Pine-Zugangswege | Premium | Premium | – | – | voll | voll | TradingView-Verbindungen |
| F15 | Versionen und persönliche Vorlagen | Free | Premium | Kern | Kern | voll | voll | – |
| F16 | Vollständiger Backtest | Premium | Premium | – | – | voll | voll | – |
| F17 | Varianten- und Filtervergleich | Premium | Premium | – | – | voll | voll | – |
| F18 | Strategie-Prüfbericht | Premium | Premium | – | – | voll | voll | – |
| F23 | Virtuelles Konto je Strategie | Premium | Premium | – | – | voll | voll | – |
| F45 | Creator-Playbooks | Free | Premium | Kern | Kern | voll | voll | – |
| F49 | Strategie passt zu mir? | Premium | Premium | – | – | voll | voll | – |
| F64 | TradingView-, Pine- und Indikator-Adapter | Premium | Premium | – | – | voll | voll | – |
| F66 | Hintergrund-KI-Forschung | Premium | Premium | – | – | voll | voll | – |
| F73 | Frei gestaltbares Strategielabor mit Ergebnisdiagnose | Premium | Premium | – | – | voll | voll | – |

**Aus Fehlern lernen**

| F-ID | Funktion | Ab | Vollständig ab | Free | Pro | Premium | Team | Kontingente |
|---|---|---|---|---|---|---|---|---|
| F25 | Vollständige Signalbilanz | Pro | Pro | – | voll | voll | voll | – |
| F28 | Persönlicher Signal-Posteingang | Pro | Premium | – | Kern | voll | voll | TradingView-Verbindungen |
| F31 | Zustandsaufnahme vor der Entscheidung | Free | Free | voll | voll | voll | voll | – |
| F32 | Verpasste Chancen und gemeinsame Vorzeichen | Pro | Premium | – | Kern | voll | voll | – |
| F33 | Rückblick und Alternativsimulation | Pro | Pro | – | voll | voll | voll | Simulationen pro Tag |
| F35 | Fehlerkosten und Ausführungsunterschiede | Pro | Pro | – | voll | voll | voll | – |
| F37 | Wochenreview und Wochenexperiment | Pro | Pro | – | voll | voll | voll | – |

**Auswerten & Berichte**

| F-ID | Funktion | Ab | Vollständig ab | Free | Pro | Premium | Team | Kontingente |
|---|---|---|---|---|---|---|---|---|
| F24 | Mensch-Regelwerk-KI-Vergleich | Pro | Pro | – | voll | voll | voll | – |
| F34 | Persönliche Signalfilter | Free | Pro | Kern | voll | voll | voll | Gespeicherte Ansichten |
| F54 | Berichte und Datenexport | Pro | Pro | – | voll | voll | voll | – |
| F60 | Persönlicher Monatsnutzen | Pro | Pro | – | voll | voll | voll | – |
| F70 | Kryptobuchhaltung und Transaktionsbuch | Pro | Pro | – | voll | voll | voll | – |

**Üben & Wachsen**

| F-ID | Funktion | Ab | Vollständig ab | Free | Pro | Premium | Team | Kontingente |
|---|---|---|---|---|---|---|---|---|
| F38 | Lernmodus und Replay-Training | Pro | Pro | – | voll | voll | voll | – |

**Trades eintragen & Daten**

| F-ID | Funktion | Ab | Vollständig ab | Free | Pro | Premium | Team | Kontingente |
|---|---|---|---|---|---|---|---|---|
| F26 | Historisches Datenarchiv | Free | Free | voll | voll | voll | voll | – |
| F29 | Automatischer Screenshot-Import | Free | Premium | Kern | Kern | voll | voll | Screenshot-Import pro Tag, Screenshot-Speicher |
| F30 | Börsen-/CSV-Import und Fills | Free | Premium | Kern | Kern | voll | voll | Screenshot-Import pro Tag, Börsen-Verbindungen, Automatischer Abgleich im Hintergrund |
| F53 | Backups und Wiederherstellung | Free | Free | voll | voll | voll | voll | – |
| F56 | Zuverlässige Integrationen | Pro | Pro | – | voll | voll | voll | Börsen-Verbindungen, Automatischer Abgleich im Hintergrund |

**Community & Teilen**

| F-ID | Funktion | Ab | Vollständig ab | Free | Pro | Premium | Team | Kontingente |
|---|---|---|---|---|---|---|---|---|
| F46 | Mentor- und Teammodus | Premium | Premium | – | – | voll | voll | Gruppen |
| F47 | Gemeinsame Chartfälle und Replays | Free | Free | voll | voll | voll | voll | – |
| F50 | Nachvollziehbare Community-Ergebnisse | Free | Free | voll | voll | voll | voll | – |
| F57 | Öffentliche Ergebnisbelege | Free | Free | voll | voll | voll | voll | – |
| F71 | Weltweite Ranglisten mit aussagekräftiger Performance | Free | Free | voll | voll | voll | voll | – |
| F72 | Kontakte, Teilen, Gruppen und Zusammenarbeit | Free | Free | voll | voll | voll | voll | Gruppen |

**Konto, Einstellungen & Hilfe**

| F-ID | Funktion | Ab | Vollständig ab | Free | Pro | Premium | Team | Kontingente |
|---|---|---|---|---|---|---|---|---|
| F48 | Kontextbezogene Lerninhalte | Free | Free | voll | voll | voll | voll | – |
| F51 | Konto, Cloud und Gerätewechsel | Free | Free | voll | voll | voll | voll | – |
| F52 | Abo und Nutzungskontingente | Free | Free | voll | voll | voll | voll | – |
| F55 | Klare mobile Oberfläche | Free | Free | voll | voll | voll | voll | – |
| F58 | Interaktive Produktdemo | Free | Free | voll | voll | voll | voll | – |
| F59 | Creator-Kooperation und Vertrieb | Free | Free | voll | voll | voll | voll | – |
| F74 | KI-Assistent mit Kontext, Mikrofon und Aktionen | Free | Free | voll | voll | voll | voll | KI-Coach pro Tag |

<!-- tarife:end -->

## Offene Fragen an den Betreiber

1. **Zahlen freigeben:** stimmen die Vorschläge (Tabelle „Kontingente“, Spalte „Herkunft der Zahl“ = Vorschlag)? Besonders: Telefonie 30 / 60 pro Monat,
   Simulationen 20 / 200 / ∞ pro Tag, Alarm-Kanäle 1 / 2 / 3, TradingView-Verbindungen in Pro und höher (hier: 1 / 5 / 5 – nicht abgesprochen).
2. **Free mit Börsenverbindung:** gewollt ist „1 lesend, von Hand“ – soll ein Free-Nutzer, der auf Pro wechselt, seine Verbindung behalten (ja, so gebaut)?
   Und was passiert beim Wechsel von Premium (5 Verbindungen) auf Free: die zusätzlichen Verbindungen bleiben im Moment bestehen und sind nutzbar,
   nur neue lassen sich nicht anlegen. Eine Regel „überzählige pausieren“ ist **nicht** gebaut.
3. **Was in Free bleibt:** die Zuordnung der 74 Funktionen folgt dem, was der Code heute sperrt; wer etwas aus Pro nach Free holen oder umgekehrt
   will, sagt es – die Änderung ist eine Zeile in `plans.ts` plus das `gate` im Register.
4. **Team:** Kontingente gelten je Sitz (wie bisher).

## Was dieses Dokument nicht ist

Kein Beschluss und keine Rechtsaussage. Preise, Verlängerung, Widerruf und Steuerdarstellung sind Sache der Rechtstexte (E9) und der Kaufstrecke (Paket B4,
noch nicht gebaut). Die Kaufstrecke selbst gehört nicht zu diesem Paket.
