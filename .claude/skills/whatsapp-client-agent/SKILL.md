---
name: whatsapp-client-agent
description: Nutze diesen Skill für WhatsApp-Business-Support, Nachrichtenentwürfe, Kundendialoge, Terminabgleich und Kapso-Integration.
---

# WhatsApp-Kundenservice

**Kategorie:** communication

## Ziel
WhatsApp-Nachrichten zuverlässig, datensparsam und markenkonform beantworten, ohne unerlaubte Massenansprache.
## Ablauf
1. Prüfen, ob offizielle WhatsApp Business Platform bzw. geeigneter Provider wie Kapso, verifizierte Nummer, Freigaben und Templates existieren.
2. Einwilligung und zulässige Messaging-Fenster, Kanalregeln, Templates und Antwortzeitfenster ermitteln.
3. FAQ und Antworten aus autorisierten, aktuellen Quellen erstellen; bei Unsicherheit an einen Menschen eskalieren.
4. Terminabgleich mit CRM nur nach bestehender Integration; personenbezogene Daten in freigegebenen Systemen halten.
5. Testnachrichten an autorisierte Testnummern, erst nach Freigabe produktiv schalten.
## Ergebnis
Dialogbaum, FAQ, Eskalationsregeln, Nachweise der Verbindung, Testfälle und Freigabeprotokoll.
## Quelle
- [Kapso Agent Skills](https://github.com/gokapso/agent-skills) – laut README Alpha-Status und API-Key/CLI-Login nötig.

## Qualitäts- und Sicherheitsregel
Wenn eine genannte API, ein Tool, Account oder ein Zugang fehlt, simuliere keine aktive Verbindung. Zeige einen getesteten nächsten Schritt, markiere fehlende Zugriffe und fordere nötige externe Freigaben nur gezielt an. Fremdcode niemals ungelesen ausführen.
