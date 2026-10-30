#!/usr/bin/env python3
"""megatest.py - 10.000+ Strategie-Varianten auf den Branchendaten testen, nur die bestandene beste im Vault speichern.
Nur Rückblick-Simulation (Papier). Keine Orders, keine Verbindung zu Brokern. Nur Standardbibliothek.

Ablauf
  1. Raster aus Parametern (up, down, kelt, Ziel-Vola, Hebel), jede Variante läuft über die ganze Historie mit Kosten.
  2. Auswahl NUR auf den ersten 80 % der Daten (Entwicklung + Validierung); die letzten 20 % (Endtest) sind Prüfdaten.
  3. Tor: Deflated Sharpe über ALLE Varianten, Endtest gegen Basis, Nachbar-Plateau, Kosten, Monte-Carlo-Verlustrisiko.
  4. Nur wer alle Prüfungen besteht, kommt in vault/strategies.json. Sonst bleibt die Basis; der Versuch steht im Log.
  5. 10.000 Monte-Carlo-Pfade (Block-Bootstrap) der Kandidatin für das Fächer-Diagramm.
  6. Demo-Signale (grün = Kauf, rot = Verkauf) mit Protokoll und Freigabe-Warteschlange. Es wird nichts gesendet.

  python3 megatest.py --industry <zip> --factors <zip> --lab-dir lab [--quick] [--workers 4] [--paths 10000]
"""
import argparse, array, datetime, json, math, os, random, sys, time
from concurrent.futures import ProcessPoolExecutor
from statistics import NormalDist, median
import industry_trend as it

N01, EULER = NormalDist(), 0.5772156649015329
SQ = math.sqrt(252)
NAN = float("nan")
BASE = dict(up=20, down=40, kelt=2.8, tv=0.02, lev=2.0)
G = {}  # geteilter Zustand für Worker (fork)


# ---------- schnelle Indikatoren (gleiche Semantik wie industry_trend.indicators) ----------
def ema(xs, span):
    a, e, out = 2 / (span + 1), None, array.array("d")
    for x in xs:
        e = x if e is None else a * x + (1 - a) * e
        out.append(e)
    return out


def roll_ext(xs, w, is_max):
    from collections import deque
    dq, out = deque(), array.array("d")
    for t, x in enumerate(xs):
        while dq and ((xs[dq[-1]] <= x) if is_max else (xs[dq[-1]] >= x)):
            dq.pop()
        dq.append(t)
        if dq[0] <= t - w:
            dq.popleft()
        out.append(xs[dq[0]] if t >= w - 1 else NAN)
    return out


def roll_mean_chg(chg, w):
    """Mittel der letzten w Werte von chg; chg[0] ist NaN, daher gültig ab t = w (wie roll_stat mit NaN im Fenster)."""
    out, s = array.array("d"), 0.0
    for t, x in enumerate(chg):
        if t >= 1:
            s += x
        if t > w:
            s -= chg[t - w]
        out.append(s / w if t >= w else NAN)
    return out


def roll_std(xs, w):
    out, s, s2 = array.array("d"), 0.0, 0.0
    for t, x in enumerate(xs):
        s += x; s2 += x * x
        if t >= w:
            y = xs[t - w]; s -= y; s2 -= y * y
        if t >= w - 1:
            m = s / w; v = s2 / w - m * m
            out.append(math.sqrt(v) if v > 0 else 0.0)
        else:
            out.append(NAN)
    return out


def prep(names, R, ups, downs):
    T, N = len(R), len(names)
    price, clean = [], []
    for i in range(N):
        p, pr, c = 1.0, array.array("d"), array.array("d")
        for t in range(T):
            r = R[t][i]; c.append(0.0 if math.isnan(r) else r)
            p *= 1 + c[-1]; pr.append(p)
        price.append(pr); clean.append(c)
    chg = [array.array("d", [NAN] + [abs(pr[t] - pr[t - 1]) for t in range(1, T)]) for pr in price]
    U = {u: [(ema(price[i], u), roll_mean_chg(chg[i], u), roll_ext(price[i], u, True), roll_std(clean[i], u)) for i in range(N)] for u in ups}
    D = {d: [(ema(price[i], d), roll_mean_chg(chg[i], d), roll_ext(price[i], d, False)) for i in range(N)] for d in downs}
    return price, U, D


