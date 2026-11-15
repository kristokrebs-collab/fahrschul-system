#!/usr/bin/env python3
"""Zeitfenster-Analyse ("Time Filter"): Verhält sich ein Setup je nach Stunde anders? Nur Standardbibliothek.
  edge_windows.py trades.csv [--time-col timestamp] [--r-col r] [--min-n 30] [--min-win 0.55] [--perm 5000]
CSV: eine Zeile je Test-Trade mit Zeitstempel (ISO, Ortszeit der Börse!) und Ergebnis in R (Gewinn geteilt durch eingeplantes Risiko).
Wichtig: Wer 24 Stunden prüft, findet fast immer "ein bestes Fenster". Deshalb zusätzlich ein Permutationstest:
Wie oft ist das beste Fenster bei zufällig vertauschten Stunden mindestens so gut? Hoher p-Wert = wahrscheinlich Zufall.
Simulation/Backtest, kein Handelssignal."""
import argparse, csv, random, sys
from collections import defaultdict
from datetime import datetime

def hour_of(ts):
    return datetime.fromisoformat(ts.strip().replace("Z", "+00:00")).hour

def window_stats(rs):
    eq = peak = dd = 0.0
    for r in rs: eq += r; peak = max(peak, eq); dd = max(dd, peak - eq)
    n = len(rs); w = sum(1 for r in rs if r > 0)
    return n, w / n, sum(rs) / n, min(rs), dd

def best_avg(groups, min_n):
    vals = [sum(g) / len(g) for g in groups.values() if len(g) >= min_n]
    return max(vals) if vals else float("nan")

def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("csv"); p.add_argument("--time-col", default="timestamp"); p.add_argument("--r-col", default="r")
    p.add_argument("--min-n", type=int, default=30); p.add_argument("--min-win", type=float, default=0.55); p.add_argument("--perm", type=int, default=5000)
    a = p.parse_args()
    rows = []
    with open(a.csv, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            try: rows.append((row[a.time_col], hour_of(row[a.time_col]), float(row[a.r_col])))
            except (KeyError, ValueError) as e: sys.exit(f"Zeile unlesbar ({e}). Spalten: {a.time_col}, {a.r_col}")
    if len(rows) < 10: sys.exit("Zu wenige Trades für irgendeine Aussage.")
    rows.sort(key=lambda x: x[0])
    groups = defaultdict(list)
    for _, h, r in rows: groups[h].append(r)
    print(f"{len(rows)} Trades, {len(groups)} Stunden-Fenster getestet. Mindeststichprobe {a.min_n}, Mindest-Trefferquote {a.min_win:.0%}\n")
    print("Stunde    n  Treffer   Ø R   schlechtester  max.DD(R)  Urteil")
    found = []
    for h in sorted(groups):
        n, win, avg, worst, dd = window_stats(groups[h])
        if n < a.min_n: verdict = "ZU KLEIN, keine Aussage"
        elif avg > 0 and win >= a.min_win: verdict = "Kandidat (noch nicht belegt)"; found.append(h)
        else: verdict = "kein Vorteil"
        print(f"{h:02d}:00 {n:5d}  {win:6.0%} {avg:+6.2f}  {worst:+8.2f}     {dd:6.1f}   {verdict}")
    labels = [h for _, h, _ in rows]; rs = [r for _, _, r in rows]; obs = best_avg(groups, a.min_n)
    if obs == obs:
        random.seed(1); hits = 0
        for _ in range(a.perm):
            random.shuffle(labels); g = defaultdict(list)
            for h, r in zip(labels, rs): g[h].append(r)
            if best_avg(g, a.min_n) >= obs: hits += 1
        pv = (hits + 1) / (a.perm + 1)
        print(f"\nBestes Fenster Ø R = {obs:+.2f}. Permutationstest über alle Fenster: p = {pv:.3f}")
        print("  p >= 0.05: das beste Fenster ist von Zufall nicht zu unterscheiden. Nur mit neuen Daten bestätigen, nie an denselben Trades." if pv >= .05
              else "  p < 0.05: unwahrscheinlich nur Zufall, trotzdem an NEUEN Daten prüfen (Walk-forward).")
    if not found: print("Kein Fenster erfüllt die Kriterien.")
    print("Simulation/Backtest. Keine Anlageberatung.")

if __name__ == "__main__": main()
