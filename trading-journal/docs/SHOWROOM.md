# Showroom (Paket S)

Stand: 08.11.2026. **Zweck.** Die Netlify-Vorschau eines Pull Requests ist ein klickbarer Showroom: Anmeldung, Registrierung, Bestellfenster, Zahlungsbühne, Wizard,
Voice-Ring, Wal-Karte mit Flip-Grafik, Wochenabschluss und Psychologie-Karten sind dort sichtbar und bedienbar – **ohne** echtes Supabase, Stripe, Binance oder
Anthropic, mit einem Demo-Journal. Vorher lieferte die Vorschau den nackten Build (ohne die Dienste): „Keine Abos in dieser Version“, kein Anmelden, Binance 451,
keine Daten.

**Ehrlichkeit zuerst.** Alles im Showroom ist ein Mock im Browser. **Nichts davon beweist etwas gegen echte Dienste** (kein Supabase-Auth, kein Stripe, keine
Binance-Antwort, keine KI). Der Showroom stellt nichts als echt, live oder rechtskräftig dar: der feste Banner sagt es, Erfolgsmeldungen sagen „Demo“, die Zahlungsseite
sagt „Demo-Karte – nichts wird gespeichert oder gesendet“.

## Wie er gebaut und gestartet wird

| | Befehl | Ergebnis |
|---|---|---|
| lokal bauen | `npm run build:showroom` | `dist-showroom/` (`tsc -b`, dann `VITE_SHOWROOM=1` mit Platzhalter-Supabase-Adresse `https://showroom.invalid` und Platzhalter-Schlüssel) |
| lokal ansehen | `npx vite preview --outDir dist-showroom --port 4470` | <http://127.0.0.1:4470/> |
| Netlify | `[context.deploy-preview]` in `netlify.toml`: `npm ci && npm run build:showroom:deploy && npm run build:share` | nur Deploy-Previews; **Produktion und Branch-Deploys bleiben ohne Schalter** |
| e2e | `PW_SHOWROOM_BASE_URL=http://127.0.0.1:4470 npx playwright test tests/e2e/showroom.spec.ts --project=mobile --project=desktop` | ohne die Variable überspringt sich die Datei |

Der Schalter ist die Build-Konstante `__TJ_SHOWROOM__` (Vite `define`, wie `__TJ_EDITION__`). Die Variablen setzen die npm-Skripte **im Befehl selbst** – ein Wert im
Netlify-Menü kann sie nicht überstimmen. Die Teilen-Edition (`/teilen/`) bleibt unverändert; `VITE_SHOWROOM` ist in `.env.example` / `docs/ENV.md` / `SETUP.md` dokumentiert
(„nie setzen“).

**Im Produktions-Build ist nichts davon enthalten.** `if (__TJ_SHOWROOM__)` in `src/main.tsx` und `__TJ_SHOWROOM__ ? lazy(…) : null` in `src/App.tsx` falten sich weg;
die Chunks (Installer, UI, Stylesheet) werden nicht ausgegeben. Beleg: `tests/unit/showroom.bundle.test.ts` durchsucht `dist/` nach zwölf Markern (Banner-Text, Demo-Konto,
Platzhalter-Adresse, Zahlungsseiten-Text, Stilklasse …) und findet im Showroom-Build dieselben. Gemessen (`npm run budget`, Produktions-Build): Erstladung JS 656,9 KiB
(vorher 656,9), CSS 52,3 KiB (vorher 52,3; Grenze 52,5) – das Stylesheet des Showrooms gehört zum lazy Chunk, der Banner-CSS steckt als Text im Installer. Eine erste
Variante mit einer importierten Konstante ließ die Chunks als verwaiste Dateien im Produktions-Build zurück; deshalb nennen die zwei Stellen die `define`-Konstante selbst.

## Was der Showroom ist (Aufbau)

```
src/showroom/
  flag.ts, install.ts, runtime.ts, seed.ts, banner.ts   Installer (läuft vor dem App-Start), Zustand, Speicher, fester Banner
  mock/   http.ts supabaseCore.ts billingCore.ts marketCore.ts synth.ts demoJournal.ts backend.ts fakeSockets.ts
  ui/     ShowroomHost.tsx (Panel, Mail-Knopf, Rückkehr-Hinweis) DemoCheckout.tsx jumps.ts showroom.css
```

