#!/usr/bin/env python3
"""Trade-Journal mit Fehleranalyse. Nur Standardbibliothek. Daten: trader/journal.json (nicht committen).
  journal.py add --strategy ORB --symbol TSLA --side long --entry 100 --exit 102 --stop 99 --mistakes late_entry,moved_stop --mode paper
  journal.py stats [--strategy ORB]     journal.py review [--strategy ORB]
Kein Broker-Zugriff, keine Orders. 'review' erzeugt nur Regelvorschläge als Entwurf; der Nutzer gibt frei."""
import argparse, json, os, sys, datetime

DEF = os.path.join("trader", "journal.json")

def load(p):
    if not os.path.exists(p): return []
    with open(p, encoding="utf-8") as f: return json.load(f)

def save(p, rows):
    os.makedirs(os.path.dirname(p) or ".", exist_ok=True)
    with open(p, "w", encoding="utf-8") as f: json.dump(rows, f, indent=1, ensure_ascii=False)

def r_multiple(side, entry, exit_, stop):
    risk = entry - stop if side == "long" else stop - entry
    if risk <= 0: raise ValueError("Stop muss bei long unter, bei short über dem Einstieg liegen")
    move = exit_ - entry if side == "long" else entry - exit_
    return move / risk

def cmd_add(a):
    r = r_multiple(a.side, a.entry, a.exit, a.stop)
    row = dict(id=len(load(a.file)) + 1, date=a.date or datetime.date.today().isoformat(), strategy=a.strategy, symbol=a.symbol.upper(),
               side=a.side, entry=a.entry, exit=a.exit, stop=a.stop, r=round(r, 3), mode=a.mode,
               mistakes=[m for m in (a.mistakes or "").split(",") if m], note=a.note or "")
    rows = load(a.file); row["id"] = len(rows) + 1; rows.append(row); save(a.file, rows)
    print(f"#{row['id']} {row['symbol']} {row['side']} R={row['r']:+.2f} ({row['mode']})")

def metrics(rs):
    n = len(rs); wins = [x for x in rs if x > 0]; loss = [x for x in rs if x <= 0]
    eq = peak = dd = 0.0
    for x in rs:
        eq += x; peak = max(peak, eq); dd = max(dd, peak - eq)
    pf = (sum(wins) / -sum(loss)) if loss and sum(loss) < 0 else float("inf") if wins else 0.0
    return dict(n=n, win=len(wins) / n if n else 0, avg_r=sum(rs) / n if n else 0, pf=pf, max_dd_r=dd, total_r=sum(rs))

def select(rows, strat): return [r for r in rows if not strat or r["strategy"] == strat]

def cmd_stats(a):
    rows = select(load(a.file), a.strategy)
    if not rows: print("Keine Trades."); return
    for key in sorted({(r["strategy"], r["mode"]) for r in rows}):
        rs = [r["r"] for r in rows if (r["strategy"], r["mode"]) == key]; m = metrics(rs)
        warn = "  ACHTUNG: unter 30 Trades, Zahl kaum aussagekräftig" if m["n"] < 30 else ""
        print(f"{key[0]:<14}{key[1]:<9} n={m['n']:<4} Trefferquote={m['win']:.0%} Ø R={m['avg_r']:+.2f} Profit-Faktor={m['pf']:.2f} max. Drawdown={m['max_dd_r']:.1f}R Summe={m['total_r']:+.1f}R{warn}")

def cmd_review(a):
    rows = select(load(a.file), a.strategy)
    if not rows: print("Keine Trades."); return
    cost = {}
    for r in rows:
        for t in r["mistakes"]: cost.setdefault(t, []).append(r["r"])
    print("Fehler nach Kosten (Summe R der betroffenen Trades, schlechteste zuerst):")
    for t, rs in sorted(cost.items(), key=lambda kv: sum(kv[1])):
        mark = "" if len(rs) >= 5 else "  (weniger als 5 Fälle: nur Beobachtung, keine Regel)"
        print(f"  {t:<20} n={len(rs):<3} Summe={sum(rs):+.1f}R  Ø={sum(rs)/len(rs):+.2f}R{mark}")
    print("\nRegelvorschläge (ENTWURF, nichts davon gilt, bis der Nutzer zustimmt und Paper/Backtest sie bestätigt):")
    k = 0
    for t, rs in sorted(cost.items(), key=lambda kv: sum(kv[1])):
        if len(rs) >= 5 and sum(rs) < 0:
            k += 1; print(f"  {k}. Wenn '{t}' droht, Trade auslassen/Checkliste abhaken. Test: nächste 20 Paper-Trades mit der Regel vs. ohne vergleichen.")
    if not k: print("  Noch keine (zu wenig Fälle).")
    print("\nHinweis: Gewinne/Verluste lassen sich oft nicht sauber einem Fehler zuordnen (Rauschen). Regeln nur mit neuen Daten bestätigen, nie am selben Datensatz, aus dem sie abgeleitet wurden.")

def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--file", default=DEF); s = p.add_subparsers(dest="cmd", required=True)
    a = s.add_parser("add"); a.add_argument("--strategy", required=True); a.add_argument("--symbol", required=True)
    a.add_argument("--side", choices=["long", "short"], required=True)
    for k in ("entry", "exit", "stop"): a.add_argument("--" + k, type=float, required=True)
    a.add_argument("--mode", choices=["paper", "backtest"], default="paper")
    a.add_argument("--mistakes"); a.add_argument("--note"); a.add_argument("--date")
    for n in ("stats", "review"): q = s.add_parser(n); q.add_argument("--strategy")
    a = p.parse_args()
    try: {"add": cmd_add, "stats": cmd_stats, "review": cmd_review}[a.cmd](a)
    except ValueError as e: sys.exit(f"Fehler: {e}")

if __name__ == "__main__": main()
