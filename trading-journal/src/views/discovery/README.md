# `src/views/discovery` – Karte „Muster-Entdecker“

Die Oberfläche zu `src/domain/discovery` (Methode, Grenzen, Messwerte: dort die README). Eine Karte, die mit **Trades** gefüttert wird – denen eines Backtests (Labor, Strategie-Studio) oder echten Journal-Trades – und in einfacher Sprache sagt, was Gewinner und Verlierer gemeinsam haben **und was davon gegen den Zufall standhält**.

| Export | was |
|---|---|
| `DiscoveryPanel` (auch `default` für `lazy(() => import("@/views/discovery/DiscoveryPanel"))`) | `DiscoveryPanelProps`: `trades: DiscoveryTrade[]` (nur solche mit bekanntem R zählen), `markets?` (die Kerzen, auf denen die Trades genommen wurden, je Markt-Schlüssel; ohne sie nur Uhr, Verlustserie, Emotion, Setup), `source?` (`"backtest"` Standard / `"journal"`), `label?`, `seed?`, `includePostEntry?`, `onTestFilter?(spec, finding)`, `filterTest?` (Ergebnis des Tests, wird unter dem Befund gezeigt), `mode?` (`"idle"` rechnet im Hauptthread: Tests, Einzeldatei), `bare?`, `className?`. |
| `FilterTestState` | `{ id, status: "running" \| "done" \| "error", text }` – vom Gastgeber (Labor: `DiscoverySection`), die Karte zeigt es nur. |
| `DISC` | die deutschen Texte. |
| `lastResult.ts` | `rememberDiscovery` / `lastDiscovery`: die zuletzt fertige Suche der Sitzung, nur im Speicher – der Assistent liest sie. |

`DiscoveryInput` (Domain, `types.ts`) ist der saubere Vertrag für Strategie-Studio und Labor: `{ trades, markets?, source, label?, seed?, includePostEntry? }`; `fromBacktest(trades, bars, intervalSec, { label, levels })` und `fromJournal(trades, { setupName, markets })` (`@/domain/discovery/adapters`) bauen ihn.
**Nicht ins Shell-Barrel**: die Karte zieht die ganze Suche mit; Gastgeber laden sie lazy (`LaborView` → `DiscoverySection`, eigener Chunk).

## Was die Karte zeigt
- **Kopf**: Quelle und Zahl der Trades mit bekanntem R; zu wenige (< 80) → ehrlicher Leerzustand mit Soll und Ist (`discovery-empty`), Knopf aus. Die Suche startet nie von selbst: `Muster suchen` (`discovery-start`), dann Fortschrittsbalken (`role="progressbar"`, `discovery-progress`), Phase in Worten, `Abbrechen` (`discovery-cancel`; der Worker wird beendet). Der Seed steht sichtbar (`discovery-seed`) – es gibt keinen „neu mischen“-Knopf.
- **Ergebnis**: die Zählzeile („Ich habe 412 Zusammenhänge geprüft, 3 halten stand.“, `discovery-counts`), die Aufschlüsselung („3 bestätigt · 5 Hinweise · 404 verworfen (Zufall)“, `discovery-breakdown`), eine Zeile zu Aufteilung 60/40, Mischungen und Merkmalen (`discovery-method-line`).
- **Gewinn-Muster** und **Verlust-Muster** getrennt (`discovery-group-win|loss`), darunter einklappbar **Hinweise** (nur im älteren Teil klar) und **Verworfen (Zufall)** – die auffälligsten verworfenen mit Grund; sie zählen in der Gesamtzahl mit. Nichts bestätigt → ein ehrlicher Satz („Nichts hält gegen den Zufall stand. Das ist bei so vielen Prüfungen ein häufiges und ehrliches Ergebnis …“).
- **Befund-Karte** (`discovery-finding`, `data-tier`, `data-side`): Ampel-Punkt **und** Stufe in Worten (grün bestätigt, gelb Hinweis, grau verworfen), der Satz („Wenn RSI(14) ab 55 UND … : 71 % Treffer statt 48 % (n=64, bestätigt)“), Stichprobe, Trefferquote mit 80-%-Spanne, Ø R, Differenz zur Gesamtstrategie, „trifft auf x % der Gewinner und y % der Verlierer zu“, vier Zeitblöcke (✓ / ✗ / –, mit Text), Abzeichen („Kombination stärker als jede Einzelwirkung“, „Merkmal, das kaum jemand prüft“, „erst nach dem Trade bekannt“), Gründe bei Nicht-Bestätigten, Details (beide Teile, q, p der Bestätigung) hinter einem Knopf.
- **„Mit diesem Filter testen“** (`discovery-filter-test`) nur bei einem bestätigten Befund, den ein Backtest auswerten kann, und nur wenn der Gastgeber `onTestFilter` gibt; sonst steht der Grund da (`discovery-filter-why`: Journal-Feld, Verlustserie, Schlüsselmarken, erst nach dem Trade bekannt). Der Klick übernimmt nichts: das Labor rechnet denselben Lauf mit und ohne Muster; darunter steht, dass das Muster aus denselben Trades stammt.
- **Fuß**: „So wurde geprüft“ (ausklappbar) und der feste Satz *Beobachtung, keine Ursache; kein Versprechen für die Zukunft. Keine professionelle Finanzberatung.* (`discovery-disclaimer`).
- Ändern sich die Daten nach einer Suche, wird das alte Ergebnis nicht mehr gezeigt (`discovery-outdated`); ein laufender Lauf wird beendet.

## Im Labor (`src/views/labor/DiscoverySection.tsx`)
Abschnitt „Muster-Entdecker“ ganz unten (`labor-discovery`, `data-source`). Quelle per `Segmented`: **Letzter Backtest** (Trades und Kerzen des gezeigten Laufs, dazu Schlüsselmarken desselben Markts mit Anlegezeit; ohne Lauf gesperrt, mit Grund) oder **Journal-Trades** (geschlossene Trades mit R; Setup-Name, Emotion, Verlustserie, Uhr). `Mit diesem Filter testen` setzt das Muster als Filter in `useExtras` (`setPattern`) und startet den Filtervergleich; das Ergebnis steht unter dem Befund (Trades, Σ R, Trefferquote, abgelehnte Signale – mit und ohne Muster).

Tests: `tests/unit/views.discovery.test.tsx` (Leerzustände, Lauf mit Fortschritt, Zählzeile, Gewinn-/Verlustmuster, Abbruch, veraltetes Ergebnis, Filterknopf), `tests/unit/views.labor.discovery.test.tsx` (Quelle, Übergabe an den Filtervergleich), e2e `tests/e2e/discovery.spec.ts` (Labor → Karte sichtbar, mobil ohne Querscroll).
