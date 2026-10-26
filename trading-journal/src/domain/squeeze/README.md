# `src/domain/squeeze` – Squeeze-Beobachtung (F07), der reine Teil

Pure TypeScript. Liest die Reihen des Datenarchivs (F26), keine Eingaben aus dem Netz. Karte: `src/views/markt/SqueezeCard.tsx`,
Archivzugriff und Alarm: `src/market/squeeze`.

**Die Regel** (`evaluate.ts`; ein Messwert ohne Daten ist „keine Daten“ und zählt nie als erfüllt):

| Messwert | gilt, wenn | Seite |
|---|---|---|
| Funding | Betrag der zuletzt abgerechneten Rate ≥ Schwelle (Standard 0,05 % je Abrechnung) | Long bei > 0, Short bei < 0 |
| Open-Interest-Anstieg | Anstieg ≥ Schwelle über das Fenster (Standard +5 % in 4 h; 1 / 4 / 24 h); der Vergleichswert von vor dem Fenster liegt im Archiv (± 10 % des Fensters, mindestens 15 min) | keine – verstärkt nur |
| Konten | Long-Anteil ≥ Schwelle (Standard 65 %) oder ≤ 100 − Schwelle | Long / Short |

Funding und Konten dürfen nicht gegeneinander zeigen („gegensätzlich“, keine Beobachtung). Die Beobachtung gilt, wenn mindestens
`minMet` Messwerte (Standard 2 von 3) auf derselben Seite halten und mindestens einer davon Funding oder Konten ist – das Open
Interest allein genügt nie. Das „Jetzt“ verlangt einen frischen letzten Eintrag (2,5 Takte, mindestens 30 min): ein Archiv, das gerade nicht
läuft, liefert keinen alten Wert als aktuellen.

`situation.ts`: die überfüllte Seite neben der Box-Phase (vor dem Ausbruch / nach dem Ausbruch mit oder gegen die Menge / nach
einem Fehlausbruch), beschreibend („möglich“, „bisher“), nie eine Anweisung. `history.ts`: frühere Fälle derselben Beobachtung im
Archiv (aufeinanderfolgende Messpunkte = ein Fall) und was der Markpreis 4 h / 24 h später tat, **zugunsten der Menge** gerechnet,
Gegenbeispiele gezählt, Stichprobenwort wie in der Signalbilanz (keine / zu wenig / dünn / tragfähig); ohne Preis am Ende kein Ergebnis.
`config.ts`: `settings.squeeze` (`{ v: 1, fundingPct, oiRisePct, oiHours, longPct, minMet, alerts }`, versioniert, Passthrough,
Alarm **aus** bis zum ausdrücklichen Einschalten). Tests: `squeeze.domain.test.ts` (Handrechnung, synthetisches Archiv).