# ---------- Signal-Durchlauf (hängt nur von up, down, kelt ab) ----------
def signal_pass(up, down, kelt, want_exp=False):
    names, R, price, U, D = G["names"], G["R"], G["price"], G["U"], G["D"]
    T, N = len(R), len(names)
    act = [[] for _ in range(T)]
    exps = [] if want_exp else None
    for i in range(N):
        eu, mu, dmax, vol = U[up][i]; ed, md, dmin = D[down][i]; pr = price[i]
        exposure, stop = 0, NAN
        ex = bytearray(T) if want_exp else None
        prev_up = prev_lo = NAN
        for t in range(T):
            upper = max(dmax[t], eu[t] + kelt * mu[t]) if not (dmax[t] != dmax[t] or mu[t] != mu[t]) else NAN
            lower = min(dmin[t], ed[t] - kelt * md[t]) if not (dmin[t] != dmin[t] or md[t] != md[t]) else NAN
            if R[t][i] != R[t][i] or t == 0 or prev_up != prev_up or prev_lo != prev_lo:
                exposure = 0
            elif exposure == 1:
                if lower == lower:
                    stop = max(stop, lower) if stop == stop else lower
                if pr[t] <= stop:
                    exposure = 0
            elif pr[t] >= prev_up and prev_up > prev_lo:
                exposure, stop = 1, lower
            if exposure == 1 and vol[t] > 0:
                act[t].append((i, 1.0 / (vol[t] * SQ)))
            if want_exp and exposure == 1:
                ex[t] = 1
            prev_up, prev_lo = upper, lower
        if want_exp:
            exps.append(ex)
    return act, exps


def portfolio(act, tv, lev, cost_bps):
    R, RF = G["R"], G["RF"]
    out, prev = [], {}
    c = cost_bps / 10000.0
    for t in range(len(R)):
        row = R[t]
        r, sp = 0.0, 0.0
        for i, w in prev.items():
            x = row[i]; r += w * (0.0 if x != x else x); sp += w
        r += (1 - sp) * RF[t]
        new = {i: tv * u for i, u in act[t]}
        s = sum(new.values())
        if s > lev:
            f = lev / s
            new = {i: w * f for i, w in new.items()}
        if t:
            turn = 0.0
            for i, w in new.items():
                turn += abs(w - prev.get(i, 0.0))
            for i, w in prev.items():
                if i not in new:
                    turn += w
            r -= turn * c
        out.append(r)
        prev = new
    return out


# ---------- Kennzahlen ----------
def seg_metrics(x, rf):
    n = len(x)
    if n < 30:
        return dict(sharpe=0.0, cagr=0.0, maxdd=0.0, vol=0.0)
    eq = peak = 1.0; dd = 0.0; s = s2 = 0.0; r2 = 0.0
    for a, f in zip(x, rf):
        eq *= 1 + a; peak = max(peak, eq); dd = max(dd, 1 - eq / peak)
        e = a - f; s += e; s2 += e * e; r2 += a * a
    m = s / n; v = s2 / n - m * m; sd = math.sqrt(v) if v > 0 else 0.0
    mr = sum(x) / n; vol = math.sqrt(max(r2 / n - mr * mr, 0.0)) * SQ
    yrs = n / 252
    return dict(sharpe=(m / sd) * SQ if sd else 0.0, cagr=(eq ** (1 / yrs) - 1) if eq > 0 else -1.0, maxdd=dd, vol=vol)


def all_seg(x, rf, cuts):
    i1, i2, T = cuts
    return dict(entw=seg_metrics(x[:i1], rf[:i1]), valid=seg_metrics(x[i1:i2], rf[i1:i2]), endtest=seg_metrics(x[i2:T], rf[i2:T]),
                devval=seg_metrics(x[:i2], rf[:i2]), gesamt=seg_metrics(x, rf))


