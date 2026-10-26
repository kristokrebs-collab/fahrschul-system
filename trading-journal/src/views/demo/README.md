# `src/views/demo` – Interaktive Demo mit Beispieldaten (F58)

Ein Blatt (`Sheet`, `DemoHost`, **ein lazy Chunk**, gemountet von `DeferredHosts` beim ersten `openDemo`) mit fünf Schritten – **Import · Regeln · Test ·
Demokonto · Alarm**. Rechnet mit den echten Funktionen der App auf erfundenen Daten (`src/domain/demo`, README dort) und speichert nichts.

## Einstiege (ruhig, nichts startet von selbst)

- Seite **Funktionen**: eine gestrichelte Box unter den Kacheln („Neu hier? Probier die App mit Beispieldaten aus.“, `data-testid="funktionen-demo"`).
- **Einstellungen › Einführung & Hilfe**: der Knopf „Demo mit Beispieldaten“ (`onboarding-demo`; der Chunk wird erst beim Klick geladen).
- Funktionsregister (`produktdemo`, Öffner `demo`): Suche, Finder der Navigation, Assistent („Wo finde ich …?“).
- Das Dashboard (`#overview`), das Cockpit, die Dock-Leiste und der Header sind **unverändert**.

## Aufbau

`demoStore.ts` (winzig: `open`, `seq`, `openDemo`, `closeDemo`) · `session.ts` (der eigene Zustand im Speicher, nie gespeichert, bei jedem Öffnen und
Schließen geleert) · `DemoHost.tsx` (Blatt, Stufenleiste, Fuß mit Zurück / Weiter, Schlusskarte mit den echten Wegen) · `DemoCard.tsx` (**jede** Karte:
Kennzeichnung „Beispiel – nicht deine Daten“ im Kopf, am Ende „Keine professionelle Finanzberatung.“ und – bei Kerzen – deren Quelle) ·
`ImportStep` · `RulesStep` · `TestStep` · `PaperStep` · `AlarmStep` · `DemoChart.tsx` (statisches SVG: Kerzen, Linien, nummerierte Marken; misst seine
Breite, Farbe nur als Richtung der Kerze, jede Linie und Marke steht auch als Wort) · `strings.ts`.

## Regeln der Demo

1. Jede Karte trägt die Kennzeichnung; synthetische Kerzen heißen „Beispiel-Kerzen“ und sind als künstlich beschrieben.
2. Deterministisch: dieselben Zahlen bei jedem Aufruf, kein Zufall, keine Uhr.
3. Nichts schreibt in Journal, Einstellungen, Speicher oder Cloud; nichts geht ans Netz. Die Wege aus der Demo hinaus (echter CSV-Import, Labor, Handelsplan,
   Schlüsselmarken) sind Knöpfe, die die Demo erst schließen und dann die echte Stelle öffnen (`openFeature`).
4. Kein Weg zu einer Order: „Position im Spiel eröffnen“ rechnet mit, mehr nicht.
5. Edition „share“: nur erfundene Werte (keine persönlichen Marken); `npm run build:share` läuft.

## Mobil / Bewegung

390 px: eine Spalte, kein horizontaler Scroll (lange Badges und Ids brechen um), Tippflächen ≥ 44 px (Auswahlchips über `ChipPick`, Knöpfe über `.touch-hit`
mit ausreichend Zeilenabstand, Regler 44 px hoch). Bewegung nur über `src/motion` (`Sheet`/`StaggerItem`, `tween.fade`/`spring.enter` beim Schrittwechsel,
reduzierte Bewegung: sofort).

## Tests

`tests/unit/views.demo.test.tsx`, `tests/unit/demo.domain.test.ts`; e2e `tests/e2e/demo.spec.ts` (mobil + Desktop: fünf Schritte, jede Karte markiert, nichts im
Speicher, Tippflächen), `tests/e2e/a11y-demo.spec.ts` (axe, dunkel und hell).
