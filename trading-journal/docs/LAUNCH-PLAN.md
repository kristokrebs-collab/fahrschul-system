# Launch-Plan: vom Prüfstand (Preview 6) zum startfähigen Produkt

Stand: 03.11.2026, Basis-Commit `6dc77c4` (PR #6, CI grün). Dieses Dokument ist ein **Plan**, kein Nachweis: nichts darin ist
umgesetzt, solange es nicht in `docs/COVERAGE.md`, `docs/ANIMATIONEN-MATRIX.md` oder einem Abnahmeprotokoll steht.
Quelle der Anforderungen: Master-Prompt (177 UI-/Motion-Punkte), Nachtrag nach Preview 6 (01.11.), Startfähig-Auftrag
(02.11., 40 Abnahmetests), 74-Funktionen-UX-Auftrag (02.11.) und der Zusatzauftrag Kaufstrecke/Tarife/Motion (03.11.).
Bei Widersprüchen gilt die jüngste konkrete Nutzerentscheidung.

## 0. Ehrlicher Ausgangsstand (im Code geprüft, nicht live)

| Bereich | Ist | Lücke zur Startfähigkeit |
| --- | --- | --- |
| Konto / Auth | Supabase-Client, Registrierung, Login, OTP, Passwort-Reset, 2FA (aal2), Migrationen 0001–0010, RLS in den Migrationen | Kein Produktionsprojekt eingerichtet, keine produktive E-Mail-Zustellung, Zwei-Nutzer-Isolation nur per Mock getestet, lokale Datenübernahme beim ersten Login nicht als Auswahl-Dialog |
| Tarife / Billing | Zentraler Katalog `src/billing/plans.ts` (Preise 0/12/24/19 €, Limits), Stripe Checkout/Portal/Webhook-Funktionen mit Idempotenz (`stripe_events`), Preisseite mit Vergleich, Konto-Seite | Kein Stripe-Konto/Price-IDs, keine Bestellübersicht vor dem Checkout, keine Rückführung zur Bestellung nach Login, keine Tarif-Motion-Profile, Free hat 0 Börsenverbindungen (muss 1 lesende werden) |
| Börsen | Bitunix lesend (verschlüsselter Key, Sync-Cron) | **Kein Binance-Konto-Connector** (nur öffentliche Marktdaten). Binance Fast API braucht Betreiberfreigabe; API-Key-Weg ist zu bauen |
| TradingView | Webhook `action: open/close` (Journal-Import, braucht Größe), Pine-Export, Branchen-JSON `branchen-trend/1` | Kein pro-Nutzer-MCP/OAuth-Client, kein Signal-Empfänger ohne Ordergröße, Branchen-JSON inkompatibel mit dem Webhook, kein Assistent „Alarm einrichten → Testsignal → Empfang“ |
| Alarme | E-Mail-Alarm (Resend, Cron) für Schlüsselmarken, Browser-Benachrichtigungen | Keine vier Ereignisse Grün/Rot-Vorwarnung/-Bestätigung, keine Telefonie, Hintergrundjobs nur Cron-Funktionen |
| Zeitmaschine / Simulation | 10.000 Sitzungen mit Seed, Fächer als SVG mit ≤ 36 Beispielpfaden; Journal-Monte-Carlo 2.000 Läufe, 120 Linien auf Canvas | Kein 10.000-Linien-Canvas-Modus, Ergebnis nicht mit `simulation_id`/Daten-Hash/Trade-Verknüpfung persistiert |
| Branchen-Trend | 48 Branchen, Megatest-Import, Pine, Papier-Protokoll (nur Protokoll) | Keine Brücke Signal → Paper-Position; Rot = Cash ist nicht als Regel verdrahtet |
| Screenshots | Editor mit bis zu 12 Bildern, IndexedDB, Cloud-Bucket `screenshots` vorbereitet | Import verkleinert auf ≤ 2.000 px / WebP 0,86 → **nicht bytegleich**; kein Hash; Backup ohne Bildbytes |
| Motion / UI | Runde 9/10 (Sidebar, Dock, `data-rich`, Buttons mit Zuständen, Wal-Karte, Matrix 177) | Sidebar ab 1.624 px automatisch offen (soll kompakt bleiben); SVG-Sequenz überlappt (640 ms / 46 ms) statt strikt nacheinander; keine Welle der Menüzeilen; Radial Share, Papierkorb-Animation, Speicher-Morph, Login/Signup-Morph fehlen; keine Tarif-Profile; keine Motion-Einstellung |
| Suche | Funktionsfinder mit Ankern, Synonymen, 179 Einträgen | Findet Funktionen, keine Seiten („Einstellungen“ → „Box-Einstellungen“); bei verdecktem Ziel nur Hinweis; keine Clay-Optik |
| Budget | Erstlade-JS 788,7 / 800 KiB, CSS 49,2 / 52 KiB | Nur ~11 KiB Reserve: neue Teile zwingend als Lazy-Chunks, ggf. Editor aus dem Haupt-Chunk lösen |
| F55 | COVERAGE: „Klare mobile Oberfläche“, teilweise | Der Auftrag nennt F55 als unzugeordnet – die Zuordnung existiert in `docs/COVERAGE.md`; im Register fehlt ein Eintrag mit `fids: ["F55"]` |

## 1. Vom Nutzer zu entscheiden oder bereitzustellen (gebündelt, vor dem Bau)

Ohne diese Punkte bleiben die betroffenen Pakete technisch blockiert; alle unabhängigen Arbeiten laufen trotzdem.

| Nr | Was | Wofür | Art |
| --- | --- | --- | --- |
| E1 | Supabase-Produktionsprojekt (URL, Publishable Key, Service Role als Netlify-Secret), SMTP/E-Mail-Absender, Redirect-Domain | Konto, Isolation, Screenshots, Jobs | Zugang |
| E2 | Stripe-Konto (Test + Live), Produkte/Preise für Pro/Premium/Team Monat/Jahr, Webhook-Secret, Kundenportal-Konfiguration, Steuer-Einstellung (Brutto/Netto, Stripe Tax ja/nein) | Kaufstrecke | Zugang + Entscheidung |
| E3 | Binance: Antrag auf Fast API/Link-Freigabe stellen (dauert, ungewiss) – bis dahin API-Key-Weg | Binance-Verbindung | Entscheidung: API-Key-Weg jetzt bauen, Fast API später? |
| E4 | TradingView: Konto ab Essential für OAuth/MCP, Klärung der kommerziellen Nutzung; Client-Registrierung beim offiziellen MCP | TV-Verbindung | Zugang + rechtliche Klärung |
| E5 | Resend (vorhanden?) für Transaktions-E-Mails; Twilio-Konto + verifizierte Nummer für Testanruf | Alarme, Telefonie | Zugang |
| E6 | Domain/DNS/TLS für die Produktion, Netlify-Site-Einstellungen (Drawer aus) | Betrieb | Zugang |
| E7 | BrowserStack-Zugang oder echtes Android-Gerät/Tablet mit Testkonto | Geräteabnahme | Zugang |
| E8 | Tarif-Inhalte: Free bekommt 1 lesende Binance- + 1 TV-Verbindung (Vorgabe); Kontingente für KI-Coach/Tag, Screenshot-Import/Tag, Simulationen/Tag, Telefonie/Monat je Tarif | Tarifvertrag | Entscheidung (Vorschlag in §3.1) |
| E9 | Rechtstexte (Impressum, Datenschutz, AGB, Widerruf, Preisangaben) prüfen lassen | Kauf | Betreiber/Jurist |
| E10 | Produktname/Marke und Logo als SVG-Pfad (heute ₿-Zeichen) | Logo-Zeichnen | Entscheidung |

## 2. Leitplanken (gelten für jedes Paket)

- Übersicht (Startseite) und Cockpit bleiben in Aufbau, Karten, Kennzahlen pixelgleich; Nachweis per Pixelvergleich je Paket.
- „Trade eintragen“ und sein Formular-/Animationsablauf bleiben; nur echte Defekte werden repariert.
- Erst vorhandene Lösung (App, `src/motion`, Skills, 21st.dev/Magic UI/Aceternity/Uiverse) prüfen, Quelle + Lizenz notieren, dann im eigenen Token-System nachbauen. Matrix `Komponente | Pfad/URL | Lizenz | übernommen | Anpassung | Einbauort | Zustände | Nachweis` wird gepflegt (`docs/KOMPONENTEN-QUELLEN.md`, neu).
- Serverseitige Rechte sind maßgeblich; eine Animation bestätigt nie einen Zustand (Zahlung, Speicherung, Verbindung).
- Keine neuen npm-Abhängigkeiten ohne Begründung; Erstlade-JS ≤ 800 KiB, CSS ≤ 52 KiB; neue Bereiche lazy.
- Reduced Motion = sofort fertig; Touch ≥ 44 px; CLS ≤ 0,02; Long Tasks durch Neues ≤ 50 ms (auf ruhiger Maschine messen, nicht unter Agentenlast).
- Jede Funktion: Aufgabe · Nutzen · Start · Voraussetzungen · minimale Eingaben · Ergebnis · nächster Schritt · Zustände (der 8-Punkte-Vertrag aus dem 74-Auftrag).
- Ehrlichkeit: Simulation ≠ Prognose, Top-Trader ≠ Wale, Spot ≠ Futures, Demo ≠ Produktion, „geplant“ ≠ „getestet“.

## 3. Arbeitspakete

Reihenfolge: P0 (Konto, Isolation, Verbindungen, Speicherung) vor P1 (Kauf, Ketten) vor P2 (Feinschliff). Innerhalb einer Welle
laufen die Pakete parallel in Worktrees; Merge und Gesamtprüfung durch den Hauptagenten wie in Runde 9/10.

### Welle A – Fundament (keine Betreiberzugänge nötig, sofort möglich)

**A1 Zentraler Tarifvertrag** (`src/billing/plans.ts`, `netlify/functions/_lib/plan.ts`, `docs/TARIFE.md` neu)
- Free: `exchangeConnections: 1` (lesend, manueller Sync), `tvConnections: 1`; Hintergrund-Sync, zusätzliche Verbindungen, Alarmkanäle, KI, Telefonie, Simulations-Kontingente je Tarif als neue `LimitKey`s. Vorschlag (zur Freigabe E8): Pro 1 Börse + Auto-Sync, Premium 5, Team 5/Sitz; KI-Coach 0/0/50/50 pro Tag (bestehend); Screenshot-Import 0/0/20/20; Simulationen 20/200/∞/∞ pro Tag; Telefonie 0/0/30/60 Anrufe pro Monat.
- Alle 74 Funktionen bekommen ihre Tarifzuordnung (`feature`/`limit` im Register `src/app/features.ts`), die Vergleichsmatrix wird nach Nutzerzielen gruppiert und klappbar.
- Nachweis: Unit-Test „jede F-ID hat Tarif“; Preisseite, Konto, Server-`requireFeature` und Cron lesen dieselbe Quelle.

**A2 Screenshot-Originale** (`src/journal/screenshots`, Bucket `screenshots`, Backup)
- Original bytegleich speichern (IndexedDB-Blob + Cloud-Upload), Vorschau getrennt ableiten; Felder `hash (SHA-256)`, `mime`, `originalName`, `bytes`, `storage: device|cloud|ram`; RAM-Fallback wird als „nicht gespeichert“ gemeldet; Speicher voll → Abbruch mit Alternative.
- Backup/Restore inkl. Bildbytes (ZIP mit Manifest); Export-Funktion listet Hashes.
- Nachweis: Hash vor/nach Upload gleich; Reload, Neustart; Restore in frischem Profil; fehlgeschlagener Upload.

**A3 Zeitmaschine persistent + 10.000-Linien-Canvas** (`src/domain/timemachine`, `src/views/timemachine`)
- `simulation_id`, Seed, Modellversion, Daten-Hash/-Stand, Kostenannahmen, Plan/Größe, Kennzahlen, `tradeId` in IndexedDB (Cloud-Tabelle `simulations` in Migration 0011 vorbereiten).
- Canvas-Modus „alle 10.000 Pfade“ (Alpha, additiv, gebündelte Drawcalls, OffscreenCanvas wo verfügbar) mit beschriftetem Stichprobenmodus für schwache Geräte; berechnete und gezeichnete Zahl getrennt im Titel.
- Modellumfang ehrlich auflisten (Spread/Liquidität/Regime fehlen → im Text, nicht behaupten).
- Nachweis: Reload/Neustart liefert dieselbe Simulation zum Trade; Frame-Zeit auf CPU-Drosselung ×4 dokumentiert.

**A4 Suche bis zur Aufgabe** (`src/app/featureOpen.ts`, `NavFinder*`, `CommandNav`)
- Seiten als Treffer (Alias „Einstellungen“ → Seite), Alltagssprache-Synonyme je F-ID, bei verdecktem Ziel: Akkordeon/Fold/Tab aktiv öffnen, Fokus setzen; Rückführung nach Login/Tarif/Verbindung zur ursprünglichen Aufgabe (`returnTo` im Router).
- Nachweis: `funktionsfinder.spec` erweitert um 20 Alltagsfragen; kein Treffer endet in einem Toast.

**A5 Motion-Grundsystem** (`src/motion`, `src/app/Sidebar.tsx`, `shellFx.ts`, Settings)
- SVG-Sequenz strikt nacheinander (Logo 1 fertig → Logo 2 …), Gesamtdauer ≤ 1,2 s, einmal je Sitzung, Replay-Knopf in Einstellungen › Darstellung.
- Menüzeilen-Welle von oben nach unten (45–60 ms Delay, 260–340 ms, 8–12 px, Opacity) einmal beim ersten Aufbau; getaktet mit der SVG-Sequenz.
- Sidebar standardmäßig kompakt auf allen Desktop-Breiten, „Anheften“ als Nutzerwahl (bestehender `sidebar: auto|open|closed`).
- Nutzer-Einstellung Bewegung: system / reduziert / volles Profil (neuer Settings-Key, versioniert); Tarif-Profile Free/Pro/Premium/Team als Token-Sets (`data-motion-tier`), vom serverseitig bestätigten Plan gesetzt, nie vom Browser-Flag.
- Vier Video-Referenzen als konkrete Einsatzorte: Radial Share (Trade-Detail, Bericht), Papierkorb-Animation (Anhang löschen, rückholbare Entwürfe), Speicher-Morph (Trade speichern: Karte verdichtet → Laden → persistenzbestätigter Erfolg), Login/Signup-Morph (AuthSheet). Glassy Sidebar/Dashboard nur als Materialreferenz.
- Nachweis: Clips (Playwright-Video) je Referenz, Pixelvergleich Übersicht/Cockpit.

**A6 Button-Familie und Clay-Suche** (`src/primitives/Button.tsx`, `Input.tsx`, `NavFinder`)
- Rollen Primär/Sekundär/Ghost/Gefahr/Icon in einer Familie; Kauf-Einstieg als `Button → Pay`-Morph (Weiter zur Zahlung → Laden → Erfolg nur nach Server-Bestätigung); Doppelklick-Schutz; Breite stabil bei Textwechsel.
- Clay-Suchfeld: weiche räumliche Fläche, Fokus 180–240 ms, Treffer 180–260 ms, Clear, Status, Filterchips; eine Grundkomponente, kompakte Varianten für Funktions-/Trade-/Asset-Suche.
- Quellen: Magic UI Shimmer, Aceternity Stateful Button, Uiverse Inputs – Idee übernehmen, Lizenz notieren, im Token-System bauen.

**A7 Seite „Funktionen“** (`src/views/funktionen`)
- Einstieg mit Suche, Gruppen nach Nutzerziel, Favoriten + zuletzt verwendet (gemeinsame Datenbasis, Settings-Key), Status je Funktion: verfügbar / Einrichtung nötig / im höheren Tarif (mit nächstem Schritt), Icon/Mini-Grafik je Funktion, gestaffelte Einblendung nur sichtbarer Kacheln.

**A8 74-Punkte-UX-Matrix** (`docs/UX-MATRIX-74.md` neu)
- Je F-ID die 15 Spalten des Auftrags; die Matrix treibt die Änderungen in A4/A7 und die Formular-Vereinfachungen (Pflichtfelder, Fehler am Feld, Werte übernehmen). F55 wird aus COVERAGE als „Klare mobile Oberfläche“ zugeordnet und ins Register aufgenommen.

### Welle B – Konto, Verbindungen, Kauf (brauchen E1–E4)

**B1 Konto produktiv** (E1)
- Produktionsprojekt, E-Mail-Vorlagen, Redirects, Sitzungsregeln, MFA-Pfade, Kontolöschung vs. Abo-Ende getrennt; lokale Daten beim ersten Login per Auswahl übernehmen (ohne Dubletten); RLS/Storage-Policies gegen zwei echte Testnutzer prüfen (Tests 1–8).

**B2 Binance-Connector** (E3)
- Geführter API-Key-Weg: Anleitung, Rechte-Check (keine Auszahlung, Spot/Futures getrennt), feste Ausgangs-IP dokumentieren, verschlüsselt pro Nutzer (wie Bitunix), Erstimport mit Fortschritt, inkrementeller Abgleich mit Fill-IDs, Trennen stoppt Jobs. Fast-API-OAuth als zweiter Weg hinter Feature-Flag, erst nach Freigabe. Tests 9–13.

**B3 TradingView** (E4)
- Pro-Nutzer-OAuth-Client gegen `mcp.tradingview.com` (PKCE/State, Tokens verschlüsselt, Widerruf), Verbindungstest per Leseabruf, Fehlertexte für fehlenden Tarif.
- Signal-Empfänger `POST /api/v1/signals/:token` mit versioniertem Schema (Quelle, Signal-ID, Strategie, Markt, Richtung, Zeit, Daten) ohne Ordergröße; Adapter `branchen-trend/1` und `action: open/close`; Dedup, Payload-Grenzen, Queue; Assistent „Zieladresse → TradingView öffnen → Testsignal → Empfang anzeigen“. Tests 14–18.

**B4 Kaufstrecke** (E2, E8, E9)
- Tarifübersicht (Monat/Jahr, Team-Sitze, Jahresbelastung sichtbar, Steuerdarstellung), Tarifdetail (Nutzen, Illustration, Grenzen), Bestellübersicht (Betrag, Verlängerung, Bedingungen, Login-Rückführung, Idempotenz je Doppelklick), Stripe Checkout, Ergebnisseite (bestätigt / in Bearbeitung / Bestätigung nötig / abgebrochen / fehlgeschlagen), Verwaltung (Portal: Zahlungsmittel, Rechnungen, Wechsel, Kündigung, Sitze).
- Freischaltung ausschließlich per Webhook-Zustand; Tarif-Motion-Profil wird nach echter Änderung kurz eingeführt. Tests 19–25.

### Welle C – Fachkette und Betrieb (bauen auf A3, B3)

**C1 Branchen → Paper-Portfolio** – Signal (Grün = Long-ETF/Index-Instrument, Rot = Cash/Ausstieg, nie Short) → Kandidatenprüfung mit Zeitmaschine → Risikoregel → genau eine Paper-Position mit `signalId/simulationId/tradeId` → Historie; Not-Aus; keine Order bei veralteten Daten. Test 28.

**C2 Vier Alarme + Zustellung** – Grün/Rot Vorwarnung/Bestätigung mit Schwellen, Hysterese, Cooldown, Ruhezeiten; Kanäle E-Mail (vorhanden), Browser, Telefonie (Twilio, Opt-in, Nummernprüfung, Zustellprotokoll, Testanruf). Hintergrund: Netlify Scheduled Functions + `jobs`-Tabelle mit Wiederanlauf ohne Doppelbuchung. Tests 31–34.

**C3 Wal-Karte vollständig** – Positions- und Konto-Reihe als wählbare Serien, Quelle/Kohorte/Messzeit sichtbar, Umschlag-Vorwarnung/-Bestätigung, Archiv für längere Historie (F26-Archiv), Lücken statt Interpolation.

**C4 Betrieb** – Release-Check der Env-Variablen (fehlende Konfiguration ⇒ ehrlich „nicht eingerichtet“, nie „alles frei“), Monitoring (Registrierung, Sync, Jobs, Webhooks, Billing), Backup/Restore-Probe, Kostenbudget. Test 40.

### Welle D – Abnahme und Startentscheidung

- 40 Abnahmetests als Protokoll (`docs/ABNAHME-40.md`), 74-Matrix und 177-Matrix fortgeschrieben, Quellen-/Einbaumatrix, Geräteprüfung (Android, Tablet, Desktop, Tastatur, Touch, Reduced Motion), Performance auf ruhiger Maschine (LCP ≤ 2,5 s, INP ≤ 200 ms, CLS ≤ 0,1; Labor vs. Feld getrennt), Vorher/Nachher-Clips.
- Startentscheidung in vier Spalten: fertig / teilweise / technisch blockiert / bewusst nicht. „Bereit“ nur, wenn P0/P1 grün.

## 4. Parallelisierung und Aufwand (grob, nach Erfahrung der Runden 9/10)

| Welle | Pakete parallel | Dauer bei 4–6 Agenten | Voraussetzung |
| --- | --- | --- | --- |
| A | A1–A8 (8 Worktrees, A5/A6 teilen Button/Input → A6 wartet auf A5-Tokens) | 1–2 Tage inkl. Merge, CI, Fixes | keine |
| B | B1–B4 | 1–2 Tage, davon Wartezeit auf Zugänge | E1–E4, E8, E9 |
| C | C1–C4 | 1 Tag | A3, B3, E5 |
| D | Abnahme | 1 Tag + Geräte | E6, E7 |

Jede Welle endet wie bisher: Merge, `tsc`/eslint/vitest/Build/Budget, CI mit drei E2E-Shards, Netlify-Vorschau, Pixelvergleich,
Bericht. Nach Welle A ist die Vorschau sichtbar besser; „startfähig“ setzt B und C voraus.

## 5. Risiken und bewusste Grenzen

- **Binance Fast API** und **TradingView-OAuth/kommerzielle Nutzung** sind Betreiber-/Anbieterfreigaben außerhalb meiner Reichweite; bis dahin API-Key-Weg bzw. Webhook-Assistent. Keine Auto-Trading-Nutzung von TradingView-Daten ohne Vertrag.
- **Erstlade-Budget** ist fast ausgeschöpft; Welle A beginnt mit einem Chunk-Schnitt (Editor/Settings als Lazy-Chunks), sonst kein Platz für Kaufstrecke und Auth-Morph.
- **Telefonie** nur mit Twilio-Konto und eingewilligtem Testanruf; sonst als Blocker im Protokoll.
- **Echte Geräte** kann ich nicht bedienen; ohne E7 bleibt der Gerätetest „nicht durchgeführt“.
- **Sandbox** erreicht Binance Futures nicht (451); Live-Prüfungen müssen auf der Netlify-Vorschau mit deinem Browser stattfinden.
- Bewusst nicht: Echtgeld-Orders, Glassnode/Hyblock ohne Vertrag, 177 Effekte flächendeckend, zweites Dashboard, neue Auth-/Billing-Stacks.

## 6. Erste Schritte nach deinem „Go“

1. Antworten zu E3, E8, E10 (Entscheidungen) und Status zu E1/E2/E4–E7 (Zugänge) – alles andere startet sofort.
2. Chunk-Schnitt für Budget-Reserve (halber Tag), dann Welle A in acht Worktrees.
3. Nach Welle A: Vorschau + Bericht; Welle B sobald Zugänge da sind.
