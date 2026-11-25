---
name: uiverse-lookup
description: Findet fertige CSS/HTML-Elemente aus Uiverse (über 3000: Buttons, Cards, Loader, Toggles, Inputs, Formulare, Tooltips, Patterns) in einem lokalen Klon von uiverse-io/galaxy und gibt nur die passenden Treffer aus, token-sparsam statt Seitenbrowsen. Nutze bei "Uiverse", "reines CSS Button", "CSS-only Loader", "Toggle Switch", "Hover-Karte ohne JavaScript" oder wenn ein kleines Widget ohne Bibliothek gebraucht wird. Klon einrichten mit setup-claude-extras.sh uiverse.
---

# Uiverse nachschlagen (lokal, MIT)

Quelle: https://github.com/uiverse-io/galaxy (MIT, Archiv von Uiverse.io, über 3000 Elemente, jeder Eintrag mit „From Uiverse.io by <Autor> - Tags: …“ im Kommentar). Namensnennung ist nicht Pflicht, wird aber gewünscht: den Kommentar im Code stehen lassen.

## Einrichten (einmalig, auf Deinem Rechner)
`.claude/setup/setup-claude-extras.sh uiverse` klont nach `~/uiverse-galaxy` (ca. 20 MB). Eigener Pfad: Umgebungsvariable `UIVERSE_DIR`.

## Benutzen
```bash
python3 "${CLAUDE_SKILL_DIR}/scripts/find.py" button glow            # Treffer nach Tags/Dateiname
python3 "${CLAUDE_SKILL_DIR}/scripts/find.py" loader -c loaders -n 8  # nur Kategorie "loaders", 8 Treffer
python3 "${CLAUDE_SKILL_DIR}/scripts/find.py" --show Buttons/boryanakrasteva_sour-cow-47.html
```
Kategorien: Buttons, Cards, Checkboxes, Forms, Inputs, Notifications, Patterns, Radio-buttons, Toggle-switches, Tooltips, loaders.

## Vorgehen
1. Erst suchen, **nie** ganze Ordner lesen (Token). 3 bis 5 Treffer anzeigen lassen, einen mit `--show` ausgeben.
2. Prüfen: `[ok]` = Animation nur mit transform/opacity; `[Paint]` = animiert Layout/Farbe (box-shadow, width, background …), bei 120 Hz sparsam einsetzen.
3. An das Projekt anpassen (Farben als CSS-Variablen, `prefers-reduced-motion` ergänzen, Klassennamen mit Präfix, damit nichts kollidiert) und den Herkunftskommentar behalten.
4. Für Animationen mit Federphysik oder Mehrstufigkeit lieber `pulse-motion` nehmen.
