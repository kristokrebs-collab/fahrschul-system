#!/usr/bin/env python3
"""build_index.py - baut die Animations-Tabelle in SKILL.md aus references/*.md.
Nutzung: python3 scripts/build_index.py     (nach jeder neuen/aenderten Spec ausfuehren)
Liest je Spec: '# Name (slug)', die erste '> '-Zeile (Einzeiler), die EN-Stichwortzeile unter 'Wann einsetzen'.
"""
import re, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
rows = []
for md in sorted((root / "references").glob("*.md")):
    if md.stem.startswith("principles"):
        continue
    t = md.read_text(encoding="utf-8")
    m = re.match(r"#\s*(.+?)\s*\((.+?)\)", t)
    name, slug = (m.group(1), m.group(2)) if m else (md.stem, md.stem)
    q = re.search(r"^>\s*(.+)$", t, re.M)
    one = q.group(1).strip() if q else ""
    if len(one) > 170:
        cut = one[:170]
        one = (cut[: cut.rfind(" ")] if " " in cut else cut) + " ..."
    kw = re.search(r"^-\s*EN:\s*(.+)$", t, re.M)
    if kw:
        kw = kw.group(1).strip()
    else:  # Fallback: erste Zeile unter "## Wann einsetzen"
        w = re.search(r"##\s*Wann einsetzen\s*\n-\s*(.+)", t)
        kw = w.group(1).strip() if w else ""
    kw = (kw[:90] + " ...") if len(kw) > 92 else kw
    html = f"assets/{slug}.html"
    has = (root / html).exists()
    rows.append(f"| **{name}** | {one} | {kw} | [{slug}.md](references/{md.name}) · " + (f"[html]({html})" if has else "html fehlt") + " |")
table = "| Name | Was es ist | Stichworte (EN) | Dateien |\n|---|---|---|---|\n" + "\n".join(rows)
sk = root / "SKILL.md"
s = sk.read_text(encoding="utf-8")
new = re.sub(r"(<!-- INDEX:START -->).*?(<!-- INDEX:END -->)", lambda m: f"{m.group(1)}\n{table}\n{m.group(2)}", s, flags=re.S)
sk.write_text(new, encoding="utf-8")
print(f"{len(rows)} Animationen im Index")
