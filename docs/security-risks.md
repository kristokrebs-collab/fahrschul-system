# Security Risks – Prototyp

Bewertung nach Schweregrad. Alle Punkte sind für den Produktionsbetrieb
**Blocker**, nicht "nice to have".

## Kritisch

1. **Statischer Zugangscode für die Büro-Zentrale** (`dashboard.html:713`,
   `ADMIN_PIN='1234'`). Kein Konto, keine Identität, kein Audit-Trail wer
   handelt. Jeder mit Codekenntnis hat Vollzugriff auf alle Schülerdaten.
2. **Keine serverseitige Autorisierung.** `server.py` prüft bei `/sync/admin`
   und `/sync/push` nicht, *wer* schreibt – jeder Client mit Netzwerkzugriff
   auf den Server kann jeden Datensatz beliebiger Rolle verändern.
3. **Flache JSON-Datei als "Datenbank"** (`sync-data.json`). Kein
   Zugriffsschutz auf Dateisystemebene über die App hinaus, keine
   Verschlüsselung ruhender Daten, kein Transaktionsschutz bei parallelen
   Schreibzugriffen außerhalb der CAS-Logik der Anwendung.
4. **Dokumente als Base64 im Client-/Sync-State.** Sehtest, Erste-Hilfe-Nachweis,
   Passbild landen unverschlüsselt in `localStorage` und in der JSON-Datei –
   keine Zugriffskontrolle, kein Malware-Scan, keine Löschfristen.
5. **Kein TLS.** `server.py` ist ein reiner HTTP-`http.server`. Zugangscode,
   Profildaten und Dokumente reisen im Klartext über das Netz.

## Hoch

6. **`postMessage`-Brücke ohne erkennbaren Origin-Check** zwischen
   eingebetteter Schüler-App und Zentrale – öffnet potenziell Cross-Frame-
   Injection, falls die Zentrale je nicht same-origin eingebettet wird.
7. **Kein Rate Limiting** auf `/sync/*` – ein Client kann beliebig oft
   schreiben/lesen, kein Schutz gegen Scraping oder Brute-Force auf den PIN.
8. **Keine Eingabevalidierung serverseitig erkennbar** – `do_POST` verarbeitet
   JSON-Bodies ohne Schema-Prüfung; Client-Felder werden vermutlich
   durchgereicht (weitere Verifikation im Code nötig, sobald echtes Schema
   vorliegt).
9. **Keine Session-Konzepte.** "Angemeldet bleiben" in `app.html` bedeutet
   vermutlich nur einen dauerhaften `localStorage`-Marker – kein Ablauf, kein
   Remote-Logout, kein Geräte-Widerruf.

## Mittel

10. **Keine Secret-Verwaltung** – es gibt keine `.env`/Secret-Store-Struktur;
    zukünftige Bank-/E-Mail-/Push-Credentials dürfen niemals im Repo landen
    (Blocker für Prompt 4/Integrationen).
11. **Kein Audit-Log** für sensible Aktionen (Prüfungsfreigabe, Zahlungsänderung,
    Dokumentprüfung) – Nachvollziehbarkeit fehlt vollständig.
12. **Keine Backup-/Restore-Strategie** für `sync-data.json`.

## Ausdrücklich verboten laut Auftrag (Non-Negotiables), aktuell aber vorhanden

- Produktivdaten in `localStorage` → vorhanden, muss vollständig entfernt werden.
- Demo-PIN → vorhanden, muss durch echte Konten/MFA ersetzt werden.
- Fest codierte Schüler/Fahrlehrer/Preise/Fahrzeuge → vorhanden (drei
  Kopien derselben Fahrlehrerliste), muss durch DB-Stammdaten ersetzt werden.
- Automatische Prüfungsfreigabe → im Prototyp nicht implementiert (`Tacho`
  liefert nur eine Diagnoseanzeige, kein Freigabe-Trigger) – **muss so bleiben**,
  explizit als Nicht-Ziel in Prompt 1/3 markiert.
- Terminbuchung ohne serverseitige Konfliktprüfung → im Prototyp nur
  clientseitig geprüft (`matchingSlots`-artige Funktionen laufen im Browser).

## Empfehlung

Kein Teil des aktuellen Sync-Servers oder der PIN-Auth darf unverändert in
Produktion übernommen werden. Prompt 0 muss Auth, Rollen und
Persistenz vollständig neu, serverseitig, aufbauen, bevor App-Features
(Prompt 1–4) produktiv geschaltet werden.
