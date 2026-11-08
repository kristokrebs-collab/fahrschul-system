#!/usr/bin/env python3
"""Prüf-Motor: kontrollierte Verbesserungsschleife für die Branchen-Trendstrategie (Simulation, nur Standardbibliothek).
  validate.py --industry <zip> --factors <zip> [--end 2026] [--lab-dir lab] [--cost-bps 5]
Ablauf: Daten-Split 60/20/20 (Entwicklung/Validierung/Endtest, zeitlich) -> Basis v1.0 (Paper-Parameter) -> Parameter-Raster 3x3
(Robustheit) -> Walk-forward (10 J. wählen, 5 J. anwenden) -> Renditeverteilung -> Kosten-Szenarien -> Tor "nur übernehmen, wenn ALLE
Prüfungen bestehen" -> Eintrag ins Experiment-Log. Schreibt lab/results.json (für das Dashboard) und lab/experiments.json.
Ergebnis ist ein Rückblick, keine Prognose und keine Anlageberatung. Es werden keine Orders erzeugt."""
import argparse, datetime, json, math, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import industry_trend as it
from statistics import NormalDist

N01, EULER = NormalDist(), 0.5772156649015329
UPS, DOWNS, BASE = (10, 20, 40), (20, 40, 80), (20, 40)

def sharpe(x, rf):
    ex = [a - b for a, b in zip(x, rf)]
    if not ex: return 0.0
    m = sum(ex) / len(ex); s = it.std0(ex)
    return (m / s) * math.sqrt(252) if s else 0.0

def metrics(x, rf):
    n = len(x); eq = peak = 1.0; dd = 0.0
    for r in x: eq *= 1 + r; peak = max(peak, eq); dd = max(dd, 1 - eq / peak)
    yrs = n / 252
    return dict(cagr=(eq ** (1 / yrs) - 1) if yrs and eq > 0 else None, vol=it.std0(x) * math.sqrt(252) if n else 0, sharpe=sharpe(x, rf), maxdd=dd, years=yrs, total=eq - 1)

def deflated(best, n_trials, sr_var):
    T = len(best); m = sum(best) / T; s = it.std0(best)
    if not s: return None
    z = [(v - m) / s for v in best]; sk = sum(v ** 3 for v in z) / T; ku = sum(v ** 4 for v in z) / T; sr = m / s
    sr0 = math.sqrt(sr_var) * ((1 - EULER) * N01.inv_cdf(1 - 1 / n_trials) + EULER * N01.inv_cdf(1 - 1 / (n_trials * math.e))) if n_trials > 1 and sr_var > 0 else 0.0
    den = 1 - sk * sr + (ku - 1) / 4 * sr ** 2
    return N01.cdf((sr - sr0) * math.sqrt(T - 1) / math.sqrt(den)) if den > 0 else None

def monthly(dates, x):
    out, cur, eq = [], None, 1.0
    for d, r in zip(dates, x):
        ym = d[:6]
        if cur is not None and ym != cur: out.append(eq - 1); eq = 1.0
        cur = ym; eq *= 1 + r
    out.append(eq - 1); return out

def hist(vals, lo=-0.2, hi=0.2, bins=20):
    h = [0] * bins
    for v in vals: h[min(bins - 1, max(0, int((v - lo) / (hi - lo) * bins)))] += 1
    return h