def work(key):
    up, down, kelt = key
    act, _ = signal_pass(up, down, kelt)
    res = []
    for tv in G["tvs"]:
        for lev in G["levs"]:
            x = portfolio(act, tv, lev, G["cost"])
            res.append(((up, down, kelt, tv, lev), all_seg(x, G["RF"], G["cuts"])))
    return res


def deflated(best, n_trials, sr_var):
    T = len(best); m = sum(best) / T; s = it.std0(best)
    if not s:
        return None
    z = [(v - m) / s for v in best]; sk = sum(v ** 3 for v in z) / T; ku = sum(v ** 4 for v in z) / T; sr = m / s
    sr0 = math.sqrt(sr_var) * ((1 - EULER) * N01.inv_cdf(1 - 1 / n_trials) + EULER * N01.inv_cdf(1 - 1 / (n_trials * math.e))) if n_trials > 1 and sr_var > 0 else 0.0
    den = 1 - sk * sr + (ku - 1) / 4 * sr ** 2
    return N01.cdf((sr - sr0) * math.sqrt(T - 1) / math.sqrt(den)) if den > 0 else None


def spearman(a, b):
    def rk(v):
        o = sorted(range(len(v)), key=lambda i: v[i]); r = [0.0] * len(v)
        for k, i in enumerate(o): r[i] = k
        return r
    ra, rb = rk(a), rk(b); n = len(a); ma = mb = (n - 1) / 2
    cov = sum((x - ma) * (y - mb) for x, y in zip(ra, rb)); va = sum((x - ma) ** 2 for x in ra)
    return cov / va if va else 0.0


