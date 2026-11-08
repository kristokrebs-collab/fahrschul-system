#!/usr/bin/env python3
"""Deflated Sharpe Ratio (Bailey / López de Prado): wie wahrscheinlich ist ein echter Vorteil, wenn man viele Varianten probiert hat?
  dsr.py trials.csv      CSV: eine Spalte je getesteter Variante, eine Zeile je Periode (Rendite je Periode, z. B. täglich).
Gibt Sharpe je Periode (nicht annualisiert) der besten Variante und deren DSR (0..1) aus. Nur Standardbibliothek."""
import csv, math, sys
from statistics import NormalDist, mean, pstdev
N01 = NormalDist(); EULER = 0.5772156649015329

def moments(x):
    m = mean(x); s = pstdev(x)
    if s == 0: return m, 0.0, 0.0, 3.0
    z = [(v - m) / s for v in x]
    return m, s, mean(v ** 3 for v in z), mean(v ** 4 for v in z)

def sharpe(x):
    m, s, *_ = moments(x); return m / s if s else 0.0

def dsr(best, n_trials, sr_var):
    """best: Renditen der besten Variante. n_trials: Anzahl getesteter Varianten. sr_var: Varianz der Sharpes über alle Varianten."""
    T = len(best); m, s, sk, ku = moments(best); sr = m / s if s else 0.0
    if n_trials > 1 and sr_var > 0:
        sr0 = math.sqrt(sr_var) * ((1 - EULER) * N01.inv_cdf(1 - 1 / n_trials) + EULER * N01.inv_cdf(1 - 1 / (n_trials * math.e)))
    else: sr0 = 0.0
    den = 1 - sk * sr + (ku - 1) / 4 * sr ** 2
    if den <= 0: return sr, sr0, float("nan")
    return sr, sr0, N01.cdf((sr - sr0) * math.sqrt(T - 1) / math.sqrt(den))

def main():
    if len(sys.argv) != 2: sys.exit(__doc__)
    with open(sys.argv[1], newline="", encoding="utf-8") as f: rows = list(csv.reader(f))
    head, data = rows[0], rows[1:]
    cols = [[float(r[i]) for r in data if r[i] != ""] for i in range(len(head))]
    srs = [sharpe(c) for c in cols]; b = max(range(len(cols)), key=lambda i: srs[i])
    var = pstdev(srs) ** 2 if len(srs) > 1 else 0.0
    sr, sr0, p = dsr(cols[b], len(cols), var)
    print(f"Varianten: {len(cols)}  Perioden: {len(cols[b])}  beste: '{head[b]}'")
    print(f"Sharpe (je Periode) beste: {sr:.4f}   erwartetes Maximum bei purem Zufall: {sr0:.4f}")
    print(f"Deflated Sharpe: {p:.4f}  ->  {'Hinweis auf echten Vorteil (weiter prüfen, out-of-sample!)' if p >= 0.95 else 'NICHT belegt, Ergebnis kann Zufall/Overfitting sein'}")

if __name__ == "__main__": main()
