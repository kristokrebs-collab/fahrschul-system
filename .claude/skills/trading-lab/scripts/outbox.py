#!/usr/bin/env python3
"""outbox.py - Freigabe-Warteschlange für Demo-Signale (Muster aus Harveys "Nothing sends without you", eigener Code).
Es wird NIE eine Order gesendet. Freigeben heißt nur: "Papier-Freigabe" ins Protokoll schreiben.
  outbox.py list   [--lab-dir lab]          zeigt ein Signal nach dem anderen (kein "alles freigeben")
  outbox.py next   [--lab-dir lab]          nächstes wartendes Signal
  outbox.py approve|reject  <nr> [--lab-dir lab]   genau ein Signal entscheiden
  outbox.py pause|resume [--lab-dir lab]    Notaus: solange pausiert, ist keine Freigabe möglich
Zustände: wartet auf deine Freigabe -> papier-freigegeben | abgelehnt. Ohne ausdrückliches Ja des Nutzers im Chat nicht benutzen."""
import argparse, datetime, json, os, sys

def paths(lab): return os.path.join(lab, "outbox.json"), os.path.join(lab, "vault", "papier_freigaben.jsonl"), os.path.join(lab, "PAUSE")

def load(p):
    return json.load(open(p, encoding="utf-8")) if os.path.exists(p) else []

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("cmd", choices=["list", "next", "approve", "reject", "pause", "resume"]); ap.add_argument("nr", nargs="?", type=int)
    ap.add_argument("--lab-dir", default="lab"); a = ap.parse_args()
    ob, log, pause = paths(a.lab_dir); items = load(ob)
    if a.cmd == "pause": open(pause, "w").write(datetime.datetime.now().isoformat()); print("Notaus gesetzt: Freigaben gesperrt."); return
    if a.cmd == "resume":
        if os.path.exists(pause): os.remove(pause)
        print("Notaus aufgehoben."); return
    wait = [(i, x) for i, x in enumerate(items) if x["status"].startswith("wartet")]
    if a.cmd in ("list", "next"):
        print(f"{len(wait)} Signal(e) warten. {'NOTAUS AKTIV.' if os.path.exists(pause) else ''}")
        for i, x in (wait[:1] if a.cmd == "next" else wait): print(f"  [{i}] {x['datum']}  {x['signal']:<8} {x['branche'].strip():<8} {x['status']}")
        print("Keine Order wird gesendet; Freigabe = nur Eintrag im Papier-Protokoll."); return
    if os.path.exists(pause): sys.exit("Notaus aktiv: keine Freigabe möglich (outbox.py resume).")
    if a.nr is None or not (0 <= a.nr < len(items)): sys.exit("Nummer fehlt oder ungültig (outbox.py list).")
    x = items[a.nr]
    if not x["status"].startswith("wartet"): sys.exit("Dieses Signal ist schon entschieden.")
    x["status"] = "papier-freigegeben" if a.cmd == "approve" else "abgelehnt"; x["entschieden"] = datetime.datetime.now().isoformat(timespec="seconds")
    json.dump(items, open(ob, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    os.makedirs(os.path.dirname(log), exist_ok=True)
    open(log, "a", encoding="utf-8").write(json.dumps(dict(x, gesendet=False, hinweis="Papier-Entscheidung, keine Order gesendet."), ensure_ascii=False) + "\n")
    print(f"[{a.nr}] {x['signal']} {x['branche'].strip()}: {x['status']} (nichts gesendet)")

if __name__ == "__main__": main()
