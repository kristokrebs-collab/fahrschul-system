#!/usr/bin/env python3
"""Regelbasierte Vorprüfung eines Social-Entwurfs (Deutsch/Englisch). Kein Rechtsurteil. Nur Standardbibliothek.
  check_post.py entwurf.txt        (oder Text über stdin)   Exit 1 bei harten Treffern."""
import re, sys
HART = [
 (r"\b(garantiert|garantie|sicher(er)? gewinn|risikolos|ohne risiko|100 ?%\s*(gewinn|rendite|treffer))", "Renditeversprechen/Sicherheitsbehauptung"),
 (r"\b(guaranteed|risk[- ]free|can'?t lose|sure thing)\b", "Renditeversprechen/Sicherheitsbehauptung"),
 (r"\b(jetzt|sofort|heute)\s+(kaufen|einsteigen|verkaufen)\b|\b(kauft|kaufe|verkauft)\s+\$?[A-Z]{1,5}\b|\bbuy\s+\$?[A-Z]{1,5}\b|\bsell\s+\$?[A-Z]{1,5}\b", "Kauf-/Verkaufsaufforderung (persönliche Empfehlung)"),
 (r"\b(folge(t)? meinen signalen|kopiere meine trades|copy my trades|signal(e)? für (follower|euch))", "Signale an Follower"),
]
WEICH = [
 (r"\b(verpass(t|e)? nicht|letzte chance|nur heute|fomo|jetzt oder nie|last chance|don'?t miss)\b", "Angstmache/FOMO"),
 (r"\b(\d{2,4}\s?%|verdoppelt|x\s?\d+)\b", "Renditezahl: Zeitraum, Kosten, Paper/Live und Quelle angeben"),
 (r"\b(moon|to the moon|100x|rakete|pump)\b", "Hype-Sprache"),
]
PFLICHT = [
 (r"(keine anlageberatung|kein anlagetipp|not (financial|investment) advice)", "Hinweis 'keine Anlageberatung' fehlt (schützt allein nicht)"),
 (r"(risiko|totalverlust|verlust|risk|loss)", "Risikohinweis fehlt"),
 (r"(paper|backtest|simuliert|demo|real(handel)?|live)", "Kennzeichnung Paper/Backtest/Real fehlt"),
 (r"(quelle|source|stand:|datum|\d{1,2}\.\d{1,2}\.\d{2,4}|20\d\d-\d\d-\d\d)", "Quelle/Datum für Zahlen fehlt"),
]
def main():
    text = open(sys.argv[1], encoding="utf-8").read() if len(sys.argv) > 1 else sys.stdin.read()
    hard = 0
    for rx, msg in HART:
        for m in re.finditer(rx, text, re.I): hard += 1; print(f"[HART]   {msg}: '{m.group(0).strip()}'")
    for rx, msg in WEICH:
        for m in re.finditer(rx, text, re.I): print(f"[PRÜFEN] {msg}: '{m.group(0).strip()}'")
    for rx, msg in PFLICHT:
        if not re.search(rx, text, re.I): print(f"[FEHLT]  {msg}")
    print("Ergebnis:", "NICHT veröffentlichen, überarbeiten" if hard else "keine harten Treffer; trotzdem selbst prüfen (kein Rechtsurteil)")
    sys.exit(1 if hard else 0)
if __name__ == "__main__": main()
