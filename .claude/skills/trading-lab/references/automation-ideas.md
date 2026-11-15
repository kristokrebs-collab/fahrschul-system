# Automations-Ideen für Trading-Alltag (Stand 2026-10, Recherche)

Grundsatz: **Erzeugen und Veröffentlichen trennen.** Entwürfe landen in einem Prüffeld, ein Mensch gibt frei (n8n bietet dafür „Human in the loop“-Knoten; Vorlagen mit E-Mail-Freigabe vor dem Posten existieren, z. B. für LinkedIn). Keine ungeprüfte Generierung direkt an einen Veröffentlichungs-Knoten.

| Idee | Ablauf | Risiko / Kontrolle |
|---|---|---|
| Morgenbriefing | `/morning-note` täglich per Zeitplan an E-Mail | nur lesen; Quelle+Zeit nennen |
| Earnings-/8-K-Wächter | `trader-news` auf Watchlist, Zusammenfassung bei neuem Filing | Fehlalarme; keine Order daraus |
| Strategie-Fließband | neue Idee → Backtest → Walk-forward → DSR → Journal-Paper | Mehrfachtest-Korrektur Pflicht |
| Wochen-Rückblick | `journal.py review` jeden Freitag → Entwurf | nur Vorschläge |
| Preis-/Stop-Alarme | `trader-alerts` | nur Hinweis, kein Auto-Handel |
| Content-Recycling | Rückblick → Postentwürfe (`social-drafts`) → manuelle Freigabe → manuelles Posten | Finanzwerbung, siehe `social-drafts` |
| Mustersuche | Scanner-Treffer sammeln, in Journal als „Setup“ ohne Trade markieren, später Trefferquote messen | Stichprobe klein |

**Nicht empfohlen:** automatisches Posten ohne Prüfung, Orders aus Social-Signalen oder Chat-Nachrichten, „sich selbst optimierende“ Live-Bots, kopierte Signale fremder Accounts. Quellen: [n8n-Freigabe-Vorlagen](https://growwstacks.com/blog/automate-linkedin-posts-n8n/), [Multi-Plattform-Freigabeschleife](https://www.growwstacks.com/workflows/linkedin-content-machine-email-approved-posts-with-gemini-ai); X-API-Zugang und Kosten nicht geprüft.
