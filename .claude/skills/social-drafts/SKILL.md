---
name: social-drafts
description: Entwürfe für Social-Media-Beiträge zu Trading und Finanzthemen (X, LinkedIn, Threads, Reels-Skripte) mit Pflichthinweisen und Prüfskript. Nutze bei "Post über Trading", "Trading-Account", "Finfluencer", "Marktkommentar posten", "Reel-Skript Börse". Erzeugt nur Entwürfe, prüft sie auf riskante Formulierungen (scripts/check_post.py) und übergibt an den Nutzer zur Freigabe; postet nie selbst, gibt keine persönlichen Anlageempfehlungen. Keine Rechtsberatung.
---

# Social-Drafts (Finanzinhalte, nur Entwürfe)

**Kein automatisches Posten, kein Posten in Deinem Namen.** Ablauf: Entwurf → `check_post.py` → Mensch prüft und postet selbst. Das ist keine Rechtsberatung; bei Geschäftsmäßigkeit oder Einnahmen mit einer auf Finanzrecht spezialisierten Person klären.

## Regeln aus den aktuellen Aufsichtshinweisen (Stand 2026-10, aus Sekundärquellen; Primärtexte von ESMA/BaFin prüfen)
- ESMA und BaFin haben im Januar 2026 ein gemeinsames Merkblatt für Finfluencer veröffentlicht, BaFin im August 2026 „fünf Hinweise“ ([BaFin-Hinweise](https://www.regulationtomorrow.com/2026/08/bafin-published-five-points-to-note-for-influencers/), [Skadden-Überblick](https://www.skadden.com/insights/publications/2026/10/social-media-meets-financial-regulation), [Rödl zum Merkblatt](https://www.roedl.com/insights/bafin-und-ema-nehmen-finfluencer-staerker-in-den-fokus-wie-muss-zukuenftig-finanzcontent-gestaltet-werden/)).
- Kernpunkte: ehrlich und nicht irreführend; **keine individuelle Anlageberatung ohne Erlaubnis**; Bezahlung/Provisionen/Kooperationen offenlegen; ein Hinweis „keine Anlageberatung“ **schützt nicht**, wenn der Beitrag faktisch eine Empfehlung ist; bei CFDs, Forex, Futures, volatilem Krypto deutliche Risikohinweise (Totalverlust möglich); keine Angstmache/FOMO („jetzt oder nie“); Livestreams, Chatgruppen und Workshops können in persönliche Beratung kippen.
- Plattformregeln (Werbung für Finanzprodukte, Zugang zur API) separat prüfen; nicht recherchiert.

## Beitragsformate (sicher)
1. **Lernnotiz:** „Was ich diese Woche beim Backtest gelernt habe“ (Methode, nicht Kaufsignal).
2. **Marktrückblick:** Fakten mit Quelle und Zeit, ohne „kaufen/verkaufen“.
3. **Fehler-Journal:** ehrlicher Rückblick (inkl. Verluste, Zeitraum, Paper/Live kennzeichnen).
4. **Erklär-Thread:** Begriff (R-Multiple, Drawdown, Overfitting) mit Beispiel.
5. **Reel-Skript:** Hook (Frage), 3 Punkte, Risikohinweis, kein Versprechen.

## Pflichtelemente jedes Entwurfs
Quelle + Datum für Zahlen · Kennzeichnung „Paper/Backtest“ oder „real“ · Zeitraum und Kosten bei Ergebnissen · Hinweis auf Risiko/Totalverlust bei Hebelprodukten · **Interessenkonflikte** (eigene Positionen, Provisionen) · „Keine Anlageberatung, nur meine Lernnotiz“ (als Zusatz, nicht als Schutzschild).

## Verboten
Renditeversprechen, „sicher“, „garantiert“, Kauf-/Verkaufsaufforderung zu einem Titel, Signale an Follower, Pump-Muster (Kleinwerte hypen), Screenshots mit nur Gewinnen, Zahlen ohne Zeitraum/Kosten, Kopieren fremder Inhalte.

## Prüfen
`python3 "${CLAUDE_SKILL_DIR}/scripts/check_post.py" entwurf.txt` meldet riskante Formulierungen (regelbasiert, **kein Rechtsurteil**, findet nicht alles).