def thin(xs, k):
    step = max(1, len(xs) // k)
    return [xs[i] for i in range(0, len(xs), step)]


def equity(x):
    e, out = 1.0, []
    for a in x: e *= 1 + a; out.append(e)
    return out


# ---------- Monte-Carlo (Block-Bootstrap) ----------
def monte_carlo(pool, n_paths, horizon=1260, block=21, seed=7, n_show=140, points=61):
    rnd = random.Random(seed); nb = horizon // block; hi = len(pool) - block
    finals, dds, keep, ends = [], [], [], []
    step = block
    cols = [[] for _ in range(points)]
    for p in range(n_paths):
        eq, peak, dd, path = 1.0, 1.0, 0.0, [1.0]
        for _ in range(nb):
            s = rnd.randint(0, hi)
            for j in range(block):
                eq *= 1 + pool[s + j]
                if eq > peak: peak = eq
                else:
                    d = 1 - eq / peak
                    if d > dd: dd = d
            path.append(eq)
        finals.append(eq); dds.append(dd)
        for k in range(points): cols[k].append(path[k])
        if p < n_show * 6: keep.append(path)
    q = lambda v, p: sorted(v)[int(p * (len(v) - 1))]
    bands = {str(int(p * 100)): [round(q(c, p), 4) for c in cols] for p in (0.05, 0.25, 0.5, 0.75, 0.95)}
    lo, hi_ = min(finals), max(finals)
    bins = 40; edges = [min(q(finals, .01), 0.2) + (min(q(finals, .99), 6.0) - min(q(finals, .01), 0.2)) * k / bins for k in range(bins + 1)]
    hist = [0] * bins
    for f in finals:
        k = min(bins - 1, max(0, int((f - edges[0]) / (edges[-1] - edges[0]) * bins))); hist[k] += 1
    ups = [p for p in keep if p[-1] >= 1][:n_show]; downs = [p for p in keep if p[-1] < 1][:n_show]
    return dict(pfade=n_paths, horizont_tage=horizon, block=block, p_verlust=sum(1 for f in finals if f < 1) / n_paths,
                median=q(finals, .5), p05=q(finals, .05), p95=q(finals, .95), dd_median=q(dds, .5), dd_p95=q(dds, .95),
                baender=bands, hist=hist, hist_von=edges[0], hist_bis=edges[-1],
                zeige_gruen=[[round(v, 3) for v in p] for p in ups], zeige_rot=[[round(v, 3) for v in p] for p in downs],
                anteil_gruen=sum(1 for f in finals if f >= 1) / n_paths)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--industry", required=True); ap.add_argument("--factors", required=True)
    ap.add_argument("--lab-dir", default="lab"); ap.add_argument("--cost-bps", type=float, default=5.0)
    ap.add_argument("--workers", type=int, default=4); ap.add_argument("--paths", type=int, default=10000)
    ap.add_argument("--quick", action="store_true", help="kleines Raster zum Testen (ein paar hundert Varianten)")
    ap.add_argument("--end", type=int, default=2100)
    a = ap.parse_args()
    t0 = time.time()
    names, dates, R, RF, MK = it.load(a.industry, a.factors)
    sel = [i for i, d in enumerate(dates) if int(d[:4]) <= a.end]
    dates, R, RF, MK = [dates[i] for i in sel], [R[i] for i in sel], [RF[i] for i in sel], [MK[i] for i in sel]
    T = len(dates); i1, i2 = int(T * .6), int(T * .8)
    if a.quick:
        ups, downs, kelts, tvs, levs = [10, 20, 40], [20, 40, 80], [2.0, 2.8], [0.02], [1.0, 2.0]
    else:
        ups, downs = list(range(10, 70, 5)), list(range(20, 140, 10))
        kelts, tvs, levs = [1.0, 1.4, 1.8, 2.2, 2.8, 3.4, 4.0], [0.01, 0.015, 0.02, 0.03], [1.0, 1.5, 2.0]
    for v in (BASE["up"], ):
        if v not in ups: ups.append(v)
    if BASE["down"] not in downs: downs.append(BASE["down"])
    ups.sort(); downs.sort()
    print(f"Vorbereitung: Indikatoren für {len(ups)} Hoch- und {len(downs)} Tief-Fenster ...", file=sys.stderr)
    price, U, D = prep(names, R, ups, downs)
    G.update(names=names, R=R, RF=RF, price=price, U=U, D=D, tvs=tvs, levs=levs, cost=a.cost_bps, cuts=(i1, i2, T))
    keys = [(u, d, k) for u in ups for d in downs for k in kelts]
    total = len(keys) * len(tvs) * len(levs)
    print(f"{total} Varianten über {T} Handelstage, {a.workers} Prozesse ...", file=sys.stderr)
    results = {}
    with ProcessPoolExecutor(max_workers=a.workers) as ex:
        for n, part in enumerate(ex.map(work, keys, chunksize=2), 1):
            for k, m in part: results[k] = m
            if n % 50 == 0: print(f"  {n}/{len(keys)} Signal-Durchläufe ({len(results)} Varianten) {time.time() - t0:.0f}s", file=sys.stderr)
    # Basis (Paper-Parameter) ist im Raster, falls kelt 2.8 / tv .02 / lev 2 enthalten sind; sonst separat
    bk = (BASE["up"], BASE["down"], BASE["kelt"], BASE["tv"], BASE["lev"])
    if bk not in results:
        act, _ = signal_pass(*bk[:3]); results[bk] = all_seg(portfolio(act, bk[3], bk[4], a.cost_bps), RF, G["cuts"])
    nvar = len(results)
    dv = {k: m["devval"]["sharpe"] for k, m in results.items()}
    et = {k: m["endtest"]["sharpe"] for k, m in results.items()}
    champ = max(dv, key=dv.get)
    # Nachbar-Plateau: gleiche (kelt, tv, lev), up/down eine Rasterstufe daneben
    ui, di = ups.index(champ[0]), downs.index(champ[1])
    nb = [(ups[x], downs[y], champ[2], champ[3], champ[4]) for x in (ui - 1, ui, ui + 1) for y in (di - 1, di, di + 1)
          if 0 <= x < len(ups) and 0 <= y < len(downs) and (x, y) != (ui, di)]
    nb_med = median([dv[k] for k in nb if k in dv]) if nb else 0.0
    # Reihen neu rechnen (nur Kandidatin, Basis): für Kurve, Kosten, Monte-Carlo, Signale
    act_c, exps = signal_pass(*champ[:3], want_exp=True)
    xc = portfolio(act_c, champ[3], champ[4], a.cost_bps)
    xc10 = portfolio(act_c, champ[3], champ[4], 10.0)
    act_b, _ = signal_pass(*bk[:3]); xb = portfolio(act_b, bk[3], bk[4], a.cost_bps)
    mk_end = seg_metrics(MK[i2:], RF[i2:]); c10_end = seg_metrics(xc10[i2:], RF[i2:])
    # Streuung der Varianten-Sharpes (je Periode) für den Deflated Sharpe
    per = [v / SQ for v in dv.values()]; mu_ = sum(per) / len(per); sr_var = sum((v - mu_) ** 2 for v in per) / len(per)
    dsr = deflated([x - f for x, f in zip(xc[:i2], RF[:i2])], nvar, sr_var)
    mc = monte_carlo(xc[i1:], a.paths)
    checks = [
        dict(name=f"Mehrfachtest: Deflated Sharpe >= 0,95 ({nvar} Varianten)", ok=bool(dsr is not None and dsr >= 0.95), wert=f"{dsr:.2f}" if dsr is not None else "n/a"),
        dict(name="Endtest (letzte 20 %): Sharpe Kandidatin >= Basis", ok=et[champ] >= et[bk], wert=f"{et[champ]:.2f} gegen {et[bk]:.2f}"),
        dict(name="Plateau: Median der Nachbarn >= 80 % der Kandidatin", ok=bool(nb_med >= 0.8 * dv[champ]), wert=f"{nb_med:.2f} gegen {dv[champ]:.2f}"),
        dict(name="Kosten: Endtest-Rendite nach 10 bp über Markt", ok=bool(c10_end["cagr"] > mk_end["cagr"]), wert=f"{c10_end['cagr']:.1%} gegen {mk_end['cagr']:.1%}"),
        dict(name="Monte-Carlo: Verlustwahrscheinlichkeit nach 5 Jahren <= 20 %", ok=bool(mc["p_verlust"] <= 0.20), wert=f"{mc['p_verlust']:.1%}"),
    ]
    passed = all(c["ok"] for c in checks)
    cid = "s-" + "-".join(str(v) for v in champ)
    now = datetime.datetime.now().isoformat(timespec="seconds")
    # Signale (Demo): Ein-/Ausstiege der Kandidatin in den letzten 60 Handelstagen je Branche
    events, pos = [], []
    for i, ex in enumerate(exps):
        for t in range(max(1, T - 60), T):
            if ex[t] != ex[t - 1]:
                events.append(dict(datum=dates[t], branche=names[i], signal="KAUF" if ex[t] else "VERKAUF", punkt="gruen" if ex[t] else "rot"))
        if ex[T - 1]:
            w = dict(act_c[T - 1]).get(i, 0.0) * champ[3]
            pos.append(dict(branche=names[i], gewicht=round(w, 4)))
    events.sort(key=lambda e: (e["datum"], e["branche"]))
    # Dateien
    lab = a.lab_dir; vault = os.path.join(lab, "vault"); os.makedirs(vault, exist_ok=True)
    params = lambda k: dict(up=k[0], down=k[1], kelt=k[2], ziel_vola=k[3], max_hebel=k[4])
    vpath = os.path.join(vault, "strategies.json")
    store = json.load(open(vpath, encoding="utf-8")) if os.path.exists(vpath) else []
    if passed:
        store = [s for s in store if s["id"] != cid] + [dict(id=cid, gespeichert=now, parameter=params(champ), kennzahlen=results[champ], checks=checks, daten_bis=dates[-1], modus="Simulation")]
        json.dump(store, open(vpath, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    proto = os.path.join(vault, "protokoll.jsonl"); seen = set()
    if os.path.exists(proto):
        for ln in open(proto, encoding="utf-8"):
            try: j = json.loads(ln); seen.add((j["datum"], j["branche"], j["signal"], j["strategie"]))
            except Exception: pass
    with open(proto, "a", encoding="utf-8") as f:
        for e in events:
            key = (e["datum"], e["branche"], e["signal"], cid)
            if key in seen: continue
            f.write(json.dumps(dict(erfasst=now, datum=e["datum"], branche=e["branche"], signal=e["signal"], strategie=cid, modus="DEMO/PAPIER", gesendet=False, hinweis="Nur Protokoll, keine Order gesendet."), ensure_ascii=False) + "\n")
    outbox = [dict(datum=e["datum"], branche=e["branche"], signal=e["signal"], status="wartet auf deine Freigabe (ausdrückliches Ja im Chat)", gesendet=False) for e in events if e["datum"] == dates[-1]]
    json.dump(outbox, open(os.path.join(lab, "outbox.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    keysorted = sorted(dv, key=dv.get, reverse=True)
    rnd = random.Random(3); sample = rnd.sample(list(dv), min(700, len(dv)))
    cut = lambda x: [dates[0], dates[i1], dates[i2], dates[-1]]
    out = dict(erstellt=now, daten_von=dates[0], daten_bis=dates[-1], branchen=len(names), kosten_bp=a.cost_bps, laufzeit_s=round(time.time() - t0),
               raster=dict(up=ups, down=downs, kelt=kelts, ziel_vola=tvs, max_hebel=levs), n_varianten=nvar, schnitt=dict(entw_bis=dates[i1 - 1], valid_bis=dates[i2 - 1]),
               basis=dict(parameter=params(bk), kennzahlen=results[bk]), kandidatin=dict(id=cid, parameter=params(champ), kennzahlen=results[champ], kosten10bp_endtest=c10_end),
               markt=dict(endtest=mk_end, gesamt=seg_metrics(MK, RF)), checks=checks, entscheidung="UEBERNOMMEN" if passed else "VERWORFEN",
               rang_korrelation=spearman([dv[k] for k in dv], [et[k] for k in dv]),
               anteil_endtest_besser_als_basis=sum(1 for k in dv if et[k] >= et[bk]) / nvar,
               top=[dict(parameter=params(k), devval=dv[k], endtest=et[k]) for k in keysorted[:15]],
               streu=[[round(dv[k], 3), round(et[k], 3)] for k in sample],
               hist_devval=[round(v, 3) for v in thin(sorted(dv.values()), 60)], hist_endtest=[round(v, 3) for v in thin(sorted(et.values()), 60)],
               kurve=dict(kandidatin=[round(v, 4) for v in thin(equity(xc), 420)], basis=[round(v, 4) for v in thin(equity(xb), 420)], markt=[round(v, 4) for v in thin(equity(MK), 420)], datum=thin(dates, 420), i1=i1 * 420 // T, i2=i2 * 420 // T),
               monte_carlo=mc, signale=dict(stand=dates[-1], ereignisse=events[-40:], positionen=sorted(pos, key=lambda p: -p["gewicht"])[:12], modus="DEMO/PAPIER"),
               vault=dict(eintraege=len(store), gespeichert_diesmal=passed),
               hinweis="Simulation auf historischen Daten, keine Prognose, keine Anlageberatung. Kein Order-Versand. Signale stammen vom letzten Datenstand, nicht aus Echtzeit.")
    json.dump(out, open(os.path.join(lab, "megatest.json"), "w", encoding="utf-8"), ensure_ascii=False)
    print(f"\nFertig in {time.time() - t0:.0f}s: {nvar} Varianten. Kandidatin {cid}: {'ÜBERNOMMEN' if passed else 'VERWORFEN'}")
    for c in checks: print(("  OK  " if c["ok"] else "  NEIN") + " " + c["name"] + "  " + c["wert"])
    print(f"  Rangkorrelation Entwicklung+Validierung vs. Endtest über alle Varianten: {out['rang_korrelation']:.2f}")


if __name__ == "__main__":
    main()