* **Installer.** `main.tsx` lädt (nur mit Schalter) `install.ts`, wartet darauf und startet dann die App wie immer. Er ersetzt `window.fetch` und `window.WebSocket`:
  jede Anfrage der App wird im Browser beantwortet; die eigenen Dateien der Seite (Chunks, Schriften, OCR) kommen von der Seite selbst; **jeder andere Host schlägt fehl wie
  bei fehlendem Netz** (`TypeError: Failed to fetch`) – es verlässt keine Anfrage die Seite (der e2e-Test fängt jede Anfrage an einen fremden Ursprung ab und erwartet null).
* **Gemeinsame Mock-Handler.** Die Logik der e2e-Mocks ist in transportfreie Module gewandert und wird von beiden Welten benutzt: `tests/e2e/mocks/supabase.ts` und
  `billing.ts` sind nur noch Playwright-Adapter (Route → `MockReq` → `route.fulfill`), `tests/e2e/mocks/synth.ts` re-exportiert `src/showroom/mock/synth.ts`.
  `supabaseCore.ts` = GoTrue (Passwort, Registrierung, Magic Link, Reset, Refresh, PKCE-Code), PostgREST (`journal_docs`, `profiles`, `my_sessions`), Realtime (Phoenix-Frames),
  die Functions unter `/api/v1/*`; `billingCore.ts` = Status, Checkout, Portal, Vertrag, Code, Empfehlung. Neu und nur für den Showroom (alles aus, solange es niemand verlangt, die
  e2e-Mocks verhalten sich wie vorher): Postfach (`mailbox`: die Mail, die das echte Projekt schickte, wird aufgezeichnet), PKCE-Austausch, Echtzeit-Stempel, Zustands-Schnappschuss.
* **Konten.** Beim ersten Besuch ist das **Demo-Konto Premium** (`demo@showroom.test`, Passwort `demo-konto-1234` – ein öffentlicher Demo-Text, kein Geheimnis) schon
  angemeldet, damit jede Seite hinter einem Tarif offen ist; das Panel sagt es ausdrücklich („Demo-Konto Premium – keine echte Person“). Der Tarif gehört dem Konto
  (ein neues Konto startet bei „Frei“). Abmelden, Anmelden, Registrieren und Passwort-Reset laufen über die echten Formulare der App gegen den Mock.
* **Mail-Schritt.** Statt einer Mail zeigt die Seite einen gut sichtbaren Demo-Knopf („**Bestätigungslink simulieren**“, bei Magic Link / Reset „Anmelde-Link / Reset-Link simulieren“): er
  öffnet den Link, den die Mail enthielte – mit `?code=` und, wenn die Registrierung eine Bestellung trug, mit `?order=…` (die Bestellübersicht kommt danach zurück). Die Seite lädt dabei
  neu, deshalb liegt der Zustand des Mocks in `localStorage` (`tj2-showroom`).
* **Marktdaten.** Binance (direkt, `/api/binance`-Relais, Spot-Rückfall), Bybit und der Strom `fstream.binance.com` sind **erzeugt**, nicht aufgezeichnet: derselbe synthetische Kurs und
  dieselben Verhältnis-Skripte wie die e2e-Specs (`synth.ts`). Skript `slide-account`: die Top-Trader-Positionen sind vor etwa 60 Stunden von netto Long auf netto Short gekippt
  (innerhalb der letzten 14 Tage), die Konto-Reihe rutscht über denselben Zeitraum – Wal-Karte und Flip-Grafik zeigen Daten **und** die Flip-Marke.
* **Coach.** `/api/v1/coach/ask` antwortet nach 2,6 s („denkt nach“, der Voice-Ring ist sichtbar) mit einer **Demo-Formulierung** aus den Fakten der Anfrage und dem Satz „Demo-Formulierung des
  Showrooms – keine echte KI-Antwort“. Das Ausschreiben als Strom macht der Client (`CoachStream`); die Antwort selbst ist eine einzelne JSON-Antwort wie in der echten Function.
* **Demo-Journal.** Beim ersten Besuch schreibt der Showroom ~44 **erfundene** Trades der letzten sechs Wochen ins Gerät (jeder trägt „Demo-Eintrag“ in den Notizen): Berichte und
  Wochenabschluss haben Trades in der laufenden Woche, heute stehen zwei Scalp-Verluste, die den größten Teil des Tageslimits verbrauchen (Risiko-Hinweis), Coach und
  Wachstum haben Muster. Die Zeilen des Demo-Kontos entstehen beim ersten Abgleich aus genau diesem Journal, deshalb fragt die Anmeldung nichts (kein „Daten aus diesem Browser“).
  Ruhige Voreinstellungen: kein Rundgang, kein Rückblick-/Check-in-Fenster, „Bericht bereit“ als gemeldet, alle Falten offen.

