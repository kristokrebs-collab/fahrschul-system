# `src/domain/dcf` – DCF-Rechner (`/dcf`)

Der Barwert freier Cashflows mit offengelegten Annahmen, Sensitivität und ehrlicher Unsicherheit – die Rechnung des Skills `/dcf` (`scripts/dcf.py`) nachgebaut, deterministisch, ohne Sprachmodell. Oberfläche: `src/views/analyst` (`DcfPanel`). Modellrechnung, keine Prognose, keine Kaufempfehlung. Keine professionelle Finanzberatung.

| Datei | was |
|---|---|
| `dcf.ts` | `runDcf`, `valueFromFcf` (das `value()` des Skripts), `checkAssumptions`, `sensitivity` (5 × 5), `rangeOf`. |
| `series.ts` | `SimpleAssumptions` (Formularwerte: Start- und Endwert von Wachstum, Marge, Reinvestition) → `DcfAssumptions` je Jahr (Gerade dazwischen); `buildAssumptions` nennt fehlende Eingaben. |
| `reverse.ts` | `impliedGrowth`: welches gleichbleibende Umsatzwachstum bräuchte das Modell für einen Zielwert („Was müsste stimmen?“). |
| `seed.ts` | `seedFromAnalyst`: Ausgangszahlen aus den gemeldeten SEC-Zahlen (TTM-Umsatz, operative Marge, Steuersatz, Reinvestition, Nettoverschuldung, Aktien) mit dem Satz, woher jede kommt – **keine** Annahme über die Zukunft. |

## Rechnung
Umsatz_t = Umsatz_{t−1} · (1 + Wachstum_t); EBIT_t = Umsatz_t · Marge_t; NOPAT_t = EBIT_t · (1 − Steuersatz); FCF_t = NOPAT_t · (1 − Reinvestitionsquote_t).
Barwert = Σ FCF_t / (1 + WACC)^t (t = 1 … N, Cashflows am **Jahresende**); Endwert = FCF_N · (1 + g) / (WACC − g), abgezinst mit (1 + WACC)^N; Unternehmenswert = Barwert + Endwert-Barwert; Eigenkapitalwert = Unternehmenswert − Nettoverschuldung; Wert je Aktie = Eigenkapitalwert / verwässerte Aktien.
Handrechnung im Test (`tests/unit/dcf.test.ts`): Umsatz 1.000, 3 Jahre à +10 %, Marge 20 %, Steuer 25 %, Reinvestition 40 % → FCF 99 / 108,9 / 119,79; bei WACC 10 % ist jeder Barwert genau 90; Endwert 1.527,3225 → Barwert 1.147,5; Unternehmenswert 1.417,5, Endwert-Anteil 80,95 %; bei Nettoverschuldung 200 und 50 Aktien 24,35 je Aktie. Das Beispiel des Skills (`--fcf 100,110,121,133,146 --wacc 0.09 --g 0.025 --net-debt 300 --shares 50`) ergibt Unternehmenswert 1.963,21 und 33,26 je Aktie; eine ewige Rente von 100 bei 10 % ist 1.000 wert.

## Ehrlichkeit
- **Spanne statt Punktwert.** Das Ergebnis ist das Minimum und Maximum über den inneren 3 × 3-Block der Tabelle (WACC ± 1 Punkt, Endwachstum ± 0,5 Punkte); der Rechenwert bei den eigenen Annahmen steht klein daneben.
- **Endwert-Anteil** (Barwert des Endwerts / Unternehmenswert) steht immer da, mit dem Satz, dass er meist den größten Teil ausmacht.
- **Nichts wird still gewählt.** Wachstum, WACC und Endwachstum sind Eingaben der Person; `EXAMPLE_RATES` (WACC 9 %, Endwachstum 2,5 % – die Zahlen der Anleitung) gibt es nur auf Klick und mit dem Etikett „keine Prognose“. Fehlt eine Eingabe, nennt das Panel sie („Es fehlt: …“) und rechnet nicht.
- **Randfälle:** WACC ≤ Endwachstum → Fehler mit Grund, kein Wert (Zellen der Tabelle bleiben leer, „–“); letzter FCF ≤ 0 → Status `no-terminal` („Endwert nicht sinnvoll“), keine Zahl; negativer FCF in früheren Jahren → Warnung; Eigenkapitalwert ≤ 0 → Warnung; Warnungen bei Endwachstum > 4 %, WACC < 5 % oder > 20 %, Wachstum > 50 %, Marge > 60 %.
- **Vergleich mit dem Kurs** nur, wenn die Person Kurs UND Quelle eintippt – die App hat hier keine Aktienkurse.
- Nicht enthalten: Mitte-des-Jahres-Abzinsung, Veränderung des Betriebskapitals als eigene Zeile (steckt in der Reinvestitionsquote; der Vorschlag aus den SEC-Zahlen rechnet (Investitionen − Abschreibungen) / NOPAT **ohne** Betriebskapital und sagt das), Währungsumrechnung, Dividenden, Aktienoptionen.
