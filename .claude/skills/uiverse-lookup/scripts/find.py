#!/usr/bin/env python3
"""Sucht in einem lokalen Klon von uiverse-io/galaxy. Nur Standardbibliothek.
  find.py <wörter...> [-c Kategorie] [-n Anzahl]     find.py --show <Kategorie/Datei.html>"""
import argparse, os, re, sys
ROOT = os.environ.get("UIVERSE_DIR", os.path.expanduser("~/uiverse-galaxy"))
SAFE = {"transform", "opacity", "filter"}

def kind(src):
    props = set()
    for blk in re.findall(r"@keyframes[^{]+\{((?:[^{}]*\{[^{}]*\})+[^{}]*)\}", src):
        props |= set(p.strip().lower() for p in re.findall(r"([a-z-]+)\s*:", re.sub(r"\{[^}]*\}", lambda m: m.group(0), blk)))
    props -= {"from", "to"}
    heavy = {p for p in props if re.fullmatch(r"(box-shadow|width|height|top|left|right|bottom|margin[a-z-]*|padding[a-z-]*|border[a-z-]*|background[a-z-]*|color|font-size|clip-path)", p)}
    return "ok" if not heavy and (props & SAFE or not props) else "Paint"

def main():
    p = argparse.ArgumentParser(description=__doc__); p.add_argument("words", nargs="*"); p.add_argument("-c"); p.add_argument("-n", type=int, default=5); p.add_argument("--show")
    a = p.parse_args()
    if not os.path.isdir(ROOT): sys.exit(f"Klon fehlt: {ROOT}. Einrichten: .claude/setup/setup-claude-extras.sh uiverse (oder UIVERSE_DIR setzen)")
    if a.show:
        f = os.path.realpath(os.path.join(ROOT, a.show))
        if not f.startswith(os.path.realpath(ROOT) + os.sep) or not os.path.isfile(f): sys.exit("Datei nicht gefunden")
        print(open(f, encoding="utf-8", errors="replace").read()); return
    if not a.words: sys.exit(__doc__)
    words = [w.lower() for w in a.words]; hits = []
    for cat in sorted(os.listdir(ROOT)):
        d = os.path.join(ROOT, cat)
        if not os.path.isdir(d) or cat.startswith(".") or (a.c and cat.lower() != a.c.lower()): continue
        for fn in os.listdir(d):
            if not fn.endswith(".html"): continue
            src = open(os.path.join(d, fn), encoding="utf-8", errors="replace").read()
            m = re.search(r"Tags:\s*([^\n*]+)", src); tags = (m.group(1).strip() if m else "").lower()
            score = sum(3 for w in words if w in tags.split(", ") or w in tags) + sum(1 for w in words if w in fn.lower()) + sum(0.2 for w in words if w in src.lower())
            if score >= len(words) * 0.2 + 0.1 and any(w in tags or w in fn.lower() for w in words): hits.append((score, cat, fn, tags, len(src), kind(src)))
    hits.sort(key=lambda h: (-h[0], h[4]))
    if not hits: print("Keine Treffer."); return
    for s, cat, fn, tags, size, k in hits[:a.n]: print(f"[{k}] {cat}/{fn}  ({size} Zeichen)  Tags: {tags}")

if __name__ == "__main__": main()