## Der feste Banner

„SHOWROOM · Demo-Daten · keine echten Konten oder Zahlungen“ – schmal, ohne Knopf, nicht wegklickbar. Er ist reines DOM (von der ersten Farbe an da, kein Layoutsprung) und sitzt am
unteren Rand in einem Streifen, den die Seite sich reserviert: `html[data-showroom]` addiert die Streifenhöhe (26 px, auf dem Handy 38 px für zwei Zeilen) zu `--safe-bottom`, der Variable, die
Dock, unterer Verlauf, Fußzeile und Blätter ohnehin beachten. Darum steht nichts darunter – die Rechtstexte-Links der Fußzeile enden über dem Streifen (e2e: Position jedes Links gegen den
Banner), Aufbau von Startseite und Cockpit bleiben unberührt. Dialoge liegen über ihm, wie über dem Dock.

## „Neu in dieser Version“ (Panel)

Schließbar (Pille holt es zurück; die Wahl bleibt gemerkt), mit einem Sprung je Neuerung. Jeder Knopf geht über die Routen der App, nicht über eine Kopie des Bildschirms, und klappt das
Panel danach weg, damit das Ziel zu sehen ist (e2e auf Handy **und** Desktop):

| Knopf | Ziel (Beleg) |
|---|---|
| Anmelden | meldet ab, öffnet die Anmelde-Klinge mit der Demo-E-Mail; Anmelden mit dem Demo-Zugang, danach Passwort-Reset über den simulierten Link |
| Registrieren | räumt das Journal auf diesem Gerät leer (ein Journal mit Trades ist ein „bestehender Trader“, dort öffnet sich kein Wizard) und setzt den Showroom zurück, lädt neu und öffnet „Konto erstellen“; Registrieren → „Bestätigungslink simulieren“ → Einrichtungs-Wizard |
| Bezahlfenster · Premium jährlich | setzt das angemeldete Konto im Mock auf „Frei“, öffnet das Bestellfenster (Schrittband, Karte zum Umdrehen) → Zahlungsbühne → Demo-Zahlungsseite → „Tarif aktiv“ |
| Markt › Flip-Grafik | `top-trader-netto-karte`: „Was ist ein Flip?“, Diagramm „Echte Daten“, Marke „Flip 06.11. · netto Short“ |
| Coach › Voice-Ring | stellt die erste Vorschlagsfrage, drückt „Mit KI formulieren“: der Ring denkt, dann die Demo-Fassung |
| Berichte › Wochenabschluss | scrollt zur Karte „Wochenabschluss“ |
| Einrichtungs-Wizard | `openWizard` |
| Teilen-Fächer | `teilen-faecher` (Berichte › Export › Weitergeben) |
| Einstellungen › Bewegung | `bewegung` (Prozess-Rückmeldung) |

Ein Sprung zu einer Seite hinter einem Tarif gibt dem **angemeldeten Konto im Mock** Premium (Hinweis „Demo: Premium für dieses Konto“) – er wechselt nie das Konto, weil ein Gerät, das das
Konto wechselt, nach seinem Journal gefragt wird (echtes Produktverhalten, aber nicht, worüber ein Sprung stolpern soll).

## Bezahlen: Showroom und echtes Produkt unterscheiden sich – mit Absicht

Vorbild: die Bildschirmaufnahme „Payment Method Animation“ – zwei Spalten, Schrittband, lebendige Kartengrafik, Drehung beim CVC, „Authorising“, grünes Leuchten und „Paid“ – in unserer
Schrift und unserem Look.

* **Im Showroom** (`DemoCheckout.tsx`): genau diese Choreografie mit einem **Demo-Kartenformular**: eigene Felder (Karteninhaber, Kartennummer, Gültig bis, CVC), beschriftet „Demo-Karte – nichts wird
  gespeichert oder gesendet · Im echten Kauf gibst du die Karte bei Stripe ein“. Die Kartengrafik füllt sich beim Tippen, **dreht sich beim Fokus auf das CVC-Feld um** (Magnetstreifen, CVC) und
  zurück; „Demo-Zahlung“ → die Karte gleitet in die Mitte, „Die Bank wird gefragt …“ mit Lader → grünes Leuchten, „Bezahlt (Demo)“, ein Hinweis, dass es **keinen echten Beleg** gibt, und
  „Weiter zum Journal“ / „Noch einmal ansehen“. Zwei Testkarten per Knopf: `4242 4242 4242 4242` gelingt, `4000 0000 0000 0002` wird abgelehnt (Fehlertext, nichts passiert). Zusätzlich wählbar
  (nur Demo): „Bank verlangt noch eine Bestätigung“, „Zahlung scheitert nach der Prüfung“, „Bestätigung kommt nicht an“. Der Ausgang landet erst im Mock-Server (Webhook-artig), dann liest die
  Ergebnisseite ihn – wie bei Stripe: die Rückkehr-Adresse bestätigt nie etwas. Zweispaltig ab 860 px, auf dem Handy Karte oben und Formular darunter. Reduzierte Bewegung: keine Drehung, kein
  Lader, das Ergebnis steht (e2e).
