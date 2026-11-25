---
name: browser-visual-qa
description: Nutze diesen Skill für End-to-End-Browserprüfungen, automatische Screenshots, responsive Tests und UI-Regressionskontrollen.
---

# Browser- und Screenshot-QA

**Kategorie:** design

## Ablauf
1. Testumgebung, URL, Rollen, Auth, erwartete Zustände und Testdaten bestimmen. Keine Produktivdaten ohne Freigabe verändern.
2. Mit dem vorhandenen Browser-/Playwright-Werkzeug kritische Flows durchspielen: Formulare, Navigation, Fehlermeldungen, Upload, mobile Breakpoints.
3. Screenshots für definierte Zustände erzeugen; dynamische Elemente stabilisieren.
4. Konsole/Netzwerk (keine Credentials veröffentlichen), Accessibility-Fehler, Fokusreihenfolge und sichtbare Regressionen prüfen.
5. Ergebnisse reproduzierbar mit Schritten, Erwartung, Ist, Priorität und Beleg liefern.
6. Tests nicht als erfolgreich melden, wenn Browser oder Zugang fehlen.
## Ergebnis
Testmatrix, reproduzierbare Befunde, Screenshots, Regressionsempfehlung und Release-Blocker.
## Quelle
- [Microsoft Playwright CLI](https://github.com/microsoft/playwright-cli)

## Qualitäts- und Sicherheitsregel
Wenn eine genannte API, ein Tool, Account oder ein Zugang fehlt, simuliere keine aktive Verbindung. Zeige einen getesteten nächsten Schritt, markiere fehlende Zugriffe und fordere nötige externe Freigaben nur gezielt an. Fremdcode niemals ungelesen ausführen.
