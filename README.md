# 🪪 Fahrschul-Cockpit · Schüler-PWA

High-End, installierbare Progressive Web App für Fahrschüler im *Quiet-Luxury*-Enterprise-Dark-Design.
Vollständige Umsetzung der Master-Spezifikation – **funktionsfähig, ohne Server**.

## ✨ Was drin ist

| Bereich | Umsetzung |
| :-- | :-- |
| **Onboarding** | Login (E-Mail/PW + Biometrie-Mock), Klassen- & Ausbildungsweg-Wahl, Verfügbarkeits-Raster |
| **Klassen-Matrix-Engine** | Alle 18 Führerscheinklassen, dynamische Pflichtstunden-Berechnung, Regel 1 (Zweit-Erwerb 12→6), Zweirad-Aufstiegslogik |
| **Dashboard** | Prüfungs-Ready-Krone (5 Bedingungen), Live-Countdown, Theorie-/Sonderfahrten-/Simulator-Tracker, Dokumenten-Radar, Finanz-Kachel mit Buchungssperre |
| **Zeit-Matching** | Verfügbarkeits-Raster + Live-Match-Vorschau, autonome Terminvorschläge an den Admin |
| **Theorie-Buchung** | Thema-X-Buchung mit flüssiger **Vollbild-Morphing-Transition**, Klassen-Sperre, Doppelbuchungs-Sperre, Soll-Deckelung |
| **Express-Lückenfüller** | Speed-Matching bei Storno → exklusive Blitz-Push an passende Kandidaten → „wer zuerst tippt" |
| **Haptik** | `navigator.vibrate()` – satter Doppel-Impuls (Bestätigung) & dumpfer Widerstand (Sperre) |
| **Echtzeit-Admin** | `admin.html` – Büro-Zentrale, die denselben Store live anzapft |
| **PWA** | `manifest.webmanifest` + Service Worker (offline-fähig, installierbar) |

## 🚀 Starten

```bash
# Beliebiger statischer Server (für Service Worker nötig)
python3 -m http.server 8099
# → http://localhost:8099/index.html   (Schüler-PWA)
# → http://localhost:8099/admin.html   (Büro-Zentrale)
```

**Echtzeit erleben:** PWA und Admin in zwei Browser-Tabs öffnen. Aktionen in einem Tab
erscheinen dank `BroadcastChannel` sofort im anderen – Terminvorschläge bestätigen,
Dokumente freigeben, Sonderfahrten werten, GO erteilen → alles wird live in die PWA gepusht.

## 🏗️ Architektur

```
index.html              Schüler-PWA-Shell
admin.html              Echtzeit-Büro-Zentrale
assets/js/engine.js     Deterministischer Kern: Matrix, Pflichtstunden, Matching, Prüfungs-Ready
assets/js/store.js      Gemeinsamer Realtime-Store (localStorage + BroadcastChannel)
assets/js/app.js        Router, Views & Automatisierungen (Schüler)
assets/js/admin.js      Admin-Logik
assets/js/ui.js         Haptik, Toasts, Konfetti, Icons
assets/css/app.css      Design-System (Spring-Animationen, Morphing, Glassmorphism)
manifest.webmanifest    PWA-Manifest
sw.js                   Service Worker (App-Shell-Caching)
```

Kein Build-Schritt, keine Abhängigkeiten – reines ES-Modul-JavaScript.
Die Engine ist Node-testbar (`node` ESM-Import von `engine.js`).
