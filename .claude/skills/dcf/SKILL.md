---
name: dcf
description: >-
  /dcf: Discounted-Cash-Flow-Bewertung eines Unternehmens mit offengelegten Annahmen, Sensitivitätstabelle (WACC x Endwachstum) und ehrlicher Unsicherheit. Nutze bei "DCF", "faire Bewertung", "Unternehmenswert", "Kursziel berechnen", "ist die Aktie überbewertet". Historische Zahlen aus SEC EDGAR (trader-analyst) oder vom Nutzer; Rechnung deterministisch über scripts/dcf.py. Liefert Spannen, keine Punktprognose und keine Finanzberatung.
---

# /dcf

**Erst fragen** (kurz): Ticker, Horizont (Standard 5 Jahre), Annahmen selbst setzen oder Vorschlag? Nie Annahmen stillschweigend wählen.

1. **Basis holen:** Umsatz, operatives Ergebnis, Steuersatz, Capex, Abschreibung, Working Capital, Nettoverschuldung, verwässerte Aktien aus SEC EDGAR (`python3 "${CLAUDE_SKILL_DIR}/../trader-analyst/facts.py" …`, siehe dessen SKILL.md) oder vom Nutzer. Fehlende Zahl = fragen.
2. **Annahmen als Tabelle zeigen** (Umsatzwachstum je Jahr, EBIT-Marge, Steuersatz, Reinvestitionsquote, WACC, Endwachstum) mit je einer Begründung. Endwachstum ≤ langfristiges BIP-Wachstum und < WACC.
3. **Rechnen** mit dem Skript (kein Kopfrechnen):
```bash
python3 "${CLAUDE_SKILL_DIR}/scripts/dcf.py" --fcf 100,110,121,133,146 --wacc 0.09 --g 0.025 --net-debt 300 --shares 50
```
Ausgabe: Unternehmenswert, Eigenkapitalwert, Wert je Aktie, Anteil des Endwerts, Sensitivität (WACC ±1 %, g ±0,5 %).
4. **Ergebnis als Spanne** (Sensitivität), mit dem Hinweis, wie viel vom Wert im Endwert steckt (oft > 60 %), und Vergleich zum Marktpreis nur, wenn der Preis mit Quelle vorliegt.
5. Abschluss: *Modellrechnung, keine professionelle Finanzberatung.*
