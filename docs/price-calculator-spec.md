# Spezifikation: Kostenrechner

## Ausgangslage

Für die Fahrschule Krebs GmbH (Fulda/Bad Hersfeld) ist **keine Preisliste
veröffentlicht**. Die im Auftrag genannten Werte stammen mit hoher
Wahrscheinlichkeit von einem gleichnamigen, nicht verbundenen Unternehmen in
Freigericht/Gelnhausen (siehe `truth-conflicts.md`).

Damit standen drei Möglichkeiten offen:

1. Die fremden Preise übernehmen — hätte die Preise eines anderen Unternehmens
   auf diese Website gestellt. Ausgeschlossen.
2. Preise erfinden oder schätzen — ausgeschlossen.
3. Das Werkzeug so bauen, dass es ohne eigene Preise **echten Nutzen** stiftet.

Umgesetzt wurde 3.

## Was der Rechner tut

Er vergleicht **zwei Angebote Position für Position bei identischen Mengen**.

Das ist genau die Rechnung, an der Vergleiche sonst scheitern: Fahrschule A
kalkuliert mit 20 Fahrstunden, Fahrschule B mit 35 — die Endsummen sind dann
nicht vergleichbar, egal wie genau man rechnet. Hier gibt es **eine** Menge pro
Position, die auf beide Seiten angewendet wird. Die ausgewiesene Differenz ist
dadurch ein echter Gleich-für-Gleich-Vergleich.

Positionen: Grundbetrag · Lehrmaterial · Simulatoreinheit · Übungsfahrstunde ·
Sonderfahrt (Menge auf 12 fixiert, gesetzlich vorgeschrieben) · Vorstellung
Theorieprüfung · Vorstellung praktische Prüfung. Klassen B und BF17, erweiterbar.

Sobald die echten Preise in `content/prices.ts` stehen und auf `confirmed`
gesetzt sind, füllt sich die linke Spalte automatisch. Keine Komponente ändert
sich.

## Rechenkern

`src/lib/pricing.ts` — reine Funktionen, kein React, kein DOM.

**Alles in ganzen Cent.** Euro als Fließkommazahl ist der Grund, warum
Vergleichsrechner am Ende einen Cent danebenliegen.

`parseEuroToCents()` löst zwei Fälle, die sonst falsches Geld erzeugen:

- **Trennzeichen.** Im Deutschen ist das Komma immer das Dezimaltrennzeichen und
  der Punkt der Tausendertrenner: „2.000" sind zweitausend Euro. Zugleich fügen
  Leute „64.50" aus einem englisch formatierten Angebot ein. Regel: Das
  **letzte** Trennzeichen ist das Dezimaltrennzeichen; ein alleinstehender Punkt
  mit genau drei folgenden Ziffern ist ein Tausendertrenner.
- **Rundung.** `Math.round(1.005 * 100)` ergibt 100, nicht 101, weil 1,005
  binär nicht darstellbar ist. Der Nachkommateil wird deshalb **als Zeichenkette**
  gerundet; ein Float berührt den Betrag nie.

Ein fehlender Preis ist `null`, nicht `0` — „unbekannt" und „kostenlos" dürfen
nicht dasselbe ergeben. Positionen, bei denen nur eine Seite einen Preis hat,
werden gemeldet und die Summen als noch nicht vergleichbar gekennzeichnet.
Positionen mit Menge 0 gelten nicht als unvergleichbar.

## Tests

27 Vitest-Fälle in `src/lib/pricing.test.ts`: deutsche und englische Eingaben,
Tausendertrenner in beiden Konventionen, geschütztes Leerzeichen aus der eigenen
Formatierung, leere und ungültige Eingaben, negative Werte, unendliche Werte,
Rundung auf dem Cent, Mengenbegrenzung, 100 Positionen ohne Drift, einseitige
Preise, identische Angebote, günstigere Gegenseite.

Dazu vier Playwright-Fälle gegen den Produktionsbuild, die prüfen, dass die
Summen in der Oberfläche tatsächlich stimmen (399 + 20 × 64 = 1.679,00 €).

Zwei dieser Tests haben während der Entwicklung echte Fehler gefunden: die
Fließkomma-Rundung und die Behandlung von „2.000".

## Barrierefreiheit

Tabelle mit `caption`, Zeilenköpfen und beschrifteten Eingabefeldern. Beide
Summen und die Differenz werden über eine `aria-live`-Region angesagt, weil sie
sich ohne Seitenwechsel ändern. Zahlen laufen tabellarisch, damit beim Tippen
nichts springt. Auf schmalen Bildschirmen scrollt die Tabelle **in sich**, die
Seite nicht.

## Was der Rechner bewusst nicht behauptet

Keine „günstigste Fahrschule", kein Bundesdurchschnitt, keine feste
Ersparnis. Der Hinweistext nennt ausdrücklich, dass die Zahl der
Übungsfahrstunden gesetzlich nicht vorgeschrieben ist, den Gesamtpreis am
stärksten bewegt und sich vorab nicht exakt vorhersagen lässt. Behörden- und
Prüfgebühren werden getrennt ausgewiesen, weil sie bei jeder Fahrschule
anfallen.
