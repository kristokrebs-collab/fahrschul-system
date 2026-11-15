---
name: crm-intake-booking
description: Nutze diesen Skill, wenn CRM-Leads qualifiziert, eingehende Formulare bearbeitet oder Kalendertermine in GoHighLevel angelegt werden sollen.
---

# CRM-Anfragen und Terminbuchung

**Kategorie:** business

## Ziel
Kundenanfragen zuverlässig erfassen, qualifizieren und einem konkreten nächsten Schritt zuordnen. GoHighLevel/ghl-mcp ist eine *optionale* technische Integration, nicht Teil dieses Skill-Pakets.
## Ablauf
1. Bestand prüfen: CRM-Anbieter, API-Verbindung, Kanäle, Kalender, Zeitzone, Qualifizierungskriterien, Öffnungszeiten, Zuständigkeiten.
2. Daten minimieren und Quellen/Einwilligungen dokumentieren; Kontakte vor Neuanlage deduplizieren.
3. Anfrage klassifizieren: Informationen, Termininteresse, Rückruf, Beschwerde oder manuelle Eskalation.
4. Nur bestätigte freie Slots anbieten; keine Termine erfinden. Änderungen/Versand vor Ausführung freigeben lassen, sofern die Aktion nicht separat ausdrücklich autorisiert ist.
5. CRM-Änderungen protokollieren; fehlgeschlagene Aktionen melden und nie Erfolg behaupten, ohne API-Erfolg.
## Ergebnis
Lead-Zusammenfassung, Kanal und Quelle, Datenschutzstatus, vorgeschlagene Antwort, Terminoptionen, benötigte Berechtigungen und offener Freigabeschritt.
## Technische Referenz
- [ghl-mcp](https://github.com/tenfoldmarc/ghl-mcp)

## Qualitäts- und Sicherheitsregel
Wenn eine genannte API, ein Tool, Account oder ein Zugang fehlt, simuliere keine aktive Verbindung. Zeige einen getesteten nächsten Schritt, markiere fehlende Zugriffe und fordere nötige externe Freigaben nur gezielt an. Fremdcode niemals ungelesen ausführen.