* **Im echten Produkt** verarbeiten wir **keine Kartenziffern selbst**. Dort übergibt das Bestellfenster an Stripes gehostetes Checkout (später eventuell Stripe Elements); die Choreografie läuft nur mit dem, was
  ohne Kartendaten möglich ist: das Bestellfenster hat schon das Schrittband („Bestellung prüfen · Zahlung bei Stripe · Bestätigung“) und die Plan-Karte zum Umdrehen („Karte umdrehen: Das ist enthalten“),
  die Zahlungsbühne (`PayStage`) zeigt den Übergang an Stripe, und „aktiv“ steht erst nach der Bestätigung des Servers (Stripe-Webhook) auf der Ergebnisseite. **Nicht gebaut:** ein „Authorising →
  Paid“-Leuchten im echten Produkt (es gäbe nichts Echtes zu zeigen, bevor der Server bestätigt hat) und ein Kartenformular in unserer Seite. Die Showroom-Seite ist **keine** Vorlage für ein
  Kartenfeld.

## Anmeldung: Abgleich mit der Bildschirmaufnahme „Login & Signup“

Die schon gebaute `AuthBlade` (`src/cloud/ui/AuthBlade.tsx`) deckt das Vorbild: ein **schräges Band** (−14°) fährt einmal quer über die ganze Karte, die Inhalte tauschen hinter ihm
(Anmelden ↔ Registrieren ↔ Magic Link), der Fokus landet im ersten Feld, die Karte behält ihre Box (nur `transform`), unser Name in Punktschrift trägt je Schritt einen Satz („Willkommen zurück.“,
„Dein Journal. Dein Start.“), „Neu hier? Jetzt registrieren“ / „Schon registriert? Zur Anmeldung“, „Passwort vergessen?“, Passwort-Hinweis. Bewusste Abweichungen: unsere Markenfläche liegt **oben** in
der schmalen Karte statt als zweite Spalte rechts/links (die Anmeldung ist ein Blatt, auch für das Handy); die Seitenfolge des Vorbilds (Formular links ↔ Markenfläche rechts, beim Registrieren
getauscht) wurde nicht nachgebaut; **„Keep me signed in“ gibt es nicht** (das Konto bleibt auf dem Gerät angemeldet, bis man sich abmeldet – ein Schalter wäre ein Versprechen, das der Dienst nicht
einlöst); **kein Feld „Full name“** (das Konto kennt keinen Namen). Offen: die Klinge im Showroom gegen das Video Bild für Bild messen.

## Grenzen

* **Alles Mock, nichts bewiesen.** Supabase-Auth, Stripe-Abläufe, Binance- und Bybit-Daten, Coach-KI: nachgebaut. Marktdaten sind erfunden (ein synthetischer Kurs um 84.000); die Quellenzeilen der
  App („Binance Futures …“) beschreiben, wo die App im echten Betrieb liest – im Showroom steht der Banner darüber.
* **Mail-Knopf und Tastatur.** Der Demo-Knopf liegt außerhalb des Dialogs der Anmeldung (damit er nicht inert ist); wer nur die Tastatur benutzt, erreicht ihn nicht per Tab aus dem Dialog.
  Ein Screenreader liest ihn als Statusmeldung vor.
* **Persistenz.** Der Zustand des Mocks liegt im Speicher der Seite und wird in `localStorage` gesichert; „Demo zurücksetzen“ (Panel) räumt alle `tj2*`-Schlüssel und lädt neu.
* **Gerätewechsel.** Wer sich im Showroom mit einem anderen Konto anmeldet als dem, dessen Journal auf dem Gerät liegt, bekommt – wie im echten Produkt – die Frage nach den Daten.
* **Vorschau ≠ Produktion.** Die Teilen-Edition (`/teilen/`) der Vorschau ist der normale Build ohne Showroom.
