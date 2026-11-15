# Kronos (Kerzen-Prognosemodell), nur auf Deinem Rechner

Quelle: https://github.com/shiyu-coder/Kronos (MIT, AAAI 2026). Decoder-Modell für OHLCV-Kerzen; Gewichte kommen von Hugging Face (`NeoQuasar/Kronos-small`, `-base`, `-mini`). Läuft **nicht** in der Cloud-Sitzung (PyTorch + Modell-Download); Einrichtung: `.claude/setup/setup-claude-extras.sh kronos`.

## Nutzung (aus dem README, gelesen, hier nicht ausgeführt)
```python
from model import Kronos, KronosTokenizer, KronosPredictor
tok = KronosTokenizer.from_pretrained("NeoQuasar/Kronos-Tokenizer-base")
model = Kronos.from_pretrained("NeoQuasar/Kronos-small")
pred = KronosPredictor(model, tok, max_context=512)   # max. 512 Kerzen Kontext bei small/base
# df: Spalten open, high, low, close, volume (amount optional) + Zeitstempel
out = pred.predict(df=x_df, x_timestamp=x_ts, y_timestamp=y_ts, pred_len=24, T=1.0, top_p=0.9, sample_count=1)
```
Mehrere Läufe (`sample_count` > 1 bzw. wiederholt) zeigen die Streuung: Spanne berichten, nicht Mittelwert allein.

## Wie Claude Kronos-Ausgaben behandelt
- Als **Szenario-Hinweis**, nie als Signal oder Order-Auslöser. Nie ohne Streuung, Datenzeitraum und Modellgröße berichten.
- Trainiert/evaluiert vor allem auf Börsen-Kerzen; **keine Garantie** für Edge nach Gebühren und Slippage. Eigene Rückprüfung (`/trader-timemachine`, Walk-forward) vor jedem Vertrauen.
- Daten für `df`: Yahoo-Chart-Daten wie in `trader-timemachine`. Die Beispiele im Repo ziehen teils von `push2his.eastmoney.com` (chinesische Quelle), das nicht verwenden.
- Pickle-Dateien aus dem Repo (`finetune/`) nie aus unbekannter Quelle laden.