def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--industry", required=True); p.add_argument("--factors", required=True)
    p.add_argument("--end", type=int, default=2100); p.add_argument("--lab-dir", default="lab"); p.add_argument("--cost-bps", type=float, default=5.0)
    a = p.parse_args()
    names, dates, R, RF, MK = it.load(a.industry, a.factors)
    sel = [i for i, d in enumerate(dates) if int(d[:4]) <= a.end]; dates, R, RF, MK = [dates[i] for i in sel], [R[i] for i in sel], [RF[i] for i in sel], [MK[i] for i in sel]
    T = len(dates); i1, i2 = int(T * .6), int(T * .8)
    seg = {"Entwicklung": (0, i1), "Validierung": (i1, i2), "Endtest": (i2, T)}
    series, turns = {}, {}
    for up in UPS:
        for dn in DOWNS:
            ns = argparse.Namespace(up=up, down=dn, kelt=2.8, target_vol=0.02, max_lev=2.0, cost_bps=0.0)
            gross, _, _, tr = it.backtest(names, dates, R, RF, ns); series[(up, dn)], turns[(up, dn)] = gross, tr
            print(f"  Variante {up}/{dn} gerechnet", file=sys.stderr)
    net = lambda k, c=a.cost_bps: [g - t * c / 10000 for g, t in zip(series[k], turns[k])]
    nets = {k: net(k) for k in series}
    seg_m = lambda x, rf, lo_hi: metrics(x[lo_hi[0]:lo_hi[1]], rf[lo_hi[0]:lo_hi[1]])
    base = nets[BASE]
    rows = {name: dict(von=dates[lo], bis=dates[hi - 1], strategie=seg_m(base, RF, (lo, hi)), markt=seg_m(MK, RF, (lo, hi))) for name, (lo, hi) in seg.items()}
    grid = {f"{u}/{d}": dict(entwicklung=seg_m(nets[(u, d)], RF, seg["Entwicklung"])["sharpe"], validierung=seg_m(nets[(u, d)], RF, seg["Validierung"])["sharpe"], endtest=seg_m(nets[(u, d)], RF, seg["Endtest"])["sharpe"]) for u in UPS for d in DOWNS}
    # Kandidat: bester Entwicklungs-Sharpe unter den Varianten außer der Basis
    cand = max((k for k in series if k != BASE), key=lambda k: grid[f"{k[0]}/{k[1]}"]["entwicklung"]); ck = f"{cand[0]}/{cand[1]}"
    # Walk-forward: 10 J. wählen, 5 J. anwenden
    wf, wf_base, wf_mk, wf_rf, wf_dates, picks = [], [], [], [], [], []
    start = 2520
    while start + 1260 <= T:
        tr, te = (start - 2520, start), (start, start + 1260)
        best = max(series, key=lambda k: sharpe(nets[k][tr[0]:tr[1]], RF[tr[0]:tr[1]])); picks.append(dict(von=dates[te[0]], bis=dates[te[1] - 1], gewaehlt=f"{best[0]}/{best[1]}"))
        wf += nets[best][te[0]:te[1]]; wf_base += base[te[0]:te[1]]; wf_mk += MK[te[0]:te[1]]; wf_rf += RF[te[0]:te[1]]; wf_dates += dates[te[0]:te[1]]; start += 1260
    walk = dict(auswahl=picks, walkforward=metrics(wf, wf_rf), fest=metrics(wf_base, wf_rf), markt=metrics(wf_mk, wf_rf), von=wf_dates[0] if wf_dates else None, bis=wf_dates[-1] if wf_dates else None)
    # Renditeverteilung (Monate), Kosten
    mon = monthly(dates, base); mm = sum(mon) / len(mon); ms = it.std0(mon)
    dist = dict(hist=hist(mon), mean=mm, std=ms, skew=sum(((v - mm) / ms) ** 3 for v in mon) / len(mon) if ms else 0, kurt=sum(((v - mm) / ms) ** 4 for v in mon) / len(mon) if ms else 0, monate=len(mon), anteil_positiv=sum(1 for v in mon if v > 0) / len(mon))
    costs = [dict(bp=c, **{k: v for k, v in metrics(net(BASE, c), RF).items() if k in ("cagr", "sharpe", "maxdd")}) for c in (0, 2, 5, 10)]
    turnover_yr = sum(turns[BASE]) / (T / 252)
    # Equity-Kurven (monatlich ausgedünnt)
    def curve(x):
        eq, out = 1.0, []
        for i, r in enumerate(x):
            eq *= 1 + r
            if i % 21 == 0 or i == len(x) - 1: out.append(round(eq, 4))
        return out
    # Tor
    sr_by_trial = [sharpe(nets[k][:i1], RF[:i1]) for k in series]; sr_var = it.std0(sr_by_trial) ** 2
    dsr_val = deflated(nets[cand][:i1], len(series), sr_var)
    nb = [grid[f"{k[0]}/{k[1]}"]["entwicklung"] for k in series if k != cand]; nb.sort(); med_nb = nb[len(nb) // 2]
    cE, bE = grid[ck], grid[f"{BASE[0]}/{BASE[1]}"]
    test_c = seg_m(nets[cand], RF, seg["Endtest"]); test_m = seg_m(MK, RF, seg["Endtest"])
    checks = [
        ("Validierung: Sharpe Kandidat >= Basis", cE["validierung"] >= bE["validierung"], f"{cE['validierung']:.2f} gegen {bE['validierung']:.2f}"),
        ("Endtest: Sharpe Kandidat >= Basis", cE["endtest"] >= bE["endtest"], f"{cE['endtest']:.2f} gegen {bE['endtest']:.2f}"),
        ("Robustheit: Median der Nachbarn >= 80 % des Kandidaten", cE["entwicklung"] > 0 and med_nb >= 0.8 * cE["entwicklung"], f"{med_nb:.2f} gegen {0.8 * cE['entwicklung']:.2f}"),
        ("Kosten: Endtest-Rendite nach 5 bp über Markt", (test_c["cagr"] or -1) > (test_m["cagr"] or 0), f"{(test_c['cagr'] or 0):.1%} gegen {(test_m['cagr'] or 0):.1%}"),
        ("Mehrfachtest: Deflated Sharpe >= 0,95 (9 Varianten)", dsr_val is not None and dsr_val >= 0.95, "n. b." if dsr_val is None else f"{dsr_val:.2f}"),
        ("Walk-forward: Auswahl-Sharpe >= feste Basis", walk["walkforward"]["sharpe"] >= walk["fest"]["sharpe"], f"{walk['walkforward']['sharpe']:.2f} gegen {walk['fest']['sharpe']:.2f}"),
    ]
    promote = all(ok for _, ok, _ in checks)
    log_path = os.path.join(a.lab_dir, "experiments.json"); os.makedirs(a.lab_dir, exist_ok=True)
    log = json.load(open(log_path)) if os.path.exists(log_path) else []
    log.append(dict(id=f"v{len(log) + 1}", datum=datetime.date.today().isoformat(), daten_bis=dates[-1], aenderung=f"Basis {BASE[0]}/{BASE[1]} -> Kandidat {ck}", entwicklung=cE["entwicklung"], validierung=cE["validierung"], endtest=cE["endtest"],
                    entscheidung="UEBERNOMMEN" if promote else "VERWORFEN", durchgefallen=[n for n, ok, _ in checks if not ok]))
    json.dump(log, open(log_path, "w"), indent=1, ensure_ascii=False)
    res = dict(erstellt=datetime.date.today().isoformat(), daten_bis=dates[-1], daten_von=dates[0], branchen=len(names), kosten_bp=a.cost_bps, split=rows, raster=grid, basis=f"{BASE[0]}/{BASE[1]}", kandidat=ck,
               walkforward=walk, verteilung=dist, kosten=costs, umschlag_pro_jahr=turnover_yr, checks=[dict(name=n, ok=ok, wert=v) for n, ok, v in checks], entscheidung="UEBERNOMMEN" if promote else "VERWORFEN",
               kurve=dict(strategie=curve(base), markt=curve(MK), i1=int(i1 / 21), i2=int(i2 / 21)), experimente=log, hinweis="SIMULATION / BACKTEST. Keine Anlageberatung.")
    json.dump(res, open(os.path.join(a.lab_dir, "results.json"), "w"), indent=1, ensure_ascii=False)
    print(f"Daten {dates[0]} bis {dates[-1]}; Split: Entwicklung bis {dates[i1 - 1]}, Validierung bis {dates[i2 - 1]}, Endtest bis {dates[-1]}")
    for n, r in rows.items(): print(f"  {n:<12} Strategie Sharpe {r['strategie']['sharpe']:5.2f} CAGR {r['strategie']['cagr']:7.2%} | Markt Sharpe {r['markt']['sharpe']:5.2f} CAGR {r['markt']['cagr']:7.2%}")
    print(f"Kandidat {ck} gegen Basis {BASE[0]}/{BASE[1]}:"); [print(f"  [{'OK ' if ok else 'NEIN'}] {n}: {v}") for n, ok, v in checks]
    print(f"Entscheidung: {res['entscheidung']}. Ergebnisse: {os.path.join(a.lab_dir, 'results.json')}")

if __name__ == "__main__": main()
