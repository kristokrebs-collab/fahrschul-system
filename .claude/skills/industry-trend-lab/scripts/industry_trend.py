#!/usr/bin/env python3
"""Eigener Nachbau der Branchen-Trendstrategie aus "A Century of Profitable Industry Trends" (Zarattini & Antonacci, 2024)
nach den veröffentlichten Regeln und Parametern. Nur Standardbibliothek. KEINE Anlageberatung, nur Forschung/Simulation.

  industry_trend.py --download DATEN/            # lädt die 2 freien Dateien (Ken French) und startet den Test
  industry_trend.py --industry 48_Industry_Portfolios_daily_CSV.zip --factors F-F_Research_Data_Factors_daily_CSV.zip
Optionen: --start 1926 --end 2026 --cost-bps 5 --up 20 --down 40 --kelt 2.8 --target-vol 0.02 --max-lev 2
Regeln (nach Artikel/Replikationsstudie, Formeln selbst umgesetzt):
  Einstieg: Kurs >= (Vortag) oberes Band UND oberes Band > unteres Band; oberes Band = max(Donchian-Hoch 20 T., Keltner oben),
  Keltner = EMA + Faktor * Mittel(|Kursänderung|); unteres Band = min(Donchian-Tief 40 T., Keltner unten).
  Ausstieg: mitlaufender Stopp = max(Vortagsstopp, unteres Band); Schlusskurs <= Stopp beendet die Position.
  Gewicht je Branche = Ziel-Vola (2 % p. a.) / annualisierte 20-Tage-Vola (gleicher Risikobeitrag je Position); Summe > max. Hebel wird proportional gekürzt; Rest in Geldmarkt (RF).
  Signal am Schlusskurs von Tag t, Rendite ab Tag t+1 (kein Blick in die Zukunft)."""
import argparse, csv, io, math, os, sys, urllib.request, zipfile
from collections import deque

FR = "https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/ftp/"
F_IND, F_FAC = "48_Industry_Portfolios_daily_CSV.zip", "F-F_Research_Data_Factors_daily_CSV.zip"

def read_text(path):
    if path.lower().endswith(".zip"):
        z = zipfile.ZipFile(path); return z.read(z.namelist()[0]).decode("latin-1")
    return open(path, encoding="latin-1").read()

def parse_table(text, ncols=None):
    """Erste Tabelle einer French-Datei: Kopfzeile + Zeilen 'YYYYMMDD, v1, v2...' bis zur Leerzeile."""
    rows, names, started = [], None, False
    for line in io.StringIO(text):
        s = line.strip()
        if not started:
            parts = [p.strip() for p in s.split(",")]
            if parts and parts[0] == "" and len(parts) > 1 and not parts[1].replace(".", "").replace("-", "").isdigit():
                names, started = parts[1:], True
            continue
        if not s: break
        p = [x.strip() for x in s.split(",")]
        if len(p[0]) == 8 and p[0].isdigit(): rows.append((p[0], [float(v) if v not in ("", ) else float("nan") for v in p[1:]]))
    return names, rows

def load(industry, factors):
    names, rows = parse_table(read_text(industry)); fn, frows = parse_table(read_text(factors))
    rf = {d: v[fn.index("RF")] / 100 for d, v in frows}; mk = {d: (v[fn.index("Mkt-RF")] + v[fn.index("RF")]) / 100 for d, v in frows}
    dates, R, RF, MK = [], [], [], []
    for d, v in rows:
        if d not in rf: continue
        dates.append(d); R.append([float("nan") if x <= -99 else x / 100 for x in v]); RF.append(rf[d]); MK.append(mk[d])
    return names, dates, R, RF, MK

def rolling_ema(xs, span):
    a, out, e = 2 / (span + 1), [], None
    for x in xs: e = x if e is None else a * x + (1 - a) * e; out.append(e)
    return out

def roll_stat(xs, w, fn, min_periods=None):
    out, win = [], deque()
    for x in xs:
        win.append(x)
        if len(win) > w: win.popleft()
        out.append(fn(win) if len(win) >= (min_periods or w) else float("nan"))
    return out

def mean(win): return sum(win) / len(win)
def std0(win): m = mean(win); return math.sqrt(sum((x - m) ** 2 for x in win) / len(win))

def indicators(rets, up, down, kelt):
    price, p = [], 1.0
    for r in rets: p *= 1 + (0.0 if math.isnan(r) else r); price.append(p)
    chg = [float("nan")] + [abs(price[i] - price[i - 1]) for i in range(1, len(price))]
    eu, ed = rolling_ema(price, up), rolling_ema(price, down)
    mu = roll_stat(chg, up, mean, up - 1); md = roll_stat(chg, down, mean, down - 1)
    dmax, dmin = roll_stat(price, up, max), roll_stat(price, down, min)
    vol = roll_stat([0.0 if math.isnan(r) else r for r in rets], up, std0)
    upper = [max(dmax[i], eu[i] + kelt * mu[i]) if not (math.isnan(dmax[i]) or math.isnan(mu[i])) else float("nan") for i in range(len(price))]
    lower = [min(dmin[i], ed[i] - kelt * md[i]) if not (math.isnan(dmin[i]) or math.isnan(md[i])) else float("nan") for i in range(len(price))]
    return price, upper, lower, vol

