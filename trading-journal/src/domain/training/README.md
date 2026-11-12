# `src/domain/training` – Lernmodus / Replay-Training (F38)

Wiederkehrende **eigene** Situationen (die Trades eines Setups aus dem Journal) ohne sichtbare Zukunft üben. Rein; die UI steht in
`src/views/ueben`.

Belohnt werden **Erkennen, Regelbefolgung und Reflexion** – nie ein Gewinn: kein Hebel, keine Punkte aus Gewinnhöhe, kein Ranking, kein „Score“.
Der Ausgang des Fall-Trades wird nach dem Aufdecken gezeigt, fließt aber in keine Zahl der Auswertung ein.

| Datei | Inhalt |
|---|---|
| `model.ts` | `settings.training` (Datensatz, Leser/Schreiber, Merge), `TrainingRound` |
| `decision.ts` | das Entscheidungsformular als Regeln: `decisionGaps`, `stopCheck`, `ruleResult` (Checkliste), `decisionOfDraft` |
| `cases.ts` | `decisionAt` / `visibleBars` (wo der Chart endet), `caseWindow`, `buildQueue` (Sitzung, seeded), `planOutcome` (Plan auf den echten Kerzen, nur nach dem Aufdecken) |
| `stats.ts` | `trainingStats`, `sampleLine` / `rateText` (Stichprobe, Prozent erst ab `MIN_SAMPLE` = 10), `marksOf`, `practisedSetups` |

## Speicherung – `settings.training`

```
settings.training = { v: 1, rounds: TrainingRound[] }      // Passthrough-Schlüssel wie settings.biasTests / settings.coach
```

Eine Runde ist ein Array-Eintrag mit `id` (`tr_…`): `merge3` (lokaler Adapter, Cloud-Settings-Zeile) führt zwei Geräte **pro id** zusammen (Edit
schlägt Delete). Schreiber (`withTrainingRound`, `withRoundPatch`, `withReflection`, `withoutRound`) liefern ein NEUES Settings-Objekt und lassen
alle anderen und alle unbekannten Schlüssel (auch innerhalb von `training` und jeder Runde) unberührt; der Leser (`trainingRoundsOf`) wirft
Unlesbares weg und schreibt nie zurück. Ein Journal ohne den Schlüssel liest sich als „keine Runden“. Höchstens `TRAINING_MAX` (400), die ältesten gehen zuerst.

```ts
TrainingRound {
  id; v; createdAt; updatedAt;
  setupId; tradeId; positive;           // geübtes Setup; Fall-Trade; trug er das Setup im Journal (die Wahrheit für „erkannt“)
  interval; anchorMs; blind;            // letzte sichtbare Kerze (Eröffnungszeit), Name/Datum verdeckt
  decision { action: long|short|wait, recognition: yes|no|unsure, stop|null, reason, checks{id:true}, at }
  rules { checked, total, stopOk|null, followed|null }
  recognized: boolean|null              // beim Lesen NEU aus decision + positive berechnet, nie aus dem Gespeicherten übernommen
  revealedAt?; reflection? { verdict, note, at }
}
```

## Reihenfolge und „keine Zukunft“

- `decisionAt`: der Chart endet an der **letzten Kerze, die vor dem Einstieg des Fall-Trades geschlossen hat** (mind. 20 Kerzen Vorlauf, sonst ist es kein
  Fall); `visibleBars` gibt dem Chart nur diese (höchstens 90) – Preisbereich und Zeitachse können nichts Späteres verraten.
- Die Entscheidung wird **mit Uhrzeit gespeichert, bevor** der Verlauf gezeigt wird (`persistRound` in der UI; ein fehlgeschlagener Schreibvorgang
  hält den Trader auf der Entscheidung). Danach ist sie nicht mehr änderbar; die Reflexion kommt später dazu (`withReflection`, verweigert ohne Aufdeckzeit).
- Pflichtfelder (`decisionGaps`): Einordnung (Ja / Nein / Unsicher), Richtung oder Warten, bei Einstieg ein Stopp auf der richtigen Seite (nicht enger als 0,05 %), eine Begründung.

## Was gezählt wird (`stats.ts`)

| Zählung | Nenner | Hinweis |
|---|---|---|
| Erkannt wie im Journal | Runden mit Ja/Nein (Unsicher separat) | gegen das gemessen, was der Trader damals eintrug – kein objektives Urteil |
| Regeln befolgt | Einstiege mit hinterlegter Checkliste | alle Regeln abgehakt **und** sinnvoller Stopp; Warten zählt nicht |
| Mit Reflexion | aufgedeckte Runden | irgendein geschriebener Satz |

Unter 10 Runden steht „zu wenig für eine Aussage“, Prozentwerte erst ab 10. Eine Sitzung mischt etwa zwei Drittel Situationen des Setups mit Situationen anderer Setups
(damit „Liegt mein Setup vor?“ auch mit Nein beantwortet werden kann); nicht geübte Fälle kommen vor lange nicht geübten.

Tests: `tests/unit/domain.training.test.ts`, `tests/unit/views.training.test.tsx`, E2E `tests/e2e/training.spec.ts`.
