#!/usr/bin/env python3
"""Bettet lab/results.json in assets/dashboard.html ein -> eine einzelne HTML-Datei."""
import argparse, json, pathlib, sys

HERE = pathlib.Path(__file__).resolve().parent
TPL = HERE.parent / "assets" / "dashboard.html"
MARK = '<script id="results" type="application/json">null</script>'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--results", default="lab/results.json")
    ap.add_argument("--out", default="lab/dashboard.html")
    a = ap.parse_args()
    data = json.loads(pathlib.Path(a.results).read_text(encoding="utf-8"))
    html = TPL.read_text(encoding="utf-8")
    if MARK not in html:
        sys.exit("Platzhalter im Template nicht gefunden")
    blob = json.dumps(data, ensure_ascii=False).replace("</", "<\\/")
    out = pathlib.Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(html.replace(MARK, f'<script id="results" type="application/json">{blob}</script>'), encoding="utf-8")
    print(f"geschrieben: {out} ({out.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