def backtest(names, dates, R, RF, a):
    T, N = len(dates), len(names)
    ind = [indicators([R[t][i] for t in range(T)], a.up, a.down, a.kelt) for i in range(N)]
    exposure, stop = [0] * N, [float("nan")] * N
    weights_prev = [0.0] * N; out, trades, turnover_total, turns = [], 0, 0.0, []
    for t in range(T):
        # Rendite von Tag t mit den am Vortag gesetzten Gewichten
        r = sum(w * (0.0 if math.isnan(R[t][i]) else R[t][i]) for i, w in enumerate(weights_prev) if w) + (1 - sum(weights_prev)) * RF[t]
        # Signale am Schlusskurs von t -> neue Gewichte für t+1
        w_new = [0.0] * N
        for i in range(N):
            price, upper, lower, vol = ind[i]
            if math.isnan(R[t][i]) or t == 0 or math.isnan(upper[t - 1]) or math.isnan(lower[t - 1]): exposure[i] = 0; continue
            if exposure[i] == 1:
                stop[i] = max(stop[i], lower[t]) if not math.isnan(lower[t]) else stop[i]
                if price[t] <= stop[i]: exposure[i] = 0
            elif price[t] >= upper[t - 1] and upper[t - 1] > lower[t - 1]:
                exposure[i], stop[i] = 1, lower[t]; trades += 1
            if exposure[i] == 1 and vol[t] > 0: w_new[i] = a.target_vol / (vol[t] * math.sqrt(252))
        s = sum(w_new)
        if s > a.max_lev: w_new = [w * a.max_lev / s for w in w_new]
        turn = sum(abs(w_new[i] - weights_prev[i]) for i in range(N)); turnover_total += turn
        out.append(r - turn * a.cost_bps / 10000 if t else r); turns.append(turn if t else 0.0)
        weights_prev = w_new
    return out, trades, turnover_total, turns

def stats(rets, rf, label):
    n = len(rets); years = n / 252
    eq, peak, dd = 1.0, 1.0, 0.0
    for r in rets: eq *= 1 + r; peak = max(peak, eq); dd = max(dd, 1 - eq / peak)
    ex = [r - f for r, f in zip(rets, rf)]; m = mean(ex); s = std0(ex)
    cagr = eq ** (1 / years) - 1 if years > 0 and eq > 0 else float("nan")
    vol = std0(rets) * math.sqrt(252)
    return f"{label:<22} CAGR {cagr:7.2%}  Vola {vol:6.2%}  Sharpe {(m / s * math.sqrt(252)) if s else 0:5.2f}  max. Drawdown {dd:6.1%}  (Jahre {years:.1f})"

def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--download"); p.add_argument("--industry"); p.add_argument("--factors")
    p.add_argument("--start", type=int, default=1926); p.add_argument("--end", type=int, default=2100)
    p.add_argument("--cost-bps", type=float, default=0.0, help="Kosten je Seite in Basispunkten auf den Umschlag")
    p.add_argument("--up", type=int, default=20); p.add_argument("--down", type=int, default=40); p.add_argument("--kelt", type=float, default=2 * 1.4)
    p.add_argument("--target-vol", type=float, default=0.02); p.add_argument("--max-lev", type=float, default=2.0)
    a = p.parse_args()
    if a.download:
        os.makedirs(a.download, exist_ok=True)
        for f in (F_IND, F_FAC):
            dst = os.path.join(a.download, f)
            if not os.path.exists(dst): urllib.request.urlretrieve(FR + f, dst)
        a.industry, a.factors = os.path.join(a.download, F_IND), os.path.join(a.download, F_FAC)
    if not (a.industry and a.factors): sys.exit("Dateien angeben (--industry, --factors) oder --download ORDNER")
    names, dates, R, RF, MK = load(a.industry, a.factors)
    sel = [i for i, d in enumerate(dates) if a.start <= int(d[:4]) <= a.end]
    names_n = len(names); dates, R, RF, MK = [dates[i] for i in sel], [R[i] for i in sel], [RF[i] for i in sel], [MK[i] for i in sel]
    out, trades, turn, _ = backtest(names, dates, R, RF, a)
    print(f"Daten: {names_n} Branchen, {dates[0]} bis {dates[-1]}, {len(dates)} Handelstage. Einstiege: {trades}, Umschlag/Jahr: {turn / (len(dates) / 252):.1f}x, Kosten: {a.cost_bps} bp/Seite")
    print(stats(out, RF, "Trendstrategie")); print(stats(MK, RF, "Buy & Hold (Markt)"))
    print("\nTeilzeiträume (Robustheit; Stärke kann sich ändern):")
    for lo, hi in ((1926, 1949), (1950, 1974), (1975, 1999), (2000, 2013), (2014, 2026)):
        ix = [i for i, d in enumerate(dates) if lo <= int(d[:4]) <= hi]
        if len(ix) > 250: print(stats([out[i] for i in ix], [RF[i] for i in ix], f"Strategie {lo}-{hi}")); print(stats([MK[i] for i in ix], [RF[i] for i in ix], f"Markt     {lo}-{hi}"))
    print("\nHinweis: Rückblick. Kosten, Steuern, Hebel-Finanzierung über RF und Datenstand (CRSP/French) vereinfacht. Keine Anlageberatung.")

if __name__ == "__main__": main()
