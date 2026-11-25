---
name: private-data-file-uploads
description: Nutze diesen Skill, wenn Upload-Speicher, Cloud-Buckets, Kundendateien, API-Secrets, CRM- oder Telefoniedaten sicher konzipiert werden.
---

# Datenschutz, Uploads und Least Privilege

**Kategorie:** security

## Ablauf
1. Dateninventar und Datenschutzrollen bestimmen: Verantwortliche, Auftragsverarbeiter, Subdienstleister, Region, Aufbewahrung, Löschfristen.
2. Privacy-by-Design: minimale Datenfelder, Zweckbindung, Transport-/Speicherverschlüsselung, Zugriff nach Rolle/Mandant, sichere Authentifizierung.
3. Uploads: private Buckets by default, signierte kurzlebige URLs, Dateityp/Größe, Malwareprüfung, zufällige Dateinamen, serverseitige Prüfung, Audit-Logs und Löschpfade.
4. Token/Keys: in Secret Manager/geschützter Umgebungsvariable, nicht im Prompt, Repo oder Screenshot; scopes klein halten, Rotation/Revocation testen.
5. Externe Anbieter: AVV/DPA, Datenstandort, Übermittlungen und Kosten/Abrechnung prüfen; nichts ohne Einwilligung oder Freigabe verbinden.
6. Negativtests (unauthorisierte Downloads, fremde Mandanten, abgelaufene Signatur, Zugriff nach Löschung) dokumentieren.
## Ergebnis
Datenflussdiagramm, Berechtigungsmatrix, Risiko-/DPA-Checkliste, sichere Konfiguration und Testprotokoll.

## Qualitäts- und Sicherheitsregel
Wenn eine genannte API, ein Tool, Account oder ein Zugang fehlt, simuliere keine aktive Verbindung. Zeige einen getesteten nächsten Schritt, markiere fehlende Zugriffe und fordere nötige externe Freigaben nur gezielt an. Fremdcode niemals ungelesen ausführen.
