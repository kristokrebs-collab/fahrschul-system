# Quellen-Inventar

Stand: 2026-07-27/28

## Was im Projekt tatsächlich vorlag

Der Master-Prompt nennt eine lange Liste von Projektdateien (Prototypen,
Preislisten, App-Master-Prompts, Higgsfield-Archiv, `web-quality-suite`).
**Keine dieser Dateien existierte in diesem Repository oder im Dateisystem.**
Die vollständige Suche über das gesamte Dateisystem ergab genau eine
Projektdatei.

| Quelle | Art | Stand | Bewertung |
| --- | --- | --- | --- |
| `dashboard.html` (1.168 Zeilen) | Interne Status-Zentrale, Prototyp | Commit 2026-06-28 | **Wertvollste vorhandene Quelle.** Enthält echte Geschäftsregeln. |
| Git-Historie | 2 Commits, 1 Datei | — | Keine weiteren Artefakte |
| Higgsfield-Archiv (MCP) | 16 Bilder | Juli 2026 | **Nicht abrufbar** — CDN durch Egress-Policy blockiert |
| 21st.dev (MCP) | Komponentenkatalog | live | Für Recherche genutzt |
| Öffentliche Website des Unternehmens | Produktivsystem | live | Über Websuche ausgewertet, direkter Abruf blockiert |

## Nicht vorhanden

`01_FINAL_WEBSITE_MASTER_PROMPT.md` · `Fahrschule_Krebs_Website_Claude_Code_Masterprompt.md` ·
`Fahrschule_Krebs_Video_First_Premium_Website_Masterprompt_V2.md` ·
`Krebs_Cockpit_Performance_Morph.html` · `krebs-unified-1.html` · `krebscinematic-2.html` ·
`fahrschulekrebs-2.html` · `fahrschulekrebs-5.html` · `app-6.html` · `krebscockpitpro-1.html` ·
`dashboard-15.html` · `web-quality-suite-tablet-v1.2.zip` · Student-/Office-/Fahrlehrer-/Finanz-App ·
Preisrechner · Preislisten · Wettbewerbsvergleiche · Logos · Markenassets · Fotos · Videos

## `dashboard.html` — was daraus übernommen wurde

Die Datei ist ein internes Verwaltungswerkzeug (Status-Matrix über
Fahrschülerinnen und Fahrschüler). Sie ist **kein** öffentliches Material und
enthält Beispiel-Personendaten, die nicht übernommen wurden.

Übernommen wurden die **Geschäftsregeln**, weil sie die reale Ausbildungslogik
des Betriebs abbilden:

| Regel im Dashboard | Verwendung auf der Website |
| --- | --- |
| §1 Vorbesitz: Theorie 12 → 6 Doppelstunden | `classes.ts` (`grundstoffMitVorbesitz`), Ausbildungsablauf |
| §2 Simulator-Sperre: Einheiten vor Echtfahrten | Simulator-Kapitel, Cockpit-Reihenfolge |
| §3 Finanz-Sperre bei Rückstand | Cockpit: „Keine offenen Rechnungen" als Prüfbedingung |
| §4 Sonderfahrten erst nach Grundausbildung | Cockpit-Ausbildungsweg, Ausbildungsablauf |
| Sonderfahrten B: 5 Überland / 4 Autobahn / 3 Nacht | `classes.ts`, Rechner, Cockpit |
| Statusdimensionen DOK · FIN · THE · TP · PRAX | Struktur des Cockpit-Kapitels |
| „PrüfungsReady" als erfüllte Bedingungen, nicht als Prognose | Cockpit-Zustand 6 — bewusst ohne Prozentwert |

Die Datei bleibt unverändert im Repository liegen.

## Recherchequellen für Geschäftsdaten

Da weder die Website noch das CDN direkt abrufbar waren (Egress-Policy des
Sandbox-Containers, HTTP 403), wurden alle Angaben über Websuche trianguliert.
Bevorzugt wurden Aussagen des Unternehmens selbst
(`fulda.fahrschule-krebs.de` Impressum/Historie/Team/Theorie,
`fahrschule-krebs.de`, eigene Facebook- und YouTube-Kanäle); Branchenportale
nur zur Bestätigung. Details in `business-truth.md` und `truth-conflicts.md`.
