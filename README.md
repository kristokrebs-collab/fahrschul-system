# Fahrschule Krebs · Digitales Fahrschul-System

Drei live gekoppelte Oberflächen + ein Mini-Server. Keine Installation nötig,
nur Python 3 (auf Windows/macOS/Linux vorinstalliert oder frei erhältlich).

| Datei | Wer nutzt sie | Was sie kann |
|---|---|---|
| `dashboard.html` | Büro / Inhaber (**Zugangscode: 1234**) | 100+ Schüler & 15 Fahrlehrer verwalten, Suche/Sortierung/Filter, Akte mit Theorie/Praxis/Zahlungen/Nachweisen, Smart-Matching absegnen (mit Überbuchungsschutz), Aktivitäts-Feed, Ausfall-Alarm, CSV-Export |
| `app.html` | Fahrschüler (Handy) | Registrierung & Login („angemeldet bleiben"), Ausbildungs-Cockpit, Wunschzeiten, Sehtest/Erste-Hilfe/Passbild hochladen, Termine & Historie |
| `fahrlehrer.html` | Fahrlehrer (Handy) | Anstehende Fahrten (wer/wann/wo/Fahrtart) mit Anruf & Navigation, Fahrstil-Bewertung beim Bestätigen, Arbeitszeiten pflegen (= Matching-Basis), „Heute krank"-Panikknopf, Historie mit Abrechnungs-Status |
| `server.py` | – | Liefert alle Seiten aus und synchronisiert alles zwischen den Geräten in Echtzeit |

## Start (1 Befehl)

```
python3 server.py
```

Der Server zeigt dann die drei Adressen an:

- **Zentrale (PC/Tablet):** `http://localhost:8000/dashboard.html` – Zugangscode `1234`
- **Schüler-App (Handy im gleichen WLAN):** `http://<IP-des-PCs>:8000/app.html`
- **Fahrlehrer-App (Handy):** `http://<IP-des-PCs>:8000/fahrlehrer.html`

Ohne Server funktioniert die Zentrale auch per Doppelklick – die Schüler-App
öffnet sich dann über den Button „Schüler-App" direkt in der Zentrale.
Geräteübergreifend (Handy ↔ PC) braucht es den Server.

## Der Kreislauf in 60 Sekunden

1. Schüler registriert sich am Handy → erscheint **sofort** in der Zentrale
   (LIVE-Badge + Glocken-Meldung „Neue Anmeldung").
2. Büro weist einen Fahrlehrer zu und **segnet einen Matching-Termin ab**
   (Vorschläge = Wunschzeiten des Schülers × Dienstplan des Fahrlehrers;
   bereits belegte Slots werden automatisch ausgeblendet).
3. Fahrlehrer sieht den Termin in seiner App (Uhrzeit, Datum, Treffpunkt,
   empfohlene Fahrtart), ruft bei Bedarf an oder startet die Navigation.
4. Nach der Fahrt: „Stattgefunden" → Fahrstil kurz bewerten → Fahrt wird
   **abgerechnet**, Stunden & Telemetrie des Schülers aktualisieren sich in
   derselben Sekunde, die Zentrale bekommt die Meldung.
5. Fällt ein Fahrlehrer aus: Panik-Knopf → roter Alarm in der Zentrale,
   Matching für den Tag automatisch gesperrt.

## Daten & Grenzen

- Alle Daten liegen in `sync-data.json` neben dem Server (löschen = Reset)
  bzw. im Browser-Speicher der Geräte.
- Das System ist ein voll funktionsfähiger Prototyp für den Betrieb im
  eigenen Netz. Für einen öffentlichen SaaS-Betrieb (Internet, viele
  Fahrschulen) sind echte Nutzerkonten mit Server-Authentifizierung, eine
  Datenbank (z. B. PostgreSQL mit Row-Level-Security und
  Exclusion-Constraints gegen Doppelbuchungen) und HTTPS erforderlich –
  die Datenmodelle dieses Prototyps sind dafür bereits passend geschnitten.
