---
name: voice-reception
description: Nutze diesen Skill, wenn ein KI-Telefonassistent Anrufe entgegennehmen, Auskünfte geben, transkribieren und Termine koordinieren soll.
---

# Telefon- und Voice-Agent

**Kategorie:** communication

## Architektur
Telefonnummer/SIP/Telephony Provider → Audio-Streaming + STT → Dialoglogik/LLM → TTS → CRM/Kalender → Protokoll/Eskalation. Fish Audio deckt Sprachfunktionen ab, nicht automatisch die gesamte Telefonie.
## Ablauf
1. Festlegen, wann Anrufe an KI umgeleitet werden, welche Sprachen, Notfälle und Übergabefälle gelten.
2. Datenschutz- und Transparenzhinweise, etwa zur KI-Nutzung und etwaigen Aufzeichnungen, juristisch prüfen; nicht ungefragt Gespräche aufnehmen.
3. Echtzeitfähigkeit, Latenz, Rufnummern, Providerkosten, Authentifizierung und Kalenderrechte testen.
4. Bei Personendaten/Tarifen keine Spekulation; bei sensiblen Fällen an Mitarbeitende weiterleiten.
5. Zuerst interner Testbetrieb, danach Genehmigung für Live-Telefonie.
## Ergebnis
Systemdiagramm, Anbieteroptionen, Testanruf-Checkliste, Kostenfelder, Datenschutzfragen, Go-Live-Kriterien.
## Quelle
- [Fish Audio Plugin](https://github.com/fishaudio/fish-audio-plugin)

## Qualitäts- und Sicherheitsregel
Wenn eine genannte API, ein Tool, Account oder ein Zugang fehlt, simuliere keine aktive Verbindung. Zeige einen getesteten nächsten Schritt, markiere fehlende Zugriffe und fordere nötige externe Freigaben nur gezielt an. Fremdcode niemals ungelesen ausführen.
