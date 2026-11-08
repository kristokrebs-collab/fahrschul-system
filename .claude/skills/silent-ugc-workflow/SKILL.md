---
name: silent-ugc-workflow
description: Entwickelt KI-gestützte stumme UGC-Hook-Videos, TikTok- und Reels-App-Anzeigen mit Creator-Performance-Profil, eigenen Darstellern und App-Demo; koordiniert nach Prüfung den externen silent-ugc-Skill von jasonlee-breadcrumb und Arcads MCP.
---

# Silent UGC – KI-Werbevideo-Workflow

**Kategorie:** content / marketing / video  
**Original-Skill (externe Referenz):** https://github.com/jasonlee-breadcrumb/silent-ugc  
**Originalpfad laut Drittquellen:** `skills/silent-ugc/`  
**Status:** Dieser modulare Skill wurde für das Master-Paket **neu verfasst**; er ist keine Kopie oder bestätigte Installation des externen GitHub-Skills.

## Einsatz
Verwenden, wenn ein Nutzer aus einer eigenen oder genehmigten Video-Referenz einen kurzen stummen Werbe-Hook für Reels/TikTok entwickeln möchte: eigenes KI-Creator-Profil, konsistenter Charakter, Onscreen-Text, Übergang zu eigener App-/Produktdemo, Varianten für A/B-Tests.

## Arbeitsablauf
1. Prüfe Zielgruppe, Produkt/App, Plattform, gewünschte Länge, Markenkonzept, eigenes Bild-/Videomaterial, nachgewiesene Medienrechte und Einwilligung des dargestellten Menschen.
2. Analysiere nur Referenzmaterial, das rechtmäßig verwendet werden darf; leite Hook-Struktur, Performance-Beats, Kamera- und Lichtkonzept ab, ohne fremde Personen, Stimmen, Marken oder konkrete Originalaufnahmen ungefragt zu replizieren.
3. Entwickle ein neues Shot-Storyboard, ein 9:16-Frame-Schema, eigene Texte, Creator-Look, Szenen und den Übergang zu einer echten App-Demo.
4. Erstelle 3–5 klare Varianten des Onscreen-Hooks und die Messhypothese je Variante. Kennzeichne synthetische Darsteller/Werbung, wo erforderlich.
5. Vor bezahlter Generierung: Arcads-Account, Arcads-MCP, nutzbare Modelle, Credits/Kosten, ffmpeg und yt-dlp **in der tatsächlichen Ausführungsumgebung prüfen**. Ohne geprüften Zugang nur ein ausführbares Konzept liefern.
6. Gib für jeden bezahlten Renderauftrag eine Kostenabschätzung und hole vor der Ausführung eine Freigabe ein. Keine automatischen Ad-Publikationen oder Werbebudgets.
7. Prüfe fertige Clips auf visuelle Artefakte, konsistente Identität, korrekte Produktdarstellung, lesbare Captions, Tonlosigkeit falls gewünscht, Format und werberechtliche Kennzeichnung.

## Original-Skill als eigenständige Fremdinstallation (später, nur nach Prüfung)
Wenn der Nutzer die Installation in Claude Code freigibt, soll die verantwortliche Claude-Code-Sitzung:
- Repository `https://github.com/jasonlee-breadcrumb/silent-ugc` abrufen und **vor Installation** README, `skills/silent-ugc/SKILL.md`, eventuelle Hilfsskripte, Lizenz, Abhängigkeiten, Berechtigungen und Änderungen prüfen.
- Nach positiver Prüfung den **Original-Skill** separat unter `.claude/skills/silent-ugc` (Projekt) oder `~/.claude/skills/silent-ugc` (global) installieren. Den vorliegenden Wrapper `silent-ugc-workflow` nicht mit dem Original verwechseln oder überschreiben.
- Arcads MCP/API-Integration und Credits nur nach autorisierter Kontoverknüpfung verwenden; niemals Zugangsdaten im Chat erfragen oder hartkodieren.
- `ffmpeg`, `yt-dlp` nur kontrolliert über die Paketverwaltung der jeweiligen Umgebung installieren, keine unkontrollierten Postinstall-Skripte.
- Mit einer eigenen Testreferenz und ohne gebührenpflichtiges Rendern einen Smoke-Test ausführen.

## Qualität, Sicherheit und Rechte
- Bei fremder Darstelleridentität, Stimme, Bild oder Video: schriftliche Nutzungsrechte und Einwilligung prüfen; sonst mit einem eigenen/synthetischen neuen Darsteller arbeiten.
- Keine behaupteten echten Kundenerfahrungen, falschen Testimonials oder nicht belegten Werbeaussagen.
- Medien aus sozialen Plattformen nur unter Einhaltung der Nutzungsbedingungen und Rechte herunterladen.
- Kein automatisches Hochladen, Posten, Ads-Schalten oder Beauftragen kostenpflichtiger KI-Generierung.
- Kann ohne Arcads mit Konzept, Shotlist und Textvarianten arbeiten, aber keine Videoerzeugung oder fertige Installation vortäuschen.
