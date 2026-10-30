# Harvey-Muster für den Trading-Prüfstand

Quelle: https://github.com/ethanplusai/harvey (MIT, öffentlich, gelesen am 2026-10-30; README, `harvey/gate.py`). **Harvey ist ein autonomer Vertriebsagent für Kalt-E-Mails, kein Trading-Projekt.** Es wurde **kein Code kopiert** und kein E-Mail-/Outreach-Teil übernommen. Übernommen sind nur Bauweisen, die zu deiner Regel „keine Order ohne ausdrückliches Ja“ passen:

| Harvey-Idee | Hier umgesetzt als |
|---|---|
| **Approval als Standard** („Nothing sends without you“) | `lab/outbox.json`: jedes Demo-Signal startet als „wartet auf deine Freigabe“ |
| **Entscheidungs-Pult, ein Eintrag nach dem anderen**, bewusst kein „alles freigeben“ | `outbox.py` zeigt/entscheidet genau ein Signal; es gibt keinen Sammel-Knopf |
| **Notaus** („sending pause“) | `outbox.py pause` legt `lab/PAUSE` an; solange sie da ist, ist keine Freigabe möglich |
| **Deterministisches Tor in Code, nicht im Prompt** (`gate.py`) | `megatest.py`: Tor-Prüfungen sind Rechnung (Deflated Sharpe, Endtest, Plateau, Kosten, Monte-Carlo), kein Modell-Urteil |
| **Tageslimit/Ruhezeiten** | im Tool `trader-risk` vorhanden; hier nicht neu gebaut |
| **Protokoll jeder Entscheidung** | `lab/vault/protokoll.jsonl` (Signale) und `lab/vault/papier_freigaben.jsonl` (Entscheidungen) |
| **Today-Ansicht/Dashboard** | `assets/megatest.html` (Fächer, Tor, Signale, Warteschlange) |

Nicht übernommen: Prospecting, Cold-Email-Schreiben, Versand, Postfach-Integrationen, Subscription-Runtime. Grenze: Freigabe im Tool ist **Papier**. Eine echte Order bräuchte weiterhin dein ausdrückliches „Ja“ im Chat und läuft über `trader-risk` und `trader-broker`.
