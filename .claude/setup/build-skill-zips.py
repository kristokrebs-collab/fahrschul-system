#!/usr/bin/env python3
"""Baut aus .claude/skills/* ZIPs: alle-skills.zip (Ordner für ~/.claude/skills) und einzeln/<name>.zip (je Skill, für claude.ai).
  python3 .claude/setup/build-skill-zips.py <Zielordner> [--exclude name,...]"""
import os, re, sys, zipfile
out = sys.argv[1]; excl = set((sys.argv[sys.argv.index("--exclude") + 1].split(",")) if "--exclude" in sys.argv else [])
src = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "skills"); os.makedirs(os.path.join(out, "einzeln"), exist_ok=True)
SKIP = {"__pycache__", "node_modules", ".git"}
def add(z, d, top):
    for root, dirs, files in os.walk(d):
        dirs[:] = [x for x in dirs if x not in SKIP]
        for fn in files:
            if fn == ".DS_Store" or fn.endswith(".pyc"): continue
            p = os.path.join(root, fn); z.write(p, os.path.join(top, os.path.relpath(p, d)))
skills, problems = [], []
for d in sorted(os.listdir(src)):
    f = os.path.join(src, d, "SKILL.md")
    if d in excl or not os.path.isfile(f): continue
    fm = open(f, encoding="utf-8").read().split("---")[1]
    name = re.search(r"^name:\s*(.+)$", fm, re.M).group(1).strip().strip("\"'")
    m = re.search(r"^description:\s*(>-?|\|)?[ \t]*\n?((?:.*\n?)*?)(?=^\w[\w-]*:|\Z)", fm, re.M)
    desc = " ".join(l.strip() for l in m.group(2).splitlines()).strip().strip("\"'")
    if len(desc) > 1024: problems.append(f"{d}: Beschreibung {len(desc)} Zeichen (>1024)")
    skills.append((d, name))
with zipfile.ZipFile(os.path.join(out, "alle-skills.zip"), "w", zipfile.ZIP_DEFLATED, 9) as z:
    for d, n in skills: add(z, os.path.join(src, d), d)
for d, n in skills:
    with zipfile.ZipFile(os.path.join(out, "einzeln", n + ".zip"), "w", zipfile.ZIP_DEFLATED, 9) as z: add(z, os.path.join(src, d), n)
with zipfile.ZipFile(os.path.join(out, "einzeln-fuer-claude-ai.zip"), "w", zipfile.ZIP_STORED) as z:
    for fn in sorted(os.listdir(os.path.join(out, "einzeln"))): z.write(os.path.join(out, "einzeln", fn), fn)
print(len(skills), "Skills"); print("\n".join(problems) or "alle Beschreibungen <= 1024 Zeichen")
