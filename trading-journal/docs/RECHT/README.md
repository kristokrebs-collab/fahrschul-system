# Rechtsentwürfe (alles Entwurf – Prüfung durch Anwalt nötig)

Dies ist **keine Rechtsberatung** und kein Nachweis von Rechtskonformität. Die Texte sind Vorlagen aus dem Stand des Codes; ein Anwalt muss sie prüfen, bevor die App Geld nimmt. Die App erfindet nie Betreiberdaten: jede Angabe kommt aus `VITE_LEGAL_*` (siehe `SETUP.md` 4.2, `docs/ENV.md`), was fehlt, ist ein **markierter Platzhalter**.

| Datei | Inhalt | In der App |
|---|---|---|
| `impressum.md` | Impressum nach § 5 DDG, Felder = `VITE_LEGAL_*` | Einstellungen › Rechtliches › Impressum (aus den Betreiberdaten) |
| `datenschutz.md` | Datenschutzerklärung nach Art. 13 DSGVO | Rechtliches › Datenschutz (Entwurf, bis `VITE_LEGAL_DATENSCHUTZ_URL` gesetzt ist) |
| `agb.md` | AGB: Leistung, Laufzeit, Verlängerung, Kündigung, Haftung | Rechtliches › AGB (Entwurf, bis `VITE_LEGAL_AGB_URL` gesetzt ist) |
| `widerruf.md` | Widerrufsbelehrung, Muster-Formular, Zustimmung zum sofortigen Beginn, Widerrufsfunktion | Rechtliches › Widerruf (Entwurf, bis `VITE_LEGAL_WIDERRUF_URL` gesetzt ist) |
| `preisangaben.md`, `risikohinweis.md`, `partnerlinks.md`, `marken.md` | Preise und Steuern, Risikohinweis, Werbekennzeichnung, Marken | Rechtliches › Hinweise (alle vier in einem Dokument) |
| `kuendigung-widerruf.md` | Wie die App Kündigung (§ 312k) und Widerruf (§ 356a) ohne Login löst, warum, und was offen ist | nur Dokumentation (Seiten `/?kuendigen`, `/?widerruf`) |
| `anwaltsfragen.md` | Liste der offenen Anwaltsfragen | nur Dokumentation |

Die Prüfliste mit Befunden aus dem Code steht in `docs/RECHT-CHECKLISTE.md`.

## Schreibweise der Entwürfe

- `{{VITE_LEGAL_OPERATOR}}` und die anderen `{{VITE_LEGAL_…}}`: Betreiberdaten; in der App der Wert oder ein markierter Platzhalter.
- `{{TODO: …}}`: etwas, das der Betreiber klären muss (Frist, Region, Behörde …); in der App immer ein markierter Platzhalter, nie Text, der final aussieht.
- `> **[ANWALT]** …`: Hinweis an den Anwalt; wird in der App nicht angezeigt.
- Die In-App-Ansicht (`src/legal/LegalDocument.tsx`) liest diese Dateien direkt (`?raw`); es gibt keine zweite Kopie. Sie zeigt über jedem Entwurf eine Entwurfs-Leiste, außer der Betreiber setzt `VITE_LEGAL_DRAFTS_REVIEWED=true` (seine eigene Erklärung, die App prüft nichts).
- Hat der Betreiber eine eigene Seite hinterlegt (`VITE_LEGAL_*_URL`), öffnet die App diese statt des Entwurfs.
