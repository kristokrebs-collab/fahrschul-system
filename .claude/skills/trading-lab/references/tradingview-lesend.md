# TradingView lesend (Stand 2026-10-30)

Freigabe des Nutzers: „TradingView lesend“. Genutzt wird der vorhandene Konnektor **nur zum Lesen** (Kurse/OHLCV, Symbolsuche). **Nicht** genutzt: Alerts anlegen/ändern, Watchlists schreiben, Orders. Webhooks sind nicht eingerichtet.

- Test am 2026-10-30: `mcp-tv-get-ohlcv` für `AMEX:SPY`, Intervall 1D, 5 Balken, letzter Balken 30.10.2026 (noch laufend). Die Daten kommen laut Konnektor aus dem TradingView-Plan des Nutzers (ggf. verzögert).
- Rolle: Kontrolle/Aktualität. Die 10.000-Varianten-Läufe nutzen die Ken-French-Branchendaten (bis 30.09.2026), weil sie bis 1926 reichen. Live-Kurse aus TradingView ersetzen sie nicht.
- Idee für später (nicht gebaut): ETF je Branche zuordnen und den letzten Schluss gegen das Signal des Prüfstands halten.
- Ein „Binding“, das Signale automatisch ins Protokoll überträgt, wäre ein Webhook-Empfänger (TradingView-Alert → URL). Das ist ein Dienst/eine Verbindung und braucht vorher deine Freigabe; bis dahin bleibt es bei Datei-Protokoll.
