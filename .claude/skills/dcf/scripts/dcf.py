#!/usr/bin/env python3
"""DCF-Rechner: Barwert freier Cashflows + Gordon-Endwert, mit Sensitivität. Nur Standardbibliothek."""
import argparse, sys

def value(fcf, wacc, g):
    if wacc <= g:
        raise ValueError("WACC muss größer als das Endwachstum sein")
    pv = sum(c / (1 + wacc) ** (i + 1) for i, c in enumerate(fcf))
    tv = fcf[-1] * (1 + g) / (wacc - g)
    pv_tv = tv / (1 + wacc) ** len(fcf)
    return pv + pv_tv, pv_tv

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--fcf", required=True, help="freie Cashflows je Jahr, kommagetrennt")
    p.add_argument("--wacc", type=float, required=True)
    p.add_argument("--g", type=float, required=True, help="Endwachstum")
    p.add_argument("--net-debt", type=float, default=0.0)
    p.add_argument("--shares", type=float, required=True)
    a = p.parse_args()
    try:
        fcf = [float(x) for x in a.fcf.split(",")]
        ev, pv_tv = value(fcf, a.wacc, a.g)
    except ValueError as e:
        sys.exit(f"Fehler: {e}")
    eq = ev - a.net_debt
    print(f"Unternehmenswert {ev:,.1f} | Eigenkapital {eq:,.1f} | je Aktie {eq / a.shares:,.2f} | Endwert-Anteil {pv_tv / ev:.0%}")
    print("\nWert je Aktie, Zeilen = WACC, Spalten = Endwachstum")
    gs = [a.g - 0.005, a.g, a.g + 0.005]
    print("WACC      " + "".join(f"{g:>10.1%}" for g in gs))
    for w in (a.wacc - 0.01, a.wacc, a.wacc + 0.01):
        row = []
        for g in gs:
            try:
                row.append(f"{(value(fcf, w, g)[0] - a.net_debt) / a.shares:>10.2f}")
            except ValueError:
                row.append(f"{'n/a':>10}")
        print(f"{w:<10.1%}" + "".join(row))

if __name__ == "__main__":
    main()
