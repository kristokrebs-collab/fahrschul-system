# Wiederverwendbares aus dem Bestand

Bewertet wurde die einzige vorhandene Projektdatei, `dashboard.html`.

## Übernommen: die Geschäftslogik

Das Wertvollste an der Datei ist nicht die Oberfläche, sondern das Regelwerk —
es bildet ab, wie der Betrieb tatsächlich ausbildet.

| Herkunft | Ziel |
| --- | --- |
| §1 Vorbesitz reduziert Theorie 12 → 6 | `content/classes.ts`, Ausbildungsablauf |
| §2 Simulatoreinheiten vor Echtfahrten | Simulator-Kapitel, Reihenfolge im Cockpit |
| §3 Finanzsperre bei Rückstand | Cockpit: „Keine offenen Rechnungen" als Bedingung |
| §4 Sonderfahrten erst nach Grundausbildung | Cockpit, Ausbildungsablauf |
| Sonderfahrten 5 / 4 / 3 | `content/classes.ts`, Rechner, Cockpit |
| Dimensionen DOK · FIN · THE · TP · PRAX | Struktur der sechs Cockpit-Zustände |
| „PrüfungsReady" als Bedingungsliste | Cockpit-Zustand 6, bewusst ohne Prozentwert |

Die Entscheidung, im Cockpit **keine** Bestehenswahrscheinlichkeit anzuzeigen,
folgt direkt aus dem Original: dort ist `isExamReady()` eine UND-Verknüpfung
erfüllter Bedingungen, keine Schätzung. Das ist die ehrlichere Darstellung, und
sie wurde übernommen.

## Nicht übernommen

| Element | Grund |
| --- | --- |
| Beispiel-Personendaten | Personenbezogene Demo-Daten gehören nicht auf eine öffentliche Website |
| Indigo-Glassmorphism-Optik | Generische Enterprise-Dark-Mode-Optik, keine Verbindung zur Marke |
| Plus Jakarta Sans | Ersetzt durch Archivo und Instrument Sans |
| `innerHTML`-Rendering, Inline-`onclick` | Mit React und TypeScript unvereinbar |
| Ampelfarben (acht Statusfarben) | Auf vier Bedeutungen reduziert: erledigt, aktiv, wartend, offen |
| Emoji in der Oberfläche (⛔ ⚠ 🏆) | Der Auftrag schließt Emoji aus; ersetzt durch eigene SVG-Formen |

## Aus dem Auftrag übernommene Ideen

„Die Krebs-Route", die Kapitelfolge und die sieben App-Zustände stammen aus dem
Auftrag und wurden umgesetzt — mit zwei Änderungen: die Zustände „Termine" und
„Lernen" sind zu „Sonderfahrten" und „Unterlagen" geworden, weil sich für
Terminbuchung und Lernbibliothek keine belegte Grundlage fand, und die
Sonderfahrten der reale Engpass in der Ausbildung sind.
